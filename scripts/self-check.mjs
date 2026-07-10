import { spawn } from 'node:child_process'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { deflateSync } from 'node:zlib'
import { createRequire } from 'node:module'
import { _electron as playwrightElectron } from 'playwright-core'

const require = createRequire(import.meta.url)
const electronBinaryPath = require('electron')

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const projectRoot = path.resolve(__dirname, '..')
const outputRoot = path.join(projectRoot, 'output', 'playwright')
const fixtureRoot = path.join(outputRoot, 'sample-media')
const logPath = path.join(projectRoot, 'viewer-debug.log')
const loops = Number(process.env.SELF_CHECK_LOOPS ?? '3')

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function crc32(buffer) {
  let crc = 0xffffffff

  for (const byte of buffer) {
    crc ^= byte

    for (let bit = 0; bit < 8; bit += 1) {
      const mask = -(crc & 1)
      crc = (crc >>> 1) ^ (0xedb88320 & mask)
    }
  }

  return (crc ^ 0xffffffff) >>> 0
}

function makeChunk(type, data) {
  const typeBuffer = Buffer.from(type, 'ascii')
  const lengthBuffer = Buffer.alloc(4)
  lengthBuffer.writeUInt32BE(data.length, 0)

  const crcBuffer = Buffer.alloc(4)
  crcBuffer.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])), 0)

  return Buffer.concat([lengthBuffer, typeBuffer, data, crcBuffer])
}

function createPngBuffer(width, height, rgba) {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8
  ihdr[9] = 6
  ihdr[10] = 0
  ihdr[11] = 0
  ihdr[12] = 0

  const stride = width * 4 + 1
  const raw = Buffer.alloc(stride * height)

  for (let y = 0; y < height; y += 1) {
    const rowOffset = y * stride
    raw[rowOffset] = 0

    for (let x = 0; x < width; x += 1) {
      const pixelOffset = rowOffset + 1 + x * 4
      raw[pixelOffset] = rgba[0]
      raw[pixelOffset + 1] = rgba[1]
      raw[pixelOffset + 2] = rgba[2]
      raw[pixelOffset + 3] = rgba[3]
    }
  }

  return Buffer.concat([
    signature,
    makeChunk('IHDR', ihdr),
    makeChunk('IDAT', deflateSync(raw)),
    makeChunk('IEND', Buffer.alloc(0)),
  ])
}

async function ensureFixtures() {
  await fs.mkdir(fixtureRoot, { recursive: true })

  const fixtureEntries = [
    ['sample-01-red.png', 64, 64, [224, 73, 57, 255]],
    ['sample-02-green.png', 64, 64, [63, 168, 111, 255]],
    ['sample-03-blue.png', 64, 64, [53, 102, 194, 255]],
    ['sample-04-wide.png', 160, 40, [215, 189, 77, 255]],
  ]

  const now = Date.now()
  const filePaths = []

  for (let index = 0; index < fixtureEntries.length; index += 1) {
    const [name, width, height, color] = fixtureEntries[index]
    const filePath = path.join(fixtureRoot, name)
    await fs.writeFile(filePath, createPngBuffer(width, height, color))

    const timestamp = new Date(now + index * 1000)
    await fs.utimes(filePath, timestamp, timestamp)
    filePaths.push(filePath)
  }

  const videoPath = path.join(fixtureRoot, 'sample-05-video.mp4')
  await runCommand(
    'ffmpeg',
    [
      '-y',
      '-f',
      'lavfi',
      '-i',
      'color=c=0x23c8d0:s=160x90:d=1',
      '-an',
      '-c:v',
      'libx264',
      '-pix_fmt',
      'yuv420p',
      videoPath,
    ],
    { stdio: 'ignore' }
  )
  filePaths.push(videoPath)

  return filePaths
}

function runCommand(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: projectRoot,
      env: process.env,
      stdio: 'inherit',
      shell: false,
      ...options,
    })

    child.on('error', reject)
    child.on('exit', (code) => {
      if (code === 0) {
        resolve()
      } else {
        reject(new Error(`${command} ${args.join(' ')} exited with code ${code}`))
      }
    })
  })
}

async function stopExistingViewerProcesses() {
  const command =
    `Get-CimInstance Win32_Process -Filter "Name='electron.exe'" ` +
    `| Where-Object { $_.ExecutablePath -eq '${String(electronBinaryPath).replace(/'/g, "''")}' -and $_.CommandLine -like '*desktop_media_viewer*' } ` +
    `| ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }`

  await runCommand('powershell', ['-Command', command], { stdio: 'ignore' })
}

