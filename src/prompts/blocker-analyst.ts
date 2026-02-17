// =============================================================================
// prompts/blocker-analyst.ts - Blocker analyst agent prompt builders
// Ports build_blocker_system_prompt() and build_blocker_user_prompt()
// from bash prompts.sh
// =============================================================================

import type { ProjectConfig, Task } from "../types.js";
import { buildCommonContext } from "./common.js";

export function buildBlockerAnalystSystemPrompt(
  config: ProjectConfig,
  backlogFile: string,
): string {
  const commonContext = buildCommonContext(config, backlogFile);
  return `You are analyzing task dependencies for ${config.projectName}.

${commonContext}

Instructions:
- Compare the candidate task against the list of blocked tasks
- Determine if any blocked task's unresolved issues would PREVENT the candidate from being implemented
- Only flag as blocked if there's a DIRECT dependency (e.g., candidate needs a database table that a blocked task was supposed to create)
- Indirect relationships (same epic, similar area) are NOT blockers

Output format:
BLOCKER_VERDICT: CLEAR
or
BLOCKER_VERDICT: BLOCKED
BLOCKER_REASON: [explanation of which blocked task and why it blocks this one]`;
}

export function buildBlockerAnalystUserPrompt(
  candidateTask: Task,
  blockedTasks: Task[],
): string {
  return `Analyze if this candidate task is blocked by any previously blocked tasks:

Candidate Task:
ID: ${candidateTask.id}
Name: ${candidateTask.name}
Description: ${candidateTask.description}

Previously Blocked Tasks:
${JSON.stringify(blockedTasks, null, 2)}

Is the candidate task directly blocked by any of the above? Only consider DIRECT dependencies.`;
}
