// 内置音乐通道：iTunes Search API（无需 Key，返回 30 秒官方试听片段）。
// 试听流是正版授权片段，可直接喂给现有播放引擎（path 支持 http 直链）。
import type { AudioTrack } from '../../types'
import type { SourceHit, SourceProvider } from '../types'
import { getJSON } from '../http'

interface ITunesTrack {
  trackId: number
  trackName: string
  artistName: string
  collectionName?: string
  artworkUrl100?: string
  previewUrl?: string
  releaseDate?: string
  trackTimeMillis?: number
  primaryGenreName?: string
  country?: string
}

const toHit = (t: ITunesTrack): SourceHit => ({
  id: `itunes:${t.trackId}`,
  sourceId: 'itunes',
  sourceName: 'iTunes Preview',
  kind: 'music',
  nativeId: String(t.trackId),
  title: t.trackName,
  subtitle: [t.artistName, t.collectionName].filter(Boolean).join(' — '),
  cover: t.artworkUrl100?.replace('100x100', '400x400'),
  year: t.releaseDate ? t.releaseDate.slice(0, 4) : undefined,
  badge: '30s 试听',
  playUrl: t.previewUrl,
  openUrl: `https://music.apple.com/search?term=${encodeURIComponent(`${t.artistName} ${t.trackName}`)}`,
  meta: {
    专辑: t.collectionName,
    流派: t.primaryGenreName,
    时长: t.trackTimeMillis ? `${Math.round(t.trackTimeMillis / 1000)}s` : undefined
  }
})

export const itunesSource: SourceProvider = {
  id: 'itunes',
  name: 'iTunes 试听',
  kinds: ['music'],
  note: 'Apple 官方 30 秒试听片段，可直接进播放队列',
  homepage: 'https://performance-partners.apple.com/search-api',
  builtin: true,

  async search({ query }) {
    if (!query.trim()) return []
    const url = `https://itunes.apple.com/search?term=${encodeURIComponent(query)}&media=music&entity=song&limit=25&country=cn`
    const data = await getJSON<{ results?: ITunesTrack[] }>(url)
    return (data.results ?? []).filter((t) => t.previewUrl).map(toHit)
  }
}

/** 把音乐源命中项转成播放引擎认识的 AudioTrack（path 直接用 http 直链） */
export function hitToTrack(hit: SourceHit): AudioTrack | null {
  if (!hit.playUrl) return null
  return {
    id: hit.id,
    path: hit.playUrl,
    name: hit.title,
    artist: hit.subtitle?.split(' — ')[0],
    album: hit.meta?.专辑 as string | undefined,
    duration: 30,
    cover: hit.cover,
    addedAt: Date.now(),
    container: 'remote'
  }
}
