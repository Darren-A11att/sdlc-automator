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
import type { McpStdioServerConfig } from "./agents/types.js";
import { DevServer } from "./devserver/dev-server.js";
import { loadMcpConfig } from "./devserver/mcp-config.js";
import Logger from "./logging/logger.js";
import { processTask } from "./pipeline/process-task.js";
import { processStory } from "./pipeline/process-story.js";
import { loadProjectConfig } from "./prompts/common.js";
import { runBlockerAnalysis } from "./runners/blocker-analysis.js";
import { runBlockReporter } from "./runners/block-reporter.js";
import { runDocUpdaterPhase } from "./runners/doc-updater.js";
import { gitCommitDocs } from "./pipeline/git.js";
import { WorktreeManager } from "./worktree/worktree.js";
import { deriveConfigForWorktree } from "./worktree/config-overlay.js";
import { checkCompatibility } from "./backlog/schema-checker.js";
import { SchemaAdapter } from "./backlog/schema-adapter.js";
import { findMapInMatrix, loadSchemaMap } from "./backlog/schema-matrix.js";
import { runSchemaMapper } from "./runners/schema-mapper.js";
import type { CliProvider, ProjectConfig, SchemaMap } from "./types.js";

// --- Resolve paths ---
const PROJECT_DIR = path.resolve(import.meta.dirname ?? process.cwd(), "..");
// In headless mode, package root IS the project dir (same directory)
const SDLC_ROOT = PROJECT_DIR;
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
  epicBriefPath: string;
}

