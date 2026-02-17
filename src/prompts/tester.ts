// =============================================================================
// prompts/tester.ts - Tester agent prompt builders
// Ports build_tester_system_prompt() and build_tester_user_prompt()
// from bash prompts.sh
//
// Extended with per-type test prompts for task-level and story-level testing.
// =============================================================================

import type { ProjectConfig, Task, Story, TestTypeName, TestTypeResult } from "../types.js";
import type { TestTypeConfig } from "../config.js";
import { buildCommonContext } from "./common.js";

// =============================================================================
// Legacy tester prompts (preserved for backward compatibility)
// =============================================================================

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

// =============================================================================
// Per-type test instructions (sourced from ai-test-agent-prompt.md)
// =============================================================================

const TEST_TYPE_INSTRUCTIONS: Record<TestTypeName, string> = {
  Unit: `**Objective**: Verify that individual functions and methods introduced or modified by this task behave correctly in isolation.

**Instructions**:
- Identify all new or modified functions, methods, and classes in the changeset.
- For each, write and execute unit tests covering: expected inputs, boundary values, null/empty inputs, and error conditions.
- Mock all external dependencies (databases, APIs, file systems).
- If a testing framework is already configured in the project, use it. Otherwise, set one up.
- Report: total tests run, passed, failed, and code coverage percentage for the changed files.
- If this task has no testable units (e.g. pure configuration), auto-PASS with a skip note.`,

  Integration: `**Objective**: Verify that components modified by this task interact correctly with their dependencies.

**Instructions**:
- Identify all integration points affected by the changeset (database queries, API calls, message queues, third-party services).
- Write and execute tests that validate data flows correctly across these boundaries using real or sandboxed instances where possible.
- Test both successful interactions and failure scenarios (timeouts, malformed responses, connection errors).
- Report: total tests run, passed, failed, and any unexpected behaviour at integration boundaries.
- If this task has no integration points, auto-PASS with a skip note.`,

  Contract: `**Objective**: Validate that any API interfaces introduced or modified conform to their documented specifications.

**Instructions**:
- Compare the actual request/response schemas against the API documentation or contract definitions provided.
- Verify HTTP status codes, response structures, data types, required fields, and error response formats.
- If the task involves a consumer/provider relationship, validate both sides of the contract.
- Report: any schema mismatches, undocumented fields, or contract violations.
- If this task does not involve API endpoints, auto-PASS with a skip note.`,

  Regression: `**Objective**: Confirm that existing functionality has not been broken by the changes.

**Instructions**:
- Execute the full existing automated test suite for all modules affected by the changeset.
- If no automated suite exists, identify the five most critical user paths that could be impacted and test them.
- Compare results against the last known passing baseline.
- Report: total tests run, passed, failed, and any newly failing tests that previously passed.`,

  Smoke: `**Objective**: Quickly verify that the deployed application is functional and the critical paths are operational.

**Instructions**:
- Test application startup and health check endpoints.
- Verify authentication and login flows work.
- Confirm the three most critical user journeys complete without error.
- This should be fast; spend no more than a few minutes on this step.
- Report: pass/fail for each critical path tested.`,

  Security: `**Objective**: Identify security vulnerabilities introduced by the changes.

**Instructions**:
- Scan for common vulnerabilities in the changeset: injection flaws (SQL, XSS, command), broken authentication, sensitive data exposure, and insecure configurations.
- Validate that all user inputs are sanitised and validated.
- Check that authorisation controls are enforced correctly (test for privilege escalation and IDOR).
- Review any new dependencies for known CVEs.
- Report: vulnerabilities found, their severity (critical/high/medium/low), and remediation suggestions.`,

  Performance: `**Objective**: Verify the changes meet performance expectations and do not introduce degradation.

**Instructions**:
- Measure response times for all endpoints or functions affected by the changeset under normal load.
- If performance baselines are provided, compare against them. Flag any response time increase greater than 20%.
- Check for memory leaks or excessive resource consumption during sustained load.
- Report: response times (p50, p95, p99), throughput, error rate, and comparison against baselines.`,

  Accessibility: `**Objective**: Verify that any UI changes meet accessibility standards.

**Instructions**:
- If the task includes no UI changes, auto-PASS with a skip note.
- Run automated accessibility scans against all new or modified pages/components.
- Verify keyboard navigation works for all interactive elements.
- Check colour contrast ratios, ARIA labels, screen reader compatibility, and focus management.
- Target WCAG 2.1 AA compliance.
- Report: violations found, their severity, the applicable WCAG criterion, and remediation suggestions.`,

  Exploratory: `**Objective**: Discover edge cases, unexpected behaviours, and usability issues that scripted tests may have missed.

**Instructions**:
- Review the task description and think creatively about what could go wrong.
- Test unusual input combinations, rapid repeated actions, browser back/forward navigation, interrupted workflows, and concurrent sessions.
- Try to break the feature. Attempt actions the developer likely did not anticipate.
- Report: any unexpected behaviours found, steps to reproduce, and severity assessment.`,

  UAT: `**Objective**: Validate that the delivered feature meets the business requirements and acceptance criteria from an end user's perspective.

**This test type must only execute after all previous test types have completed without critical failures.**

**Instructions**:
- You are acting as an end user. You have no knowledge of the underlying code; interact only through the UI.
- Read each acceptance criterion from the story description.
- For each criterion, perform the described user action exactly as a real user would: clicking buttons, filling forms, navigating pages, and observing results.
- Verify that the visible outcomes match what the acceptance criteria specify.
- Test the happy path first, then test reasonable alternative paths a user might take.
- Pay attention to the user experience: are labels clear, is feedback timely, are error messages helpful?
- Report: pass/fail for each acceptance criterion and any usability observations.`,
};

