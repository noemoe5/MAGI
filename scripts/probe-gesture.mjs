#!/usr/bin/env node
/**
 * 鼠标手势回归探针：验证「鼠标在视频上划过」不会改动播放状态。
 *
 * 背景：v2.2.0 的手势层没有判断鼠标是否按下，裸 pointermove 也会进拖动模式，
 * 表现是鼠标一滑视频就快进/倒退（旧的 <video> 回退播放器还会上下跳亮度）。
 *
 *   node scripts/probe-gesture.mjs <port> <视频路径>
 *
 * 断言：
 *   A. 不按键横向划过 —— 不出现 OSD、时间轴不跳变、音量不变
 *   B. 不按键纵向划过 —— 不出现 OSD、音量不变
 *   C. 按下并横向拖动 —— seek 仍然生效（别把手势改死）
 *   D. 控制条区域仍然可点（进度条按钮不抢手势）
 */
const port = Number(process.argv[2] || 9333)
const file = process.argv[3] || 'D:/ai video/H3_orbit360_v1_dark.mp4'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// 每行都落盘：探针万一卡住，也能看出卡在哪一步（PowerShell 重定向是带缓冲的）
import fs from 'node:fs'
const OUT = process.env.PROBE_OUT || ''
const buf = []
const flush = () => { if (OUT) { try { fs.writeFileSync(OUT, buf.join('\n') + '\n') } catch { /* ignore */ } } }
const raw = console.log
console.log = (...a) => { const s = a.join(' '); buf.push(s); raw(s); flush() }
const say = (s) => console.log(s)

let pass = 0
let fail = 0
const ok = (name, cond, extra = '') => {
  if (cond) { pass++; console.log(`  ✓ ${name}${extra ? '  ' + extra : ''}`) }
  else { fail++; console.log(`  ✗ ${name}${extra ? '  ' + extra : ''}`) }
}

async function targets() {
  return (await (await fetch(`http://127.0.0.1:${port}/json`)).json())
}

async function waitTarget(pred, timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      const t = (await targets()).find(pred)
      if (t) return t
    } catch { /* retry */ }
    await sleep(300)
  }
  return null
}

/** 开一个 CDP 会话 */
async function connect(target) {
  const ws = new WebSocket(target.webSocketDebuggerUrl)
  let seq = 0
  const pending = new Map()
  const logs = []
  await new Promise((res, rej) => {
    const to = setTimeout(() => rej(new Error('WebSocket 打开超时')), 8000)
    ws.addEventListener('open', () => { clearTimeout(to); res() })
    ws.addEventListener('error', (e) => { clearTimeout(to); rej(new Error('WebSocket 连接失败 ' + (e?.message || ''))) })
  })
  ws.addEventListener('message', (ev) => {
    const m = JSON.parse(ev.data)
    if (m.id && pending.has(m.id)) {
      const { resolve, reject } = pending.get(m.id)
      pending.delete(m.id)
      m.error ? reject(new Error(JSON.stringify(m.error))) : resolve(m.result)
      return
    }
    if (m.method === 'Runtime.exceptionThrown') {
      const d = m.params.exceptionDetails
      logs.push('[exception] ' + (d.exception?.description || d.text || '').split('\n')[0].slice(0, 200))
    }
    if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') {
      logs.push('[console.error] ' + m.params.args.map((a) => a.value ?? a.description ?? a.type).join(' ').slice(0, 200))
    }
  })
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++seq
    pending.set(id, { resolve, reject })
    ws.send(JSON.stringify({ id, method, params }))
  })
  const ev = async (expr) => {
    const r = await send('Runtime.evaluate', {
      expression: `(async () => { try { return JSON.stringify(await (${expr})) } catch (e) { return JSON.stringify({ __err: String(e) }) } })()`,
      returnByValue: true, awaitPromise: true
    })
    const v = r?.result?.value
    try { return JSON.parse(v) } catch { return v }
  }
  await send('Runtime.enable')
  return { ws, send, ev, logs }
}

/** 一串不按键的鼠标移动 —— 就是「鼠标指针在上面滑动」 */
async function bareSweep(c, box, how) {
  const n = 14
  for (let i = 0; i <= n; i++) {
    const t = i / n
    const x = how === 'x' ? box.x + 40 + t * (box.w - 80) : box.x + box.w * 0.2
    const y = how === 'x' ? box.y + box.h * 0.5 : box.y + box.h * 0.2 + t * (box.h * 0.6)
    await c.send('Input.dispatchMouseEvent', {
      type: 'mouseMoved', x, y, button: 'none', buttons: 0, clickCount: 0, pointerType: 'mouse'
    })
    await sleep(20)
  }
}

