// AppRouter type re-export point (single stable edit site).
//
// The real AppRouter is defined by the tRPC backend adapter (Stage-1 task 3),
// which does not exist yet. Until then this is a placeholder so the package
// typechecks green and downstream (web) has a stable import path.
//
// Task 3 replaces the line below with:
//   export type { AppRouter } from '@cortex-agent/server/dist/<router path>.js';
export type AppRouter = unknown;
