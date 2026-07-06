Please update me when files in this folder change

Web UI transport-host (platform layer). Exposes the injected tRPC AppRouter over HTTP (query/mutate)
and SSE (subscription) for the browser SPA, behind the existing `x-cortex-token` bearer gate.
Generic over `AnyRouter` — the concrete router is injected by the entry-layer wiring, so this stays
router-agnostic and layer-clean (`platform -> core` only; no domain import).

| filename | role | function |
|---|---|---|
| `ui-http-server.ts` | factory | `createUiHttpServer({ router, getToken, port, host?, spaDir? }) -> { server, close() }` — mounts the router on `@trpc/server/adapters/standalone` `createHTTPServer` (basePath `/trpc/`, SSE subscriptions), gates tRPC paths with `timingSafeEqualStr(getToken(), x-cortex-token)` → 401 BEFORE tRPC (mirrors webhook + WS-upgrade), serves a minimal SPA static stub (index.html/assets from `spaDir`, path-traversal safe; 404 placeholder when absent), binds `127.0.0.1` by default, `close()` force-closes live SSE sockets for a clean shutdown |
