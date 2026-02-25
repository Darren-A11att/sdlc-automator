# SDLC Automator

## Project Overview

A generic, project-agnostic SDLC automation pipeline. Processes tasks from a JSON backlog through sequential stages using Claude Code CLI in headless mode. Can be pointed at any project by configuring `project.json`.

## Architecture

### Pipeline Flow
```
[Phase -1: Schema Compatibility (automatic)]
  Load backlog JSON → Run compatibility check against canonical schema
    PASS → proceed (no adapter)
    FAIL → Check schema matrix for existing map
      FOUND → load map → create adapter
      NOT FOUND → invoke Opus agent → generate map → register in matrix → create adapter
  Backlog class uses adapter for all read()/write() (preserves external format)

[Phase 0: Doc-First (optional, --epic-brief:path)]
  Epic Brief + Backlog → 4 parallel doc-updater agents (Sonnet) → Updated docs → Git commit

[Phase 0.5: Worktree Setup (if worktree.enabled in project.json)]
  Record base branch → Create feature branch + worktree → Symlinks + setup commands

[Phase 1: Task Processing Loop]
  For each task:
    Has story_id? → get-or-create story worktree → run in story worktree
    No story_id?  → run in feature worktree

  Todo → In-Progress (Implementer/Sonnet) → Review (Reviewer/Opus) → Testing (Tester/Opus) → Done
                                                ↓ FAIL                       ↓ FAIL
                                           Fixer (Opus) →                Fixer (Opus) → Re-test

  Story complete? → merge story branch → feature branch
  All tasks done? → merge feature branch → base branch
```

The main loop retries each task until it reaches a terminal state (Done or Blocked) — it is not one-shot. All 6 failure paths in `process_task()` reset the task to Todo (via `update_task_status "$task_id" "Todo"`) before returning, so the outer retry loop picks it up again.

- **Attempt 1**: Full pipeline — Implement → Review → Test → Done
- **Attempt 2+**: Skips implementation (code already exists) — Review → Test → Done
- **MAX_ATTEMPTS=5**: After 5 attempts the task is marked Blocked
- **Re-test flow**: Test FAIL → Fix → Re-test → Done (or back to Todo for next attempt)

### Key Files
- `scripts/run-tasks.sh` - Main entry point, orchestrates the pipeline
- `scripts/lib/prompts.sh` - System/user prompt templates for each agent role (loads `project.json`)
- `scripts/lib/cli-wrapper.sh` - Claude/Kimi CLI invocation and output parsing
- `scripts/lib/json-ops.sh` - Atomic JSON operations on the backlog file
- `scripts/lib/logging.sh` - Session logging and task summary utilities
- `scripts/lib/format-stream.sh` - Stream formatting for verbose mode (Claude + Kimi JSONL)
- `project.json` - **Project-specific config** (name, tech stack, conventions, doc paths, build commands)
- `tasks/backlog_tasks.json` - Task backlog with status tracking and acceptance criteria
- `agent-loop/state.json` - Agent loop state (active/inactive, iteration tracking)

### Project Configuration

All project-specific settings live in `project.json` at the project root. This is the single source of truth for:
- Project name and description
- Tech stack
- Coding conventions
- Paths to documentation files (PRD, solution design, business flows, system diagram)
- Epic brief path for doc-first phase (optional)
- Build and lint commands
- Testing configuration: application URL, dev server settings, MCP config path (optional)
- Git worktree isolation settings (optional)

To set up a new project, copy `templates/project.json` and customise it.

### Templates Directory
```
templates/
  project.json              # Template project config
  mcp-puppeteer.json        # MCP Puppeteer config for browser tests
  docs/
    prd.md                   # Generic PRD template
    solution-design.md       # Generic solution design template
    business-flows.md        # Generic business flows template
    system-diagram.md        # Generic system diagram template
  tasks/
    backlog_tasks.json       # Template backlog (schema + example tasks)
  schemas/
    canonical.schema.json    # Canonical backlog schema reference
    matrix.json              # Schema mapping registry
    maps/                    # Generated bidirectional schema maps
```

### Models
- **Sonnet 4.5** (`claude-sonnet-4-5-20250929`): Implementation (first attempt)
- **Opus 4.6** (`claude-opus-4-6`): Review, Testing, Fixing, Blocker Analysis, Reports

