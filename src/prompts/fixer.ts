// =============================================================================
// prompts/fixer.ts - Fixer agent prompt builders
// Ports build_fixer_system_prompt() and build_fixer_user_prompt()
// from bash prompts.sh
// =============================================================================

import type { ProjectConfig, Task } from "../types.js";
import { buildCommonContext } from "./common.js";

export function buildFixerSystemPrompt(
  config: ProjectConfig,
  backlogFile: string,
): string {
  const commonContext = buildCommonContext(config, backlogFile);
  return `You are a senior developer fixing issues found during review/testing of ${config.projectName}.

${commonContext}

Instructions:
- Read the failure notes carefully
- Fix ONLY the issues identified - do not refactor unrelated code
- Verify your fixes by running: ${config.buildCmd} && ${config.lintCmd}
- If the build or lint fails after your fixes, keep fixing until they pass

Output format - end your response with:
FILES_CHANGED_START
- path/to/file1.ts (modified)
FILES_CHANGED_END`;
}

export function buildFixerUserPrompt(task: Task, failureNotes: string): string {
  const criteria = task.acceptance_criteria
    .map((ac) => `- ${ac.criterion}`)
    .join("\n");
  return `Fix the following issues found in task implementation:

Task ID: ${task.id}
Task Name: ${task.name}

Acceptance Criteria:
${criteria}

Issues to fix:
${failureNotes}

Fix these specific issues. Do not change unrelated code. Verify build passes after fixes.`;
}
