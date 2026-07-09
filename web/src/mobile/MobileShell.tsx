// Mobile app-shell frame (design 5a–5c). Owns the ported iOS device frame + the bottom Tab bar (shown
// only on Tab routes), with the active screen swapped through <Outlet/>. Mirrors the RB f528
// frame-owner precedent: the shell owns the load-bearing chrome; each screen is a slot a later pass
// fills. Non-Tab drill-in pages (10e/10f) hide the Tab bar — the scheme draws none there (`非 Tab 页`).
import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useTRPC } from '@/lib/trpc';
import { useVocab } from '@/i18n';
import { threadScopeFilter } from '@/features/workbench/scope';
import { IOSDevice } from './IOSDevice';
import { BottomTabBar } from './BottomTabBar';
import { activeTabId, isTabRoute } from './mobile-tabs';

export function MobileShell() {
  const vocab = useVocab();
  const location = useLocation();
  const navigate = useNavigate();
  const trpc = useTRPC();

  // Real counts for the tab decorations: active threads (running+waiting) drive the 线程 badge;
  // pending approvals drive the 会话 amber dot. Both reuse the existing ui-service contract.
  const activeThreads = useQuery(
    trpc.threads.list.queryOptions({ status: threadScopeFilter('active') }),
  );
  const pendingApprovals = useQuery(trpc.approvals.list.queryOptions({ status: 'pending' }));

  const activeThreadCount = activeThreads.data?.length ?? 0;
  const hasPendingApproval = (pendingApprovals.data?.length ?? 0) > 0;
  const showTabBar = isTabRoute(location.pathname);

  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: '#E9E7E2',
      }}
    >
      <IOSDevice>
        <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
          <div style={{ flex: 1, overflow: 'auto' }}>
            <Outlet />
          </div>
          {showTabBar && (
            <BottomTabBar
              vocab={vocab}
              activeId={activeTabId(location.pathname)}
              activeThreadCount={activeThreadCount}
              hasPendingApproval={hasPendingApproval}
              onNavigate={navigate}
            />
          )}
        </div>
      </IOSDevice>
    </div>
  );
}
