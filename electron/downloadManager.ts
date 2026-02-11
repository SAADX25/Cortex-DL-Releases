import { BrowserWindow, Notification, app } from 'electron'
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { createWriteStream, existsSync, promises as fs, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { Readable, Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import type { ReadableStream as NodeReadableStream } from 'node:stream/web'
import { setTimeout as delay } from 'node:timers/promises'
import { getBinaryPath } from './utils'

const UPDATE_CHANNEL = 'cortexdl:download-updated'
const MAX_CONCURRENT_DOWNLOADS = 2

// --- Types ---
export type DownloadStatus = 'queued' | 'downloading' | 'merging' | 'paused' | 'completed' | 'error' | 'canceled'
export type DownloadEngine = 'direct' | 'ffmpeg' | 'ytdlp'

export interface DownloadTask {
  id: string
  url: string
  directory: string
  filename: string
  filePath: string
  engine: DownloadEngine
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
  cookieFile?: string
  username?: string
  password?: string
  ytdlpFormatId?: string
}

interface StartInput {
  url: string
  directory: string
  filename?: string
  engine?: 'auto' | DownloadEngine
  targetFormat?: 'mp4' | 'mp3'
  ytdlpFormatId?: string
  title?: string
  thumbnail?: string
  cookieBrowser?: string
  cookieFile?: string
  username?: string
  password?: string
}

interface TaskRuntime {
  abortController: AbortController | null
  child: ChildProcessWithoutNullStreams | null
  lastSpeedSampleAtMs: number | null
  lastSpeedSampleBytes: number | null
  retries: number
}

// --- Download Manager Class ---

export class DownloadManager {
  private tasks = new Map<string, DownloadTask>()
  private runtime = new Map<string, TaskRuntime>()
  private activeTasks = new Set<string>()
  private storagePath: string
  private mainWindow: BrowserWindow | null = null

  constructor() {
    this.storagePath = path.join(app.getPath('userData'), 'tasks.json')
    this.loadState()
  }

  attachWindow(win: BrowserWindow) {
    this.mainWindow = win
  }

  // --- Public API ---

  list(): DownloadTask[] {
    return Array.from(this.tasks.values()).sort((a, b) => b.createdAtMs - a.createdAtMs)
  }

  get(id: string) {
    return this.tasks.get(id) || null
  }

  async add(input: StartInput): Promise<DownloadTask> {
    if (!/^https?:\/\//i.test(input.url)) throw new Error('Invalid URL protocol')

    await fs.mkdir(input.directory, { recursive: true })

    const id = randomUUID()
    const engine = this.determineEngine(input)
    const filename = this.determineFilename(input, engine)
    
    const task: DownloadTask = {
      id,
      url: input.url,
      directory: input.directory,
      filename,
      filePath: path.join(input.directory, filename),
      engine,
      targetFormat: input.targetFormat ?? 'mp4',
      status: 'queued',
      totalBytes: null,
      downloadedBytes: 0,
      speedBytesPerSec: null,
      errorMessage: null,
      createdAtMs: Date.now(),
      updatedAtMs: Date.now(),
      title: input.title,
      thumbnail: input.thumbnail,
      cookieBrowser: input.cookieBrowser,
      cookieFile: input.cookieFile,
      ytdlpFormatId: input.ytdlpFormatId,
      username: input.username,
      password: input.password
    }

    this.tasks.set(id, task)
    this.runtime.set(id, {
      abortController: null,
      child: null,
      lastSpeedSampleAtMs: null,
      lastSpeedSampleBytes: null,
      retries: 0
    })

    this.persist()
    this.broadcastUpdate(task)
    this.processQueue()
    
    return task
  }

  async pause(id: string) {
    const task = this.tasks.get(id)
    if (!task || task.status !== 'downloading') return task

    const runtime = this.runtime.get(id)
    runtime?.abortController?.abort()
    runtime?.child?.kill()

    task.status = 'paused'
    task.speedBytesPerSec = null
    task.updatedAtMs = Date.now()

    this.persist()
    this.broadcastUpdate(task)
    this.processQueue()
    return task
  }

  async resume(id: string) {
    const task = this.tasks.get(id)
    if (!task || ['completed', 'canceled'].includes(task.status)) return task

    task.status = 'queued'
    task.errorMessage = null
    task.updatedAtMs = Date.now()

    this.persist()
    this.broadcastUpdate(task)
    this.processQueue()
    return task
  }

  async cancel(id: string) {
    const task = this.tasks.get(id)
    if (!task) return null

    const runtime = this.runtime.get(id)
    runtime?.abortController?.abort()
    runtime?.child?.kill()

    task.status = 'canceled'
    task.speedBytesPerSec = null
    task.updatedAtMs = Date.now()

    this.activeTasks.delete(id)
    this.persist()
    this.broadcastUpdate(task)
    this.processQueue()

    // Cleanup partial file
    await delay(100)
    fs.unlink(task.filePath).catch(() => {})

    return task
  }

  async delete(id: string, deleteFile: boolean) {
    const task = this.tasks.get(id)
    if (!task) return

    const runtime = this.runtime.get(id)
    runtime?.abortController?.abort()
    runtime?.child?.kill()

    this.tasks.delete(id)
    this.runtime.delete(id)
    this.activeTasks.delete(id)
    this.persist()
    this.processQueue()

    if (deleteFile) {
      fs.unlink(task.filePath).catch(err => console.error('Delete file failed:', err))
    }
  }

  clearCompleted() {
    for (const [id, task] of this.tasks) {
      if (['completed', 'canceled'].includes(task.status)) {
        this.tasks.delete(id)
        this.runtime.delete(id)
      }
    }
    this.persist()
  }

  async pauseAll() {
    const active = Array.from(this.tasks.values())
      .filter(t => ['downloading', 'queued'].includes(t.status))
    
    await Promise.all(active.map(t => this.pause(t.id)))
  }

  async resumeAll() {
    const paused = Array.from(this.tasks.values())
      .filter(t => ['paused', 'error'].includes(t.status))
    
    await Promise.all(paused.map(t => this.resume(t.id)))
  }

  // --- Internals ---

  private determineEngine(input: StartInput): DownloadEngine {
    if (input.engine && input.engine !== 'auto') return input.engine
    
    const url = input.url.toLowerCase()
    if (/\.m3u8(\?|$)/.test(url) || input.targetFormat === 'mp3') return 'ffmpeg'
    if (/youtu\.?be|facebook|instagram/.test(url)) return 'ytdlp'
    return 'direct'
  }

  private determineFilename(input: StartInput, _engine: DownloadEngine): string {
    let name = input.filename || input.title || 'download'
    name = name.replace(/[<>:"/\\|?*\x00-\x1F]/g, '_').trim() || 'download'
    
    if (!path.extname(name)) {
      name += input.targetFormat === 'mp3' ? '.mp3' : '.mp4'
    } else if (input.targetFormat === 'mp3' && !name.endsWith('.mp3')) {
      name = name.replace(/\.[^.]+$/, '.mp3')
    }

    return name
  }

  private loadState() {
    try {
      if (!existsSync(this.storagePath)) return
      
      const raw = JSON.parse(readFileSync(this.storagePath, 'utf-8'))
      if (!Array.isArray(raw)) return

      for (const task of raw) {
        if (!task.id || !task.url) continue
        
        if (['downloading', 'merging'].includes(task.status)) {
          task.status = 'paused'
        }
        
        this.tasks.set(task.id, task)
        this.runtime.set(task.id, {
          abortController: null,
          child: null,
          lastSpeedSampleAtMs: null,
          lastSpeedSampleBytes: null,
          retries: 0
        })
      }
    } catch (err) {
      console.error('State load failed:', err)
    }
  }

  private persist() {
    try {
      const dir = path.dirname(this.storagePath)
      if (!existsSync(dir)) fs.mkdir(dir, { recursive: true }).catch(() => {})
      
      writeFileSync(this.storagePath, JSON.stringify(Array.from(this.tasks.values()), null, 2))
    } catch (err) {
      console.error('State save failed:', err)
    }
  }

  private broadcastUpdate(task: DownloadTask) {
    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      this.mainWindow.webContents.send(UPDATE_CHANNEL, task)
    }
  }

  private processQueue() {
    const availableSlots = MAX_CONCURRENT_DOWNLOADS - this.activeTasks.size
    if (availableSlots <= 0) return

    const candidates = Array.from(this.tasks.values())
      .filter(t => t.status === 'queued' && !this.activeTasks.has(t.id))
      .sort((a, b) => a.createdAtMs - b.createdAtMs)
      .slice(0, availableSlots)

    for (const task of candidates) {
      this.activeTasks.add(task.id)
      this.executeTask(task).catch(err => {
        console.error(`Task execution failed [${task.id}]:`, err)
        this.activeTasks.delete(task.id)
      })
    }
  }

  private async executeTask(task: DownloadTask) {
    switch (task.engine) {
      case 'direct': return this.runDirect(task)
      case 'ffmpeg': return this.runFfmpeg(task)
      case 'ytdlp': return this.runYtdlp(task)
    }
  }

  private async runDirect(task: DownloadTask) {
    const runtime = this.runtime.get(task.id)!
    runtime.abortController = new AbortController()

    try {
      const existingSize = await this.getFileSize(task.filePath)
      task.downloadedBytes = existingSize
      task.status = 'downloading'
      this.broadcastUpdate(task)

      const headers: Record<string, string> = {}
      if (existingSize > 0) headers['Range'] = `bytes=${existingSize}-`

      const response = await fetch(task.url, {
        signal: runtime.abortController.signal,
        headers
      })

      if (!response.ok && response.status !== 206) throw new Error(`HTTP ${response.status}`)

      const contentLength = Number(response.headers.get('content-length')) || 0
      const isPartial = response.status === 206
      
      if (isPartial) {
         const match = response.headers.get('content-range')?.match(/bytes \d+-\d+\/(\d+)/)
         if (match) task.totalBytes = Number(match[1])
         else task.totalBytes = existingSize + contentLength
      } else {
        task.totalBytes = contentLength
        task.downloadedBytes = 0 
      }

      this.persist()
      
      if (!response.body) throw new Error('Empty response body')

      const stream = Readable.fromWeb(response.body as unknown as NodeReadableStream)
      const fileStream = createWriteStream(task.filePath, { flags: isPartial ? 'a' : 'w' })
      
      const progressMonitor = new Transform({
        transform: (chunk, _, cb) => {
          task.downloadedBytes += chunk.length
          this.updateSpeed(task, runtime)
          this.broadcastUpdate(task)
          cb(null, chunk)
        }
      })

      await pipeline(stream, progressMonitor, fileStream)

      this.completeTask(task)
    } catch (err: any) {
      this.handleError(task, runtime, err)
    } finally {
      this.cleanupRuntime(task.id)
    }
  }

  private async runFfmpeg(task: DownloadTask) {
    const runtime = this.runtime.get(task.id)!
    
    runtime.abortController = new AbortController()
    task.status = 'downloading'
    task.downloadedBytes = 0
    this.broadcastUpdate(task)

    const args = task.targetFormat === 'mp3'
      ? ['-y', '-i', task.url, '-vn', '-acodec', 'libmp3lame', '-q:a', '2', task.filePath]
      : ['-y', '-i', task.url, '-c', 'copy', '-bsf:a', 'aac_adtstoasc', task.filePath]

    const child = spawn(getBinaryPath('ffmpeg'), args, { windowsHide: true })
    runtime.child = child

    child.on('close', code => {
      if (runtime.abortController?.signal.aborted) return
      
      if (code === 0) this.completeTask(task)
      else this.handleError(task, runtime, new Error(`FFmpeg exited with code ${code}`))
      
      this.cleanupRuntime(task.id)
    })

    child.on('error', err => {
      this.handleError(task, runtime, err)
      this.cleanupRuntime(task.id)
    })
  }

  private async runYtdlp(task: DownloadTask) {
    const runtime = this.runtime.get(task.id)!
    const ytdlpPath = getBinaryPath('yt-dlp')
    
    if (!existsSync(ytdlpPath)) {
      return this.handleError(task, runtime, new Error('yt-dlp binary missing'))
    }

    task.status = 'downloading'
    this.broadcastUpdate(task)
    runtime.abortController = new AbortController()

    const args = [
      '--no-playlist', '--progress', '--newline', '--no-check-certificate',
      '--concurrent-fragments', '8', '--resize-buffer',
      '--output', task.filePath,
      task.url
    ]

    if (task.targetFormat === 'mp3') {
      args.push('--extract-audio', '--audio-format', 'mp3', '--audio-quality', '0')
    } else {
      const format = task.ytdlpFormatId 
        ? `${task.ytdlpFormatId}+bestaudio/best`
        : 'bestvideo[fps>=50]+bestaudio/bestvideo+bestaudio/best'
      args.push('-f', format, '--merge-output-format', 'mp4')
    }

    if (task.cookieFile) args.push('--cookies', task.cookieFile)
    else if (task.cookieBrowser) args.push('--cookies-from-browser', task.cookieBrowser)
    
    if (task.username) args.push('--username', task.username)
    if (task.password) args.push('--password', task.password)

    const denoPath = getBinaryPath('deno')
    if (existsSync(denoPath)) args.push('--js-runtimes', `deno:${denoPath}`)

    const ffmpegPath = getBinaryPath('ffmpeg')
    if (existsSync(ffmpegPath)) args.push('--ffmpeg-location', path.dirname(ffmpegPath))

    const child = spawn(ytdlpPath, args, { windowsHide: true })
    runtime.child = child

    child.stdout.on('data', data => this.parseYtdlpOutput(data.toString(), task))
    
    let stderr = ''
    child.stderr.on('data', d => stderr += d.toString())

    child.on('close', async code => {
      if (runtime.abortController?.signal.aborted) return

      if (code === 0) {
        const size = await this.getFileSize(task.filePath)
        if (size > 0) {
          task.totalBytes = size
          task.downloadedBytes = size
        }
        this.completeTask(task)
      } else {
        this.handleError(task, runtime, new Error(this.parseYtdlpError(stderr, code)))
      }
      this.cleanupRuntime(task.id)
    })
  }

  // --- Helpers ---

  private parseYtdlpOutput(output: string, task: DownloadTask) {
    const lines = output.split(/\r?\n/)
    let updated = false

    for (const line of lines) {
      if (!line) continue

      if (line.includes('[Merger]')) {
        task.status = 'merging'
        updated = true
        continue
      }

      const progressMatch = /\[download\]\s+(\d+(?:\.\d+)?)%\s+of\s+~?(\d+(?:\.\d+)?)(KiB|MiB|GiB|B)/i.exec(line)
      if (progressMatch) {
        const [, percent, size, unit] = progressMatch
        const multipliers: Record<string, number> = { kib: 1024, mib: 1024**2, gib: 1024**3, b: 1 }
        
        const total = parseFloat(size) * (multipliers[unit.toLowerCase()] || 1)
        if (total > (task.totalBytes || 0)) task.totalBytes = total
        
        task.downloadedBytes = (task.totalBytes || 0) * (parseFloat(percent) / 100)
        updated = true
      }
      
      const speedMatch = /at\s+(\d+(?:\.\d+)?)(KiB|MiB|GiB|B)\/s/i.exec(line)
      if (speedMatch) {
        const [, val, unit] = speedMatch
        const multipliers: Record<string, number> = { kib: 1024, mib: 1024**2, gib: 1024**3, b: 1 }
        task.speedBytesPerSec = parseFloat(val) * (multipliers[unit.toLowerCase()] || 1)
        updated = true
      }
    }

    if (updated) this.broadcastUpdate(task)
  }

  private parseYtdlpError(stderr: string, code: number | null): string {
    if (stderr.includes('HTTP Error 403')) return 'Access Forbidden (403) - Try refreshing cookies'
    if (stderr.includes('Sign in to confirm')) return 'Authentication required - Bot detection triggered'
    return `Engine failed with code ${code}: ${stderr.slice(0, 100)}...`
  }

  private completeTask(task: DownloadTask) {
    task.status = 'completed'
    task.updatedAtMs = Date.now()
    task.speedBytesPerSec = null
    this.persist()
    this.broadcastUpdate(task)
    this.notifyUser('Download Complete', `${task.filename} finished successfully`)
  }

  private handleError(task: DownloadTask, runtime: TaskRuntime, error: Error) {
    if (runtime.abortController?.signal.aborted) return

    if (runtime.retries < 3) {
      runtime.retries++
      task.status = 'queued'
      task.errorMessage = `Retrying (${runtime.retries}/3)...`
      this.broadcastUpdate(task)
      
      setTimeout(() => {
        this.activeTasks.delete(task.id)
        this.processQueue()
      }, 2000 * runtime.retries)
      return
    }

    task.status = 'error'
    task.errorMessage = error.message
    task.speedBytesPerSec = null
    this.persist()
    this.broadcastUpdate(task)
    this.notifyUser('Download Failed', error.message)
  }

  private cleanupRuntime(id: string) {
    this.activeTasks.delete(id)
    this.processQueue()
  }

  private async getFileSize(path: string): Promise<number> {
    try {
      const stats = await fs.stat(path)
      return stats.size
    } catch {
      return 0
    }
  }

  private updateSpeed(task: DownloadTask, runtime: TaskRuntime) {
    const now = Date.now()
    if (!runtime.lastSpeedSampleAtMs) {
      runtime.lastSpeedSampleAtMs = now
      runtime.lastSpeedSampleBytes = task.downloadedBytes
      return
    }

    const diff = now - runtime.lastSpeedSampleAtMs
    if (diff > 1000) {
      const bytesDiff = task.downloadedBytes - (runtime.lastSpeedSampleBytes || 0)
      task.speedBytesPerSec = (bytesDiff / diff) * 1000
      runtime.lastSpeedSampleAtMs = now
      runtime.lastSpeedSampleBytes = task.downloadedBytes
    }
  }

  private notifyUser(title: string, body: string) {
    if (Notification.isSupported()) {
      new Notification({ title, body }).show()
    }
  }
}

// Temporary export to satisfy import in this file until utils is updated
// This is not ideal but prevents immediate breakage if I don't update utils immediately
export { getBinaryPath }
