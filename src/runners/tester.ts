import { MODEL_OPUS, MAX_TURNS_TESTER, ALLOWED_TOOLS } from "../config.js";
import { invokeClaudeAgent } from "../agents/index.js";
import { buildTesterSystemPrompt, buildTesterUserPrompt } from "../prompts/tester.js";
import type { Task, AgentResult, ProjectConfig } from "../types.js";
import type Logger from "../logging/logger.js";

/**
 * Run the Tester agent (Opus). Always uses Claude.
 */
export async function runTester(
  task: Task,
  config: ProjectConfig,
  backlogFile: string,
  logger: Logger,
  verbose: boolean,
): Promise<AgentResult> {
  const taskLogDir = logger.getTaskLogDir(task.id);

  logger.log("INFO", `[${task.id}] Running Tester (Opus)...`);

  const sysPrompt = buildTesterSystemPrompt(config, backlogFile);
  const userPrompt = buildTesterUserPrompt(task);

  const result = await invokeClaudeAgent({
    model: MODEL_OPUS,
    maxTurns: MAX_TURNS_TESTER,
    systemPrompt: sysPrompt,
    userPrompt,
    logFile: `${taskLogDir}/test.log`,
    cwd: config.projectDir,
    verbose,
    allowedTools: ALLOWED_TOOLS,
  });

  if (result.success) {
    logger.log("INFO", `[${task.id}] Tester completed`);
  } else {
    logger.log("ERROR", `[${task.id}] Tester failed`);
  }

  return result;
}
