---
name: develop
description: "ALWAYS use this skill when implementing new features, fixing bugs, or modifying code in the Cortex codebase. Enforces test-driven development discipline: write tests first, then implement, then verify. Covers agent-server code, training scripts, data pipelines, and any code that will run unattended. Do NOT skip this skill and write code directly."
allowed-tools:
  - Read
  - Grep
  - Glob
  - Edit
  - Write
  - Bash
argument-hint: "[feature description] or [fix <bug description>]"
---

# /develop <task>

Develop code using test-driven development. Covers new features and bug fixes for any code in the Cortex project (agent-server, scripts, tools, pipeline code).

The argument determines the mode:

| Argument pattern | Mode | Example |
|---|---|---|
| `fix <description>` | Bugfix | `/develop fix task parser crashes on empty TASKS.md` |
| Anything else | Feature | `/develop add experiment cost tracking` |

---

## The Iron Law

```
NO PRODUCTION CODE WITHOUT A FAILING TEST FIRST
```

Wrote code before writing a test? Delete the code. Write the test. Watch it fail. Then reimplement.

- Do not keep the deleted code as "reference"
- Do not "adapt" it while writing tests
- Delete means delete — start fresh from what the test demands

**Violating the letter of this rule is violating the spirit.**

---

## Mode: Feature

### Step 1: Understand

1. Read the relevant source files.
2. Check `context/decisions/` for constraints on the area you're changing.
3. Search for existing patterns — functions, types, utilities — that can be reused. Do not build what already exists.
4. If the scope is large (>3 files, architectural change), use `/solution-design` to plan first.
5. If the feature involves CLI design (new subcommand, new CLI tool, CLI flag changes), read `/cli-standards` for the 7 mandatory rules.

### Step 2: Write tests

1. Identify or create the test file — colocated near the source file, or in a `tests/` directory.
2. Write failing tests that describe the expected behavior. Cover:
   - Happy path (the feature works as intended)
   - Edge cases (empty inputs, missing data, error conditions)
   - Integration points (does it interact correctly with adjacent components?)
3. Run tests to confirm they fail.

### Step 3: Implement

1. Write the minimum code to make tests pass.
2. Follow existing patterns in the codebase (naming, error handling, types).
3. Keep files under reasonable length. Extract modules if needed.
4. Run tests after each significant change.

### Step 4: Verify

1. All tests pass.
2. No unintended side effects — review your diff with `git diff`.
3. If touching Python: check types/lint if tools are available.

### Step 5: Document

1. If the change is non-trivial, add a note to the relevant STATUS.md.
2. If a design decision was made, check whether a Decision Record is warranted.
3. If you modified a convention or rule that appears in multiple documents, propagate the change.

---

## Mode: Bugfix

### Step 1: Reproduce

1. Read the bug description and identify the symptom.
2. Trace the code path — read the relevant source files, follow the execution flow.
3. Identify the root cause.
4. Check logs or error output if available.

### Step 2: Write regression test

1. Write a test that reproduces the bug.
2. The test should fail with the current code (confirming the bug exists).
3. Run tests — the new test should fail, others should pass.

### Step 3: Fix

1. Apply the minimum change to fix the root cause.
2. Run tests — all tests should now pass.

### Step 4: Verify

1. All tests pass.
2. Review diff — confirm the fix is targeted and doesn't introduce new issues.
3. If the bug was in a hot path, consider whether adjacent code has the same pattern.

---

## Common Rationalizations

| Excuse | Reality |
|--------|---------|
| "Too simple to need a test" | Simple code breaks. The test takes 30 seconds to write. |
| "I'll add tests after implementing" | Tests that pass immediately prove nothing — you never saw them catch the bug. |
| "I already tested it manually" | Manual testing is ad-hoc. No record, can't re-run, easy to miss cases. |
| "The fix is obvious, just one line" | One-line fixes cause regressions. The regression test takes 2 minutes. |
| "This is just a config change" | Config changes that affect behavior need tests. If it can break, test it. |
| "I'm almost done, adding tests now would slow me down" | Sunk cost fallacy. Tests now prevent debugging later. |
| "Keep the code as reference, then write tests" | You'll adapt it instead of starting fresh. That's testing after, not TDD. |
| "The existing code has no tests, why start now?" | You're improving the codebase. Add tests for what you touch. |
| "This is infrastructure, not business logic" | Infrastructure bugs take down everything. Test it more, not less. |
| "I need to explore the approach first" | Fine — prototype, then delete it and start with TDD. Exploration is not implementation. |
| "The user is waiting / this is urgent" | Urgency makes regression tests MORE important, not less. The next occurrence won't have a user watching to verify. Write the test first — it takes 2 minutes. |

---

## Red Flags — STOP and Reassess

If you notice any of these, stop and return to Step 2 (Write tests):

- Writing implementation code before any test exists
- A test passes immediately without any implementation change
- Rationalizing "just this once" or "this case is different"
- Expressing confidence about correctness without running tests
- Wanting to commit before all tests pass
- Three or more fix attempts on the same bug — this signals an architectural problem, not a simple bug. Stop fixing and investigate the design.
- Claiming "tests after achieve the same goals" — tests-after verify what you built; tests-first verify what's required. They are not equivalent.

---

## Verification Gate

Before claiming any task is complete:

1. **Run tests**: See the output, count failures — zero expected
2. **Review diff**: `git diff` — confirm changes are targeted and complete
3. **Only then** claim the work is done

Never use "should work", "probably passes", or "looks correct". Evidence before claims.

---

## When TDD Does Not Apply

TDD is mandatory for code changes. It does NOT apply to:

- Pure documentation changes (CORTEX.md, STATUS.md, experiment files)
- Configuration value changes with no code path (e.g., changing a budget number)
- Prompt text changes in skills (SKILL.md files)
- Data analysis scripts that produce one-time reports (though reusable analysis tools should be tested)

When in doubt: if the change could introduce a regression, it needs a test.
