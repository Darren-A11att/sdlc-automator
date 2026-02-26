// =============================================================================
// cli/pipeline-runner.ts - Pipeline execution wrapper for CLI
// =============================================================================

import fs from "node:fs";
import path from "node:path";
import { select, input, confirm } from "@inquirer/prompts";
import chalk from "chalk";
import ora from "ora";
import Backlog from "../backlog/backlog.js";
import { MAX_CONSECUTIVE_BLOCKS } from "../config.js";
import type { McpStdioServerConfig } from "../agents/types.js";
import { DevServer } from "../devserver/dev-server.js";
import { loadMcpConfig } from "../devserver/mcp-config.js";
import Logger from "../logging/logger.js";
import { processTask } from "../pipeline/process-task.js";
import { processStory } from "../pipeline/process-story.js";
import { loadProjectConfig } from "../prompts/common.js";
import { runBlockerAnalysis } from "../runners/blocker-analysis.js";
import { runBlockReporter } from "../runners/block-reporter.js";
import { runDocUpdaterPhase } from "../runners/doc-updater.js";
import { gitCommitDocs } from "../pipeline/git.js";
import { WorktreeManager } from "../worktree/worktree.js";
import { deriveConfigForWorktree } from "../worktree/config-overlay.js";
import { checkCompatibility } from "../backlog/schema-checker.js";
import { SchemaAdapter } from "../backlog/schema-adapter.js";
import { findMapInMatrix, loadSchemaMap } from "../backlog/schema-matrix.js";
import { runSchemaMapper } from "../runners/schema-mapper.js";
import type { ProjectConfig, SchemaMap } from "../types.js";
import type { RuntimeConfig, ModelOverrides } from "./config-manager.js";

// =============================================================================
// Pipeline Context — encapsulates setup sequence from run-tasks.ts
// =============================================================================

export interface PipelineContext {
  backlog: Backlog;
  config: ProjectConfig;
  featureConfig: ProjectConfig;
  backlogFilePath: string;
  logger: Logger;
  logsDir: string;
  reportsDir: string;
  devServer?: DevServer;
  devServerRunning: boolean;
  mcpServers?: Record<string, McpStdioServerConfig>;
  worktreeManager?: WorktreeManager;
}

/**
 * Initialize the pipeline context: schema check, adapter, dev server, worktree, MCP.
 * Mirrors the setup sequence from run-tasks.ts main().
 */
export async function initPipeline(
  projectDir: string,
  rc: RuntimeConfig,
  sdlcRoot: string,
): Promise<PipelineContext> {
  const backlogFilePath = path.resolve(projectDir, rc.backlogFile);
  const logsDir = path.join(projectDir, "logs");
  const reportsDir = path.join(projectDir, "reports");

  // Ensure backlog file exists
  if (!fs.existsSync(backlogFilePath)) {
    throw new Error(`Backlog file not found: ${backlogFilePath}`);
  }

  const logger = new Logger(logsDir, backlogFilePath);
  const config = loadProjectConfig(projectDir);

  // Schema compatibility check
  let schemaAdapter: SchemaAdapter | undefined;
  const rawBacklog = JSON.parse(fs.readFileSync(backlogFilePath, "utf8"));
  const compatResult = checkCompatibility(rawBacklog);

  if (!compatResult.compatible) {
    logger.log("WARN", `Backlog schema: ${compatResult.issues.length} compatibility issues`);
    const existingEntry = findMapInMatrix(compatResult.fingerprint, sdlcRoot, projectDir);
    let schemaMap: SchemaMap | null = null;

    if (existingEntry) {
      try {
        schemaMap = loadSchemaMap(existingEntry.mapFile, projectDir, sdlcRoot);
      } catch { /* ignore */ }
    }

    if (!schemaMap) {
      logger.log("INFO", "Invoking schema mapper agent...");
      schemaMap = await runSchemaMapper(rawBacklog as Record<string, unknown>, compatResult, projectDir, sdlcRoot, logger, rc.verbose);
    }

    if (schemaMap) {
      schemaAdapter = new SchemaAdapter(schemaMap);
    } else {
      throw new Error("Schema mapping failed. Cannot proceed with incompatible backlog format.");
    }
  }

  const backlog = new Backlog(backlogFilePath, schemaAdapter);

  // Dev server + MCP setup
  let devServer: DevServer | undefined;
  let devServerRunning = false;
  let mcpServers: Record<string, McpStdioServerConfig> | undefined;

  if (config.devServer) {
    devServer = new DevServer(config.devServer, config.projectDir, path.join(logsDir, "dev-server", "dev-server.log"), logger);
  }

  if (config.mcpConfigPath) {
    mcpServers = loadMcpConfig(config.mcpConfigPath);
    if (Object.keys(mcpServers).length === 0) mcpServers = undefined;
  }

  // Worktree setup
  let worktreeManager: WorktreeManager | undefined;
  let featureConfig: ProjectConfig = config;

  if (config.worktree?.enabled) {
    worktreeManager = new WorktreeManager(config.projectDir, config.worktree, logger);
  }

  return {
    backlog,
    config,
    featureConfig,
    backlogFilePath,
    logger,
    logsDir,
    reportsDir,
    devServer,
    devServerRunning,
    mcpServers,
    worktreeManager,
  };
}

