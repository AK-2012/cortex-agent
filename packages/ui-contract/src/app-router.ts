// AppRouter type re-export point (single stable edit site).
//
// The real AppRouter is defined by the tRPC binding in the optional @cortex-agent/ui-server
// package. This re-export is type-only (erased at build) — the frontend imports the AppRouter
// type for its @trpc/client, never the backend runtime code.
export type { AppRouter } from '@cortex-agent/ui-server';
