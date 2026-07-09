import { Navigate, type RouteObject } from 'react-router-dom';
import { MobileShell } from './MobileShell';
import { MobileSessionsScreen } from './screens/MobileSessionsScreen';
import { MobileThreadsScreen } from './screens/MobileThreadsScreen';
import { MobileTasksScreen } from './screens/MobileTasksScreen';
import { MobileMachinesScreen } from './screens/MobileMachinesScreen';
import { MobileApprovalsScreen } from './screens/MobileApprovalsScreen';
import { MobileOverviewScreen } from './screens/MobileOverviewScreen';

// Mobile route table (design 5a–5c bottom Tab + 10e/10f sub-screens). Kept separate from the router
// instance so it can be inspected/tested without constructing a browser history. Separate from the
// desktop `router` so the desktop config stays byte-identical (RootRouter picks by viewport). Each
// screen is a STUB slot replaced by a later pass. Absolute child paths are valid under the `/`
// layout parent. Index + catch-all redirect to /m/sessions so a desktop→mobile resize landing on a
// desktop path resolves cleanly.
export const mobileRoutes: RouteObject[] = [
  {
    path: '/',
    element: <MobileShell />,
    children: [
      { index: true, element: <Navigate to="/m/sessions" replace /> },
      { path: '/m/sessions', element: <MobileSessionsScreen /> },
      { path: '/m/threads', element: <MobileThreadsScreen /> },
      { path: '/m/tasks', element: <MobileTasksScreen /> },
      { path: '/m/machines', element: <MobileMachinesScreen /> },
      { path: '/m/approvals', element: <MobileApprovalsScreen /> },
      { path: '/m/overview', element: <MobileOverviewScreen /> },
      { path: '*', element: <Navigate to="/m/sessions" replace /> },
    ],
  },
];
