# ui-server/ — @cortex-agent/ui-server

Optional Web UI transport for Cortex (Stage 9 §9.1). Holds the pieces that pull `@trpc/server`, so
the core agent-server runtime (Slack/TUI-only) stays free of the UI/trpc weight. agent-server loads
this package on demand via `await import('@cortex-agent/ui-server')` behind its `CORTEX_UI_HTTP`
gate; when the flag is unset the package (and @trpc) never enters the runtime graph.

Depends on `@cortex-agent/server` (`workspace:*`) and deep-imports its BUILT dist for the narrow
surface it needs — the `UiService` type + zod `input-schemas` (domain/ui-service) and
`getClientToken`/`AUTH_HEADER`/`timingSafeEqualStr` + `createLogger` (core). The facade
(`createUiService`) stays in core for the TUI; only the tRPC binding + HTTP host live here. One-way
edge (server does NOT depend on this package as a runtime dep — the dynamic import uses a non-literal
specifier + a workspace-root devDependency link), so `pnpm -w build` orders server → ui-server.

| filename | role | function |
|---|---|---|
| `src/trpc.ts` | tRPC init | Shared `initTRPC.create()` — exports `router` / `publicProcedure` / `createCallerFactory` (transport-agnostic) |
| `src/app-router.ts` | tRPC router | `createAppRouter(uiService): AppRouter` — mirrors the full ui-service contract (14 query + 16 mutation + 2 subscriptions) over the injected UiService; unwraps `Result`, maps `Err`→`TRPCError`. Consumes the domain zod input-schemas + `UiService` type from `@cortex-agent/server/dist`. `AppRouter` type re-exported by `@cortex-agent/ui-contract` for the browser |
| `src/ui-http-server.ts` | transport-host | `createUiHttpServer({ router, getToken, port, host?, spaDir?, corsOrigins? }) -> { server, close() }` — mounts the router on `@trpc/server/adapters/standalone` (basePath `/trpc/`, SSE subscriptions), gates tRPC paths with `timingSafeEqualStr(getToken(), x-cortex-token)` → 401 BEFORE tRPC, serves the SPA static files (index.html/assets from `spaDir`, path-traversal safe; 404 placeholder when absent), binds `127.0.0.1` by default, `close()` force-closes live SSE sockets; **CORS allow-list** `corsOrigins[]` emits non-wildcard `Access-Control-Allow-Origin` + 204 OPTIONS preflight (no auth on preflight) for the Tauri desktop webview |
| `src/start-ui-http.ts` | wiring | `startUiHttpServer(opts) -> UiHttpServer \| null` — builds `createAppRouter(uiService)` + starts `createUiHttpServer` on CORTEX_UI_PORT (default 3004) behind `getClientToken`, opt-in via CORTEX_UI_HTTP (null when off). **Same-origin SPA**: `spaDir` = `opts.spaDir` ?? `CORTEX_UI_SPA_DIR` ?? the monorepo `web/dist` resolved relative to this package's dist — so one port serves `web/dist` + `/trpc`. **CORS**: `opts.corsOrigins` else `CORTEX_UI_CORS_ORIGINS` (comma-separated) |
| `src/index.ts` | barrel | Public entry: `createAppRouter` + `AppRouter`, `createUiHttpServer` + `UiHttpServer`/`UiHttpServerOptions`, `startUiHttpServer` + `StartUiHttpOptions`, `createCallerFactory` |
| `tests/app-router.test.ts` | test | Router routing (every query/mutation → correct scope/op, Result unwrap) + Err→TRPCError mapping + subscription passthrough — FAKE UiService |
| `tests/ui-http-server.test.ts` | test | Transport-host: 127.0.0.1 bind, x-cortex-token 401 gate, HTTP query roundtrip, SSE one-event, SPA stub (present/absent/traversal/malformed-URL→400), clean close(), CORS allow-list — FAKE tRPC router, ephemeral port |
| `tests/ui-http-wiring.test.ts` | test | Entry wiring: env gate (null when off), default port 3004 (tolerant of a busy 3004), token 401, HTTP query/mutate roundtrip, SSE, close, CORS via CORTEX_UI_CORS_ORIGINS env — FAKE UiService |
| `tests/same-origin-spa.test.ts` | test | Single port serves index.html (from CORTEX_UI_SPA_DIR default-spaDir resolution) AND the token-gated `/trpc` — FAKE UiService |
| `tests/_test-home.ts` | test util | Isolates `CORTEX_HOME` to a temp dir before the core logger's paths.ts binds (imported first) |

## Notes

- Tests deep-import `@cortex-agent/server/dist/...`, so agent-server must be built before this
  package's tests run. `pnpm -w build` (or `pnpm --filter @cortex-agent/server build`) first.
