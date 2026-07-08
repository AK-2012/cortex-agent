// input:  a real UiService (injected) + env (CORTEX_UI_HTTP gate, CORTEX_UI_PORT,
//          CORTEX_UI_CORS_ORIGINS)
// output: startUiHttpServer(opts) -> UiHttpServer | null — builds the tRPC AppRouter over the
//         injected UiService and starts the Web UI HTTP+SSE transport-host behind the
//         x-cortex-token bearer gate (getClientToken), bound 127.0.0.1. Returns null (clean
//         skip) when the env gate is off.
// pos:    Web UI wiring, entry layer (L5). The only place that binds the domain router
//         (createAppRouter) to the platform transport-host (createUiHttpServer) — kept out of
//         both so the router stays transport-agnostic and the transport-host stays router-
//         agnostic (platform -> core only). app.ts calls this after createUiService and closes
//         the returned handle on shutdown.
//         CORS: resolves the transport-host's allow-list from opts.corsOrigins else the
//         CORTEX_UI_CORS_ORIGINS env var (comma-separated). This is what makes the running-server
//         path (app.ts, which calls startUiHttpServer without opts.corsOrigins) honor CORS purely
//         via env — needed so the Tauri desktop webview (cross-origin, e.g. tauri://localhost) can
//         reach tRPC directly. No app.ts change required.
// >>> If I am updated, update the parent folder's CORTEX.md <<<

import { createAppRouter } from '@domain/ui-service/app-router.js';
import type { UiService } from '@domain/ui-service/types.js';
import { createUiHttpServer } from '@platform/ui-http/ui-http-server.js';
import type { UiHttpServer } from '@platform/ui-http/ui-http-server.js';
import { getClientToken } from '@core/auth.js';
import { createLogger } from '@core/log.js';

const log = createLogger('ui-http');

/** Default TCP port for the Web UI tRPC endpoint (loopback-only; exposure is via a tunnel). */
const DEFAULT_UI_PORT = 3004;

/** Opt-in gate: the Web UI HTTP server starts only when CORTEX_UI_HTTP is truthy (skip cleanly otherwise). */
function isEnabled(env: NodeJS.ProcessEnv): boolean {
  const v = (env.CORTEX_UI_HTTP || '').trim().toLowerCase();
  return v === '1' || v === 'true' || v === 'on' || v === 'yes';
}

export interface StartUiHttpOptions {
  /** The composed UiService (real domain-backed instance in production; a fake in tests). */
  uiService: UiService;
  /** Token accessor the server accepts. Defaults to getClientToken (the shared secret clients carry). */
  getToken?: () => string;
  /** Env to read the gate/port from. Defaults to process.env (injectable for tests). */
  env?: NodeJS.ProcessEnv;
  /** Directory of the built SPA to serve for non-tRPC paths (absent in Stage 1). */
  spaDir?: string;
  /**
   * Explicit CORS allow-list forwarded to the transport-host. When omitted, the list is parsed
   * from the CORTEX_UI_CORS_ORIGINS env var (comma-separated; entries trimmed, empties dropped).
   * Env-driven so the running-server path (app.ts) can enable CORS for the Tauri desktop webview
   * (e.g. tauri://localhost) with no code change — just the env var. Absent/empty → no CORS headers.
   */
  corsOrigins?: string[];
}

/**
 * Parse a comma-separated origin list (from CORTEX_UI_CORS_ORIGINS) into a trimmed, empties-dropped
 * array. Returns undefined when the raw value is absent or yields no entries, so the transport-host
 * keeps its backward-compatible "no CORS headers" default rather than an empty allow-list.
 */
function parseCorsOrigins(raw: string | undefined): string[] | undefined {
  if (!raw) return undefined;
  const origins = raw.split(',').map((o) => o.trim()).filter((o) => o.length > 0);
  return origins.length > 0 ? origins : undefined;
}

/**
 * Build the AppRouter from the injected UiService and start the Web UI HTTP+SSE transport-host
 * on CORTEX_UI_PORT (default 3004), bound 127.0.0.1, behind the x-cortex-token gate. Returns the
 * running server handle, or null when the CORTEX_UI_HTTP env gate is off (clean skip). The caller
 * owns the handle and must call close() on shutdown.
 */
export function startUiHttpServer(opts: StartUiHttpOptions): UiHttpServer | null {
  const env = opts.env ?? process.env;
  if (!isEnabled(env)) return null;

  // parseInt(undefined/'')→NaN falls back; a valid 0 (ephemeral, for tests) is preserved.
  const parsedPort = parseInt(env.CORTEX_UI_PORT ?? '', 10);
  const port = Number.isNaN(parsedPort) ? DEFAULT_UI_PORT : parsedPort;
  const router = createAppRouter(opts.uiService);
  const corsOrigins = opts.corsOrigins ?? parseCorsOrigins(env.CORTEX_UI_CORS_ORIGINS);
  log.info(
    `Web UI enabled — starting tRPC HTTP+SSE on 127.0.0.1:${port}` +
      (corsOrigins ? ` (CORS allow-list: ${corsOrigins.join(', ')})` : ''),
  );
  return createUiHttpServer({
    router,
    getToken: opts.getToken ?? getClientToken,
    port,
    host: '127.0.0.1',
    spaDir: opts.spaDir,
    corsOrigins,
  });
}
