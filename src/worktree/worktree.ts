// =============================================================================
// worktree/worktree.ts - Git worktree manager for isolated task/story execution
//
// Provides two-level branching:
// 1. Feature branch created at pipeline start (integration point)
// 2. Story worktrees branched off the feature branch (isolated per-story work)
// =============================================================================

import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import type Logger from "../logging/logger.js";
import type { WorktreeProjectConfig } from "../types.js";

export interface ActiveWorktree {
  branchName: string;
  worktreePath: string;
  type: "feature" | "story";
  storyId?: string;
}

export class WorktreeManager {
  private readonly projectDir: string;
  private readonly worktreeBaseDir: string;
  private readonly config: WorktreeProjectConfig;
  private readonly logger: Logger;
  private baseBranch = "";
  private featureWorktree: ActiveWorktree | null = null;
  private storyWorktrees: Map<string, ActiveWorktree> = new Map();

  constructor(projectDir: string, config: WorktreeProjectConfig, logger: Logger) {
    this.projectDir = projectDir;
    this.worktreeBaseDir = path.join(projectDir, ".worktrees");
    this.config = config;
    this.logger = logger;
  }

  /**
   * Create the feature branch and its worktree.
   * This is the integration point for the pipeline run.
   */
  initFeatureBranch(epicName?: string): ActiveWorktree | null {
    try {
      this.baseBranch = this.getCurrentBranch();
      this.logger.log("INFO", `Worktree: base branch is '${this.baseBranch}'`);

      this.ensureGitignore();

      const slug = epicName ? this.slugify(epicName) : this.defaultFeatureSlug();
      const branchName = `feat/${slug}`;
      const worktreePath = path.join(this.worktreeBaseDir, `feat-${slug}`);

      // Create the feature branch from current HEAD
      this.git(`branch ${branchName}`, this.projectDir);
      this.logger.log("INFO", `Worktree: created branch '${branchName}'`);

      // Create worktree
      fs.mkdirSync(this.worktreeBaseDir, { recursive: true });
      this.git(`worktree add ${this.quote(worktreePath)} ${branchName}`, this.projectDir);
      this.logger.log("INFO", `Worktree: created feature worktree at ${worktreePath}`);

      this.featureWorktree = {
        branchName,
        worktreePath,
        type: "feature",
      };

      this.createSymlinks(worktreePath);
      this.runSetupCommands(worktreePath);

      return this.featureWorktree;
    } catch (err) {
      this.logger.log("WARN", `Worktree: failed to create feature branch — ${this.errMsg(err)}`);
      this.logger.log("WARN", "Worktree: falling back to main working tree");
      return null;
    }
  }

  /**
   * Get or create a story worktree branched from the feature branch.
   */
  getOrCreateStoryWorktree(storyId: string, storyName: string): ActiveWorktree | null {
    // Return existing worktree if already created
    const existing = this.storyWorktrees.get(storyId);
    if (existing) return existing;

    if (!this.featureWorktree) {
      this.logger.log("WARN", `Worktree: no feature worktree — story ${storyId} will run on main tree`);
      return null;
    }

    try {
      const slug = this.slugify(storyName);
      const branchName = `${this.config.branchPrefix}/${storyId}-${slug}`;
      const worktreePath = path.join(this.worktreeBaseDir, `${this.config.branchPrefix}-${storyId}-${slug}`);

      // Create story branch from feature branch
      this.git(`branch ${branchName} ${this.featureWorktree.branchName}`, this.projectDir);
      this.logger.log("INFO", `Worktree: created branch '${branchName}' from '${this.featureWorktree.branchName}'`);

      // Create worktree
      this.git(`worktree add ${this.quote(worktreePath)} ${branchName}`, this.projectDir);
      this.logger.log("INFO", `Worktree: created story worktree at ${worktreePath}`);

      const worktree: ActiveWorktree = {
        branchName,
        worktreePath,
        type: "story",
        storyId,
      };

      this.storyWorktrees.set(storyId, worktree);

      this.createSymlinks(worktreePath);
      this.runSetupCommands(worktreePath);

      return worktree;
    } catch (err) {
      this.logger.log("WARN", `Worktree: failed to create story worktree for ${storyId} — ${this.errMsg(err)}`);
      this.logger.log("WARN", `Worktree: story ${storyId} will run on feature worktree`);
      return null;
    }
  }

