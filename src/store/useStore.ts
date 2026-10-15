import { create } from 'zustand'
import { Book, Bookmark, Highlight, Settings, ThemeName, AppLang, LibraryData, Note, Literature, KnowledgeEntry, AudioTrack, VideoItem, AudioPosition, VideoProgress, AudioPrefs, PlayMode, MediaSection } from '../types'
import { DEFAULT_SETTINGS } from '../theme/themes'
import { saveLibrary } from '../lib/persistence'
import { uuid } from '../lib/util'

interface StoreState {
  books: Book[]
  bookmarks: Bookmark[]
  highlights: Highlight[]
  settings: Settings
  currentBookId: string | null
  tocOpen: boolean
  settingsOpen: boolean
  bookmarksOpen: boolean

  // —— 影音媒体 ——
  section: MediaSection            // 书架 / 音乐 / 视频（会话内切换，不持久化）
  audioTracks: AudioTrack[]
  videoItems: VideoItem[]
  audioPositions: Record<string, AudioPosition>   // 每首歌的断点
  videoProgress: Record<string, VideoProgress>    // 每个视频的断点
  audioPrefs: AudioPrefs

  // 音频播放运行时（不持久化；队列/音量等持久字段走 audioPrefs）
  audioCurrentId: string | null
  audioQueue: string[]
  audioIndex: number
  audioPlaying: boolean
  audioPosition: number
  audioDuration: number
  nowPlayingOpen: boolean
  /**
   * 全屏播放层打开时显示哪一档 —— 对齐 folia 的 `currentView`：
   *   `player`  播放页：可视化器全屏铺底（封面配色背景 + 它自带的歌词浮层）+ 侧栏（大封面/标签页）
   *   `lattice` 歌曲墙：队列的海报墙
   */
  playView: 'player' | 'lattice'
  sleepTimerEnd: number | null
  audioSeekToken: number           // 显式 seek 请求计数（组件据此同步 element.currentTime）

  // 视频播放运行时（不持久化）
  videoPlayingId: string | null
  videoQueue: string[]

  // —— 文献查阅模块 ——
  notes: Note[]              // 收藏的查阅结果
  literature: Literature[]   // 学术文献库
  knowledge: KnowledgeEntry[] // 本地知识库（内置 + 导入）
  lookupOpen: boolean        // 查阅面板是否打开
  lookupSeed: string         // 划词选区文本 / 预填查询
  literatureOpen: boolean    // 学术文献库抽屉是否打开

  initialized: boolean
  init: (data: LibraryData | null) => void

  addBooks: (books: Book[]) => void
  removeBook: (id: string) => void
  setCurrent: (id: string | null) => void
  toggleFavorite: (id: string) => void
  setProgress: (id: string, progress: number, cfi?: string) => void

  addBookmark: (b: Bookmark) => void
  removeBookmark: (id: string) => void
  addHighlight: (h: Highlight) => void
  removeHighlight: (id: string) => void

  // 文献查阅 actions
  addNote: (n: Note) => void
  removeNote: (id: string) => void
  clearNotes: () => void
  addLiterature: (l: Literature) => void
  removeLiterature: (id: string) => void
  updateLiterature: (id: string, patch: Partial<Literature>) => void
  importKnowledge: (entries: KnowledgeEntry[]) => void
  addKnowledge: (e: KnowledgeEntry) => void
  clearKnowledge: () => void
  setLookupOpen: (v: boolean) => void
  setLookupSeed: (s: string) => void
  setLiteratureOpen: (v: boolean) => void

  setTheme: (t: ThemeName) => void
  setAccent: (a: string) => void
  setLang: (l: AppLang) => void
  patchSettings: (p: Partial<Settings>) => void

  setTocOpen: (v: boolean) => void
  setSettingsOpen: (v: boolean) => void
  setBookmarksOpen: (v: boolean) => void

  // —— 媒体 actions ——
  setSection: (s: MediaSection) => void
  addAudioTracks: (tracks: AudioTrack[]) => void
  removeAudioTrack: (id: string) => void
  addVideoItems: (items: VideoItem[]) => void
  removeVideoItem: (id: string) => void

  /** 运行时补丁（不落盘）：播放态/位置/覆盖层 */
  patchAudio: (p: Partial<Pick<StoreState, 'audioCurrentId' | 'audioQueue' | 'audioIndex' | 'audioPlaying' | 'audioPosition' | 'audioDuration' | 'nowPlayingOpen' | 'playView' | 'sleepTimerEnd' | 'audioSeekToken'>>) => void
  /** 持久偏好补丁（落盘） */
  patchAudioPrefs: (p: Partial<AudioPrefs>) => void
  saveAudioPosition: (id: string, pos: number, dur: number) => void
  saveVideoProgress: (id: string, position: number, duration: number) => void

