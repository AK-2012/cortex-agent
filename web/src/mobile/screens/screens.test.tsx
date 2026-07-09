import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { LangProvider } from '@/i18n';
import { MobileSessionsScreen } from './MobileSessionsScreen';
import { MobileThreadsScreen } from './MobileThreadsScreen';
import { MobileTasksScreen } from './MobileTasksScreen';
import { MobileMachinesScreen } from './MobileMachinesScreen';
import { MobileApprovalsScreen } from './MobileApprovalsScreen';

// Each mobile screen is a neutral STUB slot (design 5a/5b/5c/10e) that a sibling thread replaces
// behind the same export (RB f528 frame-owner precedent). These assert the slots render with their
// design id marker + a title, and reserve the status-bar gutter (padding-top:62px).
// NOTE: 10f (MobileOverviewScreen) is no longer a stub (task 82ff — real 1:1 Overview over live tRPC
// data); it needs the QueryClient/tRPC providers, so it is covered by overview-mobile-vm.test.ts +
// the live headless-Chrome render, not this static-markup stub suite.

function render(node: React.ReactElement) {
  return renderToStaticMarkup(<LangProvider>{node}</LangProvider>);
}

const cases: [string, React.ReactElement][] = [
  ['5a', <MobileSessionsScreen />],
  ['5b', <MobileThreadsScreen />],
  ['5c', <MobileTasksScreen />],
  ['machines', <MobileMachinesScreen />],
  ['10e', <MobileApprovalsScreen />],
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
    expect(render(<MobileThreadsScreen />)).toContain('Threads');
    expect(render(<MobileTasksScreen />)).toContain('Tasks');
    expect(render(<MobileMachinesScreen />)).toContain('Machines');
  });
});
