// Cortex Desktop — Tauri v2 shell
//
// Connection flow
// ───────────────
// First run (no stored credentials):
//   Tauri opens connect.html (the connection config screen).
//   User enters serverUrl + clientToken, tests, then clicks Connect.
//   JS calls the `connect` Tauri command → credentials saved to OS keychain
//   and AppState updated. Page navigates to index.html (the SPA workbench).
//
// Subsequent runs (credentials in keychain):
//   Rust loads credentials at startup, opens index.html directly.
//   initialization_script (injected into every page) runs an async Tauri IPC
//   call to get_connection_config() — resolves in microseconds, before the
//   React bundle finishes downloading/parsing. providers.tsx reads
//   window.__CORTEX_DESKTOP_CONFIG and passes it to createTrpcClient().
//
// Switch / disconnect:
//   A hover button injected by initialization_script calls the `disconnect`
//   Tauri command (clears keychain + AppState) then navigates to connect.html.

use serde::{Deserialize, Serialize};
use std::sync::Mutex;
use tauri::State;

// ─── Keychain constants ────────────────────────────────────────────────────
const KEYCHAIN_SERVICE: &str = "dev.cortex.desktop";
const KEYCHAIN_ACCOUNT: &str = "connection";

// ─── Types ────────────────────────────────────────────────────────────────

/// Connection credentials shared between Rust AppState and the JS global
/// `window.__CORTEX_DESKTOP_CONFIG`.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct ConnectionConfig {
    /// Absolute URL of the remote Cortex server, e.g. "https://cortex.example.com".
    /// None = no server configured (shows the connect screen).
    #[serde(rename = "serverUrl")]
    pub server_url: Option<String>,
    /// Client authentication token (x-cortex-token value).
    pub token: Option<String>,
}

pub struct AppState {
    pub config: Mutex<ConnectionConfig>,
}

// ─── Keychain helpers ──────────────────────────────────────────────────────

/// Load credentials from the OS keychain. Returns None if the keychain is
/// unavailable or no entry exists.
fn load_from_keychain() -> Option<ConnectionConfig> {
    keyring::Entry::new(KEYCHAIN_SERVICE, KEYCHAIN_ACCOUNT)
        .ok()
        .and_then(|e| e.get_password().ok())
        .and_then(|s| serde_json::from_str::<ConnectionConfig>(&s).ok())
        .filter(|c| c.server_url.is_some() && c.token.is_some())
}

/// Persist credentials to the OS keychain. Returns Err if the keychain is
/// unavailable; callers log this and continue (credentials kept in AppState).
fn save_to_keychain(config: &ConnectionConfig) -> Result<(), String> {
    let entry = keyring::Entry::new(KEYCHAIN_SERVICE, KEYCHAIN_ACCOUNT)
        .map_err(|e| format!("keychain open: {e}"))?;
    let data = serde_json::to_string(config)
        .map_err(|e| format!("serialize: {e}"))?;
    entry
        .set_password(&data)
        .map_err(|e| format!("keychain write: {e}"))
}

/// Delete credentials from the OS keychain (best-effort; errors are ignored).
fn clear_keychain() {
    if let Ok(entry) = keyring::Entry::new(KEYCHAIN_SERVICE, KEYCHAIN_ACCOUNT) {
        let _ = entry.delete_credential();
    }
}

// ─── Tauri commands ────────────────────────────────────────────────────────

/// Return the current connection config to the webview.
/// Called by initialization_script on every page load to seed
/// window.__CORTEX_DESKTOP_CONFIG before React mounts.
#[tauri::command]
fn get_connection_config(state: State<AppState>) -> ConnectionConfig {
    state.config.lock().unwrap().clone()
}

/// Low-level in-memory update. Prefer the `connect` command for the full
/// persist-to-keychain flow.
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

/// Persist credentials to the OS keychain and update AppState.
///
/// Called by the connect screen after the user's test-connection probe
/// succeeds. Always returns Ok — a keychain failure is logged to stderr but
/// the session continues (credentials are in AppState; lost on restart if no
/// keychain, e.g. headless Linux without a secret-service daemon).
#[tauri::command]
fn connect(
    state: State<AppState>,
    server_url: String,
    token: String,
) -> Result<(), String> {
    let config = ConnectionConfig {
        server_url: Some(server_url),
        token: Some(token),
    };
    if let Err(e) = save_to_keychain(&config) {
        eprintln!(
            "[cortex-desktop] keychain save failed ({e}); \
             credentials are session-only (lost on restart)"
        );
    }
    *state.config.lock().unwrap() = config;
    Ok(())
}

/// Clear credentials from keychain and AppState.
///
/// Called by the "Switch server" hover button. After this returns the JS
/// navigates to connect.html.
#[tauri::command]
fn disconnect(state: State<AppState>) -> Result<(), String> {
    clear_keychain();
    *state.config.lock().unwrap() = ConnectionConfig::default();
    Ok(())
}

