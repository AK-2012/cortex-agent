#!/bin/bash
# Sync the latest commit from main to the local public branch via cherry-pick.
# Called by the post-commit hook. Does NOT push — user pushes manually.
set -euo pipefail

REPO_DIR="/home/fangxin/Cortex"
LOG_FILE="/tmp/cortex-sync-cherry.log"

log() {
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*" | tee -a "$LOG_FILE"
}

cd "$REPO_DIR"

# Guard: skip if working tree is dirty
if ! git diff-index --quiet HEAD --; then
  log "SKIP: working tree is dirty"
  exit 0
fi

# Guard: skip if not on main branch
CURRENT_BRANCH=$(git branch --show-current)
if [ "$CURRENT_BRANCH" != "main" ]; then
  log "SKIP: not on main branch (on $CURRENT_BRANCH)"
  exit 0
fi

# Guard: skip if in the middle of a rebase
if [ -d ".git/rebase-merge" ] || [ -d ".git/rebase-apply" ]; then
  log "SKIP: rebase in progress"
  exit 0
fi

# Get the latest commit on main
MAIN_HEAD=$(git rev-parse main)
COMMIT_MSG=$(git log -1 --format="%s" "$MAIN_HEAD")

log "Syncing commit $MAIN_HEAD to public branch: $COMMIT_MSG"

# Try to cherry-pick the latest main commit onto public
if git checkout public 2>/dev/null; then
  if git cherry-pick "$MAIN_HEAD" 2>/dev/null; then
    log "OK: cherry-picked $MAIN_HEAD to public"
  else
    # If cherry-pick fails, check if the commit is already applied (empty diff)
    if git diff --cached --quiet 2>/dev/null; then
      log "SKIP: commit already applied (empty cherry-pick), skipping"
      git cherry-pick --skip 2>/dev/null || git cherry-pick --abort 2>/dev/null || true
    else
      log "CONFLICT: cherry-pick failed for $MAIN_HEAD — aborting"
      git cherry-pick --abort 2>/dev/null || true
    fi
  fi
  # Return to main
  git checkout main 2>/dev/null || true
else
  log "ERROR: could not checkout public branch"
fi

log "Done"
