import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { LangProvider } from '@/i18n';
import { MobileMachinesScreen } from './MobileMachinesScreen';
// 机器 (MobileMachinesScreen) is the only remaining neutral STUB slot that a sibling thread replaces
// behind the same export (RB f528 frame-owner precedent). It asserts the slot renders with its design
// id marker + a title, and reserves the status-bar gutter (padding-top:62px). 5a (MobileSessionsScreen,
// task c880), 5b (MobileThreadsScreen, task ad9c), 5c (MobileTasksScreen), 10e (MobileApprovalsScreen)
// and 10f (MobileOverviewScreen, task 82ff) are now real tRPC-bound screens — they need query providers
// to mount, so they are covered by their own render tests + live harnesses, not this provider-free stub test.

function render(node: React.ReactElement) {
  return renderToStaticMarkup(<LangProvider>{node}</LangProvider>);
}

const cases: [string, React.ReactElement][] = [
  ['machines', <MobileMachinesScreen />],
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
