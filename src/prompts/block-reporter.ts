// =============================================================================
// prompts/block-reporter.ts - Block reporter agent prompt builders
// Ports build_block_reporter_system_prompt() and build_block_reporter_user_prompt()
// from bash prompts.sh
// =============================================================================

import type { ProjectConfig, Task } from "../types.js";
import { buildCommonContext } from "./common.js";

export function buildBlockReporterSystemPrompt(
  config: ProjectConfig,
  backlogFile: string,
): string {
  const commonContext = buildCommonContext(config, backlogFile);
  return `You are generating a blocked tasks report for ${config.projectName}.

${commonContext}

Instructions:
- Analyze all blocked tasks and their notes
- Group them by common blocking themes
- Identify root causes and suggest resolution strategies
- Write a clear markdown report`;
}

export function buildBlockReporterUserPrompt(
  blockedTasks: Task[],
  outputPath: string,
): string {
  return `Generate a blocked tasks report. Write it to: ${outputPath}

Blocked Tasks:
${JSON.stringify(blockedTasks, null, 2)}

Create a markdown report with:
1. Executive summary (total blocked, categories)
2. Blocked tasks grouped by theme/root cause
3. Each task: ID, name, notes, attempt count
4. Recommended resolution strategy for each group
5. Suggested order to unblock tasks`;
}