async function readLogTail(lineCount = 80) {
  try {
    const content = await fs.readFile(logPath, 'utf8')
    return content.split(/\r?\n/).filter(Boolean).slice(-lineCount)
  } catch {
    return []
  }
}

async function waitForState(window, predicate, label, timeoutMs = 10000) {
  const startedAt = Date.now()
  let lastState = null

  while (Date.now() - startedAt < timeoutMs) {
    lastState = await window.evaluate(() => window.__viewerTestApi?.getState() ?? null)
    if (lastState && predicate(lastState)) {
      return lastState
    }

    await wait(100)
  }

  throw new Error(`${label} timed out: ${JSON.stringify(lastState, null, 2)}`)
}

async function simulateDrop(window, filePaths) {
  const input = window.locator('[data-testid="debug-file-input"]')
  await input.setInputFiles(filePaths)

  return await window.evaluate(() => {
    const input = document.querySelector('[data-testid="debug-file-input"]')
    if (!(input instanceof HTMLInputElement) || !input.files?.length) {
      throw new Error('debug-file-input is empty')
    }

    const dataTransfer = new DataTransfer()
    for (const file of Array.from(input.files)) {
      dataTransfer.items.add(file)
    }

    const eventInit = {
      dataTransfer,
      bubbles: true,
      cancelable: true,
    }

    window.dispatchEvent(new DragEvent('dragenter', eventInit))
    window.dispatchEvent(new DragEvent('dragover', eventInit))
    window.dispatchEvent(new DragEvent('drop', eventInit))

    return {
      fileCount: dataTransfer.files.length,
      names: Array.from(dataTransfer.files).map((file) => file.name),
    }
  })
}

