// input:  a composed UiService + env (CORTEX_UI_HTTP gate)
// output: startUiHttpIfEnabled(uiService, env?) -> { close } | null — starts the in-core Web UI
//         transport-host when CORTEX_UI_HTTP is truthy, else returns null WITHOUT importing it.
// pos:    The CORTEX_UI_HTTP seam between the composition root (entry/app.ts) and the Web UI
//         wiring (entry/start-ui-http.ts). This module statically imports ONLY node builtins + an
//         erased `import type`; the dynamic `import('./start-ui-http.js')` is the SOLE runtime edge
//         from the core boot graph to @trpc/server + jose (both pulled transitively by start-ui-http
//         → domain/ui-service/app-router + platform/ui-http). When the flag is off it is never taken,
//         so neither dependency enters the runtime module graph (proven by
//         tests/platform/ui-http-lazy-load.test.ts). Keep this file free of any static runtime import
//         of the transport modules — that is the whole point.
// >>> If I am updated, update CORTEX.md <<<

import type { UiService } from '@domain/ui-service/types.js';

/** Handle app.ts holds for shutdown — structural, so this module needs no transport types at runtime. */
export interface UiHttpHandle {
  close: () => Promise<void>;
}

/** Opt-in gate: truthy CORTEX_UI_HTTP (1/true/on/yes). Mirrors start-ui-http's own re-check. */
function isEnabled(env: NodeJS.ProcessEnv): boolean {
  const v = (env.CORTEX_UI_HTTP || '').trim().toLowerCase();
  return v === '1' || v === 'true' || v === 'on' || v === 'yes';
}

/**
 * Start the Web UI HTTP+SSE transport-host on demand when CORTEX_UI_HTTP is set, else return null.
 * The transport module (which pulls @trpc/server + jose) is loaded via a dynamic import that is
 * only reached inside the enabled branch, so an unset flag keeps those deps out of the runtime graph.
 */
export async function startUiHttpIfEnabled(
  uiService: UiService,
  env: NodeJS.ProcessEnv = process.env,
): Promise<UiHttpHandle | null> {
  if (!isEnabled(env)) return null;
  const { startUiHttpServer } = await import('./start-ui-http.js');
  // start-ui-http re-reads CORTEX_UI_HTTP and returns null when off — always truthy here.
  return startUiHttpServer({ uiService }) ?? null;
}
