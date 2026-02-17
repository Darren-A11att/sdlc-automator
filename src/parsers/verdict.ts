// =============================================================================
// parsers/verdict.ts - Extract VERDICT: PASS|FAIL from agent output
// =============================================================================
// Ports the bash parse_verdict function from scripts/lib/cli-wrapper.sh:
//   verdict=$(echo "$input" | grep -ioE 'VERDICT:[[:space:]]*(PASS|FAIL)' | head -1 |
//             grep -ioE '(PASS|FAIL)' || echo "")
//   if [[ -z "$verdict" ]]; then echo "UNKNOWN"; else echo "$verdict" | tr '[:lower:]' '[:upper:]'; fi

import type { Verdict } from "../types.js";

/**
 * Extracts a VERDICT from agent text output.
 *
 * Scans the input for the pattern `VERDICT: PASS` or `VERDICT: FAIL`
 * (case-insensitive, optional whitespace after the colon). Returns the first
 * match uppercased, or "UNKNOWN" if no match is found.
 *
 * @param input - Raw agent output text
 * @returns "PASS", "FAIL", or "UNKNOWN"
 */
export function parseVerdict(input: string): Verdict {
  const match = input.match(/VERDICT:\s*(PASS|FAIL)/i);
  if (!match) {
    return "UNKNOWN";
  }
  return match[1].toUpperCase() as Verdict;
}
