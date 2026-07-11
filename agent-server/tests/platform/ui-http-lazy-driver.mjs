// Child driver for the lazy-load guard (ui-http-lazy-load.test.ts). Registers a resolve hook that
// records every resolved specifier, then exercises the CORTEX_UI_HTTP seam in one of two modes:
//   LAZY_MODE=off  → import the gate and call startUiHttpIfEnabled with the flag UNSET. The gate must
//                    return null WITHOUT dynamic-importing the transport, so @trpc/server + jose must
//                    NOT appear among the resolved specifiers.
//   LAZY_MODE=load → import the transport directly (positive control), proving the hook DOES record
//                    @trpc/server + jose when they are actually loaded (guards against a false pass).
// Prints the recorded specifiers as a JSON array on the last stdout line. Run under `node --import tsx`
// (from agent-server/) so the @-path aliases + .ts resolution work. Not a test (`.mjs`).
import { register } from 'node:module';
import { MessageChannel } from 'node:worker_threads';

const seen = new Set();
const { port1, port2 } = new MessageChannel();
port1.on('message', (m) => seen.add(m));

register('./ui-http-lazy-hooks.mjs', {
  parentURL: import.meta.url,
  data: { port: port2 },
  transferList: [port2],
});

const mode = process.env.LAZY_MODE;

if (mode === 'off') {
  const { startUiHttpIfEnabled } = await import('@entry/ui-http-gate.js');
  // Fake UiService (never touched — the flag is off) + an env WITHOUT CORTEX_UI_HTTP.
  const result = await startUiHttpIfEnabled(/** @type {any} */ ({}), { PATH: process.env.PATH });
  if (result !== null) {
    console.error('LAZY_DRIVER_ERROR: expected null when CORTEX_UI_HTTP is unset');
    process.exit(2);
  }
} else if (mode === 'load') {
  await import('@entry/start-ui-http.js');
} else {
  console.error(`LAZY_DRIVER_ERROR: unknown LAZY_MODE=${mode}`);
  process.exit(3);
}

// Let the loader-thread messages drain, then report.
await new Promise((r) => setTimeout(r, 100));
port1.close();
console.log(JSON.stringify([...seen]));
process.exit(0);
