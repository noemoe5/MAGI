import { useEffect, useRef, useState, useCallback } from 'react'
import { motion, AnimatePresence, useAnimationControls } from 'framer-motion'
import ePub from 'epubjs'
import { Book } from '../types'
import { useStore } from '../store/useStore'
import { THEMES } from '../theme/themes'
import { tr } from '../i18n'
import { speak } from '../lib/tts'
import { uuid } from '../lib/util'
import TocDrawer from './TocDrawer'
import BookmarksDrawer from './BookmarksDrawer'
import { IconBack, IconToc, IconBookmark, IconSpeaker, IconPause, IconPrev, IconNext, IconSettings, IconPlus } from './icons'

interface TocNode { label: string; href: string; level: number }
interface GoResult { advanced: boolean; atEnd: boolean }

const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

// 按中英文句末标点 + 换行切句（保留标点）；单句超长则按字符硬切，
// 避免把整段/整章当一个超长文本发给 GPT-SoVITS 触发 400。
function splitSentences(text: string): string[] {
  const raw = text
    .split(/(?<=[。！？!?；;…\n])/)
    .map((s) => s.trim())
    .filter(Boolean)
  const segs = raw.length ? raw : [text.trim()].filter(Boolean)
  const MAX = 80
  const capped: string[] = []
  for (const s of segs) {
    if (s.length <= MAX) { capped.push(s); continue }
    for (let i = 0; i < s.length; i += MAX) capped.push(s.slice(i, i + MAX))
  }
  return capped.filter(Boolean)
}

