// =============================================================================
// worktree/config-overlay.ts - Derive ProjectConfig for worktree paths
// =============================================================================

import path from "node:path";
import type { ProjectConfig } from "../types.js";

function rebase(absPath: string, oldBase: string, newBase: string): string {
  const rel = path.relative(oldBase, absPath);
  return path.resolve(newBase, rel);
}

/**
 * Create a derived ProjectConfig with projectDir pointing to a worktree path.
 * All doc paths are rebased from the original project root to the worktree root.
 */
export function deriveConfigForWorktree(baseConfig: ProjectConfig, worktreePath: string): ProjectConfig {
  const oldBase = baseConfig.projectDir;
  return {
    ...baseConfig,
    projectDir: worktreePath,
    docSolutionDesign: rebase(baseConfig.docSolutionDesign, oldBase, worktreePath),
    docPrd: rebase(baseConfig.docPrd, oldBase, worktreePath),
    docBusinessFlows: rebase(baseConfig.docBusinessFlows, oldBase, worktreePath),
    docSystemDiagram: rebase(baseConfig.docSystemDiagram, oldBase, worktreePath),
  };
}
