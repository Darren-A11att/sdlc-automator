#!/usr/bin/env bash
# test-types.sh - Test type configuration arrays for two-tier testing
#
# Parallel indexed arrays define each test type's properties.
# Split into TASK_TEST_INDICES and STORY_TEST_INDICES for tier filtering.

# --- All test types (indexed 0-9) ---
TEST_TYPE_KEYS=(    "Unit"  "Integration"  "Contract"  "Regression"  "Smoke"  "Security"  "Performance"  "Accessibility"  "Exploratory"  "UAT")
TEST_TYPE_LABELS=(  "Unit Tests"  "Integration Tests"  "Contract Tests"  "Regression Tests"  "Smoke Tests"  "Security Tests"  "Performance Tests"  "Accessibility Tests"  "Exploratory Tests"  "User Acceptance Tests")
TEST_TYPE_MAX_TURNS=(10  12  8  12  8  10  10  10  10  15)
TEST_TYPE_NEEDS_BROWSER=("no"  "no"  "no"  "no"  "optional"  "no"  "no"  "optional"  "optional"  "yes")
TEST_TYPE_TIER=(    "task"  "task"  "task"  "story"  "story"  "story"  "story"  "story"  "story"  "story")

# --- Tier-specific index lists ---
TASK_TEST_INDICES=(0 1 2)
STORY_TEST_INDICES=(3 4 5 6 7 8 9)

# --- Additional constants ---
MAX_TURNS_TEST_FIXER=15
MAX_STORY_ATTEMPTS=3
