// 媒体导入：音频走主进程 music-metadata 探测（ID3/FLAC/MP4），视频只取路径+时长（渲染进程 loadedmetadata）
import { AudioTrack, VideoItem } from '../types'
import { uuid, encodeMediaPath } from './util'

function api(): any {
  return (window as any).electronAPI
}

const AUDIO_EXT = /\.(mp3|flac|m4a|aac|ogg|oga|opus|wav|wv|ape|wma|aiff|aif|dsf|dff|m4b|mid)$/i
const VIDEO_EXT = /\.(mp4|m4v|mkv|webm|mov|avi|flv|wmv|ts|m2ts|rmvb|3gp|mpg|mpeg|vob)$/i

export function isAudioPath(p: string): boolean { return AUDIO_EXT.test(p) }
export function isVideoPath(p: string): boolean { return VIDEO_EXT.test(p) }

/** 主进程探测返回的封面 base64 → 渲染进程缩成 dataURL（与书籍封面同思路） */
async function shrinkCover(base64: string, format: string, maxW: number): Promise<string | undefined> {
  try {
    const bin = atob(base64)
    const bytes = new Uint8Array(bin.length)
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
    const blob = new Blob([bytes], { type: format || 'image/jpeg' })
    const bitmap = await createImageBitmap(blob)
    const scale = Math.min(1, maxW / bitmap.width)
    const w = Math.max(1, Math.round(bitmap.width * scale))
    const h = Math.max(1, Math.round(bitmap.height * scale))
    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext('2d')
    if (!ctx) return undefined
    ctx.drawImage(bitmap, 0, 0, w, h)
    bitmap.close()
    return canvas.toDataURL('image/jpeg', 0.82)
  } catch {
    return undefined
  }
}

/** 导入音频文件（逐个探测元数据；解析失败的用文件名兜底仍然入轨） */
export async function importAudioFiles(paths: string[]): Promise<AudioTrack[]> {
  const out: AudioTrack[] = []
  for (const p of paths) {
    if (!isAudioPath(p)) continue
    const rawName = (p.split(/[\\/]/).pop() || 'audio').replace(/\.[^.]+$/, '')
    let info: any = null
    try {
      info = await api().mediaProbe(p)
      if (info?.error) info = null
    } catch {
      info = null
    }
    let cover: string | undefined
    if (info?.cover) cover = await shrinkCover(info.cover, info.coverFormat, 320)
    out.push({
      id: uuid(),
      path: p,
      name: (info?.title || rawName).trim(),
      artist: info?.artist || '',
      album: info?.album || '',
      albumartist: info?.albumartist || '',
      year: info?.year ? String(info.year) : '',
      genre: info?.genre || '',
      track: info?.track ?? null,
      duration: info?.duration || 0,
      lossless: info?.lossless,
      sampleRate: info?.sampleRate || 0,
      bitsPerSample: info?.bitsPerSample || 0,
      channels: info?.channels || 0,
      container: info?.container || '',
      codec: info?.codec || '',
      cover,
      addedAt: Date.now()
    })
  }
  return out
}

/** 渲染进程探测视频元数据（时长/分辨率），封面后续播放时截帧 */
export function probeVideo(src: string): Promise<{ duration: number; width: number; height: number }> {
  return new Promise((resolve) => {
    const v = document.createElement('video')
    v.preload = 'metadata'
    v.muted = true
    const done = (r: { duration: number; width: number; height: number }) => {
      v.removeAttribute('src')
      resolve(r)
    }
    v.onloadedmetadata = () => done({ duration: v.duration || 0, width: v.videoWidth || 0, height: v.videoHeight || 0 })
    v.onerror = () => done({ duration: 0, width: 0, height: 0 })
    setTimeout(() => done({ duration: 0, width: 0, height: 0 }), 8000)
    v.src = src
  })
}

export async function importVideoFiles(paths: string[], mediaBaseUrl: string): Promise<VideoItem[]> {
  const out: VideoItem[] = []
  for (const p of paths) {
    if (!isVideoPath(p)) continue
    const name = (p.split(/[\\/]/).pop() || 'video').replace(/\.[^.]+$/, '')
    const meta = await probeVideo(mediaBaseUrl + encodeMediaPath(p))
    out.push({
      id: uuid(),
      path: p,
      name,
      duration: meta.duration,
      width: meta.width,
      height: meta.height,
      addedAt: Date.now()
    })
  }
  return out
}