// =============================================================================
// Run Pipeline menu
// =============================================================================

export async function showRunPipelineMenu(
  projectDir: string,
  rc: RuntimeConfig,
  sdlcRoot: string,
): Promise<void> {
  const choice = await select({
    message: "Run Pipeline",
    choices: [
      { name: "Continue (process next Todo tasks)", value: "continue" },
      { name: "Retry specific task", value: "retry" },
      { name: "Start from specific task", value: "start-from" },
      { name: "Doc-first phase only", value: "doc-first" },
      { name: chalk.dim("Back"), value: "back" },
    ],
  });

  if (choice === "back") return;

  const spinner = ora("Initializing pipeline...").start();
  let ctx: PipelineContext;

  try {
    ctx = await initPipeline(projectDir, rc, sdlcRoot);
    spinner.succeed("Pipeline initialized.");
  } catch (err) {
    spinner.fail(`Pipeline init failed: ${err instanceof Error ? err.message : String(err)}`);
    return;
  }

  // Start dev server
  if (ctx.devServer) {
    spinner.start("Starting dev server...");
    ctx.devServerRunning = await ctx.devServer.start();
    if (ctx.devServerRunning) {
      spinner.succeed("Dev server running.");
    } else {
      spinner.warn("Dev server failed to start.");
    }
  }

  try {
    if (choice === "continue") {
      await runContinue(ctx, rc);
    } else if (choice === "retry") {
      await runRetry(ctx, rc);
    } else if (choice === "start-from") {
      await runStartFrom(ctx, rc);
    } else if (choice === "doc-first") {
      await runDocFirst(ctx, rc, projectDir);
    }
  } finally {
    if (ctx.devServer) {
      ctx.devServer.stop();
    }
  }
}

// =============================================================================
// Run modes
// =============================================================================

