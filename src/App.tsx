import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react'
import './App.css'

type SortField = 'name' | 'dateTaken' | 'created' | 'modified'
type SortDirection = 'asc' | 'desc'
type FitMode = 'contain' | 'height' | 'manual'

type DisplaySource = {
  url: string
  kind: MediaKind
  mimeType: string
}

type Point = {
  x: number
  y: number
}

type FileWithPath = File & {
  path?: string
}

type DropDebugInfo = {
  types: string[]
  fileCount: number
  itemCount: number
}

const collator = new Intl.Collator('ja-JP', {
  numeric: true,
  sensitivity: 'base',
})

// Extensions the browser can't render directly; the filmstrip shows a label instead.
const nonRenderableImageExtensions = new Set(['.heic', '.heif', '.psd'])

// Thumb width (92px) + flex gap (6px); keep in sync with .thumb / .filmstrip CSS.
const THUMB_STRIDE = 98
const THUMB_OVERSCAN = 6

const thumbnailUrlCache = new Map<string, string | null>()

function FilmstripThumb({
  entry,
  isActive,
  onSelect,
}: {
  entry: ViewerEntry
  isActive: boolean
  onSelect: () => void
}) {
  const [thumbUrl, setThumbUrl] = useState<string | null>(
    () => thumbnailUrlCache.get(entry.path) ?? null
  )

  useEffect(() => {
    const cached = thumbnailUrlCache.get(entry.path)
    if (cached !== undefined) {
      setThumbUrl(cached)
      return
    }

    let disposed = false

    void window.viewerApi
      .getThumbnail(entry.path)
      .then((url) => {
        thumbnailUrlCache.set(entry.path, url)
        if (!disposed) setThumbUrl(url)
      })
      .catch(() => undefined)

    return () => {
      disposed = true
    }
  }, [entry.path])

  // Fall back to the full image when the OS could not produce a thumbnail.
  const fallbackUrl =
    entry.kind === 'image' && !nonRenderableImageExtensions.has(entry.ext)
      ? window.viewerApi.getMediaUrl(entry.path)
      : null
  const imageUrl = thumbUrl ?? fallbackUrl

  return (
    <button
      className={isActive ? 'thumb active' : 'thumb'}
      data-active={isActive || undefined}
      title={entry.name}
      onClick={onSelect}
    >
      {imageUrl ? (
        <img src={imageUrl} alt="" loading="lazy" decoding="async" draggable={false} />
      ) : (
        <span className="thumb-icon">
          {entry.kind === 'video' ? '▶' : entry.kind === 'audio' ? '♪' : entry.ext.slice(1).toUpperCase()}
        </span>
      )}
      <span className="thumb-name">{entry.name}</span>
    </button>
  )
}

const supportedDropExtensions = new Set([
  '.avif',
  '.gif',
  '.heic',
  '.heif',
  '.jfif',
  '.jpeg',
  '.jpg',
  '.mkv',
  '.mov',
  '.mp3',
  '.mp4',
  '.png',
  '.psd',
  '.wav',
  '.webm',
  '.webp',
])

let heicModulePromise: Promise<typeof import('heic2any')> | null = null
let psdModulePromise: Promise<typeof import('ag-psd')> | null = null

function debugLog(message: string, data?: unknown) {
  if (!window.viewerApi?.debugEnabled) return
  window.viewerApi.debugLog(message, data)
}

type UiLanguage = 'en' | 'ja'

const enStrings = {
  fullscreenTitle: 'Fullscreen (F)',
  fullscreenAria: 'Fullscreen',
  fit: 'Fit',
  fitTitle: 'Fit to window (0)',
  fitHeight: 'Fit Height',
  fitHeightTitle: 'Fit to height (H)',
  zoomTitle: 'Click for 100%, drag to zoom',
  sortName: 'Name',
  sortDateTaken: 'Date Taken',
  sortCreated: 'Created',
  sortModified: 'Modified',
  asc: 'Asc',
  desc: 'Desc',
  hideThumbs: 'Hide Thumbs',
  thumbs: 'Thumbs',
  thumbsTitle: 'Toggle thumbnails (T)',
  explorerTitle: 'Show in Explorer (E)',
  explorerAria: 'Show in Explorer',
  settings: 'Settings',
  autoplayVideo: 'Autoplay video',
  autoplayAudio: 'Autoplay audio',
  showFilename: 'Show filename',
  japaneseUi: 'Japanese labels',
  kindImage: 'Image',
  kindVideo: 'Video',
  kindAudio: 'Audio',
  shot: 'Shot',
  prev: 'Previous',
  next: 'Next',
  controls: 'Controls',
  showControlsTitle: 'Show controls (C)',
  hideControlsTitle: 'Hide controls (C)',
  hideControlsAria: 'Hide controls',
  dragMove: 'Drag to move',
  frameBack: 'Frame back (,)',
  frameBackAria: 'Frame back',
  frameForward: 'Frame forward (.)',
  frameForwardAria: 'Frame forward',
  play: 'Play',
  pause: 'Pause',
  mute: 'Mute',
  unmute: 'Unmute',
  seek: 'Seek',
  volume: 'Volume',
}

const jaStrings: typeof enStrings = {
  fullscreenTitle: '\u5168\u753b\u9762 (F)',
  fullscreenAria: '\u5168\u753b\u9762',
  fit: '\u5168\u4f53\u8868\u793a',
  fitTitle: '\u5168\u4f53\u8868\u793a (0)',
  fitHeight: '\u9ad8\u3055\u5408\u308f\u305b',
  fitHeightTitle: '\u9ad8\u3055\u5408\u308f\u305b (H)',
  zoomTitle: '\u30af\u30ea\u30c3\u30af\u3067100%\u3001\u5de6\u53f3\u30c9\u30e9\u30c3\u30b0\u3067\u30ba\u30fc\u30e0',
  sortName: '\u30d5\u30a1\u30a4\u30eb\u540d\u9806',
  sortDateTaken: '\u64ae\u5f71\u65e5\u6642\u9806',
  sortCreated: '\u4f5c\u6210\u65e5\u6642\u9806',
  sortModified: '\u66f4\u65b0\u65e5\u6642\u9806',
  asc: '\u6607\u9806',
  desc: '\u964d\u9806',
  hideThumbs: '\u4e00\u89a7\u3092\u96a0\u3059',
  thumbs: '\u4e00\u89a7',
  thumbsTitle: '\u30b5\u30e0\u30cd\u30a4\u30eb\u4e00\u89a7\u306e\u8868\u793a\u5207\u66ff (T)',
  explorerTitle: '\u30a8\u30af\u30b9\u30d7\u30ed\u30fc\u30e9\u30fc\u3067\u30d5\u30a1\u30a4\u30eb\u306e\u5834\u6240\u3092\u958b\u304f (E)',
  explorerAria: '\u30a8\u30af\u30b9\u30d7\u30ed\u30fc\u30e9\u30fc\u3067\u30d5\u30a1\u30a4\u30eb\u306e\u5834\u6240\u3092\u958b\u304f',
  settings: '\u8a2d\u5b9a',
  autoplayVideo: '\u52d5\u753b\u3092\u81ea\u52d5\u518d\u751f',
  autoplayAudio: '\u97f3\u58f0\u3092\u81ea\u52d5\u518d\u751f',
  showFilename: '\u30d5\u30a1\u30a4\u30eb\u540d\u3092\u8868\u793a',
  japaneseUi: '\u65e5\u672c\u8a9e\u8868\u793a',
  kindImage: '\u753b\u50cf',
  kindVideo: '\u52d5\u753b',
  kindAudio: '\u97f3\u58f0',
  shot: '\u64ae\u5f71',
  prev: '\u524d\u3078',
  next: '\u6b21\u3078',
  controls: '\u30b3\u30f3\u30c8\u30ed\u30fc\u30eb',
  showControlsTitle: '\u30b3\u30f3\u30c8\u30ed\u30fc\u30eb\u3092\u8868\u793a (C)',
  hideControlsTitle: '\u30b3\u30f3\u30c8\u30ed\u30fc\u30eb\u3092\u96a0\u3059 (C)',
  hideControlsAria: '\u30b3\u30f3\u30c8\u30ed\u30fc\u30eb\u3092\u96a0\u3059',
  dragMove: '\u30c9\u30e9\u30c3\u30b0\u3067\u30d0\u30fc\u3092\u79fb\u52d5',
  frameBack: '1\u30b3\u30de\u623b\u308b (,)',
  frameBackAria: '1\u30b3\u30de\u623b\u308b',
  frameForward: '1\u30b3\u30de\u9032\u3080 (.)',
  frameForwardAria: '1\u30b3\u30de\u9032\u3080',
  play: '\u518d\u751f',
  pause: '\u4e00\u6642\u505c\u6b62',
  mute: '\u30df\u30e5\u30fc\u30c8',
  unmute: '\u30df\u30e5\u30fc\u30c8\u89e3\u9664',
  seek: '\u518d\u751f\u4f4d\u7f6e',
  volume: '\u97f3\u91cf',
}

const uiStrings: Record<UiLanguage, typeof enStrings> = { en: enStrings, ja: jaStrings }

function mediaKindLabel(kind: MediaKind, lang: UiLanguage) {
  const t = uiStrings[lang]
  if (kind === 'image') return t.kindImage
  if (kind === 'video') return t.kindVideo
  return t.kindAudio
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value))
}

function samePoint(left: Point, right: Point) {
  return left.x === right.x && left.y === right.y
}

function formatTimestamp(value: number | null) {
  if (!value) return '—'

  return new Intl.DateTimeFormat('ja-JP', {
    dateStyle: 'medium',
    timeStyle: 'medium',
  }).format(value)
}

function formatDuration(seconds: number) {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00'

  const total = Math.floor(seconds)
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  const secs = total % 60

  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`
    : `${minutes}:${String(secs).padStart(2, '0')}`
}

function formatFileSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`

  const units = ['KB', 'MB', 'GB', 'TB']
  let size = bytes / 1024
  let unitIndex = 0

  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024
    unitIndex += 1
  }

  return `${size.toFixed(size >= 10 ? 1 : 2)} ${units[unitIndex]}`
}

function isEditableTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false

  return (
    target.tagName === 'INPUT' ||
    target.tagName === 'SELECT' ||
    target.tagName === 'TEXTAREA' ||
    target.isContentEditable
  )
}