### Agent Roles
1. **Implementer** - Builds features from acceptance criteria
2. **Reviewer** - Code review for quality, security, conventions
3. **Tester** - Verifies each acceptance criterion individually (task + story level)
4. **Fixer** - Fixes issues found during review or testing
5. **Blocker Analyst** - Determines task dependency blockers
6. **Block Reporter** - Generates blocked tasks report
7. **Doc Updater** (x4) - Updates project docs from epic brief (4 personas: Solutions Architect, Product Manager, Business Analyst, System Architect)
8. **Schema Mapper** - Generates bidirectional schema maps for external backlog formats

### Task Statuses
`Todo` → `In-Progress` → `Review` → `Testing` → `Done` | `Blocked`

### Constants
```
MAX_ATTEMPTS=5               # Task retry attempts before marking Blocked
MAX_STORY_ATTEMPTS=3         # Story-level test retry attempts before marking Blocked
MAX_CONSECUTIVE_BLOCKS=5     # Consecutive blocked tasks before stopping + generating report

MAX_TURNS_IMPLEMENTER=25     # Max CLI turns per agent invocation
MAX_TURNS_REVIEWER=15
MAX_TURNS_TESTER=15
MAX_TURNS_FIXER=20
MAX_TURNS_TEST_FIXER=15      # Fixer turns for test orchestration failures
MAX_TURNS_BLOCKER=5
MAX_TURNS_REPORTER=10
MAX_TURNS_DOC_UPDATER=15
MAX_TURNS_SCHEMA_MAPPER=5
MAX_TURNS_TESTER_BROWSER=25  # Extended turns for browser-based tests (Puppeteer)

ALLOWED_TOOLS="Bash,Read,Edit,Write,Glob,Grep"
ALLOWED_TOOLS_BROWSER=ALLOWED_TOOLS + mcp__puppeteer__puppeteer_{navigate,screenshot,click,fill,select,hover,evaluate}
VERBOSE=true                 # Default: stream real-time output

# Task-level test types (sequential per task):
#   Unit (10 turns) → Integration (12 turns) → Contract (8 turns)
# Story-level test types (sequential per story after all tasks Done):
#   Regression (12) → Smoke (8) → Security (10) → Performance (10) →
#   Accessibility (10) → Exploratory (10) → UAT (15, browser-required)
```

## Library Reference

### Stream Formatting (`scripts/lib/format-stream.sh`)

Formats raw JSONL agent output as readable single-line summaries for terminal display.

- `format_stream_claude()` — Filters Claude CLI `stream-json` output. Routes by `.type`: `assistant` (thinking/text/tool_use blocks), `user` (tool results), `result` (completion stats). Skips `system` lines.
- `format_stream_kimi()` — Filters Kimi JSONL output. Handles array `.content` (think/text blocks) + `.tool_calls` array. Tool results come via `"role":"tool"` lines.
- `_format_kimi_tool_call()` — Maps Kimi tool names to readable labels: `ReadFile`→Read, `StrReplaceFile`→Edit, `WriteFile`→Write, `RunCommand`→Bash, `SearchText`/`GrepTool`→Grep, `ListDirectory`→LS, `SetTodoList`→Todo
- Display tags: `[THINK]` (dim), `[TEXT]` (cyan), `[TOOL]` (yellow), `[RSLT]` (green/red), `[DONE]` (blue)
- Raw JSONL passes to **stdout** for variable capture; formatted summaries go to **stderr** for terminal display

### CLI Provider Switching (`scripts/lib/cli-wrapper.sh`)

- `invoke_agent()` — Dispatcher that routes to `invoke_claude()` or `invoke_kimi()` based on `CLI_PROVIDER` global
- **Implementer** uses `invoke_agent()` (respects CLI_PROVIDER); **Reviewer, Tester, Fixer, Blocker, Reporter** call `invoke_claude()` directly (always use Claude)
- **VERBOSE mode**: Pipes output through `format_stream_claude()` / `format_stream_kimi()`. **Normal mode**: Captures silently with `--output-format json` (Claude) or `--final-message-only` (Kimi)
- **Kimi differences**: No `--append-system-prompt` support — system and user prompts are combined manually with `=== SYSTEM INSTRUCTIONS ===` / `=== TASK ===` delimiters. Model and max_turns are configured in `~/.kimi/config.toml` (arguments ignored).
- Output extraction functions:
  - `parse_verdict()` — Extracts `VERDICT: PASS|FAIL` → returns `PASS`, `FAIL`, or `UNKNOWN`
  - `parse_notes()` — Extracts content between `NOTES_START` / `NOTES_END` markers
  - `parse_criteria_results()` — Extracts and validates JSON between `CRITERIA_JSON_START` / `CRITERIA_JSON_END` markers

