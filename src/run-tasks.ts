#!/usr/bin/env tsx
// =============================================================================
// run-tasks.ts - SDLC Task Loop (TypeScript / Agent SDK)
//
// Replaces: scripts/run-tasks.sh
// Run with: npx tsx src/run-tasks.ts [OPTIONS]
// =============================================================================

import fs from "node:fs";
import path from "node:path";
import Backlog from "./backlog/backlog.js";
import { MAX_CONSECUTIVE_BLOCKS } from "./config.js";
import Logger from "./logging/logger.js";
import { processTask } from "./pipeline/process-task.js";
import { processStory } from "./pipeline/process-story.js";
import { loadProjectConfig } from "./prompts/common.js";
import { runBlockerAnalysis } from "./runners/blocker-analysis.js";
import { runBlockReporter } from "./runners/block-reporter.js";
import type { CliProvider } from "./types.js";

// --- Resolve paths ---
const PROJECT_DIR = path.resolve(import.meta.dirname ?? process.cwd(), "..");
const BACKLOG_FILE = path.join(PROJECT_DIR, "tasks", "backlog_tasks.json");
const LOGS_DIR = path.join(PROJECT_DIR, "logs");
const REPORTS_DIR = path.join(PROJECT_DIR, "reports");

// --- Session state ---
let currentTaskId = "";

// --- Argument parsing ---
interface ParsedArgs {
  retryTaskId: string;
  startFromTaskId: string;
  cliProvider: CliProvider;
  verbose: boolean;
}

function parseArgs(args: string[]): ParsedArgs {
  const result: ParsedArgs = {
    retryTaskId: "",
    startFromTaskId: "",
    cliProvider: "claude",
    verbose: true,
  };

  for (const arg of args) {
    if (arg === "--help") {
      // Will print usage and exit in main()
      result.retryTaskId = "__help__";
      return result;
    } else if (arg.startsWith("--retry:")) {
      result.retryTaskId = arg.slice("--retry:".length);
    } else if (arg.startsWith("--start-from:")) {
      result.startFromTaskId = arg.slice("--start-from:".length);
    } else if (arg === "--cli-kimi") {
      result.cliProvider = "kimi";
    } else if (arg === "--verbose") {
      result.verbose = true;
    } else {
      console.error(`ERROR: Unknown argument: ${arg}`);
      process.exit(1);
    }
  }

  return result;
}

// --- Signal handler ---
function setupCleanup(backlog: Backlog, logger: Logger): void {
  const cleanup = () => {
    console.log("");
    logger.log("WARN", "Interrupt received. Cleaning up...");

    // Clean up any temp files from atomic writes
    try {
      const dir = path.dirname(BACKLOG_FILE);
      const prefix = path.basename(BACKLOG_FILE) + ".tmp.";
      for (const file of fs.readdirSync(dir)) {
        if (file.startsWith(prefix)) {
          fs.unlinkSync(path.join(dir, file));
        }
      }
    } catch {
      // Ignore cleanup errors
    }

    if (currentTaskId) {
      logger.log("INFO", `Task ${currentTaskId} was interrupted. Status preserved in backlog.`);
    }

    logger.printSummary();
    logger.log("INFO", `Session ended. Log: ${logger.sessionLogFile}`);
    process.exit(1);
  };

  process.on("SIGINT", cleanup);
  process.on("SIGTERM", cleanup);
}

