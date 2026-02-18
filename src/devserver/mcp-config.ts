// =============================================================================
// devserver/mcp-config.ts - MCP server config file loader
//
// Reads an MCP server configuration JSON file and returns the mcpServers map.
// =============================================================================

import fs from "node:fs";
import type { McpStdioServerConfig } from "../agents/types.js";

/**
 * Load MCP server configuration from a JSON file.
 *
 * Expected format:
 * {
 *   "mcpServers": {
 *     "puppeteer": { "command": "npx", "args": [...], "env": {...} }
 *   }
 * }
 */
export function loadMcpConfig(configPath: string): Record<string, McpStdioServerConfig> {
  if (!fs.existsSync(configPath)) {
    return {};
  }
  const raw = JSON.parse(fs.readFileSync(configPath, "utf-8"));
  return raw.mcpServers ?? {};
}