### JSON Operations API (`scripts/lib/json-ops.sh`)

All writes use atomic pattern: temp file `${BACKLOG_FILE}.tmp.$$` → `mv`. All jq operations use `--arg`/`--argjson` for safe variable interpolation.

| Function | Purpose |
|---|---|
| `update_backlog()` | Apply arbitrary jq filter atomically to BACKLOG_FILE |
| `get_next_todo_task()` | Returns JSON of first task with status `Todo` |
| `get_task_by_id($id)` | Returns full task JSON by ID |
| `validate_task_exists($id)` | Returns 0 if exists, 1 with error if not |
| `update_task_status($id, $status)` | Set task status atomically |
| `increment_attempt_count($id)` | Increment or initialize `attempt_count` |
| `get_attempt_count($id)` | Returns numeric attempt count (0 if unset) |
| `append_task_notes($id, $text)` | Append timestamped note to task |
| `reset_task_to_todo($id)` | Reset status to Todo, attempt_count to 0, all criteria.met to false |
| `get_blocked_tasks()` | Returns JSON array of all Blocked tasks |
| `update_criteria_met($id, $json)` | Merge criteria results into task's acceptance_criteria |
| `check_all_criteria_passed($id)` | Returns `true` if all criteria met, `false` otherwise |

### Logging (`scripts/lib/logging.sh`)

- `init_session_log()` — Creates `logs/run-YYYYMMDD-HHMMSS.log`, sets global `SESSION_LOG_FILE`
- `log "LEVEL" "message"` — Writes `[timestamp] [LEVEL] message` to stdout + session log. Levels: `INFO`, `WARN`, `ERROR`, `DEBUG`
- `get_task_log_dir($task_id)` — Returns `logs/tasks/<task_id>/`, creates if needed. Per-agent log files: `implement.log`, `review.log`, `test.log`, `fix-N.log`, `blocker-analysis.log`
- `print_summary($backlog_file)` — Formatted table of task status counts (Done, In-Progress, Review, Testing, Todo, Blocked, Total)
- `print_usage()` — Help text for `run-tasks.sh --help`

### Prompt System (`scripts/lib/prompts.sh`)

- `load_project_config()` — Reads `project.json` and exports: `PROJECT_NAME`, `TECH_STACK`, `BUILD_CMD`, `LINT_CMD`, `CONVENTIONS`, `DOC_SOLUTION_DESIGN`, `DOC_PRD`, `DOC_BUSINESS_FLOWS`
- `build_common_context()` — Shared context block injected into all agent system prompts (project name, tech stack, doc paths, conventions)
- Prompt builders per role: `build_{role}_system_prompt()` and `build_{role}_user_prompt($task_json, ...)`
- Output format markers per role:
  - **Implementer**: `FILES_CHANGED_START` / `FILES_CHANGED_END`
  - **Reviewer**: `NOTES_START` / `NOTES_END`, `VERDICT: PASS|FAIL`
  - **Tester**: `CRITERIA_JSON_START` / `CRITERIA_JSON_END`, `VERDICT: PASS|FAIL`
  - **Fixer**: `FILES_CHANGED_START` / `FILES_CHANGED_END`
  - **Blocker Analyst**: `BLOCKER_VERDICT: CLEAR|BLOCKED`, `BLOCKER_REASON: ...`
  - **Block Reporter**: Writes markdown report to `reports/blocked-report-YYYYMMDD.md`

### Git Integration

- `git_commit_task($task_id, $task_name)` — Conventional commit on Done: `feat: {name} ({id})` with `Co-Authored-By: Claude`. Stages all changes, pushes to remote.
- `git_commit_progress($task_id, $stage)` — WIP commit after each pipeline stage: `wip: {id} - {stage}`. Used after implementation, review fixes, and test fixes.

### Signal Handling

`cleanup()` runs on SIGINT/SIGTERM:
- Removes temp files (`${BACKLOG_FILE}.tmp.*`)
- Preserves current task state (does not reset)
- Prints task summary before exit

## Development Conventions

