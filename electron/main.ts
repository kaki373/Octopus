import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  nativeImage,
  protocol,
  screen,
  shell,
  type OpenDialogOptions,
} from 'electron'
import * as exifr from 'exifr'
import { createReadStream, writeFileSync, promises as fs } from 'node:fs'
import path from 'node:path'
import { Readable } from 'node:stream'
import { fileURLToPath, pathToFileURL } from 'node:url'

type MediaKind = 'image' | 'video' | 'audio'

type ViewerEntry = {
  path: string
  name: string
  ext: string
  kind: MediaKind
  size: number
  createdAt: number
  modifiedAt: number
  dateTakenAt: number | null
}

type ResolveSourceResult =
  | {
      strategy: 'file-url'
      kind: MediaKind
      mimeType: string
      url: string
    }
  | {
      strategy: 'buffer'
      kind: MediaKind
      mimeType: string
      bytes: Uint8Array
    }

type WebContentsWithConsoleMessage = Electron.WebContents & {
  on(
    event: 'console-message',
    listener: (
      event: Electron.Event,
      level: number,
      message: string,
      line: number,
      sourceId: string
    ) => void
  ): Electron.WebContents
}

const imageExtensions = new Set([
  '.avif',
  '.gif',
  '.heic',
  '.heif',
  '.jfif',
  '.jpeg',
  '.jpg',
  '.png',
  '.psd',
  '.webp',
])

const videoExtensions = new Set(['.mkv', '.mov', '.mp4', '.webm'])
const audioExtensions = new Set(['.mp3', '.wav'])
const bufferOnlyExtensions = new Set(['.heic', '.heif', '.psd'])

const mimeTypeMap: Record<string, string> = {
  '.avif': 'image/avif',
  '.gif': 'image/gif',
  '.heic': 'image/heic',
  '.heif': 'image/heif',
  '.jfif': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.mkv': 'video/x-matroska',
  '.mov': 'video/quicktime',
  '.mp3': 'audio/mpeg',
  '.mp4': 'video/mp4',
  '.png': 'image/png',
  '.psd': 'image/vnd.adobe.photoshop',
  '.wav': 'audio/wav',
  '.webm': 'video/webm',
  '.webp': 'image/webp',
}

type PersistedSettings = {
  sortField?: string
  sortDirection?: string
  motionAutoplay?: boolean
  audioAutoplay?: boolean
  videoVolume?: number
  videoMuted?: boolean
  filmstripVisible?: boolean
  fileBadgeVisible?: boolean
  videoBarHidden?: boolean
  videoBarWidth?: number | null
  videoBarX?: number
  videoBarY?: number
  windowBounds?: { x: number; y: number; width: number; height: number }
}

const dateTakenCache = new Map<string, number | null>()
const debugEnabled = process.env.VIEWER_DEBUG === '1'
const selfCheckEnabled = process.env.VIEWER_SELF_CHECK === '1'
const debugLogFilePath = path.join(process.cwd(), 'viewer-debug.log')

let mainWindow: BrowserWindow | null = null
const hasSingleInstanceLock = app.requestSingleInstanceLock()

const currentDir = path.dirname(fileURLToPath(import.meta.url))
const preloadPath = path.join(currentDir, 'preload.cjs')
const rendererHtmlPath = path.join(currentDir, '../dist/index.html')
const appIconPath = path.join(currentDir, '../assets/octopus.ico')

app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required')

// A dedicated streaming protocol keeps media playable from both the dev server
// (http origin, where file:// subresources are blocked) and the packaged app,
// and serves HTTP Range responses so <video> seeking stays accurate.
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'media',
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      stream: true,
    },
  },
])

// Must stay in sync with getMediaUrl in electron/preload.cts.
function toMediaUrl(filePath: string) {
  return `media://local/${encodeURIComponent(filePath)}`
}

