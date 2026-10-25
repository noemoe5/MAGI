// 视频覆盖窗口的 UI —— 沿用 MAGI 原有 Vivid 形态播放器的样式（vp-* 全套），
// 唯一的变化是把「引擎」从 <video> 换成 vlc：所有读写在 vlc:state / video-vlc-command 上。
//
// 为什么要在独立窗口里画：vlc 是原生子窗口，永远画在同一个 HWND 的网页内容之上，
// 同一个窗口里的 HTML 压不住它。所以视频像素一个窗口、控制 UI 一个窗口（本文件）。
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { fmtTime } from '../lib/util'
import { tr } from '../i18n'
import {
  IconPlay, IconPause, IconPrev, IconNext, IconClose, IconFullscreen, IconFullscreenExit,
  IconSubtitle, IconGauge, IconRatio, IconCamera, IconVolume, IconVolumeX, IconFilm
} from '../components/icons'

interface SidecarSub { name: string; path: string; lang: string }
interface MpvState {
  ok: boolean; playing: boolean; time: number; duration: number; buffered: number
  volume: number; muted: boolean; speed: number; width: number; height: number; eof: boolean
}
interface MpvSession { id: string; path: string; name: string; duration: number; subs?: SidecarSub[] }
interface MpvInit { available: boolean; session: MpvSession | null; state: MpvState }

const api = () => (window as any).electronAPI?.vlc
const RATES = [0.5, 0.75, 1, 1.25, 1.5, 2]
const RATIOS: Array<{ v: 'contain' | 'cover' | 'fill'; label: string }> = [
  { v: 'contain', label: '适应' },
  { v: 'cover', label: '裁剪' },
  { v: 'fill', label: '拉伸' }
]
const EMPTY: MpvState = {
  ok: false, playing: false, time: 0, duration: 0, buffered: 0,
  volume: 80, muted: false, speed: 1, width: 0, height: 0, eof: false
}

