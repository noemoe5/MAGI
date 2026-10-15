import { useEffect, useRef, useState, useMemo } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useStore } from '../store/useStore'
import { audioGraph } from '../lib/audioGraph'
import { drawRing } from '../lib/visualizer'
import { parseLrc, plainLyricLines, activeLineIndex, activeWordProgress, LyricLine } from '../lib/lrc'
import { mediaUrl, fmtTime, placeholderCover } from '../lib/util'
import { tr } from '../i18n'
import {
  IconPlay, IconPause, IconPrev, IconNext, IconShuffle, IconRepeat, IconRepeatOne,
  IconVolume, IconVolumeX, IconClose, IconQueue, IconTimer, IconLyric, IconMusic
} from './icons'

interface LyricsData {
  synced: LyricLine[] | null
  plain: string[] | null
}
const lyricsCache = new Map<string, LyricsData>()

// Folia Lattice 形态的全屏播放台：大封面 + 逐字歌词 + 环形频谱 + 队列 + 睡眠定时
export default function NowPlaying() {
  const open = useStore((s) => s.nowPlayingOpen)
  const patchAudio = useStore((s) => s.patchAudio)
  const patchAudioPrefs = useStore((s) => s.patchAudioPrefs)
  const currentId = useStore((s) => s.audioCurrentId)
  const tracks = useStore((s) => s.audioTracks)
  const queue = useStore((s) => s.audioQueue)
  const playing = useStore((s) => s.audioPlaying)
  const position = useStore((s) => s.audioPosition)
  const duration = useStore((s) => s.audioDuration)
  const prefs = useStore((s) => s.audioPrefs)
  const toggleAudio = useStore((s) => s.toggleAudio)
  const audioNext = useStore((s) => s.audioNext)
  const audioPrev = useStore((s) => s.audioPrev)
  const cyclePlayMode = useStore((s) => s.cyclePlayMode)
  const playTrack = useStore((s) => s.playTrack)
  const sleepTimerEnd = useStore((s) => s.sleepTimerEnd)

  const settings = useStore((s) => s.settings)
  const lang = settings.lang

  const track = tracks.find((t) => t.id === currentId) || null
  const [lyrics, setLyrics] = useState<LyricsData>({ synced: null, plain: null })
  const [showQueue, setShowQueue] = useState(false)
  const [showTimer, setShowTimer] = useState(false)
  const [showLyricOffset, setShowLyricOffset] = useState(false)
  const ringRef = useRef<HTMLCanvasElement>(null)
  const lyricBoxRef = useRef<HTMLDivElement>(null)

  // 歌词加载：sidecar .lrc 优先，其次 ID3 内嵌（SYLT/USLT）
  useEffect(() => {
    if (!open || !currentId) return
    let cancelled = false
    const cached = lyricsCache.get(currentId)
    if (cached) { setLyrics(cached); return }
    const t = tracks.find((x) => x.id === currentId)
    if (!t) return
    ;(async () => {
      let data: LyricsData = { synced: null, plain: null }
      try {
        const side = await (window as any).electronAPI.mediaSidecar(t.path)
        if (side?.lrc) {
          const parsed = parseLrc(side.lrc)
          data = parsed.length ? { synced: parsed, plain: null } : { synced: null, plain: plainLyricLines(side.lrc) }
        }
      } catch { /* ignore */ }
      if (!data.synced && !data.plain) {
        try {
          const info = await (window as any).electronAPI.mediaProbe(t.path)
          if (info?.lyricsSynced?.length) {
            data = {
              synced: info.lyricsSynced.map((l: { t: number; text: string }) => ({ t: l.t / 1000, text: l.text, words: undefined })),
              plain: null
            }
          } else if (info?.lyricsPlain) {
            data = { synced: null, plain: plainLyricLines(info.lyricsPlain) }
          }
        } catch { /* ignore */ }
      }
      if (!cancelled) {
        lyricsCache.set(currentId, data)
        setLyrics(data)
      }
    })()
    return () => { cancelled = true }
  }, [open, currentId, tracks])

  // 环形可视化（打开期间 rAF）
  useEffect(() => {
    if (!open) return
    let raf = 0
    const loop = () => {
      const canvas = ringRef.current
      if (canvas) {
        const wave = audioGraph.getWave()
        if (wave) {
          const dpr = Math.min(2, window.devicePixelRatio || 1)
          const w = canvas.clientWidth
          const h = canvas.clientHeight
          if (canvas.width !== w * dpr || canvas.height !== h * dpr) {
            canvas.width = w * dpr
            canvas.height = h * dpr
          }
          const ctx = canvas.getContext('2d')
          if (ctx) {
            ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
            drawRing(canvas, wave, settings.accent)
          }
        }
      }
      raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(raf)
  }, [open, settings.accent])

  const offsetSec = prefs.lyricOffsetMs / 1000
  const activeIdx = useMemo(
    () => (lyrics.synced ? activeLineIndex(lyrics.synced, position + offsetSec) : -1),
    [lyrics.synced, position, offsetSec]
  )
  const wordProg = useMemo(
    () => (lyrics.synced && activeIdx >= 0 ? activeWordProgress(lyrics.synced[activeIdx], position + offsetSec) : -1),
    [lyrics.synced, activeIdx, position, offsetSec]
  )

  // 歌词滚动跟随
  useEffect(() => {
    if (activeIdx < 0) return
    const box = lyricBoxRef.current
    if (!box) return
    const el = box.querySelector(`[data-li="${activeIdx}"]`) as HTMLElement | null
    if (el) {
      const target = el.offsetTop - box.clientHeight / 2 + el.clientHeight / 2
      box.scrollTo({ top: Math.max(0, target), behavior: 'smooth' })
    }
  }, [activeIdx])

  if (!open || !track) return null

  const seekLine = (t: number) => {
    patchAudio({ audioPosition: t, audioSeekToken: useStore.getState().audioSeekToken + 1 })
  }

  const queueTracks = queue.map((id) => tracks.find((t) => t.id === id)).filter(Boolean) as typeof tracks
  const modeIcon =
    prefs.mode === 'shuffle' ? <IconShuffle size={17} /> : prefs.mode === 'single' ? <IconRepeatOne size={17} /> : <IconRepeat size={17} />
  const sleepRemain = sleepTimerEnd ? Math.max(0, Math.round((sleepTimerEnd - Date.now()) / 1000)) : 0

  return (
    <motion.div className='np-root'
      initial={{ opacity: 0, y: 40 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 40 }}
      transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}>
      {/* 背景：封面放大模糊 + 主题色罩 */}
      <div className='np-bg' style={{ backgroundImage: track.cover ? `url(${track.cover})` : undefined }} />
      <div className='np-bg-mask' />

      {/* 顶栏 */}
      <div className='np-top'>
        <button className='np-icon-btn' onClick={() => patchAudio({ nowPlayingOpen: false })} title={tr(lang, 'close')}>
          <IconClose size={18} />
        </button>
        <div className='np-top-title'>
          <b>{track.name}</b>
          <span>{[track.artist, track.album].filter(Boolean).join(' · ') || tr(lang, 'unknownArtist')}</span>
        </div>
        <div className='np-top-actions'>
          <button className={`np-icon-btn ${showLyricOffset ? 'on' : ''}`} title={tr(lang, 'lyricOffset')}
            onClick={() => { setShowLyricOffset((v) => !v); setShowTimer(false); setShowQueue(false) }}>
            <IconLyric size={17} />
          </button>
          <button className={`np-icon-btn ${sleepTimerEnd ? 'on' : ''}`} title={tr(lang, 'sleepTimer')}
            onClick={() => { setShowTimer((v) => !v); setShowLyricOffset(false); setShowQueue(false) }}>
            <IconTimer size={17} />
            {sleepTimerEnd && <em className='np-timer-badge'>{Math.floor(sleepRemain / 60)}:{String(sleepRemain % 60).padStart(2, '0')}</em>}
          </button>
          <button className={`np-icon-btn ${showQueue ? 'on' : ''}`} title={tr(lang, 'queue')}
            onClick={() => { setShowQueue((v) => !v); setShowTimer(false); setShowLyricOffset(false) }}>
            <IconQueue size={17} />
          </button>
        </div>
      </div>

      {/* 歌词偏移微调 */}
      <AnimatePresence>
        {showLyricOffset && (
          <motion.div className='np-offset'
            initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }}>
            <span>{tr(lang, 'lyricOffset')}</span>
            <input type='range' min={-3} max={3} step={0.1} value={prefs.lyricOffsetMs / 1000}
              onChange={(e) => patchAudioPrefs({ lyricOffsetMs: Number(e.target.value) * 1000 })} />
            <b>{(prefs.lyricOffsetMs / 1000).toFixed(1)}s</b>
            <button onClick={() => patchAudioPrefs({ lyricOffsetMs: 0 })}>{tr(lang, 'reset')}</button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* 睡眠定时菜单 */}
      <AnimatePresence>
        {showTimer && (
          <motion.div className='np-timer-menu'
            initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }}>
            {[15, 30, 45, 60, 90].map((m) => (
              <button key={m} onClick={() => { patchAudio({ sleepTimerEnd: Date.now() + m * 60000 }); setShowTimer(false) }}>
                {m} {tr(lang, 'minutes')}
              </button>
            ))}
            <button onClick={() => { patchAudio({ sleepTimerEnd: null }); setShowTimer(false) }}>{tr(lang, 'timerOff')}</button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* 主体：封面 + 歌词 */}
      <div className='np-body'>
        <div className='np-stage'>
          <canvas ref={ringRef} className='np-ring' />
          <motion.img key={track.id} className='np-cover' src={track.cover || placeholderCover(track.name)} alt=''
            initial={{ scale: 0.92, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ duration: 0.35 }} />
        </div>

        <div className='np-lyrics' ref={lyricBoxRef}>
          {lyrics.synced ? (
            lyrics.synced.map((l, i) => (
              <div key={i} data-li={i}
                className={`np-line ${i === activeIdx ? 'on' : ''} ${i < activeIdx ? 'past' : ''}`}
                onClick={() => seekLine(l.t - offsetSec)}>
                {i === activeIdx && l.words?.length ? (
                  l.words.map((w, wi) => {
                    // 逐字上色：按当前字进度部分填充
                    const start = w.t
                    const end = l.words![wi + 1]?.t ?? l.t + 4
                    const local = Math.max(0, Math.min(1, (position + offsetSec - start) / Math.max(0.001, end - start)))
                    return (
                      <span key={wi} className='np-word' style={{
                        background: `linear-gradient(to right, var(--accent) ${local * 100}%, rgba(255,255,255,.55) ${local * 100}%)`,
                        WebkitBackgroundClip: 'text',
                        backgroundClip: 'text',
                        color: 'transparent'
                      }}>{w.text}</span>
                    )
                  })
                ) : (
                  l.text || '♪'
                )}
              </div>
            ))
          ) : lyrics.plain ? (
            lyrics.plain.map((l, i) => (
              <div key={i} className='np-line on-static'>{l}</div>
            ))
          ) : (
            <div className='np-no-lyric'><IconMusic size={22} />{tr(lang, 'noLyric')}</div>
          )}
        </div>
      </div>

      {/* 底部控制 */}
      <div className='np-bottom'>
        <div className='np-seek'>
          <span>{fmtTime(position)}</span>
          <div className='np-seek-bar' onPointerDown={(e) => {
            const bar = e.currentTarget
            const rect = bar.getBoundingClientRect()
            const r = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width))
            patchAudio({ audioPosition: r * (duration || track.duration), audioSeekToken: useStore.getState().audioSeekToken + 1 })
          }}>
            <div className='np-seek-fill' style={{ width: (duration ? (position / duration) * 100 : 0) + '%' }} />
          </div>
          <span>{fmtTime(duration || track.duration)}</span>
        </div>
        <div className='np-transport'>
          <button className='np-icon-btn' onClick={cyclePlayMode} title={tr(lang, 'playMode')}>{modeIcon}</button>
          <button className='np-icon-btn' onClick={audioPrev} title={tr(lang, 'prevTrack')}><IconPrev size={20} /></button>
          <button className='np-play' onClick={toggleAudio} title={playing ? tr(lang, 'pause') : tr(lang, 'play')}>
            {playing ? <IconPause size={26} /> : <IconPlay size={26} />}
          </button>
          <button className='np-icon-btn' onClick={() => audioNext()} title={tr(lang, 'nextTrack')}><IconNext size={20} /></button>
          <div className='np-vol'>
            <button className='np-icon-btn' title={tr(lang, 'volume')}
              onClick={() => patchAudioPrefs({ muted: !prefs.muted })}>
              {prefs.muted || prefs.volume === 0 ? <IconVolumeX size={17} /> : <IconVolume size={17} />}
            </button>
            <input type='range' min={0} max={1} step={0.01} value={prefs.muted ? 0 : prefs.volume}
              onChange={(e) => patchAudioPrefs({ volume: Number(e.target.value), muted: false })} />
          </div>
        </div>
      </div>

      {/* 队列面板 */}
      <AnimatePresence>
        {showQueue && (
          <motion.div className='np-queue'
            initial={{ x: 340 }} animate={{ x: 0 }} exit={{ x: 340 }}
            transition={{ type: 'spring', stiffness: 360, damping: 34 }}>
            <div className='np-queue-head'>
              <b>{tr(lang, 'queue')}</b>
              <span>{queueTracks.length} {tr(lang, 'tracks')}</span>
            </div>
            <div className='np-queue-list'>
              {queueTracks.map((t) => (
                <div key={t.id} className={`np-queue-item ${t.id === currentId ? 'on' : ''}`}
                  onClick={() => playTrack(t.id)}>
                  <img src={t.cover || placeholderCover(t.name)} alt='' />
                  <div className='np-queue-meta'>
                    <b>{t.name}</b>
                    <span>{t.artist || tr(lang, 'unknownArtist')}</span>
                  </div>
                  {t.id === currentId && <em className='np-playing-eq'>{playing ? '▶' : '⏸'}</em>}
                </div>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  )
}
