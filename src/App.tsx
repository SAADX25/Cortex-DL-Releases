import { useState, useEffect, useMemo } from 'react'
import { Play, FolderOpen, Trash2, X, Youtube, Facebook, Instagram, Clapperboard, ClipboardPaste, Wand2, RefreshCw, AlertTriangle, ShieldAlert } from 'lucide-react'
import './App.css'
import { translations, Language } from './translations'
import ConfirmModal from './ConfirmModal'
import { formatBytes, formatSpeed, statusLabel, variantLabel, isYtdlpUrl, DownloadStatus } from './utils'

function App() {
  // State
  const [url, setUrl] = useState('')
  const [directory, setDirectory] = useState<string | null>(() => localStorage.getItem('cortex-directory'))
  const [filename, setFilename] = useState('')
  const [tasks, setTasks] = useState<any[]>([])
  const [globalError, setGlobalError] = useState<string | null>(null)
  const [analyzeResult, setAnalyzeResult] = useState<any | null>(null)
  const [analyzing, setAnalyzing] = useState(false)
  
  // Settings & Preferences
  const [selectedVariantUrl, setSelectedVariantUrl] = useState<string | null>(null)
  const [targetFormat, setTargetFormat] = useState<'mp4' | 'mp3'>('mp4')
  const [selectedYtdlpFormatId, setSelectedYtdlpFormatId] = useState<string | null>(null)
  const [targetResolution, setTargetResolution] = useState<number | null>(null)
  
  const [cookieBrowser] = useState<string>(() => localStorage.getItem('cortex-cookie-browser') || 'none')
  const [cookieFile] = useState<string | null>(() => localStorage.getItem('cortex-cookie-file'))
  const [username] = useState<string>(() => localStorage.getItem('cortex-username') || '')
  const [password] = useState<string>(() => localStorage.getItem('cortex-password') || '')
  
  const [activeTab, setActiveTab] = useState<'add' | 'downloads' | 'settings'>('add')
  const [searchQuery, setSearchQuery] = useState('')
  const [lang, setLang] = useState<Language>(() => (localStorage.getItem('cortex-lang') as Language) || 'ar')
  const [notificationsEnabled] = useState(true)
  const [concurrentDownloads] = useState(3)
  const [totalDownloadedBytes, setTotalDownloadedBytes] = useState<number>(() => parseInt(localStorage.getItem('cortex-total-bytes') || '0', 10))
  
  const [enginesStatus, setEnginesStatus] = useState({ 
    ytdlp: true, ffmpeg: true, jsRuntime: true, jsRuntimeName: 'None' 
  })
  const [updateStatus, setUpdateStatus] = useState<{ status: string; percent?: number; error?: string } | null>(null)
  
  const [modalConfig, setModalConfig] = useState<{
    isOpen: boolean
    title: string
    message: string
    confirmText?: string
    cancelText?: string
    onConfirm: () => void
    type?: 'danger' | 'warning' | 'info'
  }>({
    isOpen: false,
    title: '',
    message: '',
    confirmText: 'Confirm',
    cancelText: 'Cancel',
    onConfirm: () => {},
    type: 'danger'
  })

  const t = translations[lang]

  // Effects
  useEffect(() => {
    const checkEngine = async () => {
      try {
        setEnginesStatus(await window.cortexDl.checkEngines())
      } catch (err) {
        console.error('Engine check failed:', err)
      }
    }
    checkEngine()
    const timer = setInterval(checkEngine, 10000)
    return () => clearInterval(timer)
  }, [])

  useEffect(() => {
    document.documentElement.dir = lang === 'ar' ? 'rtl' : 'ltr'
    localStorage.setItem('cortex-lang', lang)
  }, [lang])

  useEffect(() => {
    return window.cortexDl.onUpdateStatus((status) => {
      setUpdateStatus(status)
      if (['not-available', 'error'].includes(status.status)) {
        setTimeout(() => setUpdateStatus(null), 5000)
      }
    })
  }, [])

  // Persist Settings
  useEffect(() => { if (directory) localStorage.setItem('cortex-directory', directory) }, [directory])
  useEffect(() => { localStorage.setItem('cortex-cookie-browser', cookieBrowser) }, [cookieBrowser])
  useEffect(() => { 
    if (cookieFile) localStorage.setItem('cortex-cookie-file', cookieFile)
    else localStorage.removeItem('cortex-cookie-file')
  }, [cookieFile])
  useEffect(() => { localStorage.setItem('cortex-username', username) }, [username])
  useEffect(() => { localStorage.setItem('cortex-password', password) }, [password])
  useEffect(() => { localStorage.setItem('cortex-notifications', String(notificationsEnabled)) }, [notificationsEnabled])
  useEffect(() => { localStorage.setItem('cortex-concurrent', String(concurrentDownloads)) }, [concurrentDownloads])
  useEffect(() => { localStorage.setItem('cortex-total-bytes', String(totalDownloadedBytes)) }, [totalDownloadedBytes])

  // Initial Load & Listeners
  useEffect(() => {
    let dispose: (() => void) | null = null
    let statsDispose: (() => void) | null = null
    
    const init = async () => {
      try {
        const initial = await window.cortexDl.listDownloads()
        setTasks(initial)
        
        dispose = window.cortexDl.onDownloadUpdated((task) => {
          setTasks((prev) => {
            const idx = prev.findIndex((t) => t.id === task.id)
            if (idx === -1) return [task, ...prev]
            const next = [...prev]
            next[idx] = task
            return next
          })
        })

        statsDispose = window.cortexDl.onStatsUpdated(({ addedBytes }) => {
           setTotalDownloadedBytes(current => current + addedBytes)
        })
      } catch (err) {
        setGlobalError(err instanceof Error ? err.message : t.error_occurred)
      }
    }
    
    init()
    return () => { dispose?.(); statsDispose?.() }
  }, [t.error_occurred])

  // Reset analysis on URL change
  useEffect(() => {
    setAnalyzeResult(null)
    setSelectedVariantUrl(null)
    setTargetResolution(null)
    setSelectedYtdlpFormatId(null)
  }, [url])

  // Drag & Drop
  useEffect(() => {
    const preventDefaults = (e: DragEvent) => { e.preventDefault(); e.stopPropagation() }
    const handleDrop = (e: DragEvent) => {
      preventDefaults(e)
      const droppedText = e.dataTransfer?.getData('text') || e.dataTransfer?.getData('url')
      if (droppedText?.startsWith('http')) {
        setUrl(droppedText)
        setActiveTab('add')
      }
    }

    window.addEventListener('dragover', preventDefaults)
    window.addEventListener('drop', handleDrop)
    return () => {
      window.removeEventListener('dragover', preventDefaults)
      window.removeEventListener('drop', handleDrop)
    }
  }, [])

  // Handlers
  const handleCheckUpdates = async () => {
    setUpdateStatus({ status: 'checking' })
    try {
      await window.cortexDl.checkForUpdates()
    } catch {
      setUpdateStatus({ status: 'error' })
    }
  }

  const handleResetStats = () => {
    setModalConfig({
      isOpen: true,
      title: t.reset_stats,
      message: t.confirm_reset_stats,
      confirmText: t.modal_confirm,
      cancelText: t.modal_cancel,
      type: 'warning',
      onConfirm: () => {
        setTotalDownloadedBytes(0)
        setModalConfig(prev => ({ ...prev, isOpen: false }))
      }
    })
  }

  const handleUninstall = () => {
    setModalConfig({
      isOpen: true,
      title: t.settings_modal_title,
      message: t.settings_modal_desc,
      confirmText: t.settings_confirm_uninstall,
      cancelText: t.settings_cancel,
      type: 'danger',
      onConfirm: async () => {
        try {
          await window.cortexDl.uninstallApp()
        } catch {
          await window.cortexDl.openExternal('ms-settings:appsfeatures')
        }
        setModalConfig(prev => ({ ...prev, isOpen: false }))
      }
    })
  }

  const handlePasteAnalyze = async () => {
    setGlobalError(null)
    try {
      const text = await navigator.clipboard.readText()
      if (text?.trim()) {
        setUrl(text)
        setTimeout(() => handleAnalyze(text), 50)
      } else {
        setGlobalError(t.analyze_failed)
      }
    } catch {
      setGlobalError(t.analyze_failed)
    }
  }

  const handleAnalyze = async (inputUrl: string) => {
    setGlobalError(null)
    setAnalyzing(true)
    setAnalyzeResult(null)
    setSelectedVariantUrl(null)
    
    try {
      const result = await window.cortexDl.analyzeUrl(inputUrl.trim(), cookieBrowser)
      setAnalyzeResult(result)
      
      if (result.kind === 'hls-media') setSelectedVariantUrl(result.url)
      if (result.kind === 'hls-master') setSelectedVariantUrl(result.variants[0]?.url ?? null)
      if (result.kind === 'ytdlp') {
        setFilename(result.title)
        setTargetResolution(null)
        setSelectedYtdlpFormatId(null)
      }
    } catch (err) {
      setGlobalError(err instanceof Error ? err.message : t.analyze_failed)
    } finally {
      setAnalyzing(false)
    }
  }

  const handleStartDownload = async () => {
    setGlobalError(null)
    if (!directory) return

    if (analyzeResult?.kind === 'playlist') {
      try {
        for (const item of analyzeResult.items) {
          await window.cortexDl.addDownload({
            url: item.url,
            directory,
            engine: 'ytdlp',
            targetFormat,
            title: item.title,
            thumbnail: item.thumbnail,
            cookieBrowser,
            cookieFile: cookieFile || undefined,
            username: username || undefined,
            password: password || undefined,
          })
        }
        resetForm()
      } catch (err) {
        setGlobalError(err instanceof Error ? err.message : t.download_start_failed)
      }
      return
    }

    try {
      const finalUrl = selectedVariantUrl ?? url.trim()
      const engine = determineEngine(finalUrl, analyzeResult)
      let finalFormatId = selectedYtdlpFormatId

      // Auto-select best format for resolution constraint
      if (analyzeResult?.kind === 'ytdlp' && targetFormat === 'mp4' && targetResolution) {
        const best = analyzeResult.formats
          .filter((f: any) => {
            if (f.resolution === 'audio only') return false
            const h = parseInt((/(\d+)x(\d+)/.exec(f.resolution) || [])[2] || '0', 10)
            return h <= targetResolution
          })
          .sort((a: any, b: any) => {
             // Sort by resolution height descending
             const hA = parseInt((/(\d+)x(\d+)/.exec(a.resolution) || [])[2] || '0', 10)
             const hB = parseInt((/(\d+)x(\d+)/.exec(b.resolution) || [])[2] || '0', 10)
             return hB - hA
          })[0]
          
        if (best) finalFormatId = best.formatId
      }

      await window.cortexDl.addDownload({
        url: finalUrl,
        directory,
        filename: filename.trim() || undefined,
        engine,
        targetFormat,
        ytdlpFormatId: finalFormatId ? finalFormatId.replace('raw:', '') : undefined,
        title: analyzeResult?.kind === 'ytdlp' ? analyzeResult.title : undefined,
        thumbnail: analyzeResult?.kind === 'ytdlp' ? analyzeResult.thumbnail : undefined,
        cookieBrowser,
        cookieFile: cookieFile || undefined,
        username: username || undefined,
        password: password || undefined,
      })
      resetForm()
    } catch (err) {
      setGlobalError(err instanceof Error ? err.message : t.download_start_failed)
    }
  }

  const resetForm = () => {
    setUrl('')
    setFilename('')
    setAnalyzeResult(null)
    setSelectedVariantUrl(null)
    setActiveTab('downloads')
  }

  const determineEngine = (url: string, result: any) => {
    if (result?.kind === 'ytdlp' || isYtdlpUrl(url)) return 'ytdlp'
    if (result?.kind?.startsWith('hls') || /\.m3u8/.test(url) || targetFormat === 'mp3') return 'ffmpeg'
    return 'direct'
  }

  const handleDelete = (id: string, deleteFile: boolean) => {
    setModalConfig({
      isOpen: true,
      title: deleteFile ? t.btn_delete : t.btn_remove,
      message: deleteFile ? t.msg_delete_file_confirm : t.msg_remove_list_confirm,
      confirmText: t.modal_confirm,
      cancelText: t.modal_cancel,
      type: deleteFile ? 'danger' : 'warning',
      onConfirm: async () => {
        try {
          await window.cortexDl.deleteDownload(id, deleteFile)
          setTasks(prev => prev.filter(t => t.id !== id))
          setModalConfig(prev => ({ ...prev, isOpen: false }))
        } catch (err) {
          setGlobalError(err instanceof Error ? err.message : t.delete_failed)
        }
      }
    })
  }

  // Filtered Tasks
  const filteredTasks = useMemo(() => {
    const q = searchQuery.toLowerCase()
    return tasks.filter(t => 
      (t.title || t.filename || '').toLowerCase().includes(q) || 
      (t.url || '').toLowerCase().includes(q)
    )
  }, [tasks, searchQuery])

  const canStart = url.trim().length > 0 && !!directory && !!analyzeResult && !analyzing

  return (
    <div className="app-container" dir={lang === 'ar' ? 'rtl' : 'ltr'}>
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-logo">C</div>
          <div className="brand-name">Cortex DL</div>
        </div>
        
        <nav className="nav-menu">
          {['add', 'downloads', 'settings'].map(tab => (
            <button 
              key={tab}
              className={`nav-item ${activeTab === tab ? 'active' : ''}`} 
              onClick={() => setActiveTab(tab as any)}
            >
              <span className="nav-icon">{tab === 'add' ? '➕' : tab === 'downloads' ? '📥' : '⚙️'}</span>
              <span className="nav-text">{t[`nav_${tab}` as keyof typeof t]}</span>
              {tab === 'downloads' && tasks.some(t => t.status === 'downloading') && (
                <span className="nav-badge">{tasks.filter(t => t.status === 'downloading').length}</span>
              )}
            </button>
          ))}
        </nav>

        <div className="sidebar-footer">
          <div className={`status-dot ${Object.values(enginesStatus).every(Boolean) ? 'online' : 'offline'}`}></div>
          <div className="status-details">
            {Object.values(enginesStatus).every(Boolean) ? t.engine_ready : 'System Check Failed'}
          </div>
        </div>
      </aside>

      <main className="main-content">
        {activeTab === 'add' && (
          <div className="tab-content fade-in centered-layout">
            <header className="content-header centered-header">
              <h1 className="gradient-text">{t.add_title}</h1>
              <p className="muted">{t.add_subtitle}</p>
            </header>

            <section className="minimal-panel">
              <div className="input-group">
                <div className="hero-input-container">
                  <div className="hero-input-wrapper">
                    <input
                      className="hero-input"
                      value={url}
                      onChange={(e) => setUrl(e.target.value)}
                      placeholder={t.url_placeholder}
                    />
                    {url && <button className="hero-clear-btn" onClick={() => setUrl('')}><X size={20} /></button>}
                    
                    <button 
                      className="hero-action-btn" 
                      onClick={url.trim().length === 0 ? handlePasteAnalyze : () => handleAnalyze(url)} 
                      disabled={analyzing}
                    >
                      {analyzing ? <div className="spinner-sm"></div> : (
                        url.trim().length === 0 ? <><ClipboardPaste size={20} /><span>Paste & Go</span></> : <><Wand2 size={20} /><span>{t.analyze_btn}</span></>
                      )}
                    </button>
                  </div>
                </div>

                <div className="modern-chips-grid">
                  <div className="chip-group">
                    <button className={`modern-chip ${targetFormat === 'mp4' ? 'chip-active-blue' : ''}`} onClick={() => setTargetFormat('mp4')}>Video MP4</button>
                    <button className={`modern-chip ${targetFormat === 'mp3' ? 'chip-active-purple' : ''}`} onClick={() => setTargetFormat('mp3')}>Audio MP3</button>
                  </div>
                  
                  <div className="chip-group">
                     <div className="folder-chip" onClick={async () => {
                       const picked = await window.cortexDl.selectFolder()
                       if (picked) setDirectory(picked)
                     }}>
                        <span className="folder-icon">📁</span>
                        <span className="folder-text">{directory ? directory.split(/[\\/]/).pop() : t.choose_folder}</span>
                     </div>
                  </div>
                </div>

                {analyzeResult && (
                  <div className="advanced-options fade-in">
                    {analyzeResult.kind === 'hls-master' && (
                      <div className="option-box">
                        <label className="option-label">{t.quality_label}</label>
                        <select className="quality-select" value={selectedVariantUrl ?? ''} onChange={(e) => setSelectedVariantUrl(e.target.value)}>
                          {analyzeResult.variants.map((v: any) => <option value={v.url} key={v.url}>{variantLabel(v, lang)}</option>)}
                        </select>
                      </div>
                    )}
                    
                    {analyzeResult.kind === 'ytdlp' && targetFormat === 'mp4' && (
                      <div className="option-box">
                        <label className="option-label">{t.quality_label}</label>
                        <select
                          className="quality-select"
                          value={targetResolution ?? ''}
                          onChange={(e) => {
                            const val = e.target.value
                            if (val.startsWith('raw:')) {
                              setTargetResolution(null)
                              setSelectedYtdlpFormatId(val.replace('raw:', ''))
                            } else {
                              setTargetResolution(val ? parseInt(val, 10) : null)
                              setSelectedYtdlpFormatId(null)
                            }
                          }}
                        >
                          <option value="">{t.quality_best}</option>
                          {[2160, 1440, 1080, 720, 480, 360].map(r => <option value={r} key={r}>{t[`quality_${r}p` as keyof typeof t] || `${r}p`}</option>)}
                          <optgroup label="Detailed Formats">
                            {analyzeResult.formats.filter((f: any) => f.resolution !== 'audio only').map((f: any) => (
                              <option value={`raw:${f.formatId}`} key={f.formatId}>{f.resolution} ({f.ext}) {f.description}</option>
                            ))}
                          </optgroup>
                        </select>
                      </div>
                    )}
                  </div>
                )}

                {analyzeResult?.kind === 'playlist' && (
                  <div className="playlist-preview fade-in">
                    <div className="playlist-header">
                      <h3>🎬 {t.playlist_title}: {analyzeResult.title}</h3>
                      <span className="badge">{analyzeResult.items.length} {t.items_count}</span>
                    </div>
                    <div className="playlist-items">
                      {analyzeResult.items.slice(0, 10).map((item: any) => (
                        <div key={item.id} className="playlist-item">
                          {item.thumbnail && <img src={item.thumbnail} alt="" />}
                          <span title={item.title}>{item.title}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {analyzeResult && analyzeResult.kind !== 'playlist' && (
                  <div className="video-preview-large fade-in">
                    {analyzeResult.kind === 'ytdlp' && analyzeResult.thumbnail && (
                      <img src={analyzeResult.thumbnail} alt="thumb" className="preview-thumb-large" />
                    )}
                    <div className="preview-info-large">
                      <div className="preview-title-large">{analyzeResult.kind === 'ytdlp' ? analyzeResult.title : 'HLS Stream'}</div>
                    </div>
                  </div>
                )}
                
                <button className={`download-main-btn-large ${!canStart ? 'hidden' : 'fade-in'}`} onClick={handleStartDownload} disabled={!canStart}>
                 {analyzeResult?.kind === 'playlist' ? t.download_all : t.start_download}
               </button>
              </div>

              {globalError && <div className="global-error-banner">{globalError}</div>}
            </section>
            
            <div className="quick-access-bar-minimal">
              {[
                { url: 'https://www.youtube.com', Icon: Youtube, color: 'youtube' },
                { url: 'https://www.facebook.com', Icon: Facebook, color: 'facebook' },
                { url: 'https://www.instagram.com', Icon: Instagram, color: 'instagram' },
                { url: 'https://www.tiktok.com', Icon: Clapperboard, color: 'tiktok' }
              ].map(site => (
                <button key={site.url} className={`brand-icon-btn ${site.color}`} onClick={() => window.cortexDl.openExternal(site.url)}>
                  <site.Icon size={20} />
                </button>
              ))}
            </div>
          </div>
        )}

        {activeTab === 'downloads' && (
          <div className="tab-content fade-in">
            <header className="content-header flex-col" style={{ flexDirection: 'column', gap: '1rem', alignItems: 'center' }}>
              <div style={{ width: '100%', textAlign: 'left' }}>
                <h1>{t.downloads_title}</h1>
                <p className="muted">{t.total_tasks}: {tasks.length}</p>
              </div>
              <div className="search-bar-centered" style={{ width: '100%', display: 'flex', justifyContent: 'center', margin: '1rem 0' }}>
                <div className="search-bar-container" style={{ position: 'relative', width: '100%', maxWidth: '500px' }}>
                  <input type="text" placeholder={t.search_placeholder} value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} className="search-input-centered" />
                  {searchQuery && (
                    <button className="clear-search-btn" onClick={() => setSearchQuery('')} style={{ position: 'absolute', right: '15px', top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', color: '#999', cursor: 'pointer' }}>
                      <X size={18} />
                    </button>
                  )}
                </div>
              </div>
            </header>
            
            <section className="downloads-list">
              <div className="task-grid">
                {filteredTasks.map((task) => {
                  const percent = task.totalBytes ? Math.min(100, Math.round((task.downloadedBytes / task.totalBytes) * 100)) : 0
                  const isStarting = task.status === 'downloading' && percent === 0
                  
                  return (
                    <div className={`modern-task-card ${task.status}`} key={task.id}>
                      <div className="card-thumb">
                        {task.thumbnail ? <img src={task.thumbnail} alt="thumb" /> : <div className="thumb-placeholder">{task.targetFormat === 'mp3' ? '🎵' : '🎬'}</div>}
                      </div>
                      <div className="card-body">
                        <div className="card-header">
                          <h4 title={task.title || task.filename}>{task.title || task.filename}</h4>
                          <span className={`format-tag ${task.targetFormat}`}>{task.targetFormat}</span>
                        </div>
                        <div className="card-meta-row">
                          <div className={`status-label-new ${task.status}`}>
                            {task.status === 'downloading' && <span className="pulse-dot"></span>}
                            {statusLabel(task.status as DownloadStatus, lang)}
                          </div>
                          {(['downloading', 'completed', 'merging'].includes(task.status)) && (
                            <div className="stats-container">
                              {isStarting ? (
                                <div className="stat-item pulse-text">{t.accelerating}</div>
                              ) : task.status === 'merging' ? (
                                <div className="stat-item accent-text">{t.merging}</div>
                              ) : (
                                <>
                                  {task.status === 'downloading' && <div className="stat-item">⚡ {formatSpeed(task.speedBytesPerSec, lang)}</div>}
                                  <div className="stat-item">📦 {formatBytes(task.downloadedBytes)} / {formatBytes(task.totalBytes || 0)}</div>
                                </>
                              )}
                            </div>
                          )}
                        </div>
                        <div className="card-progress-area">
                          <div className="bar-bg">
                            <div className={`bar-fill ${task.status} ${isStarting ? 'indeterminate' : ''}`} style={{ width: isStarting ? '100%' : `${percent}%` }}></div>
                          </div>
                          <div className="bar-info"><span className="bar-percent">{isStarting ? '' : `${percent}%`}</span></div>
                        </div>
                        {task.errorMessage && <div className="card-error-msg">{task.errorMessage}</div>}
                        <div className="card-actions-area">
                          <div className="action-btn-group">
                            {['downloading', 'queued'].includes(task.status) && <button className="btn-icon-text primary" onClick={() => window.cortexDl.pauseDownload(task.id)}>{t.btn_pause}</button>}
                            {['paused', 'error'].includes(task.status) && <button className="btn-icon-text success" onClick={() => window.cortexDl.resumeDownload(task.id)}>{t.btn_resume}</button>}
                            {task.status !== 'completed' && <button className="btn-icon-text danger" onClick={() => window.cortexDl.cancelDownload(task.id)}>{t.btn_cancel}</button>}
                            {task.status === 'completed' && (
                              <>
                                <button className="btn-icon ghost-success" onClick={() => window.cortexDl.openFile(task.filePath)}><Play size={20} /></button>
                                <button className="btn-icon ghost-warning" onClick={() => window.cortexDl.openFolder(task.filePath)}><FolderOpen size={20} /></button>
                              </>
                            )}
                          </div>
                          <div className="action-btn-group">
                            <button className="btn-icon-text ghost" onClick={() => handleDelete(task.id, false)}>{t.btn_remove}</button>
                            <button className="btn-icon ghost-danger" onClick={() => handleDelete(task.id, true)}><Trash2 size={20} /></button>
                          </div>
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            </section>
          </div>
        )}

        {activeTab === 'settings' && (
          <div className="tab-content fade-in centered-layout">
            <header className="content-header centered-header">
              <h1 className="gradient-text">{t.settings_title}</h1>
              <p className="muted">{t.settings_subtitle}</p>
            </header>

            <section className="minimal-panel" style={{ gap: '3rem' }}>
              <div className="settings-hero-stats">
                 <div className="hero-stat-value gradient-text-large">{formatBytes(totalDownloadedBytes)}</div>
                 <div className="hero-stat-label">
                   {t.total_downloaded}
                   <button className="reset-icon-btn" onClick={handleResetStats} title={t.reset_stats}><RefreshCw size={14} /></button>
                 </div>
              </div>

              <div className="settings-section">
                <h3 className="section-header">{t.settings_general}</h3>
                <div className="minimal-row">
                  <span className="row-title">{t.language_label}</span>
                  <div className="custom-select-wrapper">
                    <select className="custom-select" value={lang} onChange={(e) => setLang(e.target.value as Language)}>
                      <option value="en">English</option>
                      <option value="ar">العربية</option>
                    </select>
                  </div>
                </div>

                <div className="minimal-row">
                   <div className="row-info">
                     <span className="row-title">{t.check_for_updates}</span>
                     <span className="row-subtitle">
                        {updateStatus ? `${updateStatus.status} ${updateStatus.percent ? updateStatus.percent + '%' : ''}` : `v${__APP_VERSION__}`}
                     </span>
                   </div>
                   <div className="row-control">
                      {updateStatus?.status === 'downloaded' ? (
                        <button className="btn-ghost-success" onClick={() => window.cortexDl.restartApp()}>{t.update_downloaded}</button>
                      ) : (
                        <button className="btn-ghost-primary" onClick={handleCheckUpdates} disabled={['checking', 'available', 'progress'].includes(updateStatus?.status || '')}>
                          <RefreshCw size={16} className={updateStatus?.status === 'checking' ? 'spin' : ''} />
                          <span>{t.check_for_updates}</span>
                        </button>
                      )}
                   </div>
                </div>
              </div>

              <div className="settings-section danger-zone">
                 <h3 className="section-header danger-text"><AlertTriangle size={18} /> {t.settings_danger_zone}</h3>
                 <div className="minimal-row danger-row">
                    <div className="row-info">
                       <span className="row-title">{t.settings_uninstall_title}</span>
                       <span className="row-subtitle">{t.settings_uninstall_desc}</span>
                    </div>
                    <button className="btn-danger-outline" onClick={handleUninstall}>
                       <ShieldAlert size={16} />
                       <span>{t.settings_uninstall_btn}</span>
                    </button>
                 </div>
              </div>
            </section>
          </div>
        )}
      </main>
      
      <ConfirmModal
        isOpen={modalConfig.isOpen}
        title={modalConfig.title}
        message={modalConfig.message}
        confirmText={modalConfig.confirmText}
        cancelText={modalConfig.cancelText}
        type={modalConfig.type}
        dir={lang === 'ar' ? 'rtl' : 'ltr'}
        onConfirm={modalConfig.onConfirm}
        onCancel={() => setModalConfig(prev => ({ ...prev, isOpen: false }))}
      />
    </div>
  )
}

export default App
