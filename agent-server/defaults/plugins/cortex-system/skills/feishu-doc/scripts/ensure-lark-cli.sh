#!/usr/bin/env bash
# Idempotent preflight for the official Lark/Feishu CLI (@larksuite/cli).
# - Installs lark-cli globally via npm if absent (skips when already present).
# - Optionally runs `config init` from Cortex's FEISHU_APP_ID / FEISHU_APP_SECRET.
# - Reports auth status; does NOT perform the interactive device-flow login
#   (that is surfaced to the user by the feishu-doc skill).
#
# Usage:  bash ensure-lark-cli.sh
# Exit:   0 = lark-cli present (installed or already there); non-zero = install failed.
set -uo pipefail

log() { printf '[ensure-lark-cli] %s\n' "$*"; }

# 1) Ensure the binary is present.
if command -v lark-cli >/dev/null 2>&1; then
  log "lark-cli already installed: $(lark-cli --version 2>/dev/null | head -1)"
else
  log "lark-cli not found — installing @larksuite/cli globally via npm ..."
  if ! npm install -g @larksuite/cli; then
    log "ERROR: npm install -g @larksuite/cli failed."
    exit 1
  fi
  # npm global bin may not be on PATH for this shell; surface a hint if so.
  if ! command -v lark-cli >/dev/null 2>&1; then
    log "Installed, but lark-cli is not on PATH. Add \$(npm root -g)/../bin to PATH."
    exit 1
  fi
  log "Installed: $(lark-cli --version 2>/dev/null | head -1)"
fi

# 2) Best-effort non-interactive app config from Cortex env (tenant-level credentials).
#    `config init` refuses inside OpenClaw/Hermes agent workspaces; Cortex is neither,
#    so this normally succeeds. Skip if already configured.
if [ -n "${FEISHU_APP_ID:-}" ] && [ -n "${FEISHU_APP_SECRET:-}" ]; then
  if lark-cli config show >/dev/null 2>&1; then
    log "lark-cli config already present (skipping config init)."
  else
    log "Configuring lark-cli app from FEISHU_APP_ID / FEISHU_APP_SECRET ..."
    if printf '%s' "$FEISHU_APP_SECRET" | lark-cli config init --app-id "$FEISHU_APP_ID" --app-secret-stdin --brand feishu >/dev/null 2>&1; then
      log "config init done."
    else
      log "config init did not complete (may already be bound, or needs manual setup)."
    fi
  fi
else
  log "FEISHU_APP_ID / FEISHU_APP_SECRET not set — skipping config init."
fi

# 3) Report auth status (user-token login is interactive — handled by the skill, not here).
log "auth status:"
lark-cli auth status 2>&1 | sed 's/^/  /' || log "  (unable to read auth status)"

log "Preflight complete. If not logged in, run the device-flow login (see feishu-doc skill)."
