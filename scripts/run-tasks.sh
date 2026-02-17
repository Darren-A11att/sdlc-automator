#!/usr/bin/env bash
set -euo pipefail

# =============================================================================
# run-tasks.sh - SDLC Task Loop
#
# Processes tasks from backlog_tasks.json through an automated SDLC pipeline:
#   Todo → In-Progress (implement) → Review → Testing → Done
#
# Uses Claude Code CLI in headless mode with different models per stage:
#   - Sonnet 4.5: Implementation (first attempt)
#   - Opus 4.6: Review, Testing, Fixing, Blocker Analysis, Reports
#
# Configuration is loaded from project.json in the project root.
# =============================================================================

# --- Constants ---
SCRIPTS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "${SCRIPTS_DIR}/.." && pwd)"
BACKLOG_FILE="${PROJECT_DIR}/tasks/backlog_tasks.json"
LOGS_DIR="${PROJECT_DIR}/logs"
REPORTS_DIR="${PROJECT_DIR}/reports"

MAX_ATTEMPTS=5
MAX_CONSECUTIVE_BLOCKS=5

# Model identifiers
MODEL_SONNET="claude-sonnet-4-5-20250929"
MODEL_OPUS="claude-opus-4-6"

# Max turns per agent
MAX_TURNS_IMPLEMENTER=25
MAX_TURNS_REVIEWER=15
MAX_TURNS_TESTER=15
MAX_TURNS_FIXER=20
MAX_TURNS_BLOCKER=5
MAX_TURNS_REPORTER=10

# Default allowed tools for all agents
ALLOWED_TOOLS="Bash,Read,Edit,Write,Glob,Grep"

# CLI provider (default: claude; set to "kimi" via --cli-kimi)
CLI_PROVIDER="claude"

# Verbose mode (streams real-time agent output to terminal)
VERBOSE=true

# Session state
SESSION_LOG_FILE=""
CONSECUTIVE_BLOCKS=0
CURRENT_TASK_ID=""

# --- Source libraries ---
source "${SCRIPTS_DIR}/lib/logging.sh"
source "${SCRIPTS_DIR}/lib/json-ops.sh"
source "${SCRIPTS_DIR}/lib/cli-wrapper.sh"
source "${SCRIPTS_DIR}/lib/format-stream.sh"
source "${SCRIPTS_DIR}/lib/prompts.sh"
source "${SCRIPTS_DIR}/lib/test-types.sh"

# --- Load project config ---
load_project_config

# --- Signal handler ---
cleanup() {
    local exit_code=$?
    echo ""
    log "WARN" "Interrupt received. Cleaning up..."

    # Clean up any temp files from atomic writes
    rm -f "${BACKLOG_FILE}.tmp."*

    if [[ -n "$CURRENT_TASK_ID" ]]; then
        log "INFO" "Task $CURRENT_TASK_ID was interrupted. Status preserved in backlog."
    fi

    # Print summary before exit
    print_summary "$BACKLOG_FILE"

    log "INFO" "Session ended. Log: $SESSION_LOG_FILE"
    exit "$exit_code"
}

trap cleanup SIGINT SIGTERM

# --- Argument parsing ---
parse_args() {
    RETRY_TASK_ID=""
    START_FROM_TASK_ID=""

    for arg in "$@"; do
        case "$arg" in
            --help)
                print_usage
                exit 0
                ;;
            --retry:*)
                RETRY_TASK_ID="${arg#--retry:}"
                ;;
            --start-from:*)
                START_FROM_TASK_ID="${arg#--start-from:}"
                ;;
            --cli-kimi)
                CLI_PROVIDER="kimi"
                ;;
            --verbose)
                VERBOSE=true
                ;;
            *)
                log "ERROR" "Unknown argument: $arg"
                print_usage
                exit 1
                ;;
        esac
    done
}

# --- Agent runner functions ---

run_implementer() {
    local task_json="$1"
    local task_id
    task_id=$(echo "$task_json" | jq -r '.id')
    local task_log_dir
    task_log_dir=$(get_task_log_dir "$task_id")

    log "INFO" "[$task_id] Running Implementer (Sonnet)..."

    local sys_prompt
    sys_prompt=$(build_implementer_system_prompt)
    local user_prompt
    user_prompt=$(build_implementer_user_prompt "$task_json")

    local output
    if output=$(invoke_agent "$MODEL_SONNET" "$MAX_TURNS_IMPLEMENTER" "$sys_prompt" "$user_prompt" "${task_log_dir}/implement.log"); then
        log "INFO" "[$task_id] Implementer completed successfully"
        echo "$output"
        return 0
    else
        log "ERROR" "[$task_id] Implementer failed"
        return 1
    fi
}

