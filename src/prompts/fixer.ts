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

Root cause analysis (do this BEFORE making any code changes):
- Read the failure notes AND acceptance criteria together
- Identify the root causes — not just the symptoms
- Check related tasks in the backlog for context or dependencies
- Consult project docs (${config.docSolutionDesign}, ${config.docPrd}, ${config.docBusinessFlows}) when failures involve business logic
- If A/C gaps were identified in review notes, implement what is needed to match the documented intent

Then apply fixes:
- Fix ONLY the issues identified — do not refactor unrelated code
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
Description: ${task.description}

Acceptance Criteria:
${criteria}

Issues to fix:
${failureNotes}

Follow this process:
1. Read the failure notes and acceptance criteria together to understand the full context.
2. Identify root causes — what is actually wrong, not just the surface symptom.
3. Check the backlog and project docs if the issue involves business logic or cross-task dependencies.
4. Apply targeted fixes for each root cause.
5. Run ${task.notes ? "build and lint" : "build and lint"} to verify fixes: verify build passes after all changes.
6. If any A/C gaps were noted, implement the missing functionality.`;
}
