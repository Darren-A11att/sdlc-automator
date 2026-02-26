// =============================================================================
// cli/status.ts - Status tables, task detail view, task picker
// =============================================================================

import { select } from "@inquirer/prompts";
import chalk from "chalk";
import Table from "cli-table3";
import type Backlog from "../backlog/backlog.js";
import type { Task, Story } from "../types.js";

// =============================================================================
// Status counts
// =============================================================================

interface StatusCounts {
  tasks: Record<string, number>;
  stories: Record<string, number>;
  taskTotal: number;
  storyTotal: number;
}

function getStatusCounts(backlog: Backlog): StatusCounts {
  const allTasks = backlog.getAllTasks();
  const taskCounts: Record<string, number> = {};
  for (const t of allTasks) {
    const key = t.status.startsWith("Testing:") ? "Testing" : t.status;
    taskCounts[key] = (taskCounts[key] ?? 0) + 1;
  }

  // Stories — we need to read the raw backlog since Backlog doesn't expose getAllStories
  const stories: Story[] = [];
  try {
    // Use a workaround: check each task for story_id, collect unique story IDs
    const storyIds = new Set<string>();
    for (const t of allTasks) {
      if (t.story_id) storyIds.add(t.story_id);
    }
    for (const sid of storyIds) {
      const story = backlog.getStoryById(sid);
      if (story) stories.push(story);
    }
  } catch { /* no stories */ }

  const storyCounts: Record<string, number> = {};
  for (const s of stories) {
    const key = s.status.startsWith("Testing:") ? "Testing" : s.status;
    storyCounts[key] = (storyCounts[key] ?? 0) + 1;
  }

  return {
    tasks: taskCounts,
    stories: storyCounts,
    taskTotal: allTasks.length,
    storyTotal: stories.length,
  };
}

// =============================================================================
// Summary table
// =============================================================================

function showSummaryTable(backlog: Backlog): void {
  const counts = getStatusCounts(backlog);

  const statusOrder = ["Done", "In-Progress", "Review", "Testing", "Todo", "Blocked"];

  const table = new Table({
    head: [chalk.bold("Status"), chalk.bold("Tasks"), ...(counts.storyTotal > 0 ? [chalk.bold("Stories")] : [])],
    colAligns: ["left", "right", ...(counts.storyTotal > 0 ? ["right" as const] : [])],
  });

  for (const status of statusOrder) {
    const taskCount = counts.tasks[status] ?? 0;
    const storyCount = counts.stories[status] ?? 0;
    if (taskCount === 0 && storyCount === 0) continue;

    const colorFn =
      status === "Done" ? chalk.green :
      status === "Blocked" ? chalk.red :
      status === "In-Progress" || status === "Testing" ? chalk.yellow :
      status === "Review" ? chalk.blue :
      chalk.white;

    const row = [colorFn(status), String(taskCount)];
    if (counts.storyTotal > 0) row.push(String(storyCount));
    table.push(row);
  }

  // Total row
  const totalRow = [chalk.bold("Total"), chalk.bold(String(counts.taskTotal))];
  if (counts.storyTotal > 0) totalRow.push(chalk.bold(String(counts.storyTotal)));
  table.push(totalRow);

  console.log("");
  console.log(table.toString());
  console.log("");
}

// =============================================================================
// Task detail view
// =============================================================================

function showTaskDetail(task: Task): void {
  console.log("");
  console.log(chalk.bold(`  Task: ${task.id} - ${task.name}`));
  console.log(`  Status: ${colorizeStatus(task.status)}`);
  console.log(`  Attempts: ${task.attempt_count}`);
  if (task.story_id) console.log(`  Story: ${task.story_id}`);
  console.log("");
  console.log(chalk.bold("  Description:"));
  console.log(`  ${task.description}`);
  console.log("");
  console.log(chalk.bold("  Acceptance Criteria:"));
  for (const ac of task.acceptance_criteria) {
    const icon = ac.met ? chalk.green("\u2713") : chalk.red("\u2717");
    console.log(`  ${icon} ${ac.criterion}`);
  }
  if (task.notes) {
    console.log("");
    console.log(chalk.bold("  Notes:"));
    const lines = task.notes.split("\n").slice(-10); // Show last 10 lines
    for (const line of lines) {
      console.log(`  ${chalk.dim(line)}`);
    }
  }
  console.log("");
}

function colorizeStatus(status: string): string {
  if (status === "Done") return chalk.green(status);
  if (status === "Blocked") return chalk.red(status);
  if (status.startsWith("Testing")) return chalk.yellow(status);
  if (status === "In-Progress") return chalk.yellow(status);
  if (status === "Review") return chalk.blue(status);
  return status;
}

// =============================================================================
// Task picker
// =============================================================================

async function pickTask(backlog: Backlog): Promise<Task | null> {
  const tasks = backlog.getAllTasks();
  if (tasks.length === 0) {
    console.log(chalk.dim("  No tasks found."));
    return null;
  }

  const choices = tasks.map((t) => ({
    name: `${t.id.padEnd(12)} ${colorizeStatus(t.status).padEnd(20)} ${t.name.slice(0, 50)}`,
    value: t.id,
  }));
  choices.push({ name: chalk.dim("Back"), value: "__back__" });

  const taskId = await select({ message: "Select a task", choices });
  if (taskId === "__back__") return null;
  return backlog.getTaskById(taskId);
}

// =============================================================================
// Blocked tasks view
// =============================================================================

function showBlockedTasks(backlog: Backlog): void {
  const blocked = backlog.getBlockedTasks();
  if (blocked.length === 0) {
    console.log(chalk.green("\n  No blocked tasks.\n"));
    return;
  }

  const table = new Table({
    head: [chalk.bold("ID"), chalk.bold("Name"), chalk.bold("Attempts"), chalk.bold("Notes (last)")],
    colWidths: [14, 40, 10, 50],
    wordWrap: true,
  });

  for (const t of blocked) {
    const lastNote = t.notes ? t.notes.split("\n").pop()?.slice(0, 48) ?? "" : "";
    table.push([t.id, t.name.slice(0, 38), String(t.attempt_count), lastNote]);
  }

  console.log("");
  console.log(table.toString());
  console.log("");
}

// =============================================================================
// View Status menu
// =============================================================================

export async function showViewStatusMenu(backlog: Backlog): Promise<void> {
  while (true) {
    const choice = await select({
      message: "View Status",
      choices: [
        { name: "Summary table", value: "summary" },
        { name: "Task detail", value: "detail" },
        { name: "Blocked tasks", value: "blocked" },
        { name: chalk.dim("Back"), value: "back" },
      ],
    });

    if (choice === "back") return;

    if (choice === "summary") {
      showSummaryTable(backlog);
    } else if (choice === "detail") {
      const task = await pickTask(backlog);
      if (task) showTaskDetail(task);
    } else if (choice === "blocked") {
      showBlockedTasks(backlog);
    }
  }
}
