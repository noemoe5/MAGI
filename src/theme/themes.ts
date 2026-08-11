import { ThemeName, Settings, AppLang } from '../types'

export interface ThemePalette {
  bg: string
  fg: string
  sub: string
  panel: string
  panel2: string
  border: string
  hover: string
  input: string
  shadow: string
  readerBg: string
}

// Koodo 风格 9 套主题
export const THEMES: Record<ThemeName, ThemePalette> = {
  light: { bg: '#ffffff', fg: '#1a1a1a', sub: '#666666', panel: '#f5f5f5', panel2: '#ffffff', border: '#e5e5e5', hover: '#ececec', input: '#f0f0f0', shadow: 'rgba(0,0,0,.08)', readerBg: '#ffffff' },
  dark: { bg: '#1e1e1e', fg: '#e4e4e4', sub: '#9a9a9a', panel: '#252525', panel2: '#2a2a2a', border: '#3a3a3a', hover: '#333333', input: '#2f2f2f', shadow: 'rgba(0,0,0,.45)', readerBg: '#232323' },
  sepia: { bg: '#f4ecd8', fg: '#5b4636', sub: '#8a7256', panel: '#efe6cf', panel2: '#f7f0dd', border: '#ddd0b0', hover: '#e8dcc0', input: '#efe6cf', shadow: 'rgba(90,70,54,.12)', readerBg: '#f4ecd8' },
  green: { bg: '#c8e6c9', fg: '#1f3a21', sub: '#4a6a4c', panel: '#bfe0c0', panel2: '#d3ecd4', border: '#a9d3aa', hover: '#b6dcb7', input: '#bfe0c0', shadow: 'rgba(31,58,33,.12)', readerBg: '#c8e6c9' },
  black: { bg: '#000000', fg: '#cfcfcf', sub: '#888888', panel: '#0a0a0a', panel2: '#111111', border: '#222222', hover: '#1a1a1a', input: '#111111', shadow: 'rgba(0,0,0,.6)', readerBg: '#000000' },
  eye: { bg: '#a8d0a8', fg: '#1c2c1c', sub: '#3f5a3f', panel: '#9ec99e', panel2: '#b6dcb6', border: '#88bd88', hover: '#94c394', input: '#9ec99e', shadow: 'rgba(28,44,28,.14)', readerBg: '#a8d0a8' },
  pink: { bg: '#f7d9e3', fg: '#5a2a38', sub: '#8a5060', panel: '#f3cdd9', panel2: '#fbe4ec', border: '#e7b6c6', hover: '#efc2d2', input: '#f3cdd9', shadow: 'rgba(90,42,56,.12)', readerBg: '#f7d9e3' },
  blue: { bg: '#d6e4f0', fg: '#1c2e3e', sub: '#4a6076', panel: '#cfe0f0', panel2: '#e3eef8', border: '#b3cde2', hover: '#c2d8ec', input: '#cfe0f0', shadow: 'rgba(28,46,62,.12)', readerBg: '#d6e4f0' },
  gray: { bg: '#e8e8e8', fg: '#2a2a2a', sub: '#6a6a6a', panel: '#dedede', panel2: '#f2f2f2', border: '#cfcfcf', hover: '#d4d4d4', input: '#e0e0e0', shadow: 'rgba(0,0,0,.1)', readerBg: '#e8e8e8' }
}

// Koodo 风格 11 强调色
export interface AccentDef { value: string; label: Record<AppLang, string> }
export const ACCENTS: AccentDef[] = [
  { value: '#0179ca', label: { zh: '默认蓝', en: 'Default' } },
  { value: '#F16464', label: { zh: '红', en: 'Red' } },
  { value: '#008F91', label: { zh: '青绿', en: 'Teal' } },
  { value: '#6867D1', label: { zh: '紫', en: 'Purple' } },
  { value: '#F97316', label: { zh: '橙', en: 'Orange' } },
  { value: '#EC4899', label: { zh: '粉', en: 'Pink' } },
  { value: '#EAB308', label: { zh: '黄', en: 'Yellow' } },
  { value: '#8B5CF6', label: { zh: '紫罗兰', en: 'Violet' } },
  { value: '#0EA5E9', label: { zh: '天蓝', en: 'Sky' } },
  { value: '#64748B', label: { zh: '石板', en: 'Slate' } },
  { value: '#14b8a6', label: { zh: '蓝绿', en: 'Cyan' } }
]

export const DEFAULT_SETTINGS: Settings = {
  theme: 'dark',
  accent: '#0179ca',
  lang: 'zh',
  fontSize: 18,
  lineHeight: 1.7,
  fontFamily: 'system-ui, "Noto Sans CJK SC", sans-serif',
  readerMode: 'vertical',
  view: 'grid',
  filter: 'all',
  sort: 'recent',
  search: '',
  tts: {
    enabled: true,
    baseUrl: 'http://127.0.0.1:9872',
    refAudioPath: '',
    promptText: '',
    textLang: 'zh',
    promptLang: 'zh',
    speed: 1,
    apiVersion: 'v2'
  }
}

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '')
  const n = parseInt(h.length === 3 ? h.split('').map(c => c + c).join('') : h, 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

export function shade(hex: string, factor: number): string {
  const [r, g, b] = hexToRgb(hex)
  const f = (c: number) => Math.max(0, Math.min(255, Math.round(c + (factor < 0 ? c : 255 - c) * factor)))
  return `rgb(${f(r)}, ${f(g)}, ${f(b)})`
}

export function contrastColor(hex: string): string {
  const [r, g, b] = hexToRgb(hex)
  const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255
  return lum > 0.6 ? '#1a1a1a' : '#ffffff'
}

// 把主题+强调色写成 CSS 变量（全部 transform/opacity 动画走合成器，无 layout 触发）
export function applyTheme(theme: ThemeName, accent: string) {
  const t = THEMES[theme]
  const el = document.documentElement
  const set = (k: string, v: string) => el.style.setProperty(k, v)
  set('--bg', t.bg)
  set('--fg', t.fg)
  set('--sub', t.sub)
  set('--panel', t.panel)
  set('--panel2', t.panel2)
  set('--border', t.border)
  set('--hover', t.hover)
  set('--input', t.input)
  set('--shadow', t.shadow)
  set('--reader-bg', t.readerBg)
  set('--accent', accent)
  set('--accent-hover', shade(accent, -0.12))
  set('--accent-contrast', contrastColor(accent))
}