function fromMediaUrl(requestUrl: string) {
  const url = new URL(requestUrl)
  return decodeURIComponent(url.pathname.replace(/^\//, ''))
}

function toWebStream(filePath: string, signal: AbortSignal, options?: { start: number; end: number }) {
  const nodeStream = options ? createReadStream(filePath, options) : createReadStream(filePath)
  // Seeking makes Chromium abort in-flight range requests rapidly; destroy the
  // file stream explicitly so aborted requests never accumulate descriptors.
  signal.addEventListener('abort', () => nodeStream.destroy(), { once: true })
  return Readable.toWeb(nodeStream) as unknown as ReadableStream
}

async function serveMediaFile(request: Request): Promise<Response> {
  const filePath = fromMediaUrl(request.url)
  const ext = path.extname(filePath).toLowerCase()

  if (!getMediaKind(ext)) {
    return new Response('Forbidden', { status: 403 })
  }

  const stat = await fs.stat(filePath)
  const totalSize = stat.size
  const mimeType = mimeTypeMap[ext] ?? 'application/octet-stream'
  const baseHeaders: Record<string, string> = {
    'Content-Type': mimeType,
    'Accept-Ranges': 'bytes',
  }

  const rangeHeader = request.headers.get('range')
  const rangeMatch = rangeHeader ? /^bytes=(\d*)-(\d*)$/.exec(rangeHeader.trim()) : null

  if (rangeMatch && (rangeMatch[1] || rangeMatch[2])) {
    let start: number
    let end: number

    if (rangeMatch[1]) {
      start = Number(rangeMatch[1])
      end = rangeMatch[2] ? Math.min(Number(rangeMatch[2]), totalSize - 1) : totalSize - 1
    } else {
      // Suffix range: last N bytes.
      const suffixLength = Math.min(Number(rangeMatch[2]), totalSize)
      start = totalSize - suffixLength
      end = totalSize - 1
    }

    if (!Number.isFinite(start) || !Number.isFinite(end) || start > end || start >= totalSize) {
      return new Response('Range Not Satisfiable', {
        status: 416,
        headers: { 'Content-Range': `bytes */${totalSize}` },
      })
    }

    return new Response(toWebStream(filePath, request.signal, { start, end }), {
      status: 206,
      headers: {
        ...baseHeaders,
        'Content-Range': `bytes ${start}-${end}/${totalSize}`,
        'Content-Length': String(end - start + 1),
      },
    })
  }

  return new Response(toWebStream(filePath, request.signal), {
    status: 200,
    headers: { ...baseHeaders, 'Content-Length': String(totalSize) },
  })
}

if (!hasSingleInstanceLock) {
  app.quit()
}

function debugLog(message: string, data?: unknown) {
  if (!debugEnabled) return

  const stamp = new Date().toISOString()
  const suffix =
    data === undefined
      ? ''
      : ` ${typeof data === 'string' ? data : JSON.stringify(data, null, 2)}`

  const line = `[viewer-debug ${stamp}] ${message}${suffix}`
  if (data === undefined) {
    console.log(line)
  } else {
    console.log(line)
  }

  void fs.appendFile(debugLogFilePath, `${line}\n`).catch(() => undefined)
}

function getSettingsFilePath() {
  if (selfCheckEnabled) {
    // Keep automated runs hermetic: never read or clobber the user's real settings.
    return path.join(process.cwd(), 'output', 'viewer-settings.self-check.json')
  }

  return path.join(app.getPath('userData'), 'viewer-settings.json')
}

let cachedSettings: PersistedSettings | null = null

async function readSettingsFrom(filePath: string): Promise<PersistedSettings | null> {
  try {
    const parsed = JSON.parse(await fs.readFile(filePath, 'utf8'))
    return parsed && typeof parsed === 'object' ? (parsed as PersistedSettings) : {}
  } catch {
    return null
  }
}

async function readSettings(): Promise<PersistedSettings> {
  if (cachedSettings) return cachedSettings

  let settings = await readSettingsFrom(getSettingsFilePath())

  if (settings === null && !selfCheckEnabled) {
    // One-time migration from before the app was renamed to Octopus.
    settings = await readSettingsFrom(
      path.join(app.getPath('appData'), 'desktop-media-viewer', 'viewer-settings.json')
    )
  }

  cachedSettings = settings ?? {}
  return cachedSettings
}

async function updateSettings(partial: Partial<PersistedSettings>) {
  const current = await readSettings()
  cachedSettings = { ...current, ...partial }

  try {
    const filePath = getSettingsFilePath()
    await fs.mkdir(path.dirname(filePath), { recursive: true })
    await fs.writeFile(filePath, JSON.stringify(cachedSettings, null, 2), 'utf8')
  } catch (error) {
    debugLog('settings:write-error', {
      error: error instanceof Error ? error.message : String(error),
    })
  }
}

function persistWindowBoundsSync() {
  if (!mainWindow || mainWindow.isDestroyed()) return

  const bounds = mainWindow.isFullScreen() ? mainWindow.getNormalBounds() : mainWindow.getBounds()
  cachedSettings = { ...(cachedSettings ?? {}), windowBounds: bounds }

  try {
    // Synchronous write: this runs during window close, where async writes can be dropped.
    writeFileSync(getSettingsFilePath(), JSON.stringify(cachedSettings, null, 2), 'utf8')
  } catch {
    // Losing window bounds is not worth surfacing an error for.
  }
}

function sendFullscreenState() {
  if (!mainWindow || mainWindow.isDestroyed()) return
  const isFullScreen = mainWindow.isFullScreen()
  debugLog('fullscreenState', { isFullScreen })
  mainWindow.webContents.send('viewer:fullscreen-change', isFullScreen)
}

function getStartupTargetFromArgv() {
  // Drop chromium flags first (tools like Playwright inject them before the
  // app path), then skip the app path itself in unpackaged runs.
  const nonFlagArgs = process.argv.slice(1).filter((arg) => !arg.startsWith('--'))
  const targetArg = nonFlagArgs[app.isPackaged ? 0 : 1]

  if (!targetArg) return null
  return path.resolve(targetArg)
}

function getMediaKind(ext: string): MediaKind | null {
  if (imageExtensions.has(ext)) return 'image'
  if (videoExtensions.has(ext)) return 'video'
  if (audioExtensions.has(ext)) return 'audio'
  return null
}

async function getDateTaken(filePath: string, kind: MediaKind): Promise<number | null> {
  if (dateTakenCache.has(filePath)) {
    return dateTakenCache.get(filePath) ?? null
  }

  if (kind !== 'image' && kind !== 'video') {
    dateTakenCache.set(filePath, null)
    return null
  }

  try {
    const tags = await exifr.parse(filePath, [
      'DateTimeOriginal',
      'CreateDate',
      'DateCreated',
      'MediaCreateDate',
    ])

    const candidate =
      tags?.DateTimeOriginal ??
      tags?.CreateDate ??
      tags?.DateCreated ??
      tags?.MediaCreateDate ??
      null

    const timestamp = candidate instanceof Date ? candidate.getTime() : null
    dateTakenCache.set(filePath, timestamp)
    return timestamp
  } catch {
    dateTakenCache.set(filePath, null)
    return null
  }
}

async function listFolder(folderPath: string, includeDateTaken: boolean): Promise<ViewerEntry[]> {
  debugLog('listFolder:begin', { folderPath, includeDateTaken })
  const dirents = await fs.readdir(folderPath, { withFileTypes: true })
  const matching = dirents.filter((dirent) => {
    if (!dirent.isFile()) return false
    const ext = path.extname(dirent.name).toLowerCase()
    return getMediaKind(ext) !== null
  })

  const entries = await Promise.all(
    matching.map(async (dirent) => {
      const fullPath = path.join(folderPath, dirent.name)
      const ext = path.extname(dirent.name).toLowerCase()
      const kind = getMediaKind(ext)

      if (!kind) return null

      const stat = await fs.stat(fullPath)
      const dateTakenAt = includeDateTaken ? await getDateTaken(fullPath, kind) : null

      return {
        path: fullPath,
        name: dirent.name,
        ext,
        kind,
        size: stat.size,
        createdAt: stat.birthtimeMs || stat.ctimeMs,
        modifiedAt: stat.mtimeMs,
        dateTakenAt,
      } satisfies ViewerEntry
    })
  )

  const filtered = entries.filter((entry): entry is ViewerEntry => entry !== null)
  debugLog('listFolder:end', {
    folderPath,
    totalDirents: dirents.length,
    supportedEntries: filtered.length,
  })
  return filtered
}

async function resolveSource(filePath: string): Promise<ResolveSourceResult> {
  const ext = path.extname(filePath).toLowerCase()
  const kind = getMediaKind(ext)

  debugLog('resolveSource:begin', { filePath, ext, kind })

  if (!kind) {
    throw new Error(`Unsupported file extension: ${ext}`)
  }

  if (bufferOnlyExtensions.has(ext)) {
    const bytes = new Uint8Array(await fs.readFile(filePath))
    const result: ResolveSourceResult = {
      strategy: 'buffer',
      kind,
      mimeType: mimeTypeMap[ext] ?? 'application/octet-stream',
      bytes,
    }
    debugLog('resolveSource:end', {
      filePath,
      strategy: result.strategy,
      kind: result.kind,
      mimeType: result.mimeType,
      byteLength: result.bytes.byteLength,
    })
    return result
  }

  const result: ResolveSourceResult = {
    strategy: 'file-url',
    kind,
    mimeType: mimeTypeMap[ext] ?? 'application/octet-stream',
    url: toMediaUrl(filePath),
  }
  debugLog('resolveSource:end', {
    filePath,
    strategy: result.strategy,
    kind: result.kind,
    mimeType: result.mimeType,
    url: result.url,
  })
  return result
}

async function createWindow() {
  debugLog('createWindow')

  const settings = await readSettings()
  const savedBounds = settings.windowBounds
  const sizeValid =
    savedBounds &&
    Number.isFinite(savedBounds.x) &&
    Number.isFinite(savedBounds.y) &&
    Number.isFinite(savedBounds.width) &&
    Number.isFinite(savedBounds.height) &&
    savedBounds.width >= 640 &&
    savedBounds.height >= 480

  // Restore the position only while it still overlaps a connected display;
  // otherwise the window would reopen off-screen (e.g. unplugged monitor).
  let positionValid = false
  if (sizeValid && savedBounds) {
    const workArea = screen.getDisplayMatching(savedBounds).workArea
    positionValid =
      savedBounds.x < workArea.x + workArea.width - 60 &&
      savedBounds.x + savedBounds.width > workArea.x + 60 &&
      savedBounds.y >= workArea.y - 20 &&
      savedBounds.y < workArea.y + workArea.height - 60
  }

  mainWindow = new BrowserWindow({
    width: sizeValid && savedBounds ? savedBounds.width : 1480,
    height: sizeValid && savedBounds ? savedBounds.height : 940,
    x: positionValid && savedBounds ? savedBounds.x : undefined,
    y: positionValid && savedBounds ? savedBounds.y : undefined,
    minWidth: 960,
    minHeight: 560,
    autoHideMenuBar: true,
    backgroundColor: '#0f1115',
    icon: appIconPath,
    title: 'Octopus',
    // Drop the native title bar: the in-app toolbar doubles as the drag region,
    // and Windows draws its min/max/close buttons as an overlay.
    titleBarStyle: 'hidden',
    titleBarOverlay: {
      color: '#101216',
      symbolColor: '#e8eaed',
      height: 40,
    },
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      navigateOnDragDrop: false,
    },
  })

  mainWindow.on('enter-full-screen', sendFullscreenState)
  mainWindow.on('leave-full-screen', sendFullscreenState)
  mainWindow.on('close', persistWindowBoundsSync)
  mainWindow.on('blur', stopWindowDrag)

  const devServerUrl = process.env.VITE_DEV_SERVER_URL
  const startUrl = devServerUrl ?? pathToFileURL(rendererHtmlPath).toString()

  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  mainWindow.webContents.on('did-start-loading', () => {
    debugLog('renderer:did-start-loading')
  })
  mainWindow.webContents.on('did-finish-load', () => {
    debugLog('renderer:did-finish-load', { url: mainWindow?.webContents.getURL() })
  })
  mainWindow.webContents.on(
    'did-fail-load',
    (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
      debugLog('renderer:did-fail-load', {
        errorCode,
        errorDescription,
        validatedURL,
        isMainFrame,
      })
    }
  )
  mainWindow.webContents.on('render-process-gone', (_event, details) => {
    debugLog('renderer:process-gone', details)
  })
  ;(mainWindow.webContents as WebContentsWithConsoleMessage).on(
    'console-message',
    (_event, level, message, line, sourceId) => {
      debugLog('renderer:console', {
        level,
        message,
        line,
        sourceId,
      })
    }
  )
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith(startUrl)) {
      debugLog('will-navigate blocked', { url, startUrl })
      event.preventDefault()
    }
  })

  if (devServerUrl) {
    await mainWindow.loadURL(devServerUrl)
  } else {
    await mainWindow.loadFile(rendererHtmlPath)
  }

  if (debugEnabled && !selfCheckEnabled) {
    mainWindow.webContents.openDevTools({ mode: 'detach' })
  }
}

