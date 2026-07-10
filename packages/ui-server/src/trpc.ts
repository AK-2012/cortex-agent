// input:  @trpc/server
// output: shared tRPC init instance — router / publicProcedure / createCallerFactory
// pos:    transport-agnostic tRPC foundation for the Web UI contract, in the @cortex-agent/ui-server
//         package. Backs the AppRouter (app-router.ts). @trpc/server CORE only — no http/ws
//         adapter here; auth is an HTTP-layer gate that never enters router context.

import { initTRPC } from '@trpc/server';

const t = initTRPC.create();

export const router = t.router;
export const publicProcedure = t.procedure;
export const createCallerFactory = t.createCallerFactory;