function parseArgs(args: string[]): ParsedArgs {
  const result: ParsedArgs = {
    retryTaskId: "",
    startFromTaskId: "",
    cliProvider: "claude",
    verbose: true,
    epicBriefPath: "",
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
    } else if (arg.startsWith("--epic-brief:")) {
      result.epicBriefPath = arg.slice("--epic-brief:".length);
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
function setupCleanup(backlog: Backlog, logger: Logger, devServer?: DevServer, worktreeManager?: WorktreeManager): void {
  const cleanup = () => {
    console.log("");
    logger.log("WARN", "Interrupt received. Cleaning up...");

    // Stop dev server if we started it
    if (devServer) {
      devServer.stop();
    }

    // Clean up worktrees (force-remove, preserve branches)
    if (worktreeManager) {
      worktreeManager.cleanupAll();
    }

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

  // --- Schema compatibility check ---
  let schemaAdapter: SchemaAdapter | undefined;

  const rawBacklog = JSON.parse(fs.readFileSync(BACKLOG_FILE, "utf8"));
  const compatResult = checkCompatibility(rawBacklog);

  if (compatResult.compatible) {
    logger.log("INFO", "Backlog schema: compatible with canonical format");
  } else {
    logger.log("WARN", `Backlog schema: ${compatResult.issues.length} compatibility issues found`);
    for (const issue of compatResult.issues.slice(0, 5)) {
      logger.log("WARN", `  [${issue.type}] ${issue.path}: expected ${issue.expected}, got ${issue.actual}`);
    }

    // Check matrix for existing map
    const existingEntry = findMapInMatrix(compatResult.fingerprint, SDLC_ROOT, PROJECT_DIR);
    let schemaMap: SchemaMap | null = null;

    if (existingEntry) {
      logger.log("INFO", `Schema matrix: found existing map '${existingEntry.name}' (${existingEntry.mapFile})`);
      try {
        schemaMap = loadSchemaMap(existingEntry.mapFile, PROJECT_DIR, SDLC_ROOT);
      } catch (err) {
        logger.log("WARN", `Failed to load existing map: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    if (!schemaMap) {
      // Invoke Opus agent to generate a new map
      logger.log("INFO", "Schema matrix: no existing map found. Invoking schema mapper agent...");
      schemaMap = await runSchemaMapper(
        rawBacklog as Record<string, unknown>,
        compatResult,
        PROJECT_DIR,
        SDLC_ROOT,
        logger,
        args.verbose,
      );
    }

    if (schemaMap) {
      schemaAdapter = new SchemaAdapter(schemaMap);
      logger.log("INFO", "Schema adapter: created — backlog will be transformed bidirectionally");
    } else {
      logger.log("ERROR", "Schema mapping failed. Cannot proceed with incompatible backlog format.");
      process.exit(1);
    }
  }

  // Initialize backlog (with optional adapter for non-canonical formats)
  const backlog = new Backlog(BACKLOG_FILE, schemaAdapter);

  // --- Dev server + MCP setup ---
  let devServer: DevServer | undefined;
  let devServerRunning = false;
  let mcpServers: Record<string, McpStdioServerConfig> | undefined;

  if (config.devServer) {
    devServer = new DevServer(
      config.devServer,
      config.projectDir,
      path.join(LOGS_DIR, "dev-server", "dev-server.log"),
      logger,
    );
  }

  if (config.mcpConfigPath) {
    mcpServers = loadMcpConfig(config.mcpConfigPath);
    if (Object.keys(mcpServers).length === 0) {
      logger.log("WARN", `MCP config at ${config.mcpConfigPath} has no servers`);
      mcpServers = undefined;
    } else {
      logger.log("INFO", `Loaded MCP servers: ${Object.keys(mcpServers).join(", ")}`);
    }
  }

  // --- Worktree setup ---
  let worktreeManager: WorktreeManager | undefined;
  let featureConfig: ProjectConfig = config; // Default: use original config

  if (config.worktree?.enabled) {
    worktreeManager = new WorktreeManager(config.projectDir, config.worktree, logger);
    logger.log("INFO", "Worktree: integration enabled");
  }

  // Setup signal handlers (pass devServer + worktreeManager for cleanup)
  setupCleanup(backlog, logger, devServer, worktreeManager);

  logger.log("INFO", "=== SDLC Task Loop Started ===");
  logger.log("INFO", `Backlog: ${BACKLOG_FILE}`);
  logger.log("INFO", `CLI Provider: ${args.cliProvider}`);
  logger.log("INFO", `Verbose: ${args.verbose}`);
  if (config.devServer) {
    logger.log("INFO", `Dev server: ${config.devServer.startCommand} (port ${config.devServer.port})`);
  }

  // Start dev server if configured
  if (devServer) {
    devServerRunning = await devServer.start();
    if (!devServerRunning) {
      logger.log("WARN", "Dev server failed to start — browser tests will run without Puppeteer");
    }
  }

  try {
    // --- Documentation-First Phase ---
    // Resolve epic brief path: CLI arg takes precedence over project.json
    const epicBriefPath = args.epicBriefPath
      ? path.resolve(PROJECT_DIR, args.epicBriefPath)
      : config.epicBriefPath || "";

    // Extract epic name for feature branch naming
    const epicName = epicBriefPath
      ? path.basename(epicBriefPath, path.extname(epicBriefPath))
      : undefined;

    // Initialize feature branch + worktree before doc phase
    if (worktreeManager) {
      const featureWt = worktreeManager.initFeatureBranch(epicName);
      if (featureWt) {
        featureConfig = deriveConfigForWorktree(config, featureWt.worktreePath);
        logger.log("INFO", `Worktree: feature branch '${featureWt.branchName}' active at ${featureWt.worktreePath}`);
      } else {
        logger.log("WARN", "Worktree: feature branch creation failed — running on main tree");
      }
    }

    if (epicBriefPath) {
      await runDocUpdaterPhase(featureConfig, BACKLOG_FILE, epicBriefPath, logger, args.verbose);
      gitCommitDocs(featureConfig.projectName, featureConfig.projectDir, logger);
    }

    // Handle --retry mode
    if (args.retryTaskId) {
      logger.log("INFO", `Retry mode: resetting task ${args.retryTaskId}`);
      if (!backlog.validateTaskExists(args.retryTaskId)) {
        logger.log("ERROR", `Task ${args.retryTaskId} not found`);
        process.exit(1);
      }
      backlog.resetTaskToTodo(args.retryTaskId);
      logger.log("INFO", `Task ${args.retryTaskId} reset to Todo`);

      // In retry mode, determine effective config based on task's story
      const retryTask = backlog.getTaskById(args.retryTaskId);
      let retryConfig = featureConfig;
      if (retryTask?.story_id && worktreeManager) {
        const story = backlog.getStoryById(retryTask.story_id);
        if (story) {
          const storyWt = worktreeManager.getOrCreateStoryWorktree(story.id, story.name);
          if (storyWt) {
            retryConfig = deriveConfigForWorktree(config, storyWt.worktreePath);
          }
        }
      }

      await processTask(args.retryTaskId, backlog, retryConfig, BACKLOG_FILE, logger, args.cliProvider, args.verbose, REPORTS_DIR, devServerRunning, mcpServers);
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

      // Derive effective config: story worktree > feature worktree > original config
      let effectiveConfig = featureConfig;
      if (nextTask.story_id && worktreeManager) {
        const story = backlog.getStoryById(nextTask.story_id);
        if (story) {
          const storyWt = worktreeManager.getOrCreateStoryWorktree(story.id, story.name);
          if (storyWt) {
            effectiveConfig = deriveConfigForWorktree(config, storyWt.worktreePath);
          }
        }
      }

      // Process the task — retry until it reaches a terminal state
      while (true) {
        const success = await processTask(
          taskId, backlog, effectiveConfig, BACKLOG_FILE, logger, args.cliProvider, args.verbose, REPORTS_DIR, devServerRunning, mcpServers,
        );

        if (success) {
          logger.log("INFO", `[${taskId}] Task completed successfully`);

          // After task Done, check if parent story is ready for testing
          const story = backlog.getStoryByTaskId(taskId);
          if (story && backlog.areAllStoryTasksDone(story.id) && story.status !== "Done") {
            logger.log("INFO", `[${story.id}] All tasks Done. Starting story-level testing...`);

            // Story-level testing runs in the story worktree
            let storyConfig = effectiveConfig;
            if (worktreeManager) {
              const storyWt = worktreeManager.getStoryWorktree(story.id);
              if (storyWt) {
                storyConfig = deriveConfigForWorktree(config, storyWt.worktreePath);
              }
            }

            const storySuccess = await processStory(story.id, backlog, storyConfig, BACKLOG_FILE, logger, args.verbose, REPORTS_DIR, devServerRunning, mcpServers);

            // If story passed, merge story branch into feature branch
            if (storySuccess && worktreeManager) {
              const merged = worktreeManager.mergeStoryToFeature(story.id);
              if (!merged) {
                logger.log("WARN", `[${story.id}] Story merge conflict — marking story as Blocked`);
                backlog.updateStoryStatus(story.id, "Blocked");
                backlog.appendStoryNotes(story.id, "Blocked: merge conflict when merging to feature branch");
              }
            }
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

    // --- Pipeline end: merge feature branch to base ---
    if (worktreeManager && worktreeManager.getFeatureWorktree()) {
      const featureWt = worktreeManager.getFeatureWorktree()!;
      logger.log("INFO", `Worktree: merging feature branch '${featureWt.branchName}' to '${worktreeManager.getBaseBranch()}'`);
      const merged = worktreeManager.mergeFeatureToBase();
      if (!merged) {
        logger.log("WARN", `Worktree: feature branch '${featureWt.branchName}' preserved — create a PR or merge manually`);
      }
    }

    // End of loop - print final summary
    logger.printSummary();
    logger.log("INFO", `Session ended. Log: ${logger.sessionLogFile}`);
  } finally {
    // Always stop dev server on exit
    if (devServer) {
      devServer.stop();
    }
  }
}

main().catch(err => {
  console.error("Fatal error:", err);
  process.exit(1);
});
