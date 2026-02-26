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
 *
 * Checks project-local matrix first (projectDir/.manera/schemas/matrix.json),
 * then falls back to built-in matrix (sdlcRoot/templates/schemas/matrix.json).
 */
export function findMapInMatrix(
  fingerprint: ExternalSchemaFingerprint,
  sdlcRoot: string,
  projectDir?: string,
): SchemaMatrixEntry | null {
  // Check project-local matrix first
  if (projectDir) {
    const localResult = findInMatrixFile(
      fingerprint,
      path.join(projectDir, ".manera", "schemas", "matrix.json"),
    );
    if (localResult) return localResult;
  }

  // Fall back to built-in matrix
  return findInMatrixFile(
    fingerprint,
    path.join(sdlcRoot, "templates", "schemas", "matrix.json"),
  );
}

function findInMatrixFile(
  fingerprint: ExternalSchemaFingerprint,
  matrixPath: string,
): SchemaMatrixEntry | null {
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
 *
 * baseDir is the root to resolve the matrix file location.
 * When called from schema-mapper, this is projectDir (writes to .manera/schemas/matrix.json).
 */
export function registerInMatrix(
  entry: SchemaMatrixEntry,
  baseDir: string,
): void {
  const matrixPath = path.join(baseDir, ".manera", "schemas", "matrix.json");
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
 * Resolves mapFile relative to baseDir first, falls back to sdlcRoot.
 */
export function loadSchemaMap(
  mapFile: string,
  baseDir: string,
  sdlcRoot?: string,
): SchemaMap {
  // Try baseDir first
  const primaryPath = path.join(baseDir, mapFile);
  if (fs.existsSync(primaryPath)) {
    const mapContent = fs.readFileSync(primaryPath, "utf-8");
    return JSON.parse(mapContent) as SchemaMap;
  }

  // Fall back to sdlcRoot for built-in maps
  if (sdlcRoot) {
    const fallbackPath = path.join(sdlcRoot, mapFile);
    if (fs.existsSync(fallbackPath)) {
      const mapContent = fs.readFileSync(fallbackPath, "utf-8");
      return JSON.parse(mapContent) as SchemaMap;
    }
  }

  throw new Error(`Schema map file not found: ${primaryPath}`);
}
