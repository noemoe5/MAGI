// 内置动漫通道。
// 主源：AniList（GraphQL，POST）—— 元数据完整、免 Key、国内多数网络可直连。
// 备源：Jikan（MyAnimeList v4）—— 只在能连通 api.jikan.moe 的网络下有用，默认关闭。
// 两者都只做「元数据 + 分集 + 正版观看入口」，不直连任何资源站。
import type { SourceHit, SourceProvider, SourceDetail, SourceLeaf } from '../types'
import { getJSON, postJSON, stripHtml, withRetry } from '../http'

const ANILIST = 'https://graphql.anilist.co'

/* ------------------------------------------------------------------ AniList */

interface AniTitle { romaji?: string; english?: string; native?: string }

interface AniMedia {
  id: number
  title: AniTitle
  synonyms?: string[]
  coverImage?: { extraLarge?: string; large?: string; color?: string }
  bannerImage?: string
  format?: string
  episodes?: number
  duration?: number
  status?: string
  seasonYear?: number
  averageScore?: number
  genres?: string[]
  description?: string
  siteUrl?: string
  studios?: { nodes?: Array<{ name: string }> }
  nextAiringEpisode?: { episode: number; airingAt: number }
  externalLinks?: Array<{ site: string; url: string; type?: string }>
  streamingEpisodes?: Array<{ title?: string; thumbnail?: string; url?: string; site?: string }>
}

const MEDIA_FIELDS = `
  id
  title { romaji english native }
  synonyms
  coverImage { extraLarge large color }
  bannerImage
  format
  episodes
  duration
  status
  seasonYear
  averageScore
  genres
  description(asHtml: false)
  siteUrl
  studios(isMain: true) { nodes { name } }
  nextAiringEpisode { episode airingAt }
  externalLinks { site url type }
  streamingEpisodes { title thumbnail url site }
`

/** 中文名优先（AniList 的 synonyms 里时常带简繁中文名），其次英文，最后罗马字 */
function pickTitle(m: AniMedia): string {
  const zh = (m.synonyms ?? []).find((s) => /[\u4e00-\u9fa5]/.test(s))
  return zh || m.title.english || m.title.romaji || m.title.native || `#${m.id}`
}

const STATUS_LABEL: Record<string, string> = {
  RELEASING: '连载中',
  FINISHED: '已完结',
  NOT_YET_RELEASED: '未播出',
  CANCELLED: '已取消',
  HIATUS: '停更'
}

const FORMAT_LABEL: Record<string, string> = {
  TV: 'TV',
  TV_SHORT: 'TV 短篇',
  MOVIE: '剧场版',
  SPECIAL: '特别篇',
  OVA: 'OVA',
  ONA: 'ONA',
  MUSIC: '音乐'
}

/** 国内能直接打开的正版入口优先，其次官方站 */
const CN_SITES = ['bilibili', 'iqiyi', 'youku', 'tencent', 'mgtv', 'acfun']

function bestOpenUrl(m: AniMedia): string | undefined {
  const links = m.externalLinks ?? []
  const cn = links.find((l) => CN_SITES.some((s) => l.site.toLowerCase().includes(s)))
  return cn?.url || links.find((l) => l.type === 'STREAMING')?.url || m.siteUrl
}

function toHit(m: AniMedia): SourceHit {
  const status = STATUS_LABEL[m.status || ''] || m.status
  return {
    id: `anilist:${m.id}`,
    sourceId: 'anilist',
    sourceName: 'AniList',
    kind: 'anime',
    nativeId: String(m.id),
    title: pickTitle(m),
    subtitle: [m.studios?.nodes?.[0]?.name, (m.genres ?? []).slice(0, 2).join(' / ')].filter(Boolean).join(' · '),
    cover: m.coverImage?.extraLarge || m.coverImage?.large,
    year: m.seasonYear ? String(m.seasonYear) : undefined,
    badge: m.episodes ? `EP${m.episodes}` : status,
    openUrl: bestOpenUrl(m),
    description: stripHtml(m.description),
    meta: {
      评分: m.averageScore ? `${m.averageScore}%` : undefined,
      状态: status,
      类型: FORMAT_LABEL[m.format || ''] || m.format,
      话数: m.episodes ?? undefined,
      放送: m.nextAiringEpisode ? `第 ${m.nextAiringEpisode.episode} 话待播` : undefined
    }
  }
}

async function gql<T>(query: string, variables: Record<string, unknown>): Promise<T> {
  const res = await withRetry(() => postJSON<{ data?: T; errors?: Array<{ message: string }> }>(ANILIST, { query, variables }, 14000))
  if (res.errors?.length) throw new Error(res.errors[0].message)
  if (!res.data) throw new Error('AniList 返回为空')
  return res.data
}

