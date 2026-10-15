// LRC 歌词解析：标准行时间 [mm:ss.xx] + 增强型逐字 <mm:ss.xx>word
// 同时兼容 Folia Lattice 用的逐字形式（同一套语法）

export interface LyricWord { t: number; text: string }
export interface LyricLine { t: number; text: string; words?: LyricWord[] }

const TIME_TAG = /\[(\d{1,3}):(\d{1,2})(?:[.:](\d{1,3}))?\]/g
const WORD_TAG = /<(\d{1,3}):(\d{1,2})(?:[.:](\d{1,3}))?>([^<]*)/g

function toSeconds(min: string, sec: string, frac?: string): number {
  const m = parseInt(min, 10)
  const s = parseInt(sec, 10)
  let f = 0
  if (frac) f = parseInt(frac.padEnd(3, '0'), 10) / 1000
  return m * 60 + s + f
}

function stripWordTags(s: string): string {
  return s.replace(WORD_TAG, '')
}

function parseWords(rest: string): LyricWord[] | undefined {
  const words: LyricWord[] = []
  let m: RegExpExecArray | null
  const re = new RegExp(WORD_TAG.source, 'g')
  while ((m = re.exec(rest))) {
    words.push({ t: toSeconds(m[1], m[2], m[3]), text: m[4] })
  }
  return words.length ? words : undefined
}

/** 解析 LRC 文本；一行多个时间标签会展开成多行；忽略 [ar:]/[ti:] 等元数据行 */
export function parseLrc(lrc: string): LyricLine[] {
  if (!lrc) return []
  const out: LyricLine[] = []
  for (const raw of lrc.split(/\r?\n/)) {
    const line = raw.trim()
    if (!line) continue
    const re = new RegExp(TIME_TAG.source, 'g')
    const tags: number[] = []
    let m: RegExpExecArray | null
    let lastEnd = 0
    while ((m = re.exec(line))) {
      tags.push(toSeconds(m[1], m[2], m[3]))
      lastEnd = m.index + m[0].length
    }
    if (!tags.length) continue
    const rest = line.slice(lastEnd)
    // 元数据行（[ar:歌手]/[ti:标题]/[offset:0] 等）正文为空或紧跟冒号
    if (!rest || /^[:：]/.test(rest)) continue
    const words = parseWords(rest)
    const text = stripWordTags(rest).trim()
    for (const t of tags) out.push({ t, text, words })
  }
  out.sort((a, b) => a.t - b.t)
  return out
}

/** 纯文本歌词（无时间轴）按行拆分 */
export function plainLyricLines(text: string): string[] {
  return text.split(/\r?\n/).filter((l) => l.trim().length > 0)
}

/** 当前时间所在行（-1 = 尚未开始）；二分查找 */
export function activeLineIndex(lines: LyricLine[], time: number): number {
  let lo = 0
  let hi = lines.length - 1
  let ans = -1
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    if (lines[mid].t <= time + 0.02) {
      ans = mid
      lo = mid + 1
    } else {
      hi = mid - 1
    }
  }
  return ans
}

/** 当前行内的逐字进度（0-1，无逐字数据时返回 -1） */
export function activeWordProgress(line: LyricLine | undefined, time: number): number {
  if (!line || !line.words || !line.words.length) return -1
  const words = line.words
  if (time < words[0].t) return 0
  for (let i = 0; i < words.length; i++) {
    const cur = words[i]
    const next = words[i + 1]
    if (time >= cur.t && (!next || time < next.t)) {
      if (!next) return 1
      return Math.min(1, Math.max(0, (time - cur.t) / Math.max(0.001, next.t - cur.t)))
    }
  }
  return 1
}
