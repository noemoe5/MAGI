import { useState } from 'react'
import { AudioTrack, VideoItem } from '../types'
import { useStore } from '../store/useStore'
import { tr } from '../i18n'
import { IconPlay, IconTrash, IconFilm, IconMusic } from './icons'
import { placeholderCover, fmtTime, mediaUrl } from '../lib/util'

// —— 音频卡片（网格）——
export function AudioCard({ track, onPlay, playing }: { track: AudioTrack; onPlay: () => void; playing: boolean }) {
  const removeAudioTrack = useStore((s) => s.removeAudioTrack)
  const lang = useStore((s) => s.settings.lang)
  const [confirm, setConfirm] = useState(false)
  const cover = track.cover || placeholderCover(track.name)
  return (
    <div className={`card mcard ${playing ? 'mcard-on' : ''}`} onDoubleClick={onPlay}>
      <div className='mcard-cover-wrap'>
        <img className='cover' src={cover} alt={track.name} draggable={false} onClick={onPlay} />
        <button className='mcard-play' onClick={onPlay} title={tr(lang, 'play')}><IconPlay size={18} /></button>
        <button className='del' title={tr(lang, 'delete')}
          onClick={(e) => { e.stopPropagation(); setConfirm(true) }}>
          <IconTrash size={15} />
        </button>
      </div>
      <div className='meta'>
        <div className='name'>{track.name}</div>
        <div className='author'>{track.artist || tr(lang, 'unknownArtist')}</div>
        <div className='mcard-foot'>
          <span>{fmtTime(track.duration)}</span>
          {track.lossless && <em className='tag-hires'>{track.bitsPerSample ? `${track.bitsPerSample}bit` : 'Hi-Res'}</em>}
        </div>
      </div>
      {confirm && (
        <div className='del-confirm' onClick={(e) => { e.stopPropagation(); setConfirm(false) }}>
          <div className='del-text'>{tr(lang, 'confirmRemoveTrack')}</div>
          <div className='del-actions'>
            <button onClick={(e) => { e.stopPropagation(); setConfirm(false) }}>{tr(lang, 'cancel')}</button>
            <button className='danger' onClick={(e) => { e.stopPropagation(); removeAudioTrack(track.id) }}>{tr(lang, 'delete')}</button>
          </div>
        </div>
      )}
    </div>
  )
}

// —— 音频行（列表）——
export function AudioRow({ track, onPlay, playing }: { track: AudioTrack; onPlay: () => void; playing: boolean }) {
  const removeAudioTrack = useStore((s) => s.removeAudioTrack)
  const lang = useStore((s) => s.settings.lang)
  const [confirm, setConfirm] = useState(false)
  return (
    <div className={`row mrow ${playing ? 'mrow-on' : ''}`} onDoubleClick={onPlay}>
      <img className='thumb' src={track.cover || placeholderCover(track.name)} alt='' draggable={false} onClick={onPlay} />
      <div className='info' onClick={onPlay}>
        <div className='n'>{track.name}</div>
        <div className='a'>{[track.artist, track.album].filter(Boolean).join(' · ') || '—'}</div>
      </div>
      {track.lossless && <em className='tag-hires'>{track.bitsPerSample ? `${track.bitsPerSample}bit` : 'Hi-Res'}</em>}
      <span className='mrow-dur'>{fmtTime(track.duration)}</span>
      <button className='icon-btn' title={tr(lang, 'delete')} onClick={() => setConfirm(true)}>
        <IconTrash size={16} />
      </button>
      <button className='icon-btn accent' title={tr(lang, 'play')} onClick={onPlay}><IconPlay size={16} /></button>
      {confirm && (
        <div className='del-confirm' onClick={(e) => { e.stopPropagation(); setConfirm(false) }}>
          <div className='del-text'>{tr(lang, 'confirmRemoveTrack')}</div>
          <div className='del-actions'>
            <button onClick={(e) => { e.stopPropagation(); setConfirm(false) }}>{tr(lang, 'cancel')}</button>
            <button className='danger' onClick={(e) => { e.stopPropagation(); removeAudioTrack(track.id) }}>{tr(lang, 'delete')}</button>
          </div>
        </div>
      )}
    </div>
  )
}