ipcMain.handle('viewer:select-folder', async () => {
  const owner = BrowserWindow.getFocusedWindow() ?? mainWindow
  const options: OpenDialogOptions = {
    properties: ['openDirectory'],
    title: 'Open Folder',
  }

  const result = owner
    ? await dialog.showOpenDialog(owner, options)
    : await dialog.showOpenDialog(options)

  if (result.canceled || !result.filePaths[0]) {
    return null
  }

  return result.filePaths[0]
})

ipcMain.on('viewer:debug-log', (_event, payload: { message: string; data?: unknown }) => {
  debugLog(`renderer:${payload.message}`, payload.data)
})

ipcMain.handle(
  'viewer:list-folder',
  async (_event, folderPath: string, options?: { includeDateTaken?: boolean }) => {
    return await listFolder(folderPath, options?.includeDateTaken === true)
  }
)

ipcMain.handle('viewer:resolve-source', async (_event, filePath: string) => {
  return await resolveSource(filePath)
})

ipcMain.handle('viewer:toggle-fullscreen', async () => {
  if (!mainWindow) return false
  mainWindow.setFullScreen(!mainWindow.isFullScreen())
  debugLog('toggleFullscreen', { isFullScreen: mainWindow.isFullScreen() })
  return mainWindow.isFullScreen()
})

