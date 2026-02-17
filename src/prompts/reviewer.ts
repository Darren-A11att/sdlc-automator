// =============================================================================
// prompts/reviewer.ts - Reviewer agent prompt builders
// Ports build_reviewer_system_prompt() and build_reviewer_user_prompt()
// from bash prompts.sh
// =============================================================================

import type { ProjectConfig, Task } from "../types.js";
import { buildCommonContext } from "./common.js";

export function buildReviewerSystemPrompt(
  config: ProjectConfig,
  backlogFile: string,
): string {
  const commonContext = buildCommonContext(config, backlogFile);
  return `You are a senior code reviewer for ${config.projectName}.

${commonContext}

Review the implementation for:
1. All acceptance criteria are met
2. Code follows project conventions and patterns
3. No security vulnerabilities (XSS, injection, auth bypass)
4. TypeScript types are correct and strict
5. Error handling is appropriate
6. No unused imports or dead code

Output format - end your response with:
NOTES_START
[Your detailed review notes here - what passed, what failed, specific issues]
NOTES_END

VERDICT: PASS
or
VERDICT: FAIL`;
}

export function buildReviewerUserPrompt(
  task: Task,
  filesChanged: string,
  config: ProjectConfig,
): string {
  const criteria = task.acceptance_criteria
    .map((ac) => `- ${ac.criterion}`)
    .join("\n");
  return `Review the implementation of this task:

Task ID: ${task.id}
Task Name: ${task.name}

Acceptance Criteria:
${criteria}

Files changed:
${filesChanged}

Read each changed file and verify the implementation meets all criteria.
Check for security issues, type errors, and convention violations.
Run: ${config.buildCmd} && ${config.lintCmd}`;
}
