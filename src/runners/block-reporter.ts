import fs from "node:fs";
import path from "node:path";
import { MODEL_OPUS, MAX_TURNS_REPORTER, ALLOWED_TOOLS } from "../config.js";
import { invokeClaudeAgent } from "../agents/index.js";
import { buildBlockReporterSystemPrompt, buildBlockReporterUserPrompt } from "../prompts/block-reporter.js";
import type { Task, ProjectConfig } from "../types.js";
import type Logger from "../logging/logger.js";

/**
 * Run the Block Reporter agent (Opus). Always uses Claude.
 * Generates a markdown report of blocked tasks.
 */
export async function runBlockReporter(
  blockedTasks: Task[],
  config: ProjectConfig,
  backlogFile: string,
  logger: Logger,
  logsDir: string,
  reportsDir: string,
  verbose: boolean,
): Promise<void> {
  logger.log("INFO", "Generating blocked tasks report...");

  fs.mkdirSync(reportsDir, { recursive: true });

  const now = new Date();
  const dateStr = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}${String(now.getDate()).padStart(2, "0")}`;
  const reportPath = path.join(reportsDir, `blocked-report-${dateStr}.md`);

  const sysPrompt = buildBlockReporterSystemPrompt(config, backlogFile);
  const userPrompt = buildBlockReporterUserPrompt(blockedTasks, reportPath);

  await invokeClaudeAgent({
    model: MODEL_OPUS,
    maxTurns: MAX_TURNS_REPORTER,
    systemPrompt: sysPrompt,
    userPrompt,
    logFile: path.join(logsDir, "block-report.log"),
    cwd: config.projectDir,
    verbose,
    allowedTools: ALLOWED_TOOLS,
  });

  if (fs.existsSync(reportPath)) {
    logger.log("INFO", `Blocked tasks report written to: ${reportPath}`);
  } else {
    logger.log("WARN", `Block reporter did not create report file at: ${reportPath}`);
  }
}
