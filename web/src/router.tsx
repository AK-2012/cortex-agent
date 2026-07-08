import { createBrowserRouter, createHashRouter, Navigate } from 'react-router-dom';
import { isDesktopShell } from '@/lib/desktop-config';
import { AppShell } from '@/shell/AppShell';
import { EmptyPane } from '@/shell/EmptyPane';
import { WorkbenchPage } from '@/features/workbench/WorkbenchPage';
import { TasksPage } from '@/features/tasks/TasksPage';
import { KitPage } from '@/features/kit/KitPage';
import { BaseDemoPage } from '@/features/base-demo/BaseDemoPage';
import { ThreadDetailRoute } from '@/features/thread/ThreadDetailRoute';
import { OverviewPage } from '@/features/overview/OverviewPage';
import { SettingsRoute } from '@/features/settings/SettingsRoute';

// Desktop shell loads the SPA via the Tauri asset protocol at `/index.html`, which a
// BrowserRouter cannot match (→ "404 Not Found"). Use a path-independent HashRouter there;
// browser / ui-http mode keeps clean-URL BrowserRouter.
const createRouter = isDesktopShell() ? createHashRouter : createBrowserRouter;

export const router = createRouter([
  {
    path: '/',
    element: <AppShell />,
    children: [
      { index: true, element: <Navigate to="/workbench" replace /> },
      { path: 'workbench', element: <WorkbenchPage /> },
      { path: 'tasks', element: <TasksPage /> },
      { path: 'threads', element: <EmptyPane title="Threads" /> },
      { path: 'threads/:threadId', element: <ThreadDetailRoute /> },
      { path: 'overview', element: <OverviewPage /> },
      { path: 'settings', element: <SettingsRoute /> },
      { path: 'kit', element: <KitPage /> },
      { path: 'base', element: <BaseDemoPage /> },
    ],
  },
]);