// --- Main ---
async function main(): Promise<void> {
  // Parse arguments first (--help should work without backlog file)
  const args = parseArgs(process.argv.slice(2));

  if (args.retryTaskId === "__help__") {
    const logger = new Logger(LOGS_DIR, BACKLOG_FILE);
    logger.printUsage();
    process.exit(0);
  }

  // Enforce backlog file exists
  if (!fs.existsSync(BACKLOG_FILE)) {
    console.error(`ERROR: Backlog file not found at ${BACKLOG_FILE}`);
    console.error("Copy templates/tasks/backlog_tasks.json to tasks/ and populate it.");
    process.exit(1);
  }

  // Initialize logging
  const logger = new Logger(LOGS_DIR, BACKLOG_FILE);

  // Load project config
  const config = loadProjectConfig(PROJECT_DIR);

  // Initialize backlog
  const backlog = new Backlog(BACKLOG_FILE);

  // Setup signal handlers
  setupCleanup(backlog, logger);

  logger.log("INFO", "=== SDLC Task Loop Started ===");
  logger.log("INFO", `Backlog: ${BACKLOG_FILE}`);
  logger.log("INFO", `CLI Provider: ${args.cliProvider}`);
  logger.log("INFO", `Verbose: ${args.verbose}`);

  // Handle --retry mode
  if (args.retryTaskId) {
    logger.log("INFO", `Retry mode: resetting task ${args.retryTaskId}`);
    if (!backlog.validateTaskExists(args.retryTaskId)) {
      logger.log("ERROR", `Task ${args.retryTaskId} not found`);
      process.exit(1);
    }
    backlog.resetTaskToTodo(args.retryTaskId);
    logger.log("INFO", `Task ${args.retryTaskId} reset to Todo`);

    await processTask(args.retryTaskId, backlog, config, BACKLOG_FILE, logger, args.cliProvider, args.verbose, REPORTS_DIR);
    logger.printSummary();
    logger.log("INFO", `Session ended. Log: ${logger.sessionLogFile}`);
    return;
  }

  // Main processing loop
  let consecutiveBlocks = 0;

  // Handle --start-from mode
  if (args.startFromTaskId) {
    logger.log("INFO", `Start-from mode: will skip until task ${args.startFromTaskId}`);
    if (!backlog.validateTaskExists(args.startFromTaskId)) {
      logger.log("ERROR", `Task ${args.startFromTaskId} not found`);
      process.exit(1);
    }

    // Skip tasks until we find the target
    const skippedIds: string[] = [];
    let found = false;

    while (true) {
      const nextTask = backlog.getNextTodoTask();
      if (!nextTask) {
        logger.log("ERROR", `Reached end of Todo tasks without finding ${args.startFromTaskId}`);
        // Restore skipped tasks
        for (const id of skippedIds) {
          backlog.updateTaskStatus(id, "Todo");
        }
        process.exit(1);
      }

      if (nextTask.id === args.startFromTaskId) {
        // Restore skipped tasks
        for (const id of skippedIds) {
          backlog.updateTaskStatus(id, "Todo");
        }
        logger.log("INFO", `Found start-from task: ${nextTask.id}`);
        found = true;
        break;
      }

      // Temporarily mark as In-Progress to skip it
      backlog.updateTaskStatus(nextTask.id, "In-Progress");
      skippedIds.push(nextTask.id);
    }

    if (!found) {
      process.exit(1);
    }
  }

  while (true) {
    // Get next Todo task
    const nextTask = backlog.getNextTodoTask();

    if (!nextTask) {
      logger.log("INFO", "No more Todo tasks found. Pipeline complete.");
      break;
    }

    const taskId = nextTask.id;
    currentTaskId = taskId;

    // Check for blockers before processing
    const blockedTasks = backlog.getBlockedTasks();

    if (blockedTasks.length > 0) {
      logger.log("INFO", `[${taskId}] Checking against ${blockedTasks.length} blocked tasks...`);
      const blockerVerdict = await runBlockerAnalysis(
        nextTask, blockedTasks, config, BACKLOG_FILE, logger, args.verbose,
      );

      if (blockerVerdict === "BLOCKED") {
        logger.log("WARN", `[${taskId}] Blocked by previously blocked tasks`);
        backlog.updateTaskStatus(taskId, "Blocked");
        backlog.appendTaskNotes(taskId, "Blocked: dependency on previously blocked task(s)");
        consecutiveBlocks += 1;

        if (consecutiveBlocks >= MAX_CONSECUTIVE_BLOCKS) {
          logger.log("ERROR", `Hit ${MAX_CONSECUTIVE_BLOCKS} consecutive blocked tasks. Generating report and stopping.`);
          const allBlocked = backlog.getBlockedTasks();
          await runBlockReporter(allBlocked, config, BACKLOG_FILE, logger, LOGS_DIR, REPORTS_DIR, args.verbose);
          logger.printSummary();
          logger.log("INFO", `Session ended. Log: ${logger.sessionLogFile}`);
          process.exit(1);
        }

        continue;
      }
    }

    // Reset consecutive blocks counter on a clear task
    consecutiveBlocks = 0;

    // Process the task — retry until it reaches a terminal state
    while (true) {
      const success = await processTask(
        taskId, backlog, config, BACKLOG_FILE, logger, args.cliProvider, args.verbose, REPORTS_DIR,
      );

      if (success) {
        logger.log("INFO", `[${taskId}] Task completed successfully`);

        // After task Done, check if parent story is ready for testing
        const story = backlog.getStoryByTaskId(taskId);
        if (story && backlog.areAllStoryTasksDone(story.id) && story.status !== "Done") {
          logger.log("INFO", `[${story.id}] All tasks Done. Starting story-level testing...`);
          await processStory(story.id, backlog, config, BACKLOG_FILE, logger, args.verbose, REPORTS_DIR);
        }

        break;
      }

      // Check if task reached a terminal state despite returning failure
      const updatedTask = backlog.getTaskById(taskId);
      const taskStatus = updatedTask?.status;

      if (taskStatus === "Done" || taskStatus === "Blocked") {
        logger.log("INFO", `[${taskId}] Task reached terminal state: ${taskStatus}`);
        break;
      }

      logger.log("WARN", `[${taskId}] Not completed (status: ${taskStatus}), retrying...`);
      await new Promise(resolve => setTimeout(resolve, 2000));
    }

    currentTaskId = "";
  }

  // End of loop - print final summary
  logger.printSummary();
  logger.log("INFO", `Session ended. Log: ${logger.sessionLogFile}`);
}

main().catch(err => {
  console.error("Fatal error:", err);
  process.exit(1);
});
