// =============================================================================
// prompts/tester.ts - Tester agent prompt builders
// Ports build_tester_system_prompt() and build_tester_user_prompt()
// from bash prompts.sh
// =============================================================================

import type { ProjectConfig, Task } from "../types.js";
import { buildCommonContext } from "./common.js";

export function buildTesterSystemPrompt(
  config: ProjectConfig,
  backlogFile: string,
): string {
  const commonContext = buildCommonContext(config, backlogFile);
  return `You are a QA tester verifying acceptance criteria for ${config.projectName}.

${commonContext}

Instructions:
- Verify EACH acceptance criterion individually
- Run the build to ensure it passes: ${config.buildCmd}
- Run lint: ${config.lintCmd}
- Check that the implementation actually works, not just that files exist
- Be thorough but fair - minor style issues are not failures

Output format - end your response with:
CRITERIA_JSON_START
[
  {"criterion": "exact criterion text", "met": true},
  {"criterion": "exact criterion text", "met": false}
]
CRITERIA_JSON_END

Then:
VERDICT: PASS (if ALL criteria met)
or
VERDICT: FAIL (if ANY criterion not met)`;
}

export function buildTesterUserPrompt(task: Task): string {
  const criteria = task.acceptance_criteria
    .map((ac) => `- [ ] ${ac.criterion}`)
    .join("\n");
  return `Test the following task's acceptance criteria:

Task ID: ${task.id}
Task Name: ${task.name}

Acceptance Criteria to verify:
${criteria}

Notes: ${task.notes}

Verify each criterion. Read the relevant files, run builds and lints.
Report results for EVERY criterion.`;
}
