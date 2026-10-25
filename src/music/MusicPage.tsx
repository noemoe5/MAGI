// 音乐页 —— foobar2000 / MusicBee 范式主容器
//
// 布局：顶栏（搜索 + 导入） / 左侧库树 / 右侧多列表格 / 底部状态栏
// 播放条不在这里，它挂在 App 层常驻（见 TransportBar）。
import { useMemo, useState } from 'react'
import { useStore } from '../store/useStore'
import { importAudioFiles } from '../lib/mediaImport'
import { fmtTime } from '../lib/util'
import { IconMusic, IconSearch, IconPlus, IconFolder, IconPlay, IconShuffle, IconGauge, IconTrash } from '../components/icons'
import LibraryTree, { type NavSel } from './LibraryTree'
import TrackTable, { type SortKey } from './TrackTable'

function dirOf(p: string): string {
  const i = Math.max(p.lastIndexOf('\\'), p.lastIndexOf('/'))
  return i > 0 ? p.slice(0, i) : p
}

export default function MusicPage() {
  const tracks = useStore((s) => s.audioTracks)
  const positions = useStore((s) => s.audioPositions)
  const currentId = useStore((s) => s.audioCurrentId)
  const playing = useStore((s) => s.audioPlaying)
  const playTrack = useStore((s) => s.playTrack)
  const addAudioTracks = useStore((s) => s.addAudioTracks)
  const removeAudioTrack = useStore((s) => s.removeAudioTrack)

  const [nav, setNav] = useState<NavSel>({ kind: 'all' })
  const [query, setQuery] = useState('')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [sortKey, setSortKey] = useState<SortKey>('idx')
  const [sortDir, setSortDir] = useState<1 | -1>(1)
  const [busy, setBusy] = useState(false)

  // 「播放过」用断点记录近似：有断点说明至少播过一次。
  // 真正的播放次数要改 store 加计数器，这里先用二值判断，够驱动「最常播放/从未播放」。
  const played = useMemo(() => {
    const set = new Set<string>()
    for (const k of Object.keys(positions)) set.add(k)
    return set
  }, [positions])
  const playCounts = useMemo(() => {
    const m: Record<string, number> = {}
    for (const t of tracks) m[t.id] = played.has(t.id) ? 1 : 0
    return m
  }, [tracks, played])

  const filtered = useMemo(() => {
    let list = tracks
    const v = nav.value || ''
    switch (nav.kind) {
      case 'artist': list = tracks.filter((t) => ((t.albumartist || t.artist || '').trim() || '未知艺术家') === v); break
      case 'album': list = tracks.filter((t) => ((t.album || '').trim() || '未知专辑') === v); break
      case 'genre': list = tracks.filter((t) => ((t.genre || '').trim() || '未知流派') === v); break
      case 'year': list = tracks.filter((t) => ((t.year || '').trim() || '未知年份') === v); break
      case 'folder': list = tracks.filter((t) => dirOf(t.path) === v); break
      case 'recent': list = [...tracks].sort((a, b) => b.addedAt - a.addedAt).slice(0, 300); break
      case 'frequent': list = tracks.filter((t) => played.has(t.id)); break
      case 'unplayed': list = tracks.filter((t) => !played.has(t.id)); break
      case 'all':
      default: break
    }
    const q = query.trim().toLowerCase()
    if (q) {
      list = list.filter((t) => [t.name, t.artist, t.album, t.albumartist, t.genre, t.year]
        .some((f) => (f || '').toLowerCase().includes(q)))
    }
    return list
  }, [tracks, nav, query, played])

  const totalDur = useMemo(() => filtered.reduce((n, t) => n + (t.duration || 0), 0), [filtered])

  async function addFiles() {
    const api = (window as any).electronAPI
    if (!api) return
    setBusy(true)
    try {
      const paths: string[] = await api.openMediaFiles('audio')
      if (paths?.length) addAudioTracks(await importAudioFiles(paths))
    } finally { setBusy(false) }
  }

  async function addDir() {
    const api = (window as any).electronAPI
    if (!api) return
    setBusy(true)
    try {
      const paths: string[] = await api.openMediaDir('audio')
      if (paths?.length) addAudioTracks(await importAudioFiles(paths))
    } finally { setBusy(false) }
  }

  const playFrom = (id: string) => playTrack(id, filtered.map((t) => t.id))
  const onSort = (k: SortKey) => {
    if (k === sortKey) setSortDir((d) => (d === 1 ? -1 : 1))
    else { setSortKey(k); setSortDir(1) }
  }

  const navLabel = (() => {
    switch (nav.kind) {
      case 'artist': return nav.value
      case 'album': return nav.value
      case 'genre': return nav.value
      case 'year': return nav.value
      case 'folder': return nav.value
      case 'recent': return '最近添加'
      case 'frequent': return '最常播放'
      case 'unplayed': return '从未播放'
      default: return '全部音乐'
    }
  })()

  return (
    <div className='mu-page'>
      <div className='mu-top'>
        <IconMusic size={16} style={{ color: 'var(--sub)' }} />
        <span className='mu-title'>音乐库</span>
        <div className='mu-search-wrap'>
          <IconSearch size={13} />
          <input className='mu-search' placeholder='搜索标题 / 艺术家 / 专辑…'
            value={query} onChange={(e) => setQuery(e.target.value)} />
        </div>
        <div className='grow' />
        <button className='mu-btn' onClick={addDir} disabled={busy} title='扫描整个文件夹'>
          {busy ? <span className='spin' /> : <IconFolder size={14} />} 文件夹
        </button>
        <button className='mu-btn accent' onClick={addFiles} disabled={busy}>
          <IconPlus size={14} /> 添加音乐
        </button>
      </div>

      <div className='mu-body'>
        <LibraryTree tracks={tracks} sel={nav} onSelect={setNav} playCounts={playCounts} />

        {filtered.length === 0 ? (
          <div className='mu-empty'>
            <IconMusic size={44} />
            <div>{tracks.length === 0 ? '曲库还是空的 —— 点右上角「文件夹」扫描本地音乐' : '当前筛选下没有曲目'}</div>
            {tracks.length === 0 && (
              <button className='mu-btn accent' onClick={addDir} disabled={busy} style={{ marginTop: 4 }}>
                <IconFolder size={14} /> 选择音乐文件夹
              </button>
            )}
          </div>
        ) : (
          <TrackTable
            tracks={filtered}
            currentId={currentId}
            playing={playing}
            selectedId={selectedId}
            sortKey={sortKey}
            sortDir={sortDir}
            onSort={onSort}
            onSelect={setSelectedId}
            onPlay={playFrom}
          />
        )}
      </div>

      <div className='mu-status'>
        <span>{navLabel}</span>
        <span>{filtered.length} 首</span>
        <span>总时长 {fmtTime(totalDur)}</span>
        <div className='grow' />
        {filtered.length > 0 && (
          <>
            <button className='mu-btn' style={{ height: 20, padding: '0 7px', fontSize: 11 }}
              onClick={() => playFrom(filtered[0].id)} title='从第一首开始播放'>
              <IconPlay size={11} /> 播放全部
            </button>
            <button className='mu-btn' style={{ height: 20, padding: '0 7px', fontSize: 11 }}
              onClick={() => {
                const shuffled = [...filtered].sort(() => Math.random() - 0.5).map((t) => t.id)
                playTrack(shuffled[0], shuffled)
              }} title='随机播放当前列表'>
              <IconShuffle size={11} /> 随机
            </button>
            {selectedId && (
              <button className='mu-btn' style={{ height: 20, padding: '0 7px', fontSize: 11 }}
                onClick={() => { removeAudioTrack(selectedId); setSelectedId(null) }}
                title='从曲库移除（不删除磁盘文件）'>
                <IconTrash size={11} /> 移除
              </button>
            )}
          </>
        )}
        <span style={{ display: 'flex', alignItems: 'center', gap: 4 }} title='无损优先显示规格'>
          <IconGauge size={11} /> {tracks.filter((t) => t.lossless).length} 首无损
        </span>
      </div>
    </div>
  )
}
