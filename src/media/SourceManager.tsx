import { useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { useStore } from '../store/useStore'
import { BUILTIN_IDS, useSourceStore } from '../sources/useSourceStore'
import { parseCustomBundle, serializeCustomSpecs } from '../sources/custom'
import type { CustomSourceSpec } from '../sources/types'
import { IconClose, IconPlus, IconTrash, IconRefresh, IconLayers, IconFolder, IconNote, IconUpload, IconDownload } from '../components/icons'
import { tr } from '../i18n'
import './discover.css'

interface TestState { ok: boolean; text: string; ms: number }
interface FileItem { name: string; text?: string; error?: string }
interface Feedback { ok: number; errors: string[] }

const MAX_FILE = 2 * 1024 * 1024
const DAY = () => new Date().toISOString().slice(0, 10)

export default function SourceManager() {
  const lang = useStore((s) => s.settings.lang)
  const open = useSourceStore((s) => s.managerOpen)
  const setOpen = useSourceStore((s) => s.setManagerOpen)
  const all = useSourceStore((s) => s.allProviders)
  const enabled = useSourceStore((s) => s.enabled)
  const customs = useSourceStore((s) => s.customs)
  const toggle = useSourceStore((s) => s.toggle)
  const addCustoms = useSourceStore((s) => s.addCustoms)
  const removeCustom = useSourceStore((s) => s.removeCustom)

  const [mode, setMode] = useState<'file' | 'json'>('file')
  const [raw, setRaw] = useState('')
  const [busy, setBusy] = useState(false)
  const [dragging, setDragging] = useState(false)
  const [fb, setFb] = useState<Feedback | null>(null)
  const [testing, setTesting] = useState<string | null>(null)
  const [test, setTest] = useState<Record<string, TestState>>({})
  const inputRef = useRef<HTMLInputElement>(null)

  if (!open) return null

  const providers = all()

  /** 统一入口：把若干文件（或粘贴文本）解析成源并写入 store，逐条记录失败原因 */
  const ingest = (items: FileItem[]) => {
    const byId = new Map<string, CustomSourceSpec>()
    const errors: string[] = []
    const multi = items.length > 1
    for (const it of items) {
      if (it.error) {
        errors.push(`${it.name}：${it.error}`)
        continue
      }
      try {
        const rep = parseCustomBundle(it.text ?? '')
        rep.specs.forEach((s) => byId.set(s.id, s))
        rep.errors.forEach((e) => errors.push(multi ? `${it.name} ${e}` : e))
      } catch (e: any) {
        errors.push(multi ? `${it.name}：${String(e?.message || e)}` : String(e?.message || e))
      }
    }
    const list = [...byId.values()]
    if (!list.length) {
      setFb({ ok: 0, errors: errors.length ? errors : [tr(lang, 'sourceInvalid')] })
      return
    }
    const n = addCustoms(list)
    setFb({ ok: n, errors })
    if (mode === 'json') setRaw('')
  }

  const readBrowserFiles = async (files: File[]) => {
    const items: FileItem[] = []
    for (const f of files) {
      if (f.size > MAX_FILE) items.push({ name: f.name, error: '文件超过 2MB' })
      else items.push({ name: f.name, text: await f.text() })
    }
    ingest(items)
  }

  /** 文件导入：桌面端走原生多选对话框，浏览器预览走 <input type=file> */
  const pickFiles = async () => {
    setFb(null)
    const api = (window as any).electronAPI
    if (!api?.importSourceFiles) {
      inputRef.current?.click()
      return
    }
    setBusy(true)
    try {
      const items: FileItem[] = (await api.importSourceFiles()) ?? []
      if (items.length) ingest(items)
    } catch (e: any) {
      setFb({ ok: 0, errors: [String(e?.message || e)] })
    } finally {
      setBusy(false)
    }
  }

  const onInputChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? [])
    e.target.value = ''
    if (!files.length) return
    setFb(null)
    setBusy(true)
    try {
      await readBrowserFiles(files)
    } finally {
      setBusy(false)
    }
  }

  const onDrop = async (e: React.DragEvent) => {
    e.preventDefault()
    setDragging(false)
    const files = Array.from(e.dataTransfer.files ?? [])
    if (!files.length) return
    setFb(null)
    setBusy(true)
    try {
      await readBrowserFiles(files)
    } finally {
      setBusy(false)
    }
  }

  const doImportJson = () => {
    setFb(null)
    ingest([{ name: '粘贴内容', text: raw }])
  }

  /** 导出全部自定义源（可再导入回来，或分享给别人） */
  const doExport = async () => {
    if (!customs.length) return
    const text = serializeCustomSpecs(customs)
    const api = (window as any).electronAPI
    if (api?.saveJson) {
      await api.saveJson(`magi-sources-${DAY()}.json`, text)
      return
    }
    const blob = new Blob([text], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `magi-sources-${DAY()}.json`
    a.click()
    setTimeout(() => URL.revokeObjectURL(url), 1500)
  }

  const runTest = async (id: string) => {
    const p = providers.find((x) => x.id === id)
    if (!p) return
    setTesting(id)
    const t0 = performance.now()
    try {
      const hits = await p.search({ query: p.kinds[0] === 'music' ? 'jazz' : p.kinds[0] === 'book' ? 'pride' : 'naruto' })
      setTest((s) => ({ ...s, [id]: { ok: true, text: `${hits.length} 条`, ms: Math.round(performance.now() - t0) } }))
    } catch (e: any) {
      setTest((s) => ({ ...s, [id]: { ok: false, text: String(e?.message || e), ms: Math.round(performance.now() - t0) } }))
    } finally {
      setTesting(null)
    }
  }

  return (
    <motion.div className='sm-mask' initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      onClick={() => setOpen(false)}>
      <motion.div className='sm-panel' initial={{ y: 24, opacity: 0, scale: 0.98 }} animate={{ y: 0, opacity: 1, scale: 1 }}
        exit={{ y: 16, opacity: 0 }} transition={{ type: 'spring', stiffness: 380, damping: 32 }}
        onClick={(e) => e.stopPropagation()}>
        <header className='sm-head'>
          <div className='sm-title'>
            <IconLayers size={18} />
            <div>
              <h3>{tr(lang, 'sourceManager')}</h3>
              <p>{tr(lang, 'sourceManagerSub')}</p>
            </div>
          </div>
          <button className='icon-btn' onClick={() => setOpen(false)}><IconClose size={16} /></button>
        </header>

        <div className='sm-list'>
          {providers.map((p) => {
            const on = enabled[p.id] ?? p.defaultEnabled ?? true
            const t = test[p.id]
            return (
              <div key={p.id} className={`sm-row ${on ? '' : 'off'}`}>
                <div className='sm-row-main'>
                  <div className='sm-row-title'>
                    <b>{p.name}</b>
                    {BUILTIN_IDS.has(p.id)
                      ? <span className='tag builtin'>内置</span>
                      : <span className='tag custom'>自定义</span>}
                    {p.kinds.map((k) => (
                      <span key={k} className={`tag kind k-${k}`}>
                        {k === 'anime' ? tr(lang, 'kindAnime') : k === 'book' ? tr(lang, 'kindBook') : tr(lang, 'kindMusic')}
                      </span>
                    ))}
                  </div>
                  <p className='sm-note'>{p.note}</p>
                  <AnimatePresence>
                    {t && (
                      <motion.span className={`sm-test ${t.ok ? 'ok' : 'bad'}`}
                        initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
                        {t.ok ? `✓ ${t.text} · ${t.ms}ms` : `✕ ${t.text}`}
                      </motion.span>
                    )}
                  </AnimatePresence>
                </div>
                <div className='sm-row-actions'>
                  <button className='mini ghost' onClick={() => runTest(p.id)} disabled={testing === p.id} title={tr(lang, 'sourceTest')}>
                    {testing === p.id ? <span className='spin' /> : <IconRefresh size={13} />}
                  </button>
                  {!BUILTIN_IDS.has(p.id) && (
                    <button className='mini ghost danger' onClick={() => removeCustom(p.id)} title={tr(lang, 'sourceRemove')}>
                      <IconTrash size={13} />
                    </button>
                  )}
                  <button className={`switch ${on ? 'on' : ''}`} onClick={() => toggle(p.id)} aria-label={tr(lang, 'sourceEnabled')}>
                    <i />
                  </button>
                </div>
              </div>
            )
          })}
        </div>

        <div className='sm-import'>
          <div className='sm-import-head'>
            <h4><IconPlus size={14} /> {tr(lang, 'sourceAdd')}</h4>
            <div className='sm-seg'>
              <button className={mode === 'file' ? 'on' : ''} onClick={() => { setMode('file'); setFb(null) }}>
                <IconFolder size={12} /> {tr(lang, 'sourceImportFile')}
              </button>
              <button className={mode === 'json' ? 'on' : ''} onClick={() => { setMode('json'); setFb(null) }}>
                <IconNote size={12} /> {tr(lang, 'sourceImportJson')}
              </button>
            </div>
          </div>

          {mode === 'file' ? (
            <div className={`sm-drop ${dragging ? 'over' : ''} ${busy ? 'busy' : ''}`}
              role='button'
              onClick={pickFiles}
              onDragOver={(e) => { e.preventDefault(); setDragging(true) }}
              onDragLeave={() => setDragging(false)}
              onDrop={onDrop}>
              <span className='sm-drop-icon'>{busy ? <span className='spin' /> : <IconUpload size={19} />}</span>
              <b>{tr(lang, 'sourceDropTitle')}</b>
              <span className='sm-drop-sub'>{tr(lang, 'sourceDropSub')}</span>
              <input ref={inputRef} type='file' accept='.json,.txt,application/json,text/plain' multiple hidden onChange={onInputChange} />
            </div>
          ) : (
            <textarea
              value={raw}
              spellCheck={false}
              placeholder={'{\n  "id": "my-source",\n  "name": "我的源",\n  "kinds": ["anime"],\n  "search": {\n    "url": "https://api.example.com/search?q={query}",\n    "list": "data.items",\n    "fields": { "id": "id", "title": "name", "cover": "pic" }\n  }\n}'}
              onChange={(e) => setRaw(e.target.value)}
            />
          )}

          <div className='sm-import-foot'>
            <span className='hint'>{tr(lang, 'sourceHint')}</span>
            <button className='btn ghost sm-sm-btn' disabled={!customs.length} onClick={doExport}
              title={customs.length ? tr(lang, 'sourceExport') : tr(lang, 'sourceExportEmpty')}>
              <IconDownload size={12} /> {tr(lang, 'sourceExport')}
            </button>
            {mode === 'json' && (
              <button className='btn accent sm-sm-btn' disabled={!raw.trim() || busy} onClick={doImportJson}>
                {tr(lang, 'sourceImport')}
              </button>
            )}
          </div>

          <AnimatePresence>
            {fb && (
              <motion.div className='sm-feedback' initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
                {fb.ok > 0 && <div className='ok'>✓ {tr(lang, 'sourceImported')} {fb.ok} {tr(lang, 'sourceUnit')}</div>}
                {fb.errors.slice(0, 6).map((e, i) => <div key={i} className='bad'>{e}</div>)}
                {fb.errors.length > 6 && <div className='bad'>… {tr(lang, 'sourceMore')} {fb.errors.length - 6}</div>}
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </motion.div>
    </motion.div>
  )
}