### Shell Scripts
- Use `set -euo pipefail` in all scripts
- Atomic writes: write to temp file then `mv` for JSON updates
- Use `jq --arg` / `--argjson` for variable interpolation (never string concat)
- Log with `log "LEVEL" "message"` function
- Agent output parsing uses structured markers (VERDICT, NOTES_START/END, CRITERIA_JSON_START/END, FILES_CHANGED_START/END)

### Running the Pipeline
```bash
./scripts/run-tasks.sh                        # Process from first Todo task
./scripts/run-tasks.sh --retry:4.22.100       # Reset and retry specific task
./scripts/run-tasks.sh --start-from:5.30.150  # Start from specific task
./scripts/run-tasks.sh --cli-kimi             # Use Kimi for implementation
./scripts/run-tasks.sh --verbose              # Stream real-time output (default)
```

- **Exit codes**: `0` = all tasks processed successfully, `1` = error or consecutive block limit hit
- **`--retry`**: Resets the specified task to Todo (clears attempt_count and criteria) then processes it once
- **`--start-from`**: Temporarily marks earlier Todo tasks as In-Progress, finds the target, then restores skipped tasks to Todo before processing
- **Blocked chain detection**: If `MAX_CONSECUTIVE_BLOCKS` (5) consecutive tasks are blocked, the pipeline stops and generates a report via Block Reporter to `reports/blocked-report-YYYYMMDD.md`

### Backlog JSON Schema
Tasks have: `id`, `name`, `status`, `description`, `acceptance_criteria[]`, `notes`, `attempt_count`

Each acceptance criterion: `{ "criterion": "text", "met": true|false }`

## TypeScript SDK Pipeline (branch: `agent-sdk`)

### Running with SDK
```bash
npm install                                        # Install dependencies (first time)
npx tsx src/run-tasks.ts                           # Process from first Todo task
npx tsx src/run-tasks.ts --retry:4.22.100          # Reset and retry specific task
npx tsx src/run-tasks.ts --start-from:5.30.150     # Start from specific task
npx tsx src/run-tasks.ts --cli-kimi                # Use Kimi for implementation
npx tsx src/run-tasks.ts --verbose                 # Stream real-time output (default)
npx tsx src/run-tasks.ts --epic-brief:docs/epic.md # Run doc-first phase before tasks
npx tsc --noEmit                                   # Type check
```

### TypeScript Module Structure
```
src/
  run-tasks.ts                  ← Entry point (replaces scripts/run-tasks.sh)
  config.ts                     ← Constants, models, max turns, allowed tools, test type configs
  types.ts                      ← TaskStatus, StoryStatus, Task, Story, BacklogFile, AgentRole,
                                   TestTypeName, TestTier, TestOrchestrationResult, DevServerConfig,
                                   schema mapping types (CompatibilityResult, SchemaMap, etc.)

  agents/
    types.ts                    ← AgentOptions, McpStdioServerConfig interfaces
    claude.ts                   ← invokeClaudeAgent() using @anthropic-ai/claude-agent-sdk
    kimi.ts                     ← invokeKimiAgent() using kimi CLI fallback
    index.ts                    ← invokeAgent() dispatcher (routes by CLI_PROVIDER)

  backlog/
    backlog.ts                  ← Backlog class (replaces scripts/lib/json-ops.sh)
    schema-checker.ts           ← checkCompatibility() — validates backlog against canonical schema
    schema-adapter.ts           ← SchemaAdapter class — bidirectional external ↔ canonical transforms
    schema-matrix.ts            ← findMapInMatrix(), registerInMatrix(), loadSchemaMap()

  devserver/
    dev-server.ts               ← DevServer class — start, readiness poll, port reuse, stop
    mcp-config.ts               ← loadMcpConfig() — loads mcpServers from JSON config file

  prompts/
    common.ts                   ← loadProjectConfig(), buildCommonContext()
    implementer.ts              ← buildSystemPrompt(), buildUserPrompt()
    reviewer.ts                 ← (same pattern for each role)
    tester.ts                   ← task + story test prompt builders (buildTestTypeSystemPrompt, etc.)
    fixer.ts
    blocker-analyst.ts
    block-reporter.ts
    doc-updater.ts              ← buildDocUpdaterSystemPrompt/UserPrompt(), persona definitions
    schema-mapper.ts            ← buildSchemaMapperSystemPrompt/UserPrompt() for auto-mapping agent

  runners/
    implementer.ts              ← runImplementer() (replaces bash function)
    reviewer.ts                 ← (same pattern for each role)
    tester.ts
    fixer.ts
    blocker-analysis.ts
    block-reporter.ts
    doc-updater.ts              ← runDocUpdaterPhase() — parallel doc update orchestrator
    schema-mapper.ts            ← runSchemaMapper() — Opus agent for auto-generating schema maps
    task-test-orchestrator.ts   ← runTaskTestOrchestrator() — Unit → Integration → Contract
    story-test-orchestrator.ts  ← runStoryTestOrchestrator() — Regression → Smoke → ... → UAT

  pipeline/
    process-task.ts             ← processTask() core pipeline logic
    process-story.ts            ← processStory() — story-level test pipeline after all tasks Done
    git.ts                      ← gitCommitTask(), gitCommitProgress(), gitCommitDocs()

  logging/
    logger.ts                   ← Logger class (replaces scripts/lib/logging.sh)

  stream/
    formatter.ts                ← formatAgentEvent() (replaces scripts/lib/format-stream.sh)

  parsers/
    verdict.ts                  ← parseVerdict() — regex for VERDICT: PASS|FAIL
    notes.ts                    ← parseNotes() — NOTES_START/END extraction
    criteria.ts                 ← parseCriteriaResults() — CRITERIA_JSON_START/END extraction

  worktree/
    worktree.ts                 ← WorktreeManager class — git worktree lifecycle
    config-overlay.ts           ← deriveConfigForWorktree() — config path rebasing
```