ipcMain.handle('viewer:set-fullscreen', async (_event, shouldBeFullscreen: boolean) => {
  if (!mainWindow) return false
  mainWindow.setFullScreen(shouldBeFullscreen)
  debugLog('setFullscreen', { isFullScreen: mainWindow.isFullScreen() })
  sendFullscreenState()
  return mainWindow.isFullScreen()
})

ipcMain.handle('viewer:get-fullscreen', async () => {
  return mainWindow?.isFullScreen() ?? false
})

ipcMain.handle('viewer:get-settings', async () => {
  const { windowBounds: _ignored, ...rendererSettings } = await readSettings()
  return rendererSettings
})

ipcMain.handle('viewer:update-settings', async (_event, partial: Partial<PersistedSettings>) => {
  await updateSettings(partial)
})

ipcMain.handle('viewer:delete-item', async (_event, filePath: string) => {
  const fileName = path.basename(filePath)

  if (!selfCheckEnabled) {
    const owner = BrowserWindow.getFocusedWindow() ?? mainWindow
    if (!owner) return { deleted: false }

    const result = await dialog.showMessageBox(owner, {
      type: 'warning',
      buttons: ['ごみ箱に移動', 'キャンセル'],
      defaultId: 0,
      cancelId: 1,
      noLink: true,
      title: '削除の確認',
      message: `${fileName} をごみ箱に移動しますか？`,
      detail: 'ごみ箱からいつでも元に戻せます。',
    })

    if (result.response !== 0) {
      return { deleted: false }
    }
  }

  try {
    await shell.trashItem(filePath)
    debugLog('deleteItem:trashed', { filePath })
    return { deleted: true }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    debugLog('deleteItem:error', { filePath, message })
    return { deleted: false, error: message }
  }
})

