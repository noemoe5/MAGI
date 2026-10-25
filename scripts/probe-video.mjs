#!/usr/bin/env node
/**
 * 视频内核验收：从渲染进程驱动 libVLC，逐项验证
 *   available → open → 播放推进 → seek → 音量/速率 → 轨道 → 截图 → 关闭
 *   node scripts/probe-video.mjs <port> <视频路径>
 */
const port = Number(process.argv[2] || 9333)
const file = process.argv[3] || 'D:/ai video/H3_orbit360_v1_dark.mp4'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function main() {
  let page
  const deadline = Date.now() + 20000
  while (Date.now() < deadline) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${port}/json`)).json()
      page = list.find((t) => t.type === 'page' && t.webSocketDebuggerUrl && !t.url.includes('vp-overlay'))
      if (page) break
    } catch { /* retry */ }
    await sleep(300)
  }
  if (!page) throw new Error('找不到调试目标')

  const ws = new WebSocket(page.webSocketDebuggerUrl)
  let seq = 0
  const pending = new Map()
  const logs = []
  await new Promise((res, rej) => { ws.addEventListener('open', () => res()); ws.addEventListener('error', rej) })
  ws.addEventListener('message', (ev) => {
    const m = JSON.parse(ev.data)
    if (m.id && pending.has(m.id)) {
      const { resolve, reject } = pending.get(m.id)
      pending.delete(m.id)
      m.error ? reject(new Error(JSON.stringify(m.error))) : resolve(m.result)
      return
    }
    if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') {
      logs.push('[console.error] ' + m.params.args.map((a) => a.value ?? a.description ?? a.type).join(' ').slice(0, 240))
    }
    if (m.method === 'Runtime.exceptionThrown') {
      const d = m.params.exceptionDetails
      logs.push('[exception] ' + (d.exception?.description || d.text || '').split('\n').slice(0, 2).join(' | ').slice(0, 240))
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
      returnByValue: true, awaitPromise: true,
    })
    const v = r?.result?.value
    try { return JSON.parse(v) } catch { return v }
  }
  await send('Runtime.enable')

  const log = (k, v) => console.log(`  ${k.padEnd(16)} ${typeof v === 'object' ? JSON.stringify(v) : v}`)

  console.log('=== 1. 引擎可用性 ===')
  const avail = await ev(`window.electronAPI.vlc.available()`)
  log('available', avail)
  if (!avail?.available) { console.log('VLC 不可用，终止'); ws.close(); process.exit(1) }

  console.log('=== 2. 打开视频 ===')
  const t0 = Date.now()
  const open = await ev(`window.electronAPI.vlc.open({ id: 'probe-vid', path: ${JSON.stringify(file)}, name: 'probe', startAt: 0, subtitleFiles: [], volume: 70 })`)
  log('open', open)
  log('耗时', (Date.now() - t0) + 'ms')
  if (!open?.ok) { console.log('打开失败，终止'); ws.close(); process.exit(1) }

  console.log('=== 3. 播放状态（等 2.5s）===')
  await sleep(2500)
  const s1 = await ev(`window.electronAPI.vlc.command('get-state')`)
  log('state', s1)
  await sleep(2000)
  const s2 = await ev(`window.electronAPI.vlc.command('get-state')`)
  log('2s后', { time: s2?.time, playing: s2?.playing })
  const advanced = (s2?.time || 0) > (s1?.time || 0)
  log('时间推进', advanced ? 'YES' : 'NO (卡住)')
  log('视频尺寸', s1 ? `${s1.width}x${s1.height}` : '-')

  console.log('=== 4. seek 到 1/4 处 ===')
  const dur = s1?.duration || 0
  const target = Math.max(0.5, dur * 0.25)
  await ev(`window.electronAPI.vlc.command('seek', ${target})`)
  await sleep(900)
  const s3 = await ev(`window.electronAPI.vlc.command('get-state')`)
  log('seek目标', target.toFixed(2))
  log('seek后', s3?.time?.toFixed ? s3.time.toFixed(2) : s3?.time)
  log('seek生效', Math.abs((s3?.time || 0) - target) < 1.5 ? 'YES' : 'NO')

  console.log('=== 5. 音量 / 静音 / 速率 ===')
  await ev(`window.electronAPI.vlc.command('volume', 45)`)
  await sleep(400)
  const v1 = await ev(`window.electronAPI.vlc.command('get-state')`)
  log('音量=45 →', v1?.volume)
  await ev(`window.electronAPI.vlc.command('mute', true)`)
  await sleep(400)
  const v2 = await ev(`window.electronAPI.vlc.command('get-state')`)
  log('静音', v2?.muted)
  await ev(`window.electronAPI.vlc.command('mute', false)`)
  await ev(`window.electronAPI.vlc.command('speed', 1.5)`)
  await sleep(500)
  const v3 = await ev(`window.electronAPI.vlc.command('get-state')`)
  log('速率=1.5 →', v3?.speed)
  await ev(`window.electronAPI.vlc.command('speed', 1)`)

  console.log('=== 6. 暂停 / 继续 ===')
  await ev(`window.electronAPI.vlc.command('toggle-play')`)
  await sleep(700)
  const p1 = await ev(`window.electronAPI.vlc.command('get-state')`)
  log('暂停后', { playing: p1?.playing })
  await ev(`window.electronAPI.vlc.command('toggle-play')`)
  await sleep(700)
  const p2 = await ev(`window.electronAPI.vlc.command('get-state')`)
  log('恢复后', { playing: p2?.playing })

  console.log('=== 7. 轨道列表 ===')
  const tracks = await ev(`window.electronAPI.vlc.command('get-tracks')`)
  log('tracks', tracks)

  console.log('=== 8. 画面比例 ===')
  for (const mode of ['contain', 'cover', 'fill']) {
    const ok = await ev(`window.electronAPI.vlc.command('fit', '${mode}')`)
    log('fit ' + mode, ok)
  }
  await ev(`window.electronAPI.vlc.command('fit', 'contain')`)

  console.log('=== 9. 截图 ===')
  const shot = await ev(`window.electronAPI.vlc.screenshot('probe')`)
  log('screenshot', shot)

  console.log('=== 10. 关闭 ===')
  const closed = await ev(`window.electronAPI.vlc.close()`)
  log('close', closed)
  await sleep(600)
  const after = await ev(`window.electronAPI.vlc.command('get-state')`)
  log('关闭后state', after)

  console.log('=== 控制台错误 ===')
  if (!logs.length) console.log('  （无）')
  else logs.slice(0, 20).forEach((l) => console.log('  ' + l))
  ws.close()
}
main().catch((e) => { console.error('FATAL ' + e.message); process.exit(1) })
