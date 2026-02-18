// =============================================================================
// agents/types.ts - Agent invocation options and result interfaces
// =============================================================================

export interface McpStdioServerConfig {
  command: string;
  args?: string[];
  env?: Record<string, string>;
}

export interface AgentOptions {
  model: string;
  maxTurns: number;
  systemPrompt: string;
  userPrompt: string;
  logFile: string;
  cwd: string;
  verbose: boolean;
  allowedTools: string[];
  mcpServers?: Record<string, McpStdioServerConfig>;
}
