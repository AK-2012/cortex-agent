# Cortex

This is your Cortex data directory. Cortex is an autonomous agent system for long-running projects.

## Directory Structure

- `data/` — Persistent store for JSON state & config files
- `logs/` — Runtime logs
- `tmp/` — Workspace for thread artifacts and tool results
- `projects/` — Project directories (one subdirectory per active project)
- `user/` — User preferences

## Usage

Run `cortex start` to launch the server, or `cortex daemon` for daemon mode.
