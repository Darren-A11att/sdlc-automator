// =============================================================================
// runners/story-test-orchestrator.ts - Story-level test orchestration
//
// Runs Regression, Smoke, Security, Performance, Accessibility,
// Exploratory, and UAT tests sequentially per story after all tasks pass.
// =============================================================================

import fs from "node:fs";
import path from "node:path";
import { MODEL_OPUS, MAX_TURNS_TEST_FIXER, MAX_TURNS_TESTER_BROWSER, ALLOWED_TOOLS, ALLOWED_TOOLS_BROWSER, STORY_TEST_TYPES } from "../config.js";
import type { TestTypeConfig } from "../config.js";
import { invokeClaudeAgent } from "../agents/index.js";
import type { McpStdioServerConfig } from "../agents/types.js";
import { buildStoryTestSystemPrompt, buildStoryTestUserPrompt } from "../prompts/tester.js";
import { buildFixerSystemPrompt } from "../prompts/fixer.js";
import { parseVerdict } from "../parsers/verdict.js";
import { parseNotes } from "../parsers/notes.js";
import { gitCommitProgress } from "../pipeline/git.js";
import type Backlog from "../backlog/backlog.js";
import type { Task, Story, ProjectConfig, TestTypeResult, TestOrchestrationResult, Verdict } from "../types.js";
import type Logger from "../logging/logger.js";

/**
 * Run a single story-level test type.
 */
async function runSingleStoryTest(
  testType: TestTypeConfig,
  story: Story,
  tasks: Task[],
  config: ProjectConfig,
  backlogFile: string,
  previousResults: TestTypeResult[],
  logger: Logger,
  verbose: boolean,
  devServerRunning: boolean,
  mcpServers?: Record<string, McpStdioServerConfig>,
  testerModel?: string,
): Promise<TestTypeResult> {
  const startTime = Date.now();
  const logDir = path.join(logger.logsDir, "stories", story.id);
  fs.mkdirSync(logDir, { recursive: true });

  // Determine if this test should use browser tools
  const useBrowser = testType.requiresBrowser !== false && devServerRunning && mcpServers !== undefined;
  const effectiveTools = useBrowser ? ALLOWED_TOOLS_BROWSER : ALLOWED_TOOLS;
  const effectiveMaxTurns = useBrowser ? MAX_TURNS_TESTER_BROWSER : testType.maxTurns;
  const effectiveModel = testerModel ?? MODEL_OPUS;

  if (useBrowser) {
    logger.log("INFO", `[${story.id}] Running story ${testType.label} (browser-enabled)...`);
  } else {
    logger.log("INFO", `[${story.id}] Running story ${testType.label}...`);
  }

  const sysPrompt = buildStoryTestSystemPrompt(testType, config, backlogFile);
  const userPrompt = buildStoryTestUserPrompt(testType, story, tasks, previousResults);

  const result = await invokeClaudeAgent({
    model: effectiveModel,
    maxTurns: effectiveMaxTurns,
    systemPrompt: sysPrompt,
    userPrompt,
    logFile: path.join(logDir, `test-${testType.name.toLowerCase()}.log`),
    cwd: config.projectDir,
    verbose,
    allowedTools: effectiveTools,
    ...(useBrowser && mcpServers ? { mcpServers } : {}),
  });

  const durationMs = Date.now() - startTime;

  if (!result.success) {
    logger.log("ERROR", `[${story.id}] Story ${testType.label} agent failed`);
    return {
      testType: testType.name,
      verdict: "FAIL",
      notes: `Agent invocation failed: ${result.output}`,
      skipped: false,
      durationMs,
      costUsd: result.costUsd ?? 0,
    };
  }

  const verdict = parseVerdict(result.output);
  const notes = parseNotes(result.output) ?? "";

  const skipped = verdict === "PASS" && /\b(skip|not applicable|no .* to test|auto-pass)\b/i.test(notes);

  logger.log("INFO", `[${story.id}] Story ${testType.label}: ${verdict}${skipped ? " (skipped - not applicable)" : ""}`);

  return {
    testType: testType.name,
    verdict: verdict as Verdict,
    notes,
    skipped,
    skipReason: skipped ? notes.slice(0, 200) : undefined,
    durationMs,
    costUsd: result.costUsd ?? 0,
  };
}

