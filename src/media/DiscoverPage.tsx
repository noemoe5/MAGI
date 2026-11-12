import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { useStore } from '../store/useStore'
import { useSourceStore } from '../sources/useSourceStore'
import { searchAggregate } from '../sources'
import { hitToTrack } from '../sources/builtin/music'
import { importBook } from '../lib/import'
import type { AggregateResult, SourceDetail, SourceHit, SourceKind } from '../sources/types'
import {
  IconSearch, IconClose, IconCompass, IconDownload, IconRefresh, IconExternal, IconPlay,
  IconPlus, IconChevron, IconSettings, IconList
} from '../components/icons'
import { tr } from '../i18n'
import { addRemoteTrackAndPlay } from '../lib/remoteTrack'
import './discover.css'

const RECENT_KEY = 'magi.discover.recent.v1'
const TAB_KEY = 'magi.discover.tab.v1'

const KIND_COLOR: Record<SourceKind, string> = {
  anime: '#f97316',
  book: '#0ea5e9',
  music: '#14b8a6'
}

type Tab = 'all' | SourceKind

const SUGGESTIONS = ['进击的巨人', '三体', '雪国', 'jazz', 'City Pop', 'Pride and Prejudice']

function loadRecent(): string[] {
  try {
    const raw = localStorage.getItem(RECENT_KEY)
    return raw ? (JSON.parse(raw) as string[]).slice(0, 8) : []
  } catch {
    return []
  }
}

function loadTab(): Tab {
  const t = localStorage.getItem(TAB_KEY)
  return t === 'anime' || t === 'book' || t === 'music' || t === 'all' ? t : 'all'
}

