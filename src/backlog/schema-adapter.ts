// =============================================================================
// schema-adapter.ts - Bidirectional adapter for external backlog formats
// =============================================================================

import type {
  SchemaMap,
  BacklogFile,
  Task,
  Story,
  AcceptanceCriterion,
  TaskStatus,
  StoryStatus,
} from "../types.js";

export class SchemaAdapter {
  private extraFieldsStash: Map<string, Record<string, unknown>> = new Map();
  private rootExtraFields: Record<string, unknown> = {};

  constructor(private readonly map: SchemaMap) {}

  // ===========================================================================
  // Read Path: External → Canonical
  // ===========================================================================

  toCanonical(external: Record<string, unknown>): BacklogFile {
    this.extraFieldsStash.clear();
    this.rootExtraFields = {};

    // 1. Resolve root keys
    const tasksKey = this.map.rootMapping.tasks || "tasks";
    const storiesKey = this.map.rootMapping.stories || "stories";

    const externalTasks = external[tasksKey];
    const externalStories = external[storiesKey];

    if (!Array.isArray(externalTasks)) {
      throw new Error(
        `Expected tasks array at key "${tasksKey}", got ${typeof externalTasks}`
      );
    }

    // Store extra root-level fields
    const knownRootKeys = new Set([tasksKey, storiesKey, "schema"]);
    for (const [key, value] of Object.entries(external)) {
      if (!knownRootKeys.has(key)) {
        this.rootExtraFields[key] = value;
      }
    }

    // 2. Convert tasks
    const tasks: Task[] = externalTasks.map((item) =>
      this.toCanonicalTask(item as Record<string, unknown>)
    );

    // 3. Convert stories (optional)
    let stories: Story[] | undefined;
    if (Array.isArray(externalStories)) {
      stories = externalStories.map((item) =>
        this.toCanonicalStory(item as Record<string, unknown>)
      );
    }

    // 4. Preserve schema if present
    const schema = external.schema as BacklogFile["schema"] | undefined;

    return {
      schema,
      stories,
      tasks,
    };
  }

  private toCanonicalTask(item: Record<string, unknown>): Task {
    const mapping = this.map.taskFieldMapping;
    const defaults = this.map.defaults;

    // Resolve fields using reverse mapping
    const id = this.readField<string>(item, "id", mapping, defaults);
    const story_id = this.readField<string | undefined>(
      item,
      "story_id",
      mapping,
      defaults
    );
    const name = this.readField<string>(item, "name", mapping, defaults);
    const status = this.mapStatusToCanonical(
      this.readField<string>(item, "status", mapping, defaults)
    ) as TaskStatus;
    const description = this.readField<string>(
      item,
      "description",
      mapping,
      defaults
    );
    const notes = this.readField<string>(item, "notes", mapping, defaults);
    const attempt_count = this.readField<number>(
      item,
      "attempt_count",
      mapping,
      defaults
    );

    // Transform acceptance criteria
    const acceptance_criteria = this.toCanonicalCriteria(
      this.readField<unknown>(item, "acceptance_criteria", mapping, defaults)
    );

    // Store extra fields
    this.storeExtraFields(id, item, mapping);

    return {
      id,
      story_id,
      name,
      status,
      description,
      acceptance_criteria,
      notes,
      attempt_count,
    };
  }

  private toCanonicalStory(item: Record<string, unknown>): Story {
    const mapping = this.map.storyFieldMapping;
    const defaults = this.map.defaults;

    const id = this.readField<string>(item, "id", mapping, defaults);
    const name = this.readField<string>(item, "name", mapping, defaults);
    const status = this.mapStatusToCanonical(
      this.readField<string>(item, "status", mapping, defaults)
    ) as StoryStatus;
    const description = this.readField<string>(
      item,
      "description",
      mapping,
      defaults
    );
    const notes = this.readField<string>(item, "notes", mapping, defaults);
    const attempt_count = this.readField<number>(
      item,
      "attempt_count",
      mapping,
      defaults
    );
    const task_ids = this.readField<string[]>(
      item,
      "task_ids",
      mapping,
      defaults
    );

    const acceptance_criteria = this.toCanonicalCriteria(
      this.readField<unknown>(item, "acceptance_criteria", mapping, defaults)
    );

    this.storeExtraFields(id, item, mapping);

    return {
      id,
      name,
      status,
      description,
      acceptance_criteria,
      task_ids,
      notes,
      attempt_count,
    };
  }

