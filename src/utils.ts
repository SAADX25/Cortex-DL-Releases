import { Language, translations } from './translations'

export type DownloadStatus = 'queued' | 'downloading' | 'merging' | 'paused' | 'completed' | 'error' | 'canceled'

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '-'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let value = bytes
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit += 1
  }
  return `${value.toFixed(unit === 0 ? 0 : value < 10 ? 2 : value < 100 ? 1 : 0)} ${units[unit]}`
}

export function formatSpeed(speedBytesPerSec: number | null, lang: Language): string {
  if (speedBytesPerSec == null) return '-'
  return `${formatBytes(speedBytesPerSec)}/${translations[lang].speed_unit}`
}

export function statusLabel(status: DownloadStatus, lang: Language): string {
  const t = translations[lang]
  const labels: Record<DownloadStatus, string> = {
    queued: t.status_queued,
    downloading: t.status_downloading,
    merging: t.status_merging,
    paused: t.status_paused,
    completed: t.status_completed,
    error: t.status_error,
    canceled: t.status_canceled
  }
  return labels[status] || ''
}

export function variantLabel(v: any, lang: Language): string {
  const res = v.resolution ? `${v.resolution.height}p` : null
  const bw = v.bandwidth ? `${Math.round(v.bandwidth / 1000)} kbps` : null
  
  if (res && bw) return `${res} • ${bw}`
  if (res) return res
  if (bw) return bw
  return translations[lang].quality_placeholder
}

export function isYtdlpUrl(url: string): boolean {
  const lowUrl = url.toLowerCase()
  const domains = [
    'youtube.com', 'youtu.be', 'facebook.com', 'fb.watch', 
    'instagram.com', 'tiktok.com', 'twitter.com', 'x.com', 
    'vimeo.com', 'dailymotion.com'
  ]
  
  if (domains.some(d => lowUrl.includes(d))) return true
  if (/\.(mp4|mp3|m4a|webm|mkv|avi|m3u8)(\?|#|$)/i.test(lowUrl)) return false
  
  return true
}
