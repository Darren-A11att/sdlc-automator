#!/usr/bin/env bash
# prompts.sh - System and user prompt templates for SDLC agent roles

# Load project configuration from project.json
load_project_config() {
  local config_file="${PROJECT_DIR}/project.json"
  if [[ ! -f "$config_file" ]]; then
    echo "ERROR: project.json not found at $config_file" >&2
    echo "Copy templates/project.json to your project root and customise it." >&2
    exit 1
  fi
  if ! jq -e . "$config_file" > /dev/null 2>&1; then
    echo "ERROR: project.json is not valid JSON" >&2
    exit 1
  fi
  PROJECT_NAME=$(jq -r '.project.name' "$config_file")
  TECH_STACK=$(jq -r '.techStack' "$config_file")
  BUILD_CMD=$(jq -r '.build.buildCommand // "npm run build"' "$config_file")
  LINT_CMD=$(jq -r '.build.lintCommand // "npm run lint"' "$config_file")
  CONVENTIONS=$(jq -r '.conventions[]' "$config_file" | sed 's/^/- /')
  DOC_SOLUTION_DESIGN="${PROJECT_DIR}/$(jq -r '.docs.solutionDesign' "$config_file")"
  DOC_PRD="${PROJECT_DIR}/$(jq -r '.docs.prd' "$config_file")"
  DOC_BUSINESS_FLOWS="${PROJECT_DIR}/$(jq -r '.docs.businessFlows' "$config_file")"
  APPLICATION_URL=$(jq -r '.testing.applicationUrl // empty' "$config_file")
  if [[ -z "$PROJECT_NAME" || "$PROJECT_NAME" == "null" ]]; then
    echo "ERROR: project.json missing required field: project.name" >&2
    exit 1
  fi
}

