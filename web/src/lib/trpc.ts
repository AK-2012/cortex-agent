import {
  createTRPCClient,
  httpBatchLink,
  httpSubscriptionLink,
  splitLink,
} from '@trpc/client';
import { createTRPCContext } from '@trpc/tanstack-react-query';
import type { AppRouter } from '@cortex-agent/ui-contract';

// The real tRPC AppRouter (Stage-1 task 3) is used directly. The old forward-compat seam
// (`AppRouter extends AnyTRPCRouter ? AppRouter : AnyTRPCRouter`) was removed in task 5: a
// deferred conditional type does NOT auto-tighten — createTRPCContext widened it back to
// AnyTRPCRouter and every procedure degraded to `any`. Using AppRouter directly restores
// full end-to-end type inference (tasks.list → TaskInfo[], mutation inputs, etc.).
export const { TRPCProvider, useTRPC, useTRPCClient } = createTRPCContext<AppRouter>();

// Relative URL: hits the Vite dev proxy (→ 3004) in dev, same-origin in prod. The proxy
// injects the x-cortex-token header, so the browser holds no secret (SSE EventSource
// cannot set custom headers anyway).
const TRPC_URL = '/trpc';

// Query/mutate ride httpBatchLink (HTTP POST); subscriptions ride httpSubscriptionLink
// (SSE) — tRPC v11 splits by op type. The AppRouter's `subscribe` procedure streams the
// UiEvent frames the Tasks tab live-sync consumes (task 5).
export function createTrpcClient() {
  return createTRPCClient<AppRouter>({
    links: [
      splitLink({
        condition: (op) => op.type === 'subscription',
        true: httpSubscriptionLink({ url: TRPC_URL }),
        false: httpBatchLink({ url: TRPC_URL }),
      }),
    ],
  });
}