function hasFilePayload(event: DragEvent) {
  return Array.from(event.dataTransfer?.types ?? []).includes('Files')
}

function getFileExtension(filePath: string) {
  const dotIndex = filePath.lastIndexOf('.')
  return dotIndex >= 0 ? filePath.slice(dotIndex).toLowerCase() : ''
}

function isSupportedDropPath(filePath: string) {
  return supportedDropExtensions.has(getFileExtension(filePath))
}

function extractParentFolder(filePath: string) {
  const normalized = filePath.replace(/[\\/]+$/, '')
  const separatorIndex = Math.max(normalized.lastIndexOf('\\'), normalized.lastIndexOf('/'))
  return separatorIndex >= 0 ? normalized.slice(0, separatorIndex) : normalized
}

function getFilePath(file: File) {
  try {
    const bridgedPath = window.viewerApi?.getPathForFile(file)
    if (bridgedPath) return bridgedPath
  } catch (error) {
    debugLog('drop:getPathForFile:error', {
      name: file.name,
      error: error instanceof Error ? error.message : String(error),
    })
  }

  return (file as FileWithPath).path ?? ''
}

async function getDroppedPaths(dataTransfer: DataTransfer | null) {
  if (!dataTransfer) return []

  const resolved: Array<{ name: string; path: string }> = []
  const pushFile = (file: File | null) => {
    if (!file) return
    resolved.push({ name: file.name, path: getFilePath(file) })
  }

  const items = Array.from(dataTransfer.items ?? [])
  if (items.length) {
    for (const item of items) {
      if (item.kind === 'file') pushFile(item.getAsFile())
    }
  }

  if (!resolved.length) {
    for (const file of Array.from(dataTransfer.files)) {
      pushFile(file)
    }
  }

  debugLog('drop:files', resolved)
  return [...new Set(resolved.map((item) => item.path).filter(Boolean))]
}

function getDropDebugInfo(dataTransfer: DataTransfer | null): DropDebugInfo {
  return {
    types: Array.from(dataTransfer?.types ?? []),
    fileCount: dataTransfer?.files.length ?? 0,
    itemCount: dataTransfer?.items.length ?? 0,
  }
}

function localizeFolderError(message: string) {
  if (message === 'Failed to open folder.') {
    return 'フォルダを開けませんでした。'
  }

  return message
}

function localizeItemError(message: string) {
  if (message === 'Failed to load this file.') {
    return 'このファイルを読み込めませんでした。'
  }

  if (message === 'PSD composite preview was not found.') {
    return 'PSD の統合画像が見つかりませんでした。'
  }

  if (message.startsWith('Unsupported file extension:')) {
    return '未対応のファイル形式です。'
  }

  return message
}

function bytesToArrayBuffer(bytes: Uint8Array) {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
}

async function blobToDataUrl(blob: Blob) {
  return await new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(reader.error ?? new Error('Failed to read Blob.'))
    reader.readAsDataURL(blob)
  })
}

async function decodeHeicToUrl(bytes: Uint8Array) {
  heicModulePromise ??= import('heic2any')
  const module = await heicModulePromise
  const heic2any = module.default

  const output = await heic2any({
    blob: new Blob([bytesToArrayBuffer(bytes)], { type: 'image/heic' }),
    toType: 'image/jpeg',
    quality: 0.92,
  })

  return await blobToDataUrl(Array.isArray(output) ? output[0] : output)
}

async function decodePsdToUrl(bytes: Uint8Array) {
  psdModulePromise ??= import('ag-psd')
  const module = await psdModulePromise
  const psd = module.readPsd(bytesToArrayBuffer(bytes))

  if (!psd.canvas) {
    throw new Error('PSD composite preview was not found.')
  }

  return psd.canvas.toDataURL('image/png')
}

function sortEntries(entries: ViewerEntry[], field: SortField, direction: SortDirection) {
  const sorted = [...entries]

  sorted.sort((left, right) => {
    let result = 0

    if (field === 'name') {
      result = collator.compare(left.name, right.name)
    } else if (field === 'dateTaken') {
      const leftValue = left.dateTakenAt ?? left.createdAt
      const rightValue = right.dateTakenAt ?? right.createdAt
      result =
        leftValue === rightValue
          ? collator.compare(left.name, right.name)
          : leftValue - rightValue
    } else if (field === 'created') {
      result =
        left.createdAt === right.createdAt
          ? collator.compare(left.name, right.name)
          : left.createdAt - right.createdAt
    } else {
      result =
        left.modifiedAt === right.modifiedAt
          ? collator.compare(left.name, right.name)
          : left.modifiedAt - right.modifiedAt
    }

    return direction === 'asc' ? result : result * -1
  })

  return sorted
}