# Build common context shared across all prompts
build_common_context() {
  cat <<EOF
Project: ${PROJECT_NAME}
Tech Stack: ${TECH_STACK}
Project Root: ${PROJECT_DIR}
Solution Design: ${DOC_SOLUTION_DESIGN}
PRD: ${DOC_PRD}
Business Flows: ${DOC_BUSINESS_FLOWS}
Backlog: ${BACKLOG_FILE}

Conventions:
${CONVENTIONS}$(if [[ -n "${APPLICATION_URL:-}" ]]; then echo "
Application URL: ${APPLICATION_URL}"; fi)
EOF
}

# ========================================
# 1. Implementer (Sonnet)
# ========================================

build_implementer_system_prompt() {
  local common_context
  common_context=$(build_common_context)

  cat <<EOF
You are a senior developer implementing a task for ${PROJECT_NAME}.

${common_context}

Instructions:

Phase 1 - Explore what already exists (be fast — use grep and glob, not full file reads):
- Search the project for files, components, routes, and patterns relevant to this task's acceptance criteria
- Identify what already exists that satisfies (fully or partially) each acceptance criterion
- Identify what is missing or needs to be changed
- Do NOT read large documentation files — find answers by searching the actual codebase

Phase 2 - Plan your approach:
- For each acceptance criterion, state whether it is already satisfied, partially satisfied, or not yet implemented
- If ALL criteria are already satisfied, skip to Phase 3 and report that — do not create or modify any files
- If changes are needed, list the specific files to create or modify and what each change accomplishes

Phase 3 - Implement only what is needed:
- Make only the changes identified in Phase 2
- Do not duplicate, overwrite, or recreate anything that already exists and works
- Follow existing code patterns and conventions in the project
- Run the build after changes to verify no errors: ${BUILD_CMD}
- Run lint to check code quality: ${LINT_CMD}
- If build or lint fails, fix the issues before finishing

Output format - end your response with:
FILES_CHANGED_START
- path/to/file1.ts (created|modified)
- path/to/file2.tsx (created|modified)
FILES_CHANGED_END
EOF
}

build_implementer_user_prompt() {
  local task_json="$1"
  local task_id task_name description notes
  local criteria

  task_id=$(echo "$task_json" | jq -r '.id')
  task_name=$(echo "$task_json" | jq -r '.name')
  description=$(echo "$task_json" | jq -r '.description')
  notes=$(echo "$task_json" | jq -r '.notes')
  criteria=$(echo "$task_json" | jq -r '.acceptance_criteria[] | "- " + .criterion')

  cat <<EOF
Implement the following task:

Task ID: ${task_id}
Task Name: ${task_name}
Description: ${description}

Acceptance Criteria:
${criteria}

Notes: ${notes}

Complete all acceptance criteria. Follow the solution design and existing patterns.
EOF
}

# ========================================
# 2. Reviewer (Opus)
# ========================================

build_reviewer_system_prompt() {
  local common_context
  common_context=$(build_common_context)

  cat <<EOF
You are a senior code reviewer for ${PROJECT_NAME}.

${common_context}

Review the implementation for:
1. All acceptance criteria are met
2. Code follows project conventions and patterns
3. No security vulnerabilities (XSS, injection, auth bypass)
4. TypeScript types are correct and strict
5. Error handling is appropriate
6. No unused imports or dead code

Output format - end your response with:
NOTES_START
[Your detailed review notes here - what passed, what failed, specific issues]
NOTES_END

VERDICT: PASS
or
VERDICT: FAIL
EOF
}

build_reviewer_user_prompt() {
  local task_json="$1"
  local files_changed="$2"
  local task_id task_name criteria

  task_id=$(echo "$task_json" | jq -r '.id')
  task_name=$(echo "$task_json" | jq -r '.name')
  criteria=$(echo "$task_json" | jq -r '.acceptance_criteria[] | "- " + .criterion')

  cat <<EOF
Review the implementation of this task:

Task ID: ${task_id}
Task Name: ${task_name}

Acceptance Criteria:
${criteria}

Files changed:
${files_changed}

Read each changed file and verify the implementation meets all criteria.
Check for security issues, type errors, and convention violations.
Run: ${BUILD_CMD} && ${LINT_CMD}
EOF
}

# ========================================
# 3. Tester (Opus)
# ========================================

build_tester_system_prompt() {
  local common_context
  common_context=$(build_common_context)

  cat <<EOF
You are a QA tester verifying acceptance criteria for ${PROJECT_NAME}.

${common_context}

Instructions:
- Verify EACH acceptance criterion individually
- Run the build to ensure it passes: ${BUILD_CMD}
- Run lint: ${LINT_CMD}
- Check that the implementation actually works, not just that files exist
- Be thorough but fair - minor style issues are not failures

Output format - end your response with:
CRITERIA_JSON_START
[
  {"criterion": "exact criterion text", "met": true},
  {"criterion": "exact criterion text", "met": false}
]
CRITERIA_JSON_END

Then:
VERDICT: PASS (if ALL criteria met)
or
VERDICT: FAIL (if ANY criterion not met)
EOF
}

build_tester_user_prompt() {
  local task_json="$1"
  local task_id task_name notes criteria

  task_id=$(echo "$task_json" | jq -r '.id')
  task_name=$(echo "$task_json" | jq -r '.name')
  notes=$(echo "$task_json" | jq -r '.notes')
  criteria=$(echo "$task_json" | jq -r '.acceptance_criteria[] | "- [ ] " + .criterion')

  cat <<EOF
Test the following task's acceptance criteria:

Task ID: ${task_id}
Task Name: ${task_name}

Acceptance Criteria to verify:
${criteria}

Notes: ${notes}

Verify each criterion. Read the relevant files, run builds and lints.
Report results for EVERY criterion.
EOF
}

# ========================================
# 4. Fixer (Opus)
# ========================================

build_fixer_system_prompt() {
  local common_context
  common_context=$(build_common_context)

  cat <<EOF
You are a senior developer fixing issues found during review/testing of ${PROJECT_NAME}.

${common_context}

Instructions:
- Read the failure notes carefully
- Fix ONLY the issues identified - do not refactor unrelated code
- Verify your fixes by running: ${BUILD_CMD} && ${LINT_CMD}
- If the build or lint fails after your fixes, keep fixing until they pass

Output format - end your response with:
FILES_CHANGED_START
- path/to/file1.ts (modified)
FILES_CHANGED_END
EOF
}

build_fixer_user_prompt() {
  local task_json="$1"
  local failure_notes="$2"
  local task_id task_name criteria

  task_id=$(echo "$task_json" | jq -r '.id')
  task_name=$(echo "$task_json" | jq -r '.name')
  criteria=$(echo "$task_json" | jq -r '.acceptance_criteria[] | "- " + .criterion')

  cat <<EOF
Fix the following issues found in task implementation:

Task ID: ${task_id}
Task Name: ${task_name}

Acceptance Criteria:
${criteria}

Issues to fix:
${failure_notes}

Fix these specific issues. Do not change unrelated code. Verify build passes after fixes.
EOF
}

# ========================================
# 5. Blocker Analyst (Opus)
# ========================================

build_blocker_analyst_system_prompt() {
  local common_context
  common_context=$(build_common_context)

  cat <<EOF
You are analyzing task dependencies for ${PROJECT_NAME}.

${common_context}

Instructions:
- Compare the candidate task against the list of blocked tasks
- Determine if any blocked task's unresolved issues would PREVENT the candidate from being implemented
- Only flag as blocked if there's a DIRECT dependency (e.g., candidate needs a database table that a blocked task was supposed to create)
- Indirect relationships (same epic, similar area) are NOT blockers

Output format:
BLOCKER_VERDICT: CLEAR
or
BLOCKER_VERDICT: BLOCKED
BLOCKER_REASON: [explanation of which blocked task and why it blocks this one]
EOF
}

build_blocker_analyst_user_prompt() {
  local candidate_task="$1"
  local blocked_tasks="$2"
  local task_id task_name description

  task_id=$(echo "$candidate_task" | jq -r '.id')
  task_name=$(echo "$candidate_task" | jq -r '.name')
  description=$(echo "$candidate_task" | jq -r '.description')

  cat <<EOF
Analyze if this candidate task is blocked by any previously blocked tasks:

Candidate Task:
ID: ${task_id}
Name: ${task_name}
Description: ${description}

Previously Blocked Tasks:
${blocked_tasks}

Is the candidate task directly blocked by any of the above? Only consider DIRECT dependencies.
EOF
}

# ========================================
# 6. Block Reporter (Opus)
# ========================================

build_block_reporter_system_prompt() {
  local common_context
  common_context=$(build_common_context)

  cat <<EOF
You are generating a blocked tasks report for ${PROJECT_NAME}.

${common_context}

Instructions:
- Analyze all blocked tasks and their notes
- Group them by common blocking themes
- Identify root causes and suggest resolution strategies
- Write a clear markdown report
EOF
}

build_block_reporter_user_prompt() {
  local blocked_tasks="$1"
  local output_path="$2"

  cat <<EOF
Generate a blocked tasks report. Write it to: ${output_path}

Blocked Tasks:
${blocked_tasks}

Create a markdown report with:
1. Executive summary (total blocked, categories)
2. Blocked tasks grouped by theme/root cause
3. Each task: ID, name, notes, attempt count
4. Recommended resolution strategy for each group
5. Suggested order to unblock tasks
EOF
}

_get_test_type_instructions() {
  local tt="$1"
  case "$tt" in
    Unit) cat <<'EOFTI'
Objective: Verify individual functions/methods behave correctly in isolation.
- Write and execute unit tests covering: expected inputs, boundary values, null/empty inputs, error conditions.
- Mock all external dependencies. Report: total tests, passed, failed, coverage %.
- If no testable units, auto-PASS with a skip note.
EOFTI
    ;;
    Integration) cat <<'EOFTI'
