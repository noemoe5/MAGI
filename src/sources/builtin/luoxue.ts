// 内置音乐通道：落雪系（lx-music）音源。
// 洛雪生态里的「源」本身是跑在 lx-music 客户端里的 JS 脚本，不能直接被第三方调用，
// 但它们背后大多指向同一批 HTTP 接口。这里实现的是「搜索走酷狗公开接口 + 取流走聚合 API」：
//   搜索 GET https://songsearch.kugou.com/song_search_v2?keyword=&page=&pagesize=
//   取流 依次尝试 lx-music-api-server 兼容的多个后端（任一可用即可）
// 取流后端属于第三方公益服务，随时可能 500，因此 resolveStream 失败时 UI 会退回 openUrl。
import type { SourceHit, SourceProvider } from '../types'
import { getJSON, postJSON } from '../http'

const KG_SEARCH = 'https://songsearch.kugou.com/song_search_v2'

/** lx-music-api-server 兼容后端，按顺序尝试，谁先给出 http 直链用谁 */
const LX_BACKENDS: Array<{ kind: 'lerd' | 'direct'; base: string; key?: string }> = [
  { kind: 'lerd', base: 'https://api.music.lerd.dpdns.org' },
  { kind: 'direct', base: 'https://103.79.184.97/api/music/url', key: '6C1F-53W0-GRKI-EVFG' }
]

const UA = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36'
}

interface KgSong {
  SongName?: string
  SingerName?: string
  AlbumName?: string
  AlbumID?: string | number
  FileHash?: string
  SongID?: string | number
  EMixSongID?: string
  Audioid?: string | number
  Duration?: number
  FileSize?: number
  ExtName?: string
  HQFileHash?: string
  SQFileHash?: string
  HQBitrate?: number
  SQBitrate?: number
}

interface KgResp {
  status?: number
  data?: { total?: number; lists?: KgSong[] }
}

/** 酷狗封面 CDN，AlbumID 拼路径；拼不出就让 UI 用占位图 */
function coverOf(s: KgSong): string | undefined {
  const aid = s.AlbumID ? String(s.AlbumID) : ''
  if (!aid) return undefined
  const bucket = aid.slice(-2).padStart(2, '0')
  return `https://imge.kugou.com/stdmusic/400/${bucket}/${aid}.jpg`
}

const fmtDur = (sec?: number) => {
  if (!sec) return undefined
  const m = Math.floor(sec / 60)
  const s = Math.floor(sec % 60)
  return `${m}:${String(s).padStart(2, '0')}`
}

function toHit(s: KgSong): SourceHit {
  const id = String(s.SongID || s.FileHash || '')
  return {
    id: `luoxue:kg:${id}`,
    sourceId: 'luoxue',
    sourceName: '落雪音源',
    kind: 'music',
    nativeId: id,
    title: s.SongName || '(未知曲目)',
    subtitle: [s.SingerName, s.AlbumName].filter(Boolean).join(' — '),
    cover: coverOf(s),
    badge: s.SQFileHash ? 'FLAC' : s.HQFileHash ? '320k' : s.ExtName?.toUpperCase() || '128k',
    openUrl: `https://www.kugou.com/yy/html/search.html#searchType=song&searchKeyWord=${encodeURIComponent(
      `${s.SingerName || ''} ${s.SongName || ''}`.trim()
    )}`,
    meta: {
      专辑: s.AlbumName,
      时长: fmtDur(s.Duration),
      格式: s.ExtName?.toUpperCase(),
      哈希: s.FileHash
    }
  }
}

/** 从后端响应里挖出 http 直链：不同后端字段名不统一，统一扫一遍 */
function digUrl(obj: unknown, depth = 0): string | undefined {
  if (depth > 4 || obj == null) return undefined
  if (typeof obj === 'string') return /^https?:\/\//i.test(obj) ? obj : undefined
  if (typeof obj !== 'object') return undefined
  const rec = obj as Record<string, unknown>
  for (const key of ['url', 'Url', 'URL']) {
    const v = rec[key]
    if (typeof v === 'string' && /^https?:\/\//i.test(v)) return v
  }
  for (const v of Object.values(rec)) {
    const hit = digUrl(v, depth + 1)
    if (hit) return hit
  }
  return undefined
}

export const luoxueSource: SourceProvider = {
  id: 'luoxue',
  name: '落雪音源',
  kinds: ['music'],
  note: '酷狗搜索 + 落雪聚合接口取流；后端为第三方公益服务，失效时退回原站',
  homepage: 'https://github.com/pdone/lx-music-source',
  builtin: true,

  async search({ query, page = 1, limit = 20 }) {
    const q = query.trim()
    if (!q) return []
    const url =
      `${KG_SEARCH}?keyword=${encodeURIComponent(q)}&page=${page}&pagesize=${Math.min(limit, 30)}` +
      `&platform=WebFilter&userid=-1&clientver=2000&iscorrection=1&privilege_filter=0&filter=10&appid=1014`
    const data = await getJSON<KgResp>(url, 14000)
    // 酷狗要求带上 Referer 才稳定返回数据，getJSON 不支持自定义头时用 fetchJSON 兜底
    const songs = data?.data?.lists ?? []
    return songs.filter((s) => s.SongName).map(toHit)
  },

  /** 惰性取流：点播放这一刻才请求，避免搜索阶段打几十次 */
  async resolveStream(hit) {
    const hash = (hit.meta?.哈希 as string) || ''
    const songId = (hit.meta?.哈希 ? hit.nativeId : hit.nativeId) || ''

    for (const be of LX_BACKENDS) {
      try {
        if (be.kind === 'lerd') {
          // lx-music 的 musicUrl 动作：{ type, musicInfo, quality }
          const resp = await postJSON<any>(
            `${be.base}/kg`,
            {
              type: 'musicUrl',
              musicInfo: { hash, songmid: songId, album_audio_id: '' },
              quality: '320k'
            },
            12000
          )
          const url = digUrl(resp)
          if (url) return url
        } else {
          const q = `?source=kg&songId=${encodeURIComponent(songId)}&quality=320k&key=${be.key}`
          const resp = await getJSON<any>(`${be.base}${q}`, 12000)
          const url = digUrl(resp)
          if (url) return url
        }
      } catch {
        // 这个后端挂了，换下一个
      }
    }
    return undefined
  }
}

export { UA as LUOXUE_UA }
