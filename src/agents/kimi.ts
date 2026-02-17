// =============================================================================
// agents/kimi.ts - Kimi Agent SDK wrapper (placeholder)
//
// Replaces: invoke_kimi() from cli-wrapper.sh
//
// NOTE: The Kimi Agent SDK (@moonshot-ai/kimi-agent-sdk) is referenced in the
// plan but may not yet be published. This module provides a compatible wrapper
// that falls back to the kimi CLI if the SDK is not available.
// =============================================================================

import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import { formatKimiEvent } from "../stream/formatter.js";
import type { AgentResult } from "../types.js";
import type { AgentOptions } from "./types.js";

/**
 * Invoke Kimi CLI to run an agent with the given options.
 *
 * Replaces the bash `invoke_kimi` function. Uses the kimi CLI directly
 * since the Kimi Agent SDK may not be available as an npm package.
 *
 * System and user prompts are combined with delimiters since kimi has
 * no --append-system-prompt support.
 */
export async function invokeKimiAgent(options: AgentOptions): Promise<AgentResult> {
  const {
    systemPrompt,
    userPrompt,
    logFile,
    cwd,
    verbose,
  } = options;

  // Ensure log directory exists
  const logDir = path.dirname(logFile);
  fs.mkdirSync(logDir, { recursive: true });

  // Combine system prompt + user prompt (kimi has no --append-system-prompt)
  const combinedPrompt = `=== SYSTEM INSTRUCTIONS ===\n\n${systemPrompt}\n\n=== TASK ===\n\n${userPrompt}`;

  try {
    let output: string;

    if (verbose) {
      // Verbose mode: stream-json, no --final-message-only
      output = execSync(
        `kimi --print -p ${escapeShellArg(combinedPrompt)} --output-format=stream-json`,
        { cwd, encoding: "utf-8", maxBuffer: 50 * 1024 * 1024 },
      );

      // Parse and format each JSONL line for display
      for (const line of output.split("\n")) {
        if (!line.trim()) continue;
        try {
          const event = JSON.parse(line);
          formatKimiEvent(event);
        } catch {
          // Skip non-JSON lines
        }
      }
    } else {
      // Normal mode: final message only
      output = execSync(
        `kimi --print -p ${escapeShellArg(combinedPrompt)} --output-format=stream-json --final-message-only`,
        { cwd, encoding: "utf-8", maxBuffer: 50 * 1024 * 1024 },
      );
    }

    // Write raw output to log
    fs.writeFileSync(logFile, output, "utf-8");

    // Parse JSONL - extract content from last assistant message
    let resultText = "";
    for (const line of output.split("\n")) {
      if (!line.trim()) continue;
      try {
        const parsed = JSON.parse(line);
        if (parsed.role === "assistant" && parsed.content) {
          resultText = typeof parsed.content === "string"
            ? parsed.content
            : JSON.stringify(parsed.content);
        }
      } catch {
        // Skip non-JSON lines
      }
    }

    // Fallback: use raw output if no assistant message found
    if (!resultText) {
      resultText = output;
    }

    return {
      success: true,
      output: resultText,
    };
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    fs.writeFileSync(logFile, errorMsg, "utf-8");

    return {
      success: false,
      output: errorMsg,
    };
  }
}

/** Escape a string for safe shell argument usage */
function escapeShellArg(arg: string): string {
  return `'${arg.replace(/'/g, "'\\''")}'`;
}
