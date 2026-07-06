import { createBrowserRouter, Navigate } from 'react-router-dom';
import { AppShell } from '@/shell/AppShell';
import { EmptyPane } from '@/shell/EmptyPane';
import { WorkbenchPage } from '@/features/workbench/WorkbenchPage';
import { TasksPage } from '@/features/tasks/TasksPage';
import { KitPage } from '@/features/kit/KitPage';
import { ThreadDetailPage } from '@/features/thread/ThreadDetailPage';

export const router = createBrowserRouter([
  {
    path: '/',
    element: <AppShell />,
    children: [
      { index: true, element: <Navigate to="/workbench" replace /> },
      { path: 'workbench', element: <WorkbenchPage /> },
      { path: 'tasks', element: <TasksPage /> },
      { path: 'threads', element: <EmptyPane title="Threads" /> },
      { path: 'threads/:threadId', element: <ThreadDetailPage /> },
      { path: 'overview', element: <EmptyPane title="Overview" /> },
      { path: 'settings', element: <EmptyPane title="Settings" /> },
      { path: 'kit', element: <KitPage /> },
    ],
  },
]);
