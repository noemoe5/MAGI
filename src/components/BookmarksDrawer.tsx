import { motion } from 'framer-motion'
import { useStore } from '../store/useStore'
import { tr } from '../i18n'
import { IconClose, IconTrash } from './icons'

export default function BookmarksDrawer({ bookId, onJump }: { bookId: string; onJump: (cfi: string) => void }) {
  const lang = useStore((s) => s.settings.lang)
  const allBookmarks = useStore((s) => s.bookmarks)
  const allHighlights = useStore((s) => s.highlights)
  const removeBookmark = useStore((s) => s.removeBookmark)
  const removeHighlight = useStore((s) => s.removeHighlight)
  const close = () => useStore.getState().setBookmarksOpen(false)
  const bookmarks = allBookmarks.filter((b) => b.bookId === bookId)
  const highlights = allHighlights.filter((h) => h.bookId === bookId)

  return (
    <>
      <motion.div className='drawer-scrim' initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={close} />
      <motion.div className='drawer left' initial={{ x: '-100%' }} animate={{ x: 0 }} exit={{ x: '-100%' }}
        transition={{ type: 'tween', duration: 0.32, ease: [0.22, 1, 0.36, 1] }}>
        <div className='drawer-head'>
          <span style={{ flex: 1 }}>{tr(lang, 'bookmarks')}</span>
          <button className='icon-btn' onClick={close}><IconClose size={16} /></button>
        </div>
        <div className='drawer-body'>
          {bookmarks.map((b) => (
            <div key={b.id} className='bookmark-item' onClick={() => onJump(b.cfi)}>
              <span className='del' onClick={(e) => { e.stopPropagation(); removeBookmark(b.id) }}><IconTrash size={13} /></span>
              <div className='lbl'>{b.label}</div>
              <div className='pct'>{tr(lang, 'bookmark')}</div>
            </div>
          ))}
          {highlights.map((h) => (
            <div key={h.id} className='bookmark-item'>
              <span className='del' onClick={() => removeHighlight(h.id)}><IconTrash size={13} /></span>
              <div className='lbl' style={{ fontWeight: 400 }}>{h.text.slice(0, 40)}</div>
              <div className='pct'>{tr(lang, 'highlight')}</div>
            </div>
          ))}
          {bookmarks.length === 0 && highlights.length === 0 && <div className='empty'>{tr(lang, 'noBookmarks')}</div>}
        </div>
      </motion.div>
    </>
  )
}
