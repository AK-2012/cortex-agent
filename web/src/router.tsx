import { createBrowserRouter, Navigate } from 'react-router-dom';
import { AppShell } from '@/shell/AppShell';
import { EmptyPane } from '@/shell/EmptyPane';
import { TasksPage } from '@/features/tasks/TasksPage';

export const router = createBrowserRouter([
  {
    path: '/',
    element: <AppShell />,
    children: [
      { index: true, element: <Navigate to="/workbench" replace /> },
      { path: 'workbench', element: <EmptyPane title="Workbench" /> },
      { path: 'tasks', element: <TasksPage /> },
      { path: 'threads', element: <EmptyPane title="Threads" /> },
      { path: 'overview', element: <EmptyPane title="Overview" /> },
      { path: 'settings', element: <EmptyPane title="Settings" /> },
    ],
  },
]);
