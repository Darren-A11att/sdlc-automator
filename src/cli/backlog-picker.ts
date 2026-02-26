// =============================================================================
// cli/backlog-picker.ts - Backlog file discovery, template copy, task preview
// =============================================================================

import fs from "node:fs";
import path from "node:path";
import { select, confirm } from "@inquirer/prompts";
import chalk from "chalk";
import Table from "cli-table3";
import type { RuntimeConfig } from "./config-manager.js";
import { saveRuntimeConfig } from "./config-manager.js";

/**
 * Discover backlog JSON files in the tasks/ directory.
 */
function discoverBacklogFiles(projectDir: string): string[] {
  const tasksDir = path.join(projectDir, "tasks");
  if (!fs.existsSync(tasksDir)) return [];
  return fs.readdirSync(tasksDir)
    .filter((f) => f.endsWith(".json"))
    .map((f) => path.join("tasks", f));
}

/**
 * Show a preview table of tasks in a backlog file.
 */
function previewBacklog(projectDir: string, backlogPath: string): void {
  const fullPath = path.join(projectDir, backlogPath);
  if (!fs.existsSync(fullPath)) {
    console.log(chalk.red(`  File not found: ${fullPath}`));
    return;
  }

  try {
    const raw = JSON.parse(fs.readFileSync(fullPath, "utf-8"));
    const tasks = raw.tasks ?? [];

    if (tasks.length === 0) {
      console.log(chalk.dim("  No tasks in this backlog."));
      return;
    }

    const table = new Table({
      head: [chalk.bold("ID"), chalk.bold("Status"), chalk.bold("Name")],
      colWidths: [14, 14, 50],
    });

    const shown = tasks.slice(0, 15);
    for (const t of shown) {
      table.push([t.id ?? "?", t.status ?? "?", (t.name ?? "Untitled").slice(0, 48)]);
    }

    console.log("");
    console.log(table.toString());
    if (tasks.length > 15) {
      console.log(chalk.dim(`  ... and ${tasks.length - 15} more tasks`));
    }
    console.log("");
  } catch {
    console.log(chalk.red("  Failed to parse backlog file."));
  }
}

/**
 * Pick or create a backlog file. Updates config.backlogFile and saves.
 */
export async function pickOrCreateBacklog(
  projectDir: string,
  sdlcRoot: string,
  config: RuntimeConfig,
): Promise<string> {
  const files = discoverBacklogFiles(projectDir);

  const choices = files.map((f) => ({
    name: f,
    value: f,
  }));
  choices.push({ name: chalk.cyan("Create from template"), value: "__create__" });
  choices.push({ name: chalk.dim("Enter custom path"), value: "__custom__" });

  const choice = await select({
    message: "Select backlog file",
    choices,
  });

  if (choice === "__create__") {
    const templatePath = path.join(sdlcRoot, "templates", "tasks", "backlog_tasks.json");
    const destDir = path.join(projectDir, "tasks");
    fs.mkdirSync(destDir, { recursive: true });
    const destPath = path.join(destDir, "backlog_tasks.json");

    if (fs.existsSync(destPath)) {
      const overwrite = await confirm({
        message: `${destPath} already exists. Overwrite?`,
        default: false,
      });
      if (!overwrite) {
        return config.backlogFile;
      }
    }

    if (fs.existsSync(templatePath)) {
      fs.copyFileSync(templatePath, destPath);
      console.log(chalk.green(`  Created tasks/backlog_tasks.json from template.`));
    } else {
      // Create minimal backlog
      const minimal = { tasks: [] };
      fs.writeFileSync(destPath, JSON.stringify(minimal, null, 2), "utf-8");
      console.log(chalk.green(`  Created empty tasks/backlog_tasks.json.`));
    }

    config.backlogFile = "tasks/backlog_tasks.json";
    saveRuntimeConfig(projectDir, config);
    return config.backlogFile;
  }

  if (choice === "__custom__") {
    const { input } = await import("@inquirer/prompts");
    const customPath = await input({
      message: "Backlog file path (relative to project root):",
      default: config.backlogFile,
    });
    config.backlogFile = customPath.trim();
    saveRuntimeConfig(projectDir, config);
    return config.backlogFile;
  }

  // Show preview
  previewBacklog(projectDir, choice);
  config.backlogFile = choice;
  saveRuntimeConfig(projectDir, config);
  return config.backlogFile;
}
