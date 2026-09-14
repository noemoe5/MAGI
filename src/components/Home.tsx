import { useState } from 'react'
import { motion } from 'framer-motion'
import { Book } from '../types'
import { useStore } from '../store/useStore'
import { tr } from '../i18n'
import { BookCard, BookRow } from './BookCard'
import { importBook } from '../lib/import'
import { IconHome, IconGrid, IconList, IconSearch, IconPlus, IconSettings, IconBook, IconTag, IconChevron } from './icons'

export default function Home({ onOpen }: { onOpen: (b: Book) => void }) {
  const { books, settings, setSettingsOpen, patchSettings, addBooks, setLookupOpen, setLiteratureOpen } = useStore()
  const lang = settings.lang
  const [busy, setBusy] = useState(false)

  const q = settings.search.trim().toLowerCase()
  let list = books.filter((b) => {
    if (settings.filter === 'reading' && b.status !== 'reading') return false
    if (settings.filter === 'finished' && b.status !== 'finished') return false
    if (settings.filter === 'favorite' && !b.favorite) return false
    if (q && !(b.name.toLowerCase().includes(q) || (b.author || '').toLowerCase().includes(q))) return false
    return true
  })
  list = [...list].sort((a, b) => {
    if (settings.sort === 'title') return a.name.localeCompare(b.name)
    if (settings.sort === 'author') return (a.author || '').localeCompare(b.author || '')
    if (settings.sort === 'progress') return b.progress - a.progress
    return b.addedAt - a.addedAt
  })

  async function addBooksClick() {
    const api = (window as any).electronAPI
    if (!api) return
    setBusy(true)
    try {
      const paths: string[] = await api.openFiles()
      const imported: Book[] = []
      for (const p of paths) {
        const info = await api.openBook(p)
        if (info && !(info as any).error) imported.push(await importBook(info, p))
      }
      addBooks(imported)
    } finally {
      setBusy(false)
    }
  }

  const filters: Array<'all' | 'reading' | 'finished' | 'favorite'> = ['all', 'reading', 'finished', 'favorite']

  return (
    <>
      <div className='toolbar'>
        <IconHome size={18} className='icon-btn' style={{ cursor: 'default' }} />
        <span style={{ fontWeight: 700, fontSize: 15 }}>{tr(lang, 'library')}</span>
        <div className='seg'>
          {filters.map((f) => (
            <button key={f} className={settings.filter === f ? 'on' : ''} onClick={() => patchSettings({ filter: f })}>
              {tr(lang, f)}
            </button>
          ))}
        </div>
        <div className='grow' />
        <input className='search' placeholder={tr(lang, 'search')}
          value={settings.search} onChange={(e) => patchSettings({ search: e.target.value })} />
        <div className='seg'>
          <button className={settings.sort === 'recent' ? 'on' : ''} onClick={() => patchSettings({ sort: 'recent' })}>{tr(lang, 'recent')}</button>
          <button className={settings.sort === 'title' ? 'on' : ''} onClick={() => patchSettings({ sort: 'title' })}>{tr(lang, 'byTitle')}</button>
          <button className={settings.sort === 'progress' ? 'on' : ''} onClick={() => patchSettings({ sort: 'progress' })}>{tr(lang, 'byProgress')}</button>
        </div>
        <div className='seg'>
          <button className={settings.view === 'grid' ? 'on' : ''} onClick={() => patchSettings({ view: 'grid' })}><IconGrid size={15} /></button>
          <button className={settings.view === 'list' ? 'on' : ''} onClick={() => patchSettings({ view: 'list' })}><IconList size={15} /></button>
        </div>
        <button className='btn accent' onClick={addBooksClick} disabled={busy}>
          {busy ? <span className='spin' /> : <><IconPlus size={15} /> {tr(lang, 'addBooks')}</>}
        </button>
        <button className='icon-btn' title={tr(lang, 'settings')} onClick={() => setSettingsOpen(true)}><IconSettings size={18} /></button>
      </div>

      {/* 快捷入口：查阅中心 / 学术文献库。常驻可见，不随书库滚动，
          解决「功能存在但入口在阅读器悬浮栏里、平时看不到」的问题 */}
      <div className='entry-strip'>
        <button className='entry-card accent' title={tr(lang, 'research')} onClick={() => setLookupOpen(true)}>
          <span className='entry-ico'><IconBook size={17} /></span>
          <span className='entry-txt'>
            <b>{tr(lang, 'research')}</b>
            <em>{tr(lang, 'researchSub')}</em>
          </span>
          <IconChevron size={15} className='chev' />
        </button>
        <button className='entry-card' title={tr(lang, 'literature')} onClick={() => setLiteratureOpen(true)}>
          <span className='entry-ico'><IconTag size={17} /></span>
          <span className='entry-txt'>
            <b>{tr(lang, 'literature')}</b>
            <em>{tr(lang, 'literatureSub')}</em>
          </span>
          <IconChevron size={15} className='chev' />
        </button>
      </div>

      <div className='home'>
        {list.length === 0 ? (
          <div className='empty'>{books.length === 0 ? tr(lang, 'noBooks') : tr(lang, 'noBooks')}</div>
        ) : settings.view === 'grid' ? (
          <div className='grid'>
            {list.map((b, i) => (
              <motion.div key={b.id} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.28, delay: Math.min(i * 0.025, 0.4) }}>
                <BookCard book={b} onOpen={onOpen} />
              </motion.div>
            ))}
          </div>
        ) : (
          <div className='list'>
            {list.map((b, i) => (
              <motion.div key={b.id} initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }}
                transition={{ duration: 0.25, delay: Math.min(i * 0.02, 0.3) }}>
                <BookRow book={b} onOpen={onOpen} />
              </motion.div>
            ))}
          </div>
        )}
      </div>
    </>
  )
}