/**
 * Build a fixer prompt for story-level failures.
 * The fixer receives full story context so it can identify which task's code to fix.
 */
function buildStoryFixerUserPrompt(
  testType: TestTypeConfig,
  story: Story,
  tasks: Task[],
  failureNotes: string,
): string {
  const taskSummaries = tasks.map((t) => {
    const criteria = t.acceptance_criteria
      .map((ac) => `  - ${ac.criterion}`)
      .join("\n");
    return `Task ${t.id}: ${t.name}\n  Description: ${t.description}\n  Criteria:\n${criteria}`;
  }).join("\n\n");

  return `Fix the following story-level ${testType.label} failure:

Story ID: ${story.id}
Story Name: ${story.name}
Story Description: ${story.description}

Story Acceptance Criteria:
${story.acceptance_criteria.map((ac) => `- ${ac.criterion}`).join("\n")}

Child Tasks:
${taskSummaries}

${testType.label} Failure Notes:
${failureNotes}

The test failure notes above should identify which files or code caused the issue.
Fix the specific issues. Do not change unrelated code. Verify build passes after fixes.`;
}

/**
 * Run the fixer agent for a story-level test failure.
 */
async function runStoryTestFix(
  testType: TestTypeConfig,
  story: Story,
  tasks: Task[],
  failureNotes: string,
  fixNumber: number,
  config: ProjectConfig,
  backlogFile: string,
  logger: Logger,
  verbose: boolean,
  fixerModel?: string,
): Promise<boolean> {
  const logDir = path.join(logger.logsDir, "stories", story.id);
  fs.mkdirSync(logDir, { recursive: true });
  const effectiveModel = fixerModel ?? MODEL_OPUS;

  logger.log("INFO", `[${story.id}] Fixing story ${testType.label} failure (fix #${fixNumber})...`);

  const sysPrompt = buildFixerSystemPrompt(config, backlogFile);
  const userPrompt = buildStoryFixerUserPrompt(testType, story, tasks, failureNotes);

  const result = await invokeClaudeAgent({
    model: effectiveModel,
    maxTurns: MAX_TURNS_TEST_FIXER,
    systemPrompt: sysPrompt,
    userPrompt,
    logFile: path.join(logDir, `fix-${testType.name.toLowerCase()}-${fixNumber}.log`),
    cwd: config.projectDir,
    verbose,
    allowedTools: ALLOWED_TOOLS,
  });

  if (result.success) {
    logger.log("INFO", `[${story.id}] Story fixer completed for ${testType.label}`);
    gitCommitProgress(story.id, `after-story-${testType.name.toLowerCase()}-fix`, config.projectDir, logger);
    return true;
  }

  logger.log("ERROR", `[${story.id}] Story fixer failed for ${testType.label}`);
  return false;
}

/**
 * Write a story-level test report.
 */
