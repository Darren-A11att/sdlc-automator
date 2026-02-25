// =============================================================================
// runners/doc-updater.ts - Documentation-first phase orchestrator
//
// Runs ONCE before the task processing loop. Spawns 4 specialist agents
// in parallel (via Promise.allSettled) to update project documentation
// to reflect the desired end state described in the epic brief.
// =============================================================================

import fs from "node:fs";
import path from "node:path";
import { MODEL_DOC_UPDATER, MAX_TURNS_DOC_UPDATER, ALLOWED_TOOLS } from "../config.js";
import { invokeClaudeAgent } from "../agents/index.js";
import {
  getDocUpdaterPersonas,
  buildDocUpdaterSystemPrompt,
  buildDocUpdaterUserPrompt,
} from "../prompts/doc-updater.js";
import type { ProjectConfig } from "../types.js";
import type Logger from "../logging/logger.js";
import Backlog from "../backlog/backlog.js";

export interface DocUpdateResult {
  documentName: string;
  success: boolean;
  error?: string;
  costUsd: number;
  durationMs: number;
}

/**
 * Run the documentation-first phase.
 *
 * Reads the epic brief, reads all 4 current doc files, reads all tasks,
 * then invokes 4 Claude agents in parallel to update each document.
 *
 * Fail-forward: if one agent fails, the others still run to completion.
 */
export async function runDocUpdaterPhase(
  config: ProjectConfig,
  backlogFile: string,
  epicBriefPath: string,
  logger: Logger,
  verbose: boolean,
): Promise<DocUpdateResult[]> {
  logger.log("INFO", "=== Documentation-First Phase ===");

  // Read the epic brief
  if (!fs.existsSync(epicBriefPath)) {
    logger.log("ERROR", `Epic brief not found: ${epicBriefPath}`);
    return [];
  }
  const epicBrief = fs.readFileSync(epicBriefPath, "utf-8");
  logger.log("INFO", `Epic brief loaded: ${epicBriefPath} (${epicBrief.length} chars)`);

  // Read all tasks from backlog
  const backlog = new Backlog(backlogFile);
  const allTasks = backlog.getAllTasks();
  logger.log("INFO", `Backlog loaded: ${allTasks.length} tasks`);

  // Get personas and their document paths
  const personas = getDocUpdaterPersonas(config);

  // Create log directory for doc updates
  const docLogDir = path.join(path.dirname(logger.sessionLogFile), "doc-update");
  fs.mkdirSync(docLogDir, { recursive: true });

  // Spawn all 4 agents in parallel
  const agentPromises = personas.map(async (persona): Promise<DocUpdateResult> => {
    const docName = persona.documentName;
    logger.log("INFO", `[doc-update] Starting ${persona.role} -> ${docName}`);

    // Read current doc content (may not exist yet)
    let currentContent = "";
    if (fs.existsSync(persona.documentPath)) {
      currentContent = fs.readFileSync(persona.documentPath, "utf-8");
    } else {
      currentContent = "(Document does not exist yet — create it from scratch)";
      logger.log("WARN", `[doc-update] ${docName} not found at ${persona.documentPath}, will be created`);
    }

    const systemPrompt = buildDocUpdaterSystemPrompt(persona, config, backlogFile);
    const userPrompt = buildDocUpdaterUserPrompt(epicBrief, currentContent, allTasks, persona);
    const logFile = path.join(docLogDir, `${docName.replace(".md", "")}.log`);

    try {
      const result = await invokeClaudeAgent({
        model: MODEL_DOC_UPDATER,
        maxTurns: MAX_TURNS_DOC_UPDATER,
        systemPrompt,
        userPrompt,
        logFile,
        cwd: config.projectDir,
        verbose,
        allowedTools: ALLOWED_TOOLS,
      });

      if (result.success) {
        logger.log("INFO", `[doc-update] ${persona.role} completed ${docName} ($${(result.costUsd ?? 0).toFixed(4)}, ${((result.durationMs ?? 0) / 1000).toFixed(1)}s)`);
      } else {
        logger.log("WARN", `[doc-update] ${persona.role} failed on ${docName}: ${result.output.slice(0, 200)}`);
      }

      return {
        documentName: docName,
        success: result.success,
        error: result.success ? undefined : result.output.slice(0, 500),
        costUsd: result.costUsd ?? 0,
        durationMs: result.durationMs ?? 0,
      };
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      logger.log("ERROR", `[doc-update] ${persona.role} threw on ${docName}: ${errorMsg}`);
      return {
        documentName: docName,
        success: false,
        error: errorMsg,
        costUsd: 0,
        durationMs: 0,
      };
    }
  });

  // Wait for all agents (fail-forward via allSettled)
  const settled = await Promise.allSettled(agentPromises);

  const results: DocUpdateResult[] = settled.map((outcome, i) => {
    if (outcome.status === "fulfilled") {
      return outcome.value;
    }
    // Rejected promise — should not happen since we catch inside, but handle defensively
    const errorMsg = outcome.reason instanceof Error ? outcome.reason.message : String(outcome.reason);
    return {
      documentName: personas[i]!.documentName,
      success: false,
      error: errorMsg,
      costUsd: 0,
      durationMs: 0,
    };
  });

  // Summary
  const successCount = results.filter(r => r.success).length;
  const totalCost = results.reduce((sum, r) => sum + r.costUsd, 0);
  const maxDuration = Math.max(...results.map(r => r.durationMs));
  logger.log("INFO", `Documentation phase: ${successCount}/${results.length} docs updated ($${totalCost.toFixed(4)}, ${(maxDuration / 1000).toFixed(1)}s wall time)`);

  for (const r of results) {
    if (!r.success) {
      logger.log("WARN", `  FAILED: ${r.documentName} — ${r.error?.slice(0, 150)}`);
    }
  }

  return results;
}
