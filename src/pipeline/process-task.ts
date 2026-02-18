import Backlog from "../backlog/backlog.js";
import { MAX_ATTEMPTS } from "../config.js";
import type { McpStdioServerConfig } from "../agents/types.js";
import { parseVerdict } from "../parsers/verdict.js";
import { parseNotes } from "../parsers/notes.js";
import { runImplementer } from "../runners/implementer.js";
import { runReviewer } from "../runners/reviewer.js";
import { runFixer } from "../runners/fixer.js";
import { runTaskTestOrchestrator } from "../runners/task-test-orchestrator.js";
import { gitCommitTask, gitCommitProgress } from "./git.js";
import type { CliProvider, ProjectConfig } from "../types.js";
import type Logger from "../logging/logger.js";

/**
 * Process a single task through the full SDLC pipeline.
 *
 * Pipeline flow:
 *   Step 1 (first attempt only): Implementation
 *   Step 2 (all attempts): Review -> (Fix if FAIL)
 *   Step 3 (all attempts): Task Tests (Unit/Integration/Contract) -> Done | Todo
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
  reportsDir: string,
  devServerRunning = false,
  mcpServers?: Record<string, McpStdioServerConfig>,
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

  // --- Step 3: Task-Level Testing (Unit, Integration, Contract) ---
  backlog.updateTaskStatus(taskId, "Testing");
  task = backlog.getTaskById(taskId)!;

  const taskTestResult = await runTaskTestOrchestrator(
    task, config, backlogFile, backlog, logger, verbose, reportsDir, devServerRunning, mcpServers,
  );

  if (taskTestResult.overallVerdict === "PASS") {
    backlog.updateTaskStatus(taskId, "Done");
    task = backlog.getTaskById(taskId)!;
    gitCommitTask(taskId, task.name, config.projectDir, logger);
    backlog.appendTaskNotes(taskId, `Completed on attempt ${attemptCount}`);
    logger.log("INFO", `[${taskId}] DONE - Task completed successfully`);
    return true;
  }

  // Task tests failed - back to Todo for retry
  backlog.appendTaskNotes(taskId, `Task tests failed on attempt ${attemptCount} (halted at: ${taskTestResult.haltedAt ?? "none"})`);
  backlog.updateTaskStatus(taskId, "Todo");
  logger.log("WARN", `[${taskId}] Task tests failed on attempt ${attemptCount}. Queued for retry.`);
  return false;
}
