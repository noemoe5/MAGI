import { useEffect, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { useStore } from './store/useStore'
import { applyTheme } from './theme/themes'
import { loadLibrary } from './lib/persistence'
import { BUILTIN_KNOWLEDGE } from './lib/lookup'
import { Book } from './types'
import TitleBar from './components/TitleBar'
import Home from './components/Home'
import Reader from './components/Reader'
import SettingsDrawer from './components/SettingsDrawer'
import ResearchPanel from './components/ResearchPanel'
import LiteratureDrawer from './components/LiteratureDrawer'
import MusicLibrary from './components/MusicLibrary'
import VideoLibrary from './components/VideoLibrary'
import AudioPlayerBar from './components/AudioPlayerBar'
import NowPlaying from './components/NowPlaying'
import VideoPlayer from './components/VideoPlayer'
import { IconBook, IconMusic, IconFilm } from './components/icons'
import { tr } from './i18n'

export default function App() {
  const settings = useStore((s) => s.settings)
  const init = useStore((s) => s.init)
  const currentBookId = useStore((s) => s.currentBookId)
  const setCurrent = useStore((s) => s.setCurrent)
  const books = useStore((s) => s.books)
  const settingsOpen = useStore((s) => s.settingsOpen)
  const lookupOpen = useStore((s) => s.lookupOpen)
  const literatureOpen = useStore((s) => s.literatureOpen)
  const section = useStore((s) => s.section)
  const setSection = useStore((s) => s.setSection)
  const audioCurrentId = useStore((s) => s.audioCurrentId)
  const nowPlayingOpen = useStore((s) => s.nowPlayingOpen)
  const videoPlayingId = useStore((s) => s.videoPlayingId)
  const [ready, setReady] = useState(false)

  useEffect(() => {
    loadLibrary().then((data) => {
      init(data)
      // 首次启动（或词库被清空）时预置内置词条，保证断网也有查阅能力
      const s = useStore.getState()
      if (!s.knowledge.length) s.importKnowledge(BUILTIN_KNOWLEDGE)
      // 恢复媒体路径到主进程白名单（断点续播/重新播放需要）
      const api = (window as any).electronAPI
      if (api?.mediaRegister) {
        const paths = [...(data?.audioTracks ?? []).map((t) => t.path), ...(data?.videoItems ?? []).map((v) => v.path)]
        if (paths.length) api.mediaRegister(paths)
      }
      setReady(true)
    })
  }, [init])

  useEffect(() => {
    applyTheme(settings.theme, settings.accent)
  }, [settings.theme, settings.accent])

  // 书库页 ESC 关设置抽屉（阅读页的逐层退出由 Reader 处理）
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      const s = useStore.getState()
      if (!s.currentBookId && s.settingsOpen) s.setSettingsOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const current = books.find((b) => b.id === currentBookId) || null

  const railItems: Array<{ key: typeof section; icon: typeof IconBook; label: string }> = [
    { key: 'books', icon: IconBook, label: tr(settings.lang, 'sectionBooks') },
    { key: 'music', icon: IconMusic, label: tr(settings.lang, 'sectionMusic') },
    { key: 'video', icon: IconFilm, label: tr(settings.lang, 'sectionVideo') }
  ]

  return (
    <div className={`app${audioCurrentId ? ' has-player' : ''}`}>
      <TitleBar />
      <div className='app-body'>
        {/* 左侧分区导航：书架 / 音乐 / 视频 */}
        <nav className='rail'>
          {railItems.map((it) => {
            const Icon = it.icon
            const active = section === it.key && !current
            return (
              <button key={it.key} className={`rail-btn ${active ? 'on' : ''}`}
                title={it.label} onClick={() => { setSection(it.key); setCurrent(null) }}>
                <Icon size={19} />
                <em>{it.label}</em>
              </button>
            )
          })}
        </nav>

        <main className='app-main'>
          <AnimatePresence mode='wait'>
            {current ? (
              <motion.div key='reader' style={{ flex: 1, display: 'flex', minHeight: 0 }}
                initial={{ opacity: 0, scale: 1.04 }} animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 1.03 }} transition={{ duration: 0.34, ease: [0.22, 1, 0.36, 1] }}>
                <Reader book={current as Book} onClose={() => setCurrent(null)} />
              </motion.div>
            ) : section === 'music' ? (
              <motion.div key='music' style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}
                initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0, scale: 0.99 }}
                transition={{ duration: 0.25 }}>
                {ready ? <MusicLibrary /> : <div className='loading'><span className='spin' /></div>}
              </motion.div>
            ) : section === 'video' ? (
              <motion.div key='video' style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}
                initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0, scale: 0.99 }}
                transition={{ duration: 0.25 }}>
                {ready ? <VideoLibrary /> : <div className='loading'><span className='spin' /></div>}
              </motion.div>
            ) : (
              <motion.div key='home' style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}
                initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0, scale: 0.99 }}
                transition={{ duration: 0.25 }}>
                {ready ? <Home onOpen={(b) => setCurrent(b.id)} /> : <div className='loading'><span className='spin' /></div>}
              </motion.div>
            )}
          </AnimatePresence>
        </main>
      </div>

      {/* 全局音频播放条（Folia 形态：常驻底部） */}
      <AnimatePresence>
        {audioCurrentId && <AudioPlayerBar key='player-bar' />}
      </AnimatePresence>

      {/* 全屏播放台 / 视频播放器 */}
      <AnimatePresence>
        {nowPlayingOpen && <NowPlaying key='now-playing' />}
      </AnimatePresence>
      <AnimatePresence>
        {videoPlayingId && <VideoPlayer key='video-player' />}
      </AnimatePresence>

      {/* 设置抽屉挂在应用层：书库页与阅读页都能打开 */}
      <AnimatePresence>
        {settingsOpen && <SettingsDrawer />}
      </AnimatePresence>

      {/* 查阅中心（划词查 / 收藏 / 本地词库）与学术文献库：同样挂在应用层，
          书库页与阅读页都能呼出，数据由 zustand 共享 */}
      <AnimatePresence>
        {lookupOpen && <ResearchPanel />}
      </AnimatePresence>
      <AnimatePresence>
        {literatureOpen && <LiteratureDrawer />}
      </AnimatePresence>
    </div>
  )
}
