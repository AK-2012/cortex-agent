import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';
import { TRPCProvider, createTrpcClient, type RemoteConfig } from '@/lib/trpc';
import { TooltipProvider, ToastProvider } from '@/design';

/**
 * Read desktop-mode credentials injected by the Tauri initialization_script.
 * The script runs an async IPC call (get_connection_config) that resolves in
 * microseconds — well before the React bundle finishes downloading and this
 * module executes. Returns undefined in browser/ui-http mode (no global set).
 */
function readDesktopConfig(): RemoteConfig | undefined {
  const cfg = (window as Window & { __CORTEX_DESKTOP_CONFIG?: { serverUrl?: string | null; token?: string | null } })
    .__CORTEX_DESKTOP_CONFIG;
  if (cfg?.serverUrl && cfg?.token) {
    return { serverUrl: cfg.serverUrl, token: cfg.token };
  }
  return undefined;
}

export function Providers({ children }: { children: ReactNode }) {
  const [queryClient] = useState(() => new QueryClient());
  // In desktop mode the Tauri shell injects {serverUrl, token} via
  // window.__CORTEX_DESKTOP_CONFIG before this module runs; readDesktopConfig()
  // picks that up and switches tRPC to absolute-URL + token-bearer mode.
  const [trpcClient] = useState(() => createTrpcClient(readDesktopConfig()));

  return (
    <QueryClientProvider client={queryClient}>
      <TRPCProvider trpcClient={trpcClient} queryClient={queryClient}>
        <TooltipProvider>
          <ToastProvider>{children}</ToastProvider>
        </TooltipProvider>
      </TRPCProvider>
    </QueryClientProvider>
  );
}
