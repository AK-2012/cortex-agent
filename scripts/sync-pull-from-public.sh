#!/bin/bash
# Fetch from public remote and cherry-pick new commits onto main.
# Called by the Cortex scheduled sync-public job. Safe to run repeatedly.
set -euo pipefail

REPO_DIR="/home/fangxin/Cortex"
LOG_FILE="/tmp/cortex-sync-pull.log"

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

# Fetch from public remote
log "Fetching from public remote..."
if ! git fetch public 2>&1 | tee -a "$LOG_FILE"; then
  log "ERROR: git fetch public failed"
  exit 1
fi

# Find commits on public/main that are not on main
NEW_COMMITS=$(git log --oneline --reverse main..public/main 2>/dev/null || true)

if [ -z "$NEW_COMMITS" ]; then
  log "OK: no new commits on public/main — everything in sync"
  exit 0
fi

log "Found new commits on public/main:"
echo "$NEW_COMMITS" | tee -a "$LOG_FILE"

# Switch to main
CURRENT_BRANCH=$(git branch --show-current)
if [ "$CURRENT_BRANCH" != "main" ]; then
  git checkout main 2>/dev/null || { log "ERROR: could not checkout main"; exit 1; }
fi

# Cherry-pick each new commit from public/main to main
FAILED=0
COUNT=0
while IFS= read -r line; do
  HASH=$(echo "$line" | awk '{print $1}')
  MSG=$(echo "$line" | cut -d' ' -f2-)
  log "Cherry-picking $HASH: $MSG"

  if git cherry-pick "$HASH" 2>&1 | tee -a "$LOG_FILE"; then
    COUNT=$((COUNT + 1))
    log "OK: cherry-picked $HASH"
  else
    # Check if empty cherry-pick (already applied)
    if git diff --cached --quiet 2>/dev/null; then
      log "SKIP: commit $HASH already applied"
      git cherry-pick --skip 2>/dev/null || git cherry-pick --abort 2>/dev/null || true
    else
      FAILED=$((FAILED + 1))
      log "CONFLICT: cherry-pick failed for $HASH — aborting this commit"
      git cherry-pick --abort 2>/dev/null || true
    fi
  fi
done <<< "$NEW_COMMITS"

# Return to original branch if we switched
if [ "$CURRENT_BRANCH" != "main" ]; then
  git checkout "$CURRENT_BRANCH" 2>/dev/null || true
fi

log "Sync complete: $COUNT cherry-picked, $FAILED failed"
if [ "$FAILED" -gt 0 ]; then
  exit 1
fi
