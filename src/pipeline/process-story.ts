// =============================================================================
// pipeline/process-story.ts - Story-level processing pipeline
//
// After all tasks in a story are Done, runs story-level tests:
// Regression -> Smoke -> Security -> Performance -> Accessibility ->
// Exploratory -> UAT
// =============================================================================

import Backlog from "../backlog/backlog.js";
import { MAX_STORY_ATTEMPTS } from "../config.js";
import type { McpStdioServerConfig } from "../agents/types.js";
import { runStoryTestOrchestrator } from "../runners/story-test-orchestrator.js";
import { gitCommitTask } from "./git.js";
import type { ProjectConfig } from "../types.js";
import type Logger from "../logging/logger.js";

/**
 * Process a story through story-level testing.
 *
 * Prerequisites: All child tasks must have status "Done".
 *
 * Returns true if story completed successfully (Done), false otherwise.
 */
export async function processStory(
  storyId: string,
  backlog: Backlog,
  config: ProjectConfig,
  backlogFile: string,
  logger: Logger,
  verbose: boolean,
  reportsDir: string,
  devServerRunning = false,
  mcpServers?: Record<string, McpStdioServerConfig>,
): Promise<boolean> {
  const story = backlog.getStoryById(storyId);
  if (!story) {
    logger.log("ERROR", `Story ${storyId} not found in backlog`);
    return false;
  }

  // Verify all tasks are Done
  if (!backlog.areAllStoryTasksDone(storyId)) {
    logger.log("WARN", `[${storyId}] Not all tasks are Done. Skipping story-level testing.`);
    return false;
  }

  // Check attempt count
  const attemptCount = backlog.getStoryAttemptCount(storyId);
  if (attemptCount >= MAX_STORY_ATTEMPTS) {
    logger.log("WARN", `[${storyId}] Max story attempts (${MAX_STORY_ATTEMPTS}) reached. Marking as Blocked.`);
    backlog.updateStoryStatus(storyId, "Blocked");
    backlog.appendStoryNotes(storyId, `Blocked: exceeded ${MAX_STORY_ATTEMPTS} story-level test attempts`);
    return false;
  }

  // Increment attempt count
  backlog.incrementStoryAttemptCount(storyId);
  logger.log("INFO", `[${storyId}] Processing story: ${story.name} (attempt ${attemptCount + 1}/${MAX_STORY_ATTEMPTS})`);

  // Gather all child tasks
  const tasks = story.task_ids
    .map((tid) => backlog.getTaskById(tid))
    .filter((t) => t !== null);

  // Set story to Testing
  backlog.updateStoryStatus(storyId, "Testing");

  // Run story-level test orchestration
  const storyTestResult = await runStoryTestOrchestrator(
    story, tasks, config, backlogFile, backlog, logger, verbose, reportsDir, devServerRunning, mcpServers,
  );

  if (storyTestResult.overallVerdict === "PASS") {
    backlog.updateStoryStatus(storyId, "Done");
    gitCommitTask(storyId, story.name, config.projectDir, logger);
    backlog.appendStoryNotes(storyId, `Story completed on attempt ${attemptCount + 1}`);
    logger.log("INFO", `[${storyId}] DONE - Story completed successfully`);
    return true;
  }

  // Story tests failed - back to Todo for retry
  backlog.appendStoryNotes(storyId, `Story tests failed on attempt ${attemptCount + 1} (halted at: ${storyTestResult.haltedAt ?? "none"})`);
  backlog.updateStoryStatus(storyId, "Todo");
  logger.log("WARN", `[${storyId}] Story tests failed. Queued for retry.`);
  return false;
}
