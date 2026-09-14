import { Book } from '../types'
import { base64ToText, uuid } from './util'

/** 封面等比缩到 maxW 宽再转 jpeg dataURL，避免整本原图 base64 塞进 library.json */
async function shrinkToDataUrlSafe(blob: Blob, maxW: number): Promise<string> {
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

// 解析 container.xml 拿到 opf 的相对路径
function parseContainerPath(xml: string): string | null {
  try {
    const doc = new DOMParser().parseFromString(xml, 'application/xml')
    const rf = doc.querySelector('rootfile[full-path]')
    return rf?.getAttribute('full-path') || null
  } catch {
    return null
  }
}

// 解析 opf：标题、作者、封面图相对路径
function parseOpf(xml: string): { title: string; creator: string; coverHref: string | null } {
  let title = ''
  let creator = ''
  let coverHref: string | null = null
  try {
    const doc = new DOMParser().parseFromString(xml, 'application/xml')
    title = (doc.querySelector('title')?.textContent || '').trim()
    creator = (doc.querySelector('creator')?.textContent || '').trim()
    // 封面：先找 <meta name="cover" content="ID"/>，再在 manifest 找该 id 的 href
    const coverMeta = doc.querySelector('meta[name="cover"]')
    const coverId = coverMeta?.getAttribute('content')
    if (coverId) {
      const item = doc.querySelector(`item[id="${coverId}"]`)
      coverHref = item?.getAttribute('href') || null
    }
    if (!coverHref) {
      // 兜底：manifest 里 href 含 cover 的图片
      const items = Array.from(doc.querySelectorAll('item[href]'))
      const c = items.find((it) => /cover/i.test(it.getAttribute('href') || ''))
      coverHref = c?.getAttribute('href') || null
    }
  } catch {
    /* ignore */
  }
  return { title, creator, coverHref }
}

// 把相对 href 基于 opf 路径解析成 http://.../<id>/... 绝对地址
function resolveHref(baseUrl: string, opfPath: string, href: string): string {
  const opfUrl = baseUrl + '/' + opfPath
  try {
    const u = new URL(href, opfUrl)
    return baseUrl + u.pathname
  } catch {
    const dir = opfPath.split('/').slice(0, -1).join('/')
    return baseUrl + '/' + (dir ? dir + '/' : '') + href
  }
}

/**
 * 导入一本书的元数据。info 来自主进程 open-book：
 * - epub: { kind:'epub', baseUrl:'http://127.0.0.1:<port>/<id>/' } —— 经本地 HTTP 按需 fetch 元数据，不整包解压
 * - txt:  { kind:'txt', text }
 * 这样 600MB 大 EPUB 也能秒级导入（只解压到磁盘、按需读单文件）。
 */
export async function importBook(
  info: { kind: string; baseUrl?: string; text?: string } | { error: string },
  p: string
): Promise<Book> {
  const rawName = p.split(/[\\/]/).pop() || 'book'
  const name = rawName.replace(/\.(epub|txt)$/i, '')

  if (!info || (info as any).error || (info as any).kind !== 'epub' || !(info as any).baseUrl) {
    return {
      id: uuid(),
      path: p,
      name,
      author: '',
      progress: 0,
      favorite: false,
      status: 'unread',
      addedAt: Date.now(),
      kind: (info as any)?.kind === 'txt' ? 'txt' : 'epub'
    }
  }

  const base = (info as any).baseUrl as string
  let title = ''
  let author = ''
  let cover: string | undefined
  try {
    const containerXml = await (await fetch(base + '/META-INF/container.xml')).text()
    const opfPath = parseContainerPath(containerXml)
    if (opfPath) {
      const opfXml = await (await fetch(base + '/' + opfPath)).text()
      const m = parseOpf(opfXml)
      title = m.title
      author = m.creator
      if (m.coverHref) {
        const coverUrl = resolveHref(base, opfPath, m.coverHref)
        try {
          const blob = await (await fetch(coverUrl)).blob()
          cover = await shrinkToDataUrlSafe(blob, 300)
        } catch {
          /* no cover */
        }
      }
    }
  } catch {
    /* 元数据获取失败则用文件名兜底 */
  }

  return {
    id: uuid(),
    path: p,
    name: title || name,
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
