// =============================================================================
// parsers/notes.ts - Extract content between NOTES_START / NOTES_END markers
// =============================================================================
// Ports the bash parse_notes function from scripts/lib/cli-wrapper.sh:
//   notes=$(echo "$input" | sed -n '/NOTES_START/,/NOTES_END/{//!p;}')
//
// The sed idiom prints lines that fall between the two marker lines, excluding
// the marker lines themselves (the {//!p;} guard skips lines that match either
// delimiter pattern).

/**
 * Extracts text between NOTES_START and NOTES_END markers in agent output.
 *
 * The markers themselves are not included in the result. Leading and trailing
 * whitespace on the extracted block is trimmed. Returns an empty string if
 * either marker is absent or no content exists between them.
 *
 * @param input - Raw agent output text
 * @returns Extracted notes content, or an empty string
 */
export function parseNotes(input: string): string {
  // Use the `s` (dotAll) flag so `.` matches newlines, enabling multi-line capture.
  const match = input.match(/NOTES_START\r?\n?([\s\S]*?)\r?\n?NOTES_END/);
  if (!match) {
    return "";
  }
  return match[1].trim();
}