async function runContinue(ctx: PipelineContext, rc: RuntimeConfig): Promise<void> {
  const { backlog, featureConfig, backlogFilePath, logger, reportsDir, devServerRunning, mcpServers } = ctx;
  let consecutiveBlocks = 0;

  while (true) {
    const nextTask = backlog.getNextTodoTask();
    if (!nextTask) {
      logger.log("INFO", "No more Todo tasks. Pipeline complete.");
      console.log(chalk.green("\n  All tasks processed.\n"));
      break;
    }

    const spinner = ora(`Processing task ${nextTask.id}: ${nextTask.name}`).start();

    // Blocker check
    const blockedTasks = backlog.getBlockedTasks();
    if (blockedTasks.length > 0) {
      const blockerVerdict = await runBlockerAnalysis(
        nextTask, blockedTasks, ctx.config, backlogFilePath, logger, rc.verbose,
      );
      if (blockerVerdict === "BLOCKED") {
        backlog.updateTaskStatus(nextTask.id, "Blocked");
        backlog.appendTaskNotes(nextTask.id, "Blocked: dependency on previously blocked task(s)");
        consecutiveBlocks++;
        spinner.fail(`Task ${nextTask.id} blocked.`);

        if (consecutiveBlocks >= MAX_CONSECUTIVE_BLOCKS) {
          console.log(chalk.red(`\n  Hit ${MAX_CONSECUTIVE_BLOCKS} consecutive blocks. Generating report...\n`));
          await runBlockReporter(backlog.getBlockedTasks(), ctx.config, backlogFilePath, logger, ctx.logsDir, reportsDir, rc.verbose);
          break;
        }
        continue;
      }
    }
    consecutiveBlocks = 0;

    // Derive effective config for task
    let effectiveConfig = featureConfig;
    if (nextTask.story_id && ctx.worktreeManager) {
      const story = backlog.getStoryById(nextTask.story_id);
      if (story) {
        const storyWt = ctx.worktreeManager.getOrCreateStoryWorktree(story.id, story.name);
        if (storyWt) {
          effectiveConfig = deriveConfigForWorktree(ctx.config, storyWt.worktreePath);
        }
      }
    }

    spinner.text = `Running pipeline for ${nextTask.id}...`;
    const success = await processTask(
      nextTask.id, backlog, effectiveConfig, backlogFilePath, logger,
      rc.cliProvider, rc.verbose, reportsDir, devServerRunning, mcpServers,
      rc.modelOverrides,
    );

    if (success) {
      spinner.succeed(`Task ${nextTask.id}: Done`);

      // Check for story completion
      const story = backlog.getStoryByTaskId(nextTask.id);
      if (story && backlog.areAllStoryTasksDone(story.id) && story.status !== "Done") {
        const storySpinner = ora(`Running story-level tests for ${story.id}...`).start();
        let storyConfig = effectiveConfig;
        if (ctx.worktreeManager) {
          const storyWt = ctx.worktreeManager.getStoryWorktree(story.id);
          if (storyWt) {
            storyConfig = deriveConfigForWorktree(ctx.config, storyWt.worktreePath);
          }
        }
        const storySuccess = await processStory(story.id, backlog, storyConfig, backlogFilePath, logger, rc.verbose, reportsDir, devServerRunning, mcpServers);
        if (storySuccess) {
          storySpinner.succeed(`Story ${story.id}: Done`);
          if (ctx.worktreeManager) {
            ctx.worktreeManager.mergeStoryToFeature(story.id);
          }
        } else {
          storySpinner.fail(`Story ${story.id}: Failed`);
        }
      }
    } else {
      const updatedTask = backlog.getTaskById(nextTask.id);
      if (updatedTask?.status === "Blocked") {
        spinner.fail(`Task ${nextTask.id}: Blocked`);
        consecutiveBlocks++;
      } else {
        spinner.warn(`Task ${nextTask.id}: Failed (will retry)`);
      }
    }
  }

  logger.printSummary();
}

async function runRetry(ctx: PipelineContext, rc: RuntimeConfig): Promise<void> {
  const { backlog, backlogFilePath, logger, reportsDir, devServerRunning, mcpServers, featureConfig } = ctx;

  const taskId = await input({ message: "Task ID to retry:" });
  if (!backlog.validateTaskExists(taskId)) {
    console.log(chalk.red(`  Task ${taskId} not found.`));
    return;
  }

  backlog.resetTaskToTodo(taskId);
  console.log(chalk.green(`  Task ${taskId} reset to Todo.`));

  const spinner = ora(`Retrying task ${taskId}...`).start();
  const success = await processTask(
    taskId, backlog, featureConfig, backlogFilePath, logger,
    rc.cliProvider, rc.verbose, reportsDir, devServerRunning, mcpServers,
    rc.modelOverrides,
  );

  if (success) {
    spinner.succeed(`Task ${taskId}: Done`);
  } else {
    spinner.fail(`Task ${taskId}: Failed`);
  }
  logger.printSummary();
}

