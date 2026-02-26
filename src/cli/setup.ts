// =============================================================================
// cli/setup.ts - Guided project.json creation wizard for fresh projects
// =============================================================================

import fs from "node:fs";
import path from "node:path";
import { input, confirm } from "@inquirer/prompts";
import chalk from "chalk";

const TEMPLATE_PATH = "templates/project.json";

/**
 * Check if the current project directory has a project.json.
 */
export function hasProjectJson(projectDir: string): boolean {
  return fs.existsSync(path.join(projectDir, "project.json"));
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

  const outPath = path.join(projectDir, "project.json");
  fs.writeFileSync(outPath, JSON.stringify(projectJson, null, 2) + "\n", "utf-8");
  console.log(chalk.green(`  Created ${outPath}`));

  // Create docs directory and template files if they don't exist
  if (!docsExist) {
    const docsDir = path.join(projectDir, "docs");
    if (!fs.existsSync(docsDir)) {
      fs.mkdirSync(docsDir, { recursive: true });
      console.log(chalk.dim(`  Created ${docsDir}/`));
    }

    // Copy doc templates if available
    const templateDocsDir = path.join(sdlcRoot, "templates", "docs");
    if (fs.existsSync(templateDocsDir)) {
      for (const [key, relPath] of Object.entries({ prd: prdPath, solutionDesign: solutionDesignPath, businessFlows: businessFlowsPath, systemDiagram: systemDiagramPath })) {
        const dest = path.join(projectDir, relPath);
        if (!fs.existsSync(dest)) {
          const templateFile = path.join(templateDocsDir, path.basename(relPath));
          if (fs.existsSync(templateFile)) {
            fs.copyFileSync(templateFile, dest);
            console.log(chalk.dim(`  Copied template: ${relPath}`));
          }
        }
      }
    }
  }

  // Create tasks directory if needed
  const tasksDir = path.join(projectDir, "tasks");
  if (!fs.existsSync(tasksDir)) {
    fs.mkdirSync(tasksDir, { recursive: true });
    console.log(chalk.dim(`  Created ${tasksDir}/`));
  }

  return true;
}
