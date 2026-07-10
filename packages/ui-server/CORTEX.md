# ui-server/ — @cortex-agent/ui-server

Optional Web UI transport for Cortex (Stage 9 §9.1). Holds the pieces that pull `@trpc/server`, so
the core agent-server runtime (Slack/TUI-only) stays free of the UI/trpc weight. agent-server loads
this package on demand via `await import('@cortex-agent/ui-server')` behind its `CORTEX_UI_HTTP`
gate; when the flag is unset the package (and @trpc) never enters the runtime graph.

Depends on `@cortex-agent/server` (`workspace:*`) and deep-imports its BUILT dist for the narrow
surface it needs — the `UiService` type + zod `input-schemas` (domain/ui-service) and
`getClientToken`/`AUTH_HEADER`/`timingSafeEqualStr` + `createLogger` (core). Also depends on `jose`
(package-local dep, not in core) for the Cloudflare Access JWT verification. The facade
(`createUiService`) stays in core for the TUI; only the tRPC binding + HTTP host live here. One-way
edge (server does NOT depend on this package as a runtime dep — the dynamic import uses a non-literal
specifier + a workspace-root devDependency link), so `pnpm -w build` orders server → ui-server.

| filename | role | function |
|---|---|---|
| `src/trpc.ts` | tRPC init | Shared `initTRPC.create()` — exports `router` / `publicProcedure` / `createCallerFactory` (transport-agnostic) |
| `src/app-router.ts` | tRPC router | `createAppRouter(uiService): AppRouter` — mirrors the full ui-service contract (14 query + 16 mutation + 2 subscriptions) over the injected UiService; unwraps `Result`, maps `Err`→`TRPCError`. Consumes the domain zod input-schemas + `UiService` type from `@cortex-agent/server/dist`. `AppRouter` type re-exported by `@cortex-agent/ui-contract` for the browser |
| `src/ui-http-server.ts` | transport-host | `createUiHttpServer({ router, getToken, port, host?, spaDir?, corsOrigins?, verifyAccessJwt? }) -> { server, close() }` — mounts the router on `@trpc/server/adapters/standalone` (basePath `/trpc/`, SSE subscriptions), gates tRPC paths with a **dual-path auth** check → 401 BEFORE tRPC: a matching `x-cortex-token` (`timingSafeEqualStr`, checked first, synchronous — desktop/machine, byte-for-byte unchanged) **OR** a valid `Cf-Access-Jwt-Assertion` (Cloudflare Access JWT, verified via the injected `verifyAccessJwt`; the browser path). Serves the SPA static files (index.html/assets from `spaDir`, path-traversal safe; 404 placeholder when absent), binds `127.0.0.1` by default, `close()` force-closes live SSE sockets; **CORS allow-list** `corsOrigins[]` emits non-wildcard `Access-Control-Allow-Origin` + 204 OPTIONS preflight (no auth on preflight) for the Tauri desktop webview |
| `src/access-jwt.ts` | Access JWT | `createAccessJwtVerifier({ jwksUrl, audience, issuer }) -> (token)=>Promise<boolean>` — verifies the Cloudflare Access assertion JWT (`jose` `createRemoteJWKSet` + `jwtVerify`: signature against the team-domain JWKS, aud + iss + exp), algorithms pinned to RS256/ES256, any failure → false (never throws through). `accessVerifierFromEnv(env)` builds it from `CORTEX_ACCESS_TEAM_DOMAIN` (bare name or full host) + `CORTEX_ACCESS_AUD` (+ optional `CORTEX_ACCESS_CERTS_URL`); returns `undefined` when either is unset → the gate **secure-degrades to token-only** |
| `src/start-ui-http.ts` | wiring | `startUiHttpServer(opts) -> UiHttpServer \| null` — builds `createAppRouter(uiService)` + starts `createUiHttpServer` on CORTEX_UI_PORT (default 3004) behind the dual-path gate (`getClientToken` + `accessVerifierFromEnv(env)`), opt-in via CORTEX_UI_HTTP (null when off). **Same-origin SPA**: `spaDir` = `opts.spaDir` ?? `CORTEX_UI_SPA_DIR` ?? the monorepo `web/dist` resolved relative to this package's dist — so one port serves `web/dist` + `/trpc`. **CORS**: `opts.corsOrigins` else `CORTEX_UI_CORS_ORIGINS` (comma-separated). **Access JWT**: `opts.verifyAccessJwt` else built from `CORTEX_ACCESS_*` env |
| `src/index.ts` | barrel | Public entry: `createAppRouter` + `AppRouter`, `createUiHttpServer` + `UiHttpServer`/`UiHttpServerOptions`, `startUiHttpServer` + `StartUiHttpOptions`, `createAccessJwtVerifier`/`accessVerifierFromEnv` + `AccessJwtVerifier`/`AccessJwtConfig`, `createCallerFactory` |
| `tests/app-router.test.ts` | test | Router routing (every query/mutation → correct scope/op, Result unwrap) + Err→TRPCError mapping + subscription passthrough — FAKE UiService |
| `tests/ui-http-server.test.ts` | test | Transport-host: 127.0.0.1 bind, x-cortex-token 401 gate, HTTP query roundtrip, SSE one-event, SPA stub (present/absent/traversal/malformed-URL→400), clean close(), CORS allow-list — FAKE tRPC router, ephemeral port |
| `tests/access-jwt-auth.test.ts` | test | Dual-path auth gate: valid x-cortex-token passes (verifier configured); valid RS256 **and** ES256 Access JWT (correct aud/iss, unexpired) passes; bad-signature / wrong-aud / wrong-iss / expired JWT → 401; no credentials → 401; Access JWT with no verifier configured → 401; `accessVerifierFromEnv` present when team+aud set, undefined otherwise (secure degrade). Synthetic `jose` RSA/EC keypairs + local http JWKS — FAKE tRPC router |
| `tests/ui-http-wiring.test.ts` | test | Entry wiring: env gate (null when off), default port 3004 (tolerant of a busy 3004), token 401, HTTP query/mutate roundtrip, SSE, close, CORS via CORTEX_UI_CORS_ORIGINS env — FAKE UiService |
| `tests/same-origin-spa.test.ts` | test | Single port serves index.html (from CORTEX_UI_SPA_DIR default-spaDir resolution) AND the token-gated `/trpc` — FAKE UiService |
| `tests/_test-home.ts` | test util | Isolates `CORTEX_HOME` to a temp dir before the core logger's paths.ts binds (imported first) |

## Notes

- Tests deep-import `@cortex-agent/server/dist/...`, so agent-server must be built before this
  package's tests run. `pnpm -w build` (or `pnpm --filter @cortex-agent/server build`) first.
