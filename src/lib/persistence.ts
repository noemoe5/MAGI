import { LibraryData } from '../types'

const LS_KEY = 'novelreader-library'

function hasElectron(): boolean {
  return typeof window !== 'undefined' && !!(window as any).electronAPI
}

export async function loadLibrary(): Promise<LibraryData | null> {
  if (hasElectron()) {
    try {
      const data = await (window as any).electronAPI.readLibrary()
      if (data) return data
    } catch {
      /* fall through to localStorage */
    }
  }
  try {
    const raw = localStorage.getItem(LS_KEY)
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

let saveTimer: any = null
let pending: LibraryData | null = null

function flush(): void {
  if (!pending) return
  const data = pending
  pending = null
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(data))
  } catch {
    /* storage full / disabled */
  }
  if (hasElectron()) {
    try {
      ;(window as any).electronAPI.writeLibrary(data)
    } catch {
      /* ignore */
    }
  }
}

/** 防抖落盘：翻页会高频触发 setProgress，避免每帧写磁盘拖慢渲染 */
export function saveLibrary(data: LibraryData): void {
  pending = data
  clearTimeout(saveTimer)
  saveTimer = setTimeout(flush, 500)
}

if (typeof window !== 'undefined') {
  window.addEventListener('beforeunload', flush)
}
