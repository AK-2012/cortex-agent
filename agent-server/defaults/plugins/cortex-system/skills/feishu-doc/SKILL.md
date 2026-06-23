---
name: feishu-doc
description: "Use when creating, reading, or editing Feishu/Lark cloud documents (docx/wiki), especially inserting or batch-updating native tables, callouts, whiteboards, or other rich blocks, or converting markdown ↔ Feishu docs. Also use for Feishu spreadsheets (sheets) and multi-dimensional tables (bitable/base). Cortex drives all Feishu rich-text work through the official lark-cli — NOT through MCP tools (the docx MCP was removed because its table support was structurally weak). Trigger on a feishu.cn/larksuite.com docx/wiki/sheets/base URL or token, or any request to write/update a Feishu document."
author: Cortex
version: 1.0.0
allowed-tools:
  - Bash
  - Read
  - Write
  - Edit
date: 2026-06-23
---

# feishu-doc — Feishu rich-text via the official lark-cli

## Why this skill exists

Feishu cloud documents are a block tree; native tables are a strict block type.
Cortex previously exposed `feishu_docx_*` MCP tools, but their table support was
structurally weak — the markdown path degraded tables into per-line text blocks,
raw block JSON failed schema validation (400), and `block_replace` could not
replace across types (text → table). Those MCP tools were removed.

The reliable channel is the **official `lark-cli`** (`@larksuite/cli`), which ships
its own version-matched agent skills covering the exact XML/block workflow (incl.
`block_insert_after` + `block_delete` for tables). This Cortex skill is a thin
**integration + delegation** layer: it gets `lark-cli` installed and authenticated,
then hands you off to the official embedded skills. Do not re-document or freeze the
lark-cli workflow here — read it live so it stays in sync with the installed CLI.

`feishu_send_file` (uploading a file to a Feishu chat) still lives in the cortex-feishu
MCP and is unrelated to this skill. Feishu IM messaging runs through the platform
adapter, not MCP — none of that is affected.

## Step 1 — Preflight (install + config)

Run the bundled preflight (idempotent: installs only if missing, configures the app
from Cortex's `FEISHU_APP_ID` / `FEISHU_APP_SECRET`, prints auth status):

```bash
bash plugins/cortex-system/skills/feishu-doc/scripts/ensure-lark-cli.sh
```

If the script path is unavailable, the essential check inline:

```bash
command -v lark-cli >/dev/null 2>&1 || npm install -g @larksuite/cli
lark-cli auth status
```

Notes:
- Cortex runs on **lab2**; install/run there. `lark-cli` stores credentials in the
  OS keychain (falls back to a local file on headless Linux).
- `config init` is non-interactive via `--app-id <id> --app-secret-stdin` and refuses
  only inside OpenClaw/Hermes agent workspaces (Cortex is neither).

## Step 2 — Authenticate (one-time, may need the user)

Document editing defaults to the **user** identity (`--as user`). `auth status` shows
two identities:
- `bot` (tenant): ready as soon as `config init` ran — enough for many tenant API calls.
- `user`: requires a one-time **device-flow** login the bot cannot complete alone.

If the user identity is missing and you need it, do NOT block silently. Use the
non-interactive flow:

```bash
lark-cli auth login --no-wait --json --domain docs,drive,sheets,base
```

Surface the returned verification URL (or `lark-cli auth qrcode`) to the user as your
turn's final message, end the turn, and after they confirm, resume with:

```bash
lark-cli auth login --device-code <code-from-previous-output>
```

## Step 3 — Delegate to the official lark-cli skills (authoritative)

Before running any `docs` / `sheets` / `base` command, read the matching embedded
skill — it is version-matched to the installed CLI and is the source of truth for
flags, XML syntax, block selectors, and table handling. Read it via the CLI (do NOT
grep local SKILL.md files):

```bash
lark-cli skills read lark-doc            # documents / blocks / tables / whiteboards
lark-cli skills read lark-doc <path>     # a referenced sub-file, e.g. references/lark-doc-update.md
lark-cli skills read lark-sheets         # spreadsheets
lark-cli skills read lark-base           # bitable / multi-dimensional tables
```

Key facts the official skill expands on (read it for the exact commands):
- Docs use **v2 API**: pass `--api-version v2` to `docs +create/+fetch/+update`.
- Create / full-section import: XML or Markdown both work
  (`docs +create --api-version v2 --content '<title>..</title><p>..</p>'`).
- Precise edits (insert/replace/delete a block): prefer XML (`--doc-format xml`, the
  default) and the `+update` commands (`str_replace`, `block_insert_after`,
  `block_replace`, `block_delete`, `block_move_after`).
- **Native tables**: do NOT use a markdown table string (it degrades to text blocks)
  and do NOT try `block_replace` text → table (cross-type replace is unsupported).
  Insert a native `<table>` with `block_insert_after`, then `block_delete` the old
  line. The `lark-doc` references document the exact `<table>` XML.
- Embedded `<sheet>` / `<bitable>` tags: extract the token and switch to the
  `lark-sheets` / `lark-base` skill to operate the data inside.

## Step 4 — Programmatic / batch table updates

The motivating use case (update a doc table from data) is what the CLI is for. Pattern:

1. Read the target doc to locate the table block id:
   `lark-cli docs +fetch --api-version v2 --doc "<url-or-token>" --detail with-ids`.
2. Generate the new `<table>` XML from your data (CSV/dict) in a small script.
3. Apply it with `docs +update --api-version v2 --doc "<token>" --command block_insert_after ...`
   then `--command block_delete` on the stale block (per the `lark-doc` reference).

Keep generation in a script under the project so the update is repeatable; this is the
right home for data-driven table maintenance, not one-off MCP calls.

## Troubleshooting

lark-cli error messages can be terse. When a command fails or flags are unclear,
introspect rather than guess:

```bash
lark-cli docs --help
lark-cli schema docx.document.block.patch     # or the relevant service.resource.method
lark-cli api <METHOD> <path>                   # raw OAPI when no shortcut fits
```
