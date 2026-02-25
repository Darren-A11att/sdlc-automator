import { execSync } from "node:child_process";
import type Logger from "../logging/logger.js";

/**
 * Create a git commit when a task completes successfully.
 * Format: feat: <task_name> (<task_id>)
 */
export function gitCommitTask(taskId: string, taskName: string, projectDir: string, logger: Logger): void {
  logger.log("INFO", `[${taskId}] Creating git commit...`);

  try {
    // Stage all changes
    execSync("git add -A", { cwd: projectDir, stdio: "pipe" });

    // Check if there are changes to commit
    try {
      execSync("git diff --cached --quiet", { cwd: projectDir, stdio: "pipe" });
      logger.log("WARN", `[${taskId}] No changes to commit`);
      return;
    } catch {
      // Non-zero exit means there ARE changes — continue
    }

    // Create commit with conventional format
    const commitMsg = `feat: ${taskName} (${taskId})\n\nAutomated SDLC pipeline - task completed and verified.\n\nCo-Authored-By: Claude <noreply@anthropic.com>`;
    execSync(`git commit -m ${escapeShellArg(commitMsg)}`, { cwd: projectDir, stdio: "pipe" });
    logger.log("INFO", `[${taskId}] Git commit created`);

    // Push to remote
    try {
      execSync("git push", { cwd: projectDir, stdio: "pipe" });
      logger.log("INFO", `[${taskId}] Pushed to remote`);
    } catch {
      logger.log("WARN", `[${taskId}] Push to remote failed`);
    }
  } catch (err) {
    logger.log("WARN", `[${taskId}] Git commit failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}

/**
 * Create a WIP commit after each pipeline stage.
 * Format: wip: <task_id> - <stage>
 */
export function gitCommitProgress(taskId: string, stage: string, projectDir: string, logger: Logger): void {
  try {
    execSync("git add -A", { cwd: projectDir, stdio: "pipe" });

    try {
      execSync("git diff --cached --quiet", { cwd: projectDir, stdio: "pipe" });
      return; // No changes
    } catch {
      // Has changes — continue
    }

    execSync(`git commit -m ${escapeShellArg(`wip: ${taskId} - ${stage}`)}`, { cwd: projectDir, stdio: "pipe" });
    logger.log("INFO", `[${taskId}] Progress commit: ${stage}`);
  } catch {
    // Silently ignore git errors for progress commits
  }
}

/**
 * Create a commit for the documentation-first phase.
 * Format: docs: update project documentation for <epic-name>
 */
export function gitCommitDocs(epicName: string, projectDir: string, logger: Logger): void {
  logger.log("INFO", "Creating docs commit...");

  try {
    execSync("git add -A", { cwd: projectDir, stdio: "pipe" });

    try {
      execSync("git diff --cached --quiet", { cwd: projectDir, stdio: "pipe" });
      logger.log("WARN", "No doc changes to commit");
      return;
    } catch {
      // Has changes — continue
    }

    const commitMsg = `docs: update project documentation for ${epicName}\n\nAutomated SDLC pipeline - documentation-first phase.\n\nCo-Authored-By: Claude <noreply@anthropic.com>`;
    execSync(`git commit -m ${escapeShellArg(commitMsg)}`, { cwd: projectDir, stdio: "pipe" });
    logger.log("INFO", "Docs commit created");

    try {
      execSync("git push", { cwd: projectDir, stdio: "pipe" });
      logger.log("INFO", "Pushed docs to remote");
    } catch {
      logger.log("WARN", "Push docs to remote failed");
    }
  } catch (err) {
    logger.log("WARN", `Docs commit failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}

function escapeShellArg(arg: string): string {
  return `'${arg.replace(/'/g, "'\\''")}'`;
}