  private readField<T>(
    item: Record<string, unknown>,
    canonicalKey: string,
    mapping: Record<string, string | null>,
    defaults: Record<string, unknown>
  ): T {
    const externalKey = mapping[canonicalKey];

    // If mapping is null, use default
    if (externalKey === null) {
      return defaults[canonicalKey] as T;
    }

    // If mapping is undefined, use canonical key as-is
    const key = externalKey ?? canonicalKey;
    const value = item[key];

    // If value is undefined/null, use default
    if (value === undefined || value === null) {
      const defaultValue = defaults[canonicalKey];
      if (defaultValue !== undefined) {
        return defaultValue as T;
      }
    }

    return value as T;
  }

  private toCanonicalCriteria(external: unknown): AcceptanceCriterion[] {
    if (!external) {
      return [];
    }

    const format = this.map.acceptanceCriteria.externalFormat;

    if (format === "string-array") {
      if (!Array.isArray(external)) {
        return [];
      }
      return (external as string[]).map((text) => ({
        criterion: text,
        met: (this.map.defaults.met as boolean) ?? false,
      }));
    }

    if (format === "object-array") {
      if (!Array.isArray(external)) {
        return [];
      }
      const criterionField =
        this.map.acceptanceCriteria.criterionField || "criterion";
      const metField = this.map.acceptanceCriteria.metField || "met";

      return (external as Record<string, unknown>[]).map((item) => ({
        criterion: (item[criterionField] as string) || "",
        met:
          (item[metField] as boolean) ??
          ((this.map.defaults.met as boolean) ?? false),
      }));
    }

    if (format === "object-different-keys") {
      const criterionField = this.map.acceptanceCriteria.criterionField;
      const metField = this.map.acceptanceCriteria.metField;

      if (!criterionField || !metField) {
        throw new Error(
          'Schema map error: "object-different-keys" format requires criterionField and metField'
        );
      }

      if (!Array.isArray(external)) {
        return [];
      }

      return (external as Record<string, unknown>[]).map((item) => ({
        criterion: (item[criterionField] as string) || "",
        met:
          (item[metField] as boolean) ??
          ((this.map.defaults.met as boolean) ?? false),
      }));
    }

    return [];
  }

  private mapStatusToCanonical(externalStatus: string): string {
    return this.map.statusMapping.toCanonical[externalStatus] || externalStatus;
  }

  private storeExtraFields(
    id: string,
    item: Record<string, unknown>,
    mapping: Record<string, string | null>
  ): void {
    // Collect all external keys that are used in mapping
    const usedKeys = new Set<string>();
    for (const [canonicalKey, externalKey] of Object.entries(mapping)) {
      if (externalKey !== null) {
        usedKeys.add(externalKey || canonicalKey);
      }
    }

    // Also add acceptance_criteria key
    const criteriaMapping = this.map.taskFieldMapping.acceptance_criteria;
    if (criteriaMapping !== null) {
      usedKeys.add(criteriaMapping || "acceptance_criteria");
    }

    // Store any fields not in the mapping
    const extras: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(item)) {
      if (!usedKeys.has(key)) {
        extras[key] = value;
      }
    }

