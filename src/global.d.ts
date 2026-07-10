export {}

declare global {
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

  type ViewerSource =
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

  type ViewerTestState = {
    folderPath: string | null
    activePath: string | null
    currentIndex: number
    entriesCount: number
    folderError: string | null
    itemError: string | null
    dropActive: boolean
    loadingFolder: boolean
    loadingItem: boolean
    fitMode: 'contain' | 'height' | 'manual'
    isFullscreen: boolean
    pan: { x: number; y: number }
    viewportSize: { width: number; height: number }
    naturalSize: { width: number; height: number }
    scale: number
    mediaCanPan: boolean
    imageCanPan: boolean
    rightButtonDown: boolean
  }

  type ViewerSettings = {
    sortField?: 'name' | 'dateTaken' | 'created' | 'modified'
    sortDirection?: 'asc' | 'desc'
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
  }

  interface Window {
    viewerApi: {
      debugEnabled: boolean
      getPathForFile(file: File): string
      debugLog(message: string, data?: unknown): void
      selectFolder(): Promise<string | null>
      listFolder(
        folderPath: string,
        options?: { includeDateTaken?: boolean }
      ): Promise<ViewerEntry[]>
      resolveSource(filePath: string): Promise<ViewerSource>
      toggleFullscreen(): Promise<boolean>
      setFullscreen(shouldBeFullscreen: boolean): Promise<boolean>
      getFullscreen(): Promise<boolean>
      onFullscreenChange(callback: (isFullscreen: boolean) => void): () => void
      getStartupTarget(): Promise<{ path: string; isDirectory: boolean } | null>
      getSettings(): Promise<ViewerSettings>
      updateSettings(partial: ViewerSettings): Promise<void>
      deleteItem(filePath: string): Promise<{ deleted: boolean; error?: string }>
      setWindowDrag(active: boolean): void
      showInFolder(filePath: string): Promise<void>
      getThumbnail(filePath: string): Promise<string | null>
      getMediaUrl(filePath: string): string
    }
    __viewerTestApi?: {
      openPaths(paths: string[]): Promise<void>
      getState(): ViewerTestState
    }
  }
}

declare module 'heic2any' {
  const heic2any: (options: {
    blob: Blob
    toType?: string
    quality?: number
  }) => Promise<Blob | Blob[]>

  export default heic2any
}
