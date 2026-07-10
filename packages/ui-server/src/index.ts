// @cortex-agent/ui-server — optional Web UI transport for Cortex.
// Barrel: tRPC AppRouter binding + HTTP/SSE standalone host + same-origin SPA serving.
// agent-server loads startUiHttpServer on demand (dynamic import, CORTEX_UI_HTTP-gated);
// @cortex-agent/ui-contract re-exports the AppRouter type for the browser client.

export { createAppRouter } from './app-router.js';
export type { AppRouter } from './app-router.js';
export { createUiHttpServer } from './ui-http-server.js';
export type { UiHttpServer, UiHttpServerOptions } from './ui-http-server.js';
export { startUiHttpServer } from './start-ui-http.js';
export type { StartUiHttpOptions } from './start-ui-http.js';
export { createCallerFactory } from './trpc.js';
