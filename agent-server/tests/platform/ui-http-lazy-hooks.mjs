// Module-customization resolve hook for the lazy-load guard (ui-http-lazy-load.test.ts).
// Runs on the loader thread; posts every resolved specifier back to the driver via a MessagePort
// so the test can assert which packages entered the module graph. Not a test itself (`.mjs`, so it
// is never matched by the `*.test.ts` glob).
let port;

export async function initialize(data) {
  port = data.port;
}

export async function resolve(specifier, context, nextResolve) {
  try {
    port?.postMessage(specifier);
  } catch {
    // best-effort recording; never break resolution
  }
  return nextResolve(specifier, context);
}
