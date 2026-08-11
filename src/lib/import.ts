import ePub from 'epubjs'
import { Book } from '../types'
import { base64ToArrayBuffer, base64ToText, uuid } from './util'

/** 封面等比缩到 maxW 宽再转 jpeg dataURL，避免整本原图 base64 塞进 library.json */
async function shrinkToDataUrl(blob: Blob, maxW: number): Promise<string> {
  const bitmap = await createImageBitmap(blob)
  const scale = Math.min(1, maxW / bitmap.width)
  const w = Math.max(1, Math.round(bitmap.width * scale))
  const h = Math.max(1, Math.round(bitmap.height * scale))
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')
  if (!ctx) return ''
  ctx.drawImage(bitmap, 0, 0, w, h)
  bitmap.close()
  return canvas.toDataURL('image/jpeg', 0.82)
}

export async function importBook(base64: string, path: string): Promise<Book> {
  const isEpub = /\.epub$/i.test(path)
  const rawName = path.split(/[\\/]/).pop() || 'book'
  const name = rawName.replace(/\.(epub|txt)$/i, '')

  if (!isEpub) {
    return {
      id: uuid(),
      path,
      name,
      author: '',
      progress: 0,
      favorite: false,
      status: 'unread',
      addedAt: Date.now(),
      kind: 'txt'
    }
  }

  const buf = base64ToArrayBuffer(base64)
  const book = ePub(buf)
  await book.ready
  const meta = (book as any).package?.metadata || (await book.loaded.metadata.catch(() => ({})))
  const title = meta?.title || name
  const author = meta?.creator || ''

  let cover: string | undefined
  try {
    // epub.js 取封面必须用 coverUrl()（返回 blob URL）；book.cover 只是包内相对路径，fetch 不到
    const coverUrl: string | null = await (book as any).coverUrl()
    if (coverUrl) {
      const blob = await (await fetch(coverUrl)).blob()
      cover = await shrinkToDataUrl(blob, 300)
      URL.revokeObjectURL(coverUrl)
    }
  } catch {
    /* no cover */
  }
  book.destroy()

  return {
    id: uuid(),
    path,
    name: title,
    author,
    cover,
    progress: 0,
    favorite: false,
    status: 'unread',
    addedAt: Date.now(),
    kind: 'epub'
  }
}

export { base64ToText }
