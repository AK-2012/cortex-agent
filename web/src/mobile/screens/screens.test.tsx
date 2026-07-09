import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { LangProvider } from '@/i18n';
import { MobileMachinesScreen } from './MobileMachinesScreen';
import { MobileOverviewScreen } from './MobileOverviewScreen';

// The remaining mobile screens are neutral STUB slots (机器 3b-同构 + 10f) that a sibling thread
// replaces behind the same export (RB f528 frame-owner precedent). These assert the slots render with
// their design id marker + a title, and reserve the status-bar gutter (padding-top:62px). 5a
// (MobileSessionsScreen, task c880), 5b (MobileThreadsScreen, task ad9c), 5c (MobileTasksScreen) and
// 10e (MobileApprovalsScreen) are now real tRPC-bound screens — they need query providers to mount, so
// they are covered by their own render tests + live harnesses, not this provider-free stub test.

function render(node: React.ReactElement) {
  return renderToStaticMarkup(<LangProvider>{node}</LangProvider>);
}

const cases: [string, React.ReactElement][] = [
  ['machines', <MobileMachinesScreen />],
  ['10f', <MobileOverviewScreen />],
];

describe('mobile STUB screens', () => {
  for (const [id, node] of cases) {
    it(`${id} renders its slot marker and reserves the status-bar gutter`, () => {
      const html = render(node);
      expect(html).toContain(`data-screen-label="${id}"`);
      expect(html).toContain('padding-top:62px');
    });
  }

  it('renders the (en, node-default) titles from vocab', () => {
    expect(render(<MobileMachinesScreen />)).toContain('Machines');
  });
});
