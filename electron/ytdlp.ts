import { spawn } from 'node:child_process'
import { createWriteStream, existsSync, promises as fs } from 'node:fs'
import { get } from 'node:https'
import { getBinaryPath, getCookiesPath, getJsRuntimeArgs, isYtdlpAvailable, checkJsRuntime } from './utils'
import type { AnalyzeResult } from './hls'

export { isYtdlpAvailable, checkJsRuntime }

export async function updateYtdlp(): Promise<{ success: boolean; message: string }> {
  if (process.platform !== 'win32') {
    return { success: false, message: 'Auto-update is only supported on Windows.' }
  }

  const binaryPath = getBinaryPath('yt-dlp')
  const url = 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe'
  const tempPath = `${binaryPath}.tmp`

  return new Promise((resolve) => {
    const file = createWriteStream(tempPath)
    
    const request = get(url, (response) => {
      if (response.statusCode === 302 && response.headers.location) {
        // Handle redirect
        get(response.headers.location, (redirectRes) => {
          if (redirectRes.statusCode !== 200) {
             resolve({ success: false, message: `Update server error: ${redirectRes.statusCode}` })
             return
          }
          redirectRes.pipe(file)
          file.on('finish', () => finalizeUpdate())
        }).on('error', (err) => resolve({ success: false, message: `Download error: ${err.message}` }))
        return
      }

      if (response.statusCode !== 200) {
        resolve({ success: false, message: `Update server error: ${response.statusCode}` })
        return
      }

      response.pipe(file)
      file.on('finish', () => finalizeUpdate())
    })

    request.on('error', (err) => resolve({ success: false, message: `Connection error: ${err.message}` }))

    async function finalizeUpdate() {
      file.close()
      try {
        if (existsSync(binaryPath)) await fs.unlink(binaryPath)
        await fs.rename(tempPath, binaryPath)
        resolve({ success: true, message: 'Engine updated successfully!' })
      } catch (err) {
        resolve({ success: false, message: 'Failed to replace binary. Ensure no downloads are running.' })
      }
    }
  })
}

export async function analyzeWithYtdlp(url: string, browser?: string, cookieFile?: string): Promise<AnalyzeResult> {
  const ytdlpPath = getBinaryPath('yt-dlp')
  
  if (!existsSync(ytdlpPath) || !(await isYtdlpAvailable())) {
    throw new Error('yt-dlp binary is missing or non-functional.')
  }

  return new Promise((resolve, reject) => {
    const args = [
      '--dump-json', '--no-playlist', '--flat-playlist', 
      '--no-check-certificate', '--geo-bypass', '--force-ipv4', 
      '--no-warnings', '--ignore-errors',
      '--extractor-args', 'youtube:player_client=android',
      '--user-agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36'
    ]

    args.push(...getJsRuntimeArgs())

    // Cookies priority: Global > File > Browser
    const globalCookies = getCookiesPath()
    if (globalCookies) args.push('--cookies', globalCookies)
    else if (cookieFile) args.push('--cookies', cookieFile)
    else if (browser && browser !== 'none') args.push('--cookies-from-browser', browser)

    args.push(url)

    const child = spawn(ytdlpPath, args, { windowsHide: true })
    let stdout = ''
    let stderr = ''

    child.stdout.on('data', d => stdout += d.toString())
    child.stderr.on('data', d => stderr += d.toString())

    child.on('close', (code) => {
      if (code !== 0) {
        console.error('[yt-dlp analysis]', stderr)
        if (stderr.includes('Sign in to confirm') || stderr.includes('not a bot')) {
          reject(new Error('Bot detection triggered. Try using cookies.txt or a browser session.'))
        } else {
          resolve({ kind: 'unknown' }) // Graceful fallback
        }
        return
      }

      try {
        const info = JSON.parse(stdout)
        
        if (info._type === 'playlist') {
          resolve({
            kind: 'playlist',
            title: info.title || 'Playlist',
            items: (info.entries || []).map((e: any) => ({
              id: e.id,
              title: e.title || 'Unknown',
              url: e.url || e.webpage_url,
              thumbnail: e.thumbnail || e.thumbnails?.[0]?.url
            }))
          })
          return
        }

        const formats = (info.formats || [])
          .filter((f: any) => (f.vcodec !== 'none' || f.acodec !== 'none') && f.protocol !== 'm3u8_native')
          .map((f: any) => ({
            formatId: f.format_id,
            ext: f.ext,
            resolution: f.resolution || (f.vcodec !== 'none' ? `${f.width}x${f.height}` : 'Audio Only'),
            filesize: f.filesize || f.filesize_approx || null,
            description: [f.format_note, f.fps && `${f.fps}fps`, f.tbr && `${Math.round(f.tbr)}kbps`].filter(Boolean).join(' '),
            tbr: f.tbr || 0,
            height: f.height || 0
          }))
          .sort((a: any, b: any) => b.height - a.height || b.tbr - a.tbr)

        resolve({
          kind: 'ytdlp',
          title: info.title || 'Unknown Title',
          thumbnail: info.thumbnail || info.thumbnails?.[0]?.url,
          formats
        })
      } catch (err) {
        console.error('JSON Parse Error:', err)
        resolve({ kind: 'unknown' })
      }
    })
  })
}
