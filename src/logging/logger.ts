// =============================================================================
// logging/logger.ts - Logging utilities for the SDLC task loop
// =============================================================================
// Ports the bash logging.sh functions as a Logger class.

import * as fs from "fs";
import * as path from "path";
import type { BacklogFile } from "../types.js";

export type LogLevel = "INFO" | "WARN" | "ERROR" | "DEBUG";

/**
 * Logger class providing session-scoped file logging and utility output.
 *
 * Mirrors the behaviour of scripts/lib/logging.sh:
 *   - init_session_log()  -> constructor (creates log file with header)
 *   - log()               -> log()
 *   - get_task_log_dir()  -> getTaskLogDir()
 *   - print_summary()     -> printSummary()
 *   - print_usage()       -> printUsage()
 */
export class Logger {
  /** Absolute path to the logs root directory (e.g. `<project>/logs`) */
  readonly logsDir: string;

  /** Absolute path to the backlog JSON file */
  readonly backlogFile: string;

  /** Absolute path to the current session log file (set by constructor) */
  sessionLogFile: string;

  /**
   * @param logsDir     - Directory where session logs and task sub-logs live
   * @param backlogFile - Path to the backlog JSON file (used by printSummary)
   */
  constructor(logsDir: string, backlogFile: string) {
    this.logsDir = logsDir;
    this.backlogFile = backlogFile;

    // Create logs directory if it does not exist
    fs.mkdirSync(this.logsDir, { recursive: true });

    // Build filename: run-YYYYMMDD-HHMMSS.log
    const timestamp = this._filenameTimestamp();
    this.sessionLogFile = path.join(this.logsDir, `run-${timestamp}.log`);

    // Create the log file and write the session header
    const header = `=== SDLC Task Loop Session Started at ${this._logTimestamp()} ===\n\n`;
    fs.appendFileSync(this.sessionLogFile, header, "utf8");
  }

  /**
   * Log a message to stdout and to the session log file.
   *
   * @param level   - Severity level (INFO | WARN | ERROR | DEBUG)
   * @param message - Message text
   */
  log(level: LogLevel, message: string): void {
    const line = `[${this._logTimestamp()}] [${level}] ${message}`;
    console.log(line);
    fs.appendFileSync(this.sessionLogFile, line + "\n", "utf8");
  }

  /**
   * Return the log directory for a specific task, creating it if necessary.
   *
   * Mirrors `get_task_log_dir()` in logging.sh.
   *
   * @param taskId - Task identifier, e.g. "4.22.100"
   * @returns Absolute path to `logs/tasks/<taskId>/`
   */
  getTaskLogDir(taskId: string): string {
    const taskLogDir = path.join(this.logsDir, "tasks", taskId);
    fs.mkdirSync(taskLogDir, { recursive: true });
    return taskLogDir;
  }

