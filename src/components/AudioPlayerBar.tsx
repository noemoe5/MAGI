import { useRef, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useStore } from '../store/useStore'
import { useAudioEngine } from '../lib/useAudioEngine'
import { audioGraph } from '../lib/audioGraph'
import { mediaUrl, fmtTime, placeholderCover } from '../lib/util'
import { tr } from '../i18n'
import {
  IconPlay, IconPause, IconPrev, IconNext, IconShuffle, IconRepeat, IconRepeatOne,
  IconVolume, IconVolumeX, IconQueue, IconExpandUp, IconMusic
} from './icons'

// Folia 形态的底部播放条：常驻全局，书架/阅读页/媒体页都在
// 左：封面（点开全屏台）+ 标题艺人；中：传输控制；右：模式/音量/队列/展开
export default function AudioPlayerBar() {
  const audioRef = useRef<HTMLAudioElement>(null)
  useAudioEngine(audioRef)

  const currentId = useStore((s) => s.audioCurrentId)
  const tracks = useStore((s) => s.audioTracks)
  const playing = useStore((s) => s.audioPlaying)
  const position = useStore((s) => s.audioPosition)
  const duration = useStore((s) => s.audioDuration)
  const prefs = useStore((s) => s.audioPrefs)
  const patchAudio = useStore((s) => s.patchAudio)
  const patchAudioPrefs = useStore((s) => s.patchAudioPrefs)
  const toggleAudio = useStore((s) => s.toggleAudio)
  const audioNext = useStore((s) => s.audioNext)
  const audioPrev = useStore((s) => s.audioPrev)
  const cyclePlayMode = useStore((s) => s.cyclePlayMode)

  const [seeking, setSeeking] = useState(false)
  const [seekPos, setSeekPos] = useState(0)
  const [showVolume, setShowVolume] = useState(false)

  const track = tracks.find((t) => t.id === currentId) || null
  const settings = useStore((s) => s.settings)
  const lang = settings.lang

  const onTogglePlay = () => {
    const el = audioRef.current
    if (el && !playing) {
      audioGraph.attach(el)
      audioGraph.resume()
    }
    toggleAudio()
  }

  // 进度条拖动
  const onSeekStart = (e: React.PointerEvent) => {
    if (!duration) return
    const bar = e.currentTarget as HTMLElement
    const rect = bar.getBoundingClientRect()
    const move = (ev: PointerEvent) => {
      const r = Math.max(0, Math.min(1, (ev.clientX - rect.left) / rect.width))
      setSeekPos(r * duration)
    }
    const up = (ev: PointerEvent) => {
      const r = Math.max(0, Math.min(1, (ev.clientX - rect.left) / rect.width))
      const target = r * duration
      patchAudio({ audioPosition: target, audioSeekToken: useStore.getState().audioSeekToken + 1 })
      setSeeking(false)
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
    setSeeking(true)
    setSeekPos(((e.clientX - rect.left) / rect.width) * duration)
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  if (!track) return null

  const shownPos = seeking ? seekPos : position
  const pct = duration ? (shownPos / duration) * 100 : 0
  const modeIcon =
    prefs.mode === 'shuffle' ? <IconShuffle size={16} /> : prefs.mode === 'single' ? <IconRepeatOne size={16} /> : <IconRepeat size={16} />

  return (
    <>
      <audio ref={audioRef} preload='metadata' />
      <motion.div className='player-bar'
        initial={{ y: 80 }} animate={{ y: 0 }} exit={{ y: 80 }}
        transition={{ type: 'spring', stiffness: 380, damping: 32 }}>
        {/* 顶部进度细线 */}
        <div className='pb-progress' onPointerDown={onSeekStart} title={tr(lang, 'seek')}>
          <div className='pb-progress-fill' style={{ width: pct + '%' }} />
          <div className='pb-progress-knob' style={{ left: pct + '%' }} />
        </div>

        <div className='pb-main'>
          <button className='pb-cover' onClick={() => patchAudio({ nowPlayingOpen: true })} title={tr(lang, 'nowPlaying')}>
            <img src={track.cover || placeholderCover(track.name)} alt='' />
          </button>

          <div className='pb-meta'>
            <div className='pb-title'>{track.name}</div>
            <div className='pb-sub'>
              {[track.artist, track.album].filter(Boolean).join(' · ') || tr(lang, 'unknownArtist')}
            </div>
          </div>

          <div className='pb-controls'>
            <button className='pb-btn' onClick={audioPrev} title={tr(lang, 'prevTrack')}><IconPrev size={18} /></button>
            <button className='pb-btn play' onClick={onTogglePlay} title={playing ? tr(lang, 'pause') : tr(lang, 'play')}>
              {playing ? <IconPause size={20} /> : <IconPlay size={20} />}
            </button>
            <button className='pb-btn' onClick={() => audioNext()} title={tr(lang, 'nextTrack')}><IconNext size={18} /></button>
          </div>

          <div className='pb-times'>
            <span>{fmtTime(shownPos)}</span>
            <span className='pb-times-sep'>/</span>
            <span>{fmtTime(duration || track.duration)}</span>
          </div>

          <div className='pb-right'>
            <button className='pb-btn' onClick={cyclePlayMode} title={tr(lang, 'playMode')}>{modeIcon}</button>
            <div className='pb-volume'
              onMouseEnter={() => setShowVolume(true)}
              onMouseLeave={() => setShowVolume(false)}>
              <button className='pb-btn' title={tr(lang, 'volume')}
                onClick={() => patchAudioPrefs({ muted: !prefs.muted })}>
                {prefs.muted || prefs.volume === 0 ? <IconVolumeX size={16} /> : <IconVolume size={16} />}
              </button>
              <AnimatePresence>
                {showVolume && (
                  <motion.input className='pb-volume-slider' type='range' min={0} max={1} step={0.01}
                    initial={{ opacity: 0, width: 0 }} animate={{ opacity: 1, width: 84 }} exit={{ opacity: 0, width: 0 }}
                    value={prefs.muted ? 0 : prefs.volume}
                    onChange={(e) => patchAudioPrefs({ volume: Number(e.target.value), muted: false })} />
                )}
              </AnimatePresence>
            </div>
            <button className='pb-btn' onClick={() => patchAudio({ nowPlayingOpen: true })} title={tr(lang, 'expandNowPlaying')}>
              <IconExpandUp size={16} />
            </button>
          </div>
        </div>
      </motion.div>
    </>
  )
}
