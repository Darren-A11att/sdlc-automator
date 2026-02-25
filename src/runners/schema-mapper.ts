import fs from "node:fs";
import path from "node:path";
import { MODEL_OPUS, ALLOWED_TOOLS } from "../config.js";
import { invokeClaudeAgent } from "../agents/index.js";
import { buildSchemaMapperSystemPrompt, buildSchemaMapperUserPrompt } from "../prompts/schema-mapper.js";
import { registerInMatrix, loadSchemaMap } from "../backlog/schema-matrix.js";
import type { SchemaMap, SchemaMatrixEntry, CompatibilityResult } from "../types.js";
import type Logger from "../logging/logger.js";

const MAX_TURNS_SCHEMA_MAPPER = 5;

export async function runSchemaMapper(
  rawData: Record<string, unknown>,
  compatResult: CompatibilityResult,
  projectDir: string,
  logger: Logger,
  verbose: boolean,
): Promise<SchemaMap | null> {
  logger.log("INFO", "[schema-mapper] Generating bidirectional schema map via Opus agent...");

  // Extract sample items from the detected task array
  const taskArrayKey = compatResult.fingerprint.taskArrayKey;
  const taskArray = rawData[taskArrayKey];
  const sampleItems = Array.isArray(taskArray) ? taskArray.slice(0, 5) : [];

  if (sampleItems.length === 0) {
    logger.log("ERROR", "[schema-mapper] No sample items found in task array");
    return null;
  }

  // Derive a map name from the fingerprint
  const mapName = `auto-${Date.now()}`;
  const mapFileName = `${mapName}.map.json`;
  const mapFilePath = path.join(projectDir, "templates", "schemas", "maps", mapFileName);
  const logFile = path.join(projectDir, "logs", "schema-mapper.log");

  // Ensure maps directory exists
  fs.mkdirSync(path.dirname(mapFilePath), { recursive: true });

  const systemPrompt = buildSchemaMapperSystemPrompt(projectDir);
  const userPrompt = buildSchemaMapperUserPrompt(sampleItems, compatResult.issues, mapFilePath);

  try {
    const result = await invokeClaudeAgent({
      model: MODEL_OPUS,
      maxTurns: MAX_TURNS_SCHEMA_MAPPER,
      systemPrompt,
      userPrompt,
      logFile,
      cwd: projectDir,
      verbose,
      allowedTools: ALLOWED_TOOLS,
    });

    if (!result.success) {
      logger.log("ERROR", `[schema-mapper] Agent failed: ${result.output.slice(0, 200)}`);
      return null;
    }

    // Validate the generated map file exists and is valid JSON
    if (!fs.existsSync(mapFilePath)) {
      logger.log("ERROR", `[schema-mapper] Agent did not write map file to ${mapFilePath}`);
      return null;
    }

    const map = loadSchemaMap(path.relative(projectDir, mapFilePath), projectDir);

    // Validate required map fields
    if (!map.rootMapping || !map.taskFieldMapping || !map.statusMapping) {
      logger.log("ERROR", "[schema-mapper] Generated map missing required fields");
      return null;
    }

    // Register in matrix
    const entry: SchemaMatrixEntry = {
      name: mapName,
      fingerprint: {
        taskArrayKey: compatResult.fingerprint.taskArrayKey,
        sampleTaskKeys: compatResult.fingerprint.sampleTaskKeys,
        statusValues: compatResult.fingerprint.statusValues,
      },
      mapFile: `templates/schemas/maps/${mapFileName}`,
      generatedBy: "schema-mapper-opus",
      generatedAt: new Date().toISOString(),
    };

    registerInMatrix(entry, projectDir);
    logger.log("INFO", `[schema-mapper] Map generated and registered: ${mapFileName} ($${(result.costUsd ?? 0).toFixed(4)})`);

    return map;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.log("ERROR", `[schema-mapper] Error: ${msg}`);
    return null;
  }
}
