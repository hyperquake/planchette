'use strict'

/**
 * A plain browser window, for scripts/smoke-embed.mjs.
 *
 * Deliberately not electron/main.js: that registers the planchette:// protocol
 * and creates a workspace, and the embed is a web artifact served over http with
 * no Electron around it. This is the closest thing to "a browser we already
 * depend on".
 *
 *   electron scripts/embed-browser.cjs <url>
 */
const { app, BrowserWindow } = require('electron')

app.whenReady().then(() => {
  const win = new BrowserWindow({
    width: 1280,
    height: 720,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      // The examples render in a requestAnimationFrame loop, which Chromium
      // throttles to a standstill once it decides a window is not visible.
      backgroundThrottling: false,
    },
  })
  win.loadURL(process.argv[2])
})