export default function Reader({ book, onClose }: { book: Book; onClose: () => void }) {
  const settings = useStore((s) => s.settings)
  const setProgress = useStore((s) => s.setProgress)
  const tocOpen = useStore((s) => s.tocOpen)
  const bookmarksOpen = useStore((s) => s.bookmarksOpen)
  const addBookmark = useStore((s) => s.addBookmark)
  const addHighlight = useStore((s) => s.addHighlight)
  const lang = settings.lang

  const viewerRef = useRef<HTMLDivElement>(null)
  const renditionRef = useRef<any>(null)
  const bookRef = useRef<any>(null)
  const txtRef = useRef<HTMLDivElement>(null)
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const controls = useAnimationControls()
  const idleRef = useRef<any>(null)
  const animRef = useRef(false)
  const locRef = useRef<any>(null)          // 当前 CFI 位置（relocated 时更新）
  const stopReadRef = useRef(false)         // 停止朗读信号
  const readingRef = useRef(false)          // 朗读模式是否进行中
  const resolveRef = useRef<null | (() => void)>(null)  // 用于打断当前音频等待
  const roRef = useRef<any>(null)                        // ResizeObserver，容器尺寸变化重排分页
  const modeRef = useRef<'vertical' | 'horizontal'>(settings.readerMode) // 当前翻页方向（go/readLoop 读取最新值）

  const [toc, setToc] = useState<TocNode[]>([])
  const [page, setPage] = useState(0)
  const [barShow, setBarShow] = useState(true)
  const [reading, setReading] = useState(false) // 朗读模式（逐句+自动翻页）
  const [ttsError, setTtsError] = useState('')
  const [loading, setLoading] = useState(true)
  const [txt, setTxt] = useState('')
  // 诊断面板（按 D 键开关；默认开，便于定位「空白/翻不动」根因）
  const [showDebug, setShowDebug] = useState(true)
  const [debug, setDebug] = useState<{ size: string; idx: string; href: string; pct: string; err: string; txtLen: string; scrollH: string }>(
    { size: '-', idx: '-', href: '-', pct: '-', err: '', txtLen: '-', scrollH: '-' }
  )
  const dbg = (patch: Partial<typeof debug>) => setDebug((d) => ({ ...d, ...patch }))

  // 加载书籍
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const api = (window as any).electronAPI
      if (!api) { setLoading(false); return }
      // 主进程流式解压（大文件也安全），epub 返回 nrbook:// 协议基址走目录加载，不再整包解压
      const info: any = await api.openBook(book.path)
      if (!info || info.error) { setLoading(false); dbg({ err: 'open-book: ' + (info?.error || 'unknown') }); return }

      if (book.kind === 'txt') {
        setTxt(info.text || '')
        setLoading(false)
        return
      }

      const epub = ePub(info.baseUrl)
      bookRef.current = epub
      await epub.ready
      // 生成 locations 以得到准确阅读百分比（否则 loc.start.percentage 为 undefined → 进度恒为 0）
      try { await epub.locations.generate(1000) } catch { /* 部分书生成失败则走 CFI 兜底 */ }

      const nav = await epub.loaded.navigation
      const flat: TocNode[] = []
      const walk = (items: any[], lvl: number) => {
        for (const it of items) {
          flat.push({ label: it.label, href: it.href, level: lvl })
          if (it.subitems) walk(it.subitems, lvl + 1)
        }
      }
      walk(nav.toc, 1)
      if (!cancelled) setToc(flat)

      const isH = settings.readerMode === 'horizontal'
      const rendition = epub.renderTo(viewerRef.current!, {
        width: '100%', height: '100%', spread: 'none',
        flow: isH ? 'paginated' : 'scrolled', allowScriptedContent: false,
        // 竖向滚动模式：overflow:auto 让 EPUB.js 内部 .epub-container 成为滚动容器（continuous 连续滚动，自动跨章节）；
        // 横向翻页模式：交给 EPUB.js paginated 管理器分页，不可设 overflow:auto（否则破坏分栏数学）
        ...(isH ? {} : { overflow: 'auto' })
      })
      renditionRef.current = rendition
      applyReaderTheme(rendition, settings, book.id)

      rendition.on('relocated', (loc: any) => {
        locRef.current = loc
        let pct = loc?.start?.percentage
        if ((pct == null) && loc?.start?.cfi) {
          const lp = bookRef.current?.locations?.percentageFromCfi?.(loc.start.cfi)
          pct = lp != null ? lp : 0
        }
        const p = Math.max(0, Math.min(100, Math.round((pct || 0) * 100)))
        setPage(p)
        setProgress(book.id, p, loc?.start?.cfi)
      // 诊断信息
      let idx = '-'
      try {
        const href = loc?.start?.href
        const items = bookRef.current?.spine?.spineItems || []
        const i = items.findIndex((it: any) => it.href === href)
        idx = i >= 0 ? String(i) : (String(href || '').split('/').pop() || '-')
      } catch { /* */ }
      dbg({ pct: p + '%', href: String(loc?.start?.href || '-'), idx,
            size: (() => { const r = viewerRef.current?.getBoundingClientRect(); return r ? `${Math.round(r.width)}x${Math.round(r.height)}` : '-' })() })
      })
      // 渲染完成：抓取当前 section 可见文本长度 + 内容高度，用于区分「布局没分页(文本数=0)」还是「文字存在但不可见」
      rendition.on('rendered', () => {
        try {
          const c: any = rendition.getContents()
          const doc = Array.isArray(c) ? c[0]?.document : c?.document
          const len = doc?.body?.innerText?.trim().length || 0
          const sh = (doc?.body?.scrollHeight) || 0
          dbg({ txtLen: String(len), scrollH: String(sh) })
        } catch { /* */ }
      })
      rendition.on('displayError', (e: any) => { dbg({ err: 'displayError: ' + (e?.message || e) }) })
      rendition.on('loadError', (e: any) => { dbg({ err: 'loadError: ' + (e?.message || e) }) })
      rendition.on('selected', (cfi: string, contents: any) => {
        try {
          const text = contents.window.getSelection().toString()
          if (text) {
            rendition.highlight(cfi, { fill: settings.accent + '55' }, () => {})
            addHighlight({ id: uuid(), bookId: book.id, cfi, text })
          }
        } catch { /* ignore */ }
      })

      rendition.display(book.cfi || undefined)
      // 布局稳定后重排分页；并用 ResizeObserver 在容器尺寸变化时自动重排，避免测量到 0 尺寸导致空白/翻不动。
      // 双 rAF：确保容器尺寸（绝对定位 wrapper）真正稳定后再分页，消除横向模式首屏/翻页空白。
      requestAnimationFrame(() => {
        try { rendition.resize() } catch { /* */ }
        requestAnimationFrame(() => { try { rendition.resize() } catch { /* */ } })
      })
      const vr = viewerRef.current
      if (vr && typeof ResizeObserver !== 'undefined') {
        let rt: any = null
        const ro = new ResizeObserver(() => {
          clearTimeout(rt)
          rt = setTimeout(() => { try { renditionRef.current?.resize() } catch { /* */ } }, 120)
        })
        ro.observe(vr)
        roRef.current = ro
      }
      if (!cancelled) setLoading(false)
    })()

    return () => {
      cancelled = true
      stopReading()
      try { roRef.current?.disconnect() } catch { /* */ }
      try { renditionRef.current?.destroy(); bookRef.current?.destroy() } catch { /* */ }
      renditionRef.current = null
      bookRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [book.id, settings.readerMode])

  // 主题/字号变化时重刷 rendition 外观
  useEffect(() => {
    if (renditionRef.current) applyReaderTheme(renditionRef.current, settings, book.id)
  }, [settings.fontSize, settings.lineHeight, settings.theme, settings.accent, book.id, settings.fontFamily])

  // 翻页方向变化时同步到 ref（go/readLoop 在调用时读取最新值，避免重创建回调）
  useEffect(() => { modeRef.current = settings.readerMode }, [settings.readerMode])

  function applyReaderTheme(rendition: any, st: typeof settings, _id: string) {
    const t = THEMES[st.theme]
    const horizontal = st.readerMode === 'horizontal'
    // 横向 paginated 模式下，body 绝不能有 padding / box-sizing:border-box / overflow-x:hidden：
    // EPUB.js 用 body 宽度做多列分栏、用 .epub-container 的 translateX 翻页。任何 body padding/border-box
    // 都会让「实际内容区」与 EPUB.js 计算的列宽/列高/翻页步长错位 → 文字被排到当前可视页之外的列
    // （图片常落在首列）→ 表现为「只有图片、文字全无」，且翻页跟着错位。横向阅读边距交给外层
    // .viewer 容器（padding）实现，EPUB.js 按 iframe 内容尺寸算列宽，不影响分栏数学。
    // 竖向 scrolled 是普通长文档流，body padding/border-box 无副作用，保留以获得阅读边距。
    const bodyStyle = horizontal
      ? {
          background: t.readerBg + ' !important',
          color: t.fg + ' !important',
          'font-size': st.fontSize + 'px !important',
          'line-height': String(st.lineHeight) + ' !important',
          'font-family': st.fontFamily + ' !important',
          'text-align': 'left',
          margin: '0 !important'
        }
      : {
          background: t.readerBg + ' !important',
          color: t.fg + ' !important',
          'font-size': st.fontSize + 'px !important',
          'line-height': String(st.lineHeight) + ' !important',
          'font-family': st.fontFamily + ' !important',
          'padding': '4% 6% !important',
          'box-sizing': 'border-box',
          'text-align': 'left',
          'overflow-x': 'hidden !important'
        }
    rendition.themes.register('nr', {
      body: bodyStyle,
      // 防止长单词/代码块/表格溢出导致"文字歪到右边被裁"
      'p, div, h1, h2, h3, h4, h5, h6, li, blockquote, td, th, pre, code, span, a, em, strong, b, i': {
        'overflow-wrap': 'break-word !important',
        'word-break': 'break-word !important',
        'max-width': '100% !important',
        // 强制文本色：覆盖书籍自带 CSS 里可能把正文设成「与背景同色」的 !important 规则，避免整页文字不可见
        'color': t.fg + ' !important'
      },
      'img, svg, table, figure, canvas': { 'max-width': '100% !important', 'height': 'auto !important', 'box-sizing': 'border-box' },
      a: { color: st.accent }, '::selection': { background: st.accent + '66' }
    })
    rendition.themes.select('nr')
  }

  // 把 manager.views 统一成数组（不同 EPUB.js 版本可能是 Views 实例或数组）
  function getViews(r: any): any[] {
    const v = r.views?.()
    if (!v) return []
    if (Array.isArray(v)) return v
    if (typeof v.forEach === 'function') {
      const arr: any[] = []
      v.forEach((x: any) => arr.push(x))
      return arr
    }
    if (Array.isArray((v as any).views)) return (v as any).views
    return []
  }
  // 取「指定章节」在「已渲染的实时文档」中的完整文本。
  // 关键：用 r.views() 拿到带 section.href 的视图，直接读其 contents.document.body.innerText
  // —— 浏览器原生文本提取，标题/正文/<div>包裹段落一视同仁，且是整节完整 DOM（非按屏截取），
  // 彻底修复「带标题章节只读标题」（旧 section.load 拿到的文档在带标题章节里只有标题）。
  function getRenderedSectionText(r: any, targetHref: string): string {
    const views = getViews(r)
    for (const v of views) {
      const href = (v.section?.href || '').split('#')[0]
      if (href && href === targetHref && v.contents?.document?.body) {
        const t = v.contents.document.body.innerText?.trim()
        if (t) return t
      }
    }
    // 兜底：getContents 第一个 content
    const contents = r.getContents?.() || []
    const list: any[] = Array.isArray(contents) ? contents : [contents]
    for (const c of list) {
      const t = c.document?.body?.innerText?.trim()
      if (t) return t
    }
    return ''
  }
  // === scrolled（continuous）模式底层：EPUB.js 会在 .viewer 内创建 .epub-container 作为滚动容器，
  // 我们的 .viewer 只是外壳。翻页/朗读一律滚动 .epub-container——它滚动后 EPUB.js 会自己监听 scroll
  // 事件更新进度与预加载下一屏，绝不会像 next/prev 那样跳章节。 ===
  function getScroller(): HTMLElement | null {
    const v = viewerRef.current
    if (!v) return null
    const inner = v.querySelector('.epub-container') as HTMLElement | null
    return inner || v
  }
  function getScrollerTop(): number {
    const s = getScroller()
    return s ? (s.scrollTop || 0) : 0
  }
  // 滚动一屏（dir=1 下 / -1 上）。smooth=true 用于手动翻页的视觉过渡
  function scrollScreen(dir: 1 | -1, smooth = false) {
    const s = getScroller()
    if (!s) return
    const step = (s.clientHeight || 700) * 0.9
    try { s.scrollBy({ top: dir * step, behavior: smooth ? 'smooth' : 'auto' }) } catch { /* */ }
  }
  // （TTS 朗读改用 getRenderedSectionText 从「已渲染实时文档」取整节全文，见 readLoop，不再需要可见屏/坐标判定）

  // 取当前 section 在 spine 中的上/下一个 section href（横向翻页在章节边界兜底推进，确保跨章节）
  function sectionHref(r: any, dir: 1 | -1): string | null {
    try {
      const loc = r.currentLocation?.() || locRef.current
      const href = loc?.start?.href
      if (!href) return null
      const item = bookRef.current?.spine?.get(href)
      const nxt = dir > 0 ? item?.next?.() : item?.prev?.()
      return nxt?.href || null
    } catch { return null }
  }
  // 翻页：单次翻动（手动翻页用）
  // - 竖向滚动模式：原生滚动 .epub-container 一屏（continuous 连续，自动跨章节）
  // - 横向翻页模式：用 EPUB.js paginated 的 next/prev（原生跨章节）；若某本书 next 在章节边界卡住，
  //   兜底 display 到相邻 section，确保「章末最后一页能翻到下一章」
  const go = useCallback(async (dir: 1 | -1, animated = true): Promise<GoResult> => {
    if (animRef.current) return { advanced: false, atEnd: false }
    const r = renditionRef.current
    if (book.kind === 'txt' || !r) {
      const el = txtRef.current
      if (el) {
        animRef.current = true
        try {
          const step = el.clientHeight * 0.9
          if (animated) await controls.start({ opacity: 0.5, x: dir * 18 }, { duration: 0.14 })
          el.scrollBy({ top: dir * step })
          if (animated) await controls.start({ opacity: 1, x: 0 }, { duration: 0.14 })
        } finally { animRef.current = false }
      }
      return { advanced: true, atEnd: false }
    }
    animRef.current = true
    const horizontal = modeRef.current === 'horizontal'
    try {
      if (animated) {
        if (horizontal) await controls.start({ x: dir > 0 ? -26 : 26, opacity: 0.6 }, { duration: 0.12 })
        else await controls.start({ opacity: 0.55 }, { duration: 0.12 })
      }
      let advanced = true
      let atEnd = false
      if (horizontal) {
        // EPUB.js paginated 模式下 next/prev 只在本 section 内翻页，章末页不会自动跨章。
        // 用 next()/prev() 的返回值（解析为新的 location）判断是否真的推进，避免依赖异步 relocated 事件导致误判。
        const beforeCfi = r.currentLocation?.()?.start?.cfi || locRef.current?.start?.cfi || ''
        const loc = dir > 0 ? await r.next().catch(() => null) : await r.prev().catch(() => null)
        const afterCfi = loc?.start?.cfi || r.currentLocation?.()?.start?.cfi || locRef.current?.start?.cfi || ''
        if (!afterCfi || afterCfi === beforeCfi) {
          // 章节边界：手动跳到相邻 section，并 resize() 重新分页（修复跨章 + 边界空白）
          const nxt = sectionHref(r, dir)
          if (nxt) {
            await r.display(nxt)
            await wait(80)
            try { r.resize() } catch { /* */ }
            await wait(140)
          } else { advanced = false; atEnd = true }
        }
      } else {
        scrollScreen(dir, true) // 滚动 .epub-container 一屏，自动跨章节
      }
      if (animated) {
        if (horizontal) await controls.start({ x: 0, opacity: 1 }, { duration: 0.15 })
        else await controls.start({ opacity: 1 }, { duration: 0.16 })
      }
      const rr = viewerRef.current?.getBoundingClientRect()
      if (rr) dbg({ size: `${Math.round(rr.width)}x${Math.round(rr.height)}` })
      return { advanced, atEnd }
    } catch (e: any) {
      dbg({ err: (horizontal ? 'next/prev: ' : 'scroll: ') + (e?.message || e) })
      return { advanced: false, atEnd: false }
    } finally { animRef.current = false }
  }, [book.kind, controls])

  // 工具栏自动隐藏
  const poke = useCallback(() => {
    setBarShow(true)
    clearTimeout(idleRef.current)
    idleRef.current = setTimeout(() => setBarShow(false), 2500)
  }, [])

  useEffect(() => {
    poke()
    const onMove = () => poke()
    window.addEventListener('mousemove', onMove)
    return () => { window.removeEventListener('mousemove', onMove); clearTimeout(idleRef.current) }
  }, [poke])

  // ESC 逐层退出
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      const s = useStore.getState()
      if (s.tocOpen) s.setTocOpen(false)
      else if (s.bookmarksOpen) s.setBookmarksOpen(false)
      else if (s.settingsOpen) s.setSettingsOpen(false)
      else onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  // 调试面板开关（D 键）
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'd' || e.key === 'D') setShowDebug((v) => !v)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // ===== 朗读模式：逐句 + 读完当前屏自动滚一屏继续；整章读完滚到底才进下一章（绝不中途跳章节） =====
  function playSentence(url: string): Promise<void> {
    return new Promise<void>((resolve) => {
      const done = () => { resolveRef.current = null; resolve() }
      const a = audioRef.current || new Audio()
      audioRef.current = a
      a.src = url
      a.onended = done
      a.onerror = done
      resolveRef.current = done
      a.play().catch(done)
    })
  }

  async function readText(text: string): Promise<boolean> {
    const sentences = splitSentences(text)
    for (const s of sentences) {
      if (stopReadRef.current) return false
      try {
        const url = await speak(s, settings.tts)
        if (stopReadRef.current) return false
        await playSentence(url)
        try { URL.revokeObjectURL(url) } catch { /* */ }
      } catch (err: any) {
        const msg = err?.message || String(err)
        console.error('TTS:', msg)
        setTtsError(msg)
        setTimeout(() => setTtsError(''), 8000)
        // 单句失败不中断整书朗读：跳过该句继续下一句（避免「卡在标题」）
      }
    }
    return true
  }

  async function readLoop() {
    // txt 书：直接读全文（无 EPUB rendition）
    if (book.kind === 'txt') {
      const el = txtRef.current
      const text = (el?.innerText || txt || '').trim()
      await readText(text)
      if (readingRef.current && !stopReadRef.current) stopReading()
      return
    }
    const r = renditionRef.current
    if (!r) return
    const items: any[] = bookRef.current?.spine?.spineItems || []
    if (!items.length) { stopReading(); return }
    // 从当前所在 section 开始
    let curHref = r.currentLocation?.()?.start?.href || locRef.current?.start?.href || ''
    let si = 0
    if (curHref) {
      const base = curHref.split('#')[0]
      const idx = items.findIndex((it) => (it.href || '').split('#')[0] === base)
      if (idx >= 0) si = idx
    }
    while (readingRef.current && !stopReadRef.current) {
      if (si >= items.length) break
      const targetHref = (items[si].href || '').split('#')[0]
      if (!targetHref) { si++; continue }
      // 跳到该章节（实时渲染，保证拿到完整 DOM 再取文本）
      try {
        const cur = (r.currentLocation?.()?.start?.href || '').split('#')[0]
        if (cur !== targetHref) {
          await r.display(targetHref)
          await wait(220)
          try { r.resize() } catch { /* */ }
          await wait(120)
        }
      } catch { /* */ }
      // 从「已渲染的实时文档」取整节全文（标题+正文都拿到，修复只读标题）
      const text = getRenderedSectionText(r, targetHref)
      if (text.trim()) {
        await readText(text)   // 内部按句切分、逐句朗读（单句≤80字防 400；单句失败跳过不中断）
      }
      si++
    }
    // 自然读完（到书尾）
    if (readingRef.current && !stopReadRef.current) stopReading()
  }

  function stopReading() {
    stopReadRef.current = true
    readingRef.current = false
    setReading(false)
    try { audioRef.current?.pause() } catch { /* */ }
    if (resolveRef.current) resolveRef.current() // 解除 playSentence 的等待
    resolveRef.current = null
  }

  function onReadToggle() {
    if (readingRef.current) { stopReading(); return }
    stopReadRef.current = false
    readingRef.current = true
    setReading(true)
    readLoop()
  }

  function addBookmarkNow() {
    const r = renditionRef.current
    const cur = r?.currentLocation?.()
    const cfi = cur?.start?.cfi || book.cfi || ''
    if (!cfi) return
    addBookmark({ id: uuid(), bookId: book.id, cfi, label: `${tr(lang, 'pageInfo')} ${page}%`, percent: page })
  }

  function exportNotes() {
    const s = useStore.getState()
    const bms = s.bookmarks.filter((b) => b.bookId === book.id)
    const hls = s.highlights.filter((h) => h.bookId === book.id)
    let md = `# ${book.name}\n\n`
    if (bms.length) { md += `## ${tr(lang, 'bookmarks')}\n\n` + bms.map((b) => `- ${b.label}`).join('\n') + '\n\n' }
    if (hls.length) { md += `## ${tr(lang, 'highlight') || 'Highlights'}\n\n` + hls.map((h) => `> ${h.text}`).join('\n\n') + '\n' }
    const blob = new Blob([md], { type: 'text/markdown' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `${book.name}.md`
    a.click()
  }

  const barCls = (pos: 'top' | 'bottom') => `reader-bar ${pos} ${barShow ? '' : 'hidden'}`

  return (
    <div className='reader' onMouseMove={poke}>
      <div className='reader-stage'>
        {book.kind === 'txt' ? (
          <motion.div ref={txtRef} className='txt-flow' animate={controls}
            style={{ '--fs': settings.fontSize + 'px', '--lh': settings.lineHeight, whiteSpace: 'pre-wrap' } as any}>
            {txt}
          </motion.div>
        ) : (
          <div className='viewer-wrap'>
            <motion.div ref={viewerRef} className={'viewer ' + (settings.readerMode === 'horizontal' ? 'h-mode' : 'v-mode')} animate={controls} />
          </div>
        )}

        {!loading && (
          <>
            <div className='tap-zone left' onClick={() => go(-1)} />
            <div className='tap-zone right' onClick={() => go(1)} />
            <div className='tap-zone' style={{ left: '28%', right: '28%', width: 'auto' }} onClick={() => setBarShow((v) => !v)} />
          </>
        )}

        {loading && <div className='loading'><span className='spin' /> {tr(lang, 'read')}…</div>}

        {/* TTS 错误提示条 */}
        <AnimatePresence>
          {ttsError && (
            <motion.div
              initial={{ opacity: 0, y: -20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              style={{
                position: 'absolute', top: 48, left: 40, right: 40, zIndex: 200,
                background: '#dc2626', color: '#fff', borderRadius: 8,
                padding: '10px 14px', fontSize: 13, lineHeight: 1.5,
                boxShadow: '0 4px 16px rgba(0,0,0,.3)', pointerEvents: 'auto'
              }}
            >
              ⚠ {ttsError}
              <button
                onClick={() => setTtsError('')}
                style={{ float: 'right', background: 'none', border: 'none', color: '#fff', cursor: 'pointer', fontSize: 16, marginLeft: 8 }}
              >✕</button>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* 顶部悬浮栏 */}
      <div className={barCls('top')}>
        <button className='icon-btn' title={tr(lang, 'back')} onClick={onClose}><IconBack size={18} /></button>
        <button className='icon-btn' title={tr(lang, 'toc')} onClick={() => useStore.getState().setTocOpen(true)}><IconToc size={18} /></button>
        <button className='icon-btn' title={tr(lang, 'bookmarks')} onClick={() => useStore.getState().setBookmarksOpen(true)}><IconBookmark size={18} /></button>
        {settings.tts.enabled && (
          <button className='icon-btn' title={reading ? tr(lang, 'pause') : tr(lang, 'speak')} onClick={onReadToggle}>
            {reading ? <IconPause size={18} /> : <IconSpeaker size={18} />}
          </button>
        )}
        <div className='grow' style={{ width: 12 }} />
        <button className='icon-btn' title={tr(lang, 'addBookmark')} onClick={addBookmarkNow}><IconPlus size={18} /></button>
        <button className='icon-btn' title={tr(lang, 'exportNotes')} onClick={exportNotes}><IconBookmark size={18} /></button>
        <button className='icon-btn' title={tr(lang, 'settings')} onClick={() => useStore.getState().setSettingsOpen(true)}><IconSettings size={18} /></button>
      </div>

      {/* 底部翻页栏 */}
      <div className={barCls('bottom')}>
        <button className='icon-btn' onClick={() => go(-1)}><IconPrev size={18} /></button>
        <span className='pg'>{page}%</span>
        <button className='icon-btn' onClick={() => go(1)}><IconNext size={18} /></button>
      </div>

      <AnimatePresence>
        {tocOpen && <TocDrawer toc={toc} onJump={(href) => { renditionRef.current?.display(href); useStore.getState().setTocOpen(false) }} />}
      </AnimatePresence>
      <AnimatePresence>
        {bookmarksOpen && <BookmarksDrawer bookId={book.id} onJump={(cfi) => { renditionRef.current?.display(cfi); useStore.getState().setBookmarksOpen(false) }} />}
      </AnimatePresence>

      {/* 诊断面板：按 D 开关。用于定位「空白/翻不动」——显示容器尺寸、当前章节、报错 */}
      {showDebug && (
        <div className='epub-debug'>
          <div><span className='k'>容器</span> {debug.size}</div>
          <div><span className='k'>章节</span> #{debug.idx} · {debug.pct}</div>
          <div><span className='k'>文本</span> {debug.txtLen} 字 · 高 {debug.scrollH}</div>
          <div><span className='k'>href</span> {debug.href}</div>
          {debug.err && <div className='e'>⚠ {debug.err}</div>}
          <div className='hint'>按 D 隐藏</div>
        </div>
      )}
    </div>
  )
}
