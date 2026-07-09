import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';
import { TRPCProvider, createTrpcClient } from '@/lib/trpc';
import { readDesktopConfig } from '@/lib/desktop-config';
import { TooltipProvider, ToastProvider } from '@/design';
import { LangProvider } from '@/i18n';

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
          <ToastProvider>
            <LangProvider>{children}</LangProvider>
          </ToastProvider>
        </TooltipProvider>
      </TRPCProvider>
    </QueryClientProvider>
  );
}
