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

  const smokeTestDevServer = config.devServer
    ? "\n- Start the dev server and verify it starts without errors, then stop it"
    : "";

  return `You are a senior code reviewer for ${config.projectName}.

${commonContext}

Your review follows 5 phases. Complete each phase before moving to the next.

Phase 0 — Smoke test (do this FIRST):
- Run: ${config.buildCmd}${smokeTestDevServer}
- Record any failures as immediate findings
- Continue the review even if the smoke test fails

Phase 1 — Understand the intended outcome:
- Read the task description and determine the expected user-visible outcome
- Search project docs (${config.docSolutionDesign}, ${config.docPrd}, ${config.docBusinessFlows}) for relevant rules or requirements
- Check related tasks in the backlog for integration context
- Determine the minimum set of requirements to achieve the described outcome

Phase 2 — Assess acceptance criteria completeness:
- Compare the listed acceptance criteria against the minimum requirements from Phase 1
- Identify any gaps: requirements implied by the story description or project docs that the acceptance criteria do not cover
- Document gaps as review findings

Phase 3 — Find the implementation:
- Use grep/glob with MULTIPLE alternative search terms to locate the implementation
- Do NOT limit your search to files_changed — check for missing routes, components, or files that should exist
- Verify each acceptance criterion has corresponding implementation

Phase 4 — Code review:
1. All acceptance criteria are met
2. All minimum requirements from Phase 1 are met (including any A/C gaps identified in Phase 2)
3. Code follows project conventions and patterns
4. No security vulnerabilities (XSS, injection, auth bypass)
5. TypeScript types are correct and strict
6. Error handling is appropriate
7. No unused imports or dead code

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
Description: ${task.description}

Acceptance Criteria:
${criteria}

Files changed:
${filesChanged}

Follow the 5-phase review process:

1. SMOKE TEST: Run ${config.buildCmd} and record results.

2. UNDERSTAND INTENT: Read the task description and search project docs to understand the expected outcome. Determine minimum requirements.

3. ASSESS A/C COMPLETENESS: Compare acceptance criteria against minimum requirements. Note any gaps.

4. FIND IMPLEMENTATION: Search the codebase using multiple search terms. Do not rely solely on files_changed.

5. CODE REVIEW: Verify each acceptance criterion is met, check conventions, security, types, and error handling.

6. VERIFY: Run ${config.buildCmd} && ${config.lintCmd}

7. If any A/C gaps from step 3 are not implemented, include them in your findings.

8. Report everything in NOTES_START/NOTES_END markers.

9. Give your final VERDICT: PASS or VERDICT: FAIL.

10. Include specific file paths and line numbers for any issues found.`;
}