  /**
   * Merge a completed story branch into the feature branch and remove the worktree.
   * Returns true on success, false on merge conflict.
   */
  mergeStoryToFeature(storyId: string): boolean {
    const storyWt = this.storyWorktrees.get(storyId);
    if (!storyWt || !this.featureWorktree) {
      this.logger.log("WARN", `Worktree: no worktree found for story ${storyId}, skipping merge`);
      return true; // Nothing to merge is not an error
    }

    try {
      // Merge story branch into feature branch (from feature worktree)
      this.git(`merge ${storyWt.branchName} --no-edit`, this.featureWorktree.worktreePath);
      this.logger.log("INFO", `Worktree: merged '${storyWt.branchName}' into '${this.featureWorktree.branchName}'`);

      // Remove story worktree and branch
      this.git(`worktree remove ${this.quote(storyWt.worktreePath)}`, this.projectDir);
      this.git(`branch -d ${storyWt.branchName}`, this.projectDir);
      this.storyWorktrees.delete(storyId);
      this.logger.log("INFO", `Worktree: removed story worktree for ${storyId}`);

      return true;
    } catch (err) {
      this.logger.log("WARN", `Worktree: merge conflict for story ${storyId} — ${this.errMsg(err)}`);
      this.logger.log("WARN", `Worktree: preserving worktree and branch for manual resolution`);

      // Abort the merge if it left the feature worktree in a conflict state
      try {
        this.git("merge --abort", this.featureWorktree.worktreePath);
      } catch {
        // Ignore — merge may not be in progress
      }

      return false;
    }
  }

  /**
   * Merge the feature branch into the base branch and clean up.
   * Returns true on success, false on merge conflict.
   */
  mergeFeatureToBase(): boolean {
    if (!this.featureWorktree) {
      this.logger.log("WARN", "Worktree: no feature worktree to merge");
      return true;
    }

    try {
      // Remove feature worktree first (can't delete checked-out branch)
      const featureBranch = this.featureWorktree.branchName;
      this.git(`worktree remove ${this.quote(this.featureWorktree.worktreePath)}`, this.projectDir);
      this.logger.log("INFO", `Worktree: removed feature worktree`);

      // Checkout base branch in main tree
      this.git(`checkout ${this.baseBranch}`, this.projectDir);

      // Merge feature branch
      this.git(`merge ${featureBranch} --no-edit`, this.projectDir);
      this.logger.log("INFO", `Worktree: merged '${featureBranch}' into '${this.baseBranch}'`);

      // Delete feature branch
      this.git(`branch -d ${featureBranch}`, this.projectDir);

      this.featureWorktree = null;
      return true;
    } catch (err) {
      this.logger.log("WARN", `Worktree: failed to merge feature branch — ${this.errMsg(err)}`);
      this.logger.log("WARN", `Worktree: feature branch '${this.featureWorktree?.branchName}' preserved for manual merge or PR`);

      // Abort merge if in conflict state
      try {
        this.git("merge --abort", this.projectDir);
      } catch {
        // Ignore
      }

      return false;
    }
  }

  /** Get the active feature worktree, if any. */
  getFeatureWorktree(): ActiveWorktree | null {
    return this.featureWorktree;
  }

  /** Get the active story worktree for a given storyId, if any. */
  getStoryWorktree(storyId: string): ActiveWorktree | null {
    return this.storyWorktrees.get(storyId) ?? null;
  }

  /** Get the base branch name recorded at init. */
  getBaseBranch(): string {
    return this.baseBranch;
  }