// =============================================================================
// Task-level test prompt builders
// =============================================================================

export function buildTestTypeSystemPrompt(
  testType: TestTypeConfig,
  config: ProjectConfig,
  backlogFile: string,
): string {
  const commonContext = buildCommonContext(config, backlogFile);
  const instructions = TEST_TYPE_INSTRUCTIONS[testType.name];

  let browserContext = "";
  if (testType.requiresBrowser === true && config.applicationUrl) {
    browserContext = `\nBrowser Testing: Open a browser and navigate to ${config.applicationUrl} to perform this test.`;
  } else if (testType.requiresBrowser === "optional" && config.applicationUrl) {
    browserContext = `\nBrowser Testing (optional): If needed, the application is available at ${config.applicationUrl}.`;
  }

  return `You are a ${testType.label} specialist for ${config.projectName}.

${commonContext}
${browserContext}

${instructions}

Build command: ${config.buildCmd}
Lint command: ${config.lintCmd}

IMPORTANT: If this test type is not applicable to the task (e.g. no API endpoints for Contract tests, no UI for Accessibility tests), output VERDICT: PASS with a note explaining why it was skipped.

Output format - end your response with:
NOTES_START
[Your detailed test notes - what was tested, what passed, what failed, specific issues]
NOTES_END

VERDICT: PASS (if all tests pass or test type not applicable)
or
VERDICT: FAIL (if any critical test fails)`;
}

export function buildTestTypeUserPrompt(
  testType: TestTypeConfig,
  task: Task,
  previousResults: TestTypeResult[],
): string {
  const criteria = task.acceptance_criteria
    .map((ac) => `- ${ac.criterion}`)
    .join("\n");

  let previousContext = "";
  if (previousResults.length > 0) {
    const summaries = previousResults.map((r) =>
      `- ${r.testType}: ${r.verdict}${r.skipped ? " (skipped)" : ""}${r.notes ? ` - ${r.notes.slice(0, 200)}` : ""}`
    ).join("\n");
    previousContext = `\nPrevious test results for this task:\n${summaries}\n`;
  }

  return `Run ${testType.label} for the following task:

Task ID: ${task.id}
Task Name: ${task.name}
Description: ${task.description}

Acceptance Criteria:
${criteria}

Notes: ${task.notes}
${previousContext}
Execute the ${testType.name.toLowerCase()} tests and report your findings.`;
}

