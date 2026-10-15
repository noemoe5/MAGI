// 音频引擎：把全局 <audio> 元素与 zustand store 双向同步。
// - currentId 变化 → 换 src + 断点恢复 + 自动播放
// - audioPlaying 变化 → play()/pause()
// - audioSeekToken 变化 → 显式 seek（避免与 timeupdate 回写打架）
// - 元素事件 → 回写 position/duration/playing；ended → 自动下一曲
// - 睡眠定时器 / Media Session（SMTC）
import { useEffect } from 'react'
import { useStore } from '../store/useStore'
import { audioGraph } from './audioGraph'
import { mediaUrl } from './util'

export function useAudioEngine(audioRef: React.RefObject<HTMLAudioElement | null>) {
  const currentId = useStore((s) => s.audioCurrentId)
  const playing = useStore((s) => s.audioPlaying)
  const seekToken = useStore((s) => s.audioSeekToken)
  const position = useStore((s) => s.audioPosition)
  const volume = useStore((s) => s.audioPrefs.volume)
  const muted = useStore((s) => s.audioPrefs.muted)
  const rate = useStore((s) => s.audioPrefs.rate)
  const tracks = useStore((s) => s.audioTracks)
  const positions = useStore((s) => s.audioPositions)
  const patchAudio = useStore((s) => s.patchAudio)
  const audioNext = useStore((s) => s.audioNext)
  const audioPrev = useStore((s) => s.audioPrev)
  const saveAudioPosition = useStore((s) => s.saveAudioPosition)

  // 切歌：换 src + 断点恢复
  useEffect(() => {
    const el = audioRef.current
    if (!el || !currentId) return
    const track = tracks.find((t) => t.id === currentId)
    if (!track) return
    const url = mediaUrl(track.path)
    if (!url) return
    if (el.getAttribute('src') !== url) {
      el.setAttribute('src', url)
      el.load()
      const saved = positions[currentId]
      if (saved && saved.pos > 3 && saved.dur > 0 && saved.pos / saved.dur < 0.95) {
        try { el.currentTime = saved.pos } catch { /* ignore */ }
      }
      if (playing) el.play().catch(() => patchAudio({ audioPlaying: false }))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentId])

  // 播放 / 暂停
  useEffect(() => {
    const el = audioRef.current
    if (!el || !currentId) return
    if (playing) {
      // 任意播放路径都确保音频图已接入（可视化/均衡器依赖；手势外调用也能 unlock）
      audioGraph.attach(el)
      audioGraph.resume()
      el.play().catch(() => patchAudio({ audioPlaying: false }))
    } else {
      el.pause()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing, currentId])

  // 显式 seek（进度条拖动 / 上一曲回开头 / 单曲循环重播）
  useEffect(() => {
    const el = audioRef.current
    if (!el || !currentId || seekToken === 0) return
    if (Math.abs(el.currentTime - position) > 0.35) {
      try { el.currentTime = position } catch { /* ignore */ }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seekToken])

  // 音量 / 速率
  useEffect(() => {
    const el = audioRef.current
    if (!el) return
    el.volume = muted ? 0 : Math.max(0, Math.min(1, volume))
    el.muted = muted
  }, [volume, muted])
  useEffect(() => {
    const el = audioRef.current
    if (el) el.playbackRate = rate
  }, [rate])

  // 元素事件回写
  useEffect(() => {
    const el = audioRef.current
    if (!el) return
    let lastSave = 0
    const onTime = () => {
      patchAudio({ audioPosition: el.currentTime })
      const now = Date.now()
      if (now - lastSave > 10000 && currentId && el.duration) {
        lastSave = now
        saveAudioPosition(currentId, el.currentTime, el.duration)
      }
    }
    const onMeta = () => patchAudio({ audioDuration: el.duration || 0 })
    const onEnd = () => audioNext(true)
    const onPlay = () => patchAudio({ audioPlaying: true })
    const onPause = () => {
      patchAudio({ audioPlaying: false })
      if (currentId && el.duration) saveAudioPosition(currentId, el.currentTime, el.duration)
    }
    const onVisibility = () => {
      if (document.hidden && currentId && el.duration) {
        saveAudioPosition(currentId, el.currentTime, el.duration)
      }
    }
    el.addEventListener('timeupdate', onTime)
    el.addEventListener('loadedmetadata', onMeta)
    el.addEventListener('durationchange', onMeta)
    el.addEventListener('ended', onEnd)
    el.addEventListener('play', onPlay)
    el.addEventListener('pause', onPause)
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      el.removeEventListener('timeupdate', onTime)
      el.removeEventListener('loadedmetadata', onMeta)
      el.removeEventListener('durationchange', onMeta)
      el.removeEventListener('ended', onEnd)
      el.removeEventListener('play', onPlay)
      el.removeEventListener('pause', onPause)
      document.removeEventListener('visibilitychange', onVisibility)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentId])

  // 睡眠定时器：到点自动暂停
  useEffect(() => {
    const timer = setInterval(() => {
      const s = useStore.getState()
      if (s.sleepTimerEnd && Date.now() >= s.sleepTimerEnd) {
        patchAudio({ audioPlaying: false, sleepTimerEnd: null })
      }
    }, 1000)
    return () => clearInterval(timer)
 }, [])

  // Media Session（Windows SMTC / 媒体键）
  useEffect(() => {
    if (!('mediaSession' in navigator) || !currentId) return
    const track = tracks.find((t) => t.id === currentId)
    if (!track) return
    try {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: track.name,
        artist: track.artist || '',
        album: track.album || '',
        artwork: track.cover ? [{ src: track.cover, sizes: '320x320', type: 'image/jpeg' }] : []
      })
      navigator.mediaSession.setActionHandler('play', () => patchAudio({ audioPlaying: true }))
      navigator.mediaSession.setActionHandler('pause', () => patchAudio({ audioPlaying: false }))
      navigator.mediaSession.setActionHandler('previoustrack', () => audioPrev())
      navigator.mediaSession.setActionHandler('nexttrack', () => audioNext())
    } catch { /* ignore */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentId, tracks])
}
