import { app, BrowserWindow, dialog, ipcMain, shell, Tray, Menu, nativeImage } from 'electron'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { existsSync, rmSync } from 'node:fs'
import { spawn } from 'node:child_process'
import { isFfmpegAvailable, isYtdlpAvailable, checkJsRuntime } from './utils'
import type { DownloadManager } from './downloadManager'
import { analyzeUrlForHls } from './hls'
import { analyzeWithYtdlp, updateYtdlp } from './ytdlp'

const __dirname = path.dirname(fileURLToPath(import.meta.url))


let downloadManager: DownloadManager | null = null
let autoUpdater: typeof import('electron-updater').autoUpdater | null = null
let logger: typeof import('electron-log').default | null = null
let mainWindow: BrowserWindow | null = null
let tray: Tray | null = null
let isQuitting = false


let signalServiceReady: () => void
const servicesReady = new Promise<void>(resolve => {
  signalServiceReady = resolve
})

function cleanUpdaterCache() {
  try {
    const cacheDir = path.join(app.getPath('userData'), '..', 'cortex-dl-updater')
    if (existsSync(cacheDir)) {
      logger?.info(`Cleaning updater cache: ${cacheDir}`)
      rmSync(cacheDir, { recursive: true, force: true })
    }
  } catch (error) {
    logger?.error('Cortex Updater: Failed to clean cache', error)
  }
}

async function initializeServices() {
  const { default: electronLog } = await import('electron-log')
  const { autoUpdater: electronUpdater } = await import('electron-updater')
  const { DownloadManager } = await import('./downloadManager')

  logger = electronLog
  autoUpdater = electronUpdater
  
  logger.transports.file.level = 'info'
  autoUpdater.logger = logger

  setupUpdaterListeners()

  if (mainWindow && !downloadManager) {
    downloadManager = new DownloadManager()
    downloadManager.attachWindow(mainWindow)
  }

  signalServiceReady()

  logger.info('Cortex Services initialized. Running startup checks...')
  cleanUpdaterCache()
  
  try {
    await autoUpdater.checkForUpdatesAndNotify()
  } catch (err) {
    logger.error('Cortex Update Check Failed:', err)
  }
}

function setupUpdaterListeners() {
  if (!autoUpdater) return

  const sendStatus = (status: string, data?: any) => {
    mainWindow?.webContents.send('update-status', { status, ...data })
  }

  autoUpdater.on('update-downloaded', () => {
    logger?.info('Update downloaded')
    sendStatus('downloaded')
  })

  autoUpdater.on('checking-for-update', () => sendStatus('checking'))
  autoUpdater.on('update-available', () => sendStatus('available'))
  autoUpdater.on('update-not-available', () => sendStatus('not-available'))
  autoUpdater.on('error', (err) => sendStatus('error', { error: err.message }))
  
  autoUpdater.on('download-progress', (progress) => {
    sendStatus('progress', { percent: progress.percent })
  })
}


ipcMain.handle('cortexdl:check-for-updates', () => autoUpdater?.checkForUpdates())
ipcMain.handle('cortexdl:restart-app', () => autoUpdater?.quitAndInstall())

ipcMain.handle('cortexdl:uninstall-app', () => {
  try {
    const uninstallerPath = path.join(path.dirname(app.getPath('exe')), 'unins000.exe')
    const userDataPath = app.getPath('userData')

    if (existsSync(userDataPath)) {
      try {
        rmSync(userDataPath, { recursive: true, force: true })
      } catch (err) {
        console.error('Cortex Uninstall: UserData wipe failed', err)
      }
    }

    if (existsSync(uninstallerPath)) {
      const child = spawn(uninstallerPath, [], { detached: true, stdio: 'ignore' })
      child.unref()
    } else {
      shell.openExternal('ms-settings:appsfeatures')
    }

    app.exit(0)
  } catch (error) {
    console.error('Cortex Uninstall Failed:', error)
  }
})

process.env.APP_ROOT = path.join(__dirname, '..')
export const VITE_DEV_SERVER_URL = process.env['VITE_DEV_SERVER_URL']
export const MAIN_DIST = path.join(process.env.APP_ROOT, 'dist-electron')
export const RENDERER_DIST = path.join(process.env.APP_ROOT, 'dist')

function initializeTray() {
  const iconPath = VITE_DEV_SERVER_URL 
    ? path.join(process.env.APP_ROOT, 'public', 'icon.ico') 
    : path.join(RENDERER_DIST, 'icon.ico')
    
  tray = new Tray(nativeImage.createFromPath(iconPath))
  tray.setToolTip('Cortex DL')

  const contextMenu = Menu.buildFromTemplate([
    { label: 'Open Cortex DL', click: () => mainWindow?.show() }, 
    { type: 'separator' }, 
    { 
      label: 'Quit', 
      click: () => { 
        isQuitting = true 
        app.quit() 
      } 
    } 
  ])

  tray.setContextMenu(contextMenu)
  tray.on('click', () => mainWindow?.show())
}

