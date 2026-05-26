Please update me when files in this folder change

TUI protocol layer. Contract between M1 (TUI gateway adapter) and M5 (Ink client).

| filename | role | function |
|---|---|---|
| `protocol.ts` | types + wire | M4 wire protocol: TuiFrame discriminated union (32 variants), per-variant guards, parseFrame/encodeFrame, PROTOCOL_VERSION=1 |