  /** 播放控制（模式感知的上下曲/播放暂停） */
  playTrack: (id: string, queueIds?: string[]) => void
  audioNext: (auto?: boolean) => void
  audioPrev: () => void
  toggleAudio: () => void
  cyclePlayMode: () => void

  /** 视频播放控制 */
  openVideo: (id: string, queueIds?: string[]) => void
  closeVideo: () => void
  videoNext: () => void
}

const DEFAULT_AUDIO_PREFS: AudioPrefs = {
  mode: 'order',
  volume: 0.8,
  muted: false,
  rate: 1,
  lyricOffsetMs: 0,
  lastCurrentId: null,
  lastQueue: [],
  lastIndex: -1
}

function snapshot(s: StoreState): LibraryData {
  return {
    books: s.books, bookmarks: s.bookmarks, highlights: s.highlights, settings: s.settings,
    notes: s.notes, literature: s.literature, knowledge: s.knowledge,
    audioTracks: s.audioTracks, videoItems: s.videoItems,
    audioPositions: s.audioPositions, videoProgress: s.videoProgress,
    audioPrefs: {
      ...s.audioPrefs,
      lastCurrentId: s.audioCurrentId,
      lastQueue: s.audioQueue,
      lastIndex: s.audioIndex
    }
  }
}

