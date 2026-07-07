// input:  Electron app lifecycle + createProxyServer + getConfig
// output: BrowserWindow loading http://127.0.0.1:<port> (loopback proxy serving web/dist)
// pos:    Electron main process. Starts a loopback HTTP server (proxy-server.ts) that serves
//         the built web SPA and reverse-proxies /trpc to the configured remote serverUrl.
//         The BrowserWindow loads the loopback origin so the SPA's relative /trpc URL resolves
//         same-origin — zero changes to web/src required.

import { app, BrowserWindow } from 'electron';
import * as path from 'node:path';
import { createProxyServer } from './proxy-server.js';
import { getConfig } from './config-store.js';

let proxyClose: (() => Promise<void>) | null = null;

/**
 * Returns the path to the built web/dist directory.
 * - Packaged app: electron-builder copies web/dist → resources/web-dist via extraResources.
 * - Development: two levels up from dist-electron/ to the monorepo root, then web/dist.
 */
function getSpaDir(): string {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, 'web-dist');
  }
  // Dev layout: desktop/dist-electron/main.js → ../../ = monorepo root → web/dist
  return path.join(import.meta.dirname, '..', '..', 'web', 'dist');
}

async function createWindow(port: number): Promise<BrowserWindow> {
  const win = new BrowserWindow({
    width: 1400,
    height: 900,
    webPreferences: {
      preload: path.join(import.meta.dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  // Log the loaded URL; in CORTEX_DESKTOP_TEST mode quit immediately after load
  // (used for headless CI verification: run with Xvfb and check stdout for this line).
  win.webContents.on('did-finish-load', () => {
    console.log(`[main] BrowserWindow loaded: ${win.webContents.getURL()}`);
    if (process.env['CORTEX_DESKTOP_TEST']) {
      console.log('[main] test mode: quit after load');
      app.quit();
    }
  });

  await win.loadURL(`http://127.0.0.1:${port}`);

  // Open DevTools in development when ELECTRON_DEVTOOLS env var is set.
  if (!app.isPackaged && process.env['ELECTRON_DEVTOOLS']) {
    win.webContents.openDevTools();
  }

  return win;
}

app.whenReady().then(async () => {
  const spaDir = getSpaDir();
  const desktopPort = parseInt(process.env['CORTEX_DESKTOP_PORT'] ?? '0', 10);

  const proxy = await createProxyServer({
    getConfig,
    spaDir,
    port: desktopPort,
  });

  proxyClose = proxy.close;

  await createWindow(proxy.port);

  // macOS: re-create the window when the dock icon is clicked and no windows exist.
  app.on('activate', async () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      await createWindow(proxy.port);
    }
  });
});

// On non-macOS, quit when all windows are closed.
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// Cleanly shut down the proxy server before the process exits.
// NOTE: Electron does not await async event handlers; proxyClose() is fire-and-forget
// here. In practice server.closeAllConnections() is synchronous (Node 18.2+), so
// connections are torn down immediately before the process exits.
app.on('before-quit', async () => {
  if (proxyClose) {
    await proxyClose();
    proxyClose = null;
  }
});
