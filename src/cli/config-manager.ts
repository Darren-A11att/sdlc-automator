// =============================================================================
// cli/config-manager.ts - RuntimeConfig, ModelOverrides, settings menu
// =============================================================================

import { select } from "@inquirer/prompts";
import chalk from "chalk";
import { MODEL_SONNET, MODEL_OPUS } from "../config.js";
import type { CliProvider } from "../types.js";
import { loadRcFile, saveRcFile } from "./rc-file.js";

// =============================================================================
// Types
// =============================================================================

export interface ModelOverrides {
  implementer?: string;
  reviewer?: string;
  tester?: string;
  fixer?: string;
  docUpdater?: string;
}

export interface RuntimeConfig {
  verbose: boolean;
  cliProvider: CliProvider;
  epicBriefPath: string;
  backlogFile: string;
  modelOverrides: ModelOverrides;
}

// =============================================================================
// Defaults
// =============================================================================

const DEFAULT_MODEL_ASSIGNMENTS: Record<string, string> = {
  implementer: MODEL_SONNET,
  reviewer: MODEL_OPUS,
  tester: MODEL_OPUS,
  fixer: MODEL_OPUS,
  docUpdater: MODEL_SONNET,
};

export function createDefaultRuntimeConfig(): RuntimeConfig {
  return {
    verbose: true,
    cliProvider: "claude",
    epicBriefPath: "",
    backlogFile: "tasks/backlog_tasks.json",
    modelOverrides: {},
  };
}

/**
 * Load runtime config: merge defaults with .sdlc-rc.json values.
 */
export function loadRuntimeConfig(projectDir: string): RuntimeConfig {
  const defaults = createDefaultRuntimeConfig();
  const saved = loadRcFile(projectDir);
  return {
    ...defaults,
    ...saved,
    modelOverrides: { ...defaults.modelOverrides, ...saved.modelOverrides },
  };
}

/**
 * Save runtime config to .sdlc-rc.json.
 */
export function saveRuntimeConfig(projectDir: string, config: RuntimeConfig): void {
  saveRcFile(projectDir, config);
}

// =============================================================================
// Available models
// =============================================================================

const AVAILABLE_MODELS = [
  { name: `Sonnet 4.5 (${MODEL_SONNET})`, value: MODEL_SONNET },
  { name: `Opus 4.6 (${MODEL_OPUS})`, value: MODEL_OPUS },
];

// =============================================================================
// Configure Models menu
// =============================================================================

function getEffectiveModel(role: keyof ModelOverrides, overrides: ModelOverrides): string {
  return overrides[role] ?? DEFAULT_MODEL_ASSIGNMENTS[role] ?? MODEL_SONNET;
}

export async function showConfigureModelsMenu(config: RuntimeConfig, projectDir: string): Promise<void> {
  while (true) {
    const roles: Array<{ key: keyof ModelOverrides; label: string }> = [
      { key: "implementer", label: "Implementer" },
      { key: "reviewer", label: "Reviewer" },
      { key: "tester", label: "Tester" },
      { key: "fixer", label: "Fixer" },
      { key: "docUpdater", label: "Doc Updater" },
    ];

    console.log("");
    console.log(chalk.bold("  Current model assignments:"));
    for (const role of roles) {
      const model = getEffectiveModel(role.key, config.modelOverrides);
      console.log(`    ${role.label.padEnd(14)} ${chalk.cyan(model)}`);
    }
    console.log("");

    const choices = [
      ...roles.map((r) => ({
        name: `Change ${r.label} model`,
        value: r.key,
      })),
      { name: "Reset all to defaults", value: "reset" as const },
      { name: chalk.dim("Back"), value: "back" as const },
    ];

    const choice = await select({ message: "Configure Models", choices });

    if (choice === "back") return;

    if (choice === "reset") {
      config.modelOverrides = {};
      saveRuntimeConfig(projectDir, config);
      console.log(chalk.green("  Models reset to defaults."));
      continue;
    }

    const role = roles.find((r) => r.key === choice)!;
    const currentModel = getEffectiveModel(choice, config.modelOverrides);

    const newModel = await select({
      message: `Select model for ${role.label}`,
      choices: AVAILABLE_MODELS.map((m) => ({
        ...m,
        name: m.value === currentModel ? `${m.name} (current)` : m.name,
      })),
    });

    if (newModel === DEFAULT_MODEL_ASSIGNMENTS[choice]) {
      delete config.modelOverrides[choice];
    } else {
      config.modelOverrides[choice] = newModel;
    }
    saveRuntimeConfig(projectDir, config);
    console.log(chalk.green(`  ${role.label} model set to ${newModel}`));
  }
}

// =============================================================================
// Pipeline Settings menu
// =============================================================================

export async function showPipelineSettingsMenu(config: RuntimeConfig, projectDir: string): Promise<void> {
  while (true) {
    console.log("");
    console.log(chalk.bold("  Pipeline Settings:"));
    console.log(`    Verbose output:    ${config.verbose ? chalk.green("ON") : chalk.dim("OFF")}`);
    console.log(`    CLI Provider:      ${chalk.cyan(config.cliProvider)}`);
    console.log(`    Epic brief path:   ${config.epicBriefPath ? chalk.cyan(config.epicBriefPath) : chalk.dim("(none)")}`);
    console.log("");

    const choice = await select({
      message: "Pipeline Settings",
      choices: [
        { name: `Toggle verbose (currently ${config.verbose ? "ON" : "OFF"})`, value: "verbose" },
        { name: `Switch provider (currently ${config.cliProvider})`, value: "provider" },
        { name: "Set epic brief path", value: "epic" },
        { name: chalk.dim("Back"), value: "back" },
      ],
    });

    if (choice === "back") return;

    if (choice === "verbose") {
      config.verbose = !config.verbose;
      saveRuntimeConfig(projectDir, config);
      console.log(chalk.green(`  Verbose ${config.verbose ? "enabled" : "disabled"}.`));
    }

    if (choice === "provider") {
      const newProvider = await select({
        message: "Select CLI provider",
        choices: [
          { name: "Claude (default)", value: "claude" as const },
          { name: "Kimi", value: "kimi" as const },
        ],
      });
      config.cliProvider = newProvider;
      saveRuntimeConfig(projectDir, config);
      console.log(chalk.green(`  Provider set to ${newProvider}.`));
    }

    if (choice === "epic") {
      // Use input prompt for path
      const { input } = await import("@inquirer/prompts");
      const newPath = await input({
        message: "Epic brief path (relative to project root, empty to clear):",
        default: config.epicBriefPath,
      });
      config.epicBriefPath = newPath.trim();
      saveRuntimeConfig(projectDir, config);
      console.log(chalk.green(`  Epic brief path ${config.epicBriefPath ? `set to ${config.epicBriefPath}` : "cleared"}.`));
    }
  }
}