export default function App() {
  const [folderPath, setFolderPath] = useState<string | null>(null)
  const [entries, setEntries] = useState<ViewerEntry[]>([])
  const [activePath, setActivePath] = useState<string | null>(null)
  const [sortField, setSortField] = useState<SortField>('name')
  const [sortDirection, setSortDirection] = useState<SortDirection>('asc')
  const [loadingFolder, setLoadingFolder] = useState(false)
  const [loadingItem, setLoadingItem] = useState(false)
  const [folderError, setFolderError] = useState<string | null>(null)
  const [itemError, setItemError] = useState<string | null>(null)
  const [displaySource, setDisplaySource] = useState<DisplaySource | null>(null)
  const [motionAutoplay, setMotionAutoplay] = useState(true)
  const [audioAutoplay, setAudioAutoplay] = useState(true)
  const [fitMode, setFitMode] = useState<FitMode>('contain')
  const [manualScale, setManualScale] = useState(1)
  const [pan, setPan] = useState<Point>({ x: 0, y: 0 })
  const [viewportSize, setViewportSize] = useState({ width: 1, height: 1 })
  const [naturalSize, setNaturalSize] = useState({ width: 1, height: 1 })
  const [dateTakenHydratedFolder, setDateTakenHydratedFolder] = useState<string | null>(null)
  const [dropActive, setDropActive] = useState(false)
  const [isFullscreen, setIsFullscreen] = useState(false)
  const [isPanning, setIsPanning] = useState(false)
  const [isZoomDragging, setIsZoomDragging] = useState(false)
  const [isVideoPlaying, setIsVideoPlaying] = useState(false)
  const [videoTime, setVideoTime] = useState(0)
  const [videoDuration, setVideoDuration] = useState(0)
  const [videoMuted, setVideoMuted] = useState(false)
  const [videoVolume, setVideoVolume] = useState(1)
  const [controlsIdle, setControlsIdle] = useState(false)
  const [controlsHovered, setControlsHovered] = useState(false)
  const [filmstripVisible, setFilmstripVisible] = useState(true)
  const [fileBadgeVisible, setFileBadgeVisible] = useState(true)
  const [videoBarHidden, setVideoBarHidden] = useState(false)
  const [videoBarWidth, setVideoBarWidth] = useState<number | null>(null)
  const [videoBarPos, setVideoBarPos] = useState<Point>({ x: 0, y: 0 })
  const [stripViewport, setStripViewport] = useState({ left: 0, width: 0 })
  const [settingsMenuOpen, setSettingsMenuOpen] = useState(false)
  const [settingsMenuLeft, setSettingsMenuLeft] = useState(0)
  const [uiLanguage, setUiLanguage] = useState<UiLanguage>('en')

  const videoRef = useRef<HTMLVideoElement | null>(null)
  const settingsMenuRef = useRef<HTMLDivElement | null>(null)
  const settingsButtonRef = useRef<HTMLButtonElement | null>(null)
  const seekScrubbingRef = useRef(false)
  const controlsIdleTimerRef = useRef<number | null>(null)
  const filmstripRef = useRef<HTMLDivElement | null>(null)
  const settingsReadyRef = useRef(false)
  const deletingRef = useRef(false)
  const dateTakenHydratingRef = useRef<string | null>(null)
  const barDragRef = useRef<{ pointerId: number; startX: number; startY: number; originPos: Point } | null>(null)
  const barResizeRef = useRef<{ pointerId: number; startX: number; startWidth: number } | null>(null)
  const stripDragRef = useRef<{
    pointerId: number
    startX: number
    startScrollLeft: number
    didDrag: boolean
  } | null>(null)
  const [isStripDragging, setIsStripDragging] = useState(false)
  const stageRef = useRef<HTMLDivElement | null>(null)
  const dragDepthRef = useRef(0)
  const wheelDeltaRef = useRef(0)
  const wheelLastTriggerAtRef = useRef(0)
  const wheelLastDirectionRef = useRef<0 | 1 | -1>(0)
  const rightButtonDownRef = useRef(false)
  const zoomControlDragRef = useRef<{
    didDrag: boolean
    pointerId: number
    startScale: number
    startX: number
  } | null>(null)
  const zoomDragEndedAtRef = useRef(0)
  const dragStateRef = useRef<{
    originPan: Point
    pointerStart: Point
    pointerId: number
  } | null>(null)
  const sourceCacheRef = useRef(new Map<string, DisplaySource>())

  const t = uiStrings[uiLanguage]

  const sortedEntries = useMemo(
    () => sortEntries(entries, sortField, sortDirection),
    [entries, sortField, sortDirection]
  )
  const currentIndex = sortedEntries.findIndex((entry) => entry.path === activePath)
  const currentEntry = currentIndex >= 0 ? sortedEntries[currentIndex] : null
  const isScalableMedia = currentEntry?.kind === 'image' || currentEntry?.kind === 'video'
  const containScale =
    isScalableMedia && naturalSize.width > 1 && naturalSize.height > 1
      ? Math.min(viewportSize.width / naturalSize.width, viewportSize.height / naturalSize.height)
      : 1
  const heightScale =
    isScalableMedia && naturalSize.height > 1
      ? viewportSize.height / naturalSize.height
      : 1
  const fitScale = fitMode === 'height' ? heightScale : containScale
  const scale = isScalableMedia ? (fitMode === 'manual' ? manualScale : fitScale) : 1
  const mediaCanPan =
    isScalableMedia &&
    (naturalSize.width * scale > viewportSize.width + 1 ||
      naturalSize.height * scale > viewportSize.height + 1)
  const imageCanPan = currentEntry?.kind === 'image' ? mediaCanPan : false

  function clampPan(nextPan: Point, nextScale: number) {
    if (!currentEntry || !isScalableMedia) {
      return { x: 0, y: 0 }
    }

    const scaledWidth = naturalSize.width * nextScale
    const scaledHeight = naturalSize.height * nextScale
    const limitX = Math.max(0, (scaledWidth - viewportSize.width) / 2)
    const limitY = Math.max(0, (scaledHeight - viewportSize.height) / 2)

    return {
      x: clamp(nextPan.x, -limitX, limitX),
      y: clamp(nextPan.y, -limitY, limitY),
    }
  }

  function rememberSource(key: string, source: DisplaySource) {
    const cache = sourceCacheRef.current
    cache.delete(key)
    cache.set(key, source)

    const maxEntries = 80
    // HEIC/PSD decode results are base64 data URLs and can be tens of MB each,
    // so cap their total footprint separately from the entry count.
    const maxDataUrlBytes = 192 * 1024 * 1024

    let dataUrlBytes = 0
    for (const value of cache.values()) {
      if (value.url.startsWith('data:')) dataUrlBytes += value.url.length
    }

    for (const oldestKey of cache.keys()) {
      if (cache.size <= maxEntries && dataUrlBytes <= maxDataUrlBytes) break
      if (oldestKey === key) break

      const evicted = cache.get(oldestKey)
      cache.delete(oldestKey)
      if (evicted?.url.startsWith('data:')) dataUrlBytes -= evicted.url.length
    }
  }

  function toggleVideoPlayback() {
    const video = videoRef.current
    if (!video) return

    if (video.paused) {
      void video.play().catch(() => undefined)
    } else {
      video.pause()
    }
  }

  function seekVideo(nextTime: number) {
    const video = videoRef.current
    if (!video || !Number.isFinite(video.duration)) return

    video.currentTime = clamp(nextTime, 0, video.duration)
    setVideoTime(video.currentTime)
  }

  function stepVideoFrame(direction: 1 | -1) {
    const video = videoRef.current
    if (!video) return

    video.pause()
    // Frame rate is not exposed by the media element; 1/30s covers typical footage.
    const frameDuration = 1 / 30
    const duration = Number.isFinite(video.duration) ? video.duration : 0
    video.currentTime = clamp(video.currentTime + direction * frameDuration, 0, duration)
    setVideoTime(video.currentTime)
  }

  function getVideoBarWidth() {
    const fallback = Math.min(viewportSize.width * 0.92, 760)
    return videoBarWidth === null
      ? fallback
      : clamp(videoBarWidth, 320, Math.max(320, viewportSize.width - 24))
  }

  function clampBarPos(next: Point): Point {
    const barWidth = getVideoBarWidth()
    const limitX = Math.max(0, (viewportSize.width - barWidth) / 2 - 4)
    return {
      x: clamp(next.x, -limitX, limitX),
      y: clamp(next.y, -(viewportSize.height - 84), 0),
    }
  }

  function handleBarGripPointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    if (event.button !== 0) return
    event.preventDefault()
    event.stopPropagation()
    barDragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      originPos: videoBarPos,
    }
    event.currentTarget.setPointerCapture(event.pointerId)
  }

  function handleBarGripPointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    const dragState = barDragRef.current
    if (!dragState || dragState.pointerId !== event.pointerId) return

    event.preventDefault()
    setVideoBarPos(
      clampBarPos({
        x: dragState.originPos.x + event.clientX - dragState.startX,
        y: dragState.originPos.y + event.clientY - dragState.startY,
      })
    )
  }

  function handleBarGripPointerUp(event: ReactPointerEvent<HTMLDivElement>) {
    const dragState = barDragRef.current
    if (!dragState || dragState.pointerId !== event.pointerId) return

    barDragRef.current = null
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
  }

  function handleBarResizePointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    if (event.button !== 0) return
    event.preventDefault()
    event.stopPropagation()
    barResizeRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startWidth: event.currentTarget.parentElement?.offsetWidth ?? getVideoBarWidth(),
    }
    event.currentTarget.setPointerCapture(event.pointerId)
  }

  function handleBarResizePointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    const resizeState = barResizeRef.current
    if (!resizeState || resizeState.pointerId !== event.pointerId) return

    event.preventDefault()
    const nextWidth = clamp(
      resizeState.startWidth + (event.clientX - resizeState.startX),
      320,
      Math.max(320, viewportSize.width - 24)
    )
    setVideoBarWidth(nextWidth)
    // Clamp against the new width directly; state still holds the previous one.
    const limitX = Math.max(0, (viewportSize.width - nextWidth) / 2 - 4)
    setVideoBarPos((current) => ({
      x: clamp(current.x, -limitX, limitX),
      y: clamp(current.y, -(viewportSize.height - 84), 0),
    }))
  }

  function handleBarResizePointerUp(event: ReactPointerEvent<HTMLDivElement>) {
    const resizeState = barResizeRef.current
    if (!resizeState || resizeState.pointerId !== event.pointerId) return

    barResizeRef.current = null
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
  }

  function handleStripPointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    if (event.button !== 0) return
    stripDragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startScrollLeft: event.currentTarget.scrollLeft,
      didDrag: false,
    }
  }

  function handleStripPointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    const dragState = stripDragRef.current
    if (!dragState || dragState.pointerId !== event.pointerId) return

    const deltaX = event.clientX - dragState.startX
    if (!dragState.didDrag && Math.abs(deltaX) < 5) return

    if (!dragState.didDrag) {
      dragState.didDrag = true
      setIsStripDragging(true)
      event.currentTarget.setPointerCapture(event.pointerId)
    }

    event.preventDefault()
    event.currentTarget.scrollLeft = dragState.startScrollLeft - deltaX
  }

  function handleStripPointerUp(event: ReactPointerEvent<HTMLDivElement>) {
    const dragState = stripDragRef.current
    if (!dragState || dragState.pointerId !== event.pointerId) return

    setIsStripDragging(false)
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }

    // Keep the state around when a drag happened so the click-capture handler
    // can swallow the click the browser fires right after pointerup.
    if (!dragState.didDrag) {
      stripDragRef.current = null
    }
  }

  function handleStripClickCapture(event: ReactMouseEvent<HTMLDivElement>) {
    if (stripDragRef.current?.didDrag) {
      event.preventDefault()
      event.stopPropagation()
      stripDragRef.current = null
    }
  }

  function changeVideoVolume(nextVolume: number) {
    const video = videoRef.current
    const clamped = clamp(nextVolume, 0, 1)

    setVideoVolume(clamped)
    setVideoMuted(clamped === 0)

    if (video) {
      video.volume = clamped
      video.muted = clamped === 0
    }
  }

  function toggleVideoMute() {
    const video = videoRef.current
    const shouldMute = !(videoMuted || videoVolume === 0)

    if (shouldMute) {
      setVideoMuted(true)
      if (video) video.muted = true
      return
    }

    const restoredVolume = videoVolume > 0 ? videoVolume : 0.5
    setVideoMuted(false)
    setVideoVolume(restoredVolume)

    if (video) {
      video.muted = false
      video.volume = restoredVolume
    }
  }

  async function loadFolder(
    nextFolder: string,
    preferredPath?: string | null,
    includeDateTaken?: boolean
  ) {
    debugLog('loadFolder:request', { nextFolder, preferredPath, includeDateTaken })
    setLoadingFolder(true)
    setFolderError(null)

    try {
      const nextEntries = await window.viewerApi.listFolder(nextFolder, {
        includeDateTaken,
      })

      debugLog('loadFolder:result', {
        nextFolder,
        preferredPath,
        count: nextEntries.length,
        firstEntry: nextEntries[0]?.path ?? null,
      })

      setFolderPath(nextFolder)
      setEntries(nextEntries)
      setActivePath((current) => {
        const candidate = preferredPath ?? current
        if (candidate && nextEntries.some((entry) => entry.path === candidate)) {
          return candidate
        }

        return nextEntries[0]?.path ?? null
      })

      if (includeDateTaken) {
        setDateTakenHydratedFolder(nextFolder)
      } else if (dateTakenHydratedFolder !== nextFolder) {
        setDateTakenHydratedFolder(null)
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to open folder.'
      debugLog('loadFolder:error', { nextFolder, message })
      setFolderError(localizeFolderError(message))
    } finally {
      setLoadingFolder(false)
    }
  }

  async function handleOpenFolder() {
    const nextFolder = await window.viewerApi.selectFolder()
    if (!nextFolder) return

    sourceCacheRef.current.clear()
    setDisplaySource(null)
    setItemError(null)
    await loadFolder(nextFolder, null, sortField === 'dateTaken')
  }

  async function handleDroppedPaths(paths: string[]) {
    dragDepthRef.current = 0
    setDropActive(false)
    debugLog('drop:paths', paths)

    const supportedPaths = paths.filter(isSupportedDropPath)
    if (!supportedPaths.length) {
      setFolderError(
        '対応ファイルを認識できませんでした。画像・動画・音声ファイルをドロップしてください。'
      )
      debugLog('drop:no-supported-paths')
      return
    }

    const firstPath = supportedPaths[0]
    const nextFolder = extractParentFolder(firstPath)
    debugLog('drop:open-target', { firstPath, nextFolder })

    sourceCacheRef.current.clear()
    setDisplaySource(null)
    setItemError(null)
    await loadFolder(nextFolder, firstPath, sortField === 'dateTaken')
  }

  async function handleDeleteCurrent() {
    if (!currentEntry || deletingRef.current) return

    const entry = currentEntry
    deletingRef.current = true

    try {
      const result = await window.viewerApi.deleteItem(entry.path)
      if (!result.deleted) {
        if (result.error) {
          setItemError('ファイルをごみ箱に移動できませんでした。')
        }
        return
      }

      sourceCacheRef.current.delete(entry.path)
      const nextEntry = sortedEntries[currentIndex + 1] ?? sortedEntries[currentIndex - 1] ?? null
      setEntries((previous) => previous.filter((item) => item.path !== entry.path))
      setActivePath(nextEntry?.path ?? null)
    } finally {
      deletingRef.current = false
    }
  }

  function handleShowInFolder() {
    if (!currentEntry) return
    void window.viewerApi.showInFolder(currentEntry.path)
  }

  function toggleSettingsMenu() {
    if (settingsMenuOpen) {
      setSettingsMenuOpen(false)
      return
    }

    const rect = settingsButtonRef.current?.getBoundingClientRect()
    if (rect) {
      setSettingsMenuLeft(clamp(rect.left, 8, Math.max(8, window.innerWidth - 240)))
    }
    setSettingsMenuOpen(true)
  }

  function goToIndex(index: number) {
    const nextEntry = sortedEntries[index]
    if (!nextEntry) return
    setActivePath(nextEntry.path)
  }

  function goToRelative(offset: number) {
    if (!sortedEntries.length) return
    const baseIndex = currentIndex >= 0 ? currentIndex : 0
    const nextIndex = clamp(baseIndex + offset, 0, sortedEntries.length - 1)
    goToIndex(nextIndex)
  }

  function zoomTo(nextScale: number) {
    const clampedScale = clamp(nextScale, 0.05, 12)
    setFitMode('manual')
    setManualScale(clampedScale)
    setPan((current) => clampPan(current, clampedScale))
  }

  function zoomBy(multiplier: number) {
    if (!currentEntry || !isScalableMedia) return
    const originScale = fitMode === 'manual' ? manualScale : fitScale
    zoomTo(originScale * multiplier)
  }

  function handleZoomControlPointerDown(event: ReactPointerEvent<HTMLButtonElement>) {
    if (!currentEntry || !isScalableMedia || event.button !== 0) return

    zoomControlDragRef.current = {
      didDrag: false,
      pointerId: event.pointerId,
      startScale: fitMode === 'manual' ? manualScale : fitScale,
      startX: event.clientX,
    }
    setIsZoomDragging(true)
    event.currentTarget.setPointerCapture(event.pointerId)
  }

  function handleZoomControlPointerMove(event: ReactPointerEvent<HTMLButtonElement>) {
    const dragState = zoomControlDragRef.current
    if (!dragState || dragState.pointerId !== event.pointerId) return

    const deltaX = event.clientX - dragState.startX
    if (Math.abs(deltaX) < 3) return

    dragState.didDrag = true
    event.preventDefault()
    zoomTo(dragState.startScale * Math.pow(2, deltaX / 240))
  }

  function endZoomControlDrag(event: ReactPointerEvent<HTMLButtonElement>) {
    const dragState = zoomControlDragRef.current
    if (!dragState || dragState.pointerId !== event.pointerId) return

    zoomControlDragRef.current = null
    setIsZoomDragging(false)
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }

    if (dragState.didDrag) {
      zoomDragEndedAtRef.current = Date.now()
      event.preventDefault()
    }
  }

  function handleZoomControlClick(event: ReactMouseEvent<HTMLButtonElement>) {
    if (Date.now() - zoomDragEndedAtRef.current < 300) {
      event.preventDefault()
      return
    }

    setActualSize()
  }

  function resetToFit() {
    setFitMode('contain')
    setPan({ x: 0, y: 0 })
  }

  function fitToHeight() {
    setFitMode('height')
    setPan({ x: 0, y: 0 })
  }

  function setActualSize() {
    setFitMode('manual')
    setManualScale(1)
    setPan(clampPan({ x: 0, y: 0 }, 1))
  }

  useEffect(() => {
    debugLog('renderer:mounted')

    if (!stageRef.current) return

    const observer = new ResizeObserver((resizeEntries) => {
      const entry = resizeEntries[0]
      if (!entry) return

      setViewportSize({
        width: Math.max(1, entry.contentRect.width),
        height: Math.max(1, entry.contentRect.height),
      })
    })

    observer.observe(stageRef.current)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    if (!window.viewerApi) return

    let disposed = false
    const removeListener = window.viewerApi.onFullscreenChange((nextValue) => {
      setIsFullscreen(nextValue)
    })

    void window.viewerApi.getFullscreen().then((nextValue) => {
      if (!disposed) setIsFullscreen(nextValue)
    })

    return () => {
      disposed = true
      removeListener()
    }
  }, [])

  useEffect(() => {
    if (!window.viewerApi) return

    let cancelled = false

    void window.viewerApi
      .getSettings()
      .then((settings) => {
        if (cancelled || !settings) return

        if (settings.sortField) setSortField(settings.sortField)
        if (settings.sortDirection) setSortDirection(settings.sortDirection)
        if (typeof settings.motionAutoplay === 'boolean') setMotionAutoplay(settings.motionAutoplay)
        if (typeof settings.audioAutoplay === 'boolean') setAudioAutoplay(settings.audioAutoplay)
        if (typeof settings.videoVolume === 'number') {
          setVideoVolume(clamp(settings.videoVolume, 0, 1))
        }
        if (typeof settings.videoMuted === 'boolean') setVideoMuted(settings.videoMuted)
        if (typeof settings.filmstripVisible === 'boolean') {
          setFilmstripVisible(settings.filmstripVisible)
        }
        if (typeof settings.fileBadgeVisible === 'boolean') {
          setFileBadgeVisible(settings.fileBadgeVisible)
        }
        if (settings.uiLanguage === 'en' || settings.uiLanguage === 'ja') {
          setUiLanguage(settings.uiLanguage)
        }
        if (typeof settings.videoBarHidden === 'boolean') setVideoBarHidden(settings.videoBarHidden)
        if (typeof settings.videoBarWidth === 'number' && Number.isFinite(settings.videoBarWidth)) {
          setVideoBarWidth(Math.max(320, settings.videoBarWidth))
        }
        if (Number.isFinite(settings.videoBarX) || Number.isFinite(settings.videoBarY)) {
          setVideoBarPos({
            x: Number.isFinite(settings.videoBarX) ? (settings.videoBarX as number) : 0,
            y: Number.isFinite(settings.videoBarY) ? (settings.videoBarY as number) : 0,
          })
        }
      })
      .catch(() => undefined)
      .finally(() => {
        settingsReadyRef.current = true
      })

    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (!settingsReadyRef.current || !window.viewerApi) return

    const timer = window.setTimeout(() => {
      void window.viewerApi
        .updateSettings({
          sortField,
          sortDirection,
          motionAutoplay,
          audioAutoplay,
          videoVolume,
          videoMuted,
          filmstripVisible,
          fileBadgeVisible,
          uiLanguage,
          videoBarHidden,
          videoBarWidth,
          videoBarX: videoBarPos.x,
          videoBarY: videoBarPos.y,
        })
        .catch(() => undefined)
    }, 400)

    return () => window.clearTimeout(timer)
  }, [
    sortField,
    sortDirection,
    motionAutoplay,
    audioAutoplay,
    videoVolume,
    videoMuted,
    filmstripVisible,
    fileBadgeVisible,
    uiLanguage,
    videoBarHidden,
    videoBarWidth,
    videoBarPos.x,
    videoBarPos.y,
  ])

  useEffect(() => {
    const stripElement = filmstripRef.current
    if (!stripElement) return

    const syncViewport = () => {
      setStripViewport((current) => {
        const next = { left: stripElement.scrollLeft, width: stripElement.clientWidth }
        return current.left === next.left && current.width === next.width ? current : next
      })
    }

    syncViewport()
    const observer = new ResizeObserver(syncViewport)
    observer.observe(stripElement)
    return () => observer.disconnect()
  }, [filmstripVisible, sortedEntries.length > 0])

  useEffect(() => {
    if (!filmstripVisible || currentIndex < 0) return
    const stripElement = filmstripRef.current
    if (!stripElement) return

    // The active thumb may be virtualized out of the DOM, so scroll by index math.
    const thumbStart = currentIndex * THUMB_STRIDE
    const thumbEnd = thumbStart + THUMB_STRIDE
    const viewStart = stripElement.scrollLeft
    const viewEnd = viewStart + stripElement.clientWidth

    if (thumbStart < viewStart) {
      stripElement.scrollLeft = Math.max(0, thumbStart - 8)
    } else if (thumbEnd > viewEnd) {
      stripElement.scrollLeft = thumbEnd - stripElement.clientWidth + 8
    }
  }, [currentIndex, activePath, filmstripVisible])

  useEffect(() => {
    if (!window.viewerApi) return

    let cancelled = false

    async function applyStartupTarget() {
      const startupTarget = await window.viewerApi.getStartupTarget()
      debugLog('startup-target', startupTarget)
      if (!startupTarget || cancelled) return

      sourceCacheRef.current.clear()
      setDisplaySource(null)
      setItemError(null)

      if (startupTarget.isDirectory) {
        await loadFolder(startupTarget.path, null, sortField === 'dateTaken')
      } else {
        await handleDroppedPaths([startupTarget.path])
      }
    }

    void applyStartupTarget()

    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    dragStateRef.current = null
    seekScrubbingRef.current = false
    setIsPanning(false)
    setIsVideoPlaying(false)
    setVideoTime(0)
    setVideoDuration(0)
  }, [activePath])

  useEffect(() => {
    if (!isVideoPlaying) return

    let frameId = 0
    let lastUpdateAt = 0

    const tick = (timestamp: number) => {
      if (timestamp - lastUpdateAt >= 100) {
        lastUpdateAt = timestamp
        const video = videoRef.current
        if (video && !seekScrubbingRef.current) setVideoTime(video.currentTime)
      }

      frameId = requestAnimationFrame(tick)
    }

    frameId = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frameId)
  }, [isVideoPlaying, activePath])

  useEffect(() => {
    // The seek slider can unmount mid-scrub (bar hidden via C key); make sure
    // the scrub flag never sticks and silently freezes time updates.
    const resetScrub = () => {
      seekScrubbingRef.current = false
    }

    window.addEventListener('pointerup', resetScrub, true)
    window.addEventListener('pointercancel', resetScrub, true)

    return () => {
      window.removeEventListener('pointerup', resetScrub, true)
      window.removeEventListener('pointercancel', resetScrub, true)
    }
  }, [])

  useEffect(() => {
    const stageElement = stageRef.current
    if (!stageElement) return

    const wake = () => {
      setControlsIdle(false)
      if (controlsIdleTimerRef.current !== null) {
        window.clearTimeout(controlsIdleTimerRef.current)
      }
      controlsIdleTimerRef.current = window.setTimeout(() => setControlsIdle(true), 2600)
    }

    wake()
    stageElement.addEventListener('pointermove', wake)
    stageElement.addEventListener('pointerdown', wake)

    return () => {
      stageElement.removeEventListener('pointermove', wake)
      stageElement.removeEventListener('pointerdown', wake)
      if (controlsIdleTimerRef.current !== null) {
        window.clearTimeout(controlsIdleTimerRef.current)
        controlsIdleTimerRef.current = null
      }
    }
  }, [])

  useEffect(() => {
    if (currentIndex < 0) return

    const neighbors = [sortedEntries[currentIndex + 1], sortedEntries[currentIndex - 1]]

    for (const neighbor of neighbors) {
      if (!neighbor || neighbor.kind !== 'image') continue
      if (sourceCacheRef.current.has(neighbor.path)) continue
      // HEIC/PSD need heavyweight decode work; only prefetch directly renderable images.
      if (neighbor.ext === '.heic' || neighbor.ext === '.heif' || neighbor.ext === '.psd') continue

      void window.viewerApi
        .resolveSource(neighbor.path)
        .then((source) => {
          if (source.strategy !== 'file-url') return

          rememberSource(neighbor.path, {
            kind: source.kind,
            mimeType: source.mimeType,
            url: source.url,
          })

          const image = new Image()
          image.decoding = 'async'
          image.src = source.url
        })
        .catch(() => undefined)
    }
  }, [currentIndex, sortedEntries])

  useEffect(() => {
    if (!currentEntry || !isScalableMedia) {
      setPan((current) => (samePoint(current, { x: 0, y: 0 }) ? current : { x: 0, y: 0 }))
      return
    }

    setPan((current) => {
      const nextPan = clampPan(current, scale)
      return samePoint(nextPan, current) ? current : nextPan
    })
  }, [
    currentEntry?.path,
    currentEntry?.kind,
    naturalSize.width,
    naturalSize.height,
    viewportSize.width,
    viewportSize.height,
    scale,
    isScalableMedia,
  ])

  useEffect(() => {
    if (sortField !== 'dateTaken' || !folderPath) return
    if (dateTakenHydratedFolder === folderPath) return
    if (dateTakenHydratingRef.current === folderPath) return

    dateTakenHydratingRef.current = folderPath
    void loadFolder(folderPath, activePath, true).finally(() => {
      dateTakenHydratingRef.current = null
    })
  }, [sortField, folderPath, activePath, dateTakenHydratedFolder])

  useEffect(() => {
    if (!currentEntry) {
      setDisplaySource(null)
      setItemError(null)
      return
    }

    const entry = currentEntry
    let disposed = false

    async function loadSource() {
      debugLog('loadSource:request', {
        path: entry.path,
        ext: entry.ext,
        kind: entry.kind,
      })

      setLoadingItem(true)
      setItemError(null)
      setNaturalSize({ width: 1, height: 1 })

      try {
        const cached = sourceCacheRef.current.get(entry.path)
        if (cached) {
          debugLog('loadSource:cache-hit', { path: entry.path })
          if (!disposed) setDisplaySource(cached)
          return
        }

        const source = await window.viewerApi.resolveSource(entry.path)

        let nextSource: DisplaySource
        if (source.strategy === 'file-url') {
          nextSource = {
            kind: source.kind,
            mimeType: source.mimeType,
            url: source.url,
          }
        } else if (entry.ext === '.psd') {
          nextSource = {
            kind: source.kind,
            mimeType: 'image/png',
            url: await decodePsdToUrl(source.bytes),
          }
        } else {
          nextSource = {
            kind: source.kind,
            mimeType: 'image/jpeg',
            url: await decodeHeicToUrl(source.bytes),
          }
        }

        rememberSource(entry.path, nextSource)
        debugLog('loadSource:result', {
          path: entry.path,
          kind: nextSource.kind,
          mimeType: nextSource.mimeType,
          strategy: nextSource.url.startsWith('data:') ? 'data-url' : 'url',
        })

        if (!disposed) setDisplaySource(nextSource)
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Failed to load this file.'
        debugLog('loadSource:error', { path: entry.path, message })

        if (!disposed) {
          setItemError(localizeItemError(message))
          setDisplaySource(null)
        }
      } finally {
        if (!disposed) {
          setLoadingItem(false)
          setPan({ x: 0, y: 0 })
          setIsPanning(false)
          dragStateRef.current = null
        }
      }
    }

    void loadSource()

    return () => {
      disposed = true
    }
  }, [currentEntry?.path])

  useEffect(() => {
    const onWindowError = (event: ErrorEvent) => {
      debugLog('window:error', {
        message: event.message,
        filename: event.filename,
        lineno: event.lineno,
        colno: event.colno,
      })
    }

    const onUnhandledRejection = (event: PromiseRejectionEvent) => {
      const reason =
        event.reason instanceof Error
          ? {
              message: event.reason.message,
              stack: event.reason.stack,
            }
          : String(event.reason)

      debugLog('window:unhandledrejection', reason)
    }

    window.addEventListener('error', onWindowError)
    window.addEventListener('unhandledrejection', onUnhandledRejection)

    return () => {
      window.removeEventListener('error', onWindowError)
      window.removeEventListener('unhandledrejection', onUnhandledRejection)
    }
  }, [])

  useEffect(() => {
    if (!window.viewerApi?.debugEnabled) {
      delete window.__viewerTestApi
      return
    }

    window.__viewerTestApi = {
      openPaths: async (paths: string[]) => {
        await handleDroppedPaths(paths)
      },
      getState: () => ({
        folderPath,
        activePath,
        currentIndex,
        entriesCount: sortedEntries.length,
        folderError,
        itemError,
        dropActive,
        loadingFolder,
        loadingItem,
        fitMode,
        isFullscreen,
        pan,
        viewportSize,
        naturalSize,
        scale,
        mediaCanPan,
        imageCanPan,
        rightButtonDown: rightButtonDownRef.current,
      }),
    }

    return () => {
      delete window.__viewerTestApi
    }
  }, [
    activePath,
    currentIndex,
    dropActive,
    folderError,
    folderPath,
    fitMode,
    mediaCanPan,
    imageCanPan,
    isFullscreen,
    itemError,
    loadingFolder,
    loadingItem,
    naturalSize,
    pan,
    scale,
    sortedEntries.length,
    viewportSize,
  ])

  useEffect(() => {
    const stageElement = stageRef.current
    if (!stageElement) return

    const onWheel = (event: WheelEvent) => {
      event.preventDefault()
      event.stopPropagation()

      if (!currentEntry) return

      if (isScalableMedia && (rightButtonDownRef.current || (event.buttons & 2) === 2)) {
        zoomBy(event.deltaY < 0 ? 1.1 : 1 / 1.1)
        return
      }

      if (!sortedEntries.length) return

      const now = Date.now()
      const direction = event.deltaY > 0 ? 1 : event.deltaY < 0 ? -1 : 0
      if (!direction) return

      if (direction !== wheelLastDirectionRef.current) {
        wheelDeltaRef.current = 0
      }

      if (
        direction === wheelLastDirectionRef.current &&
        now - wheelLastTriggerAtRef.current < 120
      ) {
        return
      }

      wheelDeltaRef.current += event.deltaY
      if (Math.abs(wheelDeltaRef.current) < 100) return

      const nextDirection = wheelDeltaRef.current > 0 ? 1 : -1
      wheelDeltaRef.current = 0
      wheelLastTriggerAtRef.current = now
      wheelLastDirectionRef.current = nextDirection
      goToRelative(nextDirection)
    }

    stageElement.addEventListener('wheel', onWheel, { passive: false })
    return () => {
      wheelDeltaRef.current = 0
      wheelLastDirectionRef.current = 0
      stageElement.removeEventListener('wheel', onWheel)
    }
  }, [currentEntry, sortedEntries.length, currentIndex, fitMode, fitScale, manualScale, isScalableMedia])

  useEffect(() => {
    const onMouseDown = (event: MouseEvent) => {
      if (event.button === 2) {
        rightButtonDownRef.current = true
      }
    }

    const onMouseUp = (event: MouseEvent) => {
      if (event.button === 2) {
        rightButtonDownRef.current = false
      }
    }

    const onContextMenu = (event: MouseEvent) => {
      const stageElement = stageRef.current
      if (stageElement && event.target instanceof Node && stageElement.contains(event.target)) {
        event.preventDefault()
      }
    }

    const onBlur = () => {
      rightButtonDownRef.current = false
    }

    window.addEventListener('mousedown', onMouseDown, true)
    window.addEventListener('mouseup', onMouseUp, true)
    window.addEventListener('pointerdown', onMouseDown, true)
    window.addEventListener('pointerup', onMouseUp, true)
    window.addEventListener('contextmenu', onContextMenu, true)
    window.addEventListener('blur', onBlur)

    return () => {
      rightButtonDownRef.current = false
      window.removeEventListener('mousedown', onMouseDown, true)
      window.removeEventListener('mouseup', onMouseUp, true)
      window.removeEventListener('pointerdown', onMouseDown, true)
      window.removeEventListener('pointerup', onMouseUp, true)
      window.removeEventListener('contextmenu', onContextMenu, true)
      window.removeEventListener('blur', onBlur)
    }
  }, [])

  useEffect(() => {
    if (!settingsMenuOpen) return

    const onPointerDown = (event: PointerEvent) => {
      const target = event.target
      if (!(target instanceof Node)) return
      if (settingsMenuRef.current?.contains(target)) return
      if (settingsButtonRef.current?.contains(target)) return
      setSettingsMenuOpen(false)
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        // Capture phase so the global handler doesn't also exit fullscreen.
        event.stopPropagation()
        setSettingsMenuOpen(false)
      }
    }

    window.addEventListener('pointerdown', onPointerDown, true)
    window.addEventListener('keydown', onKeyDown, true)

    return () => {
      window.removeEventListener('pointerdown', onPointerDown, true)
      window.removeEventListener('keydown', onKeyDown, true)
    }
  }, [settingsMenuOpen])

  useEffect(() => {
    if (!window.viewerApi) return

    const endWindowDrag = () => window.viewerApi.setWindowDrag(false)

    const onPointerDown = (event: PointerEvent) => {
      if (event.button !== 1) return
      event.preventDefault()
      window.viewerApi.setWindowDrag(true)
    }

    const onPointerUp = (event: PointerEvent) => {
      if (event.button === 1) endWindowDrag()
    }

    const onMouseDown = (event: MouseEvent) => {
      // Chromium starts middle-button autoscroll on mousedown unless cancelled.
      if (event.button === 1) event.preventDefault()
    }

    window.addEventListener('pointerdown', onPointerDown, true)
    window.addEventListener('pointerup', onPointerUp, true)
    window.addEventListener('pointercancel', endWindowDrag, true)
    window.addEventListener('mousedown', onMouseDown, true)
    window.addEventListener('blur', endWindowDrag)

    return () => {
      endWindowDrag()
      window.removeEventListener('pointerdown', onPointerDown, true)
      window.removeEventListener('pointerup', onPointerUp, true)
      window.removeEventListener('pointercancel', endWindowDrag, true)
      window.removeEventListener('mousedown', onMouseDown, true)
      window.removeEventListener('blur', endWindowDrag)
    }
  }, [])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (isEditableTarget(event.target)) return

      if (event.key === 'Escape' && isFullscreen) {
        event.preventDefault()
        void window.viewerApi.setFullscreen(false)
        return
      }

      if (event.ctrlKey && event.key.toLowerCase() === 'o') {
        event.preventDefault()
        void handleOpenFolder()
        return
      }

      if (event.key === 'ArrowRight' || event.key === 'PageDown') {
        event.preventDefault()
        goToRelative(1)
        return
      }

      if (event.key === 'ArrowLeft' || event.key === 'PageUp' || event.key === 'Backspace') {
        event.preventDefault()
        goToRelative(-1)
        return
      }

      if (event.key === 'Home') {
        event.preventDefault()
        goToIndex(0)
        return
      }

      if (event.key === 'End') {
        event.preventDefault()
        goToIndex(sortedEntries.length - 1)
        return
      }

      if (event.key === '+' || event.key === '=') {
        event.preventDefault()
        zoomBy(1.12)
        return
      }

      if (event.key === '-') {
        event.preventDefault()
        zoomBy(1 / 1.12)
        return
      }

      if (event.key === '0') {
        event.preventDefault()
        resetToFit()
        return
      }

      if (event.key.toLowerCase() === 'h') {
        event.preventDefault()
        fitToHeight()
        return
      }

      if (event.key === '1') {
        event.preventDefault()
        setActualSize()
        return
      }

      if (event.key === 'Delete') {
        event.preventDefault()
        void handleDeleteCurrent()
        return
      }

      if (!event.ctrlKey && !event.altKey && event.key.toLowerCase() === 'e') {
        event.preventDefault()
        handleShowInFolder()
        return
      }

      if (!event.ctrlKey && !event.altKey && event.key.toLowerCase() === 't') {
        event.preventDefault()
        setFilmstripVisible((current) => !current)
        return
      }

      if (event.key === ' ' && currentEntry?.kind === 'video') {
        event.preventDefault()
        toggleVideoPlayback()
        return
      }

      if (event.key.toLowerCase() === 'm' && currentEntry?.kind === 'video') {
        event.preventDefault()
        toggleVideoMute()
        return
      }

      if ((event.key === ',' || event.key === '.') && currentEntry?.kind === 'video') {
        event.preventDefault()
        stepVideoFrame(event.key === '.' ? 1 : -1)
        return
      }

      if (
        !event.ctrlKey &&
        !event.altKey &&
        event.key.toLowerCase() === 'c' &&
        currentEntry?.kind === 'video'
      ) {
        event.preventDefault()
        setVideoBarHidden((current) => !current)
        return
      }

      if (event.key.toLowerCase() === 'f' || event.key === 'F11') {
        event.preventDefault()
        void window.viewerApi.setFullscreen(!isFullscreen)
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [
    sortedEntries.length,
    currentIndex,
    currentEntry?.kind,
    currentEntry?.path,
    sortField,
    fitMode,
    fitScale,
    manualScale,
    isFullscreen,
    videoMuted,
    videoVolume,
  ])

  useEffect(() => {
    const onDragEnter = (event: DragEvent) => {
      if (!hasFilePayload(event)) return
      event.preventDefault()
      event.stopPropagation()
      dragDepthRef.current += 1
      setDropActive(true)
      debugLog('dragenter', { depth: dragDepthRef.current })
    }

    const onDragOver = (event: DragEvent) => {
      if (!hasFilePayload(event)) return
      event.preventDefault()
      event.stopPropagation()
      if (event.dataTransfer) {
        event.dataTransfer.dropEffect = 'copy'
      }
    }

    const onDragLeave = (event: DragEvent) => {
      if (!hasFilePayload(event)) return
      event.preventDefault()
      event.stopPropagation()
      dragDepthRef.current = Math.max(0, dragDepthRef.current - 1)
      debugLog('dragleave', { depth: dragDepthRef.current })

      if (dragDepthRef.current === 0) {
        setDropActive(false)
      }
    }

    const onDrop = (event: DragEvent) => {
      if (!hasFilePayload(event)) return
      event.preventDefault()
      event.stopPropagation()

      const dataTransfer = event.dataTransfer
      dragDepthRef.current = 0
      setDropActive(false)
      debugLog('drop:event', getDropDebugInfo(dataTransfer))

      void (async () => {
        try {
          const paths = await getDroppedPaths(dataTransfer)
          await handleDroppedPaths(paths)
          debugLog('drop:complete', { paths })
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error)
          debugLog('drop:error', {
            message,
            stack: error instanceof Error ? error.stack : undefined,
          })
          setFolderError('ドロップしたファイルを処理できませんでした。')
        } finally {
          dragDepthRef.current = 0
          setDropActive(false)
        }
      })()
    }

    window.addEventListener('dragenter', onDragEnter, true)
    window.addEventListener('dragover', onDragOver, true)
    window.addEventListener('dragleave', onDragLeave, true)
    window.addEventListener('drop', onDrop, true)

    return () => {
      window.removeEventListener('dragenter', onDragEnter, true)
      window.removeEventListener('dragover', onDragOver, true)
      window.removeEventListener('dragleave', onDragLeave, true)
      window.removeEventListener('drop', onDrop, true)
    }
  }, [sortField])

  function handleMediaPointerDown(
    event: ReactPointerEvent<HTMLImageElement | HTMLVideoElement | HTMLDivElement>
  ) {
    if (!currentEntry || !isScalableMedia) return
    if (!mediaCanPan || event.button !== 0) return

    event.preventDefault()
    setIsPanning(true)
    dragStateRef.current = {
      originPan: pan,
      pointerStart: { x: event.clientX, y: event.clientY },
      pointerId: event.pointerId,
    }

    event.currentTarget.setPointerCapture(event.pointerId)
  }

  function handleMediaPointerMove(
    event: ReactPointerEvent<HTMLImageElement | HTMLVideoElement | HTMLDivElement>
  ) {
    const dragState = dragStateRef.current
    if (!dragState || dragState.pointerId !== event.pointerId) return

    event.preventDefault()

    const deltaX = event.clientX - dragState.pointerStart.x
    const deltaY = event.clientY - dragState.pointerStart.y

    setPan(
      clampPan(
        {
          x: dragState.originPan.x + deltaX,
          y: dragState.originPan.y + deltaY,
        },
        scale
      )
    )
  }

  function handleMediaPointerUp(
    event: ReactPointerEvent<HTMLImageElement | HTMLVideoElement | HTMLDivElement>
  ) {
    const dragState = dragStateRef.current
    if (!dragState || dragState.pointerId !== event.pointerId) return

    dragStateRef.current = null
    setIsPanning(false)
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
  }

  const imageClassName = [
    'image-surface',
    fitMode === 'manual' ? 'manual' : 'fit',
    fitMode === 'height' ? 'fit-height' : '',
    mediaCanPan ? 'pannable' : '',
    isPanning ? 'dragging' : '',
  ]
    .filter(Boolean)
    .join(' ')

  const videoClassName = ['video-surface', mediaCanPan ? 'pannable' : '', isPanning ? 'dragging' : '']
    .filter(Boolean)
    .join(' ')
  const videoPanLayerClassName = ['video-pan-layer', isPanning ? 'dragging' : '']
    .filter(Boolean)
    .join(' ')
  const zoomButtonClassName = ['ghost-button', 'zoom-button', isZoomDragging ? 'dragging' : '']
    .filter(Boolean)
    .join(' ')
  const zoomButtonLabel = isScalableMedia ? `${(scale * 100).toFixed(0)}%` : '100%'
  const videoControlsClassName = [
    'video-controls',
    controlsIdle && isVideoPlaying && !controlsHovered ? 'hidden' : '',
  ]
    .filter(Boolean)
    .join(' ')
  const seekProgressPercent = videoDuration > 0 ? (clamp(videoTime, 0, videoDuration) / videoDuration) * 100 : 0
  const volumePercent = (videoMuted ? 0 : videoVolume) * 100

  if (!window.viewerApi) {
    return (
      <div className="app-shell">
        <section className="viewer-shell">
          <div className="stage">
            <div className="error-state">
              <h2>起動に失敗しました</h2>
              <p>Electron の preload API を読み込めませんでした。</p>
            </div>
          </div>
        </section>
      </div>
    )
  }

  return (
    <div className={isFullscreen ? 'app-shell is-fullscreen' : 'app-shell'}>
      <input
        className="debug-file-input"
        data-testid="debug-file-input"
        type="file"
        multiple
        tabIndex={-1}
        aria-hidden="true"
      />
      <header className="topbar">
        <div className="toolbar-group">
          <div className="brand" title="Octopus — every media viewer">
            Octopus
          </div>
          <button
            className="ghost-button icon-button"
            title={t.fullscreenTitle}
            aria-label={t.fullscreenAria}
            onClick={() => void window.viewerApi.setFullscreen(!isFullscreen)}
          >
            <svg viewBox="0 0 16 16" aria-hidden="true">
              <path
                d="M2 6V3.2C2 2.54 2.54 2 3.2 2H6M10 2h2.8c.66 0 1.2.54 1.2 1.2V6M14 10v2.8c0 .66-.54 1.2-1.2 1.2H10M6 14H3.2C2.54 14 2 13.46 2 12.8V10"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                fill="none"
              />
            </svg>
          </button>
          <button className="ghost-button" title={t.fitTitle} onClick={resetToFit}>
            {t.fit}
          </button>
          <button className="ghost-button" title={t.fitHeightTitle} onClick={fitToHeight}>
            {t.fitHeight}
          </button>
          <button
            className={zoomButtonClassName}
            data-testid="zoom-actual-button"
            title={t.zoomTitle}
            onClick={handleZoomControlClick}
            onPointerDown={handleZoomControlPointerDown}
            onPointerMove={handleZoomControlPointerMove}
            onPointerUp={endZoomControlDrag}
            onPointerCancel={endZoomControlDrag}
          >
            {zoomButtonLabel}
          </button>
          <select
            className="toolbar-select"
            value={sortField}
            onChange={(event) => setSortField(event.target.value as SortField)}
          >
            <option value="name">{t.sortName}</option>
            <option value="dateTaken">{t.sortDateTaken}</option>
            <option value="created">{t.sortCreated}</option>
            <option value="modified">{t.sortModified}</option>
          </select>
          <select
            className="toolbar-select"
            value={sortDirection}
            onChange={(event) => setSortDirection(event.target.value as SortDirection)}
          >
            <option value="asc">{t.asc}</option>
            <option value="desc">{t.desc}</option>
          </select>
          <button
            className="ghost-button"
            data-testid="filmstrip-toggle"
            title={t.thumbsTitle}
            onClick={() => setFilmstripVisible((current) => !current)}
          >
            {filmstripVisible ? t.hideThumbs : t.thumbs}
          </button>
          <button
            className="ghost-button icon-button"
            title={t.explorerTitle}
            aria-label={t.explorerAria}
            disabled={!currentEntry}
            onClick={handleShowInFolder}
          >
            <svg viewBox="0 0 16 16" aria-hidden="true">
              <path d="M1.5 4.4c0-.66.54-1.2 1.2-1.2h3.02c.35 0 .68.15.9.42l.83.98h5.85c.66 0 1.2.54 1.2 1.2v5.8c0 .66-.54 1.2-1.2 1.2H2.7c-.66 0-1.2-.54-1.2-1.2z" />
            </svg>
          </button>
          <button
            ref={settingsButtonRef}
            className={settingsMenuOpen ? 'ghost-button icon-button active' : 'ghost-button icon-button'}
            title={t.settings}
            aria-label={t.settings}
            aria-expanded={settingsMenuOpen}
            onClick={toggleSettingsMenu}
          >
            <svg viewBox="0 0 16 16" aria-hidden="true">
              <path d="M9.405 1.05c-.413-1.4-2.397-1.4-2.81 0l-.1.34a1.464 1.464 0 0 1-2.105.872l-.31-.17c-1.283-.698-2.686.705-1.987 1.987l.169.311c.446.82.023 1.841-.872 2.105l-.34.1c-1.4.413-1.4 2.397 0 2.81l.34.1a1.464 1.464 0 0 1 .872 2.105l-.17.31c-.698 1.283.705 2.686 1.987 1.987l.311-.169a1.464 1.464 0 0 1 2.105.872l.1.34c.413 1.4 2.397 1.4 2.81 0l.1-.34a1.464 1.464 0 0 1 2.105-.872l.31.17c1.283.698 2.686-.705 1.987-1.987l-.169-.311a1.464 1.464 0 0 1 .872-2.105l.34-.1c1.4-.413 1.4-2.397 0-2.81l-.34-.1a1.464 1.464 0 0 1-.872-2.105l.17-.31c.698-1.283-.705-2.686-1.987-1.987l-.311.169a1.464 1.464 0 0 1-2.105-.872zM8 10.93a2.929 2.929 0 1 1 0-5.86 2.929 2.929 0 0 1 0 5.858z" />
            </svg>
          </button>
          {settingsMenuOpen ? (
            <div className="settings-menu" ref={settingsMenuRef} style={{ left: settingsMenuLeft }}>
              <label className="toggle">
                <input
                  type="checkbox"
                  checked={motionAutoplay}
                  onChange={(event) => setMotionAutoplay(event.target.checked)}
                />
                {t.autoplayVideo}
              </label>
              <label className="toggle">
                <input
                  type="checkbox"
                  checked={audioAutoplay}
                  onChange={(event) => setAudioAutoplay(event.target.checked)}
                />
                {t.autoplayAudio}
              </label>
              <label className="toggle">
                <input
                  type="checkbox"
                  checked={fileBadgeVisible}
                  onChange={(event) => setFileBadgeVisible(event.target.checked)}
                />
                {t.showFilename}
              </label>
              <label className="toggle">
                <input
                  type="checkbox"
                  checked={uiLanguage === 'ja'}
                  onChange={(event) => setUiLanguage(event.target.checked ? 'ja' : 'en')}
                />
                {t.japaneseUi}
              </label>
            </div>
          ) : null}
          {folderPath ? <div className="path-pill compact">{folderPath}</div> : null}
        </div>
      </header>

      <section className="viewer-shell">
        <div className="stage-shell">
          <div
            className="stage"
            ref={stageRef}
            onContextMenu={(event) => event.preventDefault()}
            onPointerDownCapture={(event) => {
              if (event.button === 2) {
                rightButtonDownRef.current = true
              }
            }}
            onPointerUpCapture={(event) => {
              if (event.button === 2) {
                rightButtonDownRef.current = false
              }
            }}
            onPointerCancelCapture={() => {
              rightButtonDownRef.current = false
            }}
          >
            {dropActive ? <div className="drop-overlay" /> : null}

            {!folderPath && !loadingFolder ? (
              <p className="drop-hero">Drop media here</p>
            ) : null}

            {loadingFolder ? (
              <div className="loading-state">
                <p>フォルダを読み込み中です...</p>
              </div>
            ) : null}

            {folderError ? (
              <div className="error-state">
                <h2>フォルダを開けませんでした</h2>
                <p>{folderError}</p>
              </div>
            ) : null}

            {folderPath && !loadingFolder && !folderError && sortedEntries.length === 0 ? (
              <div className="empty-state">
                <h2>対応ファイルが見つかりません</h2>
                <p>
                  このフォルダ直下では HEIC/HEIF, JPEG/JFIF, PNG, WebP, GIF, AVIF, PSD,
                  MP4, MOV, WebM, MKV, WAV, MP3 を探します。
                </p>
              </div>
            ) : null}

            {currentEntry && !itemError ? (
              <div className="stage-inner">
                {currentIndex > 0 ? (
                  <button className="nav-button prev" onClick={() => goToRelative(-1)} aria-label={t.prev}>
                    ‹
                  </button>
                ) : null}

                {currentIndex < sortedEntries.length - 1 ? (
                  <button className="nav-button next" onClick={() => goToRelative(1)} aria-label={t.next}>
                    ›
                  </button>
                ) : null}

                {loadingItem ? (
                  <div className="loading-state">
                    <p>{currentEntry.name} を読み込み中です...</p>
                  </div>
                ) : null}

                {!loadingItem && displaySource && currentEntry.kind === 'image' ? (
                  <div
                    className="media-frame"
                    style={{
                      transform: `translate(calc(-50% + ${pan.x}px), calc(-50% + ${pan.y}px))`,
                    }}
                  >
                    <img
                      className={imageClassName}
                      src={displaySource.url}
                      alt={currentEntry.name}
                      draggable={false}
                      style={{
                        transform: `scale(${scale})`,
                      }}
                      onDoubleClick={() => (fitMode === 'manual' ? resetToFit() : setActualSize())}
                      onLoad={(event) => {
                        setNaturalSize({
                          width: event.currentTarget.naturalWidth,
                          height: event.currentTarget.naturalHeight,
                        })
                      }}
                      onPointerDown={handleMediaPointerDown}
                      onPointerMove={handleMediaPointerMove}
                      onPointerUp={handleMediaPointerUp}
                      onPointerCancel={handleMediaPointerUp}
                    />
                  </div>
                ) : null}

                {!loadingItem && displaySource && currentEntry.kind === 'video' ? (
                  <div
                    className="media-frame"
                    style={{
                      transform: `translate(calc(-50% + ${pan.x}px), calc(-50% + ${pan.y}px))`,
                    }}
                  >
                    <div
                      className="video-stack"
                      style={{
                        width: `${naturalSize.width}px`,
                        height: `${naturalSize.height}px`,
                        transform: `scale(${scale})`,
                      }}
                    >
                      <video
                        ref={videoRef}
                        className={videoClassName}
                        src={displaySource.url}
                        autoPlay={motionAutoplay}
                        loop
                        muted={videoMuted}
                        onLoadedMetadata={(event) => {
                          const video = event.currentTarget
                          video.volume = videoVolume
                          setNaturalSize({
                            width: video.videoWidth,
                            height: video.videoHeight,
                          })
                          setVideoDuration(Number.isFinite(video.duration) ? video.duration : 0)
                        }}
                        onDurationChange={(event) => {
                          const duration = event.currentTarget.duration
                          setVideoDuration(Number.isFinite(duration) ? duration : 0)
                        }}
                        onTimeUpdate={(event) => {
                          if (!isVideoPlaying && !seekScrubbingRef.current) {
                            setVideoTime(event.currentTarget.currentTime)
                          }
                        }}
                        onPlay={() => setIsVideoPlaying(true)}
                        onPause={() => setIsVideoPlaying(false)}
                        onClick={toggleVideoPlayback}
                        onDoubleClick={() =>
                          fitMode === 'manual' ? resetToFit() : setActualSize()
                        }
                        onError={(event) => {
                          if (event.currentTarget.src !== displaySource.url) return
                          setItemError(
                            'この動画は再生できませんでした。MOV や MKV は環境のコーデックによって再生できない場合があります。'
                          )
                        }}
                      />
                      {mediaCanPan ? (
                        <div
                          className={videoPanLayerClassName}
                          onDoubleClick={() =>
                            fitMode === 'manual' ? resetToFit() : setActualSize()
                          }
                          onPointerDown={handleMediaPointerDown}
                          onPointerMove={handleMediaPointerMove}
                          onPointerUp={handleMediaPointerUp}
                          onPointerCancel={handleMediaPointerUp}
                        />
                      ) : null}
                    </div>
                  </div>
                ) : null}

                {!loadingItem && displaySource && currentEntry.kind === 'audio' ? (
                  <div className="audio-card">
                    <p className="eyebrow">AUDIO</p>
                    <h2>{currentEntry.name}</h2>
                    <p>WAV と MP3 を再生します。音声だけのファイルでもこのまま前後移動できます。</p>
                    <audio
                      className="audio-surface"
                      src={displaySource.url}
                      autoPlay={audioAutoplay}
                      controls
                    />
                  </div>
                ) : null}

                {fileBadgeVisible ? (
                  <div
                    className={
                      // Lift the badge only while the bar actually sits at the bottom;
                      // once the user drags it elsewhere the default spot is free again.
                      currentEntry.kind === 'video' && !videoBarHidden && videoBarPos.y > -60
                        ? 'badge-row raised'
                        : 'badge-row'
                    }
                  >
                    <div className="badge">
                      {mediaKindLabel(currentEntry.kind, uiLanguage)} / {currentEntry.name}
                    </div>
                  </div>
                ) : null}

                {currentEntry.kind === 'video' && displaySource && !loadingItem && !videoBarHidden ? (
                  <div
                    className={videoControlsClassName}
                    style={
                      {
                        '--bar-x': `${clampBarPos(videoBarPos).x}px`,
                        '--bar-y': `${clampBarPos(videoBarPos).y}px`,
                        width: videoBarWidth === null ? undefined : `${getVideoBarWidth()}px`,
                      } as CSSProperties
                    }
                    onPointerDown={(event) => event.stopPropagation()}
                    onDoubleClick={(event) => event.stopPropagation()}
                    onPointerEnter={() => setControlsHovered(true)}
                    onPointerLeave={() => setControlsHovered(false)}
                  >
                    <div
                      className="vc-grip"
                      title={t.dragMove}
                      onPointerDown={handleBarGripPointerDown}
                      onPointerMove={handleBarGripPointerMove}
                      onPointerUp={handleBarGripPointerUp}
                      onPointerCancel={handleBarGripPointerUp}
                    >
                      <svg viewBox="0 0 16 16" aria-hidden="true">
                        <circle cx="5.5" cy="4" r="1.2" />
                        <circle cx="5.5" cy="8" r="1.2" />
                        <circle cx="5.5" cy="12" r="1.2" />
                        <circle cx="10.5" cy="4" r="1.2" />
                        <circle cx="10.5" cy="8" r="1.2" />
                        <circle cx="10.5" cy="12" r="1.2" />
                      </svg>
                    </div>
                    <button
                      className="vc-button"
                      data-testid="video-step-back"
                      onClick={() => stepVideoFrame(-1)}
                      title={t.frameBack}
                      aria-label={t.frameBackAria}
                    >
                      <svg viewBox="0 0 16 16" aria-hidden="true">
                        <rect x="3" y="2.5" width="2" height="11" rx="0.8" />
                        <path d="M13 3.4v9.2a.8.8 0 0 1-1.28.64L6.4 8.64a.8.8 0 0 1 0-1.28l5.32-4.6A.8.8 0 0 1 13 3.4z" />
                      </svg>
                    </button>
                    <button
                      className="vc-button"
                      data-testid="video-play-button"
                      onClick={toggleVideoPlayback}
                      aria-label={isVideoPlaying ? t.pause : t.play}
                    >
                      {isVideoPlaying ? (
                        <svg viewBox="0 0 16 16" aria-hidden="true">
                          <rect x="3" y="2.5" width="3.4" height="11" rx="1" />
                          <rect x="9.6" y="2.5" width="3.4" height="11" rx="1" />
                        </svg>
                      ) : (
                        <svg viewBox="0 0 16 16" aria-hidden="true">
                          <path d="M4.4 2.6a1 1 0 0 1 1.52-.86l8 5.4a1 1 0 0 1 0 1.72l-8 5.4a1 1 0 0 1-1.52-.86z" />
                        </svg>
                      )}
                    </button>
                    <button
                      className="vc-button"
                      data-testid="video-step-forward"
                      onClick={() => stepVideoFrame(1)}
                      title={t.frameForward}
                      aria-label={t.frameForwardAria}
                    >
                      <svg viewBox="0 0 16 16" aria-hidden="true">
                        <path d="M3 3.4v9.2a.8.8 0 0 0 1.28.64l5.32-4.6a.8.8 0 0 0 0-1.28L4.28 2.76A.8.8 0 0 0 3 3.4z" />
                        <rect x="11" y="2.5" width="2" height="11" rx="0.8" />
                      </svg>
                    </button>
                    <span className="vc-time">{formatDuration(videoTime)}</span>
                    <input
                      className="vc-seek"
                      data-testid="video-seek-slider"
                      type="range"
                      min={0}
                      max={videoDuration || 0}
                      step={0.01}
                      value={clamp(videoTime, 0, videoDuration || 0)}
                      disabled={!videoDuration}
                      style={{ '--vc-progress': `${seekProgressPercent}%` } as CSSProperties}
                      onChange={(event) => seekVideo(Number(event.target.value))}
                      onPointerDown={() => {
                        seekScrubbingRef.current = true
                      }}
                      onPointerUp={() => {
                        seekScrubbingRef.current = false
                      }}
                      onPointerCancel={() => {
                        seekScrubbingRef.current = false
                      }}
                      aria-label={t.seek}
                    />
                    <span className="vc-time">{formatDuration(videoDuration)}</span>
                    <button
                      className="vc-button"
                      onClick={toggleVideoMute}
                      aria-label={videoMuted ? t.unmute : t.mute}
                    >
                      {videoMuted || videoVolume === 0 ? (
                        <svg viewBox="0 0 16 16" aria-hidden="true">
                          <path d="M2 6v4h2.6L8.4 13V3L4.6 6z" />
                          <path
                            d="m10.6 6 3.4 4M14 6l-3.4 4"
                            stroke="currentColor"
                            strokeWidth="1.5"
                            strokeLinecap="round"
                            fill="none"
                          />
                        </svg>
                      ) : (
                        <svg viewBox="0 0 16 16" aria-hidden="true">
                          <path d="M2 6v4h2.6L8.4 13V3L4.6 6z" />
                          <path
                            d="M10.4 5.4a3.6 3.6 0 0 1 0 5.2M12.2 3.6a6.2 6.2 0 0 1 0 8.8"
                            stroke="currentColor"
                            strokeWidth="1.4"
                            strokeLinecap="round"
                            fill="none"
                          />
                        </svg>
                      )}
                    </button>
                    <input
                      className="vc-volume"
                      type="range"
                      min={0}
                      max={1}
                      step={0.02}
                      value={videoMuted ? 0 : videoVolume}
                      style={{ '--vc-progress': `${volumePercent}%` } as CSSProperties}
                      onChange={(event) => changeVideoVolume(Number(event.target.value))}
                      aria-label={t.volume}
                    />
                    <button
                      className="vc-button"
                      data-testid="video-bar-hide"
                      onClick={() => setVideoBarHidden(true)}
                      title={t.hideControlsTitle}
                      aria-label={t.hideControlsAria}
                    >
                      <svg viewBox="0 0 16 16" aria-hidden="true">
                        <path
                          d="m4 4 8 8M12 4l-8 8"
                          stroke="currentColor"
                          strokeWidth="1.6"
                          strokeLinecap="round"
                          fill="none"
                        />
                      </svg>
                    </button>
                    <div
                      className="vc-resize"
                      title="ドラッグで長さを変更"
                      onPointerDown={handleBarResizePointerDown}
                      onPointerMove={handleBarResizePointerMove}
                      onPointerUp={handleBarResizePointerUp}
                      onPointerCancel={handleBarResizePointerUp}
                    />
                  </div>
                ) : null}

                {currentEntry.kind === 'video' && displaySource && !loadingItem && videoBarHidden ? (
                  <button
                    className="vc-restore"
                    data-testid="video-bar-restore"
                    title={t.showControlsTitle}
                    onClick={() => setVideoBarHidden(false)}
                  >
                    {t.controls}
                  </button>
                ) : null}
              </div>
            ) : null}

            {itemError ? (
              <div className="error-state">
                <h2>表示できませんでした</h2>
                <p>{itemError}</p>
              </div>
            ) : null}
          </div>
        </div>
      </section>

      {filmstripVisible && !isFullscreen && sortedEntries.length ? (
        <div
          className={isStripDragging ? 'filmstrip dragging' : 'filmstrip'}
          data-testid="filmstrip"
          ref={filmstripRef}
          onScroll={(event) => {
            const left = event.currentTarget.scrollLeft
            setStripViewport((current) => (current.left === left ? current : { ...current, left }))
          }}
          onWheel={(event) => {
            event.currentTarget.scrollLeft += event.deltaY
          }}
          onPointerDown={handleStripPointerDown}
          onPointerMove={handleStripPointerMove}
          onPointerUp={handleStripPointerUp}
          onPointerCancel={handleStripPointerUp}
          onClickCapture={handleStripClickCapture}
        >
          {(() => {
            // Render only the visible window of thumbs; spacers keep scroll geometry.
            const viewportWidth = stripViewport.width || window.innerWidth
            const firstIndex = Math.max(
              0,
              Math.floor(stripViewport.left / THUMB_STRIDE) - THUMB_OVERSCAN
            )
            const lastIndex = Math.min(
              sortedEntries.length - 1,
              Math.ceil((stripViewport.left + viewportWidth) / THUMB_STRIDE) + THUMB_OVERSCAN
            )
            const leadingWidth = firstIndex * THUMB_STRIDE - (firstIndex > 0 ? 6 : 0)
            const trailingCount = sortedEntries.length - 1 - lastIndex
            const trailingWidth = trailingCount * THUMB_STRIDE - (trailingCount > 0 ? 6 : 0)

            return (
              <>
                {leadingWidth > 0 ? (
                  <div className="thumb-spacer" style={{ width: leadingWidth }} />
                ) : null}
                {sortedEntries.slice(firstIndex, lastIndex + 1).map((entry) => (
                  <FilmstripThumb
                    key={entry.path}
                    entry={entry}
                    isActive={entry.path === activePath}
                    onSelect={() => setActivePath(entry.path)}
                  />
                ))}
                {trailingWidth > 0 ? (
                  <div className="thumb-spacer" style={{ width: trailingWidth }} />
                ) : null}
              </>
            )
          })()}
        </div>
      ) : null}

      <footer className="bottom-bar">
        <div className="counter">
          {sortedEntries.length ? `${currentIndex + 1} / ${sortedEntries.length}` : '0 / 0'}
        </div>
        <div className="counter">
          {currentEntry
            ? `${mediaKindLabel(currentEntry.kind, uiLanguage)} / ${formatFileSize(currentEntry.size)} / ${t.shot} ${formatTimestamp(
                currentEntry.dateTakenAt ?? currentEntry.createdAt
              )}`
            : ''}
        </div>
      </footer>
    </div>
  )
}