// ─── Initialization script ─────────────────────────────────────────────────
// Injected into EVERY page load (connect.html and index.html).
//
// 1. Sets window.__CORTEX_DESKTOP__ = true (desktop detection flag).
// 2. Async-fetches credentials from AppState via IPC and writes to
//    window.__CORTEX_DESKTOP_CONFIG. The IPC round-trip is ~microseconds;
//    the React bundle takes tens of milliseconds to download + parse, so
//    the global is set before providers.tsx reads it.
// 3. After DOMContentLoaded, injects a "Switch server" hover button into the
//    workbench. Suppressed on the connect screen (identified by body id).

const INIT_SCRIPT: &str = r#"
window.__CORTEX_DESKTOP__ = true;
window.__CORTEX_DESKTOP_CONFIG = { serverUrl: null, token: null };

// Timing assumption: this IPC call resolves in ~microseconds (in-process Rust handler,
// no network). The React bundle takes tens of milliseconds to download and parse, so
// __CORTEX_DESKTOP_CONFIG is set before providers.tsx reads it in practice.
// This is not a hard guarantee — a sufficiently fast device / cached bundle could
// theoretically race. Accepted: the fallback is a broken tRPC client that retries.
(function () {
  var tauri = window.__TAURI__;
  if (!tauri || !tauri.core || !tauri.core.invoke) return;
  tauri.core.invoke('get_connection_config').then(function (cfg) {
    if (cfg && cfg.serverUrl) {
      window.__CORTEX_DESKTOP_CONFIG = { serverUrl: cfg.serverUrl, token: cfg.token };
    }
  }).catch(function () {});
}());

// Inject "Switch server" hover button into the workbench.
document.addEventListener('DOMContentLoaded', function () {
  // connect.html has id="cortex-connect-screen" on <body> — skip there.
  if (document.getElementById('cortex-connect-screen')) return;
  var tauri = window.__TAURI__;
  if (!tauri || !tauri.core || !tauri.core.invoke) return;

  var btn = document.createElement('button');
  btn.id = '__cortex-switch-btn';
  btn.title = 'Switch or disconnect server';
  btn.textContent = 'Switch';
  btn.style.cssText = [
    'position:fixed', 'bottom:12px', 'right:12px', 'z-index:9999',
    'background:rgba(70,85,212,0.12)', 'color:rgba(233,231,226,0.55)',
    'border:1px solid rgba(70,85,212,0.25)', 'border-radius:4px',
    'padding:4px 10px', 'font:11px/1.4 "IBM Plex Mono",monospace',
    'cursor:pointer', 'letter-spacing:.04em', 'opacity:0',
    'transition:opacity 0.25s',
  ].join(';');

  // Reveal on mouse activity, hide after 3 s idle.
  var hideTimer;
  function reveal() {
    btn.style.opacity = '1';
    clearTimeout(hideTimer);
    hideTimer = setTimeout(function () { btn.style.opacity = '0'; }, 3000);
  }
  document.addEventListener('mousemove', reveal, { passive: true });
  btn.addEventListener('mouseenter', function () { clearTimeout(hideTimer); btn.style.opacity = '1'; });
  btn.addEventListener('mouseleave', function () {
    hideTimer = setTimeout(function () { btn.style.opacity = '0'; }, 1000);
  });

  btn.addEventListener('click', function () {
    tauri.core.invoke('disconnect').catch(function () {}).finally(function () {
      window.location.href = 'connect.html';
    });
  });

  document.body.appendChild(btn);
});
"#;

// ─── App entry point ───────────────────────────────────────────────────────

pub fn run() {
    // Load credentials from the OS keychain synchronously before the window
    // opens. Fall back to env vars (dev convenience) if keychain is empty.
    let initial_config = load_from_keychain().unwrap_or_else(|| ConnectionConfig {
        server_url: std::env::var("CORTEX_SERVER_URL").ok(),
        token: std::env::var("CORTEX_TOKEN").ok(),
    });

    let has_credentials =
        initial_config.server_url.is_some() && initial_config.token.is_some();

    // Open the workbench directly when credentials are available; otherwise
    // show the connection config screen.
    let initial_url: &str = if has_credentials {
        "index.html"
    } else {
        "connect.html"
    };

    tauri::Builder::default()
        .manage(AppState {
            config: Mutex::new(initial_config),
        })
        .invoke_handler(tauri::generate_handler![
            get_connection_config,
            set_connection_config,
            connect,
            disconnect,
        ])
        .setup(move |app| {
            tauri::WebviewWindowBuilder::new(
                app,
                "main",
                tauri::WebviewUrl::App(initial_url.into()),
            )
            .title("Cortex")
            .inner_size(1400.0, 900.0)
            .resizable(true)
            // Runs on every page load — seeds window.__CORTEX_DESKTOP_CONFIG
            // via async IPC and attaches the Switch-server button.
            .initialization_script(INIT_SCRIPT)
            .build()?;
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