    if (Object.keys(extras).length > 0) {
      this.extraFieldsStash.set(id, extras);
    }
  }

  // ===========================================================================
  // Write Path: Canonical → External
  // ===========================================================================

  toExternal(canonical: BacklogFile): Record<string, unknown> {
    const output: Record<string, unknown> = {};

    // 1. Restore root extra fields
    for (const [key, value] of Object.entries(this.rootExtraFields)) {
      output[key] = value;
    }

    // 2. Map root keys
    const tasksKey = this.map.rootMapping.tasks || "tasks";
    const storiesKey = this.map.rootMapping.stories || "stories";

    // 3. Convert tasks
    output[tasksKey] = canonical.tasks.map((task) =>
      this.toExternalTask(task)
    );

    // 4. Convert stories if present
    if (canonical.stories && canonical.stories.length > 0) {
      output[storiesKey] = canonical.stories.map((story) =>
        this.toExternalStory(story)
      );
    }

    // 5. Preserve schema if present
    if (canonical.schema) {
      output.schema = canonical.schema;
    }

    return output;
  }

  private toExternalTask(task: Task): Record<string, unknown> {
    const mapping = this.map.taskFieldMapping;
    const output: Record<string, unknown> = {};

    // Map each canonical field to external key (skip if mapping is null)
    this.writeField(output, "id", task.id, mapping);
    this.writeField(output, "story_id", task.story_id, mapping);
    this.writeField(output, "name", task.name, mapping);
    this.writeField(
      output,
      "status",
      this.mapStatusToExternal(task.status),
      mapping
    );
    this.writeField(output, "description", task.description, mapping);
    this.writeField(output, "notes", task.notes, mapping);
    this.writeField(output, "attempt_count", task.attempt_count, mapping);

    // Transform acceptance criteria
    const externalCriteria = this.toExternalCriteria(task.acceptance_criteria);
    this.writeField(
      output,
      "acceptance_criteria",
      externalCriteria,
      mapping
    );

    // Restore extra fields
    const extras = this.extraFieldsStash.get(task.id);
    if (extras) {
      for (const [key, value] of Object.entries(extras)) {
        output[key] = value;
      }
    }

    return output;
  }

  private toExternalStory(story: Story): Record<string, unknown> {
    const mapping = this.map.storyFieldMapping;
    const output: Record<string, unknown> = {};

    this.writeField(output, "id", story.id, mapping);
    this.writeField(output, "name", story.name, mapping);
    this.writeField(
      output,
      "status",
      this.mapStatusToExternal(story.status),
      mapping
    );
    this.writeField(output, "description", story.description, mapping);
    this.writeField(output, "notes", story.notes, mapping);
    this.writeField(output, "attempt_count", story.attempt_count, mapping);
    this.writeField(output, "task_ids", story.task_ids, mapping);

    const externalCriteria = this.toExternalCriteria(story.acceptance_criteria);
    this.writeField(
      output,
      "acceptance_criteria",
      externalCriteria,
      mapping
    );

    const extras = this.extraFieldsStash.get(story.id);
    if (extras) {
      for (const [key, value] of Object.entries(extras)) {
        output[key] = value;
      }
    }

    return output;
  }

  private writeField(
    output: Record<string, unknown>,
    canonicalKey: string,
    value: unknown,
    mapping: Record<string, string | null>
  ): void {
    const externalKey = mapping[canonicalKey];

    // If mapping is null, omit the field
    if (externalKey === null) {
      return;
    }

    // If mapping is undefined, use canonical key as-is
    const key = externalKey ?? canonicalKey;

    // Only write if value is not undefined
    if (value !== undefined) {
      output[key] = value;
    }
  }

  private toExternalCriteria(
    canonical: AcceptanceCriterion[]
  ): unknown {
    const format = this.map.acceptanceCriteria.externalFormat;

    if (format === "string-array") {
      return canonical.map((c) => c.criterion);
    }

    if (format === "object-array") {
      const criterionField =
        this.map.acceptanceCriteria.criterionField || "criterion";
      const metField = this.map.acceptanceCriteria.metField || "met";

      return canonical.map((c) => ({
        [criterionField]: c.criterion,
        [metField]: c.met,
      }));
    }

    if (format === "object-different-keys") {
      const criterionField = this.map.acceptanceCriteria.criterionField;
      const metField = this.map.acceptanceCriteria.metField;

      if (!criterionField || !metField) {
        throw new Error(
          'Schema map error: "object-different-keys" format requires criterionField and metField'
        );
      }

      return canonical.map((c) => ({
        [criterionField]: c.criterion,
        [metField]: c.met,
      }));
    }

    return [];
  }

  private mapStatusToExternal(canonicalStatus: string): string {
    return (
      this.map.statusMapping.toExternal[canonicalStatus] || canonicalStatus
    );
  }
}
