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

// 文献查阅：收藏的查阅结果（划词查/搜索台/本地库均可收藏）
export interface Note {
  id: string
  bookId?: string
  cfi?: string
  query: string        // 查阅的词 / 问题
  title?: string       // 结果标题（如 wiki 词条名）
  content: string      // 结果正文 / 摘要
  source: 'local' | 'web' | 'manual'
  url?: string
  createdAt: number
}

// 学术文献库条目
export interface Literature {
  id: string
  title: string
  author?: string
  year?: string
  publisher?: string
  url?: string
  tags: string[]
  note?: string
  bookId?: string      // 关联的本书（可选）
  createdAt: number
}

// 本地知识库词条
export interface KnowledgeEntry {
  term: string
  alias?: string[]
  definition: string
  source?: string
  tags?: string[]
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
  notes?: Note[]
  literature?: Literature[]
  knowledge?: KnowledgeEntry[]
  audioTracks?: AudioTrack[]
  videoItems?: VideoItem[]
  audioPositions?: Record<string, AudioPosition>
  videoProgress?: Record<string, VideoProgress>
  audioPrefs?: AudioPrefs
}

// —— 影音媒体 ——

export interface AudioTrack {
  id: string
  path: string
  name: string            // 显示名（ID3 标题优先，否则文件名）
  artist?: string
  album?: string
  albumartist?: string
  year?: string
  genre?: string
  track?: number | null
  duration: number        // 秒
  lossless?: boolean
  sampleRate?: number
  bitsPerSample?: number
  channels?: number
  container?: string
  codec?: string
  cover?: string          // dataURL（缩图）
  addedAt: number
}

export interface VideoItem {
  id: string
  path: string
  name: string
  duration: number
  width?: number
  height?: number
  size?: number
  addedAt: number
}

export interface AudioPosition { pos: number; dur: number; at: number }
export interface VideoProgress { position: number; duration: number; updatedAt: number }

export type PlayMode = 'order' | 'shuffle' | 'single'

/** 持久化的音频偏好（队列/音量/模式跨会话保留） */
export interface AudioPrefs {
  mode: PlayMode
  volume: number
  muted: boolean
  rate: number
  lyricOffsetMs: number
  lastCurrentId?: string | null
  lastQueue?: string[]
  lastIndex?: number
}

export type MediaSection = 'books' | 'music' | 'video'
