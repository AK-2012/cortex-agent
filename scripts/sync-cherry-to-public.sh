#!/bin/bash
# Sync new commits from main to the local public branch via cherry-pick.
# Called by the post-commit hook. Also safe for manual/scheduled runs.
# Uses a tracking ref (refs/sync/main-last-to-public) to only process new commits.
# Does NOT push — user pushes manually.
set -euo pipefail

REPO_DIR="/home/fangxin/Cortex"
LOG_FILE="/tmp/cortex-sync-cherry.log"
TRACKING_REF="refs/sync/main-last-to-public"

log() {
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*" | tee -a "$LOG_FILE"
}

cd "$REPO_DIR"

# Guard: skip if working tree is dirty
if ! git diff-index --quiet HEAD --; then
  log "SKIP: working tree is dirty"
  exit 0
fi

# Guard: skip if in the middle of a rebase
if [ -d ".git/rebase-merge" ] || [ -d ".git/rebase-apply" ]; then
  log "SKIP: rebase in progress"
  exit 0
fi

CURRENT_BRANCH=$(git branch --show-current)
ORIGINAL_BRANCH="$CURRENT_BRANCH"

# Determine the baseline: if tracking ref exists, use it; otherwise initialize
# to main HEAD so we start tracking from here (no historical catch-up).
if git rev-parse --verify "$TRACKING_REF" >/dev/null 2>&1; then
  BASELINE=$(git rev-parse "$TRACKING_REF")
else
  BASELINE=$(git rev-parse main)
  git update-ref "$TRACKING_REF" "$BASELINE"
  log "First run: tracking ref set to main ($(git rev-parse --short $BASELINE)), skipping historical commits"
  log "OK: nothing new to sync"
  exit 0
fi

# Find commits on main newer than tracking ref
NEW_COMMITS=$(git log --oneline --reverse "${BASELINE}..main" 2>/dev/null || true)

if [ -z "$NEW_COMMITS" ]; then
  log "OK: no new commits since $(git rev-parse --short $BASELINE)"
  exit 0
fi

log "Found new commits on main since $(git rev-parse --short $BASELINE):"
echo "$NEW_COMMITS" | tee -a "$LOG_FILE"

# Switch to public branch
if ! git checkout public 2>/dev/null; then
  log "ERROR: could not checkout public branch"
  exit 1
fi

# Cherry-pick each new commit from main onto public
FAILED=0
COUNT=0
LAST_SUCCESSFUL="$BASELINE"

while IFS= read -r line; do
  HASH=$(echo "$line" | awk '{print $1}')
  MSG=$(echo "$line" | cut -d' ' -f2-)
  log "Cherry-picking $HASH: $MSG"

  if git cherry-pick "$HASH" 2>&1 | tee -a "$LOG_FILE"; then
    COUNT=$((COUNT + 1))
    LAST_SUCCESSFUL="$HASH"
    log "OK: cherry-picked $HASH"
  else
    if git diff --cached --quiet 2>/dev/null; then
      log "SKIP: commit $HASH already applied"
      git cherry-pick --skip 2>/dev/null || git cherry-pick --abort 2>/dev/null || true
      LAST_SUCCESSFUL="$HASH"
    else
      FAILED=$((FAILED + 1))
      log "CONFLICT: cherry-pick failed for $HASH — aborting"
      git cherry-pick --abort 2>/dev/null || true
    fi
  fi
done <<< "$NEW_COMMITS"

# Advance tracking ref
git update-ref "$TRACKING_REF" "$LAST_SUCCESSFUL"
log "Advanced tracking ref to $(git rev-parse --short $LAST_SUCCESSFUL)"

# Return to original branch
if [ "$ORIGINAL_BRANCH" != "public" ]; then
  git checkout "$ORIGINAL_BRANCH" 2>/dev/null || true
fi

log "Sync complete: $COUNT cherry-picked, $FAILED failed"
if [ "$FAILED" -gt 0 ]; then
  exit 1
fi
