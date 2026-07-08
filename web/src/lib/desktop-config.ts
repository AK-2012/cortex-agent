import type { RemoteConfig } from './trpc';

/**
 * Read desktop-mode credentials injected by the Tauri initialization_script.
 *
 * The initialization_script runs an async `invoke('get_connection_config')` IPC
 * call that resolves in microseconds — well before the React bundle finishes
 * downloading and this module executes. The resolved value is stored in
 * `window.__CORTEX_DESKTOP_CONFIG` (≡ `globalThis.__CORTEX_DESKTOP_CONFIG`).
 *
 * Returns undefined in browser / ui-http mode (no Tauri shell, global never set).
 *
 * Reads from `globalThis` rather than `window` so this function is testable
 * in the vitest Node environment without requiring jsdom.
 */
export function readDesktopConfig(): RemoteConfig | undefined {
  const cfg = (
    globalThis as unknown as {
      __CORTEX_DESKTOP_CONFIG?: { serverUrl?: string | null; token?: string | null };
    }
  ).__CORTEX_DESKTOP_CONFIG;
  if (cfg?.serverUrl && cfg?.token) {
    return { serverUrl: cfg.serverUrl, token: cfg.token };
  }
  return undefined;
}

/**
 * True when running inside the Tauri desktop shell. The initialization_script sets
 * `window.__CORTEX_DESKTOP__ = true` synchronously (before the React bundle executes),
 * independent of whether credentials are configured yet.
 *
 * Used to pick a HashRouter in desktop mode: the shell loads the SPA via the Tauri asset
 * protocol at `/index.html`, which a BrowserRouter cannot match (→ "404 Not Found"). Hash
 * routing is path-independent. Browser / ui-http mode keeps BrowserRouter (clean URLs).
 */
export function isDesktopShell(): boolean {
  return (globalThis as unknown as { __CORTEX_DESKTOP__?: boolean }).__CORTEX_DESKTOP__ === true;
}
