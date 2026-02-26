// =============================================================================
// runners/project-discovery.ts - AI-powered project configuration discovery
// =============================================================================

import path from "node:path";
import { MODEL_OPUS, MAX_TURNS_PROJECT_DISCOVERY, ALLOWED_TOOLS_READONLY } from "../config.js";
import { invokeClaudeAgent } from "../agents/index.js";
import { buildProjectDiscoverySystemPrompt, buildProjectDiscoveryUserPrompt } from "../prompts/project-discovery.js";
import { parseProjectConfig } from "../parsers/project-config.js";

export interface DiscoveryResult {
  success: boolean;
  config: Record<string, unknown> | null;
  error?: string;
  costUsd: number;
  durationMs: number;
}

/**
 * Run the project discovery agent to auto-discover project configuration.
 *
 * @param projectDir - The user's project directory to explore
 * @param verbose - Whether to stream agent output
 * @returns Discovery result with parsed config or error
 */
export async function runProjectDiscovery(
  projectDir: string,
  verbose: boolean,
): Promise<DiscoveryResult> {
  const systemPrompt = buildProjectDiscoverySystemPrompt();
  const userPrompt = buildProjectDiscoveryUserPrompt(projectDir);
  const logFile = path.join(projectDir, "logs", "project-discovery.log");

  try {
    const result = await invokeClaudeAgent({
      model: MODEL_OPUS,
      maxTurns: MAX_TURNS_PROJECT_DISCOVERY,
      systemPrompt,
      userPrompt,
      logFile,
      cwd: projectDir,
      verbose,
      allowedTools: ALLOWED_TOOLS_READONLY,
    });

    if (!result.success) {
      return {
        success: false,
        config: null,
        error: `Agent failed: ${result.output.slice(0, 200)}`,
        costUsd: result.costUsd ?? 0,
        durationMs: result.durationMs ?? 0,
      };
    }

    const config = parseProjectConfig(result.output);
    if (!config) {
      return {
        success: false,
        config: null,
        error: "Failed to parse project config from agent output",
        costUsd: result.costUsd ?? 0,
        durationMs: result.durationMs ?? 0,
      };
    }

    return {
      success: true,
      config,
      costUsd: result.costUsd ?? 0,
      durationMs: result.durationMs ?? 0,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      success: false,
      config: null,
      error: msg,
      costUsd: 0,
      durationMs: 0,
    };
  }
}
