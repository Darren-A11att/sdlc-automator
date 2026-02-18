// =============================================================================
// agents/claude.ts - Claude Agent SDK wrapper
//
// Replaces: invoke_claude() from cli-wrapper.sh
// Uses: query() from @anthropic-ai/claude-agent-sdk
// =============================================================================

import fs from "node:fs";
import path from "node:path";
import { query } from "@anthropic-ai/claude-agent-sdk";
import { formatAgentEvent } from "../stream/formatter.js";
import type { AgentResult } from "../types.js";
import type { AgentOptions } from "./types.js";

/**
 * Invoke Claude Agent SDK to run an agent with the given options.
 *
 * Replaces the bash `invoke_claude` function which called `claude -p`.
 */
export async function invokeClaudeAgent(options: AgentOptions): Promise<AgentResult> {
  const {
    model,
    maxTurns,
    systemPrompt,
    userPrompt,
    logFile,
    cwd,
    verbose,
    allowedTools,
    mcpServers,
  } = options;

  // Ensure log directory exists
  const logDir = path.dirname(logFile);
  fs.mkdirSync(logDir, { recursive: true });

  let resultText = "";
  let costUsd = 0;
  let numTurns = 0;
  let durationMs = 0;
  const rawLogLines: string[] = [];

  try {
    const q = query({
      prompt: userPrompt,
      options: {
        model,
        maxTurns,
        allowedTools,
        systemPrompt: {
          type: "preset",
          preset: "claude_code",
          append: systemPrompt,
        },
        permissionMode: "bypassPermissions",
        allowDangerouslySkipPermissions: true,
        cwd,
        ...(mcpServers ? { mcpServers } : {}),
      },
    });

    for await (const message of q) {
      // Log raw message
      rawLogLines.push(JSON.stringify(message));

      // Verbose: format for terminal display
      if (verbose) {
        formatAgentEvent(message);
      }

      // Extract result from the final result message
      if (message.type === "result") {
        if (message.subtype === "success") {
          resultText = message.result;
        }
        costUsd = message.total_cost_usd ?? 0;
        numTurns = message.num_turns ?? 0;
        durationMs = message.duration_ms ?? 0;
      }
    }

    // Write raw log
    fs.writeFileSync(logFile, rawLogLines.join("\n"), "utf-8");

    if (!resultText) {
      return {
        success: false,
        output: "",
        costUsd,
        numTurns,
        durationMs,
      };
    }

    return {
      success: true,
      output: resultText,
      costUsd,
      numTurns,
      durationMs,
    };
  } catch (err) {
    // Write whatever we have to the log
    fs.writeFileSync(logFile, rawLogLines.join("\n"), "utf-8");

    const errorMsg = err instanceof Error ? err.message : String(err);
    return {
      success: false,
      output: errorMsg,
      costUsd,
      numTurns,
      durationMs,
    };
  }
}
