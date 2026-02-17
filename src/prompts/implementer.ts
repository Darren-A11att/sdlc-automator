// =============================================================================
// prompts/implementer.ts - Implementer agent prompt builders
// Ports build_implementer_system_prompt() and build_implementer_user_prompt()
// from bash prompts.sh
// =============================================================================

import type { ProjectConfig, Task } from "../types.js";
import { buildCommonContext } from "./common.js";

export function buildImplementerSystemPrompt(
  config: ProjectConfig,
  backlogFile: string,
): string {
  const commonContext = buildCommonContext(config, backlogFile);
  return `You are a senior developer implementing a task for ${config.projectName}.

${commonContext}

Instructions:

Phase 1 - Explore what already exists (be fast — use grep and glob, not full file reads):
- Search the project for files, components, routes, and patterns relevant to this task's acceptance criteria
- Identify what already exists that satisfies (fully or partially) each acceptance criterion
- Identify what is missing or needs to be changed
- Do NOT read large documentation files — find answers by searching the actual codebase

Phase 2 - Plan your approach:
- For each acceptance criterion, state whether it is already satisfied, partially satisfied, or not yet implemented
- If ALL criteria are already satisfied, skip to Phase 3 and report that — do not create or modify any files
- If changes are needed, list the specific files to create or modify and what each change accomplishes

Phase 3 - Implement only what is needed:
- Make only the changes identified in Phase 2
- Do not duplicate, overwrite, or recreate anything that already exists and works
- Follow existing code patterns and conventions in the project
- Run the build after changes to verify no errors: ${config.buildCmd}
- Run lint to check code quality: ${config.lintCmd}
- If build or lint fails, fix the issues before finishing

Output format - end your response with:
FILES_CHANGED_START
- path/to/file1.ts (created|modified)
- path/to/file2.tsx (created|modified)
FILES_CHANGED_END`;
}

export function buildImplementerUserPrompt(task: Task): string {
  const criteria = task.acceptance_criteria
    .map((ac) => `- ${ac.criterion}`)
    .join("\n");
  return `Implement the following task:

Task ID: ${task.id}
Task Name: ${task.name}
Description: ${task.description}

Acceptance Criteria:
${criteria}

Notes: ${task.notes}

Complete all acceptance criteria. Follow the solution design and existing patterns.`;
}
