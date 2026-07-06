import { describe, expect, it } from 'vitest';
import {
  MAX_TOASTS,
  addToast,
  removeToast,
  type ToastItem,
} from './toast-store';

function make(id: string, title = id): ToastItem {
  return { id, title, tone: 'running', duration: 5000 };
}

describe('toast-store', () => {
  it('appends a toast to the end of the list', () => {
    const list = addToast([make('a')], make('b'));
    expect(list.map((t) => t.id)).toEqual(['a', 'b']);
  });

  it('removes a toast by id', () => {
    const list = removeToast([make('a'), make('b'), make('c')], 'b');
    expect(list.map((t) => t.id)).toEqual(['a', 'c']);
  });

  it('is a no-op when removing an unknown id', () => {
    const start = [make('a'), make('b')];
    expect(removeToast(start, 'zzz').map((t) => t.id)).toEqual(['a', 'b']);
  });

  it('caps the list at MAX_TOASTS by dropping the oldest', () => {
    let list: ToastItem[] = [];
    for (let i = 0; i < MAX_TOASTS + 2; i++) {
      list = addToast(list, make(`t${i}`));
    }
    expect(list).toHaveLength(MAX_TOASTS);
    // oldest two (t0, t1) dropped; newest kept
    expect(list[0].id).toBe('t2');
    expect(list[list.length - 1].id).toBe(`t${MAX_TOASTS + 1}`);
  });

  it('does not mutate the input list', () => {
    const start = [make('a')];
    addToast(start, make('b'));
    removeToast(start, 'a');
    expect(start.map((t) => t.id)).toEqual(['a']);
  });
});
