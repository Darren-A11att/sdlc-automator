// =============================================================================
// schema-checker.ts - Validates external backlog JSON against canonical schema
// =============================================================================

import type { CompatibilityResult, CompatibilityIssue, ExternalSchemaFingerprint } from "../types.js";

const CANONICAL_STATUSES = new Set([
  "Todo",
  "In-Progress",
  "Review",
  "Testing",
  "Done",
  "Blocked",
]);

/**
 * Checks if a status value is valid (canonical or Testing:* pattern)
 */
function isValidStatus(status: string): boolean {
  if (CANONICAL_STATUSES.has(status)) return true;
  if (status.startsWith("Testing:")) return true;
  return false;
}

/**
 * Determines the shape of acceptance_criteria in a task
 */
function getCriteriaShape(criteria: unknown): ExternalSchemaFingerprint["criteriaShape"] {
  if (!Array.isArray(criteria) || criteria.length === 0) return "absent";

  const first = criteria[0];
  if (typeof first === "string") return "string-array";
  if (typeof first === "object" && first !== null) {
    if ("criterion" in first && "met" in first) return "object-array";
    return "object-different-keys";
  }

  return "absent";
}

/**
 * Finds the task array key in the data object
 */
function findTaskArrayKey(data: Record<string, unknown>): string {
  // Check for "tasks" first
  if ("tasks" in data && Array.isArray(data.tasks)) return "tasks";

  // Look for first array of objects at root level
  for (const [key, value] of Object.entries(data)) {
    if (Array.isArray(value) && value.length > 0 && typeof value[0] === "object") {
      return key;
    }
  }

  return "tasks"; // default
}

/**
 * Extracts all unique keys from first N items of an array
 */
function extractSampleKeys(arr: unknown[], maxSamples: number = 5): string[] {
  const keySet = new Set<string>();
  const sample = arr.slice(0, maxSamples);

  for (const item of sample) {
    if (typeof item === "object" && item !== null) {
      Object.keys(item).forEach((key) => keySet.add(key));
    }
  }

  return Array.from(keySet).sort();
}

/**
 * Extracts all unique status values from task array
 */
function extractStatusValues(tasks: unknown[]): string[] {
  const statusSet = new Set<string>();

  for (const task of tasks) {
    if (typeof task === "object" && task !== null && "status" in task) {
      const status = (task as { status: unknown }).status;
      if (typeof status === "string") {
        statusSet.add(status);
      }
    }
  }

  return Array.from(statusSet).sort();
}

/**
 * Validates external backlog JSON against canonical SDLC Automator schema
 * and produces a fingerprint for compatibility analysis.
 */
export function checkCompatibility(data: unknown): CompatibilityResult {
  const issues: CompatibilityIssue[] = [];

  // Root must be an object
  if (typeof data !== "object" || data === null || Array.isArray(data)) {
    issues.push({
      type: "wrong_type",
      path: "$",
      expected: "object",
      actual: Array.isArray(data) ? "array" : typeof data,
    });
    // Return early with minimal fingerprint
    return {
      compatible: false,
      issues,
      fingerprint: {
        rootKeys: [],
        taskArrayKey: "tasks",
        sampleTaskKeys: [],
        criteriaShape: "absent",
        statusValues: [],
      },
    };
  }

  const dataObj = data as Record<string, unknown>;

  // Build fingerprint
  const rootKeys = Object.keys(dataObj).sort();
  const taskArrayKey = findTaskArrayKey(dataObj);
  const taskArray = dataObj[taskArrayKey];

  // Check for tasks array
  if (!Array.isArray(taskArray)) {
    issues.push({
      type: "missing_root_key",
      path: "$.tasks",
      expected: "array",
      actual: typeof taskArray,
    });
    // Return with partial fingerprint
    return {
      compatible: false,
      issues,
      fingerprint: {
        rootKeys,
        taskArrayKey,
        sampleTaskKeys: [],
        criteriaShape: "absent",
        statusValues: [],
      },
    };
  }

  const sampleTaskKeys = extractSampleKeys(taskArray);
  const statusValues = extractStatusValues(taskArray);
  const firstTask = taskArray[0] as Record<string, unknown> | undefined;
  const criteriaShape = firstTask && "acceptance_criteria" in firstTask
    ? getCriteriaShape(firstTask.acceptance_criteria)
    : "absent";

  const fingerprint: ExternalSchemaFingerprint = {
    rootKeys,
    taskArrayKey,
    sampleTaskKeys,
    criteriaShape,
    statusValues,
  };

  // Validate sample tasks
  const sampleTasks = taskArray.slice(0, 5);

  for (let i = 0; i < sampleTasks.length; i++) {
    const task = sampleTasks[i];
    if (typeof task !== "object" || task === null) {
      issues.push({
        type: "wrong_type",
        path: `$.${taskArrayKey}[${i}]`,
        expected: "object",
        actual: typeof task,
      });
      continue;
    }

    const taskObj = task as Record<string, unknown>;
    const taskPath = `$.${taskArrayKey}[${i}]`;

    // Check required fields
    const requiredFields: Record<string, string> = {
      id: "string",
      name: "string",
      status: "string",
      description: "string",
      acceptance_criteria: "array",
    };

    for (const [field, expectedType] of Object.entries(requiredFields)) {
      if (!(field in taskObj)) {
        issues.push({
          type: "missing_field",
          path: `${taskPath}.${field}`,
          expected: expectedType,
          actual: "undefined",
        });
      } else {
        const actualType = Array.isArray(taskObj[field]) ? "array" : typeof taskObj[field];
        if (actualType !== expectedType) {
          issues.push({
            type: "wrong_type",
            path: `${taskPath}.${field}`,
            expected: expectedType,
            actual: actualType,
          });
        }
      }
    }

    // Validate status enum
    if ("status" in taskObj && typeof taskObj.status === "string") {
      if (!isValidStatus(taskObj.status)) {
        issues.push({
          type: "invalid_enum",
          path: `${taskPath}.status`,
          expected: "one of: Todo, In-Progress, Review, Testing, Testing:*, Done, Blocked",
          actual: taskObj.status,
        });
      }
    }

    // Validate acceptance_criteria shape
    if ("acceptance_criteria" in taskObj && Array.isArray(taskObj.acceptance_criteria)) {
      const criteria = taskObj.acceptance_criteria;
      for (let j = 0; j < criteria.length; j++) {
        const criterion = criteria[j];
        const criterionPath = `${taskPath}.acceptance_criteria[${j}]`;

        if (typeof criterion === "string") {
          issues.push({
            type: "wrong_shape",
            path: criterionPath,
            expected: "object with {criterion: string, met: boolean}",
            actual: "string",
          });
        } else if (typeof criterion === "object" && criterion !== null) {
          const critObj = criterion as Record<string, unknown>;
          if (!("criterion" in critObj) || !("met" in critObj)) {
            issues.push({
              type: "wrong_shape",
              path: criterionPath,
              expected: "object with {criterion: string, met: boolean}",
              actual: `object with keys: ${Object.keys(critObj).join(", ")}`,
            });
          } else {
            if (typeof critObj.criterion !== "string") {
              issues.push({
                type: "wrong_type",
                path: `${criterionPath}.criterion`,
                expected: "string",
                actual: typeof critObj.criterion,
              });
            }
            if (typeof critObj.met !== "boolean") {
              issues.push({
                type: "wrong_type",
                path: `${criterionPath}.met`,
                expected: "boolean",
                actual: typeof critObj.met,
              });
            }
          }
        }
      }
    }
  }

  return {
    compatible: issues.length === 0,
    issues,
    fingerprint,
  };
}
