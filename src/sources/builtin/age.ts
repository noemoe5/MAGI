// 内置动漫通道：AGE 动漫（agedm.io）。
// v2 公开 JSON 接口，无需 Key：
//   搜索 GET https://api.agedm.io/v2/search?query={q}   → data.videos[]
//   详情 GET https://api.agedm.io/v2/detail/{id}        → video{ ... playlists }
// 分集地址是 AES 加密的 `age_xxx` 串，本源不解密——直接给官方播放页，
// 由系统浏览器承接播放（与 anilist 源的 openUrl 策略一致，避免加密一变就失效）。
import type { SourceHit, SourceProvider, SourceDetail, SourceLeaf } from '../types'
import { getJSON, stripHtml, withRetry } from '../http'

const API = 'https://api.agedm.io/v2'
const SITE = 'https://www.agedm.io'

interface AgeVideo {
  id: number
  name?: string
  name_original?: string
  name_other?: string
  cover?: string
  intro?: string
  year?: string
  type?: string
  status?: string
  uptodate?: string
  company?: string
  tags?: string
  plot?: string
  premiere?: string
  playlists?: Record<string, Array<[string, string]>>
}

interface AgeSearchResp {
  code: number
  message?: string
  data?: { videos?: AgeVideo[] }
}

interface AgeDetailResp {
  video?: AgeVideo
}

/** 官方封面 CDN，搜索接口不返回 cover 时可按 id 拼 */
function coverOf(v: AgeVideo): string | undefined {
  if (v.cover) return v.cover
  if (v.id) return `https://cdn.aqdstatic.com:966/age/covers/${v.id}.jpg`
  return undefined
}

function toHit(v: AgeVideo): SourceHit {
  return {
    id: `agedm:${v.id}`,
    sourceId: 'agedm',
    sourceName: 'AGE 动漫',
    kind: 'anime',
    nativeId: String(v.id),
    title: v.name || v.name_original || `#${v.id}`,
    subtitle: [v.company, v.tags?.split(' ').slice(0, 2).join(' / ')].filter(Boolean).join(' · '),
    cover: coverOf(v),
    year: v.year,
    badge: v.uptodate || v.status,
    openUrl: `${SITE}/detail/${v.id}`,
    description: stripHtml(v.intro),
    meta: {
      状态: v.status,
      类型: v.type,
      更新: v.uptodate,
      制作: v.company,
      放送: v.premiere
    }
  }
}

const UA = { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36' }

export const agedmSource: SourceProvider = {
  id: 'agedm',
  name: 'AGE 动漫',
  kinds: ['anime'],
  note: 'agedm.io 分集索引；播放地址加密，点播跳官方页',
  homepage: SITE,
  builtin: true,

  async search({ query, limit = 24 }) {
    const q = query.trim()
    if (!q) return []
    const data = await withRetry(() =>
      getJSON<AgeSearchResp>(`${API}/search?query=${encodeURIComponent(q)}`, 14000)
    )
    const videos = data.data?.videos ?? []
    return videos.slice(0, limit).map(toHit)
  },

  async detail(hit): Promise<SourceDetail | null> {
    const id = hit.nativeId
    const data = await withRetry(() => getJSON<AgeDetailResp>(`${API}/detail/${id}`, 14000))
    const v = data.video
    if (!v) return null

    // playlists: { xigua: [[集名, 加密串], ...], ffm3u8: [...] }
    // 只取集名做分集列表，播放交给官方页——不同线路集数可能不一致，取最长的那条
    const lists = Object.entries(v.playlists ?? {})
    const best = lists.sort((a, b) => (b[1]?.length ?? 0) - (a[1]?.length ?? 0))[0]

    const leaves: SourceLeaf[] = (best?.[1] ?? []).map((item, i) => ({
      id: `agedm:${id}:${i + 1}`,
      title: String(item?.[0] ?? `第 ${i + 1} 集`),
      openUrl: `${SITE}/detail/${id}`,
      index: i + 1
    }))

    const facts: Array<{ label: string; value: string }> = []
    const push = (label: string, value?: string) => {
      if (value) facts.push({ label, value })
    }
    push('原名', v.name_original)
    push('状态', v.status)
    push('更新', v.uptodate)
    push('类型', v.type)
    push('制作', v.company)
    push('放送', v.premiere)
    push('标签', v.tags)
    push('线路', best?.[0])

    return {
      hit: { ...toHit(v), id: hit.id, sourceId: hit.sourceId, sourceName: hit.sourceName },
      description: stripHtml(v.intro),
      leaves,
      facts
    }
  }
}
