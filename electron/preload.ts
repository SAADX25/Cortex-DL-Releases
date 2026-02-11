import { ipcRenderer, contextBridge } from 'electron'

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

const UPDATE_CHANNEL = 'cortexdl:download-updated'

contextBridge.exposeInMainWorld('cortexDl', {
  selectFolder(): Promise<string | null> {
    return ipcRenderer.invoke('cortexdl:select-folder')
  },
  selectCookiesFile(): Promise<string | null> {
    return ipcRenderer.invoke('cortexdl:select-cookies-file')
  },
  analyzeUrl(url: string, browser?: string): Promise<AnalyzeResult> {
    return ipcRenderer.invoke('cortexdl:analyze-url', url, browser)
  },
  listDownloads(): Promise<DownloadTask[]> {
    return ipcRenderer.invoke('cortexdl:downloads:list')
  },
  addDownload(input: {
    url: string
    directory: string
    filename?: string
    engine?: 'auto' | 'direct' | 'ffmpeg' | 'ytdlp'
    targetFormat?: 'mp4' | 'mp3'
    ytdlpFormatId?: string
    title?: string
    thumbnail?: string
    cookieBrowser?: string
    cookieFile?: string
    username?: string
    password?: string
  }): Promise<DownloadTask> {
    return ipcRenderer.invoke('cortexdl:downloads:add', input)
  },
  pauseDownload(id: string): Promise<DownloadTask> {
    return ipcRenderer.invoke('cortexdl:downloads:pause', id)
  },
  resumeDownload(id: string): Promise<DownloadTask> {
    return ipcRenderer.invoke('cortexdl:downloads:resume', id)
  },
  cancelDownload(id: string): Promise<DownloadTask> {
    return ipcRenderer.invoke('cortexdl:downloads:cancel', id)
  },
  deleteDownload(id: string, deleteFile: boolean): Promise<void> {
    return ipcRenderer.invoke('cortexdl:downloads:delete', id, deleteFile)
  },
  clearCompleted(): Promise<void> {
    return ipcRenderer.invoke('cortexdl:downloads:clear-completed')
  },
  pauseAll(): Promise<void> {
    return ipcRenderer.invoke('cortexdl:downloads:pause-all')
  },
  resumeAll(): Promise<void> {
    return ipcRenderer.invoke('cortexdl:downloads:resume-all')
  },
  openFolder(filePath: string): Promise<void> {
    return ipcRenderer.invoke('cortexdl:open-folder', filePath)
  },
  openFile(filePath: string): Promise<void> {
    return ipcRenderer.invoke('cortexdl:open-file', filePath)
  },
  openExternal(url: string): Promise<void> {
    return ipcRenderer.invoke('cortexdl:open-external', url)
  },
  checkEngines(): Promise<{ ytdlp: boolean; ffmpeg: boolean; jsRuntime: boolean; jsRuntimeName: string }> {
    return ipcRenderer.invoke('cortexdl:check-engines')
  },
  updateEngine(): Promise<{ success: boolean; message: string }> {
    return ipcRenderer.invoke('cortexdl:update-engine')
  },
  checkForUpdates(): Promise<void> {
    return ipcRenderer.invoke('cortexdl:check-for-updates')
  },
  restartApp(): Promise<void> {
    return ipcRenderer.invoke('cortexdl:restart-app')
  },
  uninstallApp(): Promise<void> {
    return ipcRenderer.invoke('cortexdl:uninstall-app')
  },
  onUpdateStatus(callback: (status: any) => void): () => void {
    const listener = (_event: unknown, status: any) => callback(status)
    ipcRenderer.on('update-status', listener)
    return () => ipcRenderer.off('update-status', listener)
  },
  onDownloadUpdated(callback: (task: DownloadTask) => void): () => void {
    const listener = (_event: unknown, task: DownloadTask) => callback(task)
    ipcRenderer.on(UPDATE_CHANNEL, listener)
    return () => ipcRenderer.off(UPDATE_CHANNEL, listener)
  },
  onStatsUpdated(callback: (data: { id: string; addedBytes: number }) => void): () => void {
    const listener = (_event: unknown, data: { id: string; addedBytes: number }) => callback(data)
    ipcRenderer.on('cortexdl:download-stats-updated', listener)
    return () => ipcRenderer.off('cortexdl:download-stats-updated', listener)
  },
})
