// =============================================================================
// backlog/backlog.ts - Backlog operations module for SDLC Automator
// =============================================================================
// Ports the 12 json-ops.sh functions as a typed Backlog class.
// All writes use the atomic temp-file-then-rename pattern to match:
//   update_backlog() { local tmp="${BACKLOG_FILE}.tmp.$$"; jq ... > "$tmp" && mv "$tmp" "$BACKLOG_FILE" }

import fs from "node:fs";
import path from "node:path";

import type { Task, TaskStatus, BacklogFile } from "../types.js";

// =============================================================================
// Backlog class
// =============================================================================

export default class Backlog {
  private readonly filePath: string;

  constructor(filePath: string) {
    this.filePath = path.resolve(filePath);
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  /**
   * Reads and parses the JSON backlog file.
   * Throws if the file cannot be read or parsed.
   */
  private read(): BacklogFile {
    const raw = fs.readFileSync(this.filePath, "utf8");
    return JSON.parse(raw) as BacklogFile;
  }

  /**
   * Atomically writes `data` to the backlog file.
   * Matches the bash pattern:
   *   local tmp="${BACKLOG_FILE}.tmp.$$"
   *   jq ... > "$tmp" && mv "$tmp" "$BACKLOG_FILE"
   * Cleans up the temp file on failure.
   */
  private write(data: BacklogFile): void {
    const tmpPath = `${this.filePath}.tmp.${process.pid}`;
    try {
      fs.writeFileSync(tmpPath, JSON.stringify(data, null, 2), "utf8");
      fs.renameSync(tmpPath, this.filePath);
    } catch (err) {
      try {
        fs.unlinkSync(tmpPath);
      } catch {
        // Best-effort cleanup; ignore errors on the cleanup itself.
      }
      throw err;
    }
  }

  // ---------------------------------------------------------------------------
  // Public API — ports of json-ops.sh functions
  // ---------------------------------------------------------------------------

  /**
   * Returns the first task whose status is "Todo", or null if none exists.
   * Ports: get_next_todo_task()
   *   jq '[.tasks[] | select(.status == "Todo")] | first // empty'
   */
  getNextTodoTask(): Task | null {
    const data = this.read();
    return data.tasks.find((t) => t.status === "Todo") ?? null;
  }

  /**
   * Returns the task with the given id, or null if not found.
   * Ports: get_task_by_id()
   *   jq --arg id "$1" '.tasks[] | select(.id == $id)'
   */
  getTaskById(id: string): Task | null {
    const data = this.read();
    return data.tasks.find((t) => t.id === id) ?? null;
  }

  /**
   * Returns true if a task with the given id exists, false otherwise.
   * Ports: validate_task_exists()
   *   task=$(get_task_by_id "$task_id"); [ -z "$task" ] && return 1
   */
  validateTaskExists(id: string): boolean {
    return this.getTaskById(id) !== null;
  }

  /**
   * Sets the status of the specified task.
   * Ports: update_task_status()
   *   .tasks |= map(if .id == $id then .status = $status else . end)
   */
  updateTaskStatus(id: string, status: TaskStatus): void {
    const data = this.read();
    data.tasks = data.tasks.map((t) =>
      t.id === id ? { ...t, status } : t
    );
    this.write(data);
  }

  /**
   * Increments the attempt_count for the specified task.
   * Initialises to 1 if attempt_count is not yet set (matches `(.attempt_count + 1 // 1)`).
   * Ports: increment_attempt_count()
   *   .tasks |= map(if .id == $id then .attempt_count = (.attempt_count + 1 // 1) else . end)
   */
  incrementAttemptCount(id: string): void {
    const data = this.read();
    data.tasks = data.tasks.map((t) => {
      if (t.id !== id) return t;
      const current = typeof t.attempt_count === "number" ? t.attempt_count : 0;
      return { ...t, attempt_count: current + 1 };
    });
    this.write(data);
  }

  /**
   * Returns the current attempt_count for the specified task, or 0 if unset.
   * Ports: get_attempt_count()
   *   jq --arg id "$1" '.tasks[] | select(.id == $id) | .attempt_count // 0'
   */
  getAttemptCount(id: string): number {
    const task = this.getTaskById(id);
    if (!task) return 0;
    return typeof task.attempt_count === "number" ? task.attempt_count : 0;
  }

  /**
   * Appends a timestamped note to the task's notes field.
   * Ports: append_task_notes()
   *   Appends "[timestamp] note" to task.notes
   */
  appendTaskNotes(id: string, text: string): void {
    const data = this.read();
    const timestamp = new Date().toISOString();
    const entry = `[${timestamp}] ${text}`;
    data.tasks = data.tasks.map((t) => {
      if (t.id !== id) return t;
      const existing = t.notes ?? "";
      const updated = existing.length > 0 ? `${existing}\n${entry}` : entry;
      return { ...t, notes: updated };
    });
    this.write(data);
  }

  /**
   * Resets a task back to Todo status:
   *   - status = "Todo"
   *   - attempt_count = 0
   *   - all acceptance_criteria[].met = false
   * Ports: reset_task_to_todo()
   *   .status = "Todo" | .attempt_count = 0 | .acceptance_criteria[].met = false
   */
  resetTaskToTodo(id: string): void {
    const data = this.read();
    data.tasks = data.tasks.map((t) => {
      if (t.id !== id) return t;
      return {
        ...t,
        status: "Todo" as TaskStatus,
        attempt_count: 0,
        acceptance_criteria: t.acceptance_criteria.map((ac) => ({
          ...ac,
          met: false,
        })),
      };
    });
    this.write(data);
  }

  /**
   * Returns all tasks whose status is "Blocked".
   * Ports: get_blocked_tasks()
   *   jq '[.tasks[] | select(.status == "Blocked")]'
   */
  getBlockedTasks(): Task[] {
    const data = this.read();
    return data.tasks.filter((t) => t.status === "Blocked");
  }

  /**
   * Merges criteria results into the task's acceptance_criteria array.
   * For each task criterion, if the incoming `criteria` array contains an entry
   * with a matching `criterion` text, updates `.met` to the incoming value.
   * Non-matching criteria are left untouched.
   * Ports: update_criteria_met()
   *   For each task AC, if criteria_json has matching criterion text, update .met
   */
  updateCriteriaMet(
    id: string,
    criteria: Array<{ criterion: string; met: boolean }>
  ): void {
    const data = this.read();
    // Build a lookup map from criterion text → met value for O(1) access.
    const incoming = new Map<string, boolean>(
      criteria.map((c) => [c.criterion, c.met])
    );
    data.tasks = data.tasks.map((t) => {
      if (t.id !== id) return t;
      return {
        ...t,
        acceptance_criteria: t.acceptance_criteria.map((ac) => {
          if (incoming.has(ac.criterion)) {
            return { ...ac, met: incoming.get(ac.criterion) as boolean };
          }
          return ac;
        }),
      };
    });
    this.write(data);
  }

  /**
   * Returns true if every acceptance criterion for the task has `.met === true`.
   * Returns false if any criterion is unmet, or if the task does not exist.
   * Ports: check_all_criteria_passed()
   *   Returns true if all acceptance_criteria have .met == true
   */
  checkAllCriteriaPassed(id: string): boolean {
    const task = this.getTaskById(id);
    if (!task) return false;
    if (task.acceptance_criteria.length === 0) return false;
    return task.acceptance_criteria.every((ac) => ac.met === true);
  }
}
