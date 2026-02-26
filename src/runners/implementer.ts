import { MODEL_SONNET, MAX_TURNS_IMPLEMENTER, ALLOWED_TOOLS } from "../config.js";
import { invokeAgent } from "../agents/index.js";
import { buildImplementerSystemPrompt, buildImplementerUserPrompt } from "../prompts/implementer.js";
import type { Task, AgentResult, CliProvider, ProjectConfig } from "../types.js";
import type Logger from "../logging/logger.js";

/**
 * Run the Implementer agent (Sonnet) to build a feature from acceptance criteria.
 * Uses invokeAgent() which respects CLI_PROVIDER (claude or kimi).
 */
export async function runImplementer(
  task: Task,
  config: ProjectConfig,
  backlogFile: string,
  logger: Logger,
  cliProvider: CliProvider,
  verbose: boolean,
  model?: string,
): Promise<AgentResult> {
  const taskLogDir = logger.getTaskLogDir(task.id);
  const effectiveModel = model ?? MODEL_SONNET;

  logger.log("INFO", `[${task.id}] Running Implementer (${effectiveModel})...`);

  const sysPrompt = buildImplementerSystemPrompt(config, backlogFile);
  const userPrompt = buildImplementerUserPrompt(task);

  const result = await invokeAgent(cliProvider, {
    model: effectiveModel,
    maxTurns: MAX_TURNS_IMPLEMENTER,
    systemPrompt: sysPrompt,
    userPrompt,
    logFile: `${taskLogDir}/implement.log`,
    cwd: config.projectDir,
    verbose,
    allowedTools: ALLOWED_TOOLS,
  });

  if (result.success) {
    logger.log("INFO", `[${task.id}] Implementer completed successfully`);
  } else {
    logger.log("ERROR", `[${task.id}] Implementer failed`);
  }

  return result;
}
