// Web Audio 可视化：把 <audio>/<video> 元素接到 AnalyserNode 上取频谱/波形数据。
// 必须在用户手势中 attach()（AudioContext 自动播放策略），失败时静默降级为不出可视化。

export class AudioVisualizer {
  private ctx: AudioContext | null = null
  private analyser: AnalyserNode | null = null
  private source: MediaElementAudioSourceNode | null = null
  private gain: GainNode | null = null
  private failed = false
  private freq = new Uint8Array(0)
  private wave = new Uint8Array(0)

  /** 把媒体元素接入音频图；重复调用无副作用。返回是否成功。 */
  attach(el: HTMLMediaElement): boolean {
    if (this.source || this.failed) return !!this.source
    try {
      const w = window as unknown as {
        AudioContext?: typeof AudioContext
        webkitAudioContext?: typeof AudioContext
      }
      const AC = w.AudioContext || w.webkitAudioContext
      if (!AC) { this.failed = true; return false }
      this.ctx = new AC()
      this.source = this.ctx.createMediaElementSource(el)
      this.analyser = this.ctx.createAnalyser()
      this.analyser.fftSize = 2048
      this.analyser.smoothingTimeConstant = 0.82
      this.gain = this.ctx.createGain()
      this.source.connect(this.analyser)
      this.analyser.connect(this.gain)
      this.gain.connect(this.ctx.destination)
      this.freq = new Uint8Array(this.analyser.frequencyBinCount)
      this.wave = new Uint8Array(this.analyser.fftSize)
      return true
    } catch {
      this.failed = true
      this.source = null
      return false
    }
  }

  resume(): void {
    if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume().catch(() => {})
  }

  /** 取当前频谱（0-255），未 attach 时返回 null */
  getFreq(): Uint8Array | null {
    if (!this.analyser) return null
    this.analyser.getByteFrequencyData(this.freq)
    return this.freq
  }

  /** 取当前波形（0-255） */
  getWave(): Uint8Array | null {
    if (!this.analyser) return null
    this.analyser.getByteTimeDomainData(this.wave)
    return this.wave
  }

  detach(): void {
    try {
      this.source?.disconnect()
      this.analyser?.disconnect()
      this.gain?.disconnect()
      this.ctx?.close()
    } catch { /* ignore */ }
    this.source = null
    this.analyser = null
    this.gain = null
    this.ctx = null
  }
}

/** 频谱柱状可视化（Folia 形态的轻量版） */
export function drawBars(
  canvas: HTMLCanvasElement,
  data: Uint8Array,
  accent: string,
  mirror = true
): void {
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  const w = canvas.width
  const h = canvas.height
  ctx.clearRect(0, 0, w, h)
  const bars = 48
  const step = Math.floor(data.length / bars)
  const gap = 2
  const bw = (w - gap * (bars - 1)) / bars
  for (let i = 0; i < bars; i++) {
    let sum = 0
    for (let j = 0; j < step; j++) sum += data[i * step + j]
    const v = sum / step / 255
    const bh = Math.max(2, v * h * 0.92)
    const x = i * (bw + gap)
    ctx.fillStyle = accent
    const r = Math.min(bw / 2, 3)
    const y = mirror ? h - bh : (h - bh) / 2
    ctx.beginPath()
    ctx.roundRect(x, y, bw, bh, r)
    ctx.fill()
  }
}

/** 圆形波形可视化（Now Playing 封面后的光环） */
export function drawRing(
  canvas: HTMLCanvasElement,
  wave: Uint8Array,
  accent: string
): void {
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  const w = canvas.width
  const h = canvas.height
  const cx = w / 2
  const cy = h / 2
  const baseR = Math.min(w, h) * 0.32
  ctx.clearRect(0, 0, w, h)
  ctx.lineWidth = 2
  ctx.strokeStyle = accent
  ctx.beginPath()
  const n = 96
  for (let i = 0; i <= n; i++) {
    const idx = Math.floor((i / n) * (wave.length - 1))
    const v = (wave[idx] - 128) / 128
    const a = (i / n) * Math.PI * 2
    const r = baseR + v * baseR * 0.35
    const x = cx + Math.cos(a) * r
    const y = cy + Math.sin(a) * r
    if (i === 0) ctx.moveTo(x, y)
    else ctx.lineTo(x, y)
  }
  ctx.closePath()
  ctx.stroke()
}