// —— 视频卡片（网格）——
export function VideoCard({ item, onPlay, progress }: { item: VideoItem; onPlay: () => void; progress?: number }) {
  const removeVideoItem = useStore((s) => s.removeVideoItem)
  const lang = useStore((s) => s.settings.lang)
  const [confirm, setConfirm] = useState(false)
  const pct = progress && item.duration ? Math.min(100, (progress / item.duration) * 100) : 0
  return (
    <div className='card mcard vcard' onDoubleClick={onPlay}>
      <div className='mcard-cover-wrap'>
        <div className='vcard-thumb' onClick={onPlay}>
          <IconFilm size={30} />
          <span className='vcard-dur'>{fmtTime(item.duration)}</span>
          {pct > 0 && <div className='vcard-pbar'><i style={{ width: pct + '%' }} /></div>}
        </div>
        <button className='mcard-play' onClick={onPlay} title={tr(lang, 'play')}><IconPlay size={18} /></button>
        <button className='del' title={tr(lang, 'delete')}
          onClick={(e) => { e.stopPropagation(); setConfirm(true) }}>
          <IconTrash size={15} />
        </button>
      </div>
      <div className='meta'>
        <div className='name'>{item.name}</div>
        <div className='author'>
          {item.width ? `${item.width}×${item.height}` : ''}{item.width && pct > 0 ? ' · ' : ''}
          {pct > 0 ? `${tr(lang, 'watched')} ${Math.round(pct)}%` : ''}
        </div>
      </div>
      {confirm && (
        <div className='del-confirm' onClick={(e) => { e.stopPropagation(); setConfirm(false) }}>
          <div className='del-text'>{tr(lang, 'confirmRemoveVideo')}</div>
          <div className='del-actions'>
            <button onClick={(e) => { e.stopPropagation(); setConfirm(false) }}>{tr(lang, 'cancel')}</button>
            <button className='danger' onClick={(e) => { e.stopPropagation(); removeVideoItem(item.id) }}>{tr(lang, 'delete')}</button>
          </div>
        </div>
      )}
    </div>
  )
}

// —— 视频行（列表）——
export function VideoRow({ item, onPlay, progress }: { item: VideoItem; onPlay: () => void; progress?: number }) {
  const removeVideoItem = useStore((s) => s.removeVideoItem)
  const lang = useStore((s) => s.settings.lang)
  const [confirm, setConfirm] = useState(false)
  const pct = progress && item.duration ? Math.min(100, (progress / item.duration) * 100) : 0
  return (
    <div className='row mrow' onDoubleClick={onPlay}>
      <div className='vrow-thumb' onClick={onPlay}>
        <IconFilm size={20} />
        <span>{fmtTime(item.duration)}</span>
      </div>
      <div className='info' onClick={onPlay}>
        <div className='n'>{item.name}</div>
        <div className='a'>{item.width ? `${item.width}×${item.height}` : '—'}{pct > 0 ? ` · ${tr(lang, 'watched')} ${Math.round(pct)}%` : ''}</div>
      </div>
      <div className='pbar'><i style={{ width: pct + '%' }} /></div>
      <button className='icon-btn' title={tr(lang, 'delete')} onClick={() => setConfirm(true)}>
        <IconTrash size={16} />
      </button>
      <button className='icon-btn accent' title={tr(lang, 'play')} onClick={onPlay}><IconPlay size={16} /></button>
      {confirm && (
        <div className='del-confirm' onClick={(e) => { e.stopPropagation(); setConfirm(false) }}>
          <div className='del-text'>{tr(lang, 'confirmRemoveVideo')}</div>
          <div className='del-actions'>
            <button onClick={(e) => { e.stopPropagation(); setConfirm(false) }}>{tr(lang, 'cancel')}</button>
            <button className='danger' onClick={(e) => { e.stopPropagation(); removeVideoItem(item.id) }}>{tr(lang, 'delete')}</button>
          </div>
        </div>
      )}
    </div>
  )
}
