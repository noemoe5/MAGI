import { useState } from 'react'
import { motion } from 'framer-motion'
import { useStore } from '../store/useStore'
import { tr } from '../i18n'
import { AudioCard, AudioRow } from './MediaCards'
import { importAudioFiles } from '../lib/mediaImport'
import { IconMusic, IconGrid, IconList, IconSearch, IconPlus, IconFolder, IconPlay, IconQueue } from './icons'

// 音乐库页：本地音频导入（文件/文件夹）、元数据卡片、点击即播
export default function MusicLibrary() {
  const { audioTracks, settings, patchSettings, addAudioTracks, setSection, playTrack, audioCurrentId, audioPlaying } = useStore()
  const lang = settings.lang
  const [busy, setBusy] = useState(false)

  const q = settings.search.trim().toLowerCase()
  let list = audioTracks.filter((t) => {
    if (q && !(t.name.toLowerCase().includes(q) || (t.artist || '').toLowerCase().includes(q) || (t.album || '').toLowerCase().includes(q))) return false
    return true
  })
  list = [...list].sort((a, b) => {
    if (settings.sort === 'title') return a.name.localeCompare(b.name)
    if (settings.sort === 'author') return (a.artist || '').localeCompare(b.artist || '')
    return b.addedAt - a.addedAt
  })

  async function addFiles() {
    const api = (window as any).electronAPI
    if (!api) return
    setBusy(true)
    try {
      const paths: string[] = await api.openMediaFiles('audio')
      if (paths.length) addAudioTracks(await importAudioFiles(paths))
    } finally { setBusy(false) }
  }

  async function addDir() {
    const api = (window as any).electronAPI
    if (!api) return
    setBusy(true)
    try {
      const paths: string[] = await api.openMediaDir('audio')
      if (paths.length) addAudioTracks(await importAudioFiles(paths))
    } finally { setBusy(false) }
  }

  return (
    <>
      <div className='toolbar'>
        <IconMusic size={18} className='icon-btn' style={{ cursor: 'default' }} />
        <span style={{ fontWeight: 700, fontSize: 15 }}>{tr(lang, 'musicLibrary')}</span>
        <div className='seg'>
          <button className={settings.sort === 'recent' ? 'on' : ''} onClick={() => patchSettings({ sort: 'recent' })}>{tr(lang, 'recent')}</button>
          <button className={settings.sort === 'title' ? 'on' : ''} onClick={() => patchSettings({ sort: 'title' })}>{tr(lang, 'byTitle')}</button>
          <button className={settings.sort === 'author' ? 'on' : ''} onClick={() => patchSettings({ sort: 'author' })}>{tr(lang, 'byArtist')}</button>
        </div>
        <div className='grow' />
        <input className='search' placeholder={tr(lang, 'searchMusic')}
          value={settings.search} onChange={(e) => patchSettings({ search: e.target.value })} />
        <div className='seg'>
          <button className={settings.view === 'grid' ? 'on' : ''} onClick={() => patchSettings({ view: 'grid' })}><IconGrid size={15} /></button>
          <button className={settings.view === 'list' ? 'on' : ''} onClick={() => patchSettings({ view: 'list' })}><IconList size={15} /></button>
        </div>
        <button className='btn' onClick={addDir} disabled={busy} title={tr(lang, 'scanFolder')}>
          <IconFolder size={15} /> {tr(lang, 'folder')}
        </button>
        <button className='btn accent' onClick={addFiles} disabled={busy}>
          {busy ? <span className='spin' /> : <><IconPlus size={15} /> {tr(lang, 'addMusic')}</>}
        </button>
      </div>

      {list.length > 0 && (
        <div className='media-hero'>
          <button className='media-hero-btn' onClick={() => playTrack(list[0].id, list.map((t) => t.id))}>
            <IconPlay size={16} /> {tr(lang, 'playAll')}
          </button>
          <button className='media-hero-btn ghost' onClick={() => {
            const ids = [...list].reverse().map((t) => t.id)
            playTrack(ids[0], ids)
          }}>
            <IconQueue size={16} /> {tr(lang, 'playReverse')}
          </button>
          <span className='media-hero-meta'>
            {audioTracks.length} {tr(lang, 'tracks')}
            {audioCurrentId && audioPlaying ? ` · ${tr(lang, 'playingNow')}` : ''}
          </span>
        </div>
      )}

      <div className='home'>
        {list.length === 0 ? (
          <div className='empty'>{audioTracks.length === 0 ? tr(lang, 'noMusic') : tr(lang, 'noMatch')}</div>
        ) : settings.view === 'grid' ? (
          <div className='grid mgrid'>
            {list.map((t, i) => (
              <motion.div key={t.id} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.28, delay: Math.min(i * 0.025, 0.4) }}>
                <AudioCard track={t} playing={t.id === audioCurrentId && audioPlaying}
                  onPlay={() => playTrack(t.id, list.map((x) => x.id))} />
              </motion.div>
            ))}
          </div>
        ) : (
          <div className='list'>
            {list.map((t, i) => (
              <motion.div key={t.id} initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }}
                transition={{ duration: 0.25, delay: Math.min(i * 0.02, 0.3) }}>
                <AudioRow track={t} playing={t.id === audioCurrentId && audioPlaying}
                  onPlay={() => playTrack(t.id, list.map((x) => x.id))} />
              </motion.div>
            ))}
          </div>
        )}
      </div>
    </>
  )
}
