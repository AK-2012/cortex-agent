// AppRouter type re-export point (single stable edit site).
//
// The real AppRouter is defined by the tRPC backend adapter in agent-server. This
// re-export is type-only (erased at build) — the frontend imports the AppRouter type
// for its @trpc/client, never the backend runtime code.
export type { AppRouter } from '@cortex-agent/server/dist/domain/ui-service/app-router.js';
