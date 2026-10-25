// 音乐库左侧导航树 —— foobar2000 / MusicBee 的「媒体库 + 播放列表」两段式
//
// 所有分组都从曲目数据实时聚合，不额外维护索引：曲库是几千首量级，
// 一次 groupBy 的开销远小于维护增量索引的复杂度。
import { useMemo, useState } from 'react'
import type { AudioTrack } from '../types'
import { IconChevron, IconMusic, IconFolder, IconQueue, IconTag } from '../components/icons'

export type NavKind =
  | 'all' | 'recent' | 'frequent' | 'unplayed'
  | 'artist' | 'album' | 'genre' | 'year' | 'folder'

export interface NavSel { kind: NavKind; value?: string }

interface Props {
  tracks: AudioTrack[]
  sel: NavSel
  onSelect: (s: NavSel) => void
  playCounts: Record<string, number>
}

interface Entry { value: string; label: string; count: number }

const ALBUM_UNKNOWN = '未知专辑'
const ARTIST_UNKNOWN = '未知艺术家'
const GENRE_UNKNOWN = '未知流派'
const YEAR_UNKNOWN = '未知年份'

function groupBy(tracks: AudioTrack[], pick: (t: AudioTrack) => string | undefined, fallback: string): Entry[] {
  const map = new Map<string, number>()
  for (const t of tracks) {
    const k = (pick(t) || '').trim() || fallback
    map.set(k, (map.get(k) || 0) + 1)
  }
  return [...map.entries()]
    .map(([value, count]) => ({ value, label: value, count }))
    .sort((a, b) => a.label.localeCompare(b.label, 'zh-Hans-CN'))
}

/** path → 所在目录（foobar 的「文件夹」视图就是按目录分组） */
function dirOf(p: string): string {
  const i = Math.max(p.lastIndexOf('\\'), p.lastIndexOf('/'))
  return i > 0 ? p.slice(0, i) : p
}

export default function LibraryTree({ tracks, sel, onSelect, playCounts }: Props) {
  const [open, setOpen] = useState<Record<string, boolean>>({ artist: false, album: false, genre: false, year: false, folder: false })

  const groups = useMemo(() => ({
    artist: groupBy(tracks, (t) => t.albumartist || t.artist, ARTIST_UNKNOWN),
    album: groupBy(tracks, (t) => t.album, ALBUM_UNKNOWN),
    genre: groupBy(tracks, (t) => t.genre, GENRE_UNKNOWN),
    year: groupBy(tracks, (t) => t.year, YEAR_UNKNOWN).sort((a, b) => b.label.localeCompare(a.label)),
    folder: groupBy(tracks, (t) => dirOf(t.path), '')
  }), [tracks])

  const counts = useMemo(() => {
    let played = 0, unplayed = 0
    for (const t of tracks) {
      if ((playCounts[t.id] || 0) > 0) played++
      else unplayed++
    }
    return { played, unplayed }
  }, [tracks, playCounts])

  const toggle = (k: string) => setOpen((o) => ({ ...o, [k]: !o[k] }))
  const isOn = (kind: NavKind, value?: string) => sel.kind === kind && (sel.value || '') === (value || '')

  const Item = ({ kind, value, label, count, title }: { kind: NavKind; value?: string; label: string; count?: number; title?: string }) => (
    <button className={`mu-tree-item ${isOn(kind, value) ? 'on' : ''}`}
      onClick={() => onSelect({ kind, value })} title={title || label}>
      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{label}</span>
      {count != null && <span className='cnt'>{count}</span>}
    </button>
  )

  const Group = ({
    id, label, icon, items, kind
  }: { id: string; label: string; icon: React.ReactNode; items: Entry[]; kind: NavKind }) => (
    <div className='mu-tree-group'>
      <button className='mu-tree-head' onClick={() => toggle(id)}>
        <span className={`caret ${open[id] ? 'open' : ''}`}><IconChevron size={11} /></span>
        {icon}
        <span>{label}</span>
        <span className='cnt'>{items.length}</span>
      </button>
      {open[id] && (
        items.length === 0
          ? <div className='mu-tree-empty'>—</div>
          : items.map((it) => (
            <Item key={it.value} kind={kind} value={it.value} label={it.label} count={it.count} title={it.label} />
          ))
      )}
    </div>
  )

  return (
    <aside className='mu-tree'>
      <div className='mu-tree-group'>
        <button className='mu-tree-head' style={{ cursor: 'default' }}>
          <span style={{ width: 11 }} />
          <IconMusic size={11} />
          <span>{'媒体库'}</span>
        </button>
        <Item kind='all' label={'全部音乐'} count={tracks.length} />
        <Item kind='recent' label={'最近添加'} />
      </div>

      <Group id='artist' label={'艺术家'} icon={<IconTag size={11} />} items={groups.artist} kind='artist' />
      <Group id='album' label={'专辑'} icon={<IconQueue size={11} />} items={groups.album} kind='album' />
      <Group id='genre' label={'流派'} icon={<IconTag size={11} />} items={groups.genre} kind='genre' />
      <Group id='year' label={'年份'} icon={<IconTag size={11} />} items={groups.year} kind='year' />
      <Group id='folder' label={'文件夹'} icon={<IconFolder size={11} />} items={groups.folder} kind='folder' />

      <div className='mu-tree-group'>
        <button className='mu-tree-head' style={{ cursor: 'default' }}>
          <span style={{ width: 11 }} />
          <IconQueue size={11} />
          <span>{'播放列表'}</span>
        </button>
        <Item kind='frequent' label={'最常播放'} count={counts.played} />
        <Item kind='unplayed' label={'从未播放'} count={counts.unplayed} />
      </div>
    </aside>
  )
}