### Key Differences from Bash Pipeline
- Uses `@anthropic-ai/claude-agent-sdk` `query()` function instead of `claude -p` CLI subprocess
- Kimi falls back to `kimi` CLI since no npm SDK is available
- All jq operations replaced with native `JSON.parse`/`JSON.stringify` + typed objects
- Typed `switch` on SDK message discriminants instead of JSONL line-by-line parsing
- `process.on("SIGINT", cleanup)` instead of `trap cleanup SIGINT SIGTERM`
- The `scripts/` bash pipeline is preserved for backward compatibility

### Git Worktree Integration

Optional two-level branching using git worktrees for task/story isolation. Controlled by `project.json`:

```json
"worktree": {
  "enabled": false,
  "branchPrefix": "story",
  "symlinkFiles": [".env", ".env.local"],
  "setupCommands": ["npm install"]
}
```

**Branching Model:**
```
base branch (main/develop)
  └── feat/<epic-slug> (feature branch + worktree)
        ├── [tasks without story_id run here]
        ├── story/S-001-auth (story worktree, branched from feature)
        │     └── merges back to feature when story passes
        └── story/S-002-payments (story worktree)
```

**Directory Layout:**
```
target-project/
  .worktrees/                    # auto-added to .gitignore
    feat-epic-name/              # feature branch worktree
    story-S-001-auth/            # story worktree
    story-S-002-payments/        # story worktree
```

**Lifecycle:**
1. Pipeline start: create feature branch + worktree from base branch
2. Per task: derive config with `projectDir` pointing to appropriate worktree
3. Story complete: merge story branch into feature branch, remove story worktree
4. Pipeline end: merge feature branch into base branch, remove feature worktree

**Key Design:** All runners, prompt builders, and agent modules remain unchanged. The worktree integration works by deriving a `ProjectConfig` with `projectDir` pointing to the worktree path. Since every runner reads `config.projectDir`, redirection is automatic.

**Graceful Degradation:**
- `worktree.enabled: false` → no worktrees, identical to previous behavior
- Feature worktree creation fails → warning, all tasks run on main tree
- Story worktree creation fails → warning, story tasks run on feature worktree
- Merge conflict → branch preserved, story/feature marked for manual resolution
- SIGINT → worktrees force-removed, branches preserved for recovery

### Adaptive Schema Mapping

Backlogs from external tools (JIRA exports, Linear dumps, custom formats) are automatically detected and transformed. The system uses a three-layer approach:

1. **Canonical Schema** (`templates/schemas/canonical.schema.json`) — structural reference for the expected format
2. **Compatibility Checker** (`src/backlog/schema-checker.ts`) — validates incoming JSON, produces fingerprint
3. **Schema Matrix** (`templates/schemas/matrix.json`) — persistent registry of known format mappings
4. **Schema Adapter** (`src/backlog/schema-adapter.ts`) — bidirectional transforms at read/write boundaries
5. **Auto-Mapping Agent** (`src/runners/schema-mapper.ts`) — Opus generates maps for unknown formats

