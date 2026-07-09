// STUB slot — design 5a 移动端会话 (会话 tab). Replaced by a later pass.
import { useVocab } from '@/i18n';
import { StubScreen } from './StubScreen';

export function MobileSessionsScreen() {
  const v = useVocab();
  return <StubScreen screenId="5a" title={v.sessions} />;
}