async function runLoop(iteration, fixtureFiles) {
  const electronApp = await playwrightElectron.launch({
    executablePath: electronBinaryPath,
    args: ['.'],
    cwd: projectRoot,
    env: {
      ...process.env,
      VIEWER_DEBUG: '1',
      VIEWER_SELF_CHECK: '1',
    },
  })

  const window = await electronApp.firstWindow()
  await window.waitForLoadState('domcontentloaded')
  await waitForState(window, (state) => state.entriesCount === 0, 'initial-empty-state')

  const droppedPath = fixtureFiles[1]
  const directPath = fixtureFiles[3]
  const videoPath = fixtureFiles[4]

  const dropResult = await simulateDrop(window, [droppedPath])
  const openedState = await waitForState(
    window,
    (state) =>
      state.activePath === droppedPath &&
      state.entriesCount === fixtureFiles.length &&
      !state.folderError &&
      !state.itemError,
    'drop-open-state'
  )

  await window.locator('.stage').hover()
  await window.mouse.wheel(0, 240)
  await waitForState(
    window,
    (state) => state.activePath === fixtureFiles[2] && state.currentIndex === 2,
    'wheel-next-state'
  )

  await window.mouse.wheel(0, -240)
  await waitForState(
    window,
    (state) => state.activePath === droppedPath && state.currentIndex === 1,
    'wheel-prev-state'
  )

  await window.keyboard.press('ArrowRight')
  await waitForState(
    window,
    (state) => state.activePath === fixtureFiles[2] && state.currentIndex === 2,
    'arrow-right-state'
  )

  await window.keyboard.press('ArrowLeft')
  await waitForState(
    window,
    (state) => state.activePath === droppedPath && state.currentIndex === 1,
    'arrow-left-state'
  )

  await window.evaluate((filePath) => window.__viewerTestApi?.openPaths([filePath]), directPath)
  const directState = await waitForState(
    window,
    (state) => state.activePath === directPath && !state.folderError && !state.itemError,
    'direct-open-state'
  )

  await window.keyboard.press('h')
  const fitHeightState = await waitForState(
    window,
    (state) =>
      state.fitMode === 'height' &&
      state.imageCanPan === true &&
      state.pan.x === 0 &&
      state.pan.y === 0,
    'fit-height-state'
  )

  const stageBox = await window.locator('.stage').boundingBox()
  if (!stageBox) {
    throw new Error('Stage bounding box was not available')
  }

  await window.mouse.move(stageBox.x + stageBox.width / 2, stageBox.y + stageBox.height / 2)
  await window.mouse.down()
  await window.mouse.move(stageBox.x + stageBox.width / 2 - 120, stageBox.y + stageBox.height / 2)
  await window.mouse.up()
  const fitHeightPanState = await waitForState(
    window,
    (state) => state.fitMode === 'height' && Math.abs(state.pan.x) > 40 && Math.abs(state.pan.y) < 2,
    'fit-height-pan-state'
  )

  await window.keyboard.press('F11')
  await waitForState(window, (state) => state.isFullscreen === true, 'fullscreen-enter-state')

  const fullscreenChromeHidden = await window.evaluate(() => {
    const appShell = document.querySelector('.app-shell')
    const topbar = document.querySelector('.topbar')
    const bottomBar = document.querySelector('.bottom-bar')

    return {
      appShellFullscreen: appShell?.classList.contains('is-fullscreen') ?? false,
      topbarDisplay: topbar ? getComputedStyle(topbar).display : null,
      bottomBarDisplay: bottomBar ? getComputedStyle(bottomBar).display : null,
    }
  })

  if (
    !fullscreenChromeHidden.appShellFullscreen ||
    fullscreenChromeHidden.topbarDisplay !== 'none' ||
    fullscreenChromeHidden.bottomBarDisplay !== 'none'
  ) {
    throw new Error(
      `Fullscreen chrome is still visible: ${JSON.stringify(fullscreenChromeHidden)}`
    )
  }

  await window.keyboard.press('Escape')
  await waitForState(window, (state) => state.isFullscreen === false, 'fullscreen-exit-state')

  await window.evaluate((filePath) => window.__viewerTestApi?.openPaths([filePath]), videoPath)
  await waitForState(
    window,
    (state) => state.activePath === videoPath && !state.loadingItem && !state.itemError,
    'video-open-state'
  )
  const videoLoopEnabled = await window.evaluate(() => {
    const video = document.querySelector('video')
    return video?.loop === true
  })
  if (!videoLoopEnabled) {
    throw new Error('Video loop playback was not enabled')
  }

  await window.keyboard.press('h')
  const videoHeightState = await waitForState(
    window,
    (state) =>
      state.activePath === videoPath &&
      state.fitMode === 'height' &&
      state.naturalSize.width === 160 &&
      state.naturalSize.height === 90 &&
      state.scale > 1,
    'video-fit-height-state'
  )

  await window.locator('.stage').hover()
  await window.mouse.wheel(0, -240)
  const videoWheelPageState = await waitForState(
    window,
    (state) => state.activePath === directPath && state.currentIndex === 3,
    'video-wheel-page-state'
  )

  await window.evaluate((filePath) => window.__viewerTestApi?.openPaths([filePath]), videoPath)
  await waitForState(
    window,
    (state) => state.activePath === videoPath && !state.loadingItem && !state.itemError,
    'video-reopen-state'
  )

  await window.keyboard.press('h')
  const videoZoomStartState = await waitForState(
    window,
    (state) =>
      state.activePath === videoPath &&
      state.fitMode === 'height' &&
      state.naturalSize.width === 160 &&
      state.naturalSize.height === 90 &&
      state.scale > 1,
    'video-zoom-start-state'
  )

  await window.locator('.stage').hover()
  await window.evaluate(() => {
    window.dispatchEvent(new MouseEvent('mousedown', { button: 2, bubbles: true }))
  })
  await waitForState(window, (state) => state.rightButtonDown === true, 'right-button-down-state')
  // Two zoom ticks: the filmstrip shortens the stage, so one tick leaves too
  // little pan headroom for the 90px drag asserted below.
  await window.mouse.wheel(0, -240)
  await wait(120)
  await window.mouse.wheel(0, -240)
  await window.evaluate(() => {
    window.dispatchEvent(new MouseEvent('mouseup', { button: 2, bubbles: true }))
  })
  const videoWheelZoomState = await waitForState(
    window,
    (state) =>
      state.activePath === videoPath &&
      state.fitMode === 'manual' &&
      state.scale > videoZoomStartState.scale,
    'video-wheel-zoom-state'
  )

  const videoBox = await window.locator('.video-pan-layer').boundingBox()
  if (!videoBox) {
    throw new Error('Video pan layer bounding box was not available')
  }

  await window.mouse.move(videoBox.x + videoBox.width / 2, videoBox.y + videoBox.height / 2)
  await window.mouse.down()
  await window.mouse.move(videoBox.x + videoBox.width / 2 - 90, videoBox.y + videoBox.height / 2)
  await window.mouse.up()
  const videoPanState = await waitForState(
    window,
    (state) =>
      state.activePath === videoPath &&
      state.fitMode === 'manual' &&
      state.mediaCanPan === true &&
      Math.abs(state.pan.x) > 40,
    'video-pan-state'
  )

  const zoomButton = window.locator('[data-testid="zoom-actual-button"]')
  const zoomButtonBox = await zoomButton.boundingBox()
  if (!zoomButtonBox) {
    throw new Error('Zoom button bounding box was not available')
  }

  await window.mouse.move(
    zoomButtonBox.x + zoomButtonBox.width / 2,
    zoomButtonBox.y + zoomButtonBox.height / 2
  )
  await window.mouse.down()
  await window.mouse.move(
    zoomButtonBox.x + zoomButtonBox.width / 2 + 90,
    zoomButtonBox.y + zoomButtonBox.height / 2
  )
  await window.mouse.up()
  const zoomButtonDragState = await waitForState(
    window,
    (state) =>
      state.activePath === videoPath &&
      state.fitMode === 'manual' &&
      state.scale > videoWheelZoomState.scale,
    'zoom-button-drag-state'
  )

  await wait(350)
  await zoomButton.click()
  const zoomButtonClickState = await waitForState(
    window,
    (state) =>
      state.activePath === videoPath &&
      state.fitMode === 'manual' &&
      Math.abs(state.scale - 1) < 0.01 &&
      Math.abs(state.pan.x) < 0.01 &&
      Math.abs(state.pan.y) < 0.01,
    'zoom-button-click-state'
  )

  const screenshotPath = path.join(outputRoot, `self-check-loop-${iteration + 1}.png`)
  await window.screenshot({ path: screenshotPath })
  await wait(200)

  const logTail = await readLogTail()
  const errorLines = logTail.filter(
    (line) =>
      line.includes('drop:error') ||
      line.includes('window:error') ||
      line.includes('window:unhandledrejection') ||
      line.includes('loadFolder:error') ||
      line.includes('loadSource:error') ||
      line.includes('Unable to preventDefault inside passive event listener invocation.')
  )

  await electronApp.close()

  return {
    iteration: iteration + 1,
    dropResult,
    openedState,
    directState,
    fitHeightState,
    fitHeightPanState,
    videoLoopEnabled,
    videoHeightState,
    videoWheelPageState,
    videoZoomStartState,
    videoWheelZoomState,
    videoPanState,
    zoomButtonDragState,
    zoomButtonClickState,
    screenshotPath,
    errorLines,
  }
}