  /**
   * Force-remove all active worktrees. Used on SIGINT.
   * Branches are preserved for recovery.
   */
  cleanupAll(): void {
    this.logger.log("INFO", "Worktree: cleaning up all worktrees...");

    for (const [storyId, wt] of this.storyWorktrees) {
      try {
        this.git(`worktree remove --force ${this.quote(wt.worktreePath)}`, this.projectDir);
        this.logger.log("INFO", `Worktree: removed story worktree ${storyId} (branch '${wt.branchName}' preserved)`);
      } catch {
        this.logger.log("WARN", `Worktree: failed to remove story worktree ${storyId}`);
      }
    }
    this.storyWorktrees.clear();

    if (this.featureWorktree) {
      try {
        this.git(`worktree remove --force ${this.quote(this.featureWorktree.worktreePath)}`, this.projectDir);
        this.logger.log("INFO", `Worktree: removed feature worktree (branch '${this.featureWorktree.branchName}' preserved)`);
      } catch {
        this.logger.log("WARN", `Worktree: failed to remove feature worktree`);
      }
      this.featureWorktree = null;
    }

    // Restore base branch in main tree
    if (this.baseBranch) {
      try {
        this.git(`checkout ${this.baseBranch}`, this.projectDir);
      } catch {
        // Ignore — best effort
      }
    }

    // Clean up .worktrees directory if empty
    try {
      if (fs.existsSync(this.worktreeBaseDir)) {
        const remaining = fs.readdirSync(this.worktreeBaseDir);
        if (remaining.length === 0) {
          fs.rmdirSync(this.worktreeBaseDir);
        }
      }
    } catch {
      // Ignore
    }
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private getCurrentBranch(): string {
    return this.git("rev-parse --abbrev-ref HEAD", this.projectDir).trim();
  }

  private ensureGitignore(): void {
    const gitignorePath = path.join(this.projectDir, ".gitignore");
    const entry = ".worktrees/";

    try {
      if (fs.existsSync(gitignorePath)) {
        const content = fs.readFileSync(gitignorePath, "utf-8");
        if (content.includes(entry)) return;
        fs.appendFileSync(gitignorePath, `\n${entry}\n`);
      } else {
        fs.writeFileSync(gitignorePath, `${entry}\n`);
      }
      this.logger.log("INFO", "Worktree: added .worktrees/ to .gitignore");
    } catch (err) {
      this.logger.log("WARN", `Worktree: failed to update .gitignore — ${this.errMsg(err)}`);
    }
  }

  private createSymlinks(worktreePath: string): void {
    for (const file of this.config.symlinkFiles) {
      const src = path.join(this.projectDir, file);
      const dest = path.join(worktreePath, file);
      try {
        if (fs.existsSync(src) && !fs.existsSync(dest)) {
          // Ensure parent directory exists
          fs.mkdirSync(path.dirname(dest), { recursive: true });
          fs.symlinkSync(src, dest);
          this.logger.log("INFO", `Worktree: symlinked ${file}`);
        }
      } catch (err) {
        this.logger.log("WARN", `Worktree: failed to symlink ${file} — ${this.errMsg(err)}`);
      }
    }
  }

  private runSetupCommands(worktreePath: string): void {
    for (const cmd of this.config.setupCommands) {
      try {
        this.logger.log("INFO", `Worktree: running setup '${cmd}' in ${worktreePath}`);
        execSync(cmd, { cwd: worktreePath, stdio: "pipe", timeout: 120_000 });
      } catch (err) {
        this.logger.log("WARN", `Worktree: setup command '${cmd}' failed — ${this.errMsg(err)}`);
      }
    }
  }

  private slugify(name: string): string {
    return name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 50);
  }

  private defaultFeatureSlug(): string {
    const now = new Date();
    const dd = String(now.getDate()).padStart(2, "0");
    const mm = String(now.getMonth() + 1).padStart(2, "0");
    const yy = String(now.getFullYear()).slice(2);
    return `tasks-${dd}${mm}${yy}`;
  }

  private git(args: string, cwd: string): string {
    return execSync(`git ${args}`, { cwd, stdio: "pipe", encoding: "utf-8" });
  }

  private quote(p: string): string {
    return `"${p}"`;
  }

  private errMsg(err: unknown): string {
    return err instanceof Error ? err.message : String(err);
  }
}