run_reviewer() {
    local task_json="$1"
    local files_changed="${2:-}"
    local task_id
    task_id=$(echo "$task_json" | jq -r '.id')
    local task_log_dir
    task_log_dir=$(get_task_log_dir "$task_id")

    log "INFO" "[$task_id] Running Reviewer (Opus)..."

    local sys_prompt
    sys_prompt=$(build_reviewer_system_prompt)
    local user_prompt
    user_prompt=$(build_reviewer_user_prompt "$task_json" "$files_changed")

    local output
    if output=$(invoke_claude "$MODEL_OPUS" "$MAX_TURNS_REVIEWER" "$sys_prompt" "$user_prompt" "${task_log_dir}/review.log"); then
        log "INFO" "[$task_id] Reviewer completed"
        echo "$output"
        return 0
    else
        log "ERROR" "[$task_id] Reviewer failed"
        return 1
    fi
}

run_tester() {
    local task_json="$1"
    local task_id
    task_id=$(echo "$task_json" | jq -r '.id')
    local task_log_dir
    task_log_dir=$(get_task_log_dir "$task_id")

    log "INFO" "[$task_id] Running Tester (Opus)..."

    local sys_prompt
    sys_prompt=$(build_tester_system_prompt)
    local user_prompt
    user_prompt=$(build_tester_user_prompt "$task_json")

    local output
    if output=$(invoke_claude "$MODEL_OPUS" "$MAX_TURNS_TESTER" "$sys_prompt" "$user_prompt" "${task_log_dir}/test.log"); then
        log "INFO" "[$task_id] Tester completed"
        echo "$output"
        return 0
    else
        log "ERROR" "[$task_id] Tester failed"
        return 1
    fi
}

run_fixer() {
    local task_json="$1"
    local failure_notes="$2"
    local fix_number="${3:-1}"
    local task_id
    task_id=$(echo "$task_json" | jq -r '.id')
    local task_log_dir
    task_log_dir=$(get_task_log_dir "$task_id")

    log "INFO" "[$task_id] Running Fixer (Opus) - fix attempt $fix_number..."

    local sys_prompt
    sys_prompt=$(build_fixer_system_prompt)
    local user_prompt
    user_prompt=$(build_fixer_user_prompt "$task_json" "$failure_notes")

    local output
    if output=$(invoke_claude "$MODEL_OPUS" "$MAX_TURNS_FIXER" "$sys_prompt" "$user_prompt" "${task_log_dir}/fix-${fix_number}.log"); then
        log "INFO" "[$task_id] Fixer completed"
        echo "$output"
        return 0
    else
        log "ERROR" "[$task_id] Fixer failed"
        return 1
    fi
}

run_blocker_analysis() {
    local candidate_task="$1"
    local blocked_tasks="$2"
    local task_id
    task_id=$(echo "$candidate_task" | jq -r '.id')

    log "INFO" "[$task_id] Running Blocker Analysis (Opus)..."

    local sys_prompt
    sys_prompt=$(build_blocker_analyst_system_prompt)
    local user_prompt
    user_prompt=$(build_blocker_analyst_user_prompt "$candidate_task" "$blocked_tasks")

    local task_log_dir
    task_log_dir=$(get_task_log_dir "$task_id")

    local output
    if output=$(invoke_claude "$MODEL_OPUS" "$MAX_TURNS_BLOCKER" "$sys_prompt" "$user_prompt" "${task_log_dir}/blocker-analysis.log"); then
        # Parse blocker verdict
        local verdict
        verdict=$(echo "$output" | grep -oE 'BLOCKER_VERDICT:[[:space:]]*(CLEAR|BLOCKED)' | head -1 | grep -oE '(CLEAR|BLOCKED)' || echo "CLEAR")
        echo "$verdict"
        return 0
    else
        log "WARN" "[$task_id] Blocker analysis failed, assuming CLEAR"
        echo "CLEAR"
        return 0
    fi
}

