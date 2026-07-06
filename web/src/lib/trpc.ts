import { createTRPCClient, httpBatchLink } from '@trpc/client';
import { createTRPCContext } from '@trpc/tanstack-react-query';
import type { AnyTRPCRouter } from '@trpc/server';
import type { AppRouter } from '@cortex-agent/ui-contract';

// Forward-compat seam (task 153e): `@cortex-agent/ui-contract` still ships
// `AppRouter = unknown` until Stage-1 task 3 defines the real tRPC router. Falling
// back to AnyTRPCRouter lets the client plumbing compile now and auto-tightens to
// the concrete router type the moment task 3 replaces the placeholder — no rewrite.
type Router = AppRouter extends AnyTRPCRouter ? AppRouter : AnyTRPCRouter;

export const { TRPCProvider, useTRPC, useTRPCClient } = createTRPCContext<Router>();

// Relative URL: hits the Vite dev proxy (→ 3004) in dev, same-origin in prod.
export function createTrpcClient() {
  return createTRPCClient<Router>({
    links: [httpBatchLink({ url: '/trpc' })],
  });
}
