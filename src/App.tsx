import { useEffect, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { useStore } from './store/useStore'
import { applyTheme } from './theme/themes'
import { loadLibrary } from './lib/persistence'
import { Book } from './types'
import TitleBar from './components/TitleBar'
import Home from './components/Home'
import Reader from './components/Reader'
import SettingsDrawer from './components/SettingsDrawer'

export default function App() {
  const settings = useStore((s) => s.settings)
  const init = useStore((s) => s.init)
  const currentBookId = useStore((s) => s.currentBookId)
  const setCurrent = useStore((s) => s.setCurrent)
  const books = useStore((s) => s.books)
  const settingsOpen = useStore((s) => s.settingsOpen)
  const [ready, setReady] = useState(false)

  useEffect(() => {
    loadLibrary().then((data) => {
      init(data)
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

  return (
    <div className='app'>
      <TitleBar />
      <AnimatePresence mode='wait'>
        {current ? (
          <motion.div key='reader' style={{ flex: 1, display: 'flex', minHeight: 0 }}
            initial={{ opacity: 0, scale: 1.04 }} animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 1.03 }} transition={{ duration: 0.34, ease: [0.22, 1, 0.36, 1] }}>
            <Reader book={current as Book} onClose={() => setCurrent(null)} />
          </motion.div>
        ) : (
          <motion.div key='home' style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0, scale: 0.99 }}
            transition={{ duration: 0.25 }}>
            {ready ? <Home onOpen={(b) => setCurrent(b.id)} /> : <div className='loading'><span className='spin' /></div>}
          </motion.div>
        )}
      </AnimatePresence>

      {/* 设置抽屉挂在应用层：书库页与阅读页都能打开 */}
      <AnimatePresence>
        {settingsOpen && <SettingsDrawer />}
      </AnimatePresence>
    </div>
  )
}
