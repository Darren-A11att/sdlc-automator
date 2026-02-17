import { MODEL_OPUS, MAX_TURNS_FIXER, ALLOWED_TOOLS } from "../config.js";
import { invokeClaudeAgent } from "../agents/index.js";
import { buildFixerSystemPrompt, buildFixerUserPrompt } from "../prompts/fixer.js";
import type { Task, AgentResult, ProjectConfig } from "../types.js";
import type Logger from "../logging/logger.js";

/**
 * Run the Fixer agent (Opus). Always uses Claude.
 */
export async function runFixer(
  task: Task,
  failureNotes: string,
  fixNumber: number,
  config: ProjectConfig,
  backlogFile: string,
  logger: Logger,
  verbose: boolean,
): Promise<AgentResult> {
  const taskLogDir = logger.getTaskLogDir(task.id);

  logger.log("INFO", `[${task.id}] Running Fixer (Opus) - fix attempt ${fixNumber}...`);

  const sysPrompt = buildFixerSystemPrompt(config, backlogFile);
  const userPrompt = buildFixerUserPrompt(task, failureNotes);

  const result = await invokeClaudeAgent({
    model: MODEL_OPUS,
    maxTurns: MAX_TURNS_FIXER,
    systemPrompt: sysPrompt,
    userPrompt,
    logFile: `${taskLogDir}/fix-${fixNumber}.log`,
    cwd: config.projectDir,
    verbose,
    allowedTools: ALLOWED_TOOLS,
  });

  if (result.success) {
    logger.log("INFO", `[${task.id}] Fixer completed`);
  } else {
    logger.log("ERROR", `[${task.id}] Fixer failed`);
  }

  return result;
}
