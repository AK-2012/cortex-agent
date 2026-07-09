import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { LangProvider } from '@/i18n';
import { MobileThreadsScreen } from './MobileThreadsScreen';
import { MobileMachinesScreen } from './MobileMachinesScreen';
import { MobileOverviewScreen } from './MobileOverviewScreen';

// The remaining mobile screens are neutral STUB slots (design 5b/10f + 机器) that a sibling thread
// replaces behind the same export (RB f528 frame-owner precedent). These assert the slots render with
// their design id marker + a title, and reserve the status-bar gutter (padding-top:62px). 5a
// (MobileSessionsScreen, task c880), 10e (MobileApprovalsScreen) and 5c (MobileTasksScreen) are now
// real tRPC-bound screens — covered by mobile-session-render.test.tsx / mobile-approvals-render.test.tsx
// / MobileTasksView.test.tsx (they need tRPC providers, so they are not bare stub renders here).

function render(node: React.ReactElement) {
  return renderToStaticMarkup(<LangProvider>{node}</LangProvider>);
}

const cases: [string, React.ReactElement][] = [
  ['5b', <MobileThreadsScreen />],
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
    expect(render(<MobileThreadsScreen />)).toContain('Threads');
    expect(render(<MobileMachinesScreen />)).toContain('Machines');
  });
});
