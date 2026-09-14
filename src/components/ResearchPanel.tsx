import { useEffect, useMemo, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import { useStore } from '../store/useStore'
import { tr } from '../i18n'
import { uuid } from '../lib/util'
import { BUILTIN_KNOWLEDGE, LookupResult, runLookup, translate } from '../lib/lookup'
import { KnowledgeEntry, Note } from '../types'
import {
  IconClose, IconSearch, IconGlobe, IconBook, IconNote, IconTrash,
  IconCopy, IconExternal, IconSave, IconUpload, IconTranslate, IconPlus, IconTag
} from './icons'

type Tab = 'lookup' | 'notes' | 'knowledge'

async function copy(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    // 剪贴板 API 在部分环境不可用 → 退化为 textarea + execCommand
    try {
      const ta = document.createElement('textarea')
      ta.value = text
      ta.style.position = 'fixed'
      ta.style.opacity = '0'
      document.body.appendChild(ta)
      ta.select()
      const ok = document.execCommand('copy')
      document.body.removeChild(ta)
      return ok
    } catch {
      return false
    }
  }
}

export default function ResearchPanel() {
  const lang = useStore((s) => s.settings.lang)
  const knowledge = useStore((s) => s.knowledge)
  const notes = useStore((s) => s.notes)
  const seed = useStore((s) => s.lookupSeed)
  const currentBookId = useStore((s) => s.currentBookId)
  const addNote = useStore((s) => s.addNote)
  const removeNote = useStore((s) => s.removeNote)
  const clearNotes = useStore((s) => s.clearNotes)
  const importKnowledge = useStore((s) => s.importKnowledge)
  const addKnowledge = useStore((s) => s.addKnowledge)
  const clearKnowledge = useStore((s) => s.clearKnowledge)
  const close = () => useStore.getState().setLookupOpen(false)

  const [tab, setTab] = useState<Tab>('lookup')
  const [q, setQ] = useState('')
  const [busy, setBusy] = useState(false)
  const [online, setOnline] = useState(true)
  const [result, setResult] = useState<LookupResult | null>(null)
  const [flash, setFlash] = useState('')
  const [trans, setTrans] = useState<Record<string, string>>({})
  const [kw, setKw] = useState('')
  const [newTerm, setNewTerm] = useState('')
  const [newDef, setNewDef] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  // 面板打开时自动聚焦；带划词 seed 则直接查
  useEffect(() => {
    inputRef.current?.focus()
    if (seed && seed.trim()) {
      setTab('lookup')
      setQ(seed)
      void doLookup(seed)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seed])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  function say(msg: string) {
    setFlash(msg)
    setTimeout(() => setFlash(''), 1800)
  }

  async function doLookup(query: string) {
    const text = query.trim()
    if (!text) return
    setBusy(true)
    try {
      const r = await runLookup(text, { lang, knowledge, online })
      setResult(r)
    } finally {
      setBusy(false)
    }
  }

  async function onTranslate(text: string, target: 'zh' | 'en') {
    const pair = target === 'zh' ? 'en|zh-CN' : 'zh-CN|en'
    try {
      const out = await translate(text.slice(0, 900), ...(pair.split('|') as [string, string]))
      setTrans((t) => ({ ...t, [text]: out }))
    } catch (e: any) {
      say((e?.message || '翻译失败').slice(0, 60))
    }
  }

  function saveAsNote(payload: { query: string; title?: string; content: string; source: Note['source']; url?: string }) {
    addNote({
      id: uuid(),
      bookId: currentBookId ?? undefined,
      query: payload.query,
      title: payload.title,
      content: payload.content,
      source: payload.source,
      url: payload.url,
      createdAt: Date.now()
    })
    say(tr(lang, 'noteSaved'))
  }

  /** 把当前查询词收进本地知识库（自定义词条） */
  function saveAsTerm(term: string, definition: string, source = '自定义') {
    if (!term.trim() || !definition.trim()) return
    addKnowledge({ term: term.trim(), definition: definition.trim(), source })
    say(tr(lang, 'termSaved'))
  }

  async function importKnowledgeFile() {
    const api = (window as any).electronAPI
    if (!api?.openJson) { say(tr(lang, 'desktopOnly')); return }
    const res = await api.openJson()
    if (!res) return
    if (res.error) { say(res.error.slice(0, 60)); return }
    try {
      const parsed = JSON.parse(res.text)
      const arr: any[] = Array.isArray(parsed) ? parsed : parsed?.knowledge
      if (!Array.isArray(arr)) { say(tr(lang, 'badJson')); return }
      const entries: KnowledgeEntry[] = arr
        .filter((x) => x && (x.term || x.name))
        .map((x) => ({
          term: String(x.term ?? x.name).trim(),
          alias: Array.isArray(x.alias) ? x.alias.map(String) : undefined,
          definition: String(x.definition ?? x.def ?? x.desc ?? '').trim(),
          source: x.source ? String(x.source) : '导入',
          tags: Array.isArray(x.tags) ? x.tags.map(String) : undefined
        }))
        .filter((x) => x.term && x.definition)
      importKnowledge(entries)
      say(`${tr(lang, 'imported')} ${entries.length}`)
    } catch (e: any) {
      say(tr(lang, 'badJson'))
    }
  }

  async function exportKnowledge() {
    const api = (window as any).electronAPI
    const content = JSON.stringify(knowledge, null, 2)
    if (api?.saveJson) {
      const ok = await api.saveJson('novelreader-knowledge.json', content)
      say(ok === true ? tr(lang, 'exported') : '')
    } else {
      void copy(content)
      say(tr(lang, 'copied'))
    }
  }

  const filteredKnowledge = useMemo(() => {
    const k = kw.trim().toLowerCase()
    if (!k) return knowledge
    return knowledge.filter(
      (e) => e.term.toLowerCase().includes(k) || (e.alias || []).some((a) => a.toLowerCase().includes(k))
    )
  }, [knowledge, kw])

  return (
    <>
      <motion.div className='drawer-scrim' initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={close} />
      <motion.div className='drawer wide'
        initial={{ x: '100%' }} animate={{ x: 0 }} exit={{ x: '100%' }}
        transition={{ type: 'tween', duration: 0.32, ease: [0.22, 1, 0.36, 1] }}>
        <div className='drawer-head'>
          <IconBook size={16} />
          <span style={{ flex: 1, marginLeft: 8 }}>{tr(lang, 'research')}</span>
          <button className='icon-btn' onClick={close}><IconClose size={16} /></button>
        </div>

        {/* Tab 切换 */}
        <div className='rp-tabs'>
          {([['lookup', 'tabLookup', IconGlobe], ['notes', 'tabNotes', IconNote], ['knowledge', 'tabKnowledge', IconTag]] as const).map(
            ([key, label, Ico]) => (
              <button key={key} className={'rp-tab' + (tab === key ? ' on' : '')} onClick={() => setTab(key as Tab)}>
                <Ico size={15} />
                <span>{tr(lang, label)}</span>
                {key === 'notes' && notes.length > 0 && <i className='rp-badge'>{notes.length}</i>}
                {key === 'knowledge' && knowledge.length > 0 && <i className='rp-badge'>{knowledge.length}</i>}
              </button>
            )
          )}
        </div>

        {tab === 'lookup' && (
          <div className='drawer-body'>
            <div className='rp-search'>
              <IconSearch size={15} />
              <input
                ref={inputRef}
                value={q}
                placeholder={tr(lang, 'lookupPlaceholder')}
                onChange={(e) => setQ(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') void doLookup(q) }}
              />
              <button className='btn accent' style={{ height: 30, padding: '0 12px' }} onClick={() => void doLookup(q)}>
                {tr(lang, 'lookup')}
              </button>
            </div>

            <div className='rp-row'>
              <label className='rp-switch'>
                <span className={'sw' + (online ? ' on' : '')} onClick={() => setOnline((v) => !v)} />
                <em>{tr(lang, 'onlineLookup')}</em>
              </label>
              {busy && <span className='rp-busy'><span className='spin' /></span>}
            </div>

            {result && !result.online && (
              <div className='rp-note w'>
                {result.error ? `${tr(lang, 'offlineHint')} · ${result.error.slice(0, 80)}` : tr(lang, 'offlineHint')}
              </div>
            )}

            {/* 本地词库命中 */}
            {result && result.local.length > 0 && (
              <div className='rp-group'>
                <div className='rp-group-h'><IconTag size={13} /> {tr(lang, 'fromLocal')}</div>
                {result.local.map((e) => (
                  <div key={e.term} className='rp-card'>
                    <div className='rp-card-h'>
                      <b>{e.term}</b>
                      {!!e.alias?.length && <span className='rp-alias'>{e.alias.join(' / ')}</span>}
                    </div>
                    <p>{e.definition}</p>
                    <div className='rp-acts'>
                      <button className='rp-act' onClick={() => saveAsNote({ query: e.term, title: e.term, content: e.definition, source: 'local' })}>
                        <IconSave size={13} /> {tr(lang, 'saveNote')}
                      </button>
                      <button className='rp-act' onClick={async () => { if (await copy(e.definition)) say(tr(lang, 'copied')) }}>
                        <IconCopy size={13} /> {tr(lang, 'copy')}
                      </button>
                      <span className='rp-src'>{e.source || '本地词库'}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* 联网结果 */}
            {result && result.web.length > 0 && (
              <div className='rp-group'>
                <div className='rp-group-h'><IconGlobe size={13} /> {tr(lang, 'fromWeb')}</div>
                {result.web.map((r) => (
                  <div key={r.url + r.title} className='rp-card'>
                    <div className='rp-card-h'>
                      {r.thumbnail && <img className='rp-thumb' src={r.thumbnail} alt='' />}
                      <b>{r.title}</b>
                    </div>
                    <p>{r.extract}</p>
                    {trans[r.extract] && <p className='rp-trans'>{trans[r.extract]}</p>}
                    <div className='rp-acts'>
                      <button className='rp-act' onClick={() => saveAsNote({ query: result.query, title: r.title, content: r.extract, source: 'web', url: r.url })}>
                        <IconSave size={13} /> {tr(lang, 'saveNote')}
                      </button>
                      <button className='rp-act'
                        onClick={() => void onTranslate(r.extract, lang === 'en' ? 'zh' : 'en')}>
                        <IconTranslate size={13} /> {lang === 'en' ? tr(lang, 'toZh') : tr(lang, 'toEn')}
                      </button>
                      <button className='rp-act' onClick={() => (window as any).electronAPI?.openExternal?.(r.url)}>
                        <IconExternal size={13} /> {tr(lang, 'openLink')}
                      </button>
                      <span className='rp-src'>{r.source}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {result && !busy && result.local.length === 0 && result.web.length === 0 && (
              <div className='empty'>{tr(lang, 'noResult')}</div>
            )}
            {!result && <div className='empty'>{tr(lang, 'lookupEmpty')}</div>}
          </div>
        )}

        {tab === 'notes' && (
          <div className='drawer-body'>
            {notes.length > 0 && (
              <div className='rp-row'>
                <button className='rp-act' onClick={clearNotes}><IconTrash size={13} /> {tr(lang, 'clearAll')}</button>
              </div>
            )}
            {notes.map((n) => (
              <div key={n.id} className='rp-card'>
                <div className='rp-card-h'>
                  <b>{n.title || n.query}</b>
                  <span className={`rp-badge src ${n.source}`}>{tr(lang, n.source === 'web' ? 'fromWeb' : n.source === 'local' ? 'fromLocal' : 'srcManual')}</span>
                </div>
                <p>{n.content}</p>
                <div className='rp-acts'>
                  <button className='rp-act' onClick={async () => { if (await copy(`${n.title || n.query}\n${n.content}`)) say(tr(lang, 'copied')) }}>
                    <IconCopy size={13} /> {tr(lang, 'copy')}
                  </button>
                  {n.url && (
                    <button className='rp-act' onClick={() => (window as any).electronAPI?.openExternal?.(n.url!)}>
                      <IconExternal size={13} /> {tr(lang, 'openLink')}
                    </button>
                  )}
                  <button className='rp-act danger' onClick={() => removeNote(n.id)}>
                    <IconTrash size={13} /> {tr(lang, 'delete')}
                  </button>
                </div>
              </div>
            ))}
            {notes.length === 0 && <div className='empty'>{tr(lang, 'noNotes')}</div>}
          </div>
        )}

        {tab === 'knowledge' && (
          <div className='drawer-body'>
            <div className='rp-search'>
              <IconSearch size={15} />
              <input value={kw} placeholder={tr(lang, 'searchTerm')} onChange={(e) => setKw(e.target.value)} />
            </div>
            <div className='rp-row'>
              <button className='rp-act' onClick={importKnowledgeFile}><IconUpload size={13} /> {tr(lang, 'importJson')}</button>
              <button className='rp-act' onClick={exportKnowledge}><IconSave size={13} /> {tr(lang, 'exportJson')}</button>
              {knowledge.some((k) => !BUILTIN_KNOWLEDGE.some((b) => b.term === k.term)) && (
                <button className='rp-act' onClick={() => { clearKnowledge(); importKnowledge(BUILTIN_KNOWLEDGE); say(tr(lang, 'resetDone')) }}>
                  {tr(lang, 'resetBuiltin')}
                </button>
              )}
            </div>

            {/* 新增词条 */}
            <div className='rp-add'>
              <input className='rp-in' value={newTerm} placeholder={tr(lang, 'termPh')} onChange={(e) => setNewTerm(e.target.value)} />
              <textarea className='rp-ta' value={newDef} placeholder={tr(lang, 'defPh')} onChange={(e) => setNewDef(e.target.value)} rows={2} />
              <button className='btn accent' style={{ height: 30 }}
                onClick={() => { saveAsTerm(newTerm, newDef); setNewTerm(''); setNewDef('') }}>
                <IconPlus size={13} /> {tr(lang, 'addTerm')}
              </button>
            </div>

            {filteredKnowledge.map((e) => (
              <div key={e.term} className='rp-card'>
                <div className='rp-card-h'>
                  <b>{e.term}</b>
                  {!!e.alias?.length && <span className='rp-alias'>{e.alias.join(' / ')}</span>}
                </div>
                <p>{e.definition}</p>
                <div className='rp-acts'>
                  <button className='rp-act' onClick={() => { setNewTerm(e.term); setNewDef(e.definition) }}>
                    <IconPlus size={13} /> {tr(lang, 'editAsNew')}
                  </button>
                  <span className='rp-src'>{e.source || '本地词库'}</span>
                </div>
              </div>
            ))}
            {filteredKnowledge.length === 0 && <div className='empty'>{tr(lang, 'noTerm')}</div>}
          </div>
        )}

        {flash && <div className='rp-flash'>{flash}</div>}
      </motion.div>
    </>
  )
}
