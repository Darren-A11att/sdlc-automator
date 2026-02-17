#!/usr/bin/env bash
# json-ops.sh - Atomic JSON operations for backlog task management

# CRITICAL: All writes use atomic pattern: write to temp file then mv
# CRITICAL: Always use jq --arg or --argjson for variable interpolation

# update_backlog() - Apply jq filter atomically to BACKLOG_FILE
# Args: All arguments are passed directly to jq (filter + optional --arg/--argjson flags)
# Usage: update_backlog --arg id "$task_id" --arg status "$new_status" '.tasks |= map(...)'
# The LAST positional argument is the jq filter; preceding args are jq flags.
# Returns: exit code (0 = success, non-zero = failure)
update_backlog() {
    local tmp="${BACKLOG_FILE}.tmp.$$"

    if jq "$@" "$BACKLOG_FILE" > "$tmp" 2>/dev/null; then
        mv "$tmp" "$BACKLOG_FILE"
        return 0
    else
        rm -f "$tmp"
        return 1
    fi
}

# get_next_todo_task() - Returns full JSON of first task with status "Todo"
# Returns: JSON object or empty string if none found
get_next_todo_task() {
    jq -r '[.tasks[] | select(.status == "Todo")] | first // empty' "$BACKLOG_FILE"
}

# get_task_by_id() - Returns full task JSON by task ID
# Args: $1 = task_id
# Returns: JSON object or empty string if not found
get_task_by_id() {
    jq --arg id "$1" '.tasks[] | select(.id == $id)' "$BACKLOG_FILE"
}

# validate_task_exists() - Check if task exists
# Args: $1 = task_id
# Returns: 0 if exists, 1 if not (with error log)
validate_task_exists() {
    local task_id="$1"
    local task
    task=$(get_task_by_id "$task_id")

    if [ -z "$task" ]; then
        echo "ERROR: Task ID '$task_id' not found in backlog" >&2
        return 1
    fi
    return 0
}

# update_task_status() - Update task status atomically
# Args: $1 = task_id, $2 = new_status
# Returns: exit code from update_backlog
update_task_status() {
    local task_id="$1"
    local new_status="$2"

    validate_task_exists "$task_id" || return 1

    update_backlog --arg id "$task_id" --arg status "$new_status" \
        '.tasks |= map(if .id == $id then .status = $status else . end)'
}

# increment_attempt_count() - Increment or initialize attempt_count
# Args: $1 = task_id
# Returns: exit code from update_backlog
increment_attempt_count() {
    local task_id="$1"

    validate_task_exists "$task_id" || return 1

    update_backlog --arg id "$task_id" \
        '.tasks |= map(if .id == $id then .attempt_count = (if .attempt_count then .attempt_count + 1 else 1 end) else . end)'
}

# get_attempt_count() - Get attempt count for task
# Args: $1 = task_id
# Returns: numeric attempt count (0 if field doesn't exist)
get_attempt_count() {
    local task_id="$1"
    jq --arg id "$1" '.tasks[] | select(.id == $id) | .attempt_count // 0' "$BACKLOG_FILE"
}

# append_task_notes() - Append timestamped note to task
# Args: $1 = task_id, $2 = note_text
# Returns: exit code from update_backlog
append_task_notes() {
    local task_id="$1"
    local note_text="$2"
    local timestamp
    timestamp=$(date '+%Y-%m-%d %H:%M:%S')

    validate_task_exists "$task_id" || return 1

    update_backlog --arg id "$task_id" --arg timestamp "$timestamp" --arg note "$note_text" \
        '.tasks |= map(if .id == $id then .notes = (.notes // "") + "\n[" + $timestamp + "] " + $note else . end)'
}

# reset_task_to_todo() - Reset task to Todo status with clean state
# Args: $1 = task_id
# Returns: exit code from update_backlog
reset_task_to_todo() {
    local task_id="$1"

    validate_task_exists "$task_id" || return 1

    update_backlog --arg id "$task_id" \
        '.tasks |= map(if .id == $id then .status = "Todo" | .attempt_count = 0 | .acceptance_criteria |= map(.met = false) else . end)'
}

# get_blocked_tasks() - Returns JSON array of all blocked tasks
# Returns: JSON array (may be empty [])
get_blocked_tasks() {
    jq '[.tasks[] | select(.status == "Blocked")]' "$BACKLOG_FILE"
}

# update_criteria_met() - Update acceptance criteria met values
# Args: $1 = task_id, $2 = JSON string like [{"criterion":"text","met":true},...]
# Returns: exit code from update_backlog
update_criteria_met() {
    local task_id="$1"
    local criteria_json="$2"

    validate_task_exists "$task_id" || return 1

    update_backlog --arg id "$task_id" --argjson criteria "$criteria_json" \
        '.tasks |= map(if .id == $id then .acceptance_criteria |= map(. as $ac | ($criteria | map(select(.criterion == $ac.criterion)) | first) as $update | if $update then .met = $update.met else . end) else . end)'
}

# check_all_criteria_passed() - Check if all acceptance criteria are met
# Args: $1 = task_id
# Returns: "true" if all criteria met, "false" otherwise
check_all_criteria_passed() {
    local task_id="$1"
    jq --arg id "$1" '
        .tasks[] |
        select(.id == $id) |
        if (.acceptance_criteria | length) > 0 then
            (.acceptance_criteria | all(.met == true))
        else
            false
        end
    ' "$BACKLOG_FILE"
}
