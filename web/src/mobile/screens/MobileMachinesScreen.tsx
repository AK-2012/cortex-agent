// STUB slot — 移动端机器 (机器 tab). The scheme leaves the mobile machines screen undrawn (= desktop
// 3b 同构), so this is a shell-owned neutral placeholder, replaced when the machines surface lands.
import { useVocab } from '@/i18n';
import { StubScreen } from './StubScreen';

export function MobileMachinesScreen() {
  const v = useVocab();
  return <StubScreen screenId="machines" title={v.machines} />;
}