function createMainWindow() {
  const iconPath = VITE_DEV_SERVER_URL 
    ? path.join(process.env.APP_ROOT, 'public', 'icon.ico') 
    : path.join(RENDERER_DIST, 'icon.ico')

  mainWindow = new BrowserWindow({
    width: 1100,
    height: 720,
    title: 'Cortex DL',
    icon: iconPath,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.mjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })

  mainWindow.once('ready-to-show', () => mainWindow?.show())

  mainWindow.on('close', (event) => {
    if (!isQuitting) {
      event.preventDefault()
      mainWindow?.hide()
    }
    return false
  })

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url)
    return { action: 'deny' }
  })

  if (VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(VITE_DEV_SERVER_URL)
  } else {
    mainWindow.loadFile(path.join(RENDERER_DIST, 'index.html'))
  }
}

// File System Handlers
ipcMain.handle('cortexdl:select-folder', async () => {
  if (!mainWindow) return null
  const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory', 'createDirectory'],
  })
  return canceled ? null : filePaths[0]
})

ipcMain.handle('cortexdl:select-cookies-file', async () => {
  if (!mainWindow) return null
  const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile'],
    filters: [
      { name: 'Cookies', extensions: ['txt'] },
      { name: 'All Files', extensions: ['*'] },
    ],
  })
  return canceled ? null : filePaths[0]
})

ipcMain.handle('cortexdl:open-folder', async (_, targetPath: string) => {
  try {
    const normalized = path.normalize(targetPath)
    if (existsSync(normalized)) {
      shell.showItemInFolder(normalized)
    } else {
      const parentDir = path.dirname(normalized)
      if (existsSync(parentDir)) {
        await shell.openPath(parentDir)
      } else {
        throw new Error('Directory not found')
      }
    }
  } catch (err) {
    console.error('Cortex File System: Open folder failed', err)
    throw err
  }
})

ipcMain.handle('cortexdl:open-file', async (_, targetPath: string) => {
  if (existsSync(targetPath)) {
    const err = await shell.openPath(targetPath)
    if (err) throw new Error(err)
  } else {
    throw new Error('File not found')
  }
})

ipcMain.handle('cortexdl:open-external', (_, url) => shell.openExternal(url))


ipcMain.handle('cortexdl:check-engines', async () => {

  await new Promise(resolve => setTimeout(resolve, 500))
  
  const [ytdlp, ffmpeg, jsRuntime] = await Promise.all([
    isYtdlpAvailable(),
    isFfmpegAvailable(),
    checkJsRuntime()
  ])
  
  return {
    ytdlp,
    ffmpeg,
    jsRuntime: jsRuntime.available,
    jsRuntimeName: jsRuntime.name
  }
})

ipcMain.handle('cortexdl:update-engine', () => updateYtdlp())

ipcMain.handle('cortexdl:analyze-url', async (_, url: string, browser?: string) => {
  try {
    const hlsResult = await analyzeUrlForHls(url)
    if (hlsResult.kind !== 'unknown' && hlsResult.kind !== 'direct') {
      return hlsResult
    }
    
    const ytdlpResult = await analyzeWithYtdlp(url, browser)
    if (ytdlpResult.kind !== 'unknown') {
      return ytdlpResult
    }

    return hlsResult
  } catch (err) {
    console.error('Cortex Analysis Failed:', err)
    throw err
  }
})

// Download Handlers
ipcMain.handle('cortexdl:downloads:list', async () => {
  await servicesReady
  return downloadManager?.list() || []
})

ipcMain.handle('cortexdl:downloads:add', async (_, input) => {
  await servicesReady
  if (!downloadManager) throw new Error('Cortex Download Manager not ready')
  return downloadManager.add(input)
})

ipcMain.handle('cortexdl:downloads:pause', (_, id) => downloadManager?.pause(id))
ipcMain.handle('cortexdl:downloads:resume', (_, id) => downloadManager?.resume(id))
ipcMain.handle('cortexdl:downloads:cancel', (_, id) => downloadManager?.cancel(id))
ipcMain.handle('cortexdl:downloads:delete', (_, id, deleteFile) => downloadManager?.delete(id, deleteFile))
ipcMain.handle('cortexdl:downloads:clear-completed', () => downloadManager?.clearCompleted())
ipcMain.handle('cortexdl:downloads:pause-all', () => downloadManager?.pauseAll())
ipcMain.handle('cortexdl:downloads:resume-all', () => downloadManager?.resumeAll())

// App Lifecycle
const hasLock = app.requestSingleInstanceLock()

if (!hasLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      if (!mainWindow.isVisible()) mainWindow.show()
      mainWindow.focus()
    }
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
      app.quit()
      mainWindow = null
    }
  })

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow()
    }
  })

  app.whenReady().then(async () => {
    createMainWindow()
    if (!tray) initializeTray()
    
    setTimeout(initializeServices, 1500)
  })
}
