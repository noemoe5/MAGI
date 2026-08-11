export type ThemeName =
  | 'light' | 'dark' | 'sepia' | 'green' | 'black'
  | 'eye' | 'pink' | 'blue' | 'gray'

export type AppLang = 'zh' | 'en'

export type BookStatus = 'reading' | 'finished' | 'unread'

export interface Book {
  id: string
  path: string
  name: string
  author?: string
  cover?: string // data URL
  progress: number // 0-100
  favorite: boolean
  status: BookStatus
  addedAt: number
  cfi?: string
  kind: 'epub' | 'txt'
}

export interface Bookmark {
  id: string
  bookId: string
  cfi: string
  label: string
  percent: number
}

export interface Highlight {
  id: string
  bookId: string
  cfi: string
  text: string
}

export interface TtsConfig {
  enabled: boolean
  baseUrl: string
  refAudioPath: string
  promptText: string
  textLang: string
  promptLang: string
  speed: number
  apiVersion: 'v1' | 'v2'
}

export interface Settings {
  theme: ThemeName
  accent: string
  lang: AppLang
  fontSize: number
  lineHeight: number
  fontFamily: string
  readerMode: 'vertical' | 'horizontal'
  view: 'grid' | 'list'
  filter: 'all' | 'reading' | 'finished' | 'favorite'
  sort: 'recent' | 'title' | 'author' | 'progress'
  search: string
  tts: TtsConfig
}

export interface LibraryData {
  books: Book[]
  bookmarks: Bookmark[]
  highlights: Highlight[]
  settings: Settings
}
