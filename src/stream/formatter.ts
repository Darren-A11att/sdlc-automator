import type { StreamEvent } from "@moonshot-ai/kimi-agent-sdk";

// Local type aliases for Kimi SDK event payloads.
// The SDK's Zod-inferred types don't resolve cleanly under zod 4.x,
// so we define the shapes we need directly.
interface KimiContentPart {
  type: string;
  text?: string;
  think?: string;
}

interface KimiToolCallPayload {
  type: "function";
  id: string;
  function: { name: string; arguments?: string | null };
}

interface KimiToolResultPayload {
  tool_call_id: string;
  return_value: {
    is_error: boolean;
    output: string | KimiContentPart[];
    message: string;
  };
}

interface KimiApprovalPayload {
  id: string;
  description: string;
}

// Color support
const isTTY = process.stderr.isTTY ?? false;
const dim = isTTY ? "\x1b[2m" : "";
const cyan = isTTY ? "\x1b[36m" : "";
const yellow = isTTY ? "\x1b[33m" : "";
const green = isTTY ? "\x1b[32m" : "";
const red = isTTY ? "\x1b[31m" : "";
const blue = isTTY ? "\x1b[34m" : "";
const reset = isTTY ? "\x1b[0m" : "";

function truncate(str: string, max = 120): string {
  const clean = str.replace(/\n/g, " ").replace(/\r/g, " ");
  return clean.length > max ? clean.slice(0, max) + "..." : clean;
}

function formatToolUse(block: any): void {
  const name: string = block.name ?? "unknown";
  let argSummary = "";

  switch (name) {
    case "Read":
      argSummary = block.input?.file_path ?? "";
      break;
    case "Bash":
      argSummary = block.input?.description && block.input.description.length > 0
        ? block.input.description
        : (block.input?.command ?? "").slice(0, 80);
      break;
    case "Edit":
    case "Write":
      argSummary = block.input?.file_path ?? "";
      break;
    case "Glob":
      argSummary = block.input?.pattern ?? "";
      break;
    case "Grep": {
      const pattern = block.input?.pattern ?? "";
      const path = block.input?.path ?? "";
      argSummary = path ? `${pattern} in ${path}` : pattern;
      break;
    }
    default:
      argSummary = block.input ? Object.keys(block.input).slice(0, 3).join(", ") : "";
      break;
  }

  process.stderr.write(`  ${yellow}[TOOL]${reset}  ${name} → ${truncate(argSummary, 100)}\n`);
}

function formatToolResult(block: any): void {
  const content: string = block.content ?? "";
  const isError: boolean = block.is_error === true;

  if (isError) {
    process.stderr.write(`  ${red}[RSLT]${reset}  ERROR ${truncate(content, 100)}\n`);
  } else if (/exit code [1-9]|error:|fatal:/i.test(content)) {
    process.stderr.write(`  ${red}[RSLT]${reset}  ERROR ${truncate(content, 100)}\n`);
  } else if (content.length > 200) {
    const lineCount = content.split("\n").length;
    process.stderr.write(`  ${green}[RSLT]${reset}  ${lineCount} lines (ok)\n`);
  } else {
    const summary = truncate(content, 100);
    process.stderr.write(`  ${green}[RSLT]${reset}  ${summary || "(ok)"}\n`);
  }
}

/**
 * Format a Claude Agent SDK message for terminal display.
 * Writes formatted output to stderr.
 */
export function formatAgentEvent(message: any): void {
  switch (message.type) {
    case "system":
      // Skip system messages
      break;

    case "assistant": {
      const content = message.message?.content;
      if (!Array.isArray(content)) break;
      for (const block of content) {
        switch (block.type) {
          case "thinking": {
            const text = truncate(block.thinking ?? "", 100);
            process.stderr.write(`  ${dim}[THINK]${reset} ${text}\n`);
            break;
          }
          case "text": {
            const text = truncate(block.text ?? "", 120);
            process.stderr.write(`  ${cyan}[TEXT]${reset}  ${text}\n`);
            break;
          }
          case "tool_use":
            formatToolUse(block);
            break;
        }
      }
      break;
    }

    case "user": {
      const content = message.message?.content;
      if (!Array.isArray(content)) break;
      for (const block of content) {
        if (block.type === "tool_result") {
          formatToolResult(block);
        }
      }
      break;
    }

    case "result": {
      const turns = message.num_turns ?? "?";
      const durationMs = message.duration_ms ?? 0;
      const cost = message.total_cost_usd ?? 0;
      const durationS = durationMs > 0 ? (durationMs / 1000).toFixed(1) : "?";
      process.stderr.write(`  ${blue}[DONE]${reset}  ${turns} turns, ${durationS}s, $${cost}\n`);
      break;
    }
  }
}

