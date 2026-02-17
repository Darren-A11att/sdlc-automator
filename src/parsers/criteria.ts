// =============================================================================
// parsers/criteria.ts - Extract and validate criteria JSON from agent output
// =============================================================================
// Ports the bash parse_criteria_results function from scripts/lib/cli-wrapper.sh:
//   json=$(echo "$input" | sed -n '/CRITERIA_JSON_START/,/CRITERIA_JSON_END/{//!p;}')
//   # validate with jq -e .
//
// The extracted string must be valid JSON whose top-level value is an array of
// objects each containing a string `criterion` field and a boolean `met` field.

import type { AcceptanceCriterion } from "../types.js";

/**
 * Extracts and validates criteria results JSON from agent output.
 *
 * Looks for a JSON array between CRITERIA_JSON_START and CRITERIA_JSON_END
 * markers. Each element must conform to `{ criterion: string; met: boolean }`.
 * Returns null if the markers are absent, the content is not valid JSON, or the
 * structure does not match the expected schema.
 *
 * @param input - Raw agent output text
 * @returns Parsed array of acceptance criteria results, or null on failure
 */
export function parseCriteriaResults(
  input: string
): Array<AcceptanceCriterion> | null {
  const match = input.match(
    /CRITERIA_JSON_START\r?\n?([\s\S]*?)\r?\n?CRITERIA_JSON_END/
  );
  if (!match) {
    return null;
  }

  const raw = match[1].trim();
  if (!raw) {
    return null;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }

  // Validate top-level structure is a non-null array.
  if (!Array.isArray(parsed)) {
    return null;
  }

  // Validate each element has the expected shape.
  const results: Array<AcceptanceCriterion> = [];
  for (const item of parsed) {
    if (
      typeof item !== "object" ||
      item === null ||
      typeof (item as Record<string, unknown>)["criterion"] !== "string" ||
      typeof (item as Record<string, unknown>)["met"] !== "boolean"
    ) {
      return null;
    }
    results.push({
      criterion: (item as Record<string, unknown>)["criterion"] as string,
      met: (item as Record<string, unknown>)["met"] as boolean,
    });
  }

  return results;
}