async function main() {
  if (!Number.isFinite(loops) || loops < 1) {
    throw new Error(`SELF_CHECK_LOOPS must be a positive number. Received: ${loops}`)
  }

  await fs.mkdir(outputRoot, { recursive: true })
  // Settings are isolated to this file when VIEWER_SELF_CHECK=1; start clean.
  await fs.rm(path.join(projectRoot, 'output', 'viewer-settings.self-check.json'), {
    force: true,
  })
  await stopExistingViewerProcesses()
  await runCommand('cmd', ['/c', 'npm', 'run', 'build'])
  const fixtureFiles = await ensureFixtures()

  console.log(`[self-check] fixtures: ${fixtureFiles.join(', ')}`)
  console.log(`[self-check] loops: ${loops}`)

  const results = []
  for (let index = 0; index < loops; index += 1) {
    console.log(`[self-check] loop ${index + 1}/${loops} start`)
    await stopExistingViewerProcesses()
    const result = await runLoop(index, fixtureFiles)
    results.push(result)

    if (result.errorLines.length) {
      throw new Error(
        `Loop ${result.iteration} reported renderer errors:\n${result.errorLines.join('\n')}`
      )
    }

    console.log(
      `[self-check] loop ${result.iteration} ok: active=${result.directState.activePath} screenshot=${result.screenshotPath}`
    )
  }

  const summaryPath = path.join(outputRoot, 'self-check-summary.json')
  await fs.writeFile(summaryPath, `${JSON.stringify(results, null, 2)}\n`, 'utf8')
  await stopExistingViewerProcesses()
  console.log(`[self-check] summary written: ${summaryPath}`)
  process.exit(0)
}

main().catch(async (error) => {
  console.error('[self-check] failed')
  console.error(error instanceof Error ? error.stack ?? error.message : String(error))

  const logTail = await readLogTail()
  if (logTail.length) {
    console.error('[self-check] viewer-debug.log tail')
    console.error(logTail.join('\n'))
  }

  await stopExistingViewerProcesses()
  process.exitCode = 1
})
