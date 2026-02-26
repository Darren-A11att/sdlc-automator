import { MODEL_OPUS, MAX_TURNS_REVIEWER, ALLOWED_TOOLS } from "../config.js";
import { invokeClaudeAgent } from "../agents/index.js";
import { buildReviewerSystemPrompt, buildReviewerUserPrompt } from "../prompts/reviewer.js";
import type { Task, AgentResult, ProjectConfig } from "../types.js";
import type Logger from "../logging/logger.js";

/**
 * Run the Reviewer agent (Opus). Always uses Claude regardless of CLI_PROVIDER.
 */
export async function runReviewer(
  task: Task,
  filesChanged: string,
  config: ProjectConfig,
  backlogFile: string,
  logger: Logger,
  verbose: boolean,
  model?: string,
): Promise<AgentResult> {
  const taskLogDir = logger.getTaskLogDir(task.id);
  const effectiveModel = model ?? MODEL_OPUS;

  logger.log("INFO", `[${task.id}] Running Reviewer (${effectiveModel})...`);

  const sysPrompt = buildReviewerSystemPrompt(config, backlogFile);
  const userPrompt = buildReviewerUserPrompt(task, filesChanged, config);

  const result = await invokeClaudeAgent({
    model: effectiveModel,
    maxTurns: MAX_TURNS_REVIEWER,
    systemPrompt: sysPrompt,
    userPrompt,
    logFile: `${taskLogDir}/review.log`,
    cwd: config.projectDir,
    verbose,
    allowedTools: ALLOWED_TOOLS,
  });

  if (result.success) {
    logger.log("INFO", `[${task.id}] Reviewer completed`);
  } else {
    logger.log("ERROR", `[${task.id}] Reviewer failed`);
  }

  return result;
}
