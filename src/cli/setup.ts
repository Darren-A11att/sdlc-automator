// =============================================================================
// cli/setup.ts - Guided project.json creation wizard for fresh projects
// =============================================================================

import fs from "node:fs";
import path from "node:path";
import { input, confirm, select } from "@inquirer/prompts";
import chalk from "chalk";
import ora from "ora";
import { runProjectDiscovery } from "../runners/project-discovery.js";

const TEMPLATE_PATH = "templates/project.json";

/**
 * Check if the current project directory has a project.json.
 */
export function hasProjectJson(projectDir: string): boolean {
  return fs.existsSync(path.join(projectDir, "project.json"));
}

/**
 * Copy template doc files from sdlcRoot for any doc paths that don't already exist.
 */
function copyTemplateDocs(
  projectDir: string,
  sdlcRoot: string,
  docs: { prd: string; solutionDesign: string; businessFlows: string; systemDiagram: string },
): void {
  const docsDir = path.join(projectDir, "docs");
  if (!fs.existsSync(docsDir)) {
    fs.mkdirSync(docsDir, { recursive: true });
    console.log(chalk.dim(`  Created ${docsDir}/`));
  }

  const templateDocsDir = path.join(sdlcRoot, "templates", "docs");
  if (!fs.existsSync(templateDocsDir)) return;

  for (const [_key, relPath] of Object.entries(docs)) {
    const dest = path.join(projectDir, relPath);
    if (!fs.existsSync(dest)) {
      const templateFile = path.join(templateDocsDir, path.basename(relPath));
      if (fs.existsSync(templateFile)) {
        fs.mkdirSync(path.dirname(dest), { recursive: true });
        fs.copyFileSync(templateFile, dest);
        console.log(chalk.dim(`  Copied template: ${relPath}`));
      }
    }
  }
}

/**
 * Write project.json and scaffold supporting directories.
 */
function writeProjectJson(
  projectDir: string,
  sdlcRoot: string,
  projectJson: Record<string, unknown>,
  docs: { prd: string; solutionDesign: string; businessFlows: string; systemDiagram: string },
): void {
  const outPath = path.join(projectDir, "project.json");
  fs.writeFileSync(outPath, JSON.stringify(projectJson, null, 2) + "\n", "utf-8");
  console.log(chalk.green(`  Created ${outPath}`));

  // Copy template docs for paths that don't exist
  copyTemplateDocs(projectDir, sdlcRoot, docs);

  // Create tasks directory if needed
  const tasksDir = path.join(projectDir, "tasks");
  if (!fs.existsSync(tasksDir)) {
    fs.mkdirSync(tasksDir, { recursive: true });
    console.log(chalk.dim(`  Created ${tasksDir}/`));
  }
}

/**
 * Run the manual setup wizard where users type in each field.
 */
async function runManualWizard(projectDir: string, sdlcRoot: string): Promise<boolean> {
  const projectName = await input({
    message: "Project name:",
    default: path.basename(projectDir),
  });

  const techStack = await input({
    message: "Tech stack (e.g., 'Next.js, TypeScript, PostgreSQL'):",
    default: "",
  });

  const buildCmd = await input({
    message: "Build command:",
    default: "npm run build",
  });

  const lintCmd = await input({
    message: "Lint command:",
    default: "npm run lint",
  });

  const conventions = await input({
    message: "Coding conventions (comma-separated, e.g., 'Use TypeScript, 2-space indent'):",
    default: "",
  });

  const docsExist = await confirm({
    message: "Do you have documentation files (PRD, solution design, etc.)?",
    default: false,
  });

  let prdPath = "docs/prd.md";
  let solutionDesignPath = "docs/solution-design.md";
  let businessFlowsPath = "docs/business-flows.md";
  let systemDiagramPath = "docs/system-diagram.md";

  if (docsExist) {
    prdPath = await input({ message: "PRD path:", default: prdPath });
    solutionDesignPath = await input({ message: "Solution design path:", default: solutionDesignPath });
    businessFlowsPath = await input({ message: "Business flows path:", default: businessFlowsPath });
    systemDiagramPath = await input({ message: "System diagram path:", default: systemDiagramPath });
  }

  // Build project.json
  const projectJson = {
    project: { name: projectName },
    techStack,
    build: {
      buildCommand: buildCmd,
      lintCommand: lintCmd,
    },
    conventions: conventions
      ? conventions.split(",").map((c: string) => c.trim()).filter(Boolean)
      : [],
    docs: {
      prd: prdPath,
      solutionDesign: solutionDesignPath,
      businessFlows: businessFlowsPath,
      systemDiagram: systemDiagramPath,
    },
    testing: {},
    worktree: { enabled: false },
  };

  console.log("");
  console.log(chalk.bold("  Generated project.json:"));
  console.log(chalk.dim(JSON.stringify(projectJson, null, 2)));
  console.log("");

  const proceed = await confirm({
    message: "Write this project.json?",
    default: true,
  });

  if (!proceed) {
    console.log(chalk.dim("  Setup cancelled."));
    return false;
  }

  const docs = { prd: prdPath, solutionDesign: solutionDesignPath, businessFlows: businessFlowsPath, systemDiagram: systemDiagramPath };

  writeProjectJson(projectDir, sdlcRoot, projectJson, docs);

  return true;
}

