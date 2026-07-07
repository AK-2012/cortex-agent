Please update me when files in this folder change

Cortex Desktop — Electron shell that wraps the built web SPA in a native window.
Serves `web/dist` on a loopback HTTP server and reverse-proxies `/trpc` to a
configurable remote agent-server, injecting `x-cortex-token` so the SPA's
relative `/trpc` URL resolves same-origin without any changes to `web/src`.

## Package layout

```
desktop/
├── package.json          pnpm package + electron-builder config ("build" field)
├── tsconfig.json         TypeScript (NodeNext ESM → dist-electron/)
├── src/
│   ├── config-store.ts   ConfigStore interface + env-based accessor
│   ├── proxy-server.ts   createProxyServer() — loopback HTTP, /trpc reverse-proxy + SPA static
│   ├── proxy-server.test.ts  12 integration tests (Node test runner + mock upstream)
│   ├── preload.ts        Electron preload (minimal — no IPC bridge needed)
│   └── main.ts           Electron main process — starts proxy, creates BrowserWindow
├── dist-electron/        Compiled JS output (gitignored)
└── dist-app/             electron-builder output (gitignored)
```

## Files

| filename | role | function |
|---|---|---|
| `src/config-store.ts` | config | `ConfigStore { serverUrl, token }` interface + `getConfig()` env accessor (CORTEX_DESKTOP_SERVER_URL / CORTEX_DESKTOP_TOKEN) |
| `src/proxy-server.ts` | core | `createProxyServer({ getConfig, spaDir, port?, host? }) → Promise<{ port, close() }>` — loopback HTTP: /trpc forwarded to config.serverUrl with x-cortex-token injected (SSE streaming preserved via pipe); other paths → SPA static files with index.html fallback + path-traversal guard |
| `src/proxy-server.test.ts` | tests | 12 integration tests: GET/POST proxy, token injection, 401 passthrough (wrong/missing token), SSE streaming, SPA serving, path-traversal rejection, lifecycle |
| `src/preload.ts` | preload | Minimal Electron preload — contextIsolation on, no IPC bridge (SPA talks via HTTP loopback only) |
| `src/main.ts` | entry | Electron main: starts proxy server on CORTEX_DESKTOP_PORT (0=ephemeral), creates 1400×900 BrowserWindow loading http://127.0.0.1:{port}, macOS activate handler, before-quit proxy cleanup |

## Config env vars

| Variable | Default | Purpose |
|---|---|---|
| `CORTEX_DESKTOP_SERVER_URL` | `http://127.0.0.1:3004` | Upstream agent-server URL to proxy /trpc to |
| `CORTEX_DESKTOP_TOKEN` | `` | x-cortex-token value injected into proxied requests |
| `CORTEX_DESKTOP_PORT` | `0` | Loopback port (0 = OS picks an ephemeral port) |
| `ELECTRON_DEVTOOLS` | unset | Set to any value in dev to open DevTools automatically |

## Scripts

| Script | Command | What it does |
|---|---|---|
| `compile` | `tsc -p tsconfig.json` | Compile TypeScript → dist-electron/ |
| `dev` | `compile && electron .` | Compile + launch Electron (set env vars above first) |
| `build` | `compile && electron-builder --dir` | Compile + produce unpacked app bundle in dist-app/linux-unpacked/ |
| `dist` | `compile && electron-builder` | Full packaged distribution (AppImage/dmg/nsis per platform) |
| `test` | `node --import tsx --test src/proxy-server.test.ts` | Run proxy-server integration tests |

## Packaging note

`electron-builder extraResources` copies `../web/dist` → `resources/web-dist` at build time.
Run `pnpm -w build` (or `pnpm --filter web build`) before `pnpm --filter desktop build` to
ensure web/dist is current.