/** Kimi tool name → display name mapping */
const KIMI_TOOL_DISPLAY_NAMES: Record<string, string> = {
  ReadFile: "Read",
  ReadFiles: "Read",
  StrReplaceFile: "Edit",
  WriteFile: "Write",
  RunCommand: "Bash",
  SearchText: "Grep",
  GrepTool: "Grep",
  ListDirectory: "LS",
  SetTodoList: "Todo",
};

function formatKimiToolCall(tc: KimiToolCallPayload): void {
  const name = tc.function?.name ?? "unknown";
  const displayName = KIMI_TOOL_DISPLAY_NAMES[name] ?? name;
  const argsStr = tc.function?.arguments ?? "{}";
  let argSummary = "";
  try {
    const args = JSON.parse(argsStr);
    switch (name) {
      case "ReadFile":
      case "ReadFiles":
        argSummary = args.file_path ?? args.paths?.[0] ?? "";
        break;
      case "StrReplaceFile":
      case "WriteFile":
        argSummary = args.file_path ?? "";
        break;
      case "RunCommand":
        argSummary = args.command ?? "";
        break;
      case "SetTodoList":
        argSummary = `${args.items?.length ?? "?"} items`;
        break;
      case "SearchText":
      case "GrepTool":
        argSummary = args.pattern ?? args.query ?? "";
        break;
      case "ListDirectory":
        argSummary = args.path ?? "";
        break;
      default:
        argSummary = Object.keys(args)[0] ?? "";
        break;
    }
  } catch {
    // leave argSummary empty
  }
  process.stderr.write(`  ${yellow}[TOOL]${reset}  ${displayName} → ${truncate(argSummary, 100)}\n`);
}

function formatKimiToolResult(tr: KimiToolResultPayload): void {
  const rv = tr.return_value;
  const content = typeof rv.output === "string"
    ? rv.output
    : rv.output.filter((p) => p.type === "text").map((p) => p.text ?? "").join("");

  if (rv.is_error) {
    process.stderr.write(`  ${red}[RSLT]${reset}  ERROR ${truncate(content, 100)}\n`);
  } else if (/exit code [1-9]|error:|fatal:/i.test(content)) {
    process.stderr.write(`  ${red}[RSLT]${reset}  ERROR ${truncate(content, 100)}\n`);
  } else if (content.length > 200) {
    const lineCount = content.split("\n").length;
    process.stderr.write(`  ${green}[RSLT]${reset}  ${lineCount} lines (ok)\n`);
  } else {
    process.stderr.write(`  ${green}[RSLT]${reset}  ${truncate(content, 100) || "(ok)"}\n`);
  }
}

/**
 * Format a Kimi Agent SDK stream event for terminal display.
 * Writes formatted output to stderr.
 *
 * Handles the typed StreamEvent union from @moonshot-ai/kimi-agent-sdk:
 * - ContentPart (text/think)
 * - ToolCall
 * - ToolResult
 * - ApprovalRequest (shouldn't occur with yoloMode)
 * - TurnBegin, StepBegin, StatusUpdate, etc. (skipped)
 */
export function formatKimiSdkEvent(event: StreamEvent): void {
  // ParseError events have type: "error" and no payload — skip them
  if (!("payload" in event)) return;

  // The event has a payload — cast through a helper to get typed access
  // since StreamEvent's discriminated union doesn't narrow `payload` cleanly
  const e = event as { type: string; payload: unknown };

  switch (e.type) {
    case "ContentPart": {
      const payload = e.payload as KimiContentPart;
      if (payload.type === "think" && payload.think) {
        process.stderr.write(`  ${dim}[THINK]${reset} ${truncate(payload.think, 100)}\n`);
      } else if (payload.type === "text" && payload.text) {
        process.stderr.write(`  ${cyan}[TEXT]${reset}  ${truncate(payload.text, 120)}\n`);
      }
      break;
    }

    case "ToolCall":
      formatKimiToolCall(e.payload as KimiToolCallPayload);
      break;

    case "ToolResult":
      formatKimiToolResult(e.payload as KimiToolResultPayload);
      break;

    case "ApprovalRequest":
      process.stderr.write(`  ${yellow}[APRV]${reset}  ${truncate((e.payload as KimiApprovalPayload).description, 100)}\n`);
      break;

    default:
      // Skip lifecycle events: TurnBegin, TurnEnd, StepBegin, StatusUpdate, etc.
      break;
  }
}
