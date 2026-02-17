#!/usr/bin/env bash
# format-stream.sh - Formats JSONL agent output as readable single-line summaries
#
# Replaces `tee /dev/stderr` in cli-wrapper.sh. Reads JSONL from stdin,
# passes raw lines to stdout (for variable capture), and writes formatted
# single-line summaries to stderr (for terminal display).

# --- Color support ---
_FS_COLOR_ENABLED=false
if [[ -t 2 ]] && [[ -z "${NO_COLOR:-}" ]]; then
  _FS_COLOR_ENABLED=true
fi

_fs_dim=""
_fs_cyan=""
_fs_yellow=""
_fs_green=""
_fs_red=""
_fs_blue=""
_fs_reset=""

if [[ "$_FS_COLOR_ENABLED" == "true" ]]; then
  _fs_dim=$'\033[2m'
  _fs_cyan=$'\033[36m'
  _fs_yellow=$'\033[33m'
  _fs_green=$'\033[32m'
  _fs_red=$'\033[31m'
  _fs_blue=$'\033[34m'
  _fs_reset=$'\033[0m'
fi

# --- Helper: truncate string to max length ---
_fs_truncate() {
  local str="$1"
  local max="${2:-120}"
  # Replace newlines with spaces
  str="${str//$'\n'/ }"
  str="${str//$'\r'/ }"
  if [[ ${#str} -gt $max ]]; then
    echo "${str:0:$max}..."
  else
    echo "$str"
  fi
}

# --- Format a tool_use block ---
_format_tool_use() {
  local json="$1"
  local name arg_summary

  name=$(echo "$json" | jq -r '.name // "unknown"')

  case "$name" in
    Read)
      arg_summary=$(echo "$json" | jq -r '.input.file_path // ""')
      ;;
    Bash)
      arg_summary=$(echo "$json" | jq -r 'if .input.description and (.input.description | length > 0) then .input.description else (.input.command // "" | .[0:80]) end')
      ;;
    Edit)
      arg_summary=$(echo "$json" | jq -r '.input.file_path // ""')
      ;;
    Write)
      arg_summary=$(echo "$json" | jq -r '.input.file_path // ""')
      ;;
    Glob)
      arg_summary=$(echo "$json" | jq -r '.input.pattern // ""')
      ;;
    Grep)
      local pattern path
      pattern=$(echo "$json" | jq -r '.input.pattern // ""')
      path=$(echo "$json" | jq -r '.input.path // ""')
      if [[ -n "$path" ]]; then
        arg_summary="${pattern} in ${path}"
      else
        arg_summary="$pattern"
      fi
      ;;
    *)
      arg_summary=$(echo "$json" | jq -r '.input | keys[0:3] | join(", ")' 2>/dev/null || echo "")
      ;;
  esac

  local display
  display=$(_fs_truncate "$arg_summary" 100)
  echo "  ${_fs_yellow}[TOOL]${_fs_reset}  ${name} → ${display}" >&2
}

# --- Format assistant message content blocks ---
_format_assistant_line() {
  local line="$1"

  # Extract content blocks and iterate
  local block_count
  block_count=$(echo "$line" | jq '.message.content | length' 2>/dev/null || echo "0")

  if [[ "$block_count" -eq 0 ]]; then
    return
  fi

  local i=0
  while [[ $i -lt $block_count ]]; do
    local block_type
    block_type=$(echo "$line" | jq -r ".message.content[$i].type // \"\"")

    case "$block_type" in
      thinking)
        local text
        text=$(echo "$line" | jq -r ".message.content[$i].thinking // \"\"")
        text=$(_fs_truncate "$text" 100)
        echo "  ${_fs_dim}[THINK]${_fs_reset} ${text}" >&2
        ;;
      text)
        local text
        text=$(echo "$line" | jq -r ".message.content[$i].text // \"\"")
        text=$(_fs_truncate "$text" 120)
        echo "  ${_fs_cyan}[TEXT]${_fs_reset}  ${text}" >&2
        ;;
      tool_use)
        local block_json
        block_json=$(echo "$line" | jq -c ".message.content[$i]")
        _format_tool_use "$block_json"
        ;;
    esac

    i=$((i + 1))
  done
}

