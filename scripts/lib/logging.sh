#!/usr/bin/env bash
# logging.sh - Logging utilities for the SDLC task loop

# Initialize session log file with timestamp
# Creates a new log file in $LOGS_DIR with format run-YYYYMMDD-HHMMSS.log
# Sets the global SESSION_LOG_FILE variable
init_session_log() {
    local timestamp
    timestamp=$(date +"%Y%m%d-%H%M%S")

    # Create logs directory if it doesn't exist
    mkdir -p "$LOGS_DIR"

    # Set global session log file path
    SESSION_LOG_FILE="$LOGS_DIR/run-${timestamp}.log"

    # Create the log file
    touch "$SESSION_LOG_FILE"

    # Write initial header
    echo "=== SDLC Task Loop Session Started at $(date '+%Y-%m-%d %H:%M:%S') ===" > "$SESSION_LOG_FILE"
    echo "" >> "$SESSION_LOG_FILE"
}

# Log a message with timestamp and level
# Args:
#   $1 - Log level (INFO, WARN, ERROR, DEBUG)
#   $2 - Message to log
log() {
    local level="$1"
    shift
    local message="$*"
    local timestamp
    timestamp=$(date '+%Y-%m-%d %H:%M:%S')

    local log_line="[${timestamp}] [${level}] ${message}"

    # Output to stdout
    echo "$log_line"

    # Append to session log file if it exists
    if [[ -n "${SESSION_LOG_FILE:-}" ]]; then
        echo "$log_line" >> "$SESSION_LOG_FILE"
    fi
}

# Get or create the log directory for a specific task
# Args:
#   $1 - Task ID (e.g., "4.22.100")
# Returns:
#   Path to the task's log directory
get_task_log_dir() {
    local task_id="$1"
    local task_log_dir="$LOGS_DIR/tasks/${task_id}"

    # Create the directory if it doesn't exist
    mkdir -p "$task_log_dir"

    # Return the path
    echo "$task_log_dir"
}

# Print a summary of task statuses from the backlog JSON
# Args:
#   $1 - Path to backlog JSON file
print_summary() {
    local backlog_file="$1"

    if [[ ! -f "$backlog_file" ]]; then
        log "ERROR" "Backlog file not found: $backlog_file"
        return 1
    fi

    echo ""
    echo "=== Task Summary ==="
    echo ""

    # Count tasks by status using jq
    local done_count
    local blocked_count
    local todo_count
    local in_progress_count
    local review_count
    local testing_count
    local total_count

    done_count=$(jq '[.tasks[] | select(.status == "Done")] | length' "$backlog_file")
    blocked_count=$(jq '[.tasks[] | select(.status == "Blocked")] | length' "$backlog_file")
    todo_count=$(jq '[.tasks[] | select(.status == "Todo")] | length' "$backlog_file")
    in_progress_count=$(jq '[.tasks[] | select(.status == "In-Progress")] | length' "$backlog_file")
    review_count=$(jq '[.tasks[] | select(.status == "Review")] | length' "$backlog_file")
    testing_count=$(jq '[.tasks[] | select(.status == "Testing" or (.status | startswith("Testing:")))] | length' "$backlog_file")
    total_count=$(jq '[.tasks[]] | length' "$backlog_file")

    # Print formatted table
    printf "%-15s %5s\n" "Status" "Count"
    printf "%-15s %5s\n" "---------------" "-----"
    printf "%-15s %5d\n" "Done" "$done_count"
    printf "%-15s %5d\n" "In-Progress" "$in_progress_count"
    printf "%-15s %5d\n" "Review" "$review_count"
    printf "%-15s %5d\n" "Testing" "$testing_count"
    printf "%-15s %5d\n" "Todo" "$todo_count"
    printf "%-15s %5d\n" "Blocked" "$blocked_count"
    printf "%-15s %5s\n" "---------------" "-----"
    printf "%-15s %5d\n" "Total" "$total_count"
    echo ""

    # Story summary (if stories exist)
    local story_count
    story_count=$(jq '(.stories // []) | length' "$backlog_file")
    if [[ "$story_count" -gt 0 ]]; then
        echo "=== Story Summary ==="
        echo ""
        local s_done s_inprog s_testing s_todo s_blocked
        s_done=$(jq '[(.stories // [])[] | select(.status == "Done")] | length' "$backlog_file")
        s_inprog=$(jq '[(.stories // [])[] | select(.status == "In-Progress")] | length' "$backlog_file")
        s_testing=$(jq '[(.stories // [])[] | select(.status == "Testing" or (.status | startswith("Testing:")))] | length' "$backlog_file")
        s_todo=$(jq '[(.stories // [])[] | select(.status == "Todo")] | length' "$backlog_file")
        s_blocked=$(jq '[(.stories // [])[] | select(.status == "Blocked")] | length' "$backlog_file")
        printf "%-15s %5s\n" "Status" "Count"
        printf "%-15s %5s\n" "---------------" "-----"
        printf "%-15s %5d\n" "Done" "$s_done"
        printf "%-15s %5d\n" "In-Progress" "$s_inprog"
        printf "%-15s %5d\n" "Testing" "$s_testing"
        printf "%-15s %5d\n" "Todo" "$s_todo"
        printf "%-15s %5d\n" "Blocked" "$s_blocked"
        printf "%-15s %5s\n" "---------------" "-----"
        printf "%-15s %5d\n" "Total" "$story_count"
        echo ""
    fi
}

# Print usage information for the run-tasks.sh script
print_usage() {
    cat <<EOF
Usage: run-tasks.sh [OPTIONS]

Options:
  --help                Show this help message
  --retry:<task_id>     Reset and retry a specific task
  --start-from:<task_id> Start processing from a specific task ID
  --cli-kimi            Use Kimi Code CLI instead of Claude Code CLI
  --verbose             Stream real-time agent output to terminal

Examples:
  ./run-tasks.sh                        Process from first Todo task
  ./run-tasks.sh --retry:4.22.100       Reset and retry task 4.22.100
  ./run-tasks.sh --start-from:5.30.150  Start from task 5.30.150
  ./run-tasks.sh --cli-kimi              Use Kimi CLI for implementation

CLI Providers (Implementer stage only):
  claude (default)  Uses claude -p with Sonnet for implementation
  kimi              Uses kimi --print -p for implementation
                    (model configured in ~/.kimi/config.toml)

Note: Review, Testing, Fixing, and Blocker Analysis always use Claude
      Opus regardless of CLI provider.

Description:
  This script processes tasks from the SDLC backlog in sequential order.
  Tasks are executed by delegating to appropriate backend agents based on
  their type and requirements.

  The script will:
  - Process tasks in order (feature -> story -> task)
  - Skip tasks that are Done or Blocked
  - Execute Todo and In-Progress tasks
  - Log all operations to timestamped log files
  - Provide a summary of task statuses

Task Statuses:
  Todo        - Task is ready to be started
  In-Progress - Task is currently being worked on
  Review      - Task is awaiting code review
  Testing     - Task is in QA/testing phase
  Done        - Task is completed
  Blocked     - Task is blocked and cannot proceed

Logs:
  Session logs: logs/run-YYYYMMDD-HHMMSS.log
  Task logs:    logs/tasks/<task_id>/

EOF
}
