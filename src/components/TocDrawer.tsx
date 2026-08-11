import { motion } from 'framer-motion'
import { useStore } from '../store/useStore'
import { tr } from '../i18n'
import { IconClose } from './icons'

interface TocNode { label: string; href: string; level: number }

export default function TocDrawer({ toc, onJump }: { toc: TocNode[]; onJump: (href: string) => void }) {
  const lang = useStore((s) => s.settings.lang)
  const close = () => useStore.getState().setTocOpen(false)
  return (
    <>
      <motion.div className='drawer-scrim' initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
        onClick={close} />
      <motion.div className='drawer left' initial={{ x: '-100%' }} animate={{ x: 0 }} exit={{ x: '-100%' }}
        transition={{ type: 'tween', duration: 0.32, ease: [0.22, 1, 0.36, 1] }}>
        <div className='drawer-head'>
          <span style={{ flex: 1 }}>{tr(lang, 'toc')}</span>
          <button className='icon-btn' onClick={close}><IconClose size={16} /></button>
        </div>
        <div className='drawer-body'>
          {toc.map((n, i) => (
            <div key={i} className={`toc-item lvl${Math.min(n.level, 3)}`} onClick={() => onJump(n.href)}>
              {n.label}
            </div>
          ))}
          {toc.length === 0 && <div className='empty'>{tr(lang, 'noBooks')}</div>}
        </div>
      </motion.div>
    </>
  )
}
