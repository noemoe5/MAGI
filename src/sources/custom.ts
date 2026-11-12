// 自定义源：声明式 JSON 描述 + 通用 HTTP 执行器。
// 刻意不支持任意 JS —— 任意脚本等于把整个应用权限交出去，
// 「字段映射 + URL 模板」已能覆盖绝大多数 JSON API 型站点。
import type { CustomSourceSpec, SearchArgs, SourceDetail, SourceHit, SourceKind, SourceProvider } from './types'
import { absolutize, fetchJSON, fillTemplate, pick, SourceError } from './http'

const KINDS: SourceKind[] = ['anime', 'book', 'music']

/** 单个源定义的规范化 + 校验，失败时抛出可读原因 */
function normalizeSpec(spec: any): CustomSourceSpec {
  if (!spec || typeof spec !== 'object') throw new SourceError('缺少源定义对象')
  if (!spec.id || typeof spec.id !== 'string') throw new SourceError('缺少 id')
  if (!spec.name || typeof spec.name !== 'string') throw new SourceError('缺少 name')
  const kinds: SourceKind[] = (spec.kinds ?? spec.kind ?? []).filter?.((k: string) => KINDS.includes(k as SourceKind)) ?? []
  if (!kinds.length) throw new SourceError('kinds 需为 anime / book / music 之一或多个')
  if (!spec.search?.url) throw new SourceError('缺少 search.url')
  if (!spec.search?.fields?.id || !spec.search?.fields?.title) throw new SourceError('search.fields 至少要有 id 与 title')
  return {
    id: String(spec.id),
    name: String(spec.name),
    kinds,
    note: spec.note ? String(spec.note) : '自定义源',
    homepage: spec.homepage,
    search: {
      url: String(spec.search.url),
      headers: spec.search.headers ?? undefined,
      list: spec.search.list ?? undefined,
      fields: spec.search.fields
    },
    detail: spec.detail?.url
      ? {
          url: String(spec.detail.url),
          description: spec.detail.description ?? undefined,
          leaves: spec.detail.leaves ?? undefined,
          leafFields: spec.detail.leafFields ?? undefined
        }
      : undefined
  }
}

/** 解析并校验导入的自定义源 JSON，失败时抛出可读原因 */
export function parseCustomSpec(text: string): CustomSourceSpec {
  let raw: any
  try {
    raw = JSON.parse(text)
  } catch {
    throw new SourceError('不是合法 JSON')
  }
  const spec = Array.isArray(raw) ? raw[0] : raw
  return normalizeSpec(spec)
}

export interface BundleReport {
  specs: CustomSourceSpec[]
  /** 逐条失败原因，如「#2 缺少 name」 */
  errors: string[]
}

/**
 * 批量解析：兼容三种写法
 * 1. 单个对象 `{ id, name, ... }`
 * 2. 数组 `[ {...}, {...} ]`
 * 3. 带清单的对象 `{ sources: [ {...} ] }`（导出文件用这种）
 * 允许部分成功 —— 一个坏源不该拖垮整次导入。
 */
export function parseCustomBundle(text: string): BundleReport {
  let raw: any
  try {
    raw = JSON.parse(text)
  } catch {
    throw new SourceError('不是合法 JSON')
  }
  const list: any[] = Array.isArray(raw)
    ? raw
    : Array.isArray(raw?.sources)
      ? raw.sources
      : [raw]
  const specs: CustomSourceSpec[] = []
  const errors: string[] = []
  list.forEach((item, i) => {
    try {
      specs.push(normalizeSpec(item))
    } catch (e: any) {
      errors.push(`#${i + 1} ${String(e?.message || e)}`)
    }
  })
  if (!list.length) throw new SourceError('文件里没有任何源定义')
  return { specs, errors }
}

/** 导出为可再次导入的清单文件内容 */
export function serializeCustomSpecs(specs: CustomSourceSpec[]): string {
  return JSON.stringify(
    { format: 'magi.sources', version: 1, exportedAt: new Date().toISOString(), sources: specs },
    null,
    2
  )
}

export function createCustomProvider(spec: CustomSourceSpec): SourceProvider {
  const provider: SourceProvider = {
    id: spec.id,
    name: spec.name,
    kinds: spec.kinds,
    note: spec.note,
    homepage: spec.homepage,
    builtin: false,

    async search({ query, page = 1 }: SearchArgs): Promise<SourceHit[]> {
      if (!query.trim()) return []
      const url = fillTemplate(spec.search.url, { query, page, limit: 24 })
      const data = await fetchJSON<any>(url, { headers: spec.search.headers })
      const list = pick(data, spec.search.list)
      if (!Array.isArray(list)) throw new SourceError('list 路径未指向数组')
      const f = spec.search.fields
      return list.slice(0, 40).map((row: any, i: number) => {
        const nativeId = String(pick(row, f.id) ?? i)
        return {
          id: `${spec.id}:${nativeId}`,
          sourceId: spec.id,
          sourceName: spec.name,
          kind: spec.kinds[0],
          nativeId,
          title: String(pick(row, f.title) ?? '未命名'),
          subtitle: f.subtitle ? String(pick(row, f.subtitle) ?? '') : undefined,
          cover: absolutize(url, pick(row, f.cover)),
          year: f.year ? String(pick(row, f.year) ?? '') || undefined : undefined,
          playUrl: f.playUrl ? absolutize(url, pick(row, f.playUrl)) : undefined,
          downloadUrl: f.downloadUrl ? absolutize(url, pick(row, f.downloadUrl)) : undefined,
          openUrl: f.openUrl ? absolutize(url, pick(row, f.openUrl)) : undefined
        } as SourceHit
      })
    }
  }

  if (spec.detail) {
    const d = spec.detail
    provider.detail = async (hit): Promise<SourceDetail | null> => {
      const url = fillTemplate(d.url, { id: hit.nativeId, query: hit.nativeId, page: 1, limit: 50 })
      const data = await fetchJSON<any>(url, { headers: spec.search.headers })
      const desc = d.description ? pick(data, d.description) : undefined
      const leavesRaw = d.leaves ? pick(data, d.leaves) : []
      const lf = d.leafFields
      const leaves = Array.isArray(leavesRaw) && lf
        ? leavesRaw.map((row: any, i: number) => ({
            id: `${hit.id}:leaf:${String(pick(row, lf.id) ?? i)}`,
            title: String(pick(row, lf.title) ?? `第 ${i + 1} 项`),
            playUrl: lf.playUrl ? absolutize(url, pick(row, lf.playUrl)) : undefined,
            index: i
          }))
        : []
      return {
        hit,
        description: desc ? String(desc) : hit.description,
        leaves,
        facts: []
      }
    }
  }

  return provider
}
