import { useState } from 'react'
import { motion } from 'framer-motion'
import { useStore } from '../store/useStore'
import { tr } from '../i18n'
import { VideoCard, VideoRow } from './MediaCards'
import { importVideoFiles } from '../lib/mediaImport'
import { IconFilm, IconGrid, IconList, IconSearch, IconPlus, IconFolder, IconPlay } from './icons'

// 视频库页：导入后网格/列表展示，带断点进度
export default function VideoLibrary() {
  const { videoItems, videoProgress, settings, patchSettings, addVideoItems, openVideo } = useStore()
  const lang = settings.lang
  const [busy, setBusy] = useState(false)

  const q = settings.search.trim().toLowerCase()
  let list = videoItems.filter((v) => {
    if (q && !v.name.toLowerCase().includes(q)) return false
    return true
  })
  list = [...list].sort((a, b) => {
    if (settings.sort === 'title') return a.name.localeCompare(b.name)
    return b.addedAt - a.addedAt
  })

  async function addFiles() {
    const api = (window as any).electronAPI
    if (!api) return
    setBusy(true)
    try {
      const paths: string[] = await api.openMediaFiles('video')
      if (paths.length) addVideoItems(await importVideoFiles(paths, api.mediaBaseUrl() || ''))
    } finally { setBusy(false) }
  }

  async function addDir() {
    const api = (window as any).electronAPI
    if (!api) return
    setBusy(true)
    try {
      const paths: string[] = await api.openMediaDir('video')
      if (paths.length) addVideoItems(await importVideoFiles(paths, api.mediaBaseUrl() || ''))
    } finally { setBusy(false) }
  }

  return (
    <>
      <div className='toolbar'>
        <IconFilm size={18} className='icon-btn' style={{ cursor: 'default' }} />
        <span style={{ fontWeight: 700, fontSize: 15 }}>{tr(lang, 'videoLibrary')}</span>
        <div className='seg'>
          <button className={settings.sort === 'recent' ? 'on' : ''} onClick={() => patchSettings({ sort: 'recent' })}>{tr(lang, 'recent')}</button>
          <button className={settings.sort === 'title' ? 'on' : ''} onClick={() => patchSettings({ sort: 'title' })}>{tr(lang, 'byTitle')}</button>
        </div>
        <div className='grow' />
        <input className='search' placeholder={tr(lang, 'searchVideo')}
          value={settings.search} onChange={(e) => patchSettings({ search: e.target.value })} />
        <div className='seg'>
          <button className={settings.view === 'grid' ? 'on' : ''} onClick={() => patchSettings({ view: 'grid' })}><IconGrid size={15} /></button>
          <button className={settings.view === 'list' ? 'on' : ''} onClick={() => patchSettings({ view: 'list' })}><IconList size={15} /></button>
        </div>
        <button className='btn' onClick={addDir} disabled={busy} title={tr(lang, 'scanFolder')}>
          <IconFolder size={15} /> {tr(lang, 'folder')}
        </button>
        <button className='btn accent' onClick={addFiles} disabled={busy}>
          {busy ? <span className='spin' /> : <><IconPlus size={15} /> {tr(lang, 'addVideo')}</>}
        </button>
      </div>

      <div className='home'>
        {list.length === 0 ? (
          <div className='empty'>{videoItems.length === 0 ? tr(lang, 'noVideo') : tr(lang, 'noMatch')}</div>
        ) : settings.view === 'grid' ? (
          <div className='grid vgrid'>
            {list.map((v, i) => (
              <motion.div key={v.id} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.28, delay: Math.min(i * 0.025, 0.4) }}>
                <VideoCard item={v} progress={videoProgress[v.id]?.position}
                  onPlay={() => openVideo(v.id, list.map((x) => x.id))} />
              </motion.div>
            ))}
          </div>
        ) : (
          <div className='list'>
            {list.map((v, i) => (
              <motion.div key={v.id} initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }}
                transition={{ duration: 0.25, delay: Math.min(i * 0.02, 0.3) }}>
                <VideoRow item={v} progress={videoProgress[v.id]?.position}
                  onPlay={() => openVideo(v.id, list.map((x) => x.id))} />
              </motion.div>
            ))}
          </div>
        )}
      </div>
    </>
  )
}