ipcMain.handle('viewer:show-in-folder', async (_event, filePath: string) => {
  shell.showItemInFolder(filePath)
})

// Middle-drag window move: the renderer only signals start/stop, and the main
// process follows the cursor itself. Renderer mousemove events stall while the
// window is repositioned under a stationary cursor, so polling here is the
// only way to keep the drag smooth.
let windowDragTimer: NodeJS.Timeout | null = null

function stopWindowDrag() {
  if (windowDragTimer === null) return
  clearInterval(windowDragTimer)
  windowDragTimer = null
}

ipcMain.on('viewer:window-drag', (_event, active: boolean) => {
  if (!active) {
    stopWindowDrag()
    return
  }

  if (windowDragTimer !== null || !mainWindow || mainWindow.isDestroyed()) return
  if (mainWindow.isFullScreen() || mainWindow.isMaximized()) return

  const cursorStart = screen.getCursorScreenPoint()
  const [windowStartX, windowStartY] = mainWindow.getPosition()

  windowDragTimer = setInterval(() => {
    if (!mainWindow || mainWindow.isDestroyed()) {
      stopWindowDrag()
      return
    }

    const cursor = screen.getCursorScreenPoint()
    mainWindow.setPosition(
      windowStartX + cursor.x - cursorStart.x,
      windowStartY + cursor.y - cursorStart.y
    )
  }, 16)
})

