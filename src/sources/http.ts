// 源通道的网络出口。
// 渲染进程受 CSP / CORS 限制，统一优先走主进程代理（source-request，支持 POST 与自定义头），
// 浏览器调试环境（无 electronAPI）时退回 window.fetch。
import type { SourceKind } from './types'

export class SourceError extends Error {
  constructor(message: string, readonly sourceId?: string) {
    super(message)
    this.name = 'SourceError'
  }
}

type FetchResult = { ok: boolean; status: number; text: string } | { error: string }

export interface RequestOptions {
  method?: 'GET' | 'POST'
  headers?: Record<string, string>
  body?: string
  /** 主进程侧硬超时（毫秒），默认 12s，上限 30s */
  timeoutMs?: number
}

interface ElectronApi {
  sourceRequest?: (url: string, opts: RequestOptions) => Promise<FetchResult>
  lookupFetch?: (url: string) => Promise<FetchResult>
}

function api(): ElectronApi | undefined {
  return (window as any).electronAPI
}

async function rawRequest(url: string, opts: RequestOptions): Promise<FetchResult> {
  const bridge = api()
  if (bridge?.sourceRequest) return bridge.sourceRequest(url, opts)
  // 兼容只有 lookup-fetch 的旧版 preload
  if (bridge?.lookupFetch && (!opts.method || opts.method === 'GET')) return bridge.lookupFetch(url)
  try {
    const res = await fetch(url, {
      method: opts.method || 'GET',
      headers: { Accept: 'application/json,text/*;q=0.9,*/*;q=0.8', ...(opts.headers || {}) },
      body: opts.method === 'POST' ? opts.body : undefined
    })
    return { ok: res.ok, status: res.status, text: await res.text() }
  } catch (e) {
    return { error: String(e) }
  }
}

/** 带超时的取文本：主进程侧已有超时，这里再兜一层，防止 IPC 卡死时 UI 一直转圈 */
export async function getText(url: string, timeoutMs = 12000, opts: RequestOptions = {}): Promise<string> {
  const res = await request(url, { ...opts, timeoutMs })
  if (!res.ok) throw new SourceError(`HTTP ${res.status}`)
  return res.text
}

async function request(url: string, opts: RequestOptions): Promise<{ ok: boolean; status: number; text: string }> {
  const timeoutMs = opts.timeoutMs ?? 12000
  const task = rawRequest(url, opts)
  const timeout = new Promise<FetchResult>((resolve) =>
    setTimeout(() => resolve({ error: `超时 ${Math.round(timeoutMs / 1000)}s` }), timeoutMs + 800)
  )
  const res = await Promise.race([task, timeout])
  if ('error' in res) throw new SourceError(res.error)
  return res
}

export async function getJSON<T = any>(url: string, timeoutMs = 12000): Promise<T> {
  return fetchJSON<T>(url, { timeoutMs })
}

/** 带自定义头的 JSON 请求（自定义源里声明的 headers 走这条路） */
export async function fetchJSON<T = any>(url: string, opts: RequestOptions = {}): Promise<T> {
  const text = await getText(url, opts.timeoutMs ?? 12000, opts)
  try {
    return JSON.parse(text) as T
  } catch {
    throw new SourceError('响应不是合法 JSON')
  }
}

/** POST JSON（GraphQL 接口用） */
export async function postJSON<T = any>(url: string, payload: unknown, timeoutMs = 12000): Promise<T> {
  const text = await getText(url, timeoutMs, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  })
  try {
    return JSON.parse(text) as T
  } catch {
    throw new SourceError('响应不是合法 JSON')
  }
}

/** 网络抖动比较常见：失败后自动再试一次（不重试 4xx 这类确定性错误） */
export async function withRetry<T>(fn: () => Promise<T>, retries = 1): Promise<T> {
  let last: any
  for (let i = 0; i <= retries; i++) {
    try {
      return await fn()
    } catch (e: any) {
      last = e
      const msg = String(e?.message || e)
      if (/HTTP 4\d\d/.test(msg)) break
      if (i < retries) await new Promise((r) => setTimeout(r, 400 + i * 400))
    }
  }
  throw last
}

/** 限制并发：一次最多 n 个请求（源多时不至于把连接打满） */
export async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length)
  let cursor = 0
  const workers = new Array(Math.min(limit, items.length)).fill(0).map(async () => {
    while (cursor < items.length) {
      const i = cursor++
      out[i] = await fn(items[i])
    }
  })
  await Promise.all(workers)
  return out
}

export const KIND_LABEL: Record<SourceKind, string> = {
  anime: '动漫',
  book: '书籍',
  music: '音乐'
}

/** 点路径取值：`data.list.0.title` */
export function pick(obj: any, path?: string): any {
  if (!path) return obj
  return path.split('.').reduce((acc, key) => (acc == null ? acc : acc[key]), obj)
}

/** URL 模板替换：{query} {page} {limit}（query 自动 encode） */
export function fillTemplate(tpl: string, vars: Record<string, string | number>): string {
  return tpl.replace(/\{(\w+)\}/g, (all, key) => {
    const v = vars[key]
    if (v === undefined) return all
    return key === 'query' ? encodeURIComponent(String(v)) : String(v)
  })
}

/** 把相对图片地址补成绝对地址（自定义源常给 /cover/xx.jpg） */
export function absolutize(base: string, url?: string): string | undefined {
  if (!url) return undefined
  if (/^https?:\/\//i.test(url) || url.startsWith('data:')) return url
  try {
    return new URL(url, base).toString()
  } catch {
    return url
  }
}

/** 去掉 API 返回里的 HTML 片段（AniList 的 description 带 <br>） */
export function stripHtml(s?: string | null): string | undefined {
  if (!s) return undefined
  return s
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<[^>]+>/g, '')
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/&#039;/g, "'")
    .replace(/&mdash;/g, '—')
    .replace(/\s+/g, ' ')
    .trim()
}
