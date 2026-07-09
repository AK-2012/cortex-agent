// STUB slot — design 5c 移动端任务 (任务 tab). Replaced by a later pass.
import { useVocab } from '@/i18n';
import { StubScreen } from './StubScreen';

export function MobileTasksScreen() {
  const v = useVocab();
  return <StubScreen screenId="5c" title={v.tasks} />;
}
