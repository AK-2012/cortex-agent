Please update me when files in this folder change

PlatformAdapter's concrete platform implementations. Each adapter is a thin bridge, unified to the PlatformAdapter interface.

| filename | role | function |
|---|---|---|
| `index.ts` | factory | Select adapter by CORTEX_PLATFORM |
| `slack.ts` | adapter | Slack Bolt + WebClient implementation (updateMessage has built-in per-message ≥1.1s throttle to prevent chat.update 429) |
| `feishu.ts` | adapter | Feishu SDK + WSClient implementation |
