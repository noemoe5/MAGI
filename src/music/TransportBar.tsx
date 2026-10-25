// 全局传输条 —— 扁平、常驻、信息紧凑（foobar2000 底部那条的取向）
//
// 它是唯一的 <audio> 宿主：useAudioEngine 在这里把元素和 store 双向绑定，
// 所以只要这条在，任何页面切歌/播放都能工作，不需要第二个音频元素。
import { useRef, useState } from 'react'
import { useStore } from '../store/useStore'
import { useAudioEngine } from '../lib/useAudioEngine'
import { audioGraph } from '../lib/audioGraph'
import { fmtTime } from '../lib/util'
import {
  IconPlay, IconPause, IconPrev, IconNext, IconShuffle, IconRepeat, IconRepeatOne,
  IconVolume, IconVolumeX, IconMusic
} from '../components/icons'

export default function TransportBar() {
  const audioRef = useRef<HTMLAudioElement>(null)
  useAudioEngine(audioRef)

  const currentId = useStore((s) => s.audioCurrentId)
  const tracks = useStore((s) => s.audioTracks)
  const playing = useStore((s) => s.audioPlaying)
  const position = useStore((s) => s.audioPosition)
  const duration = useStore((s) => s.audioDuration)
  const prefs = useStore((s) => s.audioPrefs)
  const patchAudio = useStore((s) => s.patchAudio)
  const patchPrefs = useStore((s) => s.patchAudioPrefs)
  const toggleAudio = useStore((s) => s.toggleAudio)
  const audioNext = useStore((s) => s.audioNext)
  const audioPrev = useStore((s) => s.audioPrev)
  const cyclePlayMode = useStore((s) => s.cyclePlayMode)

  const [dragging, setDragging] = useState(false)
  const [dragPos, setDragPos] = useState(0)

  const track = tracks.find((t) => t.id === currentId) || null
  if (!track) return null

  const total = duration || track.duration || 0
  const shown = dragging ? dragPos : position
  const pct = total ? Math.max(0, Math.min(100, (shown / total) * 100)) : 0

  const onToggle = () => {
    const el = audioRef.current
    if (el && !playing) {
      audioGraph.attach(el)
      audioGraph.resume()
    }
    toggleAudio()
  }

  const onSeekStart = (e: React.PointerEvent) => {
    if (!total) return
    const bar = e.currentTarget as HTMLElement
    const rect = bar.getBoundingClientRect()
    const at = (clientX: number) => {
      const r = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width))
      return { r, t: r * total }
    }
    const first = at(e.clientX)
    setDragPos(first.t)
    setDragging(true)
    const move = (ev: PointerEvent) => setDragPos(at(ev.clientX).t)
    const up = (ev: PointerEvent) => {
      const t = at(ev.clientX).t
      patchAudio({ audioPosition: t, audioSeekToken: useStore.getState().audioSeekToken + 1 })
      setDragging(false)
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  const modeIcon = prefs.mode === 'shuffle'
    ? <IconShuffle size={15} />
    : prefs.mode === 'single' ? <IconRepeatOne size={15} /> : <IconRepeat size={15} />
  const modeTitle = prefs.mode === 'shuffle' ? '随机播放' : prefs.mode === 'single' ? '单曲循环' : '顺序播放'
  const subLine = [track.artist, track.album].filter(Boolean).join(' · ') || '未知艺术家'

  return (
    <>
      <audio ref={audioRef} preload='metadata' />
      <div className='tb-bar'>
        <div className='tb-progress' onPointerDown={onSeekStart} title='拖动跳转'>
          <div className='tb-progress-fill' style={{ width: pct + '%' }} />
        </div>

        <div className='tb-cover'>
          {track.cover ? <img src={track.cover} alt='' /> : <IconMusic size={18} />}
        </div>

        <div className='tb-meta'>
          <div className='tb-title' title={track.name}>{track.name}</div>
          <div className='tb-sub' title={subLine}>{subLine}</div>
        </div>

        <div className='tb-ctrl'>
          <button className='tb-btn' onClick={() => audioPrev()} title='上一首'><IconPrev size={16} /></button>
          <button className='tb-btn play' onClick={onToggle} title={playing ? '暂停' : '播放'}>
            {playing ? <IconPause size={17} /> : <IconPlay size={17} />}
          </button>
          <button className='tb-btn' onClick={() => audioNext()} title='下一首'><IconNext size={16} /></button>
        </div>

        <div className='tb-time'>{fmtTime(shown)} / {fmtTime(total)}</div>

        <div className='tb-grow' />

        <div className='tb-vol'>
          <button className='tb-btn' title={prefs.muted ? '取消静音' : '静音'}
            onClick={() => patchPrefs({ muted: !prefs.muted })}>
            {prefs.muted || prefs.volume === 0 ? <IconVolumeX size={15} /> : <IconVolume size={15} />}
          </button>
          <input type='range' min={0} max={1} step={0.01}
            value={prefs.muted ? 0 : prefs.volume}
            onChange={(e) => patchPrefs({ volume: Number(e.target.value), muted: false })} />
        </div>

        <button className={`tb-btn ${prefs.mode !== 'order' ? 'on' : ''}`} onClick={cyclePlayMode} title={modeTitle}>
          {modeIcon}
        </button>
      </div>
    </>
  )
}
