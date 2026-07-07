Please update me when files in this folder change

Cortex Desktop — Tauri v2 shell that wraps the built web SPA in a native window.
Loads `web/dist` via Tauri's asset protocol (no proxy, no sidecar). The SPA talks
directly to the remote Cortex server using absolute URLs — token injection is handled
by the ponyfill transport in `web/src/lib/trpc.ts`, NOT by this shell.

## Package layout

```
desktop/
├── package.json              pnpm package (@tauri-apps/cli devDep, @tauri-apps/api dep)
├── src-tauri/
│   ├── Cargo.toml            cortex-desktop crate (tauri v2 + serde)
│   ├── build.rs              tauri-build entry point
│   ├── tauri.conf.json       Tauri config: frontendDist=../../web/dist, identifier
│   ├── capabilities/
│   │   └── default.json      Security capability (core:default)
│   ├── icons/                Placeholder icons (replace with real ones for production)
│   │   ├── 32x32.png
│   │   ├── 128x128.png
│   │   ├── 128x128@2x.png
│   │   ├── icon.icns
│   │   └── icon.ico
│   └── src/
│       ├── main.rs           Rust entry point (calls lib::run)
│       └── lib.rs            AppState + Tauri commands (get/set_connection_config)
└── src-tauri/target/         Rust build output (gitignored)
```

## Injection mechanism for {serverUrl, token}

Two parallel surfaces for the connect screen (task) to write and `trpc.ts` to read:

1. **`window.__CORTEX_DESKTOP_CONFIG`** — set by `WebviewWindowBuilder::initialization_script()`
   in `src-tauri/src/lib.rs` (setup hook) before any page JS runs; `trpc.ts` can read it
   synchronously at module init time. Initial value is `{ serverUrl: undefined, token: undefined }`;
   the connect screen updates it after login. Note: env vars `CORTEX_SERVER_URL`/`CORTEX_TOKEN`
   only seed Rust `AppState` — not this global. Use `get_connection_config()` command to read
   them from JS in dev mode.
2. **Tauri commands** — `get_connection_config()` / `set_connection_config(serverUrl, token)`
   callable from JS via `@tauri-apps/api/core` invoke API.

The connect screen calls `set_connection_config` after the user authenticates. `trpc.ts`
reads the window global (synchronous, available at load) and optionally calls
`get_connection_config` for re-reads (e.g. after token rotation).

## Files

| filename | role | function |
|---|---|---|
| `src-tauri/src/main.rs` | entry | Rust main — `#[cfg_attr windows_subsystem]` + calls `lib::run()` |
| `src-tauri/src/lib.rs` | core | `AppState { config: Mutex<ConnectionConfig> }` + `get_connection_config` / `set_connection_config` Tauri commands; seeds from env vars `CORTEX_SERVER_URL` / `CORTEX_TOKEN` for dev |
| `src-tauri/Cargo.toml` | manifest | `cortex-desktop` crate, tauri v2 + serde deps, release profile optimized for size |
| `src-tauri/build.rs` | build | `tauri_build::build()` |
| `src-tauri/tauri.conf.json` | config | `frontendDist: ../../web/dist`, `withGlobalTauri: true`; no window declared (window created programmatically in `lib.rs` setup to attach `initialization_script`) |
| `src-tauri/capabilities/default.json` | security | `core:default` capability for the main window |
| `src-tauri/icons/` | assets | Placeholder icons (generate real ones with `tauri icon <source.png>`) |

## Config env vars (dev / testing)

| Variable | Purpose |
|---|---|
| `CORTEX_SERVER_URL` | Pre-seed serverUrl (skips connect screen in dev) |
| `CORTEX_TOKEN` | Pre-seed token (skips connect screen in dev) |

## Scripts

| Script | Command | What it does |
|---|---|---|
| `dev` | `tauri dev` | Build Rust + launch Tauri window loading `web/dist` |
| `build` | `tauri build` | Produce a signed/bundled app for the current platform |

## System prerequisites (Linux)

```
sudo apt-get install libwebkit2gtk-4.1-dev libgtk-3-dev libayatana-appindicator3-dev librsvg2-dev
```

Run `pnpm --filter web build` before `tauri build` / `tauri dev` to ensure `web/dist` is current.
