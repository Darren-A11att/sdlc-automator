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

export interface DevServerConfig {
  startCommand: string;
  port: number;
  readinessTimeoutSeconds: number;
  readinessIntervalSeconds: number;
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
  docSystemDiagram: string;
  projectDir: string;
  applicationUrl?: string;
  devServer?: DevServerConfig;
  mcpConfigPath?: string;
  epicBriefPath?: string;
  worktree?: WorktreeProjectConfig;
}

export interface WorktreeProjectConfig {
  enabled: boolean;
  branchPrefix: string;
  symlinkFiles: string[];
  setupCommands: string[];
}

export interface AgentResult {
  success: boolean;
  output: string;
  costUsd?: number;
  numTurns?: number;
  durationMs?: number;
}

// =============================================================================
// Schema Mapping Types
// =============================================================================

export interface CompatibilityIssue {
  type: "missing_field" | "wrong_type" | "invalid_enum" | "wrong_shape" | "missing_root_key";
  path: string;
  expected: string;
  actual: string;
}

export interface ExternalSchemaFingerprint {
  rootKeys: string[];
  taskArrayKey: string;
  sampleTaskKeys: string[];
  criteriaShape: "object-array" | "string-array" | "object-different-keys" | "absent";
  statusValues: string[];
}

export interface CompatibilityResult {
  compatible: boolean;
  issues: CompatibilityIssue[];
  fingerprint: ExternalSchemaFingerprint;
}

export interface SchemaMapStatusMapping {
  toCanonical: Record<string, string>;
  toExternal: Record<string, string>;
}

export interface SchemaMapCriteriaMapping {
  externalFormat: "object-array" | "string-array" | "object-different-keys";
  criterionField?: string;
  metField?: string;
}

export interface SchemaMap {
  rootMapping: Record<string, string>;
  taskFieldMapping: Record<string, string | null>;
  storyFieldMapping: Record<string, string | null>;
  statusMapping: SchemaMapStatusMapping;
  acceptanceCriteria: SchemaMapCriteriaMapping;
  defaults: Record<string, unknown>;
}

export interface SchemaMatrixEntry {
  name: string;
  fingerprint: {
    taskArrayKey: string;
    sampleTaskKeys: string[];
    statusValues: string[];
  };
  mapFile: string;
  generatedBy: string;
  generatedAt: string;
}
