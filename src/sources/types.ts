// 源通道（Source Channel）统一类型。
// 设计目标：动漫 / 书籍 / 音乐三类内容共用一套检索-详情-取流契约，
// 内置源与用户自定义源走同一条通道，UI 只需要认 SourceHit。
import type { AudioTrack } from '../types'

export type SourceKind = 'anime' | 'book' | 'music'

export const SOURCE_KINDS: SourceKind[] = ['anime', 'book', 'music']

/** 检索结果条目：一句话能描述的任何可消费内容（剧集 / 书 / 曲目） */
export interface SourceHit {
  /** `${sourceId}:${nativeId}`，全局唯一，可直接当 key */
  id: string
  sourceId: string
  sourceName: string
  kind: SourceKind
  nativeId: string
  title: string
  subtitle?: string
  cover?: string
  year?: string
  /** 角标文案：如「EP12」「30s 试听」「公版」 */
  badge?: string
  /** 音频直链（音乐源）；有值时可直接入队播放 */
  playUrl?: string
  /** 可下载的书籍文件（epub / txt） */
  downloadUrl?: string
  downloadName?: string
  /** 外部详情页 / 官方播放页 */
  openUrl?: string
  description?: string
  /** 附加信息：评分、语言、集数等，UI 按需展示 */
  meta?: Record<string, string | number | undefined>
}

/** 详情里的子项：分集 / 章节 / 曲目 */
export interface SourceLeaf {
  id: string
  title: string
  subtitle?: string
  playUrl?: string
  openUrl?: string
  index?: number
}

export interface SourceDetail {
  hit: SourceHit
  description?: string
  leaves: SourceLeaf[]
  /** 详情补充信息（作者、集数、出版方…） */
  facts: Array<{ label: string; value: string }>
}

export interface SearchArgs {
  query: string
  page?: number
  limit?: number
  signal?: AbortSignal
}

export interface SourceProvider {
  id: string
  name: string
  kinds: SourceKind[]
  /** 一句话说明，源管理里展示 */
  note?: string
  homepage?: string
  builtin?: boolean
  /** 首次使用的默认开关；不填视为开启（网络不通的源可设 false，避免每次搜索都报错） */
  defaultEnabled?: boolean
  search: (args: SearchArgs) => Promise<SourceHit[]>
  detail?: (hit: SourceHit, signal?: AbortSignal) => Promise<SourceDetail | null>
}

/** 单源检索状态：UI 用来展示「哪个源挂了」而不是整体报错 */
export interface SourceRunState {
  sourceId: string
  sourceName: string
  ok: boolean
  count: number
  ms: number
  error?: string
}

export interface AggregateResult {
  hits: SourceHit[]
  runs: SourceRunState[]
}

/** 自定义源清单（声明式 JSON，不含可执行代码，避免任意脚本注入） */
export interface CustomSourceSpec {
  id: string
  name: string
  kinds: SourceKind[]
  note?: string
  homepage?: string
  search: {
    /** 支持 {query} {page} {limit} 占位符 */
    url: string
    headers?: Record<string, string>
    /** 结果数组在响应里的点路径，如 data.list；不填则用根数组 */
    list?: string
    fields: {
      id: string
      title: string
      subtitle?: string
      cover?: string
      year?: string
      playUrl?: string
      downloadUrl?: string
      openUrl?: string
    }
  }
  detail?: {
    url: string
    description?: string
    leaves?: string
    leafFields?: { id: string; title: string; playUrl?: string }
  }
}

/** 音乐搜索结果转 AudioTrack（复用现有播放引擎） */
export interface RemoteTrackInit {
  hit: SourceHit
}

export type { AudioTrack }
