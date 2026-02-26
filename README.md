# Manera

AI-powered SDLC automation pipeline. Implement, review, test, and fix code using Claude and Kimi agents.

## What it does

Manera processes tasks from a JSON backlog through a full software development lifecycle:

```
Todo → Implement → Review → Test → Done
          ↓ FAIL      ↓ FAIL
        Fix → retry  Fix → re-test
```

Each stage is handled by a specialized AI agent:
- **Implementer** (Sonnet) — builds features from acceptance criteria
- **Reviewer** (Opus) — code review for quality, security, conventions
- **Tester** (Opus) — verifies acceptance criteria with unit, integration, and contract tests
- **Fixer** (Opus) — fixes issues found during review or testing

Tasks retry automatically (up to 5 attempts) before being marked as blocked.

## Quick Start

```bash
npx manera
```

This launches an interactive CLI that guides you through setup and pipeline execution.

### Prerequisites

- Node.js >= 18
- [Claude Code CLI](https://docs.anthropic.com/en/docs/claude-code) installed and authenticated

### First Run

If no `project.json` exists in your current directory, Manera will walk you through creating one. This configures:
- Project name and tech stack
- Build and lint commands
- Documentation paths
- Testing configuration (optional dev server + browser tests)

## Interactive CLI

```
  Manera  v2.0.0
  Project: My App  |  Backlog: tasks/backlog_tasks.json

  ? Main Menu
  > Run Pipeline
    View Status
    Reset Tasks
    Configure Models
    Pipeline Settings
    Switch Backlog
    Exit
```

### Run Pipeline
- **Continue** — process the next Todo tasks sequentially
- **Retry specific task** — reset and re-run a single task
- **Start from specific task** — skip ahead to a particular task
- **Doc-first phase** — update project docs from an epic brief before coding

### Configure Models
Override which model handles each agent role:
- Implementer, Reviewer, Tester, Fixer, Doc Updater
- Choose between `claude-sonnet-4-5-20250929` and `claude-opus-4-6`
- Settings persist to `.sdlc-rc.json`

### Pipeline Settings
- Toggle verbose output
- Switch CLI provider (Claude / Kimi)
- Set epic brief path for doc-first phase

## Headless Mode

Run the pipeline without the interactive CLI:

```bash
npx tsx src/run-tasks.ts                           # Process from first Todo task
npx tsx src/run-tasks.ts --retry:TASK-001          # Reset and retry specific task
npx tsx src/run-tasks.ts --start-from:TASK-005     # Start from specific task
npx tsx src/run-tasks.ts --epic-brief:docs/epic.md # Run doc-first phase
npx tsx src/run-tasks.ts --cli-kimi                # Use Kimi for implementation
```

## Project Configuration

All project-specific settings live in `project.json`:

```json
{
  "project": {
    "name": "My App",
    "description": "A web application",
    "techStack": "Next.js, TypeScript, Tailwind CSS",
    "conventions": "Use functional components, prefer server components"
  },
  "commands": {
    "build": "npm run build",
    "lint": "npm run lint"
  },
  "docs": {
    "prd": "docs/prd.md",
    "solutionDesign": "docs/solution-design.md"
  }
}
```

## Backlog Format

Tasks are defined in a JSON backlog file:

```json
{
  "tasks": [
    {
      "id": "TASK-001",
      "name": "Add user login page",
      "status": "Todo",
      "description": "Create a login form with email and password fields",
      "acceptance_criteria": [
        { "criterion": "Login form renders with email and password fields", "met": false },
        { "criterion": "Form validates email format", "met": false }
      ]
    }
  ]
}
```

## Testing Tiers

### Task-Level (per task)
Unit → Integration → Contract

### Story-Level (after all tasks in a story pass)
Regression → Smoke → Security → Performance → Accessibility → Exploratory → UAT

Browser-based tests (Smoke, Accessibility, Exploratory, UAT) use MCP Puppeteer when a dev server is configured.

## License

MIT
