// 曲目表格 —— foobar2000 的「列 + 可排序 + 双击播放」范式
//
// 列宽用 CSS 变量一次写到容器上，表头和行共用同一套宽度，滚动时不会错位。
import { useMemo, useRef } from 'react'
import type { AudioTrack } from '../types'
import { fmtTime } from '../lib/util'

export type SortKey = 'idx' | 'name' | 'artist' | 'album' | 'year' | 'duration' | 'spec'

/** 规格串：foobar 风格把容器/编码和采样规格压在一列里，扫一眼就能看出是不是无损 */
export function specOf(t: AudioTrack): string {
  const codec = (t.codec || t.container || '').toUpperCase()
  const parts: string[] = []
  if (codec) parts.push(codec)
  if (t.sampleRate) parts.push(`${(t.sampleRate / 1000).toFixed(t.sampleRate % 1000 ? 1 : 0)}k`)
  if (t.bitsPerSample) parts.push(`${t.bitsPerSample}bit`)
  if (t.channels && t.channels > 2) parts.push(`${t.channels}ch`)
  return parts.join(' ')
}

interface Col { key: SortKey; label: string; width?: number; flex?: boolean; align?: 'num' | 'center' | 'dur' }

const COLS: Col[] = [
  { key: 'idx', label: '#', width: 44, align: 'num' },
  { key: 'name', label: '标题', flex: true },
  { key: 'artist', label: '艺术家', width: 148 },
  { key: 'album', label: '专辑', width: 168 },
  { key: 'year', label: '年份', width: 54, align: 'center' },
  { key: 'duration', label: '时长', width: 56, align: 'dur' },
  { key: 'spec', label: '规格', width: 112 }
]

interface Props {
  tracks: AudioTrack[]
  currentId: string | null
  playing: boolean
  selectedId: string | null
  sortKey: SortKey
  sortDir: 1 | -1
  onSort: (k: SortKey) => void
  onSelect: (id: string) => void
  onPlay: (id: string) => void
}

export default function TrackTable({
  tracks, currentId, playing, selectedId, sortKey, sortDir, onSort, onSelect, onPlay
}: Props) {
  const rowsRef = useRef<HTMLDivElement>(null)

  // 表头与行共用宽度：flex 列用 flex:1，定宽列用固定 px
  const styleOf = (c: Col): React.CSSProperties =>
    c.flex ? { flex: 1, minWidth: 120 } : { flex: `0 0 ${c.width}px`, width: c.width }

  const sorted = useMemo(() => {
    const arr = [...tracks]
    const dir = sortDir
    const cmpStr = (a?: string, b?: string) => (a || '').localeCompare(b || '', 'zh-Hans-CN')
    arr.sort((a, b) => {
      switch (sortKey) {
        case 'name': return cmpStr(a.name, b.name) * dir
        case 'artist': return cmpStr(a.albumartist || a.artist, b.albumartist || b.artist) * dir
        case 'album': return cmpStr(a.album, b.album) * dir
        case 'year': return cmpStr(a.year, b.year) * dir
        case 'duration': return ((a.duration || 0) - (b.duration || 0)) * dir
        case 'spec': return cmpStr(specOf(a), specOf(b)) * dir
        case 'idx':
        default:
          // # 列默认按「专辑内曲序」排，这是 foobar 的默认视图语义
          return ((a.track || 0) - (b.track || 0)) * dir || cmpStr(a.name, b.name)
      }
    })
    return arr
  }, [tracks, sortKey, sortDir])

  return (
    <div className='mu-main'>
      <div className='mu-cols'>
        {COLS.map((c) => {
          const on = sortKey === c.key
          return (
            <div key={c.key}
              className={`mu-col ${c.align || ''} ${on ? 'on' : ''} sortable`}
              style={styleOf(c)}
              onClick={() => onSort(c.key)}>
              <span>{c.label}</span>
              {on && <span className='arrow'>{sortDir > 0 ? '▲' : '▼'}</span>}
            </div>
          )
        })}
      </div>

      <div className='mu-rows' ref={rowsRef}>
        {sorted.map((t, i) => {
          const isCur = t.id === currentId
          return (
            <div key={t.id}
              className={`mu-row ${t.id === selectedId ? 'sel' : ''} ${isCur ? 'playing' : ''}`}
              onMouseDown={() => onSelect(t.id)}
              onDoubleClick={() => onPlay(t.id)}>
              <div className='mu-cell idx num' style={styleOf(COLS[0])}>
                {isCur && playing ? '▶' : (t.track || (i + 1))}
              </div>
              <div className='mu-cell' style={styleOf(COLS[1])} title={t.name}>{t.name}</div>
              <div className='mu-cell' style={styleOf(COLS[2])} title={t.albumartist || t.artist || ''}>
                {t.albumartist || t.artist || <span className='dim'>—</span>}
              </div>
              <div className='mu-cell' style={styleOf(COLS[3])} title={t.album || ''}>
                {t.album || <span className='dim'>—</span>}
              </div>
              <div className='mu-cell center' style={styleOf(COLS[4])}>{t.year || <span className='dim'>—</span>}</div>
              <div className='mu-cell dur' style={styleOf(COLS[5])}>{fmtTime(t.duration || 0)}</div>
              <div className='mu-cell' style={styleOf(COLS[6])}>
                <span className='dim'>{specOf(t) || '—'}</span>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
