#!/usr/bin/env bash
# cli-wrapper.sh - CLI invocation and output parsing (Claude + Kimi)

# invoke_agent - Dispatcher that routes to the appropriate CLI backend
# Uses the global CLI_PROVIDER variable (default: "claude")
# Arguments are the same as invoke_claude / invoke_kimi
invoke_agent() {
  case "${CLI_PROVIDER:-claude}" in
    claude)
      invoke_claude "$@"
      ;;
    kimi)
      invoke_kimi "$@"
      ;;
    *)
      log "ERROR" "Unknown CLI provider: $CLI_PROVIDER"
      return 1
      ;;
  esac
}

# invoke_claude - Core wrapper for calling `claude -p`
# Arguments (positional):
#   $1: model (e.g., "claude-sonnet-4-5-20250929" or "claude-opus-4-6")
#   $2: max_turns (integer)
#   $3: system_prompt (string - the system prompt to append)
#   $4: user_prompt (string - the actual prompt/task)
#   $5: log_file (path to save full output)
#   $6: mcp_config (optional, path to MCP JSON config file)
# Returns:
#   0 on success, 1 on failure
# Output:
#   Extracted text content from "result" field to stdout
invoke_claude() {
  local model="$1"
  local max_turns="$2"
  local system_prompt="$3"
  local user_prompt="$4"
  local log_file="$5"
  local mcp_config="${6:-}"

  log "DEBUG" "Invoking Claude CLI: model=$model, max_turns=$max_turns, log_file=$log_file, verbose=$VERBOSE${mcp_config:+, mcp_config=$mcp_config}"

  # Build optional MCP args
  local mcp_args=()
  if [[ -n "$mcp_config" && -f "$mcp_config" ]]; then
    mcp_args=(--mcp-config "$mcp_config")
  fi

  local output
  local result

  if [[ "$VERBOSE" == "true" ]]; then
    # stream-json outputs real-time JSONL; tee copies to stderr for display
    output=$(claude -p "$user_prompt" \
      --model "$model" \
      --output-format stream-json \
      --max-turns "$max_turns" \
      --allowedTools "$ALLOWED_TOOLS" \
      --append-system-prompt "$system_prompt" \
      --dangerously-skip-permissions \
      "${mcp_args[@]}" \
      2>&1 | format_stream_claude)

    echo "$output" > "$log_file"

    # Extract result from the JSONL "result" type line
    result=$(echo "$output" | jq -r 'select(.type == "result") | .result' 2>/dev/null | tail -1)

    if [[ -z "$result" || "$result" == "null" ]]; then
      # Fallback: try extracting last assistant content
      result=$(echo "$output" | jq -r 'select(.message.role == "assistant") | .message.content[-1].text' 2>/dev/null | tail -1)
    fi
  else
    # Normal: json format, silent capture
    output=$(claude -p "$user_prompt" \
      --model "$model" \
      --output-format json \
      --max-turns "$max_turns" \
      --allowedTools "$ALLOWED_TOOLS" \
      --append-system-prompt "$system_prompt" \
      --dangerously-skip-permissions \
      "${mcp_args[@]}" \
      2>&1)

    echo "$output" > "$log_file"

    if ! echo "$output" | jq -e . > /dev/null 2>&1; then
      log "ERROR" "Claude CLI returned invalid JSON. First 500 chars: ${output:0:500}"
      return 1
    fi

    result=$(echo "$output" | jq -r '.result')
  fi

  if [[ -z "$result" || "$result" == "null" ]]; then
    log "ERROR" "Could not extract 'result' field from Claude response"
    return 1
  fi

  # Echo extracted text content to stdout
  echo "$result"
  return 0
}

