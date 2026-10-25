// 主窗口侧的视频引擎挂载点。
//
// vlc 的视频像素画在独立窗口里（见 electron/main.cjs 的视频层），本组件不画视频，
// 只做三件事：
//   1) 把当前要播的条目 + 外挂字幕 + 断点位置交给 vlc；
//   2) 把 vlc 推来的时间轴写回 store（断点续播的落盘）；
//   3) 把覆盖窗口发来的语义事件（下一集/上一集/关闭）翻译成 store action。
//
// 如果机器上没有 vlc（或启动失败），自动退回原有 Vivid 形态的 <video> 播放器 —— 功能不丢。
import { useEffect, useRef, useState } from 'react'
import { useStore } from '../store/useStore'
import VideoPlayer from '../components/VideoPlayer'

const api = () => (window as any).electronAPI?.vlc

export default function VideoStage() {
  const playingId = useStore((s) => s.videoPlayingId)
  const items = useStore((s) => s.videoItems)
  const queue = useStore((s) => s.videoQueue)
  const progress = useStore((s) => s.videoProgress)
  const closeVideo = useStore((s) => s.closeVideo)
  const videoNext = useStore((s) => s.videoNext)
  const openVideo = useStore((s) => s.openVideo)
  const saveVideoProgress = useStore((s) => s.saveVideoProgress)
  const prefs = useStore((s) => s.audioPrefs)

  const item = items.find((v) => v.id === playingId) || null
  const [mode, setMode] = useState<'probing' | 'vlc' | 'html5'>('probing')
  const last = useRef({ time: 0, duration: 0 })
  const openedRef = useRef<string | null>(null)

  // —— 打开：把条目交给 vlc ——
  useEffect(() => {
    if (!item || !api()) { setMode('html5'); return }
    if (openedRef.current === item.id) return
    openedRef.current = item.id

    let cancelled = false
    ;(async () => {
      const avail = await api().available()
      if (cancelled) return
      if (!avail?.available) { setMode('html5'); return }

      let subtitleFiles: string[] = []
      try {
        const side = await (window as any).electronAPI.mediaSidecar(item.path)
        const subs = (side?.subtitles || []) as Array<{ path: string }>
        // 默认挂上第一个中文字幕（没有就挂第一个），其余留给覆盖窗口的字幕菜单切换
        const zh = subs.find((s: any) => /zh|chs|chi|简/i.test(s.path))
        const pick = zh || subs[0]
        if (pick) subtitleFiles = [pick.path]
      } catch { /* ignore */ }

      const saved = progress[item.id]
      const startAt = saved && saved.position > 5 && (!item.duration || saved.position / item.duration < 0.95)
        ? saved.position : 0

      const res = await api().open({
        id: item.id,
        path: item.path,
        name: item.name,
        duration: item.duration,
        startAt,
        subtitleFiles,
        volume: prefs.muted ? 0 : Math.round((prefs.volume ?? 0.8) * 100)
      })
      if (cancelled) return
      setMode(res?.ok ? 'vlc' : 'html5')
    })()

    return () => { cancelled = true }
  }, [item?.id])

  // 关掉视频时一并关掉 vlc 与两个窗口
  useEffect(() => {
    if (playingId) return
    openedRef.current = null
    api()?.close()
  }, [playingId])

  // —— 时间轴落盘 ——
  useEffect(() => {
    if (!api() || mode !== 'vlc') return
    const off = api().onState((s: any) => {
      if (!s || typeof s.time !== 'number') return
      last.current = { time: s.time, duration: s.duration || 0 }
    })
    const timer = window.setInterval(() => {
      const { time, duration } = last.current
      if (playingId && time > 0 && duration > 0) saveVideoProgress(playingId, time, duration)
    }, 5000)
    return () => {
      off?.()
      window.clearInterval(timer)
      const { time, duration } = last.current
      if (playingId && time > 0 && duration > 0) saveVideoProgress(playingId, time, duration)
    }
  }, [mode, playingId, saveVideoProgress])

  // —— 覆盖窗口的语义事件 ——
  useEffect(() => {
    const onEvent = (evt: any) => {
      const name = evt?.name
      if (name === 'next') videoNext()
      else if (name === 'prev') {
        const idx = queue.indexOf(playingId || '')
        if (idx >= 0 && queue.length > 1) openVideo(queue[(idx - 1 + queue.length) % queue.length], queue)
      } else if (name === 'close') {
        const { time, duration } = last.current
        if (playingId && time > 0 && duration > 0) saveVideoProgress(playingId, time, duration)
        closeVideo()
      }
    }
    const off = (window as any).electronAPI?.onVideoUiEvent?.(onEvent)
    return () => off?.()
  }, [closeVideo, openVideo, playingId, queue, saveVideoProgress, videoNext])

  useEffect(() => {
    const off = api()?.onClosed?.(() => { /* vlc 自行结束：store 由 window-all 逻辑收尾 */ })
    return () => off?.()
  }, [])

  if (mode === 'html5' || !item) {
    // 退回内置播放器时要让人一眼看出「为什么画面不一样、手势也不一样」，
    // 否则用户只会觉得播放器坏了
    return (
      <>
        <VideoPlayer />
        {item && mode === 'html5' && (
          <div className='vp-engine-note' title='找不到 libVLC：请确认 resources/vlc/libvlc.dll 存在，或执行 node scripts/fetch-vlc.mjs'>
            未加载 libVLC · 已退回内置播放器
          </div>
        )}
      </>
    )
  }
  // vlc 模式下主窗口不需要画视频；给一层黑底兜住首帧，避免闪出书架
  return <div className='vp-root' style={{ background: '#000' }} />
}