export const useStore = create<StoreState>((set, get) => {
  const persist = () => {
    const s = get()
    if (s.initialized) saveLibrary(snapshot(s))
  }

  return {
    books: [],
    bookmarks: [],
    highlights: [],
    settings: DEFAULT_SETTINGS,
    currentBookId: null,
    tocOpen: false,
    settingsOpen: false,
    bookmarksOpen: false,
    notes: [],
    literature: [],
    knowledge: [],
    lookupOpen: false,
    lookupSeed: '',
    literatureOpen: false,
    initialized: false,

    // —— 影音媒体 ——
    section: 'books',
    audioTracks: [],
    videoItems: [],
    audioPositions: {},
    videoProgress: {},
    audioPrefs: DEFAULT_AUDIO_PREFS,
    audioCurrentId: null,
    audioQueue: [],
    audioIndex: -1,
    audioPlaying: false,
    audioPosition: 0,
    audioDuration: 0,
    nowPlayingOpen: false,
    playView: 'player',
    sleepTimerEnd: null,
    audioSeekToken: 0,
    videoPlayingId: null,
    videoQueue: [],

    init: (data) =>
      set({
        books: data?.books ?? [],
        bookmarks: data?.bookmarks ?? [],
        highlights: data?.highlights ?? [],
        settings: { ...DEFAULT_SETTINGS, ...(data?.settings ?? {}) },
        notes: data?.notes ?? [],
        literature: data?.literature ?? [],
        knowledge: data?.knowledge ?? [],
        audioTracks: data?.audioTracks ?? [],
        videoItems: data?.videoItems ?? [],
        audioPositions: data?.audioPositions ?? {},
        videoProgress: data?.videoProgress ?? {},
        audioPrefs: { ...DEFAULT_AUDIO_PREFS, ...(data?.audioPrefs ?? {}) },
        audioCurrentId: data?.audioPrefs?.lastCurrentId ?? null,
        audioQueue: data?.audioPrefs?.lastQueue ?? [],
        audioIndex: data?.audioPrefs?.lastIndex ?? -1,
        initialized: true
      }),

    addBooks: (incoming) => {
      const existing = new Set(get().books.map((b) => b.path))
      const fresh = incoming.filter((b) => !existing.has(b.path))
      if (!fresh.length) return
      set((s) => ({ books: [...fresh, ...s.books] }))
      persist()
    },

    removeBook: (id) => {
      set((s) => ({
        books: s.books.filter((b) => b.id !== id),
        bookmarks: s.bookmarks.filter((bm) => bm.bookId !== id),
        highlights: s.highlights.filter((h) => h.bookId !== id),
        notes: s.notes.filter((n) => n.bookId !== id),
        literature: s.literature.map((l) => (l.bookId === id ? { ...l, bookId: undefined } : l)),
        currentBookId: s.currentBookId === id ? null : s.currentBookId
      }))
      persist()
    },

    setCurrent: (id) => set({ currentBookId: id }),

    toggleFavorite: (id) => {
      set((s) => ({ books: s.books.map((b) => (b.id === id ? { ...b, favorite: !b.favorite } : b)) }))
      persist()
    },

    setProgress: (id, progress, cfi) => {
      set((s) => ({
        books: s.books.map((b) =>
          b.id === id
            ? {
                ...b,
                progress,
                cfi,
                status: progress >= 98 ? 'finished' : progress > 0 ? 'reading' : b.status
              }
            : b
        )
      }))
      persist()
    },

    addBookmark: (b) => {
      if (get().bookmarks.some((x) => x.bookId === b.bookId && x.cfi === b.cfi)) return
      set((s) => ({ bookmarks: [...s.bookmarks, b] }))
      persist()
    },
    removeBookmark: (id) => {
      set((s) => ({ bookmarks: s.bookmarks.filter((b) => b.id !== id) }))
      persist()
    },
    addHighlight: (h) => {
      set((s) => ({ highlights: [...s.highlights, h] }))
      persist()
    },
    removeHighlight: (id) => {
      set((s) => ({ highlights: s.highlights.filter((h) => h.id !== id) }))
      persist()
    },

    // —— 文献查阅 ——
    addNote: (n) => {
      set((s) => ({ notes: [n, ...s.notes] }))
      persist()
    },
    removeNote: (id) => {
      set((s) => ({ notes: s.notes.filter((n) => n.id !== id) }))
      persist()
    },
    clearNotes: () => {
      set({ notes: [] })
      persist()
    },
    addLiterature: (l) => {
      set((s) => ({ literature: [l, ...s.literature] }))
      persist()
    },
    removeLiterature: (id) => {
      set((s) => ({ literature: s.literature.filter((l) => l.id !== id) }))
      persist()
    },
    updateLiterature: (id, patch) => {
      set((s) => ({ literature: s.literature.map((l) => (l.id === id ? { ...l, ...patch } : l)) }))
      persist()
    },
    importKnowledge: (entries) => {
      set((s) => {
        const seen = new Set(s.knowledge.map((k) => k.term.toLowerCase()))
        const fresh = entries.filter((e) => e.term && !seen.has(e.term.toLowerCase()))
        return { knowledge: [...fresh, ...s.knowledge] }
      })
      persist()
    },
    addKnowledge: (e) => {
      set((s) => ({ knowledge: [e, ...s.knowledge] }))
      persist()
    },
    clearKnowledge: () => {
      set({ knowledge: [] })
      persist()
    },
    setLookupOpen: (v) => set({ lookupOpen: v }),
    setLookupSeed: (s) => set({ lookupSeed: s }),
    setLiteratureOpen: (v) => set({ literatureOpen: v }),

    setTheme: (t) => {
      set((s) => ({ settings: { ...s.settings, theme: t } }))
      persist()
    },
    setAccent: (a) => {
      set((s) => ({ settings: { ...s.settings, accent: a } }))
      persist()
    },
    setLang: (l) => {
      set((s) => ({ settings: { ...s.settings, lang: l } }))
      persist()
    },
    patchSettings: (p) => {
      set((s) => ({ settings: { ...s.settings, ...p } }))
      persist()
    },

    setTocOpen: (v) => set({ tocOpen: v }),
    setSettingsOpen: (v) => set({ settingsOpen: v }),
    setBookmarksOpen: (v) => set({ bookmarksOpen: v }),

    // —— 媒体 actions ——
    setSection: (s) => set({ section: s }),

    addAudioTracks: (incoming) => {
      const existing = new Set(get().audioTracks.map((t) => t.path))
      const fresh = incoming.filter((t) => !existing.has(t.path))
      if (!fresh.length) return
      set((s) => ({ audioTracks: [...fresh, ...s.audioTracks] }))
      const api = (window as any).electronAPI
      if (api?.mediaRegister) api.mediaRegister(fresh.map((t) => t.path))
      persist()
    },

    removeAudioTrack: (id) => {
      set((s) => {
        const queue = s.audioQueue.filter((q) => q !== id)
        const isCurrent = s.audioCurrentId === id
        return {
          audioTracks: s.audioTracks.filter((t) => t.id !== id),
          audioQueue: queue,
          audioIndex: isCurrent ? -1 : queue.indexOf(s.audioCurrentId || ''),
          audioCurrentId: isCurrent ? null : s.audioCurrentId,
          audioPlaying: isCurrent ? false : s.audioPlaying
        }
      })
      persist()
    },

    addVideoItems: (incoming) => {
      const existing = new Set(get().videoItems.map((v) => v.path))
      const fresh = incoming.filter((v) => !existing.has(v.path))
      if (!fresh.length) return
      set((s) => ({ videoItems: [...fresh, ...s.videoItems] }))
      const api = (window as any).electronAPI
      if (api?.mediaRegister) api.mediaRegister(fresh.map((v) => v.path))
      persist()
    },

    removeVideoItem: (id) => {
      set((s) => ({ videoItems: s.videoItems.filter((v) => v.id !== id) }))
      persist()
    },

    patchAudio: (p) => set(p),

    patchAudioPrefs: (p) => {
      set((s) => ({ audioPrefs: { ...s.audioPrefs, ...p } }))
      persist()
    },

    saveAudioPosition: (id, pos, dur) => {
      set((s) => ({ audioPositions: { ...s.audioPositions, [id]: { pos, dur, at: Date.now() } } }))
      persist()
    },

    saveVideoProgress: (id, position, duration) => {
      set((s) => ({ videoProgress: { ...s.videoProgress, [id]: { position, duration, updatedAt: Date.now() } } }))
      persist()
    },

    playTrack: (id, queueIds) => {
      const s = get()
      let queue = s.audioQueue
      if (queueIds && queueIds.length) {
        const seen = new Set<string>()
        queue = []
        for (const q of queueIds) {
          if (!seen.has(q)) { seen.add(q); queue.push(q) }
        }
      }
      if (!queue.length) queue = s.audioTracks.map((t) => t.id)
      let index = queue.indexOf(id)
      if (index < 0) { queue = [id, ...queue]; index = 0 }
      const track = s.audioTracks.find((t) => t.id === id)
      set({
        audioCurrentId: id,
        audioQueue: queue,
        audioIndex: index,
        audioPlaying: true,
        audioPosition: 0,
        audioDuration: track?.duration ?? s.audioDuration
      })
    },

    audioNext: (auto = false) => {
      const s = get()
      if (!s.audioQueue.length) return
      const mode = s.audioPrefs.mode
      if (auto && mode === 'single') {
        set({ audioPosition: 0, audioPlaying: true, audioSeekToken: s.audioSeekToken + 1 })
        return
      }
      let index = s.audioIndex
      if (mode === 'shuffle' && s.audioQueue.length > 1) {
        let n = index
        while (n === index) n = Math.floor(Math.random() * s.audioQueue.length)
        index = n
      } else {
        index = s.audioIndex + 1
        if (index >= s.audioQueue.length) index = 0
      }
      const id = s.audioQueue[index]
      if (!id) return
      const track = s.audioTracks.find((t) => t.id === id)
      set({
        audioCurrentId: id,
        audioIndex: index,
        audioPlaying: true,
        audioPosition: 0,
        audioDuration: track?.duration ?? s.audioDuration,
        audioSeekToken: s.audioSeekToken + 1
      })
    },

    audioPrev: () => {
      const s = get()
      if (!s.audioQueue.length) return
      if (s.audioPosition > 3) {
        set({ audioPosition: 0, audioSeekToken: s.audioSeekToken + 1 })
        return
      }
      let index = s.audioIndex - 1
      if (index < 0) index = s.audioQueue.length - 1
      const id = s.audioQueue[index]
      if (!id) return
      const track = s.audioTracks.find((t) => t.id === id)
      set({
        audioCurrentId: id,
        audioIndex: index,
        audioPlaying: true,
        audioPosition: 0,
        audioDuration: track?.duration ?? s.audioDuration,
        audioSeekToken: s.audioSeekToken + 1
      })
    },

    toggleAudio: () => {
      const s = get()
      if (!s.audioCurrentId) return
      set({ audioPlaying: !s.audioPlaying })
    },

    cyclePlayMode: () => {
      const s = get()
      const next: PlayMode = s.audioPrefs.mode === 'order' ? 'shuffle' : s.audioPrefs.mode === 'shuffle' ? 'single' : 'order'
      get().patchAudioPrefs({ mode: next })
    },

    openVideo: (id, queueIds) => {
      const s = get()
      let queue = s.videoQueue
      if (queueIds && queueIds.length) {
        const seen = new Set<string>()
        queue = []
        for (const q of queueIds) {
          if (!seen.has(q)) { seen.add(q); queue.push(q) }
        }
      }
      if (!queue.includes(id)) queue = [id, ...queue]
      set({ videoPlayingId: id, videoQueue: queue })
    },

    closeVideo: () => set({ videoPlayingId: null, videoQueue: [] }),

    videoNext: () => {
      const s = get()
      if (!s.videoQueue.length) { set({ videoPlayingId: null }); return }
      const idx = s.videoQueue.indexOf(s.videoPlayingId || '')
      const nextId = s.videoQueue[(idx + 1) % s.videoQueue.length]
      if (nextId) set({ videoPlayingId: nextId })
      else set({ videoPlayingId: null, videoQueue: [] })
    }
  }
})
