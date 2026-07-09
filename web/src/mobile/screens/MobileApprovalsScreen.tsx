// STUB slot — design 10e 移动端审批. Reached from the 会话 tab's amber approval dot. Replaced by a
// later pass (shares 7a's data + tiered labels).
import { useVocab } from '@/i18n';
import { StubScreen } from './StubScreen';

export function MobileApprovalsScreen() {
  const v = useVocab();
  return <StubScreen screenId="10e" title={v.approvals} />;
}