Objective: Verify components interact correctly with their dependencies.
- Identify integration points affected by changeset. Test data flows across boundaries.
- Test both success and failure scenarios. Report: tests run, passed, failed.
- If no integration points, auto-PASS with a skip note.
EOFTI
    ;;
    Contract) cat <<'EOFTI'
Objective: Validate API interfaces conform to documented specifications.
- Compare actual schemas against API docs. Verify status codes, structures, types.
- Report: schema mismatches, undocumented fields, contract violations.
- If no API endpoints, auto-PASS with a skip note.
EOFTI
    ;;
    Regression) cat <<'EOFTI'
Objective: Confirm existing functionality not broken by changes.
- Execute full automated test suite for affected modules. Compare against baseline.
- Report: tests run, passed, failed, newly failing tests.
EOFTI
    ;;
    Smoke) cat <<'EOFTI'
Objective: Quickly verify application is functional and critical paths work.
- Test startup, health checks, auth flows, three most critical journeys.
- Report: pass/fail for each critical path.
EOFTI
    ;;
    Security) cat <<'EOFTI'
Objective: Identify security vulnerabilities in changes.
- Scan for injection flaws, broken auth, data exposure, insecure configs.
- Check input sanitisation, authorisation controls, new dependency CVEs.
- Report: vulnerabilities, severity, remediation suggestions.
EOFTI
    ;;
    Performance) cat <<'EOFTI'
Objective: Verify changes meet performance expectations.
- Measure response times for affected endpoints. Flag >20% increase.
- Check for memory leaks or excessive resource consumption.
- Report: response times (p50, p95, p99), throughput, error rate.
EOFTI
    ;;
    Accessibility) cat <<'EOFTI'
Objective: Verify UI changes meet accessibility standards (WCAG 2.1 AA).
- If no UI changes, auto-PASS with a skip note.
- Run automated scans, verify keyboard nav, check contrast, ARIA labels.
- Report: violations, severity, WCAG criterion.
EOFTI
    ;;
    Exploratory) cat <<'EOFTI'
Objective: Discover edge cases and unexpected behaviours.
- Test unusual inputs, rapid actions, interrupted workflows.
- Try to break the feature. Report: unexpected behaviours, steps to reproduce.
EOFTI
    ;;
    UAT) cat <<'EOFTI'