export default function DiscoverPage() {
  const lang = useStore((s) => s.settings.lang)
  const activeProviders = useSourceStore((s) => s.activeProviders)
  const allProviders = useSourceStore((s) => s.allProviders)
  const enabled = useSourceStore((s) => s.enabled)
  const customs = useSourceStore((s) => s.customs)
  const setManagerOpen = useSourceStore((s) => s.setManagerOpen)

  const [query, setQuery] = useState('')
  const [tab, setTab] = useState<Tab>(loadTab)
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<AggregateResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [selected, setSelected] = useState<SourceHit | null>(null)
  const [detail, setDetail] = useState<SourceDetail | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [recent, setRecent] = useState<string[]>(loadRecent)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [toast, setToast] = useState<string | null>(null)
  const reqRef = useRef(0)
  const inputRef = useRef<HTMLInputElement>(null)

  const kinds: SourceKind[] = tab === 'all' ? ['anime', 'book', 'music'] : [tab]

  const pushRecent = useCallback((q: string) => {
    const next = [q, ...recent.filter((r) => r !== q)].slice(0, 8)
    setRecent(next)
    try { localStorage.setItem(RECENT_KEY, JSON.stringify(next)) } catch { /* ignore */ }
  }, [recent])

  const run = useCallback(async (q: string, k: SourceKind[]) => {
    const text = q.trim()
    if (!text) return
    const req = ++reqRef.current
    setLoading(true)
    setError(null)
    try {
      const res = await searchAggregate(activeProviders(), k, text)
      if (req !== reqRef.current) return
      setResult(res)
      if (!res.hits.length) {
        const failed = res.runs.filter((r) => !r.ok)
        setError(failed.length ? `全部源都失败了：${failed.map((f) => `${f.sourceName}(${f.error})`).join('；')}` : null)
      }
    } catch (e: any) {
      if (req !== reqRef.current) return
      setError(String(e?.message || e))
    } finally {
      if (req === reqRef.current) setLoading(false)
    }
  }, [activeProviders])

  // 切换通道时用同一个关键词重查，并记住上次选的通道
  useEffect(() => {
    try { localStorage.setItem(TAB_KEY, tab) } catch { /* ignore */ }
    if (query.trim() && result) run(query, kinds)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab])

  // ESC 逐层关闭：先关详情抽屉，再清空搜索
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      if (selected) {
        setSelected(null)
        setDetail(null)
      } else if (query) {
        setQuery('')
        setResult(null)
        setError(null)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [selected, query])

  // 只重跑失败的源，把成功的结果并回列表（网络抖动时不用整轮重来）
  const retryOnlyFailed = useCallback(async () => {
    if (!result) return
    const failed = result.runs.filter((r) => !r.ok).map((r) => r.sourceId)
    if (!failed.length) return
    setLoading(true)
    try {
      const res = await searchAggregate(activeProviders().filter((p) => failed.includes(p.id)), kinds, query)
      setResult((prev) => {
        if (!prev) return res
        const merged = [...prev.hits]
        for (const h of res.hits) if (!merged.some((x) => x.id === h.id)) merged.push(h)
        return { hits: merged, runs: [...prev.runs.filter((r) => !failed.includes(r.sourceId)), ...res.runs] }
      })
      setError(null)
    } finally {
      setLoading(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [result, query, tab])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        inputRef.current?.focus()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(null), 2200)
    return () => clearTimeout(t)
  }, [toast])

  const submit = (q: string) => {
    setQuery(q)
    pushRecent(q)
    setResult(null)
    run(q, kinds)
  }

  const openDetail = async (hit: SourceHit) => {
    setSelected(hit)
    setDetail(null)
    const provider = allProviders().find((p) => p.id === hit.sourceId)
    if (!provider?.detail) return
    setDetailLoading(true)
    try {
      const d = await provider.detail(hit)
      setDetail(d)
    } catch {
      setDetail(null)
    } finally {
      setDetailLoading(false)
    }
  }

  const playMusic = async (hit: SourceHit) => {
    const track = hitToTrack(hit)
    if (!track) {
      setToast('该条目没有可播放直链')
      return
    }
    setBusyId(hit.id)
    try {
      addRemoteTrackAndPlay(track)
      setToast('已加入队列并开始试听')
    } finally {
      setBusyId(null)
    }
  }

  const downloadBook = async (hit: SourceHit) => {
    if (!hit.downloadUrl) {
      setToast('该条目没有可下载文件')
      return
    }
    const api = (window as any).electronAPI
    if (!api?.sourceDownload) {
      setToast('下载通道不可用（需在桌面端运行）')
      return
    }
    setBusyId(hit.id)
    try {
      const res = await api.sourceDownload(hit.downloadUrl, hit.downloadName || `${hit.title}.epub`)
      if (res?.error) {
        setToast(`下载失败：${res.error}`)
        return
      }
      const info = await api.openBook(res.path)
      const book = await importBook(info, res.path)
      useStore.getState().addBooks([{ ...book, name: hit.title || book.name }])
      setToast(`已加入书架：${hit.title}`)
    } catch (e: any) {
      setToast(`入库失败：${String(e?.message || e)}`)
    } finally {
      setBusyId(null)
    }
  }

  const openExternal = (url?: string) => {
    if (!url) return
    const api = (window as any).electronAPI
    if (api?.openExternal) api.openExternal(url)
    else window.open(url, '_blank')
  }

  const visibleProviders = useMemo(() => allProviders(), [allProviders, enabled, customs])
  const activeCount = visibleProviders.filter((p) => (enabled[p.id] ?? p.defaultEnabled ?? true) && p.kinds.some((k) => kinds.includes(k))).length

  return (
    <div className='discover'>
      <div className='discover-head'>
        <div className='discover-hero'>
          <div className='hero-ico'><IconCompass size={22} /></div>
          <div className='hero-txt'>
            <h2>{tr(lang, 'discoverTitle')}</h2>
            <p>{tr(lang, 'discoverSub')}</p>
          </div>
          <button className='btn src-manage' onClick={() => setManagerOpen(true)}>
            <IconSettings size={15} />
            <span>源管理</span>
            <em>{activeCount}</em>
          </button>
        </div>

        <div className='discover-search'>
          <IconSearch size={17} />
          <input
            ref={inputRef}
            value={query}
            placeholder={tr(lang, 'discoverPlaceholder')}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') submit(query) }}
          />
          {query && (
            <button className='clr' onClick={() => { setQuery(''); setResult(null); setError(null) }} title='清空'>
              <IconClose size={14} />
            </button>
          )}
          <kbd>Ctrl K</kbd>
          <button className='go' onClick={() => submit(query)} disabled={!query.trim() || loading}>
            {loading ? <span className='spin' /> : tr(lang, 'discoverGo')}
          </button>
        </div>

        <div className='discover-tabs'>
          {(['all', 'anime', 'book', 'music'] as Tab[]).map((t) => (
            <button key={t} className={`dtab ${tab === t ? 'on' : ''}`} onClick={() => setTab(t)}>
              {tab === t && <motion.span layoutId='dtab-bg' className='dtab-bg' transition={{ type: 'spring', stiffness: 420, damping: 34 }} />}
              <span className='dtab-label'>{t === 'all' ? tr(lang, 'allKinds') : t === 'anime' ? tr(lang, 'kindAnime') : t === 'book' ? tr(lang, 'kindBook') : tr(lang, 'kindMusic')}</span>
            </button>
          ))}
        </div>
      </div>

      <div className='discover-body'>
        {!result && !loading && (
          <div className='discover-idle'>
            <div className='idle-block'>
              <h4>{tr(lang, 'discoverTry')}</h4>
              <div className='chips'>
                {SUGGESTIONS.map((s) => (
                  <button key={s} className='chip' onClick={() => submit(s)}>{s}</button>
                ))}
              </div>
            </div>
            {!!recent.length && (
              <div className='idle-block'>
                <h4>{tr(lang, 'discoverRecent')}</h4>
                <div className='chips'>
                  {recent.map((s) => (
                    <button key={s} className='chip ghost' onClick={() => submit(s)}>{s}</button>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {loading && (
          <div className='dgrid'>
            {Array.from({ length: 12 }).map((_, i) => (
              <div key={i} className='dcard skeleton' style={{ animationDelay: `${i * 40}ms` }}>
                <div className='sk-cover' />
                <div className='sk-line' />
                <div className='sk-line short' />
              </div>
            ))}
          </div>
        )}

        {!loading && result && (
          <>
            {!!result.runs.length && (
              <div className='runs'>
                {result.runs.map((r) => (
                  <span key={r.sourceId} className={`run ${r.ok ? 'ok' : 'bad'}`} title={r.error || `${r.count} 条 / ${r.ms}ms`}>
                    <i />
                    {r.sourceName}
                    <em>{r.ok ? `${r.count} · ${r.ms}ms` : r.error}</em>
                  </span>
                ))}
                <button className='run retry' onClick={() => run(query, kinds)} title='重新搜索'>
                  <IconRefresh size={13} />
                </button>
                {result.runs.some((r) => !r.ok) && (
                  <button className='run retry-failed' onClick={retryOnlyFailed} disabled={loading}>
                    {tr(lang, 'retryFailed')}
                  </button>
                )}
              </div>
            )}

            {error && <div className='discover-error'>{error}</div>}

            {!result.hits.length && !error && (
              <div className='empty'>{tr(lang, 'discoverEmpty')}</div>
            )}

            <motion.div className='dgrid' initial='hidden' animate='show'
              variants={{ show: { transition: { staggerChildren: 0.02 } } }}>
              {result.hits.map((hit) => (
                <motion.div key={hit.id} className='dcard' variants={{ hidden: { opacity: 0, y: 12 }, show: { opacity: 1, y: 0 } }}
                  onClick={() => openDetail(hit)}>
                  <div className='dcard-cover'>
                    {hit.cover
                      ? <img src={hit.cover} alt='' loading='lazy' onError={(e) => { (e.currentTarget as HTMLImageElement).style.opacity = '0' }} />
                      : <div className='no-cover'>{hit.title.slice(0, 1)}</div>}
                    <span className='kind-dot' style={{ background: KIND_COLOR[hit.kind] }} />
                    {hit.badge && <span className='badge'>{hit.badge}</span>}
                  </div>
                  <div className='dcard-meta'>
                    <b title={hit.title}>{hit.title}</b>
                    <em>{hit.subtitle || hit.sourceName}</em>
                  </div>
                  <div className='dcard-actions' onClick={(e) => e.stopPropagation()}>
                    {hit.kind === 'music' && hit.playUrl && (
                      <button className='mini accent' disabled={busyId === hit.id} onClick={() => playMusic(hit)}>
                        <IconPlay size={12} /> 试听
                      </button>
                    )}
                    {hit.kind === 'book' && hit.downloadUrl && (
                      <button className='mini' disabled={busyId === hit.id} onClick={() => downloadBook(hit)}>
                        <IconDownload size={12} /> 入库
                      </button>
                    )}
                    {hit.openUrl && (
                      <button className='mini ghost' onClick={() => openExternal(hit.openUrl)} title='在浏览器打开'>
                        <IconExternal size={12} />
                      </button>
                    )}
                  </div>
                </motion.div>
              ))}
            </motion.div>
          </>
        )}
      </div>

      {/* 详情抽屉 */}
      <AnimatePresence>
        {selected && (
          <>
            <motion.div className='dmask' initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              onClick={() => { setSelected(null); setDetail(null) }} />
            <motion.aside className='ddrawer' initial={{ x: 380, opacity: 0.6 }} animate={{ x: 0, opacity: 1 }}
              exit={{ x: 380, opacity: 0 }} transition={{ type: 'spring', stiffness: 320, damping: 34 }}>
              <div className='dd-head'>
                <span className='dd-kind' style={{ background: KIND_COLOR[selected.kind] }}>
                  {selected.kind === 'anime' ? tr(lang, 'kindAnime') : selected.kind === 'book' ? tr(lang, 'kindBook') : tr(lang, 'kindMusic')}
                </span>
                <button className='icon-btn' onClick={() => { setSelected(null); setDetail(null) }}><IconClose size={16} /></button>
              </div>
              <div className='dd-hero'>
                {selected.cover && <img src={selected.cover} alt='' />}
                <div>
                  <h3>{selected.title}</h3>
                  <p>{selected.subtitle}</p>
                  <span className='dd-src'>{selected.sourceName}</span>
                </div>
              </div>
              <div className='dd-actions'>
                {selected.kind === 'music' && selected.playUrl && (
                  <button className='btn accent' onClick={() => playMusic(selected)}><IconPlay size={13} /> 加入队列试听</button>
                )}
                {selected.kind === 'book' && selected.downloadUrl && (
                  <button className='btn accent' onClick={() => downloadBook(selected)}><IconDownload size={13} /> 下载并入库</button>
                )}
                {selected.openUrl && (
                  <button className='btn' onClick={() => openExternal(selected.openUrl)}><IconExternal size={13} /> 打开来源页</button>
                )}
              </div>

              {detailLoading && <div className='dd-loading'><span className='spin' /></div>}

              {!!detail?.facts?.length && (
                <div className='dd-facts'>
                  {detail.facts.map((f) => (
                    <div key={f.label}><em>{f.label}</em><span>{f.value}</span></div>
                  ))}
                </div>
              )}

              {(detail?.description || selected.description) && (
                <div className='dd-desc'>
                  <h4><IconList size={14} /> 简介</h4>
                  <p>{detail?.description || selected.description}</p>
                </div>
              )}

              {!!detail?.leaves?.length && (
                <div className='dd-leaves'>
                  <h4>分集目录 <em>{detail.leaves.length}</em></h4>
                  <div className='leaf-list'>
                    {detail.leaves.map((l) => (
                      <button key={l.id} className='leaf' onClick={() => openExternal(l.openUrl || selected.openUrl)}>
                        <span className='leaf-idx'>{l.index ?? ''}</span>
                        <span className='leaf-title'>{l.title}</span>
                        {l.subtitle && <em>{l.subtitle}</em>}
                        <IconChevron size={13} />
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </motion.aside>
          </>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {toast && (
          <motion.div className='dtoast' initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 10 }}>
            {toast}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