  /**
   * Read the backlog JSON file, count tasks and stories by status, and print a
   * formatted summary table to stdout.
   *
   * Testing:* substates are counted under "Testing".
   */
  printSummary(): void {
    if (!fs.existsSync(this.backlogFile)) {
      this.log("ERROR", `Backlog file not found: ${this.backlogFile}`);
      return;
    }

    const raw = fs.readFileSync(this.backlogFile, "utf8");
    const backlog: BacklogFile = JSON.parse(raw) as BacklogFile;
    const tasks = backlog.tasks ?? [];
    const stories = backlog.stories ?? [];

    // Task counts - Testing:* substates count as "Testing"
    const countTasks = (status: string): number =>
      tasks.filter((t) =>
        status === "Testing"
          ? t.status === "Testing" || t.status.startsWith("Testing:")
          : t.status === status
      ).length;

    const done = countTasks("Done");
    const inProgress = countTasks("In-Progress");
    const review = countTasks("Review");
    const testing = countTasks("Testing");
    const todo = countTasks("Todo");
    const blocked = countTasks("Blocked");
    const total = tasks.length;

    const row = (label: string, value: string | number): void => {
      const lPad = label.padEnd(15);
      const rPad = String(value).padStart(5);
      console.log(`${lPad} ${rPad}`);
    };

    console.log("");
    console.log("=== Task Summary ===");
    console.log("");
    row("Status", "Count");
    row("---------------", "-----");
    row("Done", done);
    row("In-Progress", inProgress);
    row("Review", review);
    row("Testing", testing);
    row("Todo", todo);
    row("Blocked", blocked);
    row("---------------", "-----");
    row("Total", total);
    console.log("");

    // Story summary (if stories exist)
    if (stories.length > 0) {
      const countStories = (status: string): number =>
        stories.filter((s) =>
          status === "Testing"
            ? s.status === "Testing" || s.status.startsWith("Testing:")
            : s.status === status
        ).length;

      const sDone = countStories("Done");
      const sInProgress = countStories("In-Progress");
      const sTesting = countStories("Testing");
      const sTodo = countStories("Todo");
      const sBlocked = countStories("Blocked");
      const sTotal = stories.length;

      console.log("=== Story Summary ===");
      console.log("");
      row("Status", "Count");
      row("---------------", "-----");
      row("Done", sDone);
      row("In-Progress", sInProgress);
      row("Testing", sTesting);
      row("Todo", sTodo);
      row("Blocked", sBlocked);
      row("---------------", "-----");
      row("Total", sTotal);
      console.log("");
    }
  }

  /**
   * Print CLI usage information to stdout.
   *
   * Mirrors `print_usage()` in logging.sh, updated for the TypeScript runner.
   */
  printUsage(): void {
    const text = `\
Usage: npx tsx src/run-tasks.ts [OPTIONS]

Options:
  --help                Show this help message
  --retry:<task_id>     Reset and retry a specific task
  --start-from:<task_id> Start processing from a specific task ID
  --cli-kimi            Use Kimi Code CLI instead of Claude Code CLI
  --verbose             Stream real-time agent output to terminal

Examples:
  npx tsx src/run-tasks.ts                        Process from first Todo task
  npx tsx src/run-tasks.ts --retry:4.22.100       Reset and retry task 4.22.100
  npx tsx src/run-tasks.ts --start-from:5.30.150  Start from task 5.30.150
  npx tsx src/run-tasks.ts --cli-kimi              Use Kimi CLI for implementation

CLI Providers (Implementer stage only):
  claude (default)  Uses Claude Agent SDK with Sonnet for implementation
  kimi              Uses Kimi Agent SDK for implementation
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
  - Run task-level tests (Unit, Integration, Contract) per task
  - Run story-level tests (Regression through UAT) when all tasks pass
  - Log all operations to timestamped log files
  - Provide a summary of task and story statuses

Task Statuses:
  Todo          - Task is ready to be started
  In-Progress   - Task is currently being worked on
  Review        - Task is awaiting code review
  Testing       - Task is in QA/testing phase
  Testing:Unit  - Running unit tests
  Testing:*     - Running specific test type
  Done          - Task is completed
  Blocked       - Task is blocked and cannot proceed

Logs:
  Session logs: logs/run-YYYYMMDD-HHMMSS.log
  Task logs:    logs/tasks/<task_id>/
  Story logs:   logs/stories/<story_id>/

`;
    process.stdout.write(text);
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  /**
   * Returns the current time formatted as `YYYY-MM-DD HH:MM:SS` for log lines.
   */
  private _logTimestamp(): string {
    const now = new Date();
    const pad = (n: number, len = 2): string => String(n).padStart(len, "0");
    return (
      `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}` +
      ` ${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`
    );
  }

  /**
   * Returns the current time formatted as `YYYYMMDD-HHMMSS` for filenames.
   */
  private _filenameTimestamp(): string {
    const now = new Date();
    const pad = (n: number, len = 2): string => String(n).padStart(len, "0");
    return (
      `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}` +
      `-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`
    );
  }
}

export default Logger;
