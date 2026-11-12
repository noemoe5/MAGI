// 源注册表与聚合检索。
// 上层（UI / store）只依赖这里：给一组启用中的 provider，拿回「合并结果 + 每源运行状态」。
import { anilistSource, jikanSource } from './builtin/anime'
import { gutenbergSource } from './builtin/book'
import { itunesSource } from './builtin/music'
import { createCustomProvider } from './custom'
import type { AggregateResult, CustomSourceSpec, SourceHit, SourceKind, SourceProvider, SourceRunState } from './types'

export const BUILTIN_SOURCES: SourceProvider[] = [anilistSource, jikanSource, gutenbergSource, itunesSource]

export function buildProviders(customs: CustomSourceSpec[]): SourceProvider[] {
  return [...BUILTIN_SOURCES, ...customs.map(createCustomProvider)]
}

/** 多源交错合并：避免某一个源把前 20 条全占满 */
function interleave(lists: SourceHit[][]): SourceHit[] {
  const out: SourceHit[] = []
  const max = Math.max(0, ...lists.map((l) => l.length))
  for (let i = 0; i < max; i++) {
    for (const list of lists) {
      if (list[i]) out.push(list[i])
    }
  }
  return out
}

export async function searchAggregate(
  providers: SourceProvider[],
  kinds: SourceKind[],
  query: string
): Promise<AggregateResult> {
  const targets = providers.filter((p) => p.kinds.some((k) => kinds.includes(k)))
  if (!query.trim() || !targets.length) return { hits: [], runs: [] }

  const results = await Promise.all(
    targets.map(async (p) => {
      const t0 = performance.now()
      try {
        const hits = await p.search({ query, limit: 24 })
        return {
          provider: p,
          hits,
          run: {
            sourceId: p.id,
            sourceName: p.name,
            ok: true,
            count: hits.length,
            ms: Math.round(performance.now() - t0)
          } as SourceRunState
        }
      } catch (e: any) {
        return {
          provider: p,
          hits: [] as SourceHit[],
          run: {
            sourceId: p.id,
            sourceName: p.name,
            ok: false,
            count: 0,
            ms: Math.round(performance.now() - t0),
            error: String(e?.message || e).slice(0, 120)
          } as SourceRunState
        }
      }
    })
  )

  return {
    hits: interleave(results.map((r) => r.hits)),
    runs: results.map((r) => r.run)
  }
}

/** 只重跑失败的那几个源，把成功的结果并回去（网络抖动时比整轮重来划算） */
export async function retryFailed(
  providers: SourceProvider[],
  kinds: SourceKind[],
  query: string,
  failedIds: string[]
): Promise<AggregateResult> {
  const targets = providers.filter((p) => failedIds.includes(p.id) && p.kinds.some((k) => kinds.includes(k)))
  const retried = await searchAggregate(targets, kinds, query)
  const okHits = retried.runs
    .map((r, i) => (r.ok ? targets[i] : null))
    .filter(Boolean) as SourceProvider[]
  // 用重试后的结果替换原失败项的顺序位置由上层处理，这里只返回重试部分
  return { hits: interleave(okHits.map((p) => retried.hits.filter((h) => h.sourceId === p.id))), runs: retried.runs }
}

export * from './types'
