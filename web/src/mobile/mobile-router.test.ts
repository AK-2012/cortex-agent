import { describe, it, expect } from 'vitest';
import { mobileRoutes } from './mobile-routes';

// Structural test of the mobile route config: MobileShell layout wraps the 6 screen slots + an
// index redirect + a catch-all. Full render (with tRPC) is exercised live (headless-Chrome).

const layout = mobileRoutes[0];
const childPaths = (layout.children ?? []).map((c) => c.path).filter(Boolean);

describe('mobileRoutes', () => {
  it('is a single MobileShell layout route', () => {
    expect(mobileRoutes).toHaveLength(1);
    expect(layout.path).toBe('/');
    expect(layout.element).toBeTruthy();
  });

  it('mounts the 4 tab screens + the 10e/10f sub-screens under /m/*', () => {
    expect(childPaths).toEqual(
      expect.arrayContaining([
        '/m/sessions',
        '/m/threads',
        '/m/tasks',
        '/m/machines',
        '/m/approvals',
        '/m/overview',
      ]),
    );
  });

  it('all 5 named STUB routes (5a/5b/5c/10e/10f) are navigable', () => {
    for (const p of ['/m/sessions', '/m/threads', '/m/tasks', '/m/approvals', '/m/overview']) {
      const route = (layout.children ?? []).find((c) => c.path === p);
      expect(route, p).toBeTruthy();
      expect(route!.element, p).toBeTruthy();
    }
  });

  it('has an index redirect and a catch-all so a desktop→mobile resize resolves cleanly', () => {
    const children = layout.children ?? [];
    expect(children.some((c) => c.index === true)).toBe(true);
    expect(children.some((c) => c.path === '*')).toBe(true);
  });
});
