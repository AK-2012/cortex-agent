Please update me when files in this folder change

Platform abstraction layer. Core modules decouple from Slack / Feishu etc. via the PlatformAdapter interface.
Specific SDK calls are encapsulated in the adapters/ subdirectory.

| filename | role | function |
|---|---|---|
| `adapters/` | subdirectory | Concrete platform adapter implementations |
| `index.ts` | export | Re-export interfaces, types, and factory |
| `adapter.ts` | interface | PlatformAdapter interface + capability declaration (gains `openOutputStream` + `bindProjectConduit`/`unbindProjectConduit`/`getProjectConduits` in S1) |
| `types.ts` | types | MessageRef/RichBlock/ModalDefinition, etc. |
| `output-stream.ts` | interface | OutputStream / MutableRegion / OpenOutputStreamOpts types |
| `output-stream-chunk.ts` | utility | Shared length-based chunking (`chunkText`, `needsSplit`, `countTables`, `countHorizontalRules`) |
| `output-stream-helpers.ts` | helper | `postOnce` free function (replaces `VirtualMessage.postOnce`) |
| `interactive-builder.ts` | builder | AskUserQuestion / ExitPlanMode component building |
| `virtual-message.ts` | aggregator | VirtualMessage merges multiple appends into fewer messages (default retry delays `[200,600,1500,4000]ms`; test with `_testSetRetryDelays([0,0,0,0])` to skip wall-clock waiting; S4 will delete — replaced by SlackOutputStream) |
| `tool-trace.ts` | UI helper | tool_use compact traces merged into main VM message (migrated from orch/routing; only depends on VirtualMessage) |
| `testing.ts` | testing | MockAdapter in-memory mock implementation + MockOutputStream typed segment trail recorder |
