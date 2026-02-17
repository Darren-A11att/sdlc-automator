// =============================================================================
// config.ts - Constants matching current bash values exactly
// =============================================================================

/** Maximum task retry attempts before marking as Blocked */
export const MAX_ATTEMPTS = 5;

/** Consecutive blocked tasks before stopping and generating report */
export const MAX_CONSECUTIVE_BLOCKS = 5;

/** Model identifiers */
export const MODEL_SONNET = "claude-sonnet-4-5-20250929";
export const MODEL_OPUS = "claude-opus-4-6";

/** Max turns per agent role */
export const MAX_TURNS_IMPLEMENTER = 25;
export const MAX_TURNS_REVIEWER = 15;
export const MAX_TURNS_TESTER = 15;
export const MAX_TURNS_FIXER = 20;
export const MAX_TURNS_BLOCKER = 5;
export const MAX_TURNS_REPORTER = 10;

/** Default allowed tools for all agents */
export const ALLOWED_TOOLS = ["Bash", "Read", "Edit", "Write", "Glob", "Grep"];
