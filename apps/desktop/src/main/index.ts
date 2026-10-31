import { app, BrowserWindow, shell } from 'electron'
import { join } from 'node:path'
import { createArtCache } from './art/cache'
import { handleArtProtocol, registerArtScheme } from './art/protocol'
import { registerIpc } from './ipc'
import { fixPath } from './shellPath'

// macOS/Linux: find the AI CLIs even when the app was opened from Finder or a launcher.
fixPath()

// One window per profile: a second launch brings the open one forward instead.
if (!app.requestSingleInstanceLock()) app.quit()
app.on('second-instance', () => {
  const [window] = BrowserWindow.getAllWindows()
  if (!window) return
  if (window.isMinimized()) window.restore()
  window.focus()
})
app.setAppUserModelId('com.dndtypeshit.app')

// Generated art is served from <userData>/art through dnd-art:// (the scheme must be known before ready).
registerArtScheme()

function createWindow(): void {
  const window = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 960,
    minHeight: 600,
    show: false,
    title: 'DND TYPESHIT',
    // The page's own background, so no white flash before it paints.
    backgroundColor: '#d8ecff',
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(import.meta.dirname, '../preload/index.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      // Scene ambience resumes without waiting for a click.
      autoplayPolicy: 'no-user-gesture-required',
    },
  })

  window.once('ready-to-show', () => window.show())

  // Links (e.g. "Get a key") open in the real browser; the game window never navigates away.
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https:\/\//i.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })
  window.webContents.on('will-navigate', (event, url) => {
    if (url !== window.webContents.getURL()) event.preventDefault()
  })

  const devUrl = process.env['ELECTRON_RENDERER_URL']
  if (devUrl) void window.loadURL(devUrl)
  else void window.loadFile(join(import.meta.dirname, '../renderer/index.html'))
}

app.whenReady().then(async () => {
  handleArtProtocol(createArtCache(join(app.getPath('userData'), 'art')))
  const session = await registerIpc(app.getPath('userData'))
  app.on('before-quit', session.flush)

  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
