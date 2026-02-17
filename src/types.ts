// =============================================================================
// types.ts - Core type definitions for SDLC Automator
// =============================================================================

export type TaskStatus =
  | "Todo"
  | "In-Progress"
  | "Review"
  | "Testing"
  | "Done"
  | "Blocked";

export interface AcceptanceCriterion {
  criterion: string;
  met: boolean;
}

export interface Task {
  id: string;
  name: string;
  status: TaskStatus;
  description: string;
  acceptance_criteria: AcceptanceCriterion[];
  notes: string;
  attempt_count: number;
}

export interface BacklogFile {
  schema?: {
    status_values: string[];
    met_values: boolean[];
    _writing_guide?: unknown;
  };
  tasks: Task[];
}

export type AgentRole =
  | "implementer"
  | "reviewer"
  | "tester"
  | "fixer"
  | "blocker-analyst"
  | "block-reporter";

export type CliProvider = "claude" | "kimi";

export type Verdict = "PASS" | "FAIL" | "UNKNOWN";

export type BlockerVerdict = "CLEAR" | "BLOCKED";

export interface ProjectConfig {
  projectName: string;
  techStack: string;
  buildCmd: string;
  lintCmd: string;
  conventions: string;
  docSolutionDesign: string;
  docPrd: string;
  docBusinessFlows: string;
  projectDir: string;
}

export interface AgentResult {
  success: boolean;
  output: string;
  costUsd?: number;
  numTurns?: number;
  durationMs?: number;
}