export const anilistSource: SourceProvider = {
  id: 'anilist',
  name: 'AniList',
  kinds: ['anime'],
  note: '动漫元数据主源，免 Key；提供分集与正版观看入口',
  homepage: 'https://anilist.co',
  builtin: true,

  async search({ query, limit = 24 }) {
    if (!query.trim()) return []
    const data = await gql<{ Page: { media: AniMedia[] } }>(
      `query ($search: String, $perPage: Int) {
         Page(page: 1, perPage: $perPage) {
           media(search: $search, type: ANIME, isAdult: false, sort: SEARCH_MATCH) { ${MEDIA_FIELDS} }
         }
       }`,
      { search: query.trim(), perPage: Math.min(limit, 30) }
    )
    return (data.Page?.media ?? []).map(toHit)
  },

  async detail(hit): Promise<SourceDetail | null> {
    const id = Number(hit.nativeId)
    if (!Number.isFinite(id)) return null
    const data = await gql<{ Media: AniMedia }>(
      `query ($id: Int) { Media(id: $id, type: ANIME) { ${MEDIA_FIELDS} } }`,
      { id }
    )
    const m = data.Media
    if (!m) return null

    // 分集：优先用 streamingEpisodes（有真实标题），否则按话数生成
    const url = bestOpenUrl(m)
    let leaves: SourceLeaf[] = (m.streamingEpisodes ?? [])
      .filter((e) => e && (e.title || e.url))
      .map((e, i) => ({
        id: `anilist:${m.id}:ep:${i + 1}`,
        title: e.title || `第 ${i + 1} 话`,
        subtitle: e.site,
        openUrl: e.url || url,
        index: i + 1
      }))
    if (!leaves.length && m.episodes) {
      leaves = Array.from({ length: m.episodes }, (_, i) => ({
        id: `anilist:${m.id}:ep:${i + 1}`,
        title: `第 ${i + 1} 话`,
        openUrl: url,
        index: i + 1
      }))
    }

    return {
      hit: { ...toHit(m), id: hit.id, sourceId: hit.sourceId, sourceName: hit.sourceName },
      description: stripHtml(m.description) || hit.description,
      leaves,
      facts: [
        { label: '话数', value: m.episodes ? String(m.episodes) : '未知' },
        { label: '单集时长', value: m.duration ? `${m.duration} 分钟` : '未知' },
        { label: '状态', value: STATUS_LABEL[m.status || ''] || '未知' },
        { label: '制作', value: m.studios?.nodes?.map((s) => s.name).join('、') || '未知' },
        { label: '评分', value: m.averageScore ? `${m.averageScore} / 100` : '—' },
        { label: '类型', value: (m.genres ?? []).join('、') || '—' }
      ].filter((f) => f.value !== '未知' && f.value !== '—')
    }
  }
}

/* ------------------------------------------------------------------- Jikan */

interface JikanAnime {
  mal_id: number
  title: string
  title_english?: string | null
  titles?: Array<{ type: string; title: string }>
  images?: { jpg?: { large_image_url?: string; image_url?: string } }
  episodes?: number | null
  status?: string
  year?: number | null
  season?: string | null
  score?: number | null
  synopsis?: string
  url?: string
  genres?: Array<{ name: string }>
  studios?: Array<{ name: string }>
}

interface JikanEpisode { mal_id: number; title: string; aired?: string | null }

const pickJikanTitle = (a: JikanAnime) => {
  const zh = a.titles?.find((t) => t.type === 'Chinese')?.title
  return zh || a.title_english || a.title
}

const toJikanHit = (a: JikanAnime): SourceHit => ({
  id: `jikan:${a.mal_id}`,
  sourceId: 'jikan',
  sourceName: 'Jikan (MAL)',
  kind: 'anime',
  nativeId: String(a.mal_id),
  title: pickJikanTitle(a),
  subtitle: [a.studios?.[0]?.name, a.genres?.slice(0, 2).map((g) => g.name).join(' / ')].filter(Boolean).join(' · '),
  cover: a.images?.jpg?.large_image_url || a.images?.jpg?.image_url,
  year: a.year ? String(a.year) : undefined,
  badge: a.episodes ? `EP${a.episodes}` : a.status === 'Currently Airing' ? '连载中' : undefined,
  openUrl: a.url,
  description: a.synopsis?.replace(/\s+/g, ' ').trim(),
  meta: {
    评分: a.score ?? undefined,
    状态: a.status,
    季: a.season && a.year ? `${a.season} ${a.year}` : undefined
  }
})

export const jikanSource: SourceProvider = {
  id: 'jikan',
  name: 'Jikan · MAL',
  kinds: ['anime'],
  note: 'MyAnimeList 公共元数据源；api.jikan.moe 在国内常不可达，连不上就保持关闭',
  homepage: 'https://jikan.moe',
  builtin: true,
  // 国内网络基本连不上，默认不参与聚合，避免每次搜索都报一条失败
  defaultEnabled: false,

  async search({ query }) {
    if (!query.trim()) return []
    const url = `https://api.jikan.moe/v4/anime?q=${encodeURIComponent(query)}&limit=20&sfw`
    const data = await withRetry(() => getJSON<{ data?: JikanAnime[] }>(url, 10000))
    return (data.data ?? []).map(toJikanHit)
  },

  async detail(hit): Promise<SourceDetail | null> {
    const id = hit.nativeId
    const [full, eps] = await Promise.all([
      getJSON<{ data?: JikanAnime }>(`https://api.jikan.moe/v4/anime/${id}/full`).catch(() => null),
      getJSON<{ data?: JikanEpisode[] }>(`https://api.jikan.moe/v4/anime/${id}/episodes`).catch(() => null)
    ])
    if (!full?.data && !eps?.data) throw new Error('详情获取失败')
    const a = full?.data
    const leaves = (eps?.data ?? []).map((e) => ({
      id: `jikan:${id}:ep:${e.mal_id}`,
      title: e.title || `第 ${e.mal_id} 集`,
      subtitle: e.aired ? new Date(e.aired).toLocaleDateString() : undefined,
      openUrl: `https://myanimelist.net/anime/${id}/episode/${e.mal_id}`,
      index: e.mal_id
    }))
    return {
      hit,
      description: a?.synopsis?.replace(/\s+/g, ' ').trim() || hit.description,
      leaves,
      facts: [
        { label: '话数', value: a?.episodes ? String(a.episodes) : '未知' },
        { label: '状态', value: a?.status || '未知' },
        { label: '制作', value: a?.studios?.map((s) => s.name).join('、') || '未知' },
        { label: '评分', value: a?.score ? String(a.score) : '—' }
      ].filter((f) => f.value !== '未知' || f.label === '话数')
    }
  }
}
