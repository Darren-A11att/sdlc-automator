# SDLC Automator

## Project Overview

A generic, project-agnostic SDLC automation pipeline. Processes tasks from a JSON backlog through sequential stages using Claude Code CLI in headless mode. Can be pointed at any project by configuring `project.json`.

## Architecture

### Pipeline Flow
```
Todo → In-Progress (Implementer/Sonnet) → Review (Reviewer/Opus) → Testing (Tester/Opus) → Done
                                              ↓ FAIL                       ↓ FAIL
                                         Fixer (Opus) →                Fixer (Opus) → Re-test
```

### Key Files
- `scripts/run-tasks.sh` - Main entry point, orchestrates the pipeline
- `scripts/lib/prompts.sh` - System/user prompt templates for each agent role (loads `project.json`)
- `scripts/lib/cli-wrapper.sh` - Claude/Kimi CLI invocation and output parsing
- `scripts/lib/json-ops.sh` - Atomic JSON operations on the backlog file
- `scripts/lib/logging.sh` - Session logging and task summary utilities
- `project.json` - **Project-specific config** (name, tech stack, conventions, doc paths, build commands)
- `tasks/backlog_tasks.json` - Task backlog with status tracking and acceptance criteria
- `agent-loop/state.json` - Agent loop state (active/inactive, iteration tracking)

### Project Configuration

All project-specific settings live in `project.json` at the project root. This is the single source of truth for:
- Project name and description
- Tech stack
- Coding conventions
- Paths to documentation files (PRD, solution design, business flows, system diagram)
- Build and lint commands

To set up a new project, copy `templates/project.json` and customise it.

### Templates Directory
```
templates/
  project.json              # Template project config
  docs/
    prd.md                   # Generic PRD template
    solution-design.md       # Generic solution design template
    business-flows.md        # Generic business flows template
    system-diagram.md        # Generic system diagram template
  tasks/
    backlog_tasks.json       # Template backlog (schema + example tasks)
```

### Models
- **Sonnet 4.5** (`claude-sonnet-4-5-20250929`): Implementation (first attempt)
- **Opus 4.6** (`claude-opus-4-6`): Review, Testing, Fixing, Blocker Analysis, Reports

### Agent Roles
1. **Implementer** - Builds features from acceptance criteria
2. **Reviewer** - Code review for quality, security, conventions
3. **Tester** - Verifies each acceptance criterion individually
4. **Fixer** - Fixes issues found during review or testing
5. **Blocker Analyst** - Determines task dependency blockers
6. **Block Reporter** - Generates blocked tasks report

### Task Statuses
`Todo` → `In-Progress` → `Review` → `Testing` → `Done` | `Blocked`

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
./scripts/run-tasks.sh --retry:4.22.100       # Retry specific task
./scripts/run-tasks.sh --start-from:5.30.150  # Start from specific task
./scripts/run-tasks.sh --cli-kimi             # Use Kimi for implementation
./scripts/run-tasks.sh --verbose              # Stream real-time output
```

### Backlog JSON Schema
Tasks have: `id`, `name`, `status`, `description`, `acceptance_criteria[]`, `notes`, `attempt_count`

Each acceptance criterion: `{ "criterion": "text", "met": true|false }`
