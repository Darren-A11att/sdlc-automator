// =============================================================================
// cli/rc-file.ts - Load/save .sdlc-rc.json for session persistence
// =============================================================================

import fs from "node:fs";
import path from "node:path";
import type { RuntimeConfig } from "./config-manager.js";

const RC_FILENAME = ".sdlc-rc.json";

/**
 * Resolve the path to .sdlc-rc.json in the given project directory.
 */
function rcPath(projectDir: string): string {
  return path.join(projectDir, RC_FILENAME);
}

/**
 * Load .sdlc-rc.json from the project directory.
 * Returns a partial config — caller merges with defaults.
 * Returns empty object if file doesn't exist or is invalid.
 */
export function loadRcFile(projectDir: string): Partial<RuntimeConfig> {
  const filePath = rcPath(projectDir);
  if (!fs.existsSync(filePath)) return {};
  try {
    const raw = fs.readFileSync(filePath, "utf-8");
    return JSON.parse(raw) as Partial<RuntimeConfig>;
  } catch {
    return {};
  }
}

/**
 * Save the runtime config to .sdlc-rc.json in the project directory.
 * Writes atomically via temp file + rename.
 */
export function saveRcFile(projectDir: string, config: RuntimeConfig): void {
  const filePath = rcPath(projectDir);
  const tmpPath = `${filePath}.tmp.${process.pid}`;
  try {
    fs.writeFileSync(tmpPath, JSON.stringify(config, null, 2) + "\n", "utf-8");
    fs.renameSync(tmpPath, filePath);
  } catch (err) {
    try { fs.unlinkSync(tmpPath); } catch { /* ignore */ }
    throw err;
  }
}