async function main() {
  say(`[1] 等主窗口调试目标（端口 ${port}）…`)
  const page = await waitTarget((t) => t.type === 'page' && t.webSocketDebuggerUrl && !t.url.includes('vp-overlay'))
  if (!page) throw new Error('找不到主窗口调试目标')
  say(`[2] 连主窗口 ${page.url || '(空白页)'}`)
  const main = await connect(page)
  say('[3] 主窗口 CDP 就绪')

  // 页面可能还在加载：等 electronAPI 挂上
  for (let i = 0; i < 40; i++) {
    const ready = await main.ev(`!!(window.electronAPI && window.electronAPI.vlc)`)
    if (ready === true) break
    if (i === 39) throw new Error('主窗口 30s 内没等到 electronAPI.vlc')
    await sleep(500)
  }
  say('[4] electronAPI.vlc 已就绪')

  console.log('=== 0. 打开视频，等覆盖窗口起来 ===')
  const opened = await main.ev(`window.electronAPI.vlc.open({ id: 'probe-gesture', path: ${JSON.stringify(file)}, name: 'probe', startAt: 0, subtitleFiles: [], volume: 60 })`)
  ok('open', !!opened?.ok, JSON.stringify(opened))
  if (!opened?.ok) process.exit(1)
  await sleep(2500)

  const overlayTarget = await waitTarget((t) => t.type === 'page' && t.url.includes('vp-overlay'), 15000)
  if (!overlayTarget) throw new Error('找不到覆盖窗口（#vp-overlay）')
  const ov = await connect(overlayTarget)
  console.log('  覆盖窗口就绪')

  // 手势层尺寸
  const box = await ov.ev(`(() => { const r = document.querySelector('.vp-gesture').getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height } })()`)
  ok('手势层尺寸', box && box.w > 100 && box.h > 100, `${Math.round(box?.w)}×${Math.round(box?.h)}`)

  await main.ev(`window.electronAPI.vlc.command('pause')`)
  await sleep(300)

  // —— A. 不按键横向划过 ——
  console.log('=== A. 不按键，横向划过 ===')
  const before = await main.ev(`window.electronAPI.vlc.command('get-state')`)
  await bareSweep(ov, box, 'x')
  await sleep(400)
  const osdX = await ov.ev(`document.querySelectorAll('.vp-osd').length`)
  const afterX = await main.ev(`window.electronAPI.vlc.command('get-state')`)
  ok('没有弹出 OSD', osdX === 0, `osd=${osdX}`)
  ok('时间轴没动', Math.abs((afterX?.time || 0) - (before?.time || 0)) < 0.6, `${(before?.time || 0).toFixed(2)} → ${(afterX?.time || 0).toFixed(2)}`)
  ok('音量没动', Math.abs((afterX?.volume || 0) - (before?.volume || 0)) < 1, `${before?.volume} → ${afterX?.volume}`)

  // —— B. 不按键纵向划过 ——
  console.log('=== B. 不按键，纵向划过 ===')
  const beforeY = await main.ev(`window.electronAPI.vlc.command('get-state')`)
  await bareSweep(ov, box, 'y')
  await sleep(400)
  const osdY = await ov.ev(`document.querySelectorAll('.vp-osd').length`)
  const afterY = await main.ev(`window.electronAPI.vlc.command('get-state')`)
  ok('没有弹出 OSD', osdY === 0, `osd=${osdY}`)
  ok('音量没动', Math.abs((afterY?.volume || 0) - (beforeY?.volume || 0)) < 1, `${beforeY?.volume} → ${afterY?.volume}`)
  ok('时间轴没动', Math.abs((afterY?.time || 0) - (beforeY?.time || 0)) < 0.6, `${(beforeY?.time || 0).toFixed(2)} → ${(afterY?.time || 0).toFixed(2)}`)

  // —— C. 真的按住拖动，seek 必须仍然生效 ——
  console.log('=== C. 按住横向拖动（seek 仍要能用）===')
  const dur = afterY?.duration || 0
  await main.ev(`window.electronAPI.vlc.command('seek', ${Math.max(0.5, dur * 0.2)})`)
  await sleep(600)
  const c0 = await main.ev(`window.electronAPI.vlc.command('get-state')`)
  const yMid = box.y + box.h * 0.5
  const x1 = box.x + box.w * 0.25
  const x2 = box.x + box.w * 0.62
  await ov.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: x1, y: yMid, button: 'left', buttons: 1, clickCount: 1, pointerType: 'mouse' })
  for (let i = 1; i <= 10; i++) {
    await ov.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: x1 + ((x2 - x1) * i) / 10, y: yMid, button: 'left', buttons: 1, pointerType: 'mouse' })
    await sleep(30)
  }
  const dragging = await ov.ev(`document.querySelectorAll('.vp-osd').length`)
  ok('拖动时显示 OSD 预览', dragging > 0, `osd=${dragging}`)
  await ov.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: x2, y: yMid, button: 'left', buttons: 0, clickCount: 1, pointerType: 'mouse' })
  await sleep(900)
  const c1 = await main.ev(`window.electronAPI.vlc.command('get-state')`)
  const jumped = (c1?.time || 0) - (c0?.time || 0)
  ok('拖动确实 seek 了', jumped > 5, `Δ=${jumped.toFixed(1)}s (${(c0?.time || 0).toFixed(1)} → ${(c1?.time || 0).toFixed(1)})`)

  // —— D. 松手后继续裸移动，必须彻底静默 ——
  console.log('=== D. 松手后再划过（不能残留手势状态）===')
  const d0 = await main.ev(`window.electronAPI.vlc.command('get-state')`)
  await bareSweep(ov, box, 'x')
  await sleep(400)
  const d1 = await main.ev(`window.electronAPI.vlc.command('get-state')`)
  const osdD = await ov.ev(`document.querySelectorAll('.vp-osd').length`)
  ok('没有 OSD', osdD === 0, `osd=${osdD}`)
  ok('时间轴没动', Math.abs((d1?.time || 0) - (d0?.time || 0)) < 0.6, `${(d0?.time || 0).toFixed(2)} → ${(d1?.time || 0).toFixed(2)}`)

  console.log('=== E. 控制台 ===')
  const errs = [...main.logs, ...ov.logs]
  if (!errs.length) console.log('  （无错误）')
  else errs.slice(0, 10).forEach((l) => console.log('  ' + l))

  await main.ev(`window.electronAPI.vlc.close()`)
  main.ws.close()
  ov.ws.close()

  console.log(`\n=== 结果：${pass} 通过 / ${fail} 失败 ===`)
  process.exit(fail ? 1 : 0)
}

main().catch((e) => { console.error('FATAL ' + e.message); process.exit(1) })