run_block_reporter() {
    local blocked_tasks="$1"

    log "INFO" "Generating blocked tasks report..."

    mkdir -p "$REPORTS_DIR"
    local report_path="${REPORTS_DIR}/blocked-report-$(date +%Y%m%d).md"

    local sys_prompt
    sys_prompt=$(build_block_reporter_system_prompt)
    local user_prompt
    user_prompt=$(build_block_reporter_user_prompt "$blocked_tasks" "$report_path")

    invoke_claude "$MODEL_OPUS" "$MAX_TURNS_REPORTER" "$sys_prompt" "$user_prompt" "${LOGS_DIR}/block-report.log" > /dev/null 2>&1

    if [[ -f "$report_path" ]]; then
        log "INFO" "Blocked tasks report written to: $report_path"
    else
        log "WARN" "Block reporter did not create report file at: $report_path"
    fi
}

git_commit_task() {
    local task_id="$1"
    local task_name="$2"

    log "INFO" "[$task_id] Creating git commit..."

    # Stage all changes
    cd "$PROJECT_DIR"
    git add -A

    # Check if there are changes to commit
    if git diff --cached --quiet; then
        log "WARN" "[$task_id] No changes to commit"
        return 0
    fi

    # Create commit with conventional format
    git commit -m "$(cat <<EOF
feat: ${task_name} (${task_id})

Automated SDLC pipeline - task completed and verified.

Co-Authored-By: Claude <noreply@anthropic.com>
EOF
)"

    log "INFO" "[$task_id] Git commit created"

    # Push to remote
    if git push 2>/dev/null; then
        log "INFO" "[$task_id] Pushed to remote"
    else
        log "WARN" "[$task_id] Push to remote failed"
    fi

    return 0
}

git_commit_progress() {
    local task_id="$1"
    local stage="$2"

    cd "$PROJECT_DIR"
    git add -A

    if git diff --cached --quiet; then
        return 0
    fi

    git commit -m "wip: ${task_id} - ${stage}"
    log "INFO" "[$task_id] Progress commit: $stage"
}

# --- Test orchestrators and story processing ---

_run_single_test_type() {
    local test_type_key="$1" test_type_label="$2" test_type_max_turns="$3"
    local test_type_needs_browser="$4" task_json="$5" previous_results="${6:-}"
    local task_id; task_id=$(echo "$task_json" | jq -r '.id')
    local task_log_dir; task_log_dir=$(get_task_log_dir "$task_id")
    log "INFO" "[$task_id] Running ${test_type_label}..."
    local sys_prompt; sys_prompt=$(build_test_type_system_prompt "$test_type_key" "$test_type_needs_browser")
    local user_prompt; user_prompt=$(build_test_type_user_prompt "$test_type_key" "$task_json" "$previous_results")
    local output
    if output=$(invoke_claude "$MODEL_OPUS" "$test_type_max_turns" "$sys_prompt" "$user_prompt" "${task_log_dir}/test-${test_type_key,,}.log"); then
        local verdict; verdict=$(parse_verdict "$output")
        local notes; notes=$(parse_notes "$output")
        log "INFO" "[$task_id] ${test_type_label}: $verdict"
        echo "${verdict}|${notes}"; return 0
    else
        log "ERROR" "[$task_id] ${test_type_label} agent failed"
        echo "FAIL|Agent invocation failed"; return 1
    fi
}

run_task_test_orchestrator() {
    local task_json="$1"
    local task_id; task_id=$(echo "$task_json" | jq -r '.id')
    local previous_results="" overall_verdict="PASS"
    for idx in "${TASK_TEST_INDICES[@]}"; do
        local tt_key="${TEST_TYPE_KEYS[$idx]}" tt_label="${TEST_TYPE_LABELS[$idx]}"
        local tt_turns="${TEST_TYPE_MAX_TURNS[$idx]}" tt_browser="${TEST_TYPE_NEEDS_BROWSER[$idx]}"
        update_task_status "$task_id" "Testing:${tt_key}"
        task_json=$(get_task_by_id "$task_id")
        local result_line
        result_line=$(_run_single_test_type "$tt_key" "$tt_label" "$tt_turns" "$tt_browser" "$task_json" "$previous_results") || true
        local verdict="${result_line%%|*}" notes="${result_line#*|}"
        previous_results="${previous_results}${tt_key}: ${verdict}. "
        if [[ "$verdict" == "FAIL" ]]; then
            local attempt_count; attempt_count=$(get_attempt_count "$task_id")
            update_task_status "$task_id" "In-Progress"; task_json=$(get_task_by_id "$task_id")
            local fix_output
            if fix_output=$(run_fixer "$task_json" "${tt_label} failure: ${notes}" "$attempt_count"); then
                git_commit_progress "$task_id" "after-${tt_key,,}-fix"
                update_task_status "$task_id" "Testing:${tt_key}"; task_json=$(get_task_by_id "$task_id")
                local retry_line
                retry_line=$(_run_single_test_type "$tt_key" "$tt_label" "$tt_turns" "$tt_browser" "$task_json" "$previous_results") || true
                if [[ "${retry_line%%|*}" != "PASS" ]]; then
                    append_task_notes "$task_id" "${tt_label} still failing after fix"
                    overall_verdict="FAIL"; break
                fi
            else
                append_task_notes "$task_id" "Fixer failed for ${tt_label}"
                overall_verdict="FAIL"; break
            fi
        fi
    done
    echo "$overall_verdict"
}

