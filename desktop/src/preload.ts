// Cortex Desktop — preload script
// Context isolation is on (Electron default). The renderer (web SPA) communicates
// exclusively via tRPC over HTTP on the loopback (no direct IPC bridge needed).
// This file intentionally exposes nothing to the renderer via contextBridge —
// the SPA uses relative /trpc URLs that hit the loopback proxy in main.ts.

export {};