// =============================================================================
// Story-level test prompt builders
// =============================================================================

export function buildStoryTestSystemPrompt(
  testType: TestTypeConfig,
  config: ProjectConfig,
  backlogFile: string,
): string {
  const commonContext = buildCommonContext(config, backlogFile);
  const instructions = TEST_TYPE_INSTRUCTIONS[testType.name];

  let browserContext = "";
  if (testType.requiresBrowser === true && config.applicationUrl) {
    browserContext = `\nBrowser Testing: Open a browser and navigate to ${config.applicationUrl} to perform this test.`;
  } else if (testType.requiresBrowser === true && !config.applicationUrl) {
    browserContext = `\nBrowser Testing: No applicationUrl is configured. Fall back to code-level verification of the story acceptance criteria.`;
  } else if (testType.requiresBrowser === "optional" && config.applicationUrl) {
    browserContext = `\nBrowser Testing (optional): If needed, the application is available at ${config.applicationUrl}.`;
  }

  return `You are a ${testType.label} specialist performing story-level testing for ${config.projectName}.

${commonContext}
${browserContext}

You are testing a complete story (feature), not an individual task. All tasks in this story have passed their task-level tests. Your job is to validate the feature as a whole.

${instructions}

Build command: ${config.buildCmd}
Lint command: ${config.lintCmd}

IMPORTANT: If this test type is not applicable to the story (e.g. no API endpoints for Contract tests, no UI for Accessibility tests), output VERDICT: PASS with a note explaining why it was skipped.

Output format - end your response with:
NOTES_START
[Your detailed test notes - what was tested, what passed, what failed, specific issues.
If a test fails, clearly identify which file(s) and code caused the issue so the fixer agent knows what to fix.]
NOTES_END

VERDICT: PASS (if all tests pass or test type not applicable)
or
VERDICT: FAIL (if any critical test fails)`;
}

export function buildStoryTestUserPrompt(
  testType: TestTypeConfig,
  story: Story,
  tasks: Task[],
  previousResults: TestTypeResult[],
): string {
  const storyCriteria = story.acceptance_criteria
    .map((ac) => `- ${ac.criterion}`)
    .join("\n");

  const taskSummaries = tasks.map((t) => {
    const criteria = t.acceptance_criteria
      .map((ac) => `  - ${ac.criterion}`)
      .join("\n");
    return `Task ${t.id}: ${t.name}\n  Description: ${t.description}\n  Criteria:\n${criteria}`;
  }).join("\n\n");

  let previousContext = "";
  if (previousResults.length > 0) {
    const summaries = previousResults.map((r) =>
      `- ${r.testType}: ${r.verdict}${r.skipped ? " (skipped)" : ""}${r.notes ? ` - ${r.notes.slice(0, 200)}` : ""}`
    ).join("\n");
    previousContext = `\nPrevious story-level test results:\n${summaries}\n`;
  }

  let uatNote = "";
  if (testType.name === "UAT") {
    uatNote = `\nIMPORTANT: For UAT, execute each story acceptance criterion literally as a user would. These are the user actions to verify:\n${storyCriteria}\n`;
  }

  return `Run ${testType.label} for the following story:

Story ID: ${story.id}
Story Name: ${story.name}
Description: ${story.description}

Story Acceptance Criteria (user-level):
${storyCriteria}

Child Tasks (all completed):
${taskSummaries}

Notes: ${story.notes}
${previousContext}${uatNote}
Execute the ${testType.name.toLowerCase()} tests at the story level and report your findings.`;
}
