// 外挂字幕解析：SRT / WebVTT / ASS-SSA → 统一 cue 列表
// Vivid Player 形态的字幕层：自绘 DOM overlay（可调字号/位置/底色），不用 <track>

export interface SubtitleCue {
  start: number // 秒
  end: number
  text: string  // 可能含 \n
}

function tsToSec(ts: string): number {
  // 支持 hh:mm:ss,xxx / hh:mm:ss.xxx / mm:ss.xxx
  const m = /(?:(\d{1,3}):)?(\d{1,2}):(\d{1,2})(?:[.,](\d{1,3}))?/.exec(ts.trim())
  if (!m) return 0
  const h = m[1] ? parseInt(m[1], 10) : 0
  const min = parseInt(m[2], 10)
  const sec = parseInt(m[3], 10)
  const frac = m[4] ? parseInt(m[4].padEnd(3, '0'), 10) / 1000 : 0
  return h * 3600 + min * 60 + sec + frac
}

export function parseSrt(text: string): SubtitleCue[] {
  const cues: SubtitleCue[] = []
  const blocks = text.replace(/\r/g, '').split(/\n{2,}/)
  for (const block of blocks) {
    const lines = block.split('\n').filter((l) => l.trim().length > 0)
    if (lines.length < 2) continue
    // 找含 --> 的行（可能在序号之后）
    let ti = lines.findIndex((l) => l.includes('-->'))
    if (ti < 0) continue
    const tm = /([\d:.,]+)\s*-->\s*([\d:.,]+)/.exec(lines[ti])
    if (!tm) continue
    const body = lines.slice(ti + 1).join('\n').trim()
    if (!body) continue
    cues.push({ start: tsToSec(tm[1]), end: tsToSec(tm[2]), text: body })
  }
  return cues
}

export function parseVtt(text: string): SubtitleCue[] {
  const cleaned = text.replace(/\r/g, '')
  // 去掉 WEBVTT 头与 NOTE/STYLE/REGION 块
  const stripped = cleaned.replace(/^WEBVTT[^\n]*\n/, '')
  const cues: SubtitleCue[] = []
  const blocks = stripped.split(/\n{2,}/)
  for (const block of blocks) {
    const lines = block.split('\n').filter((l) => l.trim().length > 0)
    if (!lines.length) continue
    if (/^(NOTE|STYLE|REGION)/i.test(lines[0])) continue
    let ti = lines.findIndex((l) => l.includes('-->'))
    if (ti < 0) continue
    const tm = /([\d:.,]+)\s*-->\s*([\d:.,]+)/.exec(lines[ti])
    if (!tm) continue
    const body = lines
      .slice(ti + 1)
      .join('\n')
      .replace(/<[^>]+>/g, '') // 去 html 标签
      .trim()
    if (!body) continue
    cues.push({ start: tsToSec(tm[1]), end: tsToSec(tm[2]), text: body })
  }
  return cues
}

export function parseAss(text: string): SubtitleCue[] {
  const cues: SubtitleCue[] = []
  const lines = text.replace(/\r/g, '').split('\n')
  let fieldCount = 10
  for (const line of lines) {
    const t = line.trim()
    if (/^\[Events\]/i.test(t)) continue
    const fmt = /^Format\s*:\s*(.+)$/i.exec(t)
    if (fmt) {
      fieldCount = fmt[1].split(',').length
      continue
    }
    if (!/^Dialogue\s*:/i.test(t)) continue
    const payload = t.replace(/^Dialogue\s*:\s*/i, '')
    const parts = payload.split(',')
    if (parts.length < fieldCount) continue
    const start = tsToSec(parts[1])
    const end = tsToSec(parts[2])
    const body = parts.slice(fieldCount - 1).join(',').trim()
    if (!body) continue
    const cleaned = body
      .replace(/\{[^}]*\}/g, '') // 去 override tag
      .replace(/\\N|\\n/g, '\n')
      .replace(/\\h/g, ' ')
    cues.push({ start, end, text: cleaned })
  }
  return cues
}

export function parseSubtitle(name: string, text: string): SubtitleCue[] {
  if (/\.vtt$/i.test(name)) return parseVtt(text)
  if (/\.(ass|ssa)$/i.test(name)) return parseAss(text)
  return parseSrt(text)
}

export function activeCues(cues: SubtitleCue[], time: number): SubtitleCue[] {
  if (!cues.length) return []
  // 字幕一般稀疏，线性扫足够（万级 cue 也可接受；如卡顿可改二分）
  return cues.filter((c) => time >= c.start && time <= c.end)
}