# --- Format tool result from user message ---
_format_tool_result_line() {
  local line="$1"

  local block_count
  block_count=$(echo "$line" | jq '.message.content | length' 2>/dev/null || echo "0")

  if [[ "$block_count" -eq 0 ]]; then
    return
  fi

  local i=0
  while [[ $i -lt $block_count ]]; do
    local block_type
    block_type=$(echo "$line" | jq -r ".message.content[$i].type // \"\"")

    if [[ "$block_type" == "tool_result" ]]; then
      local content is_error
      content=$(echo "$line" | jq -r ".message.content[$i].content // \"\"")
      is_error=$(echo "$line" | jq -r ".message.content[$i].is_error // false")

      if [[ "$is_error" == "true" ]]; then
        local err_summary
        err_summary=$(_fs_truncate "$content" 100)
        echo "  ${_fs_red}[RSLT]${_fs_reset}  ERROR ${err_summary}" >&2
      elif echo "$content" | grep -qiE 'exit code [1-9]|error:|fatal:'; then
        local err_summary
        err_summary=$(_fs_truncate "$content" 100)
        echo "  ${_fs_red}[RSLT]${_fs_reset}  ERROR ${err_summary}" >&2
      elif [[ ${#content} -gt 200 ]]; then
        local line_count
        line_count=$(echo "$content" | wc -l | tr -d ' ')
        echo "  ${_fs_green}[RSLT]${_fs_reset}  ${line_count} lines (ok)" >&2
      else
        local summary
        summary=$(_fs_truncate "$content" 100)
        if [[ -z "$summary" ]]; then
          echo "  ${_fs_green}[RSLT]${_fs_reset}  (ok)" >&2
        else
          echo "  ${_fs_green}[RSLT]${_fs_reset}  ${summary}" >&2
        fi
      fi
    fi

    i=$((i + 1))
  done
}

# --- Format result/completion line ---
_format_result_line() {
  local line="$1"

  local turns duration_ms cost
  turns=$(echo "$line" | jq -r '.num_turns // "?"')
  duration_ms=$(echo "$line" | jq -r '.duration_ms // 0')
  cost=$(echo "$line" | jq -r '.total_cost_usd // 0')

  # Convert ms to seconds with 1 decimal
  local duration_s
  if [[ "$duration_ms" != "0" && "$duration_ms" != "null" ]]; then
    duration_s=$(awk "BEGIN { printf \"%.1f\", $duration_ms / 1000 }")
  else
    duration_s="?"
  fi

  echo "  ${_fs_blue}[DONE]${_fs_reset}  ${turns} turns, ${duration_s}s, \$${cost}" >&2
}

# =============================================================================
# format_stream_claude - Main filter for Claude CLI stream-json output
#
# Reads JSONL from stdin. Passes raw lines to stdout (for $output capture).
# Writes formatted summaries to stderr (for terminal display).
# =============================================================================
format_stream_claude() {
  while IFS= read -r line; do
    # Always pass raw line to stdout for variable capture
    printf '%s\n' "$line"

    # Fast skip: system/hook lines (no jq needed)
    if [[ "$line" == *'"type":"system"'* ]]; then
      continue
    fi

    # Route by type
    if [[ "$line" == *'"type":"assistant"'* ]]; then
      _format_assistant_line "$line"
    elif [[ "$line" == *'"type":"user"'* ]]; then
      _format_tool_result_line "$line"
    elif [[ "$line" == *'"type":"result"'* ]]; then
      _format_result_line "$line"
    fi
  done
}

# --- Format a Kimi tool_call entry ---
_format_kimi_tool_call() {
  local tc_json="$1"
  local name args_str arg_summary

  name=$(echo "$tc_json" | jq -r '.function.name // "unknown"')
  args_str=$(echo "$tc_json" | jq -r '.function.arguments // "{}"')

  case "$name" in
    ReadFile|ReadFiles)
      arg_summary=$(echo "$args_str" | jq -r '.file_path // .paths[0] // ""' 2>/dev/null || echo "")
      echo "  ${_fs_yellow}[TOOL]${_fs_reset}  Read → $(_fs_truncate "$arg_summary" 100)" >&2
      ;;
    StrReplaceFile)
      arg_summary=$(echo "$args_str" | jq -r '.file_path // ""' 2>/dev/null || echo "")
      echo "  ${_fs_yellow}[TOOL]${_fs_reset}  Edit → $(_fs_truncate "$arg_summary" 100)" >&2
      ;;
    WriteFile)
      arg_summary=$(echo "$args_str" | jq -r '.file_path // ""' 2>/dev/null || echo "")
      echo "  ${_fs_yellow}[TOOL]${_fs_reset}  Write → $(_fs_truncate "$arg_summary" 100)" >&2
      ;;
    RunCommand)
      arg_summary=$(echo "$args_str" | jq -r '.command // ""' 2>/dev/null || echo "")
      echo "  ${_fs_yellow}[TOOL]${_fs_reset}  Bash → $(_fs_truncate "$arg_summary" 100)" >&2
      ;;
    SetTodoList)
      local item_count
      item_count=$(echo "$args_str" | jq '.items | length' 2>/dev/null || echo "?")
      echo "  ${_fs_yellow}[TOOL]${_fs_reset}  Todo → ${item_count} items" >&2
      ;;
    SearchText|GrepTool)
      arg_summary=$(echo "$args_str" | jq -r '.pattern // .query // ""' 2>/dev/null || echo "")
      echo "  ${_fs_yellow}[TOOL]${_fs_reset}  Grep → $(_fs_truncate "$arg_summary" 100)" >&2
      ;;
    ListDirectory)
      arg_summary=$(echo "$args_str" | jq -r '.path // ""' 2>/dev/null || echo "")
      echo "  ${_fs_yellow}[TOOL]${_fs_reset}  LS → $(_fs_truncate "$arg_summary" 100)" >&2
      ;;
    *)
      local first_key
      first_key=$(echo "$args_str" | jq -r 'keys[0] // ""' 2>/dev/null || echo "")
      echo "  ${_fs_yellow}[TOOL]${_fs_reset}  ${name} → ${first_key}" >&2
      ;;
  esac
}

