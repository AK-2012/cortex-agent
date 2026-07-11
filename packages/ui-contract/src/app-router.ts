// AppRouter type re-export point (single stable edit site).
//
// The real AppRouter is defined by the in-core tRPC binding at agent-server's
// domain/ui-service/app-router.ts. This re-export is type-only (erased at build) — the frontend
// imports the AppRouter type for its @trpc/client, never the backend runtime code. It deep-imports
// the built dist so this package needs no dependency on the transport's runtime (@trpc/server).
export type { AppRouter } from '@cortex-agent/server/dist/domain/ui-service/app-router.js';
