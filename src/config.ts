// =============================================================================
// config.ts - Constants matching current bash values exactly
// =============================================================================

import type { TestTypeName, TestTier } from "./types.js";

/** Maximum task retry attempts before marking as Blocked */
export const MAX_ATTEMPTS = 5;

/** Consecutive blocked tasks before stopping and generating report */
export const MAX_CONSECUTIVE_BLOCKS = 5;

/** Maximum story-level test retry attempts */
export const MAX_STORY_ATTEMPTS = 3;

/** Model identifiers */
export const MODEL_SONNET = "claude-sonnet-4-5-20250929";
export const MODEL_OPUS = "claude-opus-4-6";

/** Max turns per agent role */
export const MAX_TURNS_IMPLEMENTER = 25;
export const MAX_TURNS_REVIEWER = 15;
export const MAX_TURNS_TESTER = 15;
export const MAX_TURNS_FIXER = 20;
export const MAX_TURNS_TEST_FIXER = 15;
export const MAX_TURNS_BLOCKER = 5;
export const MAX_TURNS_REPORTER = 10;
export const MAX_TURNS_DOC_UPDATER = 15;

/** Model for doc-updater agents (Sonnet for cost efficiency — structured writing, not deep analysis) */
export const MODEL_DOC_UPDATER = MODEL_SONNET;

/** Default allowed tools for all agents */
export const ALLOWED_TOOLS = ["Bash", "Read", "Edit", "Write", "Glob", "Grep"];

/** Max turns for browser-based testing (more turns needed for Puppeteer interactions) */
export const MAX_TURNS_TESTER_BROWSER = 25;

/** Allowed tools including MCP Puppeteer tools for browser-based testing */
export const ALLOWED_TOOLS_BROWSER = [
  ...ALLOWED_TOOLS,
  "mcp__puppeteer__puppeteer_navigate",
  "mcp__puppeteer__puppeteer_screenshot",
  "mcp__puppeteer__puppeteer_click",
  "mcp__puppeteer__puppeteer_fill",
  "mcp__puppeteer__puppeteer_select",
  "mcp__puppeteer__puppeteer_hover",
  "mcp__puppeteer__puppeteer_evaluate",
];

/** Configuration for a single test type */
export interface TestTypeConfig {
  name: TestTypeName;
  label: string;
  statusSuffix: string;
  maxTurns: number;
  requiresBrowser: boolean | "optional";
  tier: TestTier;
  order: number;
}

/** Task-level test types (run per task after implementation + review) */
export const TASK_TEST_TYPES: TestTypeConfig[] = [
  { name: "Unit",        label: "Unit Tests",        statusSuffix: "Unit",        maxTurns: 10, requiresBrowser: false,      tier: "task",  order: 1 },
  { name: "Integration", label: "Integration Tests", statusSuffix: "Integration", maxTurns: 12, requiresBrowser: false,      tier: "task",  order: 2 },
  { name: "Contract",    label: "Contract Tests",    statusSuffix: "Contract",    maxTurns: 8,  requiresBrowser: false,      tier: "task",  order: 3 },
];

/** Story-level test types (run once after all tasks in a story pass) */
export const STORY_TEST_TYPES: TestTypeConfig[] = [
  { name: "Regression",    label: "Regression Tests",    statusSuffix: "Regression",    maxTurns: 12, requiresBrowser: false,      tier: "story", order: 4  },
  { name: "Smoke",          label: "Smoke Tests",          statusSuffix: "Smoke",          maxTurns: 8,  requiresBrowser: "optional", tier: "story", order: 5  },
  { name: "Security",       label: "Security Tests",       statusSuffix: "Security",       maxTurns: 10, requiresBrowser: false,      tier: "story", order: 6  },
  { name: "Performance",    label: "Performance Tests",    statusSuffix: "Performance",    maxTurns: 10, requiresBrowser: false,      tier: "story", order: 7  },
  { name: "Accessibility",  label: "Accessibility Tests",  statusSuffix: "Accessibility",  maxTurns: 10, requiresBrowser: "optional", tier: "story", order: 8  },
  { name: "Exploratory",    label: "Exploratory Tests",    statusSuffix: "Exploratory",    maxTurns: 10, requiresBrowser: "optional", tier: "story", order: 9  },
  { name: "UAT",             label: "User Acceptance Tests", statusSuffix: "UAT",             maxTurns: 15, requiresBrowser: true,       tier: "story", order: 10 },
];

/** All test types combined */
export const ALL_TEST_TYPES: TestTypeConfig[] = [...TASK_TEST_TYPES, ...STORY_TEST_TYPES];
