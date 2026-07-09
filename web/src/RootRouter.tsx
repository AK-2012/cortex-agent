import { RouterProvider } from 'react-router-dom';
import { useIsMobile } from '@/i18n';
import { router } from '@/router';
import { mobileRouter } from '@/mobile/mobile-router';

// Viewport-driven render switch: the mobile viewport (≤ MOBILE_MAX_WIDTH) renders the mobile shell
// + routes; desktop renders the unchanged desktop router. Two separate router configs keep the
// desktop path byte-identical (no regression). Must be a child of <LangProvider> (useIsMobile).
export function RootRouter() {
  const isMobile = useIsMobile();
  return <RouterProvider router={isMobile ? mobileRouter : router} />;
}
