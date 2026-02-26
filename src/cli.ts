#!/usr/bin/env tsx
// =============================================================================
// cli.ts - Interactive CLI REPL for Manera (SDLC Automator)
//
// Entry point: npx manera (or npx tsx src/cli.ts)
// =============================================================================

import fs from "node:fs";
import path from "node:path";
import { select } from "@inquirer/prompts";
import chalk from "chalk";
import Backlog from "./backlog/backlog.js";
import { loadRuntimeConfig, saveRuntimeConfig, showConfigureModelsMenu, showPipelineSettingsMenu } from "./cli/config-manager.js";
import type { RuntimeConfig } from "./cli/config-manager.js";
import { hasProjectJson, runSetupWizard } from "./cli/setup.js";
import { showViewStatusMenu } from "./cli/status.js";
import { showRunPipelineMenu, showResetMenu } from "./cli/pipeline-runner.js";
import { pickOrCreateBacklog } from "./cli/backlog-picker.js";

// =============================================================================
// Resolve directories
// =============================================================================

// The sdlc-automator package root (for templates)
const SDLC_ROOT = path.resolve(import.meta.dirname ?? path.dirname(new URL(import.meta.url).pathname), "..");

// The user's project directory (cwd when they run `npx manera`)
const PROJECT_DIR = process.cwd();

// =============================================================================
// Startup checks
// =============================================================================

async function startup(): Promise<RuntimeConfig> {
  console.log("");
  console.log(chalk.bold("  Manera") + chalk.dim("  v2.0.0"));

  // Check for project.json
  if (!hasProjectJson(PROJECT_DIR)) {
    console.log(chalk.yellow("  No project.json found in current directory."));
    const created = await runSetupWizard(PROJECT_DIR, SDLC_ROOT);
    if (!created) {
      console.log(chalk.dim("  Run 'npx manera' again after creating project.json."));
      process.exit(0);
    }
  }

  // Load runtime config (.sdlc-rc.json merged with defaults)
  const rc = loadRuntimeConfig(PROJECT_DIR);

  // Ensure backlog file exists
  const backlogPath = path.resolve(PROJECT_DIR, rc.backlogFile);
  if (!fs.existsSync(backlogPath)) {
    console.log(chalk.yellow(`  Backlog file not found: ${rc.backlogFile}`));
    const newPath = await pickOrCreateBacklog(PROJECT_DIR, SDLC_ROOT, rc);
    rc.backlogFile = newPath;
    saveRuntimeConfig(PROJECT_DIR, rc);
  }

  // Read project name for header
  let projectName = "Unknown Project";
  try {
    const pjRaw = JSON.parse(fs.readFileSync(path.join(PROJECT_DIR, "project.json"), "utf-8"));
    projectName = pjRaw.project?.name ?? projectName;
  } catch { /* ignore */ }

  console.log(`  Project: ${chalk.cyan(projectName)}  |  Backlog: ${chalk.dim(rc.backlogFile)}`);
  console.log("");

  return rc;
}

// =============================================================================
// Main menu REPL
// =============================================================================

async function mainMenu(rc: RuntimeConfig): Promise<void> {
  while (true) {
    try {
      const choice = await select({
        message: "Main Menu",
        choices: [
          { name: "Run Pipeline", value: "run" },
          { name: "View Status", value: "status" },
          { name: "Reset Tasks", value: "reset" },
          { name: "Configure Models", value: "models" },
          { name: "Pipeline Settings", value: "settings" },
          { name: "Switch Backlog", value: "backlog" },
          { name: chalk.dim("Exit"), value: "exit" },
        ],
      });

      if (choice === "exit") {
        console.log(chalk.dim("  Goodbye."));
        return;
      }

      if (choice === "run") {
        await showRunPipelineMenu(PROJECT_DIR, rc, SDLC_ROOT);
      } else if (choice === "status") {
        const backlogPath = path.resolve(PROJECT_DIR, rc.backlogFile);
        if (fs.existsSync(backlogPath)) {
          const backlog = new Backlog(backlogPath);
          await showViewStatusMenu(backlog);
        } else {
          console.log(chalk.red("  Backlog file not found."));
        }
      } else if (choice === "reset") {
        await showResetMenu(PROJECT_DIR, rc);
      } else if (choice === "models") {
        await showConfigureModelsMenu(rc, PROJECT_DIR);
      } else if (choice === "settings") {
        await showPipelineSettingsMenu(rc, PROJECT_DIR);
      } else if (choice === "backlog") {
        const newPath = await pickOrCreateBacklog(PROJECT_DIR, SDLC_ROOT, rc);
        rc.backlogFile = newPath;
        console.log(chalk.green(`  Backlog switched to: ${newPath}`));
      }
    } catch (err) {
      // ExitPromptError from @inquirer/prompts means Ctrl+C at a prompt
      if (err instanceof Error && err.name === "ExitPromptError") {
        console.log(chalk.dim("\n  Goodbye."));
        return;
      }
      throw err;
    }
  }
}

// =============================================================================
// Entry point
// =============================================================================

async function main(): Promise<void> {
  try {
    const rc = await startup();
    await mainMenu(rc);
  } catch (err) {
    if (err instanceof Error && err.name === "ExitPromptError") {
      console.log(chalk.dim("\n  Goodbye."));
      process.exit(0);
    }
    console.error("Fatal error:", err);
    process.exit(1);
  }
}

main();