run_story_test_orchestrator() {
    local story_json="$1" tasks_json="$2"
    local story_id; story_id=$(echo "$story_json" | jq -r '.id')
    local previous_results="" overall_verdict="PASS"
    for idx in "${STORY_TEST_INDICES[@]}"; do
        local tt_key="${TEST_TYPE_KEYS[$idx]}" tt_label="${TEST_TYPE_LABELS[$idx]}"
        local tt_turns="${TEST_TYPE_MAX_TURNS[$idx]}" tt_browser="${TEST_TYPE_NEEDS_BROWSER[$idx]}"
        update_story_status "$story_id" "Testing:${tt_key}"
        local sys_prompt; sys_prompt=$(build_story_test_system_prompt "$tt_key" "$tt_browser")
        local user_prompt; user_prompt=$(build_story_test_user_prompt "$tt_key" "$story_json" "$tasks_json" "$previous_results")
        local story_log_dir="${LOGS_DIR}/stories/${story_id}"; mkdir -p "$story_log_dir"
        local output verdict notes
        if output=$(invoke_claude "$MODEL_OPUS" "$tt_turns" "$sys_prompt" "$user_prompt" "${story_log_dir}/test-${tt_key,,}.log"); then
            verdict=$(parse_verdict "$output"); notes=$(parse_notes "$output")
        else
            verdict="FAIL"; notes="Agent invocation failed"
        fi
        log "INFO" "[${story_id}] Story ${tt_label}: $verdict"
        previous_results="${previous_results}${tt_key}: ${verdict}. "
        if [[ "$verdict" == "FAIL" ]]; then
            update_story_status "$story_id" "In-Progress"
            local fix_sys; fix_sys=$(build_fixer_system_prompt)
            local scrit; scrit=$(echo "$story_json" | jq -r '.acceptance_criteria[] | "- " + .criterion')
            local fix_user="Fix story ${tt_label} failure:
Story: $(echo "$story_json" | jq -r '.name')
Criteria: ${scrit}
Failure: ${notes}
Fix issues. Verify build passes."
            local fix_output
            if fix_output=$(invoke_claude "$MODEL_OPUS" "$MAX_TURNS_TEST_FIXER" "$fix_sys" "$fix_user" "${story_log_dir}/fix-${tt_key,,}.log"); then
                git_commit_progress "$story_id" "after-story-${tt_key,,}-fix"
                update_story_status "$story_id" "Testing:${tt_key}"
                story_json=$(get_story_by_id "$story_id")
                local r_sys; r_sys=$(build_story_test_system_prompt "$tt_key" "$tt_browser")
                local r_user; r_user=$(build_story_test_user_prompt "$tt_key" "$story_json" "$tasks_json" "$previous_results")
                local r_out r_verd
                if r_out=$(invoke_claude "$MODEL_OPUS" "$tt_turns" "$r_sys" "$r_user" "${story_log_dir}/test-${tt_key,,}-retry.log"); then
                    r_verd=$(parse_verdict "$r_out")
                else r_verd="FAIL"; fi
                if [[ "$r_verd" != "PASS" ]]; then
                    append_story_notes "$story_id" "Story ${tt_label} still failing after fix"
                    overall_verdict="FAIL"; break
                fi
            else
                append_story_notes "$story_id" "Story fixer failed for ${tt_label}"
                overall_verdict="FAIL"; break
            fi
        fi
    done
    echo "$overall_verdict"
}

