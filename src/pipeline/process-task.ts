import Backlog from "../backlog/backlog.js";
import { MAX_ATTEMPTS } from "../config.js";
import { parseVerdict } from "../parsers/verdict.js";
import { parseNotes } from "../parsers/notes.js";
import { parseCriteriaResults } from "../parsers/criteria.js";
import { runImplementer } from "../runners/implementer.js";
import { runReviewer } from "../runners/reviewer.js";
import { runTester } from "../runners/tester.js";
import { runFixer } from "../runners/fixer.js";
import { gitCommitTask, gitCommitProgress } from "./git.js";
import type { CliProvider, ProjectConfig } from "../types.js";
import type Logger from "../logging/logger.js";

/**
 * Process a single task through the full SDLC pipeline.
 *
 * Pipeline flow:
 *   Step 1 (first attempt only): Implementation
 *   Step 2 (all attempts): Review → (Fix if FAIL)
 *   Step 3 (all attempts): Test → Done | (Fix → Re-test → Done | Todo)
 *
 * Returns true if task completed successfully (Done), false otherwise.
 */
export async function processTask(
  taskId: string,
  backlog: Backlog,
  config: ProjectConfig,
  backlogFile: string,
  logger: Logger,
  cliProvider: CliProvider,
  verbose: boolean,
): Promise<boolean> {
  // Fetch fresh task data
  let task = backlog.getTaskById(taskId);
  if (!task) {
    logger.log("ERROR", `Task ${taskId} not found in backlog`);
    return false;
  }

  // Check attempt count
  let attemptCount = backlog.getAttemptCount(taskId);

  if (attemptCount >= MAX_ATTEMPTS) {
    logger.log("WARN", `[${taskId}] Max attempts (${MAX_ATTEMPTS}) reached. Marking as Blocked.`);
    backlog.updateTaskStatus(taskId, "Blocked");
    backlog.appendTaskNotes(taskId, `Blocked: exceeded ${MAX_ATTEMPTS} attempts`);
    return false;
  }

  // Increment attempt count
  backlog.incrementAttemptCount(taskId);
  attemptCount += 1;
  logger.log("INFO", `[${taskId}] Processing: ${task.name} (attempt ${attemptCount}/${MAX_ATTEMPTS})`);

  // --- Step 1: Implementation (first attempt only) ---
  let implOutput = "";
  if (attemptCount === 1) {
    backlog.updateTaskStatus(taskId, "In-Progress");

    const implResult = await runImplementer(task, config, backlogFile, logger, cliProvider, verbose);
    if (!implResult.success) {
      backlog.appendTaskNotes(taskId, `Implementer failed on attempt ${attemptCount}`);
      backlog.updateTaskStatus(taskId, "Todo");
      return false;
    }
    implOutput = implResult.output;
    gitCommitProgress(taskId, "after-implementation", config.projectDir, logger);
  }

  // --- Step 2: Review ---
  backlog.updateTaskStatus(taskId, "Review");
  task = backlog.getTaskById(taskId)!;

  const reviewResult = await runReviewer(task, implOutput, config, backlogFile, logger, verbose);
  if (!reviewResult.success) {
    backlog.appendTaskNotes(taskId, `Reviewer failed on attempt ${attemptCount}`);
    backlog.updateTaskStatus(taskId, "Todo");
    return false;
  }

  const reviewVerdict = parseVerdict(reviewResult.output);
  logger.log("INFO", `[${taskId}] Review verdict: ${reviewVerdict}`);

  // If review fails, fix the issues before proceeding to testing
  if (reviewVerdict === "FAIL") {
    const reviewNotes = parseNotes(reviewResult.output);
    backlog.appendTaskNotes(taskId, `Review FAIL: ${reviewNotes}`);

    backlog.updateTaskStatus(taskId, "In-Progress");
    task = backlog.getTaskById(taskId)!;

    const fixResult = await runFixer(task, reviewNotes, attemptCount, config, backlogFile, logger, verbose);
    if (!fixResult.success) {
      backlog.appendTaskNotes(taskId, `Fixer failed after review on attempt ${attemptCount}`);
      backlog.updateTaskStatus(taskId, "Todo");
      return false;
    }
    gitCommitProgress(taskId, "after-review-fix", config.projectDir, logger);
  }

  // --- Step 3: Testing ---
  backlog.updateTaskStatus(taskId, "Testing");
  task = backlog.getTaskById(taskId)!;

  const testResult = await runTester(task, config, backlogFile, logger, verbose);
  if (!testResult.success) {
    backlog.appendTaskNotes(taskId, `Tester failed on attempt ${attemptCount}`);
    backlog.updateTaskStatus(taskId, "Todo");
    return false;
  }

  const testVerdict = parseVerdict(testResult.output);
  logger.log("INFO", `[${taskId}] Test verdict: ${testVerdict}`);

  // Update criteria from test results
  const criteriaJson = parseCriteriaResults(testResult.output);
  if (criteriaJson) {
    backlog.updateCriteriaMet(taskId, criteriaJson);
  }

  // If all tests pass, task is Done
  if (testVerdict === "PASS") {
    backlog.updateTaskStatus(taskId, "Done");
    task = backlog.getTaskById(taskId)!;
    gitCommitTask(taskId, task.name, config.projectDir, logger);
    backlog.appendTaskNotes(taskId, `Completed on attempt ${attemptCount}`);
    logger.log("INFO", `[${taskId}] DONE - Task completed successfully`);
    return true;
  }

  // Tests failed - try to fix
  let testNotes = parseNotes(testResult.output);
  if (!testNotes) {
    testNotes = `Test verdict: FAIL. Criteria results: ${criteriaJson ? JSON.stringify(criteriaJson) : "none available"}`;
  }
  backlog.appendTaskNotes(taskId, `Test FAIL: ${testNotes}`);

  backlog.updateTaskStatus(taskId, "In-Progress");
  task = backlog.getTaskById(taskId)!;

  const fixResult = await runFixer(task, testNotes, attemptCount, config, backlogFile, logger, verbose);
  if (!fixResult.success) {
    backlog.appendTaskNotes(taskId, `Fixer failed after test on attempt ${attemptCount}`);
    backlog.updateTaskStatus(taskId, "Todo");
    return false;
  }
  gitCommitProgress(taskId, "after-test-fix", config.projectDir, logger);

  // Re-test after fix
  backlog.updateTaskStatus(taskId, "Testing");
  task = backlog.getTaskById(taskId)!;

  const retestResult = await runTester(task, config, backlogFile, logger, verbose);
  if (!retestResult.success) {
    backlog.appendTaskNotes(taskId, `Re-tester failed on attempt ${attemptCount}`);
    backlog.updateTaskStatus(taskId, "Todo");
    return false;
  }

  const retestVerdict = parseVerdict(retestResult.output);
  logger.log("INFO", `[${taskId}] Re-test verdict: ${retestVerdict}`);

  // Update criteria from re-test
  const retestCriteria = parseCriteriaResults(retestResult.output);
  if (retestCriteria) {
    backlog.updateCriteriaMet(taskId, retestCriteria);
  }

  if (retestVerdict === "PASS") {
    backlog.updateTaskStatus(taskId, "Done");
    task = backlog.getTaskById(taskId)!;
    gitCommitTask(taskId, task.name, config.projectDir, logger);
    backlog.appendTaskNotes(taskId, `Completed on attempt ${attemptCount} (after fix)`);
    logger.log("INFO", `[${taskId}] DONE - Task completed after fix`);
    return true;
  }

  // Re-test still failed
  backlog.appendTaskNotes(taskId, `Re-test still failing on attempt ${attemptCount}`);
  backlog.updateTaskStatus(taskId, "Todo");
  logger.log("WARN", `[${taskId}] Still failing after attempt ${attemptCount}. Queued for retry.`);
  return false;
}
