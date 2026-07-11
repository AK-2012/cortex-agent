// input:  @trpc/server
// output: shared tRPC init instance — router / publicProcedure / createCallerFactory
// pos:    transport-agnostic tRPC foundation for the Web UI contract, in-core (domain/ui-service).
//         Backs the AppRouter (app-router.ts). @trpc/server CORE only — no http/ws adapter here;
//         auth is an HTTP-layer gate that never enters router context. Reached only via the
//         entry/start-ui-http wiring behind CORTEX_UI_HTTP, so @trpc/server never enters the runtime
//         graph when the UI is off.

import { initTRPC } from '@trpc/server';

const t = initTRPC.create();

export const router = t.router;
export const publicProcedure = t.procedure;
export const createCallerFactory = t.createCallerFactory;
