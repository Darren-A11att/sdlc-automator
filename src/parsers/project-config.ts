// =============================================================================
// parsers/project-config.ts - Extract project config JSON from agent output
// =============================================================================

/**
 * Extracts JSON between PROJECT_CONFIG_START and PROJECT_CONFIG_END markers.
 *
 * @param input - Raw agent output text
 * @returns Parsed project config object, or null if extraction/parsing fails
 */
export function parseProjectConfig(input: string): Record<string, unknown> | null {
  const match = input.match(/PROJECT_CONFIG_START\r?\n?([\s\S]*?)\r?\n?PROJECT_CONFIG_END/);
  if (!match) {
    return null;
  }

  try {
    return JSON.parse(match[1].trim()) as Record<string, unknown>;
  } catch {
    return null;
  }
}
