// =============================================================================
// prompts/doc-updater.ts - Documentation-first phase prompt builders
//
// Builds system/user prompts for 4 specialist doc-updater agents, each
// responsible for updating one project document to reflect the desired
// end state described in the epic brief.
// =============================================================================

import type { ProjectConfig, Task } from "../types.js";
import { buildCommonContext } from "./common.js";

export interface DocUpdaterPersona {
  role: string;
  documentName: string;
  documentPath: string;
  focusAreas: string;
}

export function getDocUpdaterPersonas(config: ProjectConfig): DocUpdaterPersona[] {
  return [
    {
      role: "Solutions Architect",
      documentName: "solution-design.md",
      documentPath: config.docSolutionDesign,
      focusAreas: `- Architecture changes: new components, modified components, removed components
- Data flow: how data moves between components for the new feature
- Tech decisions: any new libraries, frameworks, or patterns introduced
- API contracts: new or modified endpoints, request/response shapes
- Database changes: new tables, columns, indexes, migrations
- Integration points: how the new feature connects to existing systems`,
    },
    {
      role: "Product Manager",
      documentName: "prd.md",
      documentPath: config.docPrd,
      focusAreas: `- Requirements: new functional and non-functional requirements
- User stories: mapped to the features being built
- Success metrics: how success is measured for the new feature
- Scope: what is in scope and out of scope
- Dependencies: external dependencies or prerequisites
- Acceptance criteria: high-level criteria for the feature as a whole`,
    },
    {
      role: "Business Analyst",
      documentName: "business-flows.md",
      documentPath: config.docBusinessFlows,
      focusAreas: `- Process flows: new or modified user workflows
- User journeys: step-by-step interactions with the new feature
- State machines: state transitions for new entities or processes
- Integration points: how the feature interacts with external systems
- Business rules: validation rules, constraints, edge cases
- Error flows: what happens when things go wrong`,
    },
    {
      role: "System Architect",
      documentName: "system-diagram.md",
      documentPath: config.docSystemDiagram,
      focusAreas: `- Component diagrams: new or modified system components
- Deployment topology: changes to infrastructure or deployment
- Service boundaries: new services or modified service responsibilities
- Communication patterns: new API calls, events, message queues
- Security boundaries: authentication, authorization changes
- Data storage: new databases, caches, or storage systems`,
    },
  ];
}

export function buildDocUpdaterSystemPrompt(
  persona: DocUpdaterPersona,
  config: ProjectConfig,
  backlogFile: string,
): string {
  const commonContext = buildCommonContext(config, backlogFile);
  return `You are a ${persona.role} responsible for maintaining the ${persona.documentName}.
Your task is to update this document to reflect the DESIRED END STATE
of the feature described in the epic brief below.

CRITICAL: You are writing what the project WILL look like after all
tasks are implemented, NOT what it looks like today. Write in present
tense as if all features already exist.

${commonContext}

Rules:
- Preserve existing content that remains valid
- Add/modify sections to reflect the new feature
- Remove content that the new feature replaces
- Maintain the document's existing structure and formatting conventions
- Be specific — reference actual file paths, endpoints, components, data models

Focus areas for your role:
${persona.focusAreas}

Process:
1. Read the current document at: ${persona.documentPath}
2. Understand the epic brief and all planned tasks
3. Update the document using Edit or Write tools
4. Ensure the document describes the complete end state`;
}

export function buildDocUpdaterUserPrompt(
  epicBrief: string,
  currentDocContent: string,
  allTasks: Task[],
  persona: DocUpdaterPersona,
): string {
  const taskSummaries = allTasks.map(t => ({
    id: t.id,
    name: t.name,
    description: t.description,
    acceptance_criteria: t.acceptance_criteria.map(ac => ac.criterion),
  }));

  return `## Epic/Feature Brief
${epicBrief}

## Planned Tasks (in implementation order)
${JSON.stringify(taskSummaries, null, 2)}

## Current Document Content (${persona.documentName})
${currentDocContent}

Update the document at ${persona.documentPath} to describe the end state after ALL tasks above are completed.
Use Read to check the current file, then Edit/Write to update it.`;
}
