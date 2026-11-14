// 源通道连通性探测：一次性打出每个候选端点的状态码、耗时、响应特征。
// 用法: node _probe_sources.mjs [--json]
const Q = '周杰伦'
const Q2 = '进击的巨人'
const enc = encodeURIComponent

const CASES = [
  { id: 'anilist', kind: 'anime', name: 'AniList (GraphQL)', method: 'POST',
    url: 'https://graphql.anilist.co',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: `query($s:String){Page(perPage:3){media(search:$s,type:ANIME){id title{romaji native}} pageInfo{total}}}`, variables: { s: Q2 } }),
    probe: (t) => { const j = JSON.parse(t); const m = j?.data?.Page?.media; return `media=${m?.length} total=${j?.data?.Page?.pageInfo?.total} first=${m?.[0]?.title?.romaji}` } },

  { id: 'gutendex', kind: 'book', name: 'Gutendex', method: 'GET',
    url: 'https://gutendex.com/books?search=alice',
    probe: (t) => { const j = JSON.parse(t); return `count=${j.count} first=${j.results?.[0]?.title}` } },

  { id: 'itunes', kind: 'music', name: 'iTunes Search', method: 'GET',
    url: `https://itunes.apple.com/search?term=${enc(Q)}&media=music&limit=3`,
    probe: (t) => { const j = JSON.parse(t); return `count=${j.resultCount} first=${j.results?.[0]?.trackName} preview=${(j.results?.[0]?.previewUrl || '').slice(0, 40)}` } },

  { id: 'jikan', kind: 'anime', name: 'Jikan v4', method: 'GET',
    url: `https://api.jikan.moe/v4/anime?q=${enc(Q2)}&limit=3`,
    probe: (t) => { const j = JSON.parse(t); return `data=${j.data?.length}` } },

  // —— 落雪音乐（LX Music）系常用底层接口 ——
  { id: 'gdstudio', kind: 'music', name: 'GDStudio API (洛雪常用)', method: 'GET',
    url: `https://music-api.gdstudio.xyz/api.php?types=search&source=netease&name=${enc(Q)}&count=3&pages=1`,
    probe: (t) => { const j = JSON.parse(t); return `array=${Array.isArray(j)} n=${j.length} first=${j[0]?.name} id=${j[0]?.id}` } },

  { id: 'gdstudio_url', kind: 'music', name: 'GDStudio 取流', method: 'GET',
    url: `https://music-api.gdstudio.xyz/api.php?types=url&source=netease&id=347230&br=320`,
    probe: (t) => { const j = JSON.parse(t); return `url=${(j.url || '').slice(0, 60)} br=${j.br} size=${j.size}` } },

  { id: 'vkeys', kind: 'music', name: '野草 API (vkeys)', method: 'GET',
    url: `https://api.vkeys.cn/v2/music/netease?word=${enc(Q)}&page=1&num=3`,
    probe: (t) => { const j = JSON.parse(t); const d = j.data; return `code=${j.code} type=${Array.isArray(d) ? 'array' + d.length : typeof d}` } },

  { id: 'netease_web', kind: 'music', name: '网易云 Web API', method: 'GET',
    url: `https://music.163.com/api/search/get/web?s=${enc(Q)}&type=1&limit=3`,
    headers: { Referer: 'https://music.163.com/' },
    probe: (t) => { const j = JSON.parse(t); return `code=${j.code} songs=${j.result?.songs?.length}` } },

  { id: 'qqmusic', kind: 'music', name: 'QQ音乐 搜索', method: 'GET',
    url: `https://c.y.qq.com/soso/fcgi-bin/client_search_cp?w=${enc(Q)}&format=json&n=3&p=1`,
    headers: { Referer: 'https://y.qq.com/' },
    probe: (t) => { const s = t.replace(/^callback\(|\)$/g, ''); const j = JSON.parse(s); const l = j?.data?.song?.list; return `list=${l?.length} first=${l?.[0]?.songname}` } },

  { id: 'kugou', kind: 'music', name: '酷狗 搜索', method: 'GET',
    url: `https://mobilecdn.kugou.com/api/v3/search/song?format=json&keyword=${enc(Q)}&page=1&pagesize=3`,
    probe: (t) => { const j = JSON.parse(t); return `total=${j?.data?.total} n=${j?.data?.info?.length}` } },

  { id: 'migu', kind: 'music', name: '咪咕 搜索', method: 'GET',
    url: `https://m.music.migu.cn/migu/remoting/scr_search_tag?keyword=${enc(Q)}&type=2&rows=3&pgc=1`,
    headers: { Referer: 'https://m.music.migu.cn/' },
    probe: (t) => { const j = JSON.parse(t); return `musics=${j?.musics?.length}` } },

  { id: 'bilibili', kind: 'anime', name: 'B站 搜索', method: 'GET',
    url: `https://api.bilibili.com/x/web-interface/search/type?search_type=video&keyword=${enc(Q2)}`,
    headers: { Referer: 'https://www.bilibili.com/' },
    probe: (t) => { const j = JSON.parse(t); return `code=${j.code} n=${j?.data?.result?.length}` } },

  // —— 基础设施 / 源分发通道 ——
  { id: 'gh_raw', kind: 'infra', name: 'raw.githubusercontent', method: 'GET',
    url: 'https://raw.githubusercontent.com/noemoe5/MAGI/main/package.json',
    probe: (t) => `bytes=${t.length} has_name=${t.includes('"name"')}` },

  { id: 'jsdelivr', kind: 'infra', name: 'jsDelivr CDN', method: 'GET',
    url: 'https://cdn.jsdelivr.net/gh/noemoe5/MAGI@main/package.json',
    probe: (t) => `bytes=${t.length}` },

  { id: 'github_api', kind: 'infra', name: 'GitHub API', method: 'GET',
    url: 'https://api.github.com/repos/noemoe5/MAGI',
    probe: (t) => { const j = JSON.parse(t); return `name=${j.full_name} stars=${j.stargazers_count}` } }
]

