import fs from "node:fs";
import path from "node:path";
import type {
  SchemaMap,
  SchemaMatrixEntry,
  ExternalSchemaFingerprint,
} from "../types.js";

interface MatrixFile {
  entries: SchemaMatrixEntry[];
}

/**
 * Find a matching schema map in the matrix based on fingerprint similarity.
 * Matches on exact taskArrayKey and >80% overlap of sampleTaskKeys.
 */
export function findMapInMatrix(
  fingerprint: ExternalSchemaFingerprint,
  projectDir: string
): SchemaMatrixEntry | null {
  const matrixPath = path.join(projectDir, "templates/schemas/matrix.json");

  if (!fs.existsSync(matrixPath)) {
    return null;
  }

  const matrixContent = fs.readFileSync(matrixPath, "utf-8");
  const matrix: MatrixFile = JSON.parse(matrixContent);

  for (const entry of matrix.entries) {
    // Exact match on taskArrayKey
    if (entry.fingerprint.taskArrayKey !== fingerprint.taskArrayKey) {
      continue;
    }

    // Calculate overlap of sampleTaskKeys
    const entryKeys = new Set(entry.fingerprint.sampleTaskKeys);
    const matchingKeys = fingerprint.sampleTaskKeys.filter((key) =>
      entryKeys.has(key)
    );
    const overlapPercentage =
      matchingKeys.length / fingerprint.sampleTaskKeys.length;

    // Require >80% overlap
    if (overlapPercentage > 0.8) {
      return entry;
    }
  }

  return null;
}

/**
 * Register a new schema map entry in the matrix.
 * Uses atomic write pattern (temp file + rename).
 */
export function registerInMatrix(
  entry: SchemaMatrixEntry,
  projectDir: string
): void {
  const matrixPath = path.join(projectDir, "templates/schemas/matrix.json");
  const matrixDir = path.dirname(matrixPath);

  // Ensure directory exists
  if (!fs.existsSync(matrixDir)) {
    fs.mkdirSync(matrixDir, { recursive: true });
  }

  // Read existing matrix or create new
  let matrix: MatrixFile;
  if (fs.existsSync(matrixPath)) {
    const matrixContent = fs.readFileSync(matrixPath, "utf-8");
    matrix = JSON.parse(matrixContent);
  } else {
    matrix = { entries: [] };
  }

  // Append new entry
  matrix.entries.push(entry);

  // Atomic write: temp file + rename
  const tempPath = `${matrixPath}.tmp.${process.pid}`;
  fs.writeFileSync(tempPath, JSON.stringify(matrix, null, 2), "utf-8");
  fs.renameSync(tempPath, matrixPath);
}

/**
 * Load a schema map file and parse it.
 */
export function loadSchemaMap(
  mapFile: string,
  projectDir: string
): SchemaMap {
  const mapPath = path.join(projectDir, mapFile);

  if (!fs.existsSync(mapPath)) {
    throw new Error(`Schema map file not found: ${mapPath}`);
  }

  const mapContent = fs.readFileSync(mapPath, "utf-8");
  const schemaMap: SchemaMap = JSON.parse(mapContent);

  return schemaMap;
}
