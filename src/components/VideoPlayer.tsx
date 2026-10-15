import { useEffect, useRef, useState, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useStore } from '../store/useStore'
import { mediaUrl, fmtTime } from '../lib/util'
import { parseSubtitle, activeCues, SubtitleCue } from '../lib/subtitle'
import { tr } from '../i18n'
import {
  IconPlay, IconPause, IconPrev, IconNext, IconClose, IconFullscreen, IconFullscreenExit,
  IconSubtitle, IconGauge, IconRatio, IconCamera, IconQueue, IconVolume, IconVolumeX, IconFilm
} from './icons'

interface SidecarSub { name: string; path: string; lang: string }

const RATES = [0.5, 0.75, 1, 1.25, 1.5, 2]
const RATIOS: Array<{ v: 'contain' | 'cover' | 'fill'; label: string }> = [
  { v: 'contain', label: '适应' },
  { v: 'cover', label: '裁剪' },
  { v: 'fill', label: '拉伸' }
]

// Vivid Player 形态的播放器：
// 手势（左右拖动 seek / 左上亮度 / 右上音量 / 双击 ±10s / 长按 2x / 滚轮缩放 / 缩放后拖动平移）
// 外挂+内封字幕、倍速、画面比例、截图、PiP、播放队列、断点续播、控制栏自动隐藏
export default function VideoPlayer() {
  const playingId = useStore((s) => s.videoPlayingId)
  const items = useStore((s) => s.videoItems)
  const queue = useStore((s) => s.videoQueue)
  const videoProgress = useStore((s) => s.videoProgress)
  const closeVideo = useStore((s) => s.closeVideo)
  const videoNext = useStore((s) => s.videoNext)
  const openVideo = useStore((s) => s.openVideo)
  const saveVideoProgress = useStore((s) => s.saveVideoProgress)
  const lang = useStore((s) => s.settings.lang)

  const item = items.find((v) => v.id === playingId) || null
  const videoRef = useRef<HTMLVideoElement>(null)
  const rootRef = useRef<HTMLDivElement>(null)

  const [playing, setPlaying] = useState(false)
  const [time, setTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const [buffered, setBuffered] = useState(0)
  const [controlsOn, setControlsOn] = useState(true)
  const [isFullscreen, setIsFullscreen] = useState(false)
  const [rate, setRate] = useState(1)
  const [ratio, setRatio] = useState<'contain' | 'cover' | 'fill'>('contain')
  const [brightness, setBrightness] = useState(1)
  const [volume, setVolume] = useState(0.8)
  const [muted, setMuted] = useState(false)
  const [zoom, setZoom] = useState(1)
  const [pan, setPan] = useState({ x: 0, y: 0 })
  const [menu, setMenu] = useState<null | 'speed' | 'ratio' | 'sub' | 'substyle' | 'playlist'>(null)
  const [subs, setSubs] = useState<SidecarSub[]>([])
  const [embeddedSubs, setEmbeddedSubs] = useState<{ idx: number; label: string }[]>([])
  const [activeSub, setActiveSub] = useState<string | null>(null) // path 或 'embedded:<idx>' 或 'off'
  const [cues, setCues] = useState<SubtitleCue[]>([])
  const [subStyle, setSubStyle] = useState({ size: 22, bottom: 46, bg: 0.5 })
  const [osd, setOsd] = useState<{ text: string; sub?: string; key: number } | null>(null)
  const [speedHold, setSpeedHold] = useState(false)

  const hideTimer = useRef<number>(0)
  const osdTimer = useRef<number>(0)
  const gesture = useRef({
    x0: 0, y0: 0, t0: 0, mode: 'none' as 'none' | 'seek' | 'vol' | 'bright' | 'pan',
    dx: 0, dy: 0, startVol: 0.8, startBright: 1, moved: false,
    holdTimer: 0 as unknown as number, lastTap: 0, lastTapX: 0, startPanX: 0, startPanY: 0
  })

  const showOsd = useCallback((text: string, sub?: string) => {
    setOsd({ text, sub, key: Date.now() })
    window.clearTimeout(osdTimer.current)
    osdTimer.current = window.setTimeout(() => setOsd(null), 900)
  }, [])

  const kickHideTimer = useCallback(() => {
    setControlsOn(true)
    window.clearTimeout(hideTimer.current)
    hideTimer.current = window.setTimeout(() => {
      if (!videoRef.current?.paused) setControlsOn(false)
    }, 3200)
  }, [])

  // —— 播放源加载：新视频 → 载入 + 断点恢复 ——
  useEffect(() => {
    const v = videoRef.current
    if (!v || !item) return
    const url = mediaUrl(item.path)
    if (url) { v.src = url; v.load() }
    setTime(0); setDuration(item.duration || 0); setZoom(1); setPan({ x: 0, y: 0 }); setBrightness(1)
    kickHideTimer()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playingId])

  // 断点恢复
  const onMeta = () => {
    const v = videoRef.current
    if (!v || !item) return
    setDuration(v.duration || item.duration || 0)
    const saved = videoProgress[item.id]
    if (saved && saved.position > 5 && v.duration && saved.position / v.duration < 0.95) {
      try { v.currentTime = saved.position } catch { /* ignore */ }
      showOsd(fmtTime(saved.position), tr(lang, 'resumeFrom'))
    }
    v.play().catch(() => setPlaying(false))
    kickHideTimer()
  }

  // 断点落盘：每 5s + 暂停/切集/关闭
  const commit = useCallback(() => {
    const v = videoRef.current
    if (!v || !item || !v.duration) return
    saveVideoProgress(item.id, v.currentTime, v.duration)
  }, [item, saveVideoProgress])

  useEffect(() => {
    const t = setInterval(() => {
      const v = videoRef.current
      if (v && !v.paused && v.duration) saveVideoProgress(playingId!, v.currentTime, v.duration)
    }, 5000)
    return () => clearInterval(t)
  }, [playingId, saveVideoProgress])

  useEffect(() => {
    const onHide = () => commit()
    window.addEventListener('beforeunload', onHide)
    return () => {
      window.removeEventListener('beforeunload', onHide)
      commit()
    }
  }, [commit])

  // 字幕：sidecar 清单 + 内封轨道清单
  useEffect(() => {
    if (!item) return
    let cancelled = false
    setSubs([]); setActiveSub(null); setCues([]); setEmbeddedSubs([])
    ;(async () => {
      try {
        const side = await (window as any).electronAPI.mediaSidecar(item.path)
        if (!cancelled && side?.subtitles?.length) setSubs(side.subtitles)
      } catch { /* ignore */ }
    })()
    return () => { cancelled = true }
  }, [item])

  // 内封字幕轨道（loadedmetadata 后 textTracks 才可用）
  const scanTextTracks = useCallback(() => {
    const v = videoRef.current
    if (!v || !v.textTracks) return
    const list: { idx: number; label: string }[] = []
    for (let i = 0; i < v.textTracks.length; i++) {
      const t = v.textTracks[i]
      if (t.kind === 'subtitles' || t.kind === 'captions') {
        list.push({ idx: i, label: t.label || t.language || `轨道 ${i + 1}` })
      }
    }
    setEmbeddedSubs(list)
  }, [])

  const loadSubFile = async (sub: SidecarSub) => {
    try {
      const res = await (window as any).electronAPI.mediaReadText(sub.path)
      if (res?.text) {
        setCues(parseSubtitle(sub.name, res.text))
        setActiveSub(sub.path)
        setMenu(null)
      }
    } catch { /* ignore */ }
  }

  const useEmbedded = (idx: number) => {
    const v = videoRef.current
    if (!v?.textTracks) return
    for (let i = 0; i < v.textTracks.length; i++) {
      const t = v.textTracks[i]
      t.mode = i === idx ? 'showing' : 'disabled'
    }
    setCues([])
    setActiveSub(`embedded:${idx}`)
    setMenu(null)
  }

  const subsOff = () => {
    const v = videoRef.current
    if (v?.textTracks) for (let i = 0; i < v.textTracks.length; i++) v.textTracks[i].mode = 'disabled'
    setCues([]); setActiveSub('off'); setMenu(null)
  }

  // 内封字幕 cue 渲染（外挂走 cues 状态）
  const [embeddedCue, setEmbeddedCue] = useState('')
  useEffect(() => {
    if (!activeSub?.startsWith('embedded:')) { setEmbeddedCue(''); return }
    const v = videoRef.current
    if (!v?.textTracks) return
    const idx = Number(activeSub.slice(9))
    const track = v.textTracks[idx]
    if (!track) return
    const onCue = () => {
      const c = track.activeCues
      if (c && c.length) setEmbeddedCue(Array.from(c).map((x: any) => x.text).join('\n'))
      else setEmbeddedCue('')
    }
    track.addEventListener('cuechange', onCue)
    return () => track.removeEventListener('cuechange', onCue)
  }, [activeSub])

  // —— 手势 ——
  const onPointerDown = (e: React.PointerEvent) => {
    const v = videoRef.current
    if (!v) return
    ;(e.target as HTMLElement).setPointerCapture?.(e.pointerId)
    const g = gesture.current
    g.x0 = e.clientX; g.y0 = e.clientY; g.t0 = Date.now()
    g.mode = 'none'; g.dx = 0; g.dy = 0; g.moved = false
    g.startVol = v.volume; g.startBright = brightness
    g.startPanX = pan.x; g.startPanY = pan.y
    kickHideTimer()
    // 长按 2x
    g.holdTimer = window.setTimeout(() => {
      if (!g.moved && zoom <= 1.01) {
        setSpeedHold(true)
        v.playbackRate = 2
        showOsd('2x 快进中', '松开恢复')
      }
    }, 600) as unknown as number
  }

  const onPointerMove = (e: React.PointerEvent) => {
    const v = videoRef.current
    if (!v) return
    const g = gesture.current
    g.dx = e.clientX - g.x0
    g.dy = e.clientY - g.y0
    if (Math.abs(g.dx) > 10 || Math.abs(g.dy) > 10) {
      g.moved = true
      window.clearTimeout(g.holdTimer)
    }
    const rect = rootRef.current?.getBoundingClientRect()
    const w = rect?.width || 1
    if (g.mode === 'none') {
      if (zoom > 1.01 && g.moved) g.mode = 'pan'
      else if (Math.abs(g.dx) > 14) g.mode = 'seek'
      else if (Math.abs(g.dy) > 14) g.mode = g.x0 < (rect?.left || 0) + w / 3 ? 'bright' : 'vol'
    }
    if (g.mode === 'seek') {
      const delta = (g.dx / w) * 90
      const target = Math.max(0, Math.min(duration || v.duration, time + delta))
      showOsd(fmtTime(target), `${delta >= 0 ? '+' : ''}${Math.round(delta)}s`)
    } else if (g.mode === 'bright') {
      const b = Math.max(0.15, Math.min(1.6, g.startBright - g.dy / 300))
      setBrightness(b)
      showOsd(`${Math.round(b * 100)}%`, '亮度')
    } else if (g.mode === 'vol') {
      const vol = Math.max(0, Math.min(1, g.startVol - g.dy / 300))
      v.volume = vol
      setVolume(vol); setMuted(false)
      showOsd(`${Math.round(vol * 100)}%`, '音量')
    } else if (g.mode === 'pan') {
      setPan({
        x: Math.max(-1, Math.min(1, g.startPanX + g.dx / (w / 2))),
        y: Math.max(-1, Math.min(1, g.startPanY + g.dy / (w / 2)))
      })
    }
  }

  const onPointerUp = (e: React.PointerEvent) => {
    const v = videoRef.current
    if (!v) return
    const g = gesture.current
    window.clearTimeout(g.holdTimer)
    if (speedHold) {
      setSpeedHold(false)
      v.playbackRate = rate
      kickHideTimer()
      return
    }
    if (g.mode === 'seek' && g.moved) {
      const rect = rootRef.current?.getBoundingClientRect()
      const w = rect?.width || 1
      const delta = (g.dx / w) * 90
      const target = Math.max(0, Math.min(duration || v.duration, time + delta))
      try { v.currentTime = target } catch { /* ignore */ }
      setTime(target)
      kickHideTimer()
      return
    }
    if (g.moved) { kickHideTimer(); return }

    // 未移动 = 点击：双击判定
    const now = Date.now()
    const rect = rootRef.current?.getBoundingClientRect()
    const relX = rect ? (e.clientX - rect.left) / rect.width : 0.5
    if (now - g.lastTap < 300 && Math.abs(e.clientX - g.lastTapX) < 90) {
      g.lastTap = 0
      if (relX < 0.33) seekBy(-10)
      else if (relX > 0.67) seekBy(10)
      else toggleFullscreen()
    } else {
      g.lastTap = now
      g.lastTapX = e.clientX
      window.setTimeout(() => {
        if (gesture.current.lastTap === now) setControlsOn((c) => !c)
      }, 260)
    }
    kickHideTimer()
  }

  const seekBy = (delta: number) => {
    const v = videoRef.current
    if (!v) return
    const target = Math.max(0, Math.min(duration || v.duration, v.currentTime + delta))
    try { v.currentTime = target } catch { /* ignore */ }
    showOsd(`${delta > 0 ? '+' : ''}${delta}s`, fmtTime(target))
  }

  const onWheel = (e: React.WheelEvent) => {
    const v = videoRef.current
    if (!v) return
    if (e.ctrlKey || e.shiftKey || Math.abs(e.deltaY) > 40) {
      e.preventDefault()
      const z = Math.max(1, Math.min(3, zoom * (e.deltaY < 0 ? 1.12 : 0.89)))
      setZoom(z)
      if (z <= 1.01) setPan({ x: 0, y: 0 })
      showOsd(`${Math.round(z * 100)}%`, '缩放')
    }
  }

  const toggleFullscreen = useCallback(() => {
    const el = rootRef.current
    if (!el) return
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {})
    else el.requestFullscreen?.().catch(() => {})
  }, [])

  useEffect(() => {
    const onFs = () => setIsFullscreen(!!document.fullscreenElement)
    document.addEventListener('fullscreenchange', onFs)
    return () => document.removeEventListener('fullscreenchange', onFs)
  }, [])

  // 键盘快捷键
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const v = videoRef.current
      if (!v) return
      kickHideTimer()
      switch (e.key) {
        case ' ': case 'k': e.preventDefault(); togglePlay(); break
        case 'ArrowLeft': seekBy(-5); break
        case 'ArrowRight': seekBy(5); break
        case 'ArrowUp': e.preventDefault(); v.volume = Math.min(1, v.volume + 0.1); setVolume(v.volume); showOsd(`${Math.round(v.volume * 100)}%`, '音量'); break
        case 'ArrowDown': e.preventDefault(); v.volume = Math.max(0, v.volume - 0.1); setVolume(v.volume); showOsd(`${Math.round(v.volume * 100)}%`, '音量'); break
        case 'f': toggleFullscreen(); break
        case 'Escape':
          if (!document.fullscreenElement) { commit(); closeVideo() }
          break
        case 'm': v.muted = !v.muted; setMuted(v.muted); break
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [duration, closeVideo, commit])

  const togglePlay = () => {
    const v = videoRef.current
    if (!v) return
    if (v.paused) { v.play().catch(() => {}); kickHideTimer() }
    else { v.pause(); setControlsOn(true); window.clearTimeout(hideTimer.current) }
  }

  const screenshot = () => {
    const v = videoRef.current
    if (!v || !v.videoWidth) return
    const canvas = document.createElement('canvas')
    canvas.width = v.videoWidth
    canvas.height = v.videoHeight
    canvas.getContext('2d')?.drawImage(v, 0, 0)
    canvas.toBlob((blob) => {
      if (!blob) return
      const a = document.createElement('a')
      a.href = URL.createObjectURL(blob)
      a.download = `${item?.name || 'frame'}-${Date.now()}.png`
      a.click()
      setTimeout(() => URL.revokeObjectURL(a.href), 4000)
      showOsd(tr(lang, 'screenshotSaved'))
    }, 'image/png')
  }

  const pip = async () => {
    const v = videoRef.current
    if (!v) return
    try {
      if (document.pictureInPictureElement) await document.exitPictureInPicture()
      else await v.requestPictureInPicture()
    } catch { /* ignore */ }
  }

  if (!item) return null

  const activeSubText = activeSub?.startsWith('embedded:') ? embeddedCue : activeCues(cues, time).map((c) => c.text).join('\n')
  const queueItems = queue.map((id) => items.find((v) => v.id === id)).filter(Boolean) as typeof items
  const curQueueIdx = queue.indexOf(item.id)

  return (
    <motion.div ref={rootRef} className='vp-root'
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      transition={{ duration: 0.22 }}
      onWheel={onWheel}>
      <video ref={videoRef} className='vp-video'
        style={{
          objectFit: ratio,
          filter: `brightness(${brightness})`,
          transform: `scale(${zoom}) translate(${pan.x * 33}%, ${pan.y * 33}%)`
        }}
        playsInline
        onTimeUpdate={(e) => {
          const v = e.currentTarget
          setTime(v.currentTime)
          if (v.buffered.length) setBuffered(v.buffered.end(v.buffered.length - 1))
        }}
        onLoadedMetadata={(e) => { scanTextTracks(); onMeta() }}
        onPlay={() => { setPlaying(true); kickHideTimer() }}
        onPause={() => { setPlaying(false); setControlsOn(true); window.clearTimeout(hideTimer.current) }}
        onEnded={() => { commit(); videoNext() }}
      />

      {/* 手势提示层（透明，承载点击/拖拽） */}
      <div className='vp-gesture'
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onDoubleClick={(e) => {
          const rect = rootRef.current?.getBoundingClientRect()
          const relX = rect ? (e.clientX - rect.left) / rect.width : 0.5
          if (relX < 0.33) seekBy(-10)
          else if (relX > 0.67) seekBy(10)
        }} />

      {/* OSD */}
      <AnimatePresence>
        {osd && (
          <motion.div key={osd.key} className='vp-osd'
            initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.95 }}>
            <b>{osd.text}</b>
            {osd.sub && <span>{osd.sub}</span>}
          </motion.div>
        )}
      </AnimatePresence>

      {/* 字幕层 */}
      {activeSubText && (
        <div className='vp-subtitle' style={{
          fontSize: subStyle.size,
          bottom: subStyle.bottom,
          background: `rgba(0,0,0,${subStyle.bg})`
        }}>
          {activeSubText.split('\n').map((l, i) => <div key={i}>{l}</div>)}
        </div>
      )}

      {/* 顶栏 */}
      <motion.div className='vp-top' animate={{ opacity: controlsOn ? 1 : 0, pointerEvents: controlsOn ? 'auto' : 'none' }}>
        <button className='vp-icon-btn' title={tr(lang, 'back')} onClick={() => { commit(); closeVideo() }}>
          <IconClose size={20} />
        </button>
        <div className='vp-title'>
          <b>{item.name}</b>
          {queueItems.length > 1 && <span>{curQueueIdx + 1} / {queueItems.length}</span>}
        </div>
        <div className='vp-top-actions'>
          <button className={`vp-icon-btn ${menu === 'sub' ? 'on' : ''}`} title={tr(lang, 'subtitles')} onClick={() => setMenu(menu === 'sub' ? null : 'sub')}>
            <IconSubtitle size={19} />
          </button>
          <button className={`vp-icon-btn ${menu === 'speed' ? 'on' : ''}`} title={tr(lang, 'speed')} onClick={() => setMenu(menu === 'speed' ? null : 'speed')}>
            <IconGauge size={19} />
          </button>
          <button className={`vp-icon-btn ${menu === 'ratio' ? 'on' : ''}`} title={tr(lang, 'ratio')} onClick={() => setMenu(menu === 'ratio' ? null : 'ratio')}>
            <IconRatio size={19} />
          </button>
          <button className='vp-icon-btn' title={tr(lang, 'screenshot')} onClick={screenshot}>
            <IconCamera size={19} />
          </button>
          <button className='vp-icon-btn' title='PiP' onClick={pip}>
            <IconFilm size={19} />
          </button>
          <button className={`vp-icon-btn ${menu === 'playlist' ? 'on' : ''}`} title={tr(lang, 'queue')} onClick={() => setMenu(menu === 'playlist' ? null : 'playlist')}>
            <IconQueue size={19} />
          </button>
          <button className='vp-icon-btn' title={tr(lang, 'fullscreen')} onClick={toggleFullscreen}>
            {isFullscreen ? <IconFullscreenExit size={19} /> : <IconFullscreen size={19} />}
          </button>
        </div>
      </motion.div>

      {/* 中央播放键（暂停时） */}
      {!playing && (
        <button className='vp-center-play' onClick={togglePlay}>
          <IconPlay size={34} />
        </button>
      )}

      {/* 底栏 */}
      <motion.div className='vp-bottom' animate={{ opacity: controlsOn ? 1 : 0, pointerEvents: controlsOn ? 'auto' : 'none' }}>
        <div className='vp-seekrow'>
          <span className='vp-time'>{fmtTime(time)}</span>
          <div className='vp-seek' onPointerDown={(e) => {
            const v = videoRef.current
            if (!v) return
            const bar = e.currentTarget
            const rect = bar.getBoundingClientRect()
            const apply = (clientX: number) => {
              const r = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width))
              const target = r * (duration || v.duration)
              try { v.currentTime = target } catch { /* ignore */ }
              setTime(target)
            }
            apply(e.clientX)
            const move = (ev: PointerEvent) => apply(ev.clientX)
            const up = () => {
              window.removeEventListener('pointermove', move)
              window.removeEventListener('pointerup', up)
            }
            window.addEventListener('pointermove', move)
            window.addEventListener('pointerup', up)
          }}>
            <div className='vp-seek-buffered' style={{ width: (duration ? (buffered / duration) * 100 : 0) + '%' }} />
            <div className='vp-seek-fill' style={{ width: (duration ? (time / duration) * 100 : 0) + '%' }} />
            <div className='vp-seek-knob' style={{ left: (duration ? (time / duration) * 100 : 0) + '%' }} />
          </div>
          <span className='vp-time'>{fmtTime(duration)}</span>
        </div>
        <div className='vp-controls'>
          <button className='vp-icon-btn' title={tr(lang, 'volume')} onClick={() => { const v = videoRef.current; if (v) { v.muted = !v.muted; setMuted(v.muted) } }}>
            {muted || volume === 0 ? <IconVolumeX size={19} /> : <IconVolume size={19} />}
          </button>
          <input className='vp-vol-slider' type='range' min={0} max={1} step={0.02} value={muted ? 0 : volume}
            onChange={(e) => { const v = videoRef.current; const vol = Number(e.target.value); if (v) v.volume = vol; setVolume(vol); setMuted(false) }} />
          {queueItems.length > 1 && (
            <>
              <button className='vp-icon-btn' title={tr(lang, 'prevVideo')} onClick={() => {
                const prev = queueItems[(curQueueIdx - 1 + queueItems.length) % queueItems.length]
                if (prev) { commit(); openVideo(prev.id, queue) }
              }}>
                <IconPrev size={19} />
              </button>
              <button className='vp-icon-btn' title={tr(lang, 'nextVideo')} onClick={() => { commit(); videoNext() }}>
                <IconNext size={19} />
              </button>
            </>
          )}
          <div className='grow' />
          <span className='vp-rate-badge' onClick={() => setMenu(menu === 'speed' ? null : 'speed')}>{rate}x</span>
        </div>
      </motion.div>

      {/* 菜单：倍速 */}
      <AnimatePresence>
        {menu === 'speed' && controlsOn && (
          <motion.div className='vp-menu vp-menu-speed'
            initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 8 }}>
            {RATES.map((r) => (
              <button key={r} className={rate === r ? 'on' : ''} onClick={() => {
                setRate(r)
                if (videoRef.current) videoRef.current.playbackRate = r
                setMenu(null)
              }}>{r}x</button>
            ))}
          </motion.div>
        )}
      </AnimatePresence>

      {/* 菜单：画面比例 */}
      <AnimatePresence>
        {menu === 'ratio' && controlsOn && (
          <motion.div className='vp-menu vp-menu-ratio'
            initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 8 }}>
            {RATIOS.map((r) => (
              <button key={r.v} className={ratio === r.v ? 'on' : ''} onClick={() => { setRatio(r.v); setMenu(null) }}>{r.label}</button>
            ))}
          </motion.div>
        )}
      </AnimatePresence>

      {/* 菜单：字幕 */}
      <AnimatePresence>
        {menu === 'sub' && controlsOn && (
          <motion.div className='vp-menu vp-menu-sub'
            initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 8 }}>
            <div className='vp-menu-head'>{tr(lang, 'subtitles')}</div>
            <button className={activeSub === 'off' ? 'on' : ''} onClick={subsOff}>{tr(lang, 'subOff')}</button>
            {subs.map((s) => (
              <button key={s.path} className={activeSub === s.path ? 'on' : ''} onClick={() => loadSubFile(s)}>
                {s.name} <em>{s.lang}</em>
              </button>
            ))}
            {embeddedSubs.map((s) => (
              <button key={s.idx} className={activeSub === `embedded:${s.idx}` ? 'on' : ''} onClick={() => useEmbedded(s.idx)}>
                {tr(lang, 'embeddedSub')} · {s.label}
              </button>
            ))}
            <div className='vp-menu-sep' />
            <div className='vp-menu-head'>{tr(lang, 'subStyle')}</div>
            <label>{tr(lang, 'subSize')}
              <input type='range' min={14} max={44} value={subStyle.size} onChange={(e) => setSubStyle((s) => ({ ...s, size: Number(e.target.value) }))} />
            </label>
            <label>{tr(lang, 'subPos')}
              <input type='range' min={10} max={140} value={subStyle.bottom} onChange={(e) => setSubStyle((s) => ({ ...s, bottom: Number(e.target.value) }))} />
            </label>
            <label>{tr(lang, 'subBg')}
              <input type='range' min={0} max={1} step={0.05} value={subStyle.bg} onChange={(e) => setSubStyle((s) => ({ ...s, bg: Number(e.target.value) }))} />
            </label>
          </motion.div>
        )}
      </AnimatePresence>

      {/* 菜单：播放列表 */}
      <AnimatePresence>
        {menu === 'playlist' && controlsOn && (
          <motion.div className='vp-menu vp-menu-playlist'
            initial={{ x: 320 }} animate={{ x: 0 }} exit={{ x: 320 }}
            transition={{ type: 'spring', stiffness: 360, damping: 34 }}>
            <div className='vp-menu-head'>{tr(lang, 'queue')} · {queueItems.length}</div>
            {queueItems.map((v) => (
              <button key={v.id} className={`vp-pl-item ${v.id === item.id ? 'on' : ''}`}
                onClick={() => { commit(); openVideo(v.id, queue); setMenu(null) }}>
                <IconFilm size={15} />
                <span>{v.name}</span>
              </button>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  )
}
