import type { AgentResult } from "../types.js";

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

/**
 * Format a Kimi SDK event for terminal display.
 * Writes formatted output to stderr.
 *
 * Kimi events have a different shape - this handles:
 * - role: "assistant" with content array (think/text blocks) and tool_calls array
 * - role: "tool" with content string (tool results)
 */
export function formatKimiEvent(event: any): void {
  if (event.role === "assistant") {
    // Process content array
    if (Array.isArray(event.content)) {
      for (const block of event.content) {
        if (block.type === "think") {
          const text = truncate(block.think ?? "", 100);
          process.stderr.write(`  ${dim}[THINK]${reset} ${text}\n`);
        } else if (block.type === "text" || !block.type) {
          const text = truncate(block.text ?? String(block) ?? "", 120);
          if (text) {
            process.stderr.write(`  ${cyan}[TEXT]${reset}  ${text}\n`);
          }
        }
      }
    } else if (typeof event.content === "string" && event.content) {
      process.stderr.write(`  ${cyan}[TEXT]${reset}  ${truncate(event.content, 120)}\n`);
    }

    // Process tool_calls
    if (Array.isArray(event.tool_calls)) {
      for (const tc of event.tool_calls) {
        const name = tc.function?.name ?? "unknown";
        const argsStr = tc.function?.arguments ?? "{}";
        let argSummary = "";
        try {
          const args = JSON.parse(argsStr);
          switch (name) {
            case "ReadFile":
            case "ReadFiles":
              argSummary = args.file_path ?? args.paths?.[0] ?? "";
              process.stderr.write(`  ${yellow}[TOOL]${reset}  Read → ${truncate(argSummary, 100)}\n`);
              break;
            case "StrReplaceFile":
              argSummary = args.file_path ?? "";
              process.stderr.write(`  ${yellow}[TOOL]${reset}  Edit → ${truncate(argSummary, 100)}\n`);
              break;
            case "WriteFile":
              argSummary = args.file_path ?? "";
              process.stderr.write(`  ${yellow}[TOOL]${reset}  Write → ${truncate(argSummary, 100)}\n`);
              break;
            case "RunCommand":
              argSummary = args.command ?? "";
              process.stderr.write(`  ${yellow}[TOOL]${reset}  Bash → ${truncate(argSummary, 100)}\n`);
              break;
            case "SetTodoList":
              process.stderr.write(`  ${yellow}[TOOL]${reset}  Todo → ${args.items?.length ?? "?"} items\n`);
              break;
            case "SearchText":
            case "GrepTool":
              argSummary = args.pattern ?? args.query ?? "";
              process.stderr.write(`  ${yellow}[TOOL]${reset}  Grep → ${truncate(argSummary, 100)}\n`);
              break;
            case "ListDirectory":
              argSummary = args.path ?? "";
              process.stderr.write(`  ${yellow}[TOOL]${reset}  LS → ${truncate(argSummary, 100)}\n`);
              break;
            default:
              process.stderr.write(`  ${yellow}[TOOL]${reset}  ${name} → ${Object.keys(args)[0] ?? ""}\n`);
              break;
          }
        } catch {
          process.stderr.write(`  ${yellow}[TOOL]${reset}  ${name}\n`);
        }
      }
    }
  } else if (event.role === "tool") {
    const content = event.content ?? "";
    if (/error:|fatal:|exit code [1-9]/i.test(content)) {
      process.stderr.write(`  ${red}[RSLT]${reset}  ERROR ${truncate(content, 100)}\n`);
    } else if (content.length > 200) {
      const lineCount = content.split("\n").length;
      process.stderr.write(`  ${green}[RSLT]${reset}  ${lineCount} lines (ok)\n`);
    } else {
      process.stderr.write(`  ${green}[RSLT]${reset}  ${truncate(content, 100) || "(ok)"}\n`);
    }
  }
}