Objective: Validate feature meets business requirements from end user perspective.
- Act as end user. Read each acceptance criterion and perform described action.
- Verify visible outcomes match criteria. Test happy path then alternatives.
- Report: pass/fail per criterion, usability observations.
EOFTI
    ;;
  esac
}

build_test_type_system_prompt() {
  local test_type="$1"
  local needs_browser="$2"
  local common_context
  common_context=$(build_common_context)
  local instructions
  instructions=$(_get_test_type_instructions "$test_type")
  local browser_context=""
  if [[ "$needs_browser" == "yes" && -n "${APPLICATION_URL:-}" ]]; then
    browser_context="Browser Testing: Navigate to ${APPLICATION_URL}."
  elif [[ "$needs_browser" == "optional" && -n "${APPLICATION_URL:-}" ]]; then
    browser_context="Browser Testing (optional): Available at ${APPLICATION_URL}."
  fi
  cat <<EOF
You are a ${test_type} Tests specialist for ${PROJECT_NAME}.

${common_context}
${browser_context}

${instructions}

Build: ${BUILD_CMD}  Lint: ${LINT_CMD}

If not applicable, output VERDICT: PASS with skip note.

Output format:
NOTES_START
[detailed test notes]
NOTES_END

VERDICT: PASS or VERDICT: FAIL
EOF
}

build_test_type_user_prompt() {
  local test_type="$1"
  local task_json="$2"
  local previous="${3:-}"
  local tid tname desc notes crit
  tid=$(echo "$task_json" | jq -r '.id')
  tname=$(echo "$task_json" | jq -r '.name')
  desc=$(echo "$task_json" | jq -r '.description')
  notes=$(echo "$task_json" | jq -r '.notes')
  crit=$(echo "$task_json" | jq -r '.acceptance_criteria[] | "- " + .criterion')
  cat <<EOF
Run ${test_type} Tests for task:
Task ID: ${tid}  Name: ${tname}
Description: ${desc}
Criteria:
${crit}
Notes: ${notes}
${previous:+Previous results: ${previous}}
EOF
}

build_story_test_system_prompt() {
  local test_type="$1"
  local needs_browser="$2"
  local common_context
  common_context=$(build_common_context)
  local instructions
  instructions=$(_get_test_type_instructions "$test_type")
  local browser_context=""
  if [[ "$needs_browser" == "yes" && -n "${APPLICATION_URL:-}" ]]; then
    browser_context="Browser Testing: Navigate to ${APPLICATION_URL}."
  elif [[ "$needs_browser" == "yes" && -z "${APPLICATION_URL:-}" ]]; then
    browser_context="No applicationUrl configured. Fall back to code-level verification."
  elif [[ "$needs_browser" == "optional" && -n "${APPLICATION_URL:-}" ]]; then
    browser_context="Browser Testing (optional): Available at ${APPLICATION_URL}."
  fi
  cat <<EOF
You are a ${test_type} Tests specialist performing story-level testing for ${PROJECT_NAME}.

${common_context}
${browser_context}

All tasks in this story have passed task-level tests.

${instructions}

Build: ${BUILD_CMD}  Lint: ${LINT_CMD}

If not applicable, output VERDICT: PASS with skip note.
If a test fails, identify which file(s) caused the issue.

Output format:
NOTES_START
[detailed test notes]
NOTES_END

VERDICT: PASS or VERDICT: FAIL
EOF
}

build_story_test_user_prompt() {
  local test_type="$1"
  local story_json="$2"
  local tasks_json="$3"
  local previous="${4:-}"
  local sid sname sdesc snotes scrit tsummaries
  sid=$(echo "$story_json" | jq -r '.id')
  sname=$(echo "$story_json" | jq -r '.name')
  sdesc=$(echo "$story_json" | jq -r '.description')
  snotes=$(echo "$story_json" | jq -r '.notes')
  scrit=$(echo "$story_json" | jq -r '.acceptance_criteria[] | "- " + .criterion')
  tsummaries=$(echo "$tasks_json" | jq -r '.[] | "Task \(.id): \(.name)\n  \(.description)\n  Criteria: " + ([.acceptance_criteria[] | .criterion] | join(", "))')
  local uat_note=""
  if [[ "$test_type" == "UAT" ]]; then
    uat_note="IMPORTANT: Execute each story AC literally as a user would."
  fi
  cat <<EOF
Run ${test_type} Tests for story:
Story ID: ${sid}  Name: ${sname}
Description: ${sdesc}
Story Criteria:
${scrit}
Child Tasks:
${tsummaries}
Notes: ${snotes}
${previous:+Previous results: ${previous}}
${uat_note}
EOF
}