process_story() {
    local story_id="$1"
    local story_json; story_json=$(get_story_by_id "$story_id")
    if [[ -z "$story_json" ]]; then log "ERROR" "Story $story_id not found"; return 1; fi
    local all_done; all_done=$(are_all_story_tasks_done "$story_id")
    if [[ "$all_done" != "true" ]]; then log "WARN" "[$story_id] Not all tasks Done"; return 1; fi
    local attempt_count; attempt_count=$(get_story_attempt_count "$story_id")
    if [[ "$attempt_count" -ge "$MAX_STORY_ATTEMPTS" ]]; then
        log "WARN" "[$story_id] Max story attempts reached. Blocked."
        update_story_status "$story_id" "Blocked"
        append_story_notes "$story_id" "Blocked: exceeded $MAX_STORY_ATTEMPTS attempts"
        return 1
    fi
    increment_story_attempt_count "$story_id"
    log "INFO" "[$story_id] Processing story (attempt $((attempt_count + 1))/$MAX_STORY_ATTEMPTS)"
    local task_ids; task_ids=$(echo "$story_json" | jq -r '.task_ids[]')
    local tasks_json="["; local first=true
    for tid in $task_ids; do
        local t; t=$(get_task_by_id "$tid")
        if [[ -n "$t" ]]; then
            [[ "$first" == "true" ]] && first=false || tasks_json="${tasks_json},"
            tasks_json="${tasks_json}${t}"
        fi
    done
    tasks_json="${tasks_json}]"
    update_story_status "$story_id" "Testing"
    local story_verdict; story_verdict=$(run_story_test_orchestrator "$story_json" "$tasks_json")
    if [[ "$story_verdict" == "PASS" ]]; then
        update_story_status "$story_id" "Done"
        git_commit_task "$story_id" "$(echo "$story_json" | jq -r '.name')"
        append_story_notes "$story_id" "Story completed on attempt $((attempt_count + 1))"
        log "INFO" "[$story_id] DONE - Story completed"
        return 0
    fi
    append_story_notes "$story_id" "Story tests failed on attempt $((attempt_count + 1))"
    update_story_status "$story_id" "Todo"
    log "WARN" "[$story_id] Story tests failed. Queued for retry."
    return 1
}

# --- Core task processing ---

process_task() {
    local task_id="$1"
    CURRENT_TASK_ID="$task_id"

    # Fetch fresh task data
    local task_json
    task_json=$(get_task_by_id "$task_id")

    if [[ -z "$task_json" ]]; then
        log "ERROR" "Task $task_id not found in backlog"
        return 1
    fi

    local task_name
    task_name=$(echo "$task_json" | jq -r '.name')

    # Check attempt count
    local attempt_count
    attempt_count=$(get_attempt_count "$task_id")

    if [[ "$attempt_count" -ge "$MAX_ATTEMPTS" ]]; then
        log "WARN" "[$task_id] Max attempts ($MAX_ATTEMPTS) reached. Marking as Blocked."
        update_task_status "$task_id" "Blocked"
        append_task_notes "$task_id" "Blocked: exceeded $MAX_ATTEMPTS attempts"
        CURRENT_TASK_ID=""
        return 1
    fi

    # Increment attempt count
    increment_attempt_count "$task_id"
    attempt_count=$((attempt_count + 1))
    log "INFO" "[$task_id] Processing: $task_name (attempt $attempt_count/$MAX_ATTEMPTS)"

    # --- Step 1: Implementation ---
    # Only run implementer on first attempt; on retries code already exists
    if [[ "$attempt_count" -eq 1 ]]; then
        update_task_status "$task_id" "In-Progress"
        local impl_output
        if ! impl_output=$(run_implementer "$task_json"); then
            append_task_notes "$task_id" "Implementer failed on attempt $attempt_count"
            update_task_status "$task_id" "Todo"
            CURRENT_TASK_ID=""
            return 1
        fi
        git_commit_progress "$task_id" "after-implementation"
    fi

    # --- Step 2: Review ---
    update_task_status "$task_id" "Review"
    # Re-fetch task after status change
    task_json=$(get_task_by_id "$task_id")

    local review_output
    if ! review_output=$(run_reviewer "$task_json" "${impl_output:-}"); then
        append_task_notes "$task_id" "Reviewer failed on attempt $attempt_count"
        update_task_status "$task_id" "Todo"
        CURRENT_TASK_ID=""
        return 1
    fi

    local review_verdict
    review_verdict=$(parse_verdict "$review_output")
    log "INFO" "[$task_id] Review verdict: $review_verdict"

    # If review fails, fix the issues before proceeding to testing
    if [[ "$review_verdict" == "FAIL" ]]; then
        local review_notes
        review_notes=$(parse_notes "$review_output")
        append_task_notes "$task_id" "Review FAIL: $review_notes"

        update_task_status "$task_id" "In-Progress"
        task_json=$(get_task_by_id "$task_id")

        local fix_output
        if ! fix_output=$(run_fixer "$task_json" "$review_notes" "$attempt_count"); then
            append_task_notes "$task_id" "Fixer failed after review on attempt $attempt_count"
            update_task_status "$task_id" "Todo"
            CURRENT_TASK_ID=""
            return 1
        fi
        git_commit_progress "$task_id" "after-review-fix"
    fi

    # --- Step 3: Task-Level Testing (Unit, Integration, Contract) ---
    update_task_status "$task_id" "Testing"
    task_json=$(get_task_by_id "$task_id")

    local task_test_verdict
    task_test_verdict=$(run_task_test_orchestrator "$task_json")

    if [[ "$task_test_verdict" == "PASS" ]]; then
        update_task_status "$task_id" "Done"
        task_json=$(get_task_by_id "$task_id")
        task_name=$(echo "$task_json" | jq -r '.name')

        git_commit_task "$task_id" "$task_name"

        append_task_notes "$task_id" "Completed on attempt $attempt_count"
        log "INFO" "[$task_id] DONE - Task completed successfully"
        CURRENT_TASK_ID=""
        return 0
    fi

    # Task tests failed
    append_task_notes "$task_id" "Task tests failed on attempt $attempt_count"
    update_task_status "$task_id" "Todo"
    log "WARN" "[$task_id] Task tests failed on attempt $attempt_count. Queued for retry."
    CURRENT_TASK_ID=""
    return 1
}

