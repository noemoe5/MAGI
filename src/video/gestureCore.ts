// 视频手势判定核心 —— 纯函数，不碰 DOM/React，方便单测。
//
// 为什么单独抽出来：这一层曾经出过一个致命 bug —— 没有判断「鼠标是否按下」，
// 于是裸 pointermove（鼠标只是划过视频）也会被当成拖动，表现为鼠标一滑就
// 快进/倒退、在左侧竖滑还会一路改亮度，视频根本没法看。
// 现在「没按下 = 一律 ignore」这条铁律就写在这里，两个播放器（libVLC 覆盖层
// 与内置 <video> 回退层）共用同一套判定，不会各写一份各错一遍。

export type GestureMode = 'none' | 'seek' | 'vol' | 'bright' | 'pan'

export interface GestureStart {
  volume: number
  brightness?: number
  panX?: number
  panY?: number
}

export interface GestureState {
  down: boolean
  x0: number
  y0: number
  mode: GestureMode
  dx: number
  dy: number
  moved: boolean
  startVol: number
  startBright: number
  startPanX: number
  startPanY: number
  lastTap: number
  lastTapX: number
  speedHold: boolean
}

export interface GestureEnv {
  /** 手势层宽度（px），用于把水平位移换算成秒 */
  width: number
  /** 手势层左边缘的屏幕坐标，`split` 分区要用 */
  left?: number
  /** >1.01 时竖向拖动改为平移画面 */
  zoom?: number
  /** 是否允许左三分之一竖滑改亮度（内置播放器有，libVLC 层没有） */
  allowBrightness?: boolean
}

export interface MoveResult {
  type: 'ignore' | 'seek' | 'vol' | 'bright' | 'pan'
  /** seek 时为秒数增量，vol/bright 时为 0-100 的目标值，pan 时为 -1..1 */
  value: number
}

/** 一次拖动最多对应多少秒：屏幕整宽 ≈ 90s */
export const SEEK_SPAN_SECONDS = 90
/** 起判阈值：小于这个位移一律当手抖 */
export const MOVE_THRESHOLD = 8

export function createGesture(): GestureState {
  return {
    down: false,
    x0: 0, y0: 0,
    mode: 'none',
    dx: 0, dy: 0,
    moved: false,
    startVol: 0,
    startBright: 1,
    startPanX: 0, startPanY: 0,
    lastTap: 0, lastTapX: 0,
    speedHold: false
  }
}

export function gestureDown(g: GestureState, x: number, y: number, start: GestureStart): void {
  g.down = true
  g.x0 = x
  g.y0 = y
  g.mode = 'none'
  g.dx = 0
  g.dy = 0
  g.moved = false
  g.startVol = start.volume
  g.startBright = start.brightness ?? 1
  g.startPanX = start.panX ?? 0
  g.startPanY = start.panY ?? 0
}

/**
 * 鼠标移动。**没按下时永远返回 ignore** —— 这是本文件存在的全部意义。
 */
export function gestureMove(g: GestureState, x: number, y: number, env: GestureEnv): MoveResult {
  if (!g.down) return { type: 'ignore', value: 0 }
  if (g.moved) return { type: 'ignore', value: 0 }

  g.dx = x - g.x0
  g.dy = y - g.y0
  if (Math.abs(g.dx) <= MOVE_THRESHOLD && Math.abs(g.dy) <= MOVE_THRESHOLD) {
    return { type: 'ignore', value: 0 }
  }
  g.moved = true

  const w = env.width || 1
  const zoomed = (env.zoom ?? 1) > 1.01

  if (zoomed) {
    g.mode = 'pan'
    return {
      type: 'pan',
      value: 0
    }
  }

  // 先定方向：横向明显大于纵向才算拖动进度，否则竖向按音量/亮度处理。
  // 之前是「谁先超过 14px 谁赢」，斜着划一下就可能被判成 seek。
  if (Math.abs(g.dx) > Math.abs(g.dy) * 1.2) {
    g.mode = 'seek'
    return { type: 'seek', value: (g.dx / w) * SEEK_SPAN_SECONDS }
  }

  if (Math.abs(g.dy) <= 14) {
    g.mode = 'none'
    return { type: 'ignore', value: 0 }
  }

  const leftThird = env.allowBrightness
    ? g.x0 < (env.left ?? 0) + w / 3
    : false

  if (leftThird) {
    g.mode = 'bright'
    return { type: 'bright', value: clamp100(g.startBright * 100 - (g.dy / 300) * 100) }
  }

  g.mode = 'vol'
  return { type: 'vol', value: clamp100(g.startVol - g.dy / 3) }
}

export interface UpResult {
  /** 需要提交的 seek 增量（秒）；null 表示这次抬起不涉及 seek */
  seekDelta: number | null
  moved: boolean
  /** 未移动的抬起 —— 可能是单击，也可能是双击的第一下 */
  tap: boolean
  wasSpeedHold: boolean
}

export function gestureUp(g: GestureState): UpResult {
  const res: UpResult = {
    seekDelta: g.down && g.mode === 'seek' && g.moved ? g.dx : null,
    moved: g.moved,
    tap: g.down && !g.moved,
    wasSpeedHold: g.speedHold
  }
  gestureReset(g)
  return res
}

/** 清空拖动状态，但保留 lastTap（双击判定跨两次抬起） */
export function gestureReset(g: GestureState): void {
  g.down = false
  g.mode = 'none'
  g.dx = 0
  g.dy = 0
  g.moved = false
  g.speedHold = false
}

/** 把 dx 像素增量换算成秒（移出手势时用） */
export function dxToSeconds(dx: number, width: number): number {
  return (dx / (width || 1)) * SEEK_SPAN_SECONDS
}

function clamp100(n: number): number {
  return Math.max(0, Math.min(100, n))
}