function timeout(ms) {
  const c = new AbortController()
  const t = setTimeout(() => c.abort(), ms)
  return { signal: c.signal, done: () => clearTimeout(t) }
}

async function run(c) {
  const t0 = Date.now()
  const tb = timeout(12000)
  try {
    const res = await fetch(c.url, {
      method: c.method,
      headers: { 'User-Agent': 'MAGI-probe/1.0', Accept: 'application/json,text/html;q=0.9,*/*;q=0.8', ...(c.headers || {}) },
      body: c.body,
      signal: tb.signal,
      redirect: 'follow'
    })
    const text = await res.text()
    const ms = Date.now() - t0
    let detail = ''
    try { detail = c.probe(text) } catch (e) { detail = `解析失败(${String(e).slice(0, 40)}) 前80字:${text.slice(0, 80).replace(/\s+/g, ' ')}` }
    return { ...c, ok: res.ok && res.status < 400, status: res.status, ms, detail, bytes: text.length }
  } catch (e) {
    return { ...c, ok: false, status: 0, ms: Date.now() - t0, detail: String(e?.message || e).slice(0, 100), bytes: 0 }
  } finally {
    tb.done()
  }
}

const results = await Promise.all(CASES.map(run))
const rows = results.map((r) => ({
  ok: r.ok, id: r.id, kind: r.kind, name: r.name, status: r.status, ms: r.ms, detail: r.detail
}))

if (process.argv.includes('--json')) {
  console.log(JSON.stringify(rows, null, 2))
} else {
  const pad = (s, n) => String(s).padEnd(n, ' ')
  console.log(pad('', 2) + pad('源', 26) + pad('类型', 7) + pad('状态', 6) + pad('耗时', 8) + '结果')
  console.log('-'.repeat(110))
  for (const r of rows) {
    console.log(pad(r.ok ? 'OK' : 'XX', 2) + pad(r.name, 26) + pad(r.kind, 7) + pad(r.status || '-', 6) + pad(r.ms + 'ms', 8) + r.detail)
  }
  const okCount = rows.filter((r) => r.ok).length
  console.log('-'.repeat(110))
  console.log(`通 ${okCount}/${rows.length}`)
}