function writeStoryTestReport(
  story: Story,
  results: TestTypeResult[],
  overallVerdict: Verdict,
  reportsDir: string,
): string {
  fs.mkdirSync(reportsDir, { recursive: true });

  const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const reportPath = path.join(reportsDir, `story-test-report-${story.id}-${timestamp}.md`);

  const rows = results.map((r) => {
    const status = r.skipped ? "SKIPPED" : r.verdict;
    const notes = r.notes ? r.notes.slice(0, 100).replace(/\n/g, " ") : "";
    return `| ${r.testType.padEnd(15)} | ${status.padEnd(7)} | ${r.durationMs.toString().padStart(7)}ms | $${r.costUsd.toFixed(4).padStart(7)} | ${notes} |`;
  }).join("\n");

  const totalDuration = results.reduce((sum, r) => sum + r.durationMs, 0);
  const totalCost = results.reduce((sum, r) => sum + r.costUsd, 0);

  const report = `## Story Test Report

**Story**: ${story.id} - ${story.name}
**Date**: ${new Date().toISOString()}
**Overall Result**: ${overallVerdict}

### Results by Test Type

| Test Type       | Status  | Duration  | Cost     | Notes |
|-----------------|---------|-----------|----------|-------|
${rows}

**Total Duration**: ${totalDuration}ms
**Total Cost**: $${totalCost.toFixed(4)}

### Detailed Notes

${results.map((r) => `#### ${r.testType}${r.skipped ? " (Skipped)" : ""}\n${r.notes || "No notes."}\n`).join("\n")}
`;

  fs.writeFileSync(reportPath, report, "utf-8");
  return reportPath;
}

/**
 * Orchestrate story-level testing: run Regression through UAT sequentially.
 * Halt on critical failure, attempt fix, re-run failing type.
 */
export async function runStoryTestOrchestrator(
  story: Story,
  tasks: Task[],
  config: ProjectConfig,
  backlogFile: string,
  backlog: Backlog,
  logger: Logger,
  verbose: boolean,
  reportsDir: string,
  devServerRunning = false,
  mcpServers?: Record<string, McpStdioServerConfig>,
  testerModel?: string,
  fixerModel?: string,
): Promise<TestOrchestrationResult> {
  const results: TestTypeResult[] = [];
  let overallVerdict: Verdict = "PASS";
  let haltedAt: TestTypeResult["testType"] | undefined;
  let fixAttempted = false;
  const startTime = Date.now();

  for (const testType of STORY_TEST_TYPES) {
    // Update story status to show which test is running
    backlog.updateStoryStatus(story.id, `Testing:${testType.statusSuffix}`);

    // Run the test type
    let result = await runSingleStoryTest(
      testType, story, tasks, config, backlogFile, results, logger, verbose, devServerRunning, mcpServers, testerModel,
    );

    // If failed, try to fix and re-run once
    if (result.verdict === "FAIL") {
      fixAttempted = true;
      const attemptCount = backlog.getStoryAttemptCount(story.id);

      // Attempt fix
      backlog.updateStoryStatus(story.id, "In-Progress");
      const freshStory = backlog.getStoryById(story.id)!;
      const fixed = await runStoryTestFix(
        testType, freshStory, tasks, result.notes, attemptCount, config, backlogFile, logger, verbose, fixerModel,
      );

      if (fixed) {
        // Re-run the same test type
        backlog.updateStoryStatus(story.id, `Testing:${testType.statusSuffix}`);
        const retryStory = backlog.getStoryById(story.id)!;
        const retryResult = await runSingleStoryTest(
          testType, retryStory, tasks, config, backlogFile, results, logger, verbose, devServerRunning, mcpServers, testerModel,
        );

        if (retryResult.verdict === "PASS") {
          result = retryResult;
        } else {
          // Still failing after fix - halt
          results.push(retryResult);
          overallVerdict = "FAIL";
          haltedAt = testType.name;
          backlog.appendStoryNotes(story.id, `Story ${testType.label} still failing after fix`);
          break;
        }
      } else {
        // Fix itself failed - halt
        results.push(result);
        overallVerdict = "FAIL";
        haltedAt = testType.name;
        backlog.appendStoryNotes(story.id, `Story fixer failed for ${testType.label}`);
        break;
      }
    }

    results.push(result);
  }

  if (!haltedAt && results.some((r) => r.verdict === "FAIL")) {
    overallVerdict = "FAIL";
  }

  const totalDurationMs = Date.now() - startTime;
  const totalCostUsd = results.reduce((sum, r) => sum + r.costUsd, 0);

  // Write report
  const reportPath = writeStoryTestReport(story, results, overallVerdict, reportsDir);
  backlog.appendStoryNotes(story.id, `Story test report: ${reportPath}`);

  logger.log("INFO", `[${story.id}] Story test orchestration: ${overallVerdict} (${totalDurationMs}ms, $${totalCostUsd.toFixed(4)})`);

  return {
    overallVerdict,
    results,
    haltedAt,
    fixAttempted,
    totalDurationMs,
    totalCostUsd,
    reportPath,
  };
}
