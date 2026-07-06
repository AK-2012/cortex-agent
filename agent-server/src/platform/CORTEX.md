Please update me when files in this folder change

Platform abstraction layer. Core modules decouple from Slack / Feishu etc. via the PlatformAdapter interface.
Specific SDK calls are encapsulated in the adapters/ subdirectory.

| filename | role | function |
|---|---|---|
| `adapters/` | subdirectory | Concrete platform adapter implementations |
| `ui-http/` | subdirectory | Web UI transport-host: tRPC HTTP+SSE standalone server + x-cortex-token gate + SPA static stub (`createUiHttpServer`) |
| `index.ts` | export | Re-export interfaces, types, and factory |
| `adapter.ts` | interface | PlatformAdapter interface + capability declaration (`openOutputStream`, project conduit methods, `ownsConduit` for multi-platform routing) |
| `types.ts` | types | MessageRef/RichBlock/ModalDefinition, etc. |
| `output-stream.ts` | interface | OutputStream / MutableRegion / OpenOutputStreamOpts types |
| `output-stream-chunk.ts` | utility | Shared length-based chunking (`chunkText`, `needsSplit`, `countTables`, `countHorizontalRules`) |
| `output-stream-helpers.ts` | helper | `postOnce` free function (one-shot message post via transient OutputStream) |
| `interactive-builder.ts` | builder | AskUserQuestion / ExitPlanMode component building |
| `tool-trace.ts` | UI helper | tool_use compact traces rendered via OutputStream openMutable/update |
| `testing.ts` | testing | MockAdapter in-memory mock implementation + MockOutputStream typed segment trail recorder |
| `tui/` | subdirectory | TUI protocol types + wire format (M4: TuiFrame union + guards + parseFrame/encodeFrame) |
| `adapters/index.ts` | factory | `createPrimaryAdaptersFromEnv` (comma-list CORTEX_PLATFORM) + `createAdapterFromEnv` — multi-platform composition + TUI auto-enable |
