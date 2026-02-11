/// <reference types="vite/client" />

declare global {
  const __APP_VERSION__: string

  type DownloadStatus = 'queued' | 'downloading' | 'paused' | 'completed' | 'error' | 'canceled' | 'merging'

  type DownloadTask = {
    id: string
    url: string
    directory: string
    filename: string
    filePath: string
    engine: 'direct' | 'ffmpeg' | 'ytdlp'
    targetFormat: 'mp4' | 'mp3'
    status: DownloadStatus
    totalBytes: number | null
    downloadedBytes: number
    speedBytesPerSec: number | null
    errorMessage: string | null
    createdAtMs: number
    updatedAtMs: number
    title?: string
    thumbnail?: string
    cookieBrowser?: string
  }

  type HlsVariant = {
    bandwidth: number | null
    resolution: { width: number; height: number } | null
    url: string
  }

  type YtdlpFormat = {
    formatId: string
    ext: string
    resolution: string
    filesize: number | null
    description: string
  }

  type AnalyzeResult =
    | { kind: 'unknown' }
    | { kind: 'direct' }
    | { kind: 'hls-media'; url: string }
    | { kind: 'hls-master'; variants: HlsVariant[] }
    | { kind: 'ytdlp'; title: string; thumbnail?: string; formats: YtdlpFormat[] }
    | { kind: 'playlist'; title: string; items: { id: string; title: string; url: string; thumbnail?: string }[] }

  interface Window {
    cortexDl: {
      selectFolder: () => Promise<string | null>
      selectCookiesFile: () => Promise<string | null>
      analyzeUrl: (url: string, browser?: string) => Promise<AnalyzeResult>
      listDownloads: () => Promise<DownloadTask[]>
      addDownload: (input: { 
        url: string; 
        directory: string; 
        filename?: string; 
        engine?: 'auto' | 'direct' | 'ffmpeg' | 'ytdlp'; 
        targetFormat?: 'mp4' | 'mp3'; 
        ytdlpFormatId?: string; 
        title?: string; 
        thumbnail?: string; 
        cookieBrowser?: string;
        cookieFile?: string;
        username?: string;
        password?: string;
      }) => Promise<DownloadTask>
      pauseDownload: (id: string) => Promise<DownloadTask>
      resumeDownload: (id: string) => Promise<DownloadTask>
      cancelDownload: (id: string) => Promise<DownloadTask>
      deleteDownload: (id: string, deleteFile: boolean) => Promise<void>
      clearCompleted: () => Promise<void>
      pauseAll: () => Promise<void>
      resumeAll: () => Promise<void>
      openFolder: (filePath: string) => Promise<void>
      openFile: (filePath: string) => Promise<void>
      openExternal: (url: string) => Promise<void>
      checkEngines: () => Promise<{ ytdlp: boolean; ffmpeg: boolean; jsRuntime: boolean; jsRuntimeName: string }>
      updateEngine: () => Promise<{ success: boolean; message: string }>
      checkForUpdates: () => Promise<void>
      restartApp: () => Promise<void>
      uninstallApp: () => Promise<void>
      onUpdateStatus: (callback: (status: any) => void) => () => void
      onDownloadUpdated: (callback: (task: DownloadTask) => void) => () => void
      onStatsUpdated: (callback: (data: { id: string; addedBytes: number }) => void) => () => void
    }
  }
}

export {}
