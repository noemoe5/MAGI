// 内置书籍通道：Gutendex（Project Gutenberg 公共 API，无需 Key）。
// 全部为公有领域（公版）作品，可直接下载 EPUB / TXT 落到本地书架。
import type { SourceHit, SourceProvider, SourceDetail } from '../types'
import { getJSON } from '../http'

interface GutendexBook {
  id: number
  title: string
  authors?: Array<{ name: string; birth_year?: number | null; death_year?: number | null }>
  languages?: string[]
  formats?: Record<string, string>
  download_count?: number
  subjects?: string[]
}

const LANG_LABEL: Record<string, string> = { zh: '中文', en: '英文', fr: '法文', de: '德文', ja: '日文' }

const toHit = (b: GutendexBook): SourceHit => {
  const epub = b.formats?.['application/epub+zip']
  const txt = b.formats?.['text/plain; charset=utf-8'] || b.formats?.['text/plain']
  const cover = b.formats?.['image/jpeg']
  return {
    id: `gutenberg:${b.id}`,
    sourceId: 'gutenberg',
    sourceName: '古登堡计划',
    kind: 'book',
    nativeId: String(b.id),
    title: b.title.replace(/\s+/g, ' ').trim(),
    subtitle: b.authors?.map((a) => a.name).join('、') || '佚名',
    cover,
    badge: epub ? 'EPUB' : txt ? 'TXT' : undefined,
    downloadUrl: epub || txt,
    downloadName: `${b.title.replace(/[\\/:*?"<>|]/g, '_').slice(0, 60)}.${epub ? 'epub' : 'txt'}`,
    openUrl: `https://www.gutenberg.org/ebooks/${b.id}`,
    meta: {
      语言: (b.languages ?? []).map((l) => LANG_LABEL[l] || l).join(' / '),
      下载量: b.download_count
    }
  }
}

export const gutenbergSource: SourceProvider = {
  id: 'gutenberg',
  name: '古登堡计划',
  kinds: ['book'],
  note: '7 万+ 公有领域电子书，EPUB/TXT 可直接入库',
  homepage: 'https://gutendex.com',
  builtin: true,

  async search({ query }) {
    if (!query.trim()) return []
    const url = `https://gutendex.com/books?search=${encodeURIComponent(query)}`
    const data = await getJSON<{ results?: GutendexBook[] }>(url)
    return (data.results ?? []).slice(0, 24).map(toHit)
  },

  async detail(hit): Promise<SourceDetail | null> {
    const data = await getJSON<GutendexBook>(`https://gutendex.com/books/${hit.nativeId}`)
    if (!data) return null
    const b = toHit(data)
    return {
      hit: { ...b, id: hit.id, sourceId: hit.sourceId, sourceName: hit.sourceName },
      description: (data.subjects ?? []).join('；') || undefined,
      leaves: [],
      facts: [
        { label: '作者', value: data.authors?.map((a) => a.name).join('、') || '佚名' },
        { label: '语言', value: (data.languages ?? []).map((l) => LANG_LABEL[l] || l).join(' / ') },
        { label: '下载量', value: String(data.download_count ?? 0) },
        { label: '格式', value: [data.formats?.['application/epub+zip'] ? 'EPUB' : '', data.formats?.['text/plain; charset=utf-8'] ? 'TXT' : ''].filter(Boolean).join(' / ') || '—' }
      ]
    }
  }
}
