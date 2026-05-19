# Quickstart

From zero to a Cortex agent answering you in Slack in about ten minutes,
most of which is waiting for `npm` and clicking through Slack's app
creation page.

`cortex init` does almost everything. You will not edit a single config
file by hand. This guide just tells you what to expect at each prompt.

## Prerequisites

- Node.js ≥ 20 (Cortex itself targets 20+; the bundled coding-agent
  backends prefer 22).
- A Slack workspace where you can create an app. (Feishu / Lark is also
  supported — see [slack-setup.md](./slack-setup.md) for the equivalent
  flow.)
- About 2 GB of free disk for backends, plugins, and logs.

You do **not** need to install `claude` (Claude Code) or `pi`
(pi-coding-agent) beforehand. You do not need to install `git`
beforehand. You do not need to pre-create any directories or env files.
`cortex init` installs all of these for you.

## Step 1 — Install Cortex

```bash
npm install -g @cortex-agent/server
```

This puts three bins on your PATH: `cortex`, `cortex-task`, `cortex-run`.

## Step 2 — Run the setup wizard

```bash
cortex init
```

The wizard walks through the following prompts. Defaults are sensible;
hit Enter to accept.

1. **Which backends?** — Claude Code (recommended for an Anthropic
   subscription) and/or PI (for other subscriptions). You can pick both.
   Cortex installs whichever you select via `npm install -g`.
2. **Which interaction platform?** — `Slack` (recommended) or `Skip`.
   Selecting Slack triggers the next step.
3. **Slack tokens.** Cortex first prints a complete **Slack App
   Manifest** and asks if you want it copied to your clipboard. Paste it
   into Slack's "Create New App → From a manifest" flow, then come back
   and paste the three tokens it asks for in order:
   `SLACK_SIGNING_SECRET`, `SLACK_APP_TOKEN` (`xapp-…`), `SLACK_BOT_TOKEN`
   (`xoxb-…`). `CORTEX_ADMIN_CHANNEL` is optional — leave blank and
   Cortex will auto-detect it the first time you DM the bot. Full
   step-by-step for the Slack side is in [slack-setup.md](./slack-setup.md).
4. **Machine name.** Defaults to your hostname.
5. **GPU detection.** Cortex runs `nvidia-smi` and prints the count.
   Nothing to type.
6. **aistatus token-usage reporting?** Optional opt-in to share
   anonymous token counts on the public leaderboard at
   [aistatus.cc](https://aistatus.cc). If you say yes, you provide a
   name, org, and email (email is identity only, never displayed).
7. **Register Cortex as a system service?** macOS gets a `launchd`
   plist; Linux gets a `systemd --user` unit (no sudo needed); Windows
   is not supported and you start manually.
8. **Auto-detect Claude Code / PI for gateway and profiles?** Answer
   yes if you already ran `claude login` and/or `pi login` in another
   shell. Cortex scans your `~/.claude/.credentials.json` and
   `~/.pi/agent/` to discover endpoints and asks you to pick which
   discovered (mode, model) pair becomes the `plan` profile (used by
   executor agents — planner, doc-writer, coder, etc.) and which
   becomes the `execute` profile (used by reviewer agents). You can
   also run this later with `cortex setup-gateway`.

When the wizard finishes you will see:

```
Cortex initialized at /Users/you/.cortex. Run `cortex start` to launch.
```

## What `cortex init` created

Everything lives under `CORTEX_HOME` (default `~/.cortex/`):

```
~/.cortex/
├── .git/                       # auto git-init'd, all state is committed
├── CORTEX.md                   # root agent context (seeded from defaults)
├── config/
│   ├── .env                    # platform tokens + CORTEX_MACHINE
│   ├── budget.json             # daily/monthly budget limits
│   ├── machines.json           # this machine's capabilities (gpuCount, path)
│   ├── mcp-config.json         # main MCP server entry
│   ├── mcp-config-core.json    # subset for restricted contexts
│   ├── mcp-config-tui.json     # subset for TUI mode
│   ├── profiles.json           # named (backend, model) profiles
│   ├── session-hooks.json      # session-level hook pipeline
│   └── thread-templates.json   # multi-agent thread definitions
├── data/
│   ├── mode.json               # current mode + active profile
│   └── schedules.json          # seeded recurring tasks
├── context/                    # the project log lives here
│   ├── CORTEX.md, projects/, decisions/, scans/, ideas/, retrospectives/, user/
├── plugins/                    # 8 role-scoped skill plugins (full copy of defaults)
├── prompts/                    # directives, system prompts, templates
├── rules/                      # rule files auto-loaded by agents
├── hooks/                      # hook scripts (.mjs)
├── .claude/                    # Claude Code hooks + settings
└── logs/                       # daemon + LLM logs
```

You should **not** need to edit any of these by hand for normal use.
`cortex init --force` regenerates the auto-generated ones
(`mcp-config*.json`, `machines.json`, `mode.json`) while preserving your
`.env`, profiles, and content files.

`~/.aistatus/` separately holds:

```
~/.aistatus/
├── gateway.yaml                # gateway routing config (auto-generated)
└── config.yaml                 # aistatus uploader settings (your name/org/email)
```

## Step 3 — Start the server

```bash
cortex start          # foreground, Ctrl-C to stop
# or
cortex daemon         # supervised, restarts on crash + hot-reload
```

If you chose to register a system service in Step 2, the daemon is
already running and you can skip this. Check with:

```bash
cortex config         # prints resolved paths + init status
```

## Step 4 — Send your first message

Open Slack, find the Cortex bot you just installed, and DM it:

```
hello
```

The first DM is what Cortex uses to auto-detect your admin channel if
you left `CORTEX_ADMIN_CHANNEL` blank. You should get a reply within a
few seconds.

Try a real prompt:

```
list my projects
```

Or kick off a thread:

```
!thread direct help me sketch a research plan for X
```

## What to read next

- Something went wrong creating the Slack app, or you want to do it
  before running `cortex init` — read [slack-setup.md](./slack-setup.md).
- You want to know every config file and env var Cortex understands,
  or override one of the auto-generated paths — read
  [configuration.md](./configuration.md).
- You want to know every CLI subcommand and flag — read
  [cli-reference.md](./cli-reference.md).
- You want to switch backends or add another provider — read
  [backends.md](./backends.md).