/**
 * Run auto-discovery using an AI agent to explore the codebase.
 * Falls back to manual wizard on failure.
 */
async function runAutoDiscovery(projectDir: string, sdlcRoot: string): Promise<boolean> {
  const spinner = ora("Analyzing your codebase...").start();

  const result = await runProjectDiscovery(projectDir, false);

  if (!result.success || !result.config) {
    spinner.fail("Auto-discovery failed");
    console.log(chalk.yellow(`  ${result.error ?? "Unknown error"}`));
    console.log("");

    const fallback = await confirm({
      message: "Would you like to use the manual wizard instead?",
      default: true,
    });

    if (fallback) {
      return runManualWizard(projectDir, sdlcRoot);
    }
    return false;
  }

  spinner.succeed(`Codebase analyzed ($${result.costUsd.toFixed(4)}, ${(result.durationMs / 1000).toFixed(1)}s)`);
  console.log("");
  console.log(chalk.bold("  Discovered project.json:"));
  console.log(chalk.dim(JSON.stringify(result.config, null, 2)));
  console.log("");

  const proceed = await confirm({
    message: "Write this project.json?",
    default: true,
  });

  if (!proceed) {
    const manual = await confirm({
      message: "Would you like to use the manual wizard instead?",
      default: true,
    });

    if (manual) {
      return runManualWizard(projectDir, sdlcRoot);
    }
    console.log(chalk.dim("  Setup cancelled."));
    return false;
  }

  // Extract docs from discovered config for template copying
  const configDocs = (result.config.docs as Record<string, string> | undefined) ?? {};
  const docs = {
    prd: configDocs.prd ?? "docs/prd.md",
    solutionDesign: configDocs.solutionDesign ?? "docs/solution-design.md",
    businessFlows: configDocs.businessFlows ?? "docs/business-flows.md",
    systemDiagram: configDocs.systemDiagram ?? "docs/system-diagram.md",
  };

  writeProjectJson(projectDir, sdlcRoot, result.config, docs);

  return true;
}

/**
 * Run the guided setup wizard to create a project.json.
 * Returns true if created successfully, false if cancelled.
 */
export async function runSetupWizard(projectDir: string, sdlcRoot: string): Promise<boolean> {
  console.log("");
  console.log(chalk.bold("  Project Setup Wizard"));
  console.log(chalk.dim("  Create a project.json configuration file for this project."));
  console.log("");

  const method = await select({
    message: "How would you like to configure this project?",
    choices: [
      {
        name: "Auto-discover (AI agent explores your codebase)",
        value: "auto" as const,
      },
      {
        name: "Manual wizard",
        value: "manual" as const,
      },
    ],
  });

  if (method === "auto") {
    return runAutoDiscovery(projectDir, sdlcRoot);
  }

  return runManualWizard(projectDir, sdlcRoot);
}
