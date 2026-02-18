// =============================================================================
// runners/task-test-orchestrator.ts - Task-level test orchestration
//
// Runs Unit, Integration, Contract tests sequentially per task.
// Halts on critical failure, fixes, and re-runs the failing type.
// =============================================================================

import fs from "node:fs";
import path from "node:path";
import { MODEL_OPUS, MAX_TURNS_TEST_FIXER, MAX_TURNS_TESTER_BROWSER, ALLOWED_TOOLS, ALLOWED_TOOLS_BROWSER, TASK_TEST_TYPES } from "../config.js";
import type { TestTypeConfig } from "../config.js";
import { invokeClaudeAgent } from "../agents/index.js";
import type { McpStdioServerConfig } from "../agents/types.js";
import { buildTestTypeSystemPrompt, buildTestTypeUserPrompt } from "../prompts/tester.js";
import { buildFixerSystemPrompt, buildFixerUserPrompt } from "../prompts/fixer.js";
import { parseVerdict } from "../parsers/verdict.js";
import { parseNotes } from "../parsers/notes.js";
import { gitCommitProgress } from "../pipeline/git.js";
import type Backlog from "../backlog/backlog.js";
import type { Task, ProjectConfig, TestTypeResult, TestOrchestrationResult, Verdict } from "../types.js";
import type Logger from "../logging/logger.js";

/**
 * Run a single test type against a task.
 */
