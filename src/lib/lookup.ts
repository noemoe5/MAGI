import { KnowledgeEntry, Literature, AppLang } from '../types'
import builtin from '../data/knowledge.json'

/** 内置词库（随包分发，首次启动即预置为「本地知识库」的底库） */
export const BUILTIN_KNOWLEDGE = builtin as KnowledgeEntry[]

export function isBuiltin(term: string): boolean {
  return BUILTIN_KNOWLEDGE.some((k) => k.term.toLowerCase() === term.toLowerCase())
}

export interface WebResult {
  title: string
  extract: string
  url: string
  thumbnail?: string
  source: string
}

export interface LookupResult {
  query: string
  local: KnowledgeEntry[]
  web: WebResult[]
  /** 联网是否成功；失败时前端提示「离线：仅显示本地结果」 */
  online: boolean
  error?: string
}

/** 经主进程代理发 HTTP 请求（渲染进程受 CORS/CSP 限制，统一走 IPC） */
async function proxyJson(url: string): Promise<any> {
  const api = (window as any).electronAPI
  if (!api?.lookupFetch) throw new Error('当前环境不支持联网查阅（非桌面端）')
  const res = await api.lookupFetch(url)
  if (!res || res.error) throw new Error(res?.error || '网络请求失败')
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return JSON.parse(res.text)
}

/**
 * 本地匹配：划词常常是一整句，因此除「等值/前缀」外还支持
 * 「选中文本里包含某个词条」这种反向包含，保证划一句话也能带出相关词条。
 */
export function localLookup(knowledge: KnowledgeEntry[], query: string, limit = 8): KnowledgeEntry[] {
  const q = query.trim().toLowerCase()
  if (!q) return []
  const scored: { e: KnowledgeEntry; s: number }[] = []
  for (const e of knowledge) {
    const terms = [e.term, ...(e.alias || [])].map((t) => t.toLowerCase()).filter(Boolean)
    let best = 0
    for (const t of terms) {
      if (t === q) best = Math.max(best, 100)
      else if (t.startsWith(q) || q.startsWith(t)) best = Math.max(best, 78)
      else if (t.includes(q)) best = Math.max(best, 62)
      // 反向包含：词条出现在长句里（限定词条至少 2 字，避免单字误命中）
      else if (t.length >= 2 && q.includes(t)) best = Math.max(best, 40 + Math.min(t.length, 10))
    }
    if (best === 0 && e.definition.toLowerCase().includes(q)) best = 22
    if (best > 0) scored.push({ e, s: best })
  }
  return scored
    .sort((a, b) => b.s - a.s)
    .slice(0, limit)
    .map((x) => x.e)
}

/* ============================ 联网数据源 ============================
 * 实测（2026-09，本机网络）：
 *   ✅ 百度百科 openapi    ~280ms  摘要最长（400 字级），通用名词最佳
 *   ✅ 萌娘百科 站内 API   ~1.2s   ACG / 轻小说 / 角色名最准（MediaWiki，支持站内搜索）
 *   ❌ 维基百科 / DuckDuckGo      本机网络不可达（超时），仅作末位兜底，供无限制网络使用
 * 因此按「先可达、再兜底」的顺序串链，任一源有结果就不必等被墙的源。
 * ==================================================================== */

/** MediaWiki 站内搜索（萌娘百科 / 维基百科通用） */
async function mediaWikiSearch(host: string, label: string, q: string, limit = 3): Promise<WebResult[]> {
  const url =
    `https://${host}/api.php?action=query&format=json&origin=*` +
    `&generator=search&gsrsearch=${encodeURIComponent(q)}&gsrlimit=${limit}` +
    `&prop=extracts|info&exintro=1&explaintext=1&inprop=url&redirects=1`
  const data = await proxyJson(url)
  const pages: any[] = data?.query?.pages ? Object.values(data.query.pages) : []
  return pages
    .sort((a: any, b: any) => (a.index ?? 0) - (b.index ?? 0))
    .map((p: any) => ({
      title: String(p.title || ''),
      extract: String(p.extract || '').trim(),
      url: String(p.fullurl || `https://${host}/${encodeURIComponent(String(p.title || ''))}`).replace(/^http:/, 'https:'),
      source: label
    }))
    .filter((r) => r.title && r.extract)
}

/** 百度百科词条卡片 API（返回 title / abstract / image / url） */
async function baiduLemma(q: string): Promise<WebResult[]> {
  const url =
    `https://baike.baidu.com/api/openapi/BaikeLemmaCardApi?scope=103&format=json&appid=379020` +
    `&bk_key=${encodeURIComponent(q)}&bk_length=600`
  const data = await proxyJson(url)
  const title = String(data?.title || '').trim()
  const extract = String(data?.abstract || data?.desc || '').replace(/\s+/g, ' ').trim()
  if (!title || !extract) return []
  const rawUrl = String(data?.url || '').trim()
  return [
    {
      title,
      extract,
      // 百科返回的常是 http，统一升级为 https，避免被系统浏览器/安全策略拦
      url: (rawUrl && /^https?:\/\//.test(rawUrl)
        ? rawUrl.replace(/^http:/, 'https:')
        : `https://baike.baidu.com/item/${encodeURIComponent(title)}`),
      thumbnail: typeof data?.image === 'string' && /^https?:\/\//.test(data.image) ? data.image : undefined,
      source: '百度百科'
    }
  ]
}