# invoke_kimi - Core wrapper for calling `kimi --print -p`
# Arguments (positional):
#   $1: model (ignored - configured in ~/.kimi/config.toml)
#   $2: max_turns (ignored - configured in kimi config loop_control.max_steps_per_turn)
#   $3: system_prompt (string - prepended to user prompt since kimi has no --append-system-prompt)
#   $4: user_prompt (string - the actual prompt/task)
#   $5: log_file (path to save full output)
# Returns:
#   0 on success, 1 on failure
# Output:
#   Extracted text content to stdout
invoke_kimi() {
  local model="$1"
  local max_turns="$2"
  local system_prompt="$3"
  local user_prompt="$4"
  local log_file="$5"

  # Combine system prompt + user prompt since kimi has no --append-system-prompt
  local combined_prompt
  combined_prompt=$(printf '=== SYSTEM INSTRUCTIONS ===\n\n%s\n\n=== TASK ===\n\n%s' "$system_prompt" "$user_prompt")

  log "DEBUG" "Invoking Kimi CLI: log_file=$log_file, verbose=$VERBOSE (model/max_turns configured in ~/.kimi/config.toml)"

  local output
  if [[ "$VERBOSE" == "true" ]]; then
    # Verbose: drop --final-message-only to see all messages, tee to stderr
    output=$(kimi --print -p "$combined_prompt" \
      --output-format=stream-json \
      2>&1 | format_stream_kimi)
  else
    # Normal: final message only, silent capture
    output=$(kimi --print -p "$combined_prompt" \
      --output-format=stream-json \
      --final-message-only \
      2>&1)
  fi

  # Write raw output to log file
  echo "$output" > "$log_file"

  # Parse JSONL output - extract content from last assistant message
  local result
  result=$(echo "$output" | jq -r 'select(.role == "assistant") | .content' 2>/dev/null | tail -1)

  if [[ -z "$result" || "$result" == "null" ]]; then
    # Fallback: try treating output as plain text (in case format differs)
    result="$output"
    if [[ -z "$result" ]]; then
      log "ERROR" "Kimi CLI returned empty output. First 500 chars: ${output:0:500}"
      return 1
    fi
  fi

  echo "$result"
  return 0
}

# parse_verdict - Extract VERDICT from agent output
# Arguments:
#   $1: agent text output (optional, uses stdin if not provided)
# Returns:
#   "PASS", "FAIL", or "UNKNOWN"
parse_verdict() {
  local input
  if [[ -n "${1:-}" ]]; then
    input="$1"
  else
    input=$(cat)
  fi

  local verdict
  # Use -oE for macOS compatibility (no -P flag available)
  verdict=$(echo "$input" | grep -ioE 'VERDICT:[[:space:]]*(PASS|FAIL)' | head -1 | grep -ioE '(PASS|FAIL)' || echo "")

  if [[ -z "$verdict" ]]; then
    echo "UNKNOWN"
  else
    # Convert to uppercase using tr for portability
    echo "$verdict" | tr '[:lower:]' '[:upper:]'
  fi
}

# parse_notes - Extract content between NOTES_START and NOTES_END markers
# Arguments:
#   $1: agent text output
# Returns:
#   Extracted notes text, or empty string if markers not found
parse_notes() {
  local input="$1"

  # Use sed to extract content between markers
  local notes
  notes=$(echo "$input" | sed -n '/NOTES_START/,/NOTES_END/{//!p;}')

  echo "$notes"
}

# parse_criteria_results - Extract JSON between CRITERIA_JSON_START and CRITERIA_JSON_END markers
# Arguments:
#   $1: agent text output
# Returns:
#   JSON string, or empty string if not found/invalid
parse_criteria_results() {
  local input="$1"

  # Use sed to extract content between markers
  local json
  json=$(echo "$input" | sed -n '/CRITERIA_JSON_START/,/CRITERIA_JSON_END/{//!p;}')

  if [[ -z "$json" ]]; then
    echo ""
    return 0
  fi

  # Validate JSON
  if ! echo "$json" | jq -e . > /dev/null 2>&1; then
    log "DEBUG" "Extracted criteria JSON is invalid"
    echo ""
    return 0
  fi

  # Return validated JSON
  echo "$json"
}
