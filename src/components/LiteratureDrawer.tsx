import { useMemo, useState } from 'react'
import { motion } from 'framer-motion'
import { useStore } from '../store/useStore'
import { tr } from '../i18n'
import { uuid } from '../lib/util'
import { citation } from '../lib/lookup'
import { Literature } from '../types'
import {
  IconClose, IconSearch, IconPlus, IconTrash, IconCopy, IconExternal,
  IconUpload, IconSave, IconBook, IconTag, IconChevron
} from './icons'

const EMPTY = { title: '', author: '', year: '', publisher: '', url: '', tags: '', note: '' }

async function copy(text: string): Promise<boolean> {
  try { await navigator.clipboard.writeText(text); return true } catch { return false }
}

export default function LiteratureDrawer() {
  const lang = useStore((s) => s.settings.lang)
  const literature = useStore((s) => s.literature)
  const books = useStore((s) => s.books)
  const currentBookId = useStore((s) => s.currentBookId)
  const addLiterature = useStore((s) => s.addLiterature)
  const removeLiterature = useStore((s) => s.removeLiterature)
  const updateLiterature = useStore((s) => s.updateLiterature)
  const close = () => useStore.getState().setLiteratureOpen(false)

  const [form, setForm] = useState({ ...EMPTY })
  const [adding, setAdding] = useState(false)
  const [kw, setKw] = useState('')
  const [openTag, setOpenTag] = useState<string | null>(null)
  const [citStyle, setCitStyle] = useState<'gbt' | 'apa'>('gbt')
  const [flash, setFlash] = useState('')

  function say(msg: string) {
    setFlash(msg)
    setTimeout(() => setFlash(''), 1800)
  }

  const currentBook = books.find((b) => b.id === currentBookId) || null

  const filtered = useMemo(() => {
    const k = kw.trim().toLowerCase()
    if (!k) return literature
    return literature.filter(
      (l) =>
        l.title.toLowerCase().includes(k) ||
        (l.author || '').toLowerCase().includes(k) ||
        (l.tags || []).some((t) => t.toLowerCase().includes(k)) ||
        (l.note || '').toLowerCase().includes(k)
    )
  }, [literature, kw])

  const allTags = useMemo(() => {
    const s = new Set<string>()
    literature.forEach((l) => (l.tags || []).forEach((t) => t && s.add(t)))
    return Array.from(s)
  }, [literature])

  function submit() {
    if (!form.title.trim()) return
    const item: Literature = {
      id: uuid(),
      title: form.title.trim(),
      author: form.author.trim() || undefined,
      year: form.year.trim() || undefined,
      publisher: form.publisher.trim() || undefined,
      url: form.url.trim() || undefined,
      tags: form.tags.split(/[,，\s]+/).map((t) => t.trim()).filter(Boolean),
      note: form.note.trim() || undefined,
      bookId: currentBookId ?? undefined,
      createdAt: Date.now()
    }
    addLiterature(item)
    setForm({ ...EMPTY })
    setAdding(false)
    say(tr(lang, 'litAdded'))
  }

  async function importFile() {
    const api = (window as any).electronAPI
    if (!api?.openJson) { say(tr(lang, 'desktopOnly')); return }
    const res = await api.openJson()
    if (!res || res.error) { if (res?.error) say(res.error.slice(0, 60)); return }
    try {
      const parsed = JSON.parse(res.text)
      const arr: any[] = Array.isArray(parsed) ? parsed : parsed?.literature
      if (!Array.isArray(arr)) { say(tr(lang, 'badJson')); return }
      let n = 0
      for (const x of arr) {
        if (!x?.title) continue
        addLiterature({
          id: uuid(),
          title: String(x.title),
          author: x.author ? String(x.author) : undefined,
          year: x.year ? String(x.year) : undefined,
          publisher: x.publisher ? String(x.publisher) : undefined,
          url: x.url ? String(x.url) : undefined,
          tags: Array.isArray(x.tags) ? x.tags.map(String) : [],
          note: x.note ? String(x.note) : undefined,
          createdAt: Date.now()
        })
        n++
      }
      say(`${tr(lang, 'imported')} ${n}`)
    } catch {
      say(tr(lang, 'badJson'))
    }
  }

  async function exportFile() {
    const api = (window as any).electronAPI
    const content = JSON.stringify(literature, null, 2)
    if (api?.saveJson) {
      const ok = await api.saveJson('novelreader-literature.json', content)
      if (ok === true) say(tr(lang, 'exported'))
    } else {
      void copy(content)
      say(tr(lang, 'copied'))
    }
  }

  return (
    <>
      <motion.div className='drawer-scrim' initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={close} />
      <motion.div className='drawer wide'
        initial={{ x: '100%' }} animate={{ x: 0 }} exit={{ x: '100%' }}
        transition={{ type: 'tween', duration: 0.32, ease: [0.22, 1, 0.36, 1] }}>
        <div className='drawer-head'>
          <IconBook size={16} />
          <span style={{ flex: 1, marginLeft: 8 }}>{tr(lang, 'literature')}</span>
          <button className='icon-btn' title={tr(lang, 'litAdd')} onClick={() => setAdding((v) => !v)}><IconPlus size={16} /></button>
          <button className='icon-btn' onClick={close}><IconClose size={16} /></button>
        </div>

        <div className='drawer-body'>
          <div className='rp-search'>
            <IconSearch size={15} />
            <input value={kw} placeholder={tr(lang, 'litSearchPh')} onChange={(e) => setKw(e.target.value)} />
          </div>

          {/* 引用格式切换 + 导入导出 */}
          <div className='rp-row'>
            <div className='seg' style={{ height: 30 }}>
              <button className={citStyle === 'gbt' ? 'on' : ''} onClick={() => setCitStyle('gbt')}>GB/T</button>
              <button className={citStyle === 'apa' ? 'on' : ''} onClick={() => setCitStyle('apa')}>APA</button>
            </div>
            <button className='rp-act' onClick={importFile}><IconUpload size={13} /> {tr(lang, 'importJson')}</button>
            <button className='rp-act' onClick={exportFile}><IconSave size={13} /> {tr(lang, 'exportJson')}</button>
          </div>

          {allTags.length > 0 && (
            <div className='lit-tags'>
              {allTags.map((t) => (
                <span key={t} className={'lit-chip' + (openTag === t ? ' on' : '')}
                  onClick={() => { setOpenTag(openTag === t ? null : t); setKw(openTag === t ? '' : t) }}>
                  #{t}
                </span>
              ))}
            </div>
          )}

          {/* 新增表单 */}
          {adding && (
            <div className='rp-add'>
              <input className='rp-in' value={form.title} placeholder={tr(lang, 'litTitlePh')} onChange={(e) => setForm({ ...form, title: e.target.value })} autoFocus />
              <div className='lit-2col'>
                <input className='rp-in' value={form.author} placeholder={tr(lang, 'litAuthorPh')} onChange={(e) => setForm({ ...form, author: e.target.value })} />
                <input className='rp-in' value={form.year} placeholder={tr(lang, 'litYearPh')} onChange={(e) => setForm({ ...form, year: e.target.value })} />
              </div>
              <div className='lit-2col'>
                <input className='rp-in' value={form.publisher} placeholder={tr(lang, 'litPubPh')} onChange={(e) => setForm({ ...form, publisher: e.target.value })} />
                <input className='rp-in' value={form.tags} placeholder={tr(lang, 'litTagsPh')} onChange={(e) => setForm({ ...form, tags: e.target.value })} />
              </div>
              <input className='rp-in' value={form.url} placeholder={tr(lang, 'litUrlPh')} onChange={(e) => setForm({ ...form, url: e.target.value })} />
              <textarea className='rp-ta' rows={2} value={form.note} placeholder={tr(lang, 'litNotePh')} onChange={(e) => setForm({ ...form, note: e.target.value })} />
              {currentBook && (
                <div className='lit-link'><IconBook size={12} /> {tr(lang, 'litLinkTo')}{currentBook.name}</div>
              )}
              <div className='rp-row'>
                <button className='btn accent' style={{ height: 30 }} onClick={submit}>{tr(lang, 'litSave')}</button>
                <button className='rp-act' onClick={() => { setForm({ ...EMPTY }); setAdding(false) }}>{tr(lang, 'cancel')}</button>
              </div>
            </div>
          )}

          {filtered.map((l) => {
            const linked = books.find((b) => b.id === l.bookId)
            return (
              <div key={l.id} className='rp-card'>
                <div className='rp-card-h'>
                  <b>{l.title}</b>
                </div>
                <div className='lit-meta'>
                  {[l.author, l.year, l.publisher].filter(Boolean).join(' · ')}
                </div>
                {l.note && <p>{l.note}</p>}
                {!!l.tags.length && (
                  <div className='lit-tags'>
                    {l.tags.map((t) => <span key={t} className='lit-chip'>#{t}</span>)}
                  </div>
                )}
                <div className='lit-cite'>{citation(l, citStyle)}</div>
                <div className='rp-acts'>
                  <button className='rp-act' onClick={async () => { if (await copy(citation(l, citStyle))) say(tr(lang, 'copied')) }}>
                    <IconCopy size={13} /> {tr(lang, 'copyCite')}
                  </button>
                  {l.url && (
                    <button className='rp-act' onClick={() => (window as any).electronAPI?.openExternal?.(l.url!)}>
                      <IconExternal size={13} /> {tr(lang, 'openLink')}
                    </button>
                  )}
                  {!l.bookId && currentBook && (
                    <button className='rp-act' onClick={() => updateLiterature(l.id, { bookId: currentBook.id })}>
                      <IconBook size={13} /> {tr(lang, 'litLink')}
                    </button>
                  )}
                  {linked && <span className='rp-src'>{linked.name}</span>}
                  <button className='rp-act danger' onClick={() => removeLiterature(l.id)}>
                    <IconTrash size={13} /> {tr(lang, 'delete')}
                  </button>
                </div>
              </div>
            )
          })}

          {filtered.length === 0 && <div className='empty'>{tr(lang, 'litEmpty')}</div>}
        </div>

        {flash && <div className='rp-flash'>{flash}</div>}
      </motion.div>
    </>
  )
}
