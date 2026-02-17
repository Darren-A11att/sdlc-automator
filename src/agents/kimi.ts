// =============================================================================
// agents/kimi.ts - Kimi Agent SDK wrapper
//
// Replaces: invoke_kimi() from cli-wrapper.sh
// Uses: createSession() from @moonshot-ai/kimi-agent-sdk
// =============================================================================

import fs from "node:fs";
import path from "node:path";
import { createSession, collectText } from "@moonshot-ai/kimi-agent-sdk";
import type { StreamEvent } from "@moonshot-ai/kimi-agent-sdk";
import { formatKimiSdkEvent } from "../stream/formatter.js";
import type { AgentResult } from "../types.js";
import type { AgentOptions } from "./types.js";

/**
 * Invoke Kimi Agent SDK to run an agent with the given options.
 *
 * Replaces the bash `invoke_kimi` function which called `kimi --print -p`.
 * Uses the Kimi Agent SDK's createSession() + session.prompt() API.
 *
 * System and user prompts are combined with delimiters since the Kimi SDK
 * has no separate system prompt support.
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

  // Combine system prompt + user prompt (Kimi SDK has no separate system prompt)
  const combinedPrompt = `=== SYSTEM INSTRUCTIONS ===\n\n${systemPrompt}\n\n=== TASK ===\n\n${userPrompt}`;

  const rawLogLines: string[] = [];
  const allEvents: StreamEvent[] = [];
  let resultText = "";

  const session = createSession({
    workDir: cwd,
    thinking: true,
    yoloMode: true,
  });

  try {
    const turn = session.prompt(combinedPrompt);

    for await (const event of turn) {
      rawLogLines.push(JSON.stringify(event));
      allEvents.push(event);

      if (verbose) {
        formatKimiSdkEvent(event);
      }

      // Accumulate text from ContentPart events
      if ("payload" in event && event.type === "ContentPart") {
        const payload = event.payload as { type: string; text?: string; think?: string };
        if (payload.type === "text" && payload.text) {
          resultText += payload.text;
        }
      }
    }

    // If no text was accumulated from ContentPart events, use collectText helper
    if (!resultText) {
      resultText = collectText(allEvents);
    }

    // Write raw log
    fs.writeFileSync(logFile, rawLogLines.join("\n"), "utf-8");

    if (!resultText) {
      return {
        success: false,
        output: "",
      };
    }

    return {
      success: true,
      output: resultText,
    };
  } catch (err) {
    // Write whatever we have to the log
    fs.writeFileSync(logFile, rawLogLines.join("\n"), "utf-8");

    const errorMsg = err instanceof Error ? err.message : String(err);
    return {
      success: false,
      output: errorMsg,
    };
  } finally {
    await session.close();
  }
}