/** DuckDuckGo 即时问答（仅作兜底） */
async function duckduckgo(q: string): Promise<WebResult[]> {
  const url = `https://api.duckduckgo.com/?q=${encodeURIComponent(q)}&format=json&no_html=1&skip_disambig=1`
  const data = await proxyJson(url)
  const out: WebResult[] = []
  const push = (t: string, text: string, u: string) => {
    if (text && text.trim()) out.push({ title: t, extract: text.trim(), url: u, source: 'DuckDuckGo' })
  }
  if (data?.AbstractText) push(data.Heading || q, data.AbstractText, data.AbstractURL || '')
  for (const t of data?.RelatedTopics || []) {
    if (t?.Text) push(String(t.Text).split(' - ')[0], t.Text, t.FirstURL || '')
    if (out.length >= 3) break
  }
  return out
}

interface Source {
  name: string
  run: () => Promise<WebResult[]>
  /** 仅在前面所有源都无结果时才尝试（用于可能不可达的源，避免白白等待超时） */
  lastResort?: boolean
}

/**
 * 完整查阅：本地词库命中 + 联网摘要。
 * 联网失败不抛错（离线也要能用），通过 online/error 告知前端。
 */
export async function runLookup(
  query: string,
  opts: { lang: AppLang; knowledge: KnowledgeEntry[]; online?: boolean }
): Promise<LookupResult> {
  const q = query.trim()
  const local = localLookup(opts.knowledge, q)
  if (!q) return { query: q, local: [], web: [], online: false }
  if (opts.online === false) return { query: q, local, web: [], online: false }

  const zh = opts.lang !== 'en'
  const chain: Source[] = zh
    ? [
        { name: '百度百科', run: () => baiduLemma(q) },
        { name: '萌娘百科', run: () => mediaWikiSearch('zh.moegirl.org.cn', '萌娘百科', q) },
        { name: '中文维基', run: () => mediaWikiSearch('zh.wikipedia.org', '中文维基百科', q), lastResort: true }
      ]
    : [
        // 英文界面对本机网络同样以可达源优先：维基/DDG 常被墙，放末位兜底，
        // 否则用户每次查阅都要先干等两轮 8s 超时。
        { name: '萌娘百科', run: () => mediaWikiSearch('zh.moegirl.org.cn', '萌娘百科', q) },
        { name: 'Wikipedia', run: () => mediaWikiSearch('en.wikipedia.org', 'Wikipedia', q), lastResort: true },
        { name: 'DuckDuckGo', run: () => duckduckgo(q), lastResort: true }
      ]

  const web: WebResult[] = []
  let used = 0
  let lastErr = ''
  for (const src of chain) {
    if (used >= 2) break
    if (src.lastResort && web.length) continue
    try {
      const r = await src.run()
      if (r.length) used++
      for (const item of r) {
        if (!item.extract) continue
        if (web.some((w) => w.title === item.title)) continue
        web.push(item)
      }
    } catch (e: any) {
      lastErr = `${src.name}: ${e?.message || e}`
    }
  }

  if (web.length) return { query: q, local, web: web.slice(0, 6), online: true }
  return { query: q, local, web: [], online: false, error: lastErr || undefined }
}

/** 免费翻译（MyMemory，无需 API key）。用于划词查词的快速释义。 */
export async function translate(text: string, from: string, to: string): Promise<string> {
  const url = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(text)}&langpair=${from}|${to}`
  const data = await proxyJson(url)
  const t = data?.responseData?.translatedText
  if (!t) throw new Error('翻译服务暂无结果')
  return String(t)
}

/** 生成参考文献著录（GB/T 7714-2015 电子资源 / APA 7th） */
export function citation(lit: Literature, style: 'gbt' | 'apa'): string {
  const author = lit.author?.trim() || '佚名'
  const year = lit.year?.trim() || 'n.d.'
  const pub = lit.publisher?.trim()
  const url = lit.url?.trim()
  if (style === 'apa') {
    const parts = [author.endsWith('.') ? author : author + '.', `(${year}).`, `${lit.title}.`]
    if (pub) parts.push(`${pub}.`)
    if (url) parts.push(url)
    return parts.join(' ')
  }
  // GB/T 7714-2015：作者. 题名[EB/OL]. 出版地: 出版者, 年. 获取路径.
  let s = `${author}. ${lit.title}[EB/OL].`
  if (pub) s += ` ${pub},`
  s += ` ${year}.`
  if (url) s += ` ${url}.`
  return s
}
