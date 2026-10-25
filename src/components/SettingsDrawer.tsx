import { motion } from 'framer-motion'
import { useStore } from '../store/useStore'
import { THEMES, ACCENTS } from '../theme/themes'
import { tr, availableLanguages, openLanguageDir } from '../i18n'
import { IconClose } from './icons'
import { ThemeName } from '../types'

const THEME_KEYS: ThemeName[] = ['light', 'dark', 'sepia', 'green', 'black', 'eye', 'pink', 'blue', 'gray']
const THEME_LABELS: Record<ThemeName, string> = {
  light: '浅色', dark: '暗色', sepia: '护眼棕', green: '绿', black: '纯黑', eye: '护眼绿', pink: '粉', blue: '蓝', gray: '灰'
}

export default function SettingsDrawer() {
  const { settings, setTheme, setAccent, setLang, patchSettings, setSettingsOpen } = useStore()
  const lang = settings.lang
  const close = () => setSettingsOpen(false)

  return (
    <>
      <motion.div className='drawer-scrim' initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={close} />
      <motion.div className='drawer' initial={{ x: '100%' }} animate={{ x: 0 }} exit={{ x: '100%' }}
        transition={{ type: 'tween', duration: 0.32, ease: [0.22, 1, 0.36, 1] }}>
        <div className='drawer-head'>
          <span style={{ flex: 1 }}>{tr(lang, 'settings')}</span>
          <button className='icon-btn' onClick={close}><IconClose size={16} /></button>
        </div>
        <div className='drawer-body'>
          <div className='section'>
            <label>{tr(lang, 'theme')}</label>
            <div className='theme-grid'>
              {THEME_KEYS.map((t) => (
                <div key={t} className={`theme-chip ${settings.theme === t ? 'sel' : ''}`}
                  style={{ background: THEMES[t].panel2, borderColor: THEMES[t].border }}
                  title={THEME_LABELS[t]} onClick={() => setTheme(t)} />
              ))}
            </div>
          </div>

          <div className='section'>
            <label>{tr(lang, 'accent')}</label>
            <div className='accent-grid'>
              {ACCENTS.map((a) => (
                <div key={a.value} className={`accent-dot ${settings.accent === a.value ? 'sel' : ''}`}
                  style={{ background: a.value }} title={a.label[lang] ?? a.label.en}
                  onClick={() => setAccent(a.value)} />
              ))}
            </div>
          </div>

          <div className='section'>
            <label>{tr(lang, 'language')}</label>
            <div className='seg' style={{ width: '100%', flexWrap: 'wrap' }}>
              {availableLanguages().map((l) => (
                <button key={l.code} style={{ flex: '1 1 40%' }}
                  className={settings.lang === l.code ? 'on' : ''}
                  title={l.builtin ? l.name : `${l.name}（${l.code}）· 外部语言包`}
                  onClick={() => setLang(l.code)}>{l.name}</button>
              ))}
            </div>
            <button
              style={{
                marginTop: 6, width: '100%', background: 'transparent', borderRadius: 8,
                border: '1px dashed currentColor', opacity: 0.75, padding: '6px 8px',
                fontSize: 12, color: 'inherit', cursor: 'pointer'
              }}
              onClick={() => void openLanguageDir()}>{tr(lang, 'langOpenDir')}</button>
          </div>

          <div className='section'>
            <label>{tr(lang, 'readerMode')}</label>
            <div className='seg' style={{ width: '100%' }}>
              <button style={{ flex: 1 }} className={settings.readerMode === 'vertical' ? 'on' : ''} onClick={() => patchSettings({ readerMode: 'vertical' })}>{tr(lang, 'modeVertical')}</button>
              <button style={{ flex: 1 }} className={settings.readerMode === 'horizontal' ? 'on' : ''} onClick={() => patchSettings({ readerMode: 'horizontal' })}>{tr(lang, 'modeHorizontal')}</button>
            </div>
          </div>

          <div className='section'>
            <label>{tr(lang, 'readingSettings')}</label>
            <div className='field'><span style={{ width: 60 }}>{tr(lang, 'fontSize')}</span>
              <input type='range' min={12} max={32} value={settings.fontSize}
                onChange={(e) => patchSettings({ fontSize: +e.target.value })} /></div>
            <div className='field'><span style={{ width: 60 }}>{tr(lang, 'lineHeight')}</span>
              <input type='range' min={1.2} max={2.4} step={0.1} value={settings.lineHeight}
                onChange={(e) => patchSettings({ lineHeight: +e.target.value })} /></div>
          </div>

          <div className='section'>
            <label>{tr(lang, 'ttsTitle')}</label>
            <div className='field'><span style={{ width: 90 }}>{tr(lang, 'ttsEnabled')}</span>
              <div className={`sw ${settings.tts.enabled ? 'on' : ''}`} onClick={() => patchSettings({ tts: { ...settings.tts, enabled: !settings.tts.enabled } })} /></div>
            <div className='field'><span style={{ width: 90 }}>{tr(lang, 'ttsBaseUrl')}</span>
              <input type='text' value={settings.tts.baseUrl} onChange={(e) => patchSettings({ tts: { ...settings.tts, baseUrl: e.target.value } })} /></div>
            <div className='field'><span style={{ width: 90 }}>{tr(lang, 'ttsRefAudio')}</span>
              <input type='text' value={settings.tts.refAudioPath} onChange={(e) => patchSettings({ tts: { ...settings.tts, refAudioPath: e.target.value } })} /></div>
            <div className='field'><span style={{ width: 90 }}>{tr(lang, 'ttsPrompt')}</span>
              <input type='text' value={settings.tts.promptText} onChange={(e) => patchSettings({ tts: { ...settings.tts, promptText: e.target.value } })} /></div>
            <div className='field'><span style={{ width: 90 }}>{tr(lang, 'ttsTextLang')}</span>
              <input type='text' value={settings.tts.textLang} onChange={(e) => patchSettings({ tts: { ...settings.tts, textLang: e.target.value } })} /></div>
            <div className='field'><span style={{ width: 90 }}>{tr(lang, 'ttsSpeed')}</span>
              <input type='range' min={0.5} max={2} step={0.1} value={settings.tts.speed} onChange={(e) => patchSettings({ tts: { ...settings.tts, speed: +e.target.value } })} /></div>
          </div>

          <button className='btn' style={{ width: '100%' }} onClick={() => patchSettings({ view: settings.view === 'grid' ? 'list' : 'grid' })}>
            {tr(lang, 'grid')} / {tr(lang, 'list')}
          </button>
        </div>
      </motion.div>
    </>
  )
}
