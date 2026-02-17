// =============================================================================
// types.ts - Core type definitions for SDLC Automator
// =============================================================================

export type TaskStatus =
  | "Todo"
  | "In-Progress"
  | "Review"
  | "Testing"
  | `Testing:${string}`
  | "Done"
  | "Blocked";

export type StoryStatus =
  | "Todo"
  | "In-Progress"
  | "Testing"
  | `Testing:${string}`
  | "Done"
  | "Blocked";

export interface AcceptanceCriterion {
  criterion: string;
  met: boolean;
}

export interface Task {
  id: string;
  story_id?: string;
  name: string;
  status: TaskStatus;
  description: string;
  acceptance_criteria: AcceptanceCriterion[];
  notes: string;
  attempt_count: number;
}

export interface Story {
  id: string;
  name: string;
  status: StoryStatus;
  description: string;
  acceptance_criteria: AcceptanceCriterion[];
  task_ids: string[];
  notes: string;
  attempt_count: number;
}

export interface BacklogFile {
  schema?: {
    status_values: string[];
    met_values: boolean[];
    _writing_guide?: unknown;
  };
  stories?: Story[];
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

export type TestTypeName =
  | "Unit"
  | "Integration"
  | "Contract"
  | "Regression"
  | "Smoke"
  | "Security"
  | "Performance"
  | "Accessibility"
  | "Exploratory"
  | "UAT";

export type TestTier = "task" | "story";

export interface TestTypeResult {
  testType: TestTypeName;
  verdict: Verdict;
  notes: string;
  skipped: boolean;
  skipReason?: string;
  durationMs: number;
  costUsd: number;
}

export interface TestOrchestrationResult {
  overallVerdict: Verdict;
  results: TestTypeResult[];
  haltedAt?: TestTypeName;
  fixAttempted: boolean;
  totalDurationMs: number;
  totalCostUsd: number;
  reportPath?: string;
}

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
  applicationUrl?: string;
}

export interface AgentResult {
  success: boolean;
  output: string;
  costUsd?: number;
  numTurns?: number;
  durationMs?: number;
}
