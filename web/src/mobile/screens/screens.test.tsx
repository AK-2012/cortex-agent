import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { LangProvider } from '@/i18n';
import { MobileSessionsScreen } from './MobileSessionsScreen';
import { MobileTasksScreen } from './MobileTasksScreen';
import { MobileMachinesScreen } from './MobileMachinesScreen';
import { MobileApprovalsScreen } from './MobileApprovalsScreen';
import { MobileOverviewScreen } from './MobileOverviewScreen';

// The remaining mobile screens are neutral STUB slots (design 5a/5c/10e/10f) that a sibling thread
// replaces behind the same export (RB f528 frame-owner precedent). These assert the slots render with
// their design id marker + a title, and reserve the status-bar gutter (padding-top:62px). 5b (线程) is
// now a real tRPC-bound screen (task ad9c) — it needs query providers to mount, so it is covered by
// the MobileThreadViews render tests + the live harness, not this provider-free stub test.

function render(node: React.ReactElement) {
  return renderToStaticMarkup(<LangProvider>{node}</LangProvider>);
}

const cases: [string, React.ReactElement][] = [
  ['5a', <MobileSessionsScreen />],
  ['5c', <MobileTasksScreen />],
  ['machines', <MobileMachinesScreen />],
  ['10e', <MobileApprovalsScreen />],
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
    expect(render(<MobileSessionsScreen />)).toContain('Sessions');
    expect(render(<MobileTasksScreen />)).toContain('Tasks');
    expect(render(<MobileMachinesScreen />)).toContain('Machines');
  });
});
