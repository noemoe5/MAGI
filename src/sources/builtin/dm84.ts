// 内置动漫通道：动漫巴士（dm84.tv）。
// 纯 HTML 站点，无公开 API，靠正则从页面提取：
//   搜索 GET https://dm84.tv/s----------.html?wd={q}
//   详情 GET https://dm84.tv/v/{id}.html
// 播放页 /p/{vid}-{sid}-{eid}.html 内是第三方解析器的 iframe，拿不到直链，
// 因此分集只给 openUrl，点播交给系统浏览器。
import type { SourceHit, SourceProvider, SourceDetail, SourceLeaf } from '../types'
import { getText, stripHtml, absolutize, withRetry } from '../http'

const SITE = 'https://dm84.tv'
const UA = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36'
}

/** 从一段 HTML 里取出某个 meta 的 content */
function metaOf(html: string, prop: string): string | undefined {
  // 属性顺序两种都见过：name 在前 / property 在前
  const re = new RegExp(`<meta[^>]+(?:name|property)=["']${prop}["'][^>]+content=["']([^"']*)["']`, 'i')
  const m = html.match(re)
  return m?.[1]?.trim() || undefined
}

/** <title> 里通常带「-欧美动漫-动漫巴士」后缀，去掉 */
function cleanTitle(t?: string): string | undefined {
  if (!t) return undefined
  return t.replace(/《|》/g, '').replace(/全集免费在线观看.*$/i, '').replace(/-[^-]*动漫.*$/i, '').trim()
}

interface Dm84Item {
  id: string
  title: string
  cover?: string
  desc?: string
}

/** 解析搜索结果里的 <ul class="v_list"> 块 */
function parseList(html: string): Dm84Item[] {
  const out: Dm84Item[] = []
  // 每个条目形如：<li><div class="item"><a href="/v/94.html" class="cover lazy" data-bg="..." title="..."></a>
  //              <a class="title" href="/v/94.html" title="...">...</a><span class="desc">完结</span></div></li>
  const re = /<li>\s*<div class="item">([\s\S]*?)<\/div>\s*<\/li>/gi
  let m: RegExpExecArray | null
  while ((m = re.exec(html))) {
    const block = m[1]
    const idMatch = block.match(/href="\/v\/(\d+)\.html"/)
    if (!idMatch) continue
    const titleMatch = block.match(/class="title"[^>]*title="([^"]*)"/) || block.match(/class="cover[^"]*"[^>]*title="([^"]*)"/)
    const coverMatch = block.match(/data-bg="([^"]*)"/)
    const descMatch = block.match(/<span class="desc">([\s\S]*?)<\/span>/i)
    out.push({
      id: idMatch[1],
      title: (titleMatch?.[1] || `#${idMatch[1]}`).trim(),
      cover: coverMatch?.[1],
      desc: stripHtml(descMatch?.[1])
    })
  }
  // 兜底：结构变了就只抓链接，至少让搜索结果可用
  if (!out.length) {
    const ids = new Set<string>()
    const re2 = /href="\/v\/(\d+)\.html"[^>]*title="([^"]*)"/gi
    let m2: RegExpExecArray | null
    while ((m2 = re2.exec(html))) {
      if (ids.has(m2[1])) continue
      ids.add(m2[1])
      out.push({ id: m2[1], title: m2[2].trim() })
    }
  }
  return out
}

function toHit(it: Dm84Item): SourceHit {
  return {
    id: `dm84:${it.id}`,
    sourceId: 'dm84',
    sourceName: '动漫巴士',
    kind: 'anime',
    nativeId: it.id,
    title: it.title,
    subtitle: it.desc,
    cover: it.cover,
    badge: it.desc,
    openUrl: `${SITE}/v/${it.id}.html`,
    meta: { 状态: it.desc }
  }
}

export const dm84Source: SourceProvider = {
  id: 'dm84',
  name: '动漫巴士',
  kinds: ['anime'],
  note: 'dm84.tv 页面索引；播放走站内解析器，点播跳官方页',
  homepage: SITE,
  builtin: true,

  async search({ query, limit = 24 }) {
    const q = query.trim()
    if (!q) return []
    const url = `${SITE}/s----------.html?wd=${encodeURIComponent(q)}`
    const html = await withRetry(() => getText(url, 15000, { headers: UA }))
    return parseList(html).slice(0, limit).map(toHit)
  },

  async detail(hit): Promise<SourceDetail | null> {
    const id = hit.nativeId
    const url = `${SITE}/v/${id}.html`
    const html = await withRetry(() => getText(url, 15000, { headers: UA }))
    if (!html || html.length < 500) return null

    const title = cleanTitle(metaOf(html, 'og:title')) || cleanTitle(html.match(/<title>([^<]*)<\/title>/i)?.[1]) || hit.title
    const cover = metaOf(html, 'og:image')
    const description = metaOf(html, 'og:description')

    // 剧集：/p/{vid}-{sid}-{eid}.html ，同一集在多条线路重复出现（火影这种 720 集的
    // 番剧三条线路加起来能有 2000+ 条），这里按线路分组后只留集数最全的一条，避免 UI 卡死。
    // 注意用当前 vid 限定，否则页面推荐位的其它番剧链接会被一起扫进来。
    const bySid = new Map<string, SourceLeaf[]>()
    const seen = new Set<string>()
    const re = new RegExp(
      `<a[^>]+href="(\\/p\\/(${id})-(\\d+)-(\\d+)\\.html)"[^>]*>([\\s\\S]{0,80}?)<\\/a>`,
      'gi'
    )
    let m: RegExpExecArray | null
    while ((m = re.exec(html))) {
      const [, href, , sid, eid, rawText] = m
      const key = `${sid}-${eid}`
      if (seen.has(key)) continue
      seen.add(key)
      const name = stripHtml(rawText) || `第 ${eid} 集`
      const list = bySid.get(sid) ?? []
      list.push({
        id: `dm84:${id}:${sid}:${eid}`,
        title: name,
        openUrl: absolutize(SITE, href),
        index: Number(eid) || list.length + 1
      })
      bySid.set(sid, list)
    }
    const lanes = [...bySid.entries()].sort((a, b) => b[1].length - a[1].length)
    const leaves = (lanes[0]?.[1] ?? []).sort((a, b) => (a.index ?? 0) - (b.index ?? 0))
    const laneName = lanes[0]?.[0]

    const facts: Array<{ label: string; value: string }> = []
    const push = (label: string, value?: string) => {
      if (value) facts.push({ label, value })
    }
    push('原名', metaOf(html, 'og:video:alias'))
    push('导演', metaOf(html, 'og:video:director'))
    push('声优', metaOf(html, 'og:video:actor'))
    push('地区', metaOf(html, 'og:video:area'))
    push('年份', metaOf(html, 'og:video:release_date'))
    push('集数', leaves.length ? String(leaves.length) : metaOf(html, 'og:video:update_new'))
    push('线路', laneName ? `线路 ${laneName}（共 ${lanes.length} 条）` : undefined)

    return {
      hit: { ...toHit({ id, title, cover, desc: undefined }), id: hit.id, sourceId: hit.sourceId, sourceName: hit.sourceName },
      description,
      leaves,
      facts
    }
  }
}
