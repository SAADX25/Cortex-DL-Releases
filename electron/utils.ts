import { app } from 'electron'
import path from 'node:path'
import { existsSync } from 'node:fs'
import { spawn } from 'node:child_process'

export const IS_DEV = !app.isPackaged

export function getBinaryPath(name: string): string {
  const binaryName = process.platform === 'win32' ? `${name}.exe` : name
  const basePath = IS_DEV 
    ? path.join(process.env.APP_ROOT || process.cwd(), 'bin')
    : path.join(process.resourcesPath, 'bin')
    
  if (IS_DEV && !existsSync(path.join(basePath, binaryName))) {
    return path.join(process.cwd(), 'bin', binaryName)
  }
  return path.join(basePath, binaryName)
}

export function getCookiesPath(): string | null {
  const fileName = 'cookies.txt'
  const devPath = path.join(process.env.APP_ROOT || process.cwd(), fileName)
  const prodPath = path.join(process.resourcesPath, fileName)
  
  if (IS_DEV) {
    return existsSync(devPath) ? devPath : (existsSync(path.join(process.cwd(), fileName)) ? path.join(process.cwd(), fileName) : null)
  }
  return existsSync(prodPath) ? prodPath : null
}

export async function isFfmpegAvailable(): Promise<boolean> {
  try {
    const child = spawn(getBinaryPath('ffmpeg'), ['-version'], { windowsHide: true })
    return await new Promise<boolean>(resolve => {
      child.on('close', code => resolve(code === 0))
      child.on('error', () => resolve(false))
    })
  } catch {
    return false
  }
}

export async function isYtdlpAvailable(): Promise<boolean> {
  try {
    const child = spawn(getBinaryPath('yt-dlp'), ['--version'], { windowsHide: true })
    return await new Promise<boolean>(resolve => {
      child.on('close', code => resolve(code === 0))
      child.on('error', () => resolve(false))
    })
  } catch {
    return false
  }
}

export function getJsRuntimeArgs(): string[] {
  const denoPath = getBinaryPath('deno')
  if (existsSync(denoPath)) return ['--js-runtimes', `deno:${denoPath}`]
  
  const nodePath = getBinaryPath('node')
  if (existsSync(nodePath)) return ['--js-runtimes', `node:${nodePath}`]
  
  return ['--js-runtimes', 'node']
}

export async function checkJsRuntime(): Promise<{ available: boolean; name: string }> {
  try {
    const args = [...getJsRuntimeArgs(), '--version']
    const child = spawn(getBinaryPath('yt-dlp'), args, { windowsHide: true })
    
    let stderr = ''
    child.stderr.on('data', d => stderr += d.toString())
    
    return await new Promise(resolve => {
      child.on('close', code => {
        if (code === 0 && !stderr.includes('No supported JavaScript runtime')) {
          const name = args[1].includes('deno') ? 'Deno' : 'Node'
          resolve({ available: true, name })
        } else {
          resolve({ available: false, name: 'None' })
        }
      })
      child.on('error', () => resolve({ available: false, name: 'None' }))
    })
  } catch {
    return { available: false, name: 'None' }
  }
}
