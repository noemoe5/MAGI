import { create } from 'zustand'
import { Book, Bookmark, Highlight, Settings, ThemeName, AppLang, LibraryData, Note, Literature, KnowledgeEntry } from '../types'
import { DEFAULT_SETTINGS } from '../theme/themes'
import { saveLibrary } from '../lib/persistence'

interface StoreState {
  books: Book[]
  bookmarks: Bookmark[]
  highlights: Highlight[]
  settings: Settings
  currentBookId: string | null
  tocOpen: boolean
  settingsOpen: boolean
  bookmarksOpen: boolean

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
}

function snapshot(s: StoreState): LibraryData {
  return {
    books: s.books, bookmarks: s.bookmarks, highlights: s.highlights, settings: s.settings,
    notes: s.notes, literature: s.literature, knowledge: s.knowledge
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

    init: (data) =>
      set({
        books: data?.books ?? [],
        bookmarks: data?.bookmarks ?? [],
        highlights: data?.highlights ?? [],
        settings: { ...DEFAULT_SETTINGS, ...(data?.settings ?? {}) },
        notes: data?.notes ?? [],
        literature: data?.literature ?? [],
        knowledge: data?.knowledge ?? [],
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
    setBookmarksOpen: (v) => set({ bookmarksOpen: v })
  }
})