# --- Main ---

main() {
    # Enforce backlog file exists
    if [[ ! -f "$BACKLOG_FILE" ]]; then
        echo "ERROR: Backlog file not found at $BACKLOG_FILE"
        echo "Copy templates/tasks/backlog_tasks.json to tasks/ and populate it."
        exit 1
    fi

    # Parse arguments
    parse_args "$@"

    # Initialize logging
    init_session_log
    log "INFO" "=== SDLC Task Loop Started ==="
    log "INFO" "Backlog: $BACKLOG_FILE"
    log "INFO" "CLI Provider: $CLI_PROVIDER"
    log "INFO" "Verbose: $VERBOSE"

    # Handle --retry mode
    if [[ -n "${RETRY_TASK_ID:-}" ]]; then
        log "INFO" "Retry mode: resetting task $RETRY_TASK_ID"
        if ! validate_task_exists "$RETRY_TASK_ID"; then
            log "ERROR" "Task $RETRY_TASK_ID not found"
            exit 1
        fi
        reset_task_to_todo "$RETRY_TASK_ID"
        log "INFO" "Task $RETRY_TASK_ID reset to Todo"

        process_task "$RETRY_TASK_ID" || true
        print_summary "$BACKLOG_FILE"
        log "INFO" "Session ended. Log: $SESSION_LOG_FILE"
        exit 0
    fi

    # Main processing loop
    local skip_until_found=false
    if [[ -n "${START_FROM_TASK_ID:-}" ]]; then
        skip_until_found=true
        log "INFO" "Start-from mode: will skip until task $START_FROM_TASK_ID"
        if ! validate_task_exists "$START_FROM_TASK_ID"; then
            log "ERROR" "Task $START_FROM_TASK_ID not found"
            exit 1
        fi
    fi

    CONSECUTIVE_BLOCKS=0

    while true; do
        # Get next Todo task
        local next_task
        next_task=$(get_next_todo_task)

        if [[ -z "$next_task" || "$next_task" == "null" ]]; then
            log "INFO" "No more Todo tasks found. Pipeline complete."
            break
        fi

        local task_id
        task_id=$(echo "$next_task" | jq -r '.id')

        # Handle --start-from: skip tasks until we find the target
        if [[ "$skip_until_found" == "true" ]]; then
            if [[ "$task_id" == "$START_FROM_TASK_ID" ]]; then
                skip_until_found=false
                log "INFO" "Found start-from task: $task_id"
            else
                # Skip this task by just continuing - get_next_todo_task will keep returning it
                # So we need to temporarily mark it to skip it, then restore
                # Instead, use a different approach: find the specific task
                log "DEBUG" "Skipping task $task_id (waiting for $START_FROM_TASK_ID)"
                # Move past this task by marking it temporarily
                update_task_status "$task_id" "In-Progress"
                # Store to restore later
                local -a skipped_tasks=()
                skipped_tasks+=("$task_id")

                # Keep skipping until we find our target or run out
                while true; do
                    next_task=$(get_next_todo_task)
                    if [[ -z "$next_task" || "$next_task" == "null" ]]; then
                        log "ERROR" "Reached end of Todo tasks without finding $START_FROM_TASK_ID"
                        # Restore skipped tasks
                        for skipped_id in "${skipped_tasks[@]}"; do
                            update_task_status "$skipped_id" "Todo"
                        done
                        exit 1
                    fi
                    task_id=$(echo "$next_task" | jq -r '.id')
                    if [[ "$task_id" == "$START_FROM_TASK_ID" ]]; then
                        skip_until_found=false
                        # Restore skipped tasks
                        for skipped_id in "${skipped_tasks[@]}"; do
                            update_task_status "$skipped_id" "Todo"
                        done
                        log "INFO" "Found start-from task: $task_id"
                        break
                    fi
                    update_task_status "$task_id" "In-Progress"
                    skipped_tasks+=("$task_id")
                done
            fi
        fi

        # Check for blockers before processing
        local blocked_tasks
        blocked_tasks=$(get_blocked_tasks)
        local blocked_count
        blocked_count=$(echo "$blocked_tasks" | jq 'length')

        if [[ "$blocked_count" -gt 0 ]]; then
            log "INFO" "[$task_id] Checking against $blocked_count blocked tasks..."
            local blocker_verdict
            blocker_verdict=$(run_blocker_analysis "$next_task" "$blocked_tasks")

            if [[ "$blocker_verdict" == "BLOCKED" ]]; then
                log "WARN" "[$task_id] Blocked by previously blocked tasks"
                update_task_status "$task_id" "Blocked"
                append_task_notes "$task_id" "Blocked: dependency on previously blocked task(s)"
                CONSECUTIVE_BLOCKS=$((CONSECUTIVE_BLOCKS + 1))

                if [[ "$CONSECUTIVE_BLOCKS" -ge "$MAX_CONSECUTIVE_BLOCKS" ]]; then
                    log "ERROR" "Hit $MAX_CONSECUTIVE_BLOCKS consecutive blocked tasks. Generating report and stopping."
                    blocked_tasks=$(get_blocked_tasks)
                    run_block_reporter "$blocked_tasks"
                    print_summary "$BACKLOG_FILE"
                    log "INFO" "Session ended. Log: $SESSION_LOG_FILE"
                    exit 1
                fi

                continue
            fi
        fi

        # Reset consecutive blocks counter on a clear task
        CONSECUTIVE_BLOCKS=0

        # Process the task — retry until it reaches a terminal state
        while true; do
            if process_task "$task_id"; then
                log "INFO" "[$task_id] Task completed successfully"

                # After task Done, check if parent story is ready for testing
                local story_json
                story_json=$(get_story_by_task_id "$task_id")
                if [[ -n "$story_json" ]]; then
                    local story_id
                    story_id=$(echo "$story_json" | jq -r '.id')
                    local story_status
                    story_status=$(echo "$story_json" | jq -r '.status')
                    local all_done
                    all_done=$(are_all_story_tasks_done "$story_id")
                    if [[ "$all_done" == "true" && "$story_status" != "Done" ]]; then
                        log "INFO" "[$story_id] All tasks Done. Starting story-level testing..."
                        process_story "$story_id" || true
                    fi
                fi

                break
            fi

            # Check if task reached a terminal state despite returning failure
            local task_status
            task_status=$(echo "$(get_task_by_id "$task_id")" | jq -r '.status')

            if [[ "$task_status" == "Done" || "$task_status" == "Blocked" ]]; then
                log "INFO" "[$task_id] Task reached terminal state: $task_status"
                break
            fi

            log "WARN" "[$task_id] Not completed (status: $task_status), retrying..."
            sleep 2
        done
    done

    # End of loop - print final summary
    print_summary "$BACKLOG_FILE"
    log "INFO" "Session ended. Log: $SESSION_LOG_FILE"
}

# Run main
main "$@"
