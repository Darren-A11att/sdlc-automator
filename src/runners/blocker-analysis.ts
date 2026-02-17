import { MODEL_OPUS, MAX_TURNS_BLOCKER, ALLOWED_TOOLS } from "../config.js";
import { invokeClaudeAgent } from "../agents/index.js";
import { buildBlockerAnalystSystemPrompt, buildBlockerAnalystUserPrompt } from "../prompts/blocker-analyst.js";
import type { Task, BlockerVerdict, ProjectConfig } from "../types.js";
import type Logger from "../logging/logger.js";

/**
 * Run the Blocker Analyst agent (Opus). Always uses Claude.
 * Returns "CLEAR" or "BLOCKED".
 */
export async function runBlockerAnalysis(
  candidateTask: Task,
  blockedTasks: Task[],
  config: ProjectConfig,
  backlogFile: string,
  logger: Logger,
  verbose: boolean,
): Promise<BlockerVerdict> {
  logger.log("INFO", `[${candidateTask.id}] Running Blocker Analysis (Opus)...`);

  const taskLogDir = logger.getTaskLogDir(candidateTask.id);
  const sysPrompt = buildBlockerAnalystSystemPrompt(config, backlogFile);
  const userPrompt = buildBlockerAnalystUserPrompt(candidateTask, blockedTasks);

  const result = await invokeClaudeAgent({
    model: MODEL_OPUS,
    maxTurns: MAX_TURNS_BLOCKER,
    systemPrompt: sysPrompt,
    userPrompt,
    logFile: `${taskLogDir}/blocker-analysis.log`,
    cwd: config.projectDir,
    verbose,
    allowedTools: ALLOWED_TOOLS,
  });

  if (!result.success) {
    logger.log("WARN", `[${candidateTask.id}] Blocker analysis failed, assuming CLEAR`);
    return "CLEAR";
  }

  // Parse blocker verdict from output
  const match = result.output.match(/BLOCKER_VERDICT:\s*(CLEAR|BLOCKED)/i);
  if (match) {
    return match[1]!.toUpperCase() as BlockerVerdict;
  }

  return "CLEAR";
}
