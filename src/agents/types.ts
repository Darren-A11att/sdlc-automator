// =============================================================================
// agents/types.ts - Agent invocation options and result interfaces
// =============================================================================

export interface AgentOptions {
  model: string;
  maxTurns: number;
  systemPrompt: string;
  userPrompt: string;
  logFile: string;
  cwd: string;
  verbose: boolean;
  allowedTools: string[];
}
