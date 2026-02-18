// =============================================================================
// prompts/common.ts - Project config loader and shared context builder
// Ports load_project_config() and build_common_context() from bash prompts.sh
// =============================================================================

import fs from "node:fs";
import path from "node:path";
import type { ProjectConfig } from "../types.js";

export function loadProjectConfig(projectDir: string): ProjectConfig {
  const configFile = path.join(projectDir, "project.json");
  if (!fs.existsSync(configFile)) {
    console.error(`ERROR: project.json not found at ${configFile}`);
    console.error("Copy templates/project.json to your project root and customise it.");
    process.exit(1);
  }
  const raw = JSON.parse(fs.readFileSync(configFile, "utf-8"));
  const projectName = raw.project?.name;
  if (!projectName || projectName === "null") {
    console.error("ERROR: project.json missing required field: project.name");
    process.exit(1);
  }
  const conventions = (raw.conventions || []).map((c: string) => `- ${c}`).join("\n");
  const applicationUrl: string | undefined = raw.testing?.applicationUrl || undefined;

  // Parse optional dev server config
  const rawDevServer = raw.testing?.devServer;
  const devServer = rawDevServer?.startCommand
    ? {
        startCommand: rawDevServer.startCommand,
        port: rawDevServer.port ?? 3000,
        readinessTimeoutSeconds: rawDevServer.readinessTimeoutSeconds ?? 60,
        readinessIntervalSeconds: rawDevServer.readinessIntervalSeconds ?? 2,
      }
    : undefined;

  // Parse optional MCP config path (resolve relative to project root)
  const rawMcpConfig: string | undefined = raw.testing?.mcpConfig || undefined;
  const mcpConfigPath = rawMcpConfig
    ? path.resolve(projectDir, rawMcpConfig)
    : undefined;

  return {
    projectName,
    techStack: raw.techStack || "",
    buildCmd: raw.build?.buildCommand || "npm run build",
    lintCmd: raw.build?.lintCommand || "npm run lint",
    conventions,
    docSolutionDesign: path.join(projectDir, raw.docs?.solutionDesign || "docs/solution-design.md"),
    docPrd: path.join(projectDir, raw.docs?.prd || "docs/prd.md"),
    docBusinessFlows: path.join(projectDir, raw.docs?.businessFlows || "docs/business-flows.md"),
    projectDir,
    applicationUrl,
    devServer,
    mcpConfigPath,
  };
}

export function buildCommonContext(config: ProjectConfig, backlogFile: string): string {
  return `Project: ${config.projectName}
Tech Stack: ${config.techStack}
Project Root: ${config.projectDir}
Solution Design: ${config.docSolutionDesign}
PRD: ${config.docPrd}
Business Flows: ${config.docBusinessFlows}
Backlog: ${backlogFile}

Conventions:
${config.conventions}${config.applicationUrl ? `\nApplication URL: ${config.applicationUrl}` : ""}`;
}