**Flow:** On pipeline start, the backlog is checked against canonical schema. If compatible, no adapter is needed. If incompatible, the matrix is checked for an existing map. If none exists, an Opus agent analyzes sample data and generates a bidirectional map, which is registered in the matrix for reuse. The `SchemaAdapter` wraps `Backlog.read()`/`write()` so the external format is preserved through all pipeline operations.

**Key Files:**
- `templates/schemas/canonical.schema.json` — canonical schema definition
- `templates/schemas/matrix.json` — registry of known mappings
- `templates/schemas/maps/*.map.json` — generated bidirectional maps
- `src/backlog/schema-checker.ts` — compatibility check + fingerprinting
- `src/backlog/schema-adapter.ts` — bidirectional SchemaAdapter class
- `src/backlog/schema-matrix.ts` — matrix lookup/registration
- `src/runners/schema-mapper.ts` — Opus agent runner
- `src/prompts/schema-mapper.ts` — system/user prompts for mapper agent

### Two-Tier Test Orchestration

Testing is split into two tiers: task-level tests run per task after implementation + review, and story-level tests run once after all tasks in a story are Done.

**Task-Level Tests** (sequential, halt on critical failure):
1. **Unit** (10 turns) → 2. **Integration** (12 turns) → 3. **Contract** (8 turns)

**Story-Level Tests** (sequential, run after all child tasks Done):
1. **Regression** (12) → 2. **Smoke** (8, browser optional) → 3. **Security** (10) → 4. **Performance** (10) → 5. **Accessibility** (10, browser optional) → 6. **Exploratory** (10, browser optional) → 7. **UAT** (15, browser required)

**Halt/Fix/Retry:** On failure, the orchestrator halts, invokes a Fixer (`MAX_TURNS_TEST_FIXER=15`), then re-runs the failing type. If still failing, the task/story resets for retry.

**Browser Tests:** Tests with `requiresBrowser: true|"optional"` get MCP Puppeteer tools and extended turns (`MAX_TURNS_TESTER_BROWSER=25`) when a dev server is running. `"optional"` falls back to non-browser if unavailable.

**Status Tracking:** During orchestration, status updates to `Testing:Unit`, `Testing:Integration`, `Testing:Smoke`, etc.

**Result:** `TestOrchestrationResult` — `overallVerdict`, `results[]` (per-type verdict/notes/cost), `haltedAt`, `fixAttempted`, `reportPath`

### Dev Server & Browser Testing

Browser-based tests require a running application and MCP Puppeteer integration.

**DevServer Class** (`src/devserver/dev-server.ts`):
- `start()` — spawns process, polls for port readiness via TCP + HTTP; reuses existing server if port occupied
- `stop()` — SIGTERM, waits 5s, SIGKILL if still running; lifecycle managed in `finally` block

**MCP Config** (`src/devserver/mcp-config.ts`):
- `loadMcpConfig(configPath)` — reads `mcpServers` map from JSON (e.g., `templates/mcp-puppeteer.json`)
- Configs passed to `invokeClaudeAgent()` for browser-enabled tests

**`project.json` testing fields:**
```json
"testing": {
  "applicationUrl": "http://localhost:3000",
  "devServer": { "startCommand": "npm run dev", "port": 3000, "readinessTimeoutSeconds": 60, "readinessIntervalSeconds": 2 },
  "mcpConfig": "templates/mcp-puppeteer.json"
}
```

### Story Processing

Stories group related tasks and undergo story-level testing after all child tasks complete.

**Story Entity:** `id`, `name`, `status` (`StoryStatus`), `description`, `acceptance_criteria[]`, `task_ids[]`, `notes`, `attempt_count`

**`StoryStatus`** differs from `TaskStatus` — no `Review` state: `Todo | In-Progress | Testing | Testing:{type} | Done | Blocked`

**`processStory()` Pipeline** (`src/pipeline/process-story.ts`):
1. Verify all child tasks have status `Done`
2. Check attempt count against `MAX_STORY_ATTEMPTS=3`
3. Run `runStoryTestOrchestrator()` (Regression → ... → UAT)
4. On PASS: set status `Done`, git commit
5. On FAIL: reset to `Todo` for retry (up to `MAX_STORY_ATTEMPTS`)

**Worktree Integration:** Story tasks run in a dedicated story worktree. On completion, the story branch merges into the feature branch and the story worktree is removed.