const thumbnailCache = new Map<string, string | null>()

ipcMain.handle('viewer:get-thumbnail', async (_event, filePath: string) => {
  const cached = thumbnailCache.get(filePath)
  if (cached !== undefined) return cached

  let dataUrl: string | null = null

  try {
    // Windows shell thumbnails: fast, downscaled, and cover videos too.
    const image = await nativeImage.createThumbnailFromPath(path.resolve(filePath), {
      width: 184,
      height: 124,
    })
    dataUrl = image.isEmpty() ? null : image.toDataURL()
  } catch {
    dataUrl = null
  }

  if (thumbnailCache.size > 2000) {
    const oldest = thumbnailCache.keys().next().value
    if (oldest !== undefined) thumbnailCache.delete(oldest)
  }

  thumbnailCache.set(filePath, dataUrl)
  return dataUrl
})

ipcMain.handle('viewer:get-startup-target', async () => {
  const targetPath = getStartupTargetFromArgv()
  if (!targetPath) {
    debugLog('startupTarget:none')
    return null
  }

  try {
    const stat = await fs.stat(targetPath)
    const target = {
      path: targetPath,
      isDirectory: stat.isDirectory(),
    }
    debugLog('startupTarget:found', target)
    return target
  } catch (error) {
    debugLog('startupTarget:error', {
      targetPath,
      error: error instanceof Error ? error.message : String(error),
    })
    return null
  }
})

app.whenReady().then(async () => {
  protocol.handle('media', async (request) => {
    try {
      return await serveMediaFile(request)
    } catch (error) {
      debugLog('media:serve-error', {
        url: request.url,
        error: error instanceof Error ? error.message : String(error),
      })
      return new Response('Not Found', { status: 404 })
    }
  })

  if (debugEnabled) {
    await fs.writeFile(debugLogFilePath, '', 'utf8').catch(() => undefined)
  }
  debugLog('app.whenReady', { argv: process.argv })
  await createWindow()

  app.on('activate', async () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      await createWindow()
    }
  })
})

app.on('second-instance', () => {
  if (!mainWindow) return

  if (mainWindow.isMinimized()) {
    mainWindow.restore()
  }

  mainWindow.focus()
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
