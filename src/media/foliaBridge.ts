// MAGI 本地媒体库 ⇄ folia 播放层 的数据桥。
//
// folia 的播放界面（底部播放条 / Lattice 全屏台 / 逐字歌词 / 可视化器）读的是它自己的
// zustand store（usePlaybackStore）与每帧 MotionValue（motionSignals）。这个模块负责把
// MAGI 的本地音频状态翻译成 folia 的形状，并把 folia 侧的操作原样交给 MAGI 的 store。
import type { Line, LyricData, SongResult, Theme } from '../folia/types'
import { PlayerState } from '../folia/types'
import {
  setAudioSrc,
  setCachedCoverUrl,
  setCurrentLineIndex,
  setCurrentSong,
  setDuration,
  setLyricsState,
  setPlayQueue,
  setPlayerState
} from '../folia/stores/usePlaybackStore'
import {
  audioPower,
  bass,
  currentTime,
  lowMid,
  lyricCurrentTime,
  mid,
  spectrum,
  treble,
  vocal
} from '../folia/stores/motionSignals'
import { detectNonTtmlTimedLyricFormat } from '../folia/utils/lyrics/formatDetection'
import { parseLyricsByFormat } from '../folia/utils/lyrics/parserCore'
import { audioGraph } from '../lib/audioGraph'
import { mediaUrl } from '../lib/util'
import type { AudioTrack } from '../types'

const api = (): any => (window as any).electronAPI

/** folia 的默认夜间主题；强调色跟随 MAGI 的 accent，其余沿用 folia 的深色基调。 */
export function createFoliaTheme(accent?: string): Theme {
  return {
    name: 'magi',
    backgroundColor: '#09090b',
    primaryColor: '#ffffff',
    accentColor: accent || '#7dd3fc',
    secondaryColor: 'rgba(255,255,255,0.62)',
    fontStyle: 'sans',
    animationIntensity: 'normal'
  }
}

/** MAGI 的 PlayMode → folia 的循环档位 */
export function toLoopMode(mode: AudioTrack extends never ? never : string): 'off' | 'all' | 'one' {
  if (mode === 'single') return 'one'
  if (mode === 'off') return 'off'
  return 'all'
}

/** 本地曲目 → folia 的 SongResult（封面塞进 album.coverUrl，UI 直接能画） */
export function trackToSong(track: AudioTrack): SongResult {
  const song = {
    id: `local:${track.id}`,
    name: track.name,
    artists: track.artist ? [{ id: `artist:${track.artist}`, name: track.artist }] : [],
    album: { id: `album:${track.album || ''}`, name: track.album || '', coverUrl: track.cover || undefined },
    durationMs: Math.round((track.duration || 0) * 1000)
  }
  return song as unknown as SongResult
}

export function publishQueue(tracks: AudioTrack[], currentId: string | null): void {
  setPlayQueue(tracks.map(trackToSong))
  const now = currentId ? tracks.find((t) => t.id === currentId) : null
  publishTrack(now ?? null)
}

/** 换歌：把当前曲目、音源地址、封面、时长一次性写进 folia 的播放 store */
export function publishTrack(track: AudioTrack | null): void {
  setCurrentSong(track ? trackToSong(track) : null)
  setAudioSrc(track ? mediaUrl(track.path) : null)
  setCachedCoverUrl(track?.cover ?? null)
  setDuration(track?.duration ?? 0)
}

/** 传输状态：没有曲目时 folia 显示 IDLE（播放条会呈现「无曲目」态） */
export function publishPlaying(playing: boolean, hasTrack: boolean): void {
  setPlayerState(!hasTrack ? PlayerState.IDLE : playing ? PlayerState.PLAYING : PlayerState.PAUSED)
}

/** 每帧位置信号（组件在 RAF 里喂 element.currentTime） */
export function publishTime(seconds: number, lyricOffsetMs = 0): void {
  currentTime.set(seconds)
  lyricCurrentTime.set(seconds + lyricOffsetMs / 1000)
}

/** 每帧频谱信号：把 MAGI 的 Web Audio 分析结果拆成 folia 期望的频段 MotionValue */
export function publishBands(): void {
  const freq = audioGraph.getFreq()
  if (!freq || freq.length === 0) {
    audioPower.set(0)
    bass.set(0)
    lowMid.set(0)
    mid.set(0)
    vocal.set(0)
    treble.set(0)
    return
  }
  const n = freq.length
  const avg = (from: number, to: number): number => {
    const start = Math.max(0, Math.floor(n * from))
    const end = Math.min(n, Math.max(start + 1, Math.floor(n * to)))
    let sum = 0
    for (let i = start; i < end; i++) sum += freq[i]
    return sum / (end - start) / 255
  }
  bass.set(avg(0, 0.08))
  lowMid.set(avg(0.08, 0.2))
  mid.set(avg(0.2, 0.45))
  vocal.set(avg(0.45, 0.65))
  treble.set(avg(0.65, 1))
  audioPower.set(avg(0, 1))
  spectrum.set(freq as Uint8Array<ArrayBuffer>)
}

/** 当前时间落在第几句歌词（行首时间有序，二分即可） */
export function lineIndexAt(lines: Line[], seconds: number): number {
  if (!lines.length) return -1
  let lo = 0
  let hi = lines.length - 1
  let found = -1
  while (lo <= hi) {
    const mid2 = (lo + hi) >> 1
    if (lines[mid2].startTime <= seconds) {
      found = mid2
      lo = mid2 + 1
    } else {
      hi = mid2 - 1
    }
  }
  return found
}

const lyricCache = new Map<string, LyricData | null>()

const lrcStamp = (seconds: number): string => {
  const m = Math.floor(seconds / 60)
  const s = seconds - m * 60
  return `[${String(m).padStart(2, '0')}:${s.toFixed(2).padStart(5, '0')}]`
}

/**
 * 取歌词：优先同名 .lrc，其次音频内嵌（ID3/FLAC），都走 folia 自己的解析器，
 * 这样增强 LRC 的逐字时间轴、翻译行等都能被 Lattice 的渲染层直接吃下。
 */
export async function loadLyrics(track: AudioTrack): Promise<LyricData | null> {
  if (lyricCache.has(track.id)) return lyricCache.get(track.id) ?? null

  let text: string | null = null
  try {
    const side = await api()?.mediaSidecar?.(track.path)
    if (side?.lrc) text = side.lrc as string
  } catch {
    /* 无同名歌词文件 */
  }

  if (!text) {
    try {
      const meta = await api()?.mediaProbe?.(track.path)
      const synced = meta?.lyricsSynced
      if (Array.isArray(synced) && synced.length) {
        text = synced.map((l: { t: number; text: string }) => `${lrcStamp(l.t)}${l.text || ''}`).join('\n')
      } else if (meta?.lyricsPlain) {
        text = meta.lyricsPlain as string
      }
    } catch {
      /* 内嵌歌词不可读 */
    }
  }

  if (!text) {
    lyricCache.set(track.id, null)
    return null
  }

  let parsed: LyricData | null = null
  try {
    parsed = parseLyricsByFormat(detectNonTtmlTimedLyricFormat(text), text)
  } catch {
    parsed = null
  }
  lyricCache.set(track.id, parsed)
  return parsed
}

/** 写进 folia store（供 Lattice 的歌词层与播放条的时间轴弹窗读） */
export function publishLyrics(lyrics: LyricData | null): void {
  setLyricsState(lyrics)
  if (!lyrics) setCurrentLineIndex(-1)
}

export { setCurrentLineIndex }