# =============================================================================
# format_stream_kimi - Main filter for Kimi CLI stream-json output
#
# Kimi uses top-level .role with array .content and separate .tool_calls.
# Format: {"role":"assistant","content":[{"type":"think","think":"..."}],"tool_calls":[...]}
#         {"role":"tool","content":"result text","tool_call_id":"..."}
# =============================================================================
format_stream_kimi() {
  while IFS= read -r line; do
    # Always pass raw line to stdout
    printf '%s\n' "$line"

    # Skip empty lines
    [[ -z "$line" ]] && continue

    if [[ "$line" == *'"role":"assistant"'* ]]; then
      # --- Process content array (thinking + text blocks) ---
      local content_count
      content_count=$(echo "$line" | jq '.content | if type == "array" then length else 0 end' 2>/dev/null || echo "0")

      local ci=0
      while [[ $ci -lt $content_count ]]; do
        local ctype
        ctype=$(echo "$line" | jq -r ".content[$ci].type // \"\"" 2>/dev/null)

        if [[ "$ctype" == "think" ]]; then
          local think_text
          think_text=$(echo "$line" | jq -r ".content[$ci].think // \"\"" 2>/dev/null)
          think_text=$(_fs_truncate "$think_text" 100)
          echo "  ${_fs_dim}[THINK]${_fs_reset} ${think_text}" >&2
        elif [[ "$ctype" == "text" || -z "$ctype" ]]; then
          local text_content
          text_content=$(echo "$line" | jq -r ".content[$ci].text // .content[$ci] // \"\"" 2>/dev/null)
          if [[ -n "$text_content" && "$text_content" != "null" ]]; then
            text_content=$(_fs_truncate "$text_content" 120)
            echo "  ${_fs_cyan}[TEXT]${_fs_reset}  ${text_content}" >&2
          fi
        fi

        ci=$((ci + 1))
      done

      # --- Handle content as plain string (fallback) ---
      if [[ "$content_count" -eq 0 ]]; then
        local plain_content
        plain_content=$(echo "$line" | jq -r 'if (.content | type) == "string" then .content else "" end' 2>/dev/null || echo "")
        if [[ -n "$plain_content" ]]; then
          plain_content=$(_fs_truncate "$plain_content" 120)
          echo "  ${_fs_cyan}[TEXT]${_fs_reset}  ${plain_content}" >&2
        fi
      fi

      # --- Process tool_calls array ---
      local tc_count
      tc_count=$(echo "$line" | jq '.tool_calls | if type == "array" then length else 0 end' 2>/dev/null || echo "0")

      local ti=0
      while [[ $ti -lt $tc_count ]]; do
        local tc_json
        tc_json=$(echo "$line" | jq -c ".tool_calls[$ti]" 2>/dev/null)
        _format_kimi_tool_call "$tc_json"
        ti=$((ti + 1))
      done

    elif [[ "$line" == *'"role":"tool"'* ]]; then
      # --- Tool result line ---
      local content
      content=$(echo "$line" | jq -r '.content // ""' 2>/dev/null)

      if echo "$content" | grep -qiE 'error:|fatal:|exit code [1-9]'; then
        local err_summary
        err_summary=$(_fs_truncate "$content" 100)
        echo "  ${_fs_red}[RSLT]${_fs_reset}  ERROR ${err_summary}" >&2
      elif [[ ${#content} -gt 200 ]]; then
        local line_count
        line_count=$(echo "$content" | wc -l | tr -d ' ')
        echo "  ${_fs_green}[RSLT]${_fs_reset}  ${line_count} lines (ok)" >&2
      else
        local summary
        summary=$(_fs_truncate "$content" 100)
        echo "  ${_fs_green}[RSLT]${_fs_reset}  ${summary:-"(ok)"}" >&2
      fi
    fi
  done
}
