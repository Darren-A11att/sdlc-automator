import fs from "node:fs";
import path from "node:path";
import type { CompatibilityIssue } from "../types.js";

export function buildSchemaMapperSystemPrompt(projectDir: string): string {
  // Read the canonical schema definition
  const schemaPath = path.join(projectDir, "templates", "schemas", "canonical.schema.json");
  const canonicalSchema = fs.readFileSync(schemaPath, "utf-8");

  return `You are a schema mapping specialist. Your task is to produce a bidirectional mapping between an external backlog JSON format and a canonical schema.

## Canonical Schema
${canonicalSchema}

## Output Format
You must write a JSON file with this exact structure:
{
  "rootMapping": { "<canonical_root_key>": "<external_root_key>", ... },
  "taskFieldMapping": { "<canonical_field>": "<external_field_or_null>", ... },
  "storyFieldMapping": { "<canonical_field>": "<external_field_or_null>", ... },
  "statusMapping": {
    "toCanonical": { "<external_status>": "<canonical_status>", ... },
    "toExternal": { "<canonical_status>": "<external_status>", ... }
  },
  "acceptanceCriteria": {
    "externalFormat": "object-array" | "string-array" | "object-different-keys",
    "criterionField": "<field_name_if_different>",
    "metField": "<field_name_if_different>"
  },
  "defaults": { "<field>": <default_value>, ... }
}

## Rules
- Map every canonical field to its external equivalent. Use null if no equivalent exists.
- Status mappings must be bidirectional — every external status maps to exactly one canonical status, and vice versa.
- For statuses that don't exist in the external format, map them to the closest equivalent.
- The "defaults" object should provide values for optional canonical fields missing in the external format (notes: "", attempt_count: 0, met: false).
- Write the map file to the path specified in the user prompt using the Write tool.
- Do NOT include any commentary in the JSON file, only valid JSON.`;
}

export function buildSchemaMapperUserPrompt(
  sampleItems: unknown[],
  issues: CompatibilityIssue[],
  outputPath: string,
): string {
  const sampleJson = JSON.stringify(sampleItems, null, 2);
  const issuesList = issues.map(i => `- [${i.type}] ${i.path}: expected ${i.expected}, got ${i.actual}`).join("\n");

  return `Analyze this external backlog data and generate a bidirectional schema map.

## Sample External Data (first items from the task/issue array)
${sampleJson}

## Compatibility Issues Found
${issuesList || "None — but the schema checker flagged structural differences."}

## Task
1. Read the sample data above and identify field mappings to the canonical schema.
2. Identify status value mappings between external and canonical.
3. Determine the acceptance criteria format.
4. Write the complete schema map JSON to: ${outputPath}

Write the file now.`;
}
