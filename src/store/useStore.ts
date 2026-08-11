import { create } from 'zustand'
import { Book, Bookmark, Highlight, Settings, ThemeName, AppLang, LibraryData } from '../types'
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

  setTheme: (t: ThemeName) => void
  setAccent: (a: string) => void
  setLang: (l: AppLang) => void
  patchSettings: (p: Partial<Settings>) => void

  setTocOpen: (v: boolean) => void
  setSettingsOpen: (v: boolean) => void
  setBookmarksOpen: (v: boolean) => void
}

function snapshot(s: StoreState): LibraryData {
  return { books: s.books, bookmarks: s.bookmarks, highlights: s.highlights, settings: s.settings }
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
    initialized: false,

    init: (data) =>
      set({
        books: data?.books ?? [],
        bookmarks: data?.bookmarks ?? [],
        highlights: data?.highlights ?? [],
        settings: { ...DEFAULT_SETTINGS, ...(data?.settings ?? {}) },
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
