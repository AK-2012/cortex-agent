// Cortex Desktop — Tauri v2 shell
//
// Injection mechanism for {serverUrl, token}:
//   - Rust side: AppState holds ConnectionConfig in a Mutex.
//     Initialized from env vars CORTEX_SERVER_URL / CORTEX_TOKEN (dev/testing).
//     The connect screen calls set_connection_config() to persist credentials;
//     trpc.ts calls get_connection_config() or reads the window global.
//   - JS side: window.__CORTEX_DESKTOP_CONFIG is set via initialization_script
//     (runs before any page JS) so trpc.ts can read it synchronously at module
//     init time without an async Tauri command round-trip.
//     The initial value is undefined; the connect screen writes it after auth.

use serde::{Deserialize, Serialize};
use std::sync::Mutex;
use tauri::State;

/// The connection config injected into the webview global window.__CORTEX_DESKTOP_CONFIG.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct ConnectionConfig {
    /// Absolute URL of the remote Cortex server, e.g. "https://cortex.example.com".
    /// None = no server configured yet (shows the connect screen).
    #[serde(rename = "serverUrl")]
    pub server_url: Option<String>,
    /// Client authentication token (x-cortex-token value).
    pub token: Option<String>,
}

pub struct AppState {
    pub config: Mutex<ConnectionConfig>,
}

/// Return the current connection config to the webview.
/// Called via `invoke("get_connection_config")` from @tauri-apps/api/core.
#[tauri::command]
fn get_connection_config(state: State<AppState>) -> ConnectionConfig {
    state.config.lock().unwrap().clone()
}

/// Store a new connection config (called by the connect screen after the user
/// authenticates). The connect screen is responsible for persisting to secure
/// storage (keyring plugin, added in the connect-screen task); this command
/// updates in-memory state so a running SPA can re-read via get_connection_config.
#[tauri::command]
fn set_connection_config(
    state: State<AppState>,
    server_url: Option<String>,
    token: Option<String>,
) {
    let mut config = state.config.lock().unwrap();
    config.server_url = server_url;
    config.token = token;
}

pub fn run() {
    // Seed from env vars for dev/testing convenience.
    // In production the connect screen reads from keyring and calls
    // set_connection_config after the user logs in.
    let initial_config = ConnectionConfig {
        server_url: std::env::var("CORTEX_SERVER_URL").ok(),
        token: std::env::var("CORTEX_TOKEN").ok(),
    };

    tauri::Builder::default()
        .manage(AppState {
            config: Mutex::new(initial_config),
        })
        .invoke_handler(tauri::generate_handler![
            get_connection_config,
            set_connection_config,
        ])
        .setup(|app| {
            // Create the main window programmatically so we can attach
            // initialization_script — which seeds window.__CORTEX_DESKTOP_CONFIG
            // before any SPA JavaScript runs.
            tauri::WebviewWindowBuilder::new(
                app,
                "main",
                tauri::WebviewUrl::App("index.html".into()),
            )
            .title("Cortex")
            .inner_size(1400.0, 900.0)
            .resizable(true)
            // This script runs in every page load before any SPA JS.
            // trpc.ts reads window.__CORTEX_DESKTOP_CONFIG to detect desktop mode
            // and obtain the initial {serverUrl, token}.
            .initialization_script(
                "window.__CORTEX_DESKTOP__ = true;\
                 window.__CORTEX_DESKTOP_CONFIG = { serverUrl: undefined, token: undefined };",
            )
            .build()?;
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