export default function VideoOverlay() {
  const [init, setInit] = useState<MpvInit | null>(null)
  const [state, setState] = useState<MpvState>(EMPTY)
  const [controlsOn, setControlsOn] = useState(true)
  const [menu, setMenu] = useState<null | 'speed' | 'ratio' | 'sub' | 'playlist'>(null)
  const [osd, setOsd] = useState<{ text: string; sub?: string; key: number } | null>(null)
  const [rate, setRate] = useState(1)
  const [ratio, setRatio] = useState<'contain' | 'cover' | 'fill'>('contain')
  const [isFullscreen, setIsFullscreen] = useState(false)
  const [tracks, setTracks] = useState<Array<{ id: number; type: string; lang: string; title: string; selected: boolean }>>([])
  const [subSize, setSubSize] = useState(55)
  const [subPos, setSubPos] = useState(92)

  const lang = 'zh'
  const rootRef = useRef<HTMLDivElement>(null)
  const hideTimer = useRef<number>(0)
  const osdTimer = useRef<number>(0)
  const gesture = useRef({
    x0: 0, y0: 0, mode: 'none' as 'none' | 'seek' | 'vol', dx: 0, dy: 0,
    moved: false, startVol: 80, holdTimer: 0 as unknown as number,
    lastTap: 0, lastTapX: 0, speedHold: false
  })

  // —— 透明化文档：vlc 在下面画像素 ——
  useEffect(() => {
    document.documentElement.classList.add('vp-overlay')
    return () => document.documentElement.classList.remove('vp-overlay')
  }, [])

  // —— 与主进程对接 ——
  useEffect(() => {
    const m = api()
    if (!m) return
    const offInit = m.onInit((payload: MpvInit) => {
      setInit(payload)
      if (payload?.state) setState((s) => ({ ...s, ...payload.state }))
      m.ready()
    })
    const offState = m.onState((next: MpvState) => setState((s) => ({ ...s, ...next })))
    m.ready()
    return () => { offInit?.(); offState?.() }
  }, [])

  const cmd = useCallback((type: string, value?: unknown) => api()?.command(type, value), [])
  const uiEvent = useCallback((name: string, payload?: unknown) => (window as any).electronAPI?.videoUiEvent(name, payload), [])

  const session = init?.session ?? null
  const playing = state.playing
  const time = state.time
  const duration = state.duration || session?.duration || 0

  const showOsd = useCallback((text: string, sub?: string) => {
    setOsd({ text, sub, key: Date.now() })
    window.clearTimeout(osdTimer.current)
    osdTimer.current = window.setTimeout(() => setOsd(null), 900)
  }, [])

  const kickHideTimer = useCallback(() => {
    setControlsOn(true)
    window.clearTimeout(hideTimer.current)
    hideTimer.current = window.setTimeout(() => {
      if (state.playing) setControlsOn(false)
    }, 3200)
  }, [state.playing])

  const togglePlay = useCallback(() => {
    cmd('toggle-play')
    setControlsOn(true)
    window.clearTimeout(hideTimer.current)
  }, [cmd])

  const seekTo = useCallback((t: number) => {
    const target = Math.max(0, Math.min(duration || 1e9, t))
    cmd('seek', target)
    setState((s) => ({ ...s, time: target }))
  }, [cmd, duration])

  const seekBy = useCallback((delta: number) => {
    const target = Math.max(0, Math.min(duration || 1e9, time + delta))
    seekTo(target)
    showOsd(`${delta > 0 ? '+' : ''}${delta}s`, fmtTime(target))
  }, [duration, seekTo, showOsd, time])

  const toggleFullscreen = useCallback(() => {
    api()?.fullscreen(!isFullscreen).then((on: boolean) => setIsFullscreen(!!on))
    kickHideTimer()
  }, [isFullscreen, kickHideTimer])

  // 播完自动下一集
  useEffect(() => {
    if (state.eof) uiEvent('next')
  }, [state.eof, uiEvent])

  // 字幕/内封轨道清单
  useEffect(() => {
    if (!session) return
    let alive = true
    const t = window.setTimeout(async () => {
      const list = await cmd('get-tracks')
      if (alive && Array.isArray(list)) setTracks(list)
    }, 1200)
    return () => { alive = false; window.clearTimeout(t) }
  }, [cmd, session?.id])

  // —— 手势 ——
  const onPointerDown = (e: React.PointerEvent) => {
    ;(e.target as HTMLElement).setPointerCapture?.(e.pointerId)
    const g = gesture.current
    g.x0 = e.clientX; g.y0 = e.clientY
    g.mode = 'none'; g.dx = 0; g.dy = 0; g.moved = false
    g.startVol = state.muted ? 0 : state.volume
    kickHideTimer()
    g.holdTimer = window.setTimeout(() => {
      if (!g.moved) { g.speedHold = true; cmd('speed', 2); showOsd('2x 快进中', '松开恢复') }
    }, 600) as unknown as number
  }

  const onPointerMove = (e: React.PointerEvent) => {
    const g = gesture.current
    g.dx = e.clientX - g.x0
    g.dy = e.clientY - g.y0
    if (Math.abs(g.dx) > 10 || Math.abs(g.dy) > 10) { g.moved = true; window.clearTimeout(g.holdTimer) }
    const w = rootRef.current?.getBoundingClientRect().width || 1
    if (g.mode === 'none') {
      if (Math.abs(g.dx) > 14) g.mode = 'seek'
      else if (Math.abs(g.dy) > 14) g.mode = 'vol'
    }
    if (g.mode === 'seek') {
      const delta = (g.dx / w) * 90
      const target = Math.max(0, Math.min(duration || 1e9, time + delta))
      showOsd(fmtTime(target), `${delta >= 0 ? '+' : ''}${Math.round(delta)}s`)
    } else if (g.mode === 'vol') {
      const vol = Math.max(0, Math.min(100, g.startVol - g.dy / 3))
      cmd('volume', vol)
      setState((s) => ({ ...s, volume: vol, muted: false }))
      showOsd(`${Math.round(vol)}%`, '音量')
    }
  }

  const onPointerUp = (e: React.PointerEvent) => {
    const g = gesture.current
    window.clearTimeout(g.holdTimer)
    if (g.speedHold) { g.speedHold = false; cmd('speed', rate); kickHideTimer(); return }
    if (g.mode === 'seek' && g.moved) {
      const w = rootRef.current?.getBoundingClientRect().width || 1
      seekTo(time + (g.dx / w) * 90)
      kickHideTimer()
      return
    }
    if (g.moved) { kickHideTimer(); return }
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
      window.setTimeout(() => { if (gesture.current.lastTap === now) setControlsOn((c) => !c) }, 260)
    }
    kickHideTimer()
  }

  const onWheel = (e: React.WheelEvent) => {
    e.preventDefault()
    const next = Math.max(0, Math.min(100, (state.muted ? 0 : state.volume) - Math.sign(e.deltaY) * 4))
    cmd('volume', next)
    setState((s) => ({ ...s, volume: next, muted: false }))
    showOsd(`${Math.round(next)}%`, '音量')
    kickHideTimer()
  }

  // —— 键盘 ——
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      kickHideTimer()
      switch (e.key) {
        case ' ': case 'k': e.preventDefault(); togglePlay(); break
        case 'ArrowLeft': seekBy(-5); break
        case 'ArrowRight': seekBy(5); break
        case 'ArrowUp': e.preventDefault(); cmd('volume', Math.min(100, state.volume + 5)); break
        case 'ArrowDown': e.preventDefault(); cmd('volume', Math.max(0, state.volume - 5)); break
        case 'f': toggleFullscreen(); break
        case 'm': cmd('mute', !state.muted); setState((s) => ({ ...s, muted: !s.muted })); break
        case 'Escape':
          if (!isFullscreen) { uiEvent('close') } else { toggleFullscreen() }
          break
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [cmd, isFullscreen, kickHideTimer, seekBy, state.muted, state.volume, toggleFullscreen, togglePlay, uiEvent])

  useEffect(() => () => { window.clearTimeout(hideTimer.current); window.clearTimeout(osdTimer.current) }, [])

  const screenshot = async () => {
    const target = await api()?.screenshot(session?.name || 'frame')
    if (target) showOsd('已保存', tr(lang, 'screenshotSaved') || '截图')
  }

  const subs = useMemo(() => (init?.session?.subs ?? []) as SidecarSub[], [init?.session?.subs])
  const embedded = useMemo(() => tracks.filter((t) => t.type === 'sub'), [tracks])

  return (
    <div
      ref={rootRef}
      className='vp-root vp-root-transparent'
      onWheel={onWheel}
    >
      {/* 手势层 */}
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

      <AnimatePresence>
        {osd && (
          <motion.div key={osd.key} className='vp-osd'
            initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.95 }}>
            <b>{osd.text}</b>
            {osd.sub && <span>{osd.sub}</span>}
          </motion.div>
        )}
      </AnimatePresence>

      {/* 顶栏（同时是窗口拖动条：vlc 视频窗盖住了原生标题栏，拖这里等于拖整个应用窗口） */}
      <motion.div className='vp-top' style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
        animate={{ opacity: controlsOn ? 1 : 0, pointerEvents: controlsOn ? 'auto' : 'none' }}>
        <button className='vp-icon-btn' style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
          title={tr(lang, 'back')} onClick={() => uiEvent('close')}>
          <IconClose size={20} />
        </button>
        <div className='vp-title' style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
          <b>{session?.name || '—'}</b>
          {state.width > 0 && <span>{state.width}×{state.height}{state.ok ? ' · vlc HDR' : ''}</span>}
        </div>
        <div className='vp-top-actions' style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
          <button className={`vp-icon-btn ${menu === 'sub' ? 'on' : ''}`} title={tr(lang, 'subtitles')}
            onClick={() => setMenu(menu === 'sub' ? null : 'sub')}>
            <IconSubtitle size={19} />
          </button>
          <button className={`vp-icon-btn ${menu === 'speed' ? 'on' : ''}`} title={tr(lang, 'speed')}
            onClick={() => setMenu(menu === 'speed' ? null : 'speed')}>
            <IconGauge size={19} />
          </button>
          <button className={`vp-icon-btn ${menu === 'ratio' ? 'on' : ''}`} title={tr(lang, 'ratio')}
            onClick={() => setMenu(menu === 'ratio' ? null : 'ratio')}>
            <IconRatio size={19} />
          </button>
          <button className='vp-icon-btn' title={tr(lang, 'screenshot')} onClick={screenshot}>
            <IconCamera size={19} />
          </button>
          <button className='vp-icon-btn' title='上一集' onClick={() => uiEvent('prev')}>
            <IconPrev size={19} />
          </button>
          <button className='vp-icon-btn' title='下一集' onClick={() => uiEvent('next')}>
            <IconNext size={19} />
          </button>
          <button className='vp-icon-btn' title={tr(lang, 'fullscreen')} onClick={toggleFullscreen}>
            {isFullscreen ? <IconFullscreenExit size={19} /> : <IconFullscreen size={19} />}
          </button>
        </div>
      </motion.div>

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
            const bar = e.currentTarget
            const rect = bar.getBoundingClientRect()
            const apply = (clientX: number) => {
              const r = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width))
              seekTo(r * (duration || 0))
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
            <div className='vp-seek-buffered' style={{ width: (duration ? (state.buffered / duration) * 100 : 0) + '%' }} />
            <div className='vp-seek-fill' style={{ width: (duration ? (time / duration) * 100 : 0) + '%' }} />
            <div className='vp-seek-knob' style={{ left: (duration ? (time / duration) * 100 : 0) + '%' }} />
          </div>
          <span className='vp-time'>{fmtTime(duration)}</span>
        </div>
        <div className='vp-controls'>
          <button className='vp-icon-btn' title={tr(lang, 'volume')}
            onClick={() => { const next = !state.muted; cmd('mute', next); setState((s) => ({ ...s, muted: next })) }}>
            {state.muted || state.volume === 0 ? <IconVolumeX size={19} /> : <IconVolume size={19} />}
          </button>
          <input className='vp-vol-slider' type='range' min={0} max={100} step={1}
            value={state.muted ? 0 : Math.round(state.volume)}
            onChange={(e) => { const v = Number(e.target.value); cmd('volume', v); setState((s) => ({ ...s, volume: v, muted: false })) }} />
          <button className='vp-icon-btn' title='快退 10s' onClick={() => seekBy(-10)}><IconPrev size={19} /></button>
          <button className='vp-icon-btn' title={playing ? '暂停' : '播放'} onClick={togglePlay}>
            {playing ? <IconPause size={19} /> : <IconPlay size={19} />}
          </button>
          <button className='vp-icon-btn' title='快进 10s' onClick={() => seekBy(10)}><IconNext size={19} /></button>
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
                setRate(r); cmd('speed', r); setMenu(null)
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
              <button key={r.v} className={ratio === r.v ? 'on' : ''}
                onClick={() => { setRatio(r.v); cmd('fit', r.v); setMenu(null) }}>{r.label}</button>
            ))}
          </motion.div>
        )}
      </AnimatePresence>

      {/* 菜单：字幕（外挂 + 内封 + 字号/位置，全部下发 vlc 自己渲染） */}
      <AnimatePresence>
        {menu === 'sub' && controlsOn && (
          <motion.div className='vp-menu vp-menu-sub'
            initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 8 }}>
            <div className='vp-menu-head'>{tr(lang, 'subtitles')}</div>
            <button onClick={() => { cmd('sub-visibility', false); setMenu(null) }}>{tr(lang, 'subOff') || '关闭字幕'}</button>
            {subs.map((s) => (
              <button key={s.path} onClick={() => { cmd('sub-add', s.path); cmd('sub-visibility', true); setMenu(null) }}>
                {s.name} <em>{s.lang}</em>
              </button>
            ))}
            {embedded.map((t) => (
              <button key={t.id} className={t.selected ? 'on' : ''}
                onClick={() => { cmd('sub-track', t.id); cmd('sub-visibility', true); setMenu(null) }}>
                {tr(lang, 'embeddedSub') || '内封'} · {t.title || t.lang || `#${t.id}`}
              </button>
            ))}
            <div className='vp-menu-sep' />
            <div className='vp-menu-head'>{tr(lang, 'subStyle') || '字幕样式'}</div>
            <label>{tr(lang, 'subSize') || '字号'}
              <input type='range' min={20} max={110} value={subSize}
                onChange={(e) => { const v = Number(e.target.value); setSubSize(v); cmd('sub-size', v) }} />
            </label>
            <label>{tr(lang, 'subPos') || '位置'}
              <input type='range' min={40} max={140} value={subPos}
                onChange={(e) => { const v = Number(e.target.value); setSubPos(v); cmd('sub-pos', v) }} />
            </label>
          </motion.div>
        )}
      </AnimatePresence>

      {/* 未拿到引擎时给个明确提示，而不是黑屏 */}
      {init && !init.available && (
        <div className="vp-osd" style={{ left: '50%', top: '50%', transform: 'translate(-50%,-50%)', maxWidth: 420 }}>
          <b>未找到 vlc</b>
          <span>请确认 resources/vlc/vlc.exe 存在（打包版为 安装目录/resources/vlc/vlc.exe）</span>
        </div>
      )}

      {/* 播放队列入口（队列本体在主窗口，这里只发语义事件） */}
      <motion.button className='vp-icon-btn'
        style={{ position: 'absolute', right: 16, bottom: 74, zIndex: 4, opacity: controlsOn ? 1 : 0 }}
        title={tr(lang, 'queue')} onClick={() => uiEvent('focus-library')}>
        <IconFilm size={18} />
      </motion.button>
    </div>
  )
}