async function runSingleTestType(
  testType: TestTypeConfig,
  task: Task,
  config: ProjectConfig,
  backlogFile: string,
  previousResults: TestTypeResult[],
  logger: Logger,
  verbose: boolean,
  devServerRunning: boolean,
  mcpServers?: Record<string, McpStdioServerConfig>,
): Promise<TestTypeResult> {
  const startTime = Date.now();
  const taskLogDir = logger.getTaskLogDir(task.id);

  // Determine if this test should use browser tools
  const useBrowser = testType.requiresBrowser !== false && devServerRunning && mcpServers !== undefined;
  const effectiveTools = useBrowser ? ALLOWED_TOOLS_BROWSER : ALLOWED_TOOLS;
  const effectiveMaxTurns = useBrowser ? MAX_TURNS_TESTER_BROWSER : testType.maxTurns;

  if (useBrowser) {
    logger.log("INFO", `[${task.id}] Running ${testType.label} (browser-enabled)...`);
  } else {
    logger.log("INFO", `[${task.id}] Running ${testType.label}...`);
  }

  const sysPrompt = buildTestTypeSystemPrompt(testType, config, backlogFile);
  const userPrompt = buildTestTypeUserPrompt(testType, task, previousResults);

  const result = await invokeClaudeAgent({
    model: MODEL_OPUS,
    maxTurns: effectiveMaxTurns,
    systemPrompt: sysPrompt,
    userPrompt,
    logFile: path.join(taskLogDir, `test-${testType.name.toLowerCase()}.log`),
    cwd: config.projectDir,
    verbose,
    allowedTools: effectiveTools,
    ...(useBrowser && mcpServers ? { mcpServers } : {}),
  });

  const durationMs = Date.now() - startTime;

  if (!result.success) {
    logger.log("ERROR", `[${task.id}] ${testType.label} agent failed`);
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

  // Detect auto-skip (PASS with skip indicators in notes)
  const skipped = verdict === "PASS" && /\b(skip|not applicable|no .* to test|auto-pass)\b/i.test(notes);

  logger.log("INFO", `[${task.id}] ${testType.label}: ${verdict}${skipped ? " (skipped - not applicable)" : ""}`);

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
 * Run the fixer agent for a specific test type failure at the task level.
 */
async function runTestFix(
  testType: TestTypeConfig,
  task: Task,
  failureNotes: string,
  fixNumber: number,
  config: ProjectConfig,
  backlogFile: string,
  logger: Logger,
  verbose: boolean,
): Promise<boolean> {
  const taskLogDir = logger.getTaskLogDir(task.id);

  logger.log("INFO", `[${task.id}] Fixing ${testType.label} failure (fix #${fixNumber})...`);

  const sysPrompt = buildFixerSystemPrompt(config, backlogFile);
  const userPrompt = buildFixerUserPrompt(task, `${testType.label} failure:\n${failureNotes}`);

  const result = await invokeClaudeAgent({
    model: MODEL_OPUS,
    maxTurns: MAX_TURNS_TEST_FIXER,
    systemPrompt: sysPrompt,
    userPrompt,
    logFile: path.join(taskLogDir, `fix-${testType.name.toLowerCase()}-${fixNumber}.log`),
    cwd: config.projectDir,
    verbose,
    allowedTools: ALLOWED_TOOLS,
  });

  if (result.success) {
    logger.log("INFO", `[${task.id}] Fixer completed for ${testType.label}`);
    gitCommitProgress(task.id, `after-${testType.name.toLowerCase()}-fix`, config.projectDir, logger);
    return true;
  }

  logger.log("ERROR", `[${task.id}] Fixer failed for ${testType.label}`);
  return false;
}

/**
 * Write a task-level test report to the reports directory.
 */
function writeTaskTestReport(
  task: Task,
  results: TestTypeResult[],
  overallVerdict: Verdict,
  reportsDir: string,
): string {
  fs.mkdirSync(reportsDir, { recursive: true });

  const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const reportPath = path.join(reportsDir, `test-report-${task.id}-${timestamp}.md`);

  const rows = results.map((r) => {
    const status = r.skipped ? "SKIPPED" : r.verdict;
    const notes = r.notes ? r.notes.slice(0, 100).replace(/\n/g, " ") : "";
    return `| ${r.testType.padEnd(13)} | ${status.padEnd(7)} | ${r.durationMs.toString().padStart(7)}ms | $${r.costUsd.toFixed(4).padStart(7)} | ${notes} |`;
  }).join("\n");

  const totalDuration = results.reduce((sum, r) => sum + r.durationMs, 0);
  const totalCost = results.reduce((sum, r) => sum + r.costUsd, 0);

  const report = `## Task Test Report

**Task**: ${task.id} - ${task.name}
**Date**: ${new Date().toISOString()}
**Overall Result**: ${overallVerdict}

### Results by Test Type

| Test Type     | Status  | Duration  | Cost     | Notes |
|---------------|---------|-----------|----------|-------|
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
 * Orchestrate task-level testing: run Unit, Integration, Contract sequentially.
 * Halt on critical failure, attempt fix, re-run failing type.
 */
export async function runTaskTestOrchestrator(
  task: Task,
  config: ProjectConfig,
  backlogFile: string,
  backlog: Backlog,
  logger: Logger,
  verbose: boolean,
  reportsDir: string,
  devServerRunning = false,
  mcpServers?: Record<string, McpStdioServerConfig>,
): Promise<TestOrchestrationResult> {
  const results: TestTypeResult[] = [];
  let overallVerdict: Verdict = "PASS";
  let haltedAt: TestTypeResult["testType"] | undefined;
  let fixAttempted = false;
  const startTime = Date.now();

  for (const testType of TASK_TEST_TYPES) {
    // Update status to show which test is running
    backlog.updateTaskStatus(task.id, `Testing:${testType.statusSuffix}`);

    // Run the test type
    let result = await runSingleTestType(
      testType, task, config, backlogFile, results, logger, verbose, devServerRunning, mcpServers,
    );

    // If failed, try to fix and re-run once
    if (result.verdict === "FAIL") {
      fixAttempted = true;
      const attemptCount = backlog.getAttemptCount(task.id);

      // Attempt fix
      backlog.updateTaskStatus(task.id, "In-Progress");
      const freshTask = backlog.getTaskById(task.id)!;
      const fixed = await runTestFix(
        testType, freshTask, result.notes, attemptCount, config, backlogFile, logger, verbose,
      );

      if (fixed) {
        // Re-run the same test type
        backlog.updateTaskStatus(task.id, `Testing:${testType.statusSuffix}`);
        const retryTask = backlog.getTaskById(task.id)!;
        const retryResult = await runSingleTestType(
          testType, retryTask, config, backlogFile, results, logger, verbose, devServerRunning, mcpServers,
        );

        if (retryResult.verdict === "PASS") {
          result = retryResult;
        } else {
          // Still failing after fix - halt
          results.push(retryResult);
          overallVerdict = "FAIL";
          haltedAt = testType.name;
          backlog.appendTaskNotes(task.id, `${testType.label} still failing after fix`);
          break;
        }
      } else {
        // Fix itself failed - halt
        results.push(result);
        overallVerdict = "FAIL";
        haltedAt = testType.name;
        backlog.appendTaskNotes(task.id, `Fixer failed for ${testType.label}`);
        break;
      }
    }

    results.push(result);
  }

  // If we completed all types without halting, check if any failed
  if (!haltedAt && results.some((r) => r.verdict === "FAIL")) {
    overallVerdict = "FAIL";
  }

  const totalDurationMs = Date.now() - startTime;
  const totalCostUsd = results.reduce((sum, r) => sum + r.costUsd, 0);

  // Write report
  const reportPath = writeTaskTestReport(task, results, overallVerdict, reportsDir);
  backlog.appendTaskNotes(task.id, `Task test report: ${reportPath}`);

  logger.log("INFO", `[${task.id}] Task test orchestration: ${overallVerdict} (${totalDurationMs}ms, $${totalCostUsd.toFixed(4)})`);

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
