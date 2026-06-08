#!/usr/bin/env bash
# Run Cortex test suite against an isolated, seeded CORTEX_HOME.
#
# Creates a temp directory, runs `cortex init` non-interactively, seeds
# test-compatible configs, then runs the full test suite. Cleans up on exit.
#
# Usage:
#   bash scripts/run-tests.sh              # full suite
#   bash scripts/run-tests.sh --quick      # skip depcruise (faster iteration)

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
AGENT_DIR="$(dirname "$SCRIPT_DIR")"

cd "$AGENT_DIR"

QUICK=false
if [[ "${1:-}" == "--quick" ]]; then
  QUICK=true
fi

# ── Create isolated CORTEX_HOME ──────────────────────────────────

CORTEX_HOME=$(mktemp -d)
cleanup() { rm -rf "$CORTEX_HOME"; }
trap cleanup EXIT

export CORTEX_HOME

# ── Init ─────────────────────────────────────────────────────────

echo "[run-tests] cortex init → $CORTEX_HOME"

printf 'claude\nnone\nn\n\n\n\nn\n\n\n' | node --import tsx src/entry/cli.ts init \
  --home "$CORTEX_HOME" \
  --gateway-config-dir "$CORTEX_HOME/gateway" \
  2>/dev/null

# ── Seed test configs ────────────────────────────────────────────

bash "$SCRIPT_DIR/seed-test-config.sh" "$CORTEX_HOME"

# ── Dependency check (skip in --quick mode) ─────────────────────

if ! $QUICK; then
  echo "[run-tests] dependency-cruise"
  npx depcruise src --validate
fi

# ── Slack emoji shortcode lint ──────────────────────────────────

echo "[run-tests] lint: no Slack emoji shortcodes"
node --import tsx scripts/lint-no-slack-shortcodes.ts

# ── Run tests ────────────────────────────────────────────────────

echo "[run-tests] running test suite"

# Match the same glob pattern as the original npm test command.
# Use nullglob to handle the case where no files match a pattern.
shopt -s nullglob
TEST_FILES=(
  tests/*.test.ts
  tests/core/*.test.ts
  tests/agent-adapter/*.test.ts
  tests/store/*.test.ts
  tests/events/*.test.ts
  tests/orch/*.test.ts
  tests/threads/*.test.ts
  tests/domain/**/*.test.ts
  tests/platform/*.test.ts
  tests/tui/*.test.ts
  tests/tui/*.test.tsx
)
shopt -u nullglob

# Filter out debug/shim files and integration tests. Integration tests fork real
# server subprocesses and need longer than the 15s unit-test timeout; running them
# here would systematically time out and orphan the spawned app.ts process. They run
# in a dedicated pass below with no 15s cap.
FILTERED=()
INTEGRATION=()
for f in "${TEST_FILES[@]}"; do
  case "$(basename "$f")" in
    _shims-*|_combined*|_plan*) ;;
    integration-*) INTEGRATION+=("$f") ;;
    *) FILTERED+=("$f") ;;
  esac
done

# --import ./tests/_test-home.ts is a belt-and-suspenders isolation guard (no-op here
# since CORTEX_HOME is already set above; protects ad-hoc invocations of this command).
node --import tsx --import ./tests/_test-home.ts --test --test-force-exit --test-timeout=15000 "${FILTERED[@]}"

# ── Integration tests (forked servers; longer timeout, run last) ─────
if [[ ${#INTEGRATION[@]} -gt 0 ]]; then
  echo "[run-tests] running integration tests"
  node --import tsx --test --test-force-exit --test-timeout=120000 "${INTEGRATION[@]}"
fi
