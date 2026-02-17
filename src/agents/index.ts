// =============================================================================
// agents/index.ts - Agent dispatcher
//
// Replaces: invoke_agent() from cli-wrapper.sh
// Routes to Claude or Kimi based on CLI_PROVIDER setting.
// =============================================================================

import { invokeClaudeAgent } from "./claude.js";
import { invokeKimiAgent } from "./kimi.js";
import type { AgentResult, CliProvider } from "../types.js";
import type { AgentOptions } from "./types.js";

export { invokeClaudeAgent } from "./claude.js";
export { invokeKimiAgent } from "./kimi.js";
export type { AgentOptions } from "./types.js";

/**
 * Dispatch agent invocation to the appropriate backend.
 *
 * Replaces the bash `invoke_agent()` dispatcher which routes
 * based on the CLI_PROVIDER global variable.
 */
export async function invokeAgent(
  provider: CliProvider,
  options: AgentOptions,
): Promise<AgentResult> {
  switch (provider) {
    case "claude":
      return invokeClaudeAgent(options);
    case "kimi":
      return invokeKimiAgent(options);
    default:
      throw new Error(`Unknown CLI provider: ${provider}`);
  }
}
