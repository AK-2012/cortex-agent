import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { IOSDevice } from './IOSDevice';

// react-dom/server render checks for the ported iOS device frame (design/ref/ios-frame.jsx). The
// frame is presentational (raw px/hex by design, §8.3) — assert the load-bearing measurements are
// reproduced 1:1: 402×874 bezel, dynamic island, home indicator, status-bar time.

describe('IOSDevice', () => {
  const html = renderToStaticMarkup(
    <IOSDevice>
      <div>screen</div>
    </IOSDevice>,
  );

  it('renders the 402×874 bezel with the 48px corner radius', () => {
    expect(html).toContain('width:402px');
    expect(html).toContain('height:874px');
    expect(html).toContain('border-radius:48px');
  });

  it('renders the dynamic island (126×37, r24, black)', () => {
    expect(html).toContain('width:126px');
    expect(html).toContain('height:37px');
    expect(html).toContain('border-radius:24px');
  });

  it('renders the home indicator (139×5 pill)', () => {
    expect(html).toContain('width:139px');
    expect(html).toContain('height:5px');
  });

  it('renders the status bar with the 9:41 time', () => {
    expect(html).toContain('9:41');
  });

  it('renders its children (screen content) inside the frame', () => {
    expect(html).toContain('screen');
  });
});
