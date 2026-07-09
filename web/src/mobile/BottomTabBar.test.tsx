import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { BottomTabBar } from './BottomTabBar';
import { zh } from '@/i18n';

// react-dom/server render checks for the mobile bottom Tab bar (scheme L2995-3000 / L3188-3191).
// Presentational + props-driven (MobileShell binds the real tRPC counts), so these assert the
// 1:1 chrome: zh labels, active/inactive tone, active-thread badge, amber approval dot, ≥44px touch.

function render(props: Parameters<typeof BottomTabBar>[0]) {
  return renderToStaticMarkup(<BottomTabBar {...props} />);
}

const base = {
  vocab: zh,
  activeId: 'sessions' as const,
  activeThreadCount: 0,
  hasPendingApproval: false,
  onNavigate: () => {},
};

describe('BottomTabBar', () => {
  it('renders the 4 zh labels from vocab in order', () => {
    const html = render(base);
    expect(html).toContain('会话');
    expect(html).toContain('线程');
    expect(html).toContain('任务');
    expect(html).toContain('机器');
  });

  it('marks the active tab (data-active) and colors it ink #191C22', () => {
    const html = render({ ...base, activeId: 'tasks' });
    expect(html).toContain('data-tab-id="tasks"');
    // the active tab carries data-active="true"
    expect(html).toMatch(/data-tab-id="tasks"[^>]*data-active="true"|data-active="true"[^>]*data-tab-id="tasks"/);
    expect(html).toContain('#191C22');
    expect(html).toContain('#98A1B0');
  });

  it('gives every tab a ≥44px touch target', () => {
    const html = render(base);
    expect(html).toContain('min-height:44px');
  });

  it('shows the active-thread badge (#4655D4) with the count on the threads tab', () => {
    const html = render({ ...base, activeThreadCount: 3 });
    expect(html).toContain('#4655D4');
    expect(html).toContain('>3<');
  });

  it('hides the badge when the active-thread count is 0', () => {
    const html = render({ ...base, activeThreadCount: 0 });
    expect(html).not.toContain('#4655D4');
  });

  it('shows the amber approval dot (#C99A2E) on the sessions tab when pending', () => {
    const html = render({ ...base, hasPendingApproval: true });
    expect(html).toContain('#C99A2E');
  });

  it('hides the amber dot when nothing is pending', () => {
    const html = render({ ...base, hasPendingApproval: false });
    expect(html).not.toContain('#C99A2E');
  });
});
