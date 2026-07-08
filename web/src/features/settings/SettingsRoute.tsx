import { useNavigate } from 'react-router-dom';
import { WorkbenchPage } from '@/features/workbench/WorkbenchPage';
import { SettingsModal } from './SettingsModal';

// Route /settings — the Settings modal 12a–g rendered as an overlay over the workbench, matching the
// prototype's `modal:'settings'` state (proto-shot 14: modal centered over a dimmed workbench). The
// LeftRail "Settings" link and the ⌘K "Settings" command both already navigate here; closing the
// modal returns to /workbench. Deep-linkable, no global provider needed.
export function SettingsRoute(): JSX.Element {
  const navigate = useNavigate();
  return (
    <>
      <WorkbenchPage />
      <SettingsModal open onClose={() => navigate('/workbench')} />
    </>
  );
}