async function runStartFrom(ctx: PipelineContext, rc: RuntimeConfig): Promise<void> {
  const { backlog } = ctx;

  const taskId = await input({ message: "Task ID to start from:" });
  if (!backlog.validateTaskExists(taskId)) {
    console.log(chalk.red(`  Task ${taskId} not found.`));
    return;
  }

  // Skip tasks until target, then run continue
  const skippedIds: string[] = [];
  let found = false;

  while (true) {
    const nextTask = backlog.getNextTodoTask();
    if (!nextTask) break;
    if (nextTask.id === taskId) {
      found = true;
      break;
    }
    backlog.updateTaskStatus(nextTask.id, "In-Progress");
    skippedIds.push(nextTask.id);
  }

  // Restore skipped
  for (const id of skippedIds) {
    backlog.updateTaskStatus(id, "Todo");
  }

  if (!found) {
    console.log(chalk.red(`  Task ${taskId} not found in Todo queue.`));
    return;
  }

  console.log(chalk.green(`  Starting from task ${taskId}...`));
  await runContinue(ctx, rc);
}

async function runDocFirst(ctx: PipelineContext, rc: RuntimeConfig, projectDir: string): Promise<void> {
  const epicBriefPath = rc.epicBriefPath
    ? path.resolve(projectDir, rc.epicBriefPath)
    : "";

  if (!epicBriefPath) {
    const pathInput = await input({ message: "Epic brief path (relative to project root):" });
    if (!pathInput.trim()) {
      console.log(chalk.dim("  Cancelled."));
      return;
    }
    const resolvedPath = path.resolve(projectDir, pathInput.trim());
    if (!fs.existsSync(resolvedPath)) {
      console.log(chalk.red(`  File not found: ${resolvedPath}`));
      return;
    }
    await runDocUpdaterPhase(ctx.featureConfig, ctx.backlogFilePath, resolvedPath, ctx.logger, rc.verbose);
    gitCommitDocs(ctx.featureConfig.projectName, ctx.featureConfig.projectDir, ctx.logger);
    return;
  }

  if (!fs.existsSync(epicBriefPath)) {
    console.log(chalk.red(`  Epic brief not found: ${epicBriefPath}`));
    return;
  }

  const spinner = ora("Running doc-first phase...").start();
  await runDocUpdaterPhase(ctx.featureConfig, ctx.backlogFilePath, epicBriefPath, ctx.logger, rc.verbose);
  gitCommitDocs(ctx.featureConfig.projectName, ctx.featureConfig.projectDir, ctx.logger);
  spinner.succeed("Doc-first phase complete.");
}

// =============================================================================
// Reset Tasks menu
// =============================================================================

export async function showResetMenu(
  projectDir: string,
  rc: RuntimeConfig,
): Promise<void> {
  const backlogFilePath = path.resolve(projectDir, rc.backlogFile);
  if (!fs.existsSync(backlogFilePath)) {
    console.log(chalk.red("  Backlog file not found."));
    return;
  }

  const backlog = new Backlog(backlogFilePath);

  const choice = await select({
    message: "Reset Tasks",
    choices: [
      { name: "Reset all tasks to Todo", value: "all" },
      { name: "Reset blocked tasks to Todo", value: "blocked" },
      { name: "Reset specific task", value: "specific" },
      { name: chalk.dim("Back"), value: "back" },
    ],
  });

  if (choice === "back") return;

  if (choice === "all") {
    const proceed = await confirm({ message: "Reset ALL tasks to Todo?", default: false });
    if (!proceed) return;
    const count = backlog.resetAllToTodo();
    console.log(chalk.green(`  Reset ${count} tasks to Todo.`));
  }

  if (choice === "blocked") {
    const blocked = backlog.getBlockedTasks();
    if (blocked.length === 0) {
      console.log(chalk.dim("  No blocked tasks."));
      return;
    }
    const proceed = await confirm({ message: `Reset ${blocked.length} blocked tasks to Todo?`, default: true });
    if (!proceed) return;
    const count = backlog.resetBlockedToTodo();
    console.log(chalk.green(`  Reset ${count} blocked tasks to Todo.`));
  }

  if (choice === "specific") {
    const taskId = await input({ message: "Task ID to reset:" });
    if (!backlog.validateTaskExists(taskId)) {
      console.log(chalk.red(`  Task ${taskId} not found.`));
      return;
    }
    const proceed = await confirm({ message: `Reset task ${taskId} to Todo?`, default: true });
    if (!proceed) return;
    backlog.resetTaskToTodo(taskId);
    console.log(chalk.green(`  Task ${taskId} reset to Todo.`));
  }
}
