#!/usr/bin/env node
/**
 * 音乐页验收：注入测试曲目 → 渲染树/表 → 排序 → 筛选 → 双击播放 → 传输条
 *   node scripts/probe-music.mjs <port>
 */
const port = Number(process.argv[2] || 9333)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const ROOT = 'D:\\MAGI测试音乐'
const SPECS = [
  ['a1', `${ROOT}\\Album A\\01 - 夜行.wav`, '夜行', 'Album A', '2021', 3.0, 1],
  ['a2', `${ROOT}\\Album A\\02 - 潮汐.wav`, '潮汐', 'Album A', '2021', 2.0, 2],
  ['a3', `${ROOT}\\Album A\\03 - 归途.wav`, '归途', 'Album A', '2021', 4.0, 3],
  ['b1', `${ROOT}\\Album B\\01 - 灯火.wav`, '灯火', 'Album B', '2023', 2.5, 1],
  ['b2', `${ROOT}\\Album B\\02 - 长夜.wav`, '长夜', 'Album B', '2023', 1.5, 2]
]

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
    if (m.method === 'Runtime.exceptionThrown') {
      const d = m.params.exceptionDetails
      logs.push('[exception] ' + (d.exception?.description || d.text || '').split('\n').slice(0, 2).join(' | ').slice(0, 200))
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
      returnByValue: true, awaitPromise: true,
    })
    const v = r?.result?.value
    try { return JSON.parse(v) } catch { return v }
  }
  await send('Runtime.enable')

  const log = (k, v) => console.log(`  ${k.padEnd(18)} ${typeof v === 'object' ? JSON.stringify(v) : v}`)

  console.log('=== 1. 注入测试曲目 ===')
  const tracks = SPECS.map(([id, path, name, album, year, duration, track]) => ({
    id, path, name, album, artist: '测试艺术家', albumartist: '测试艺术家',
    year, genre: '测试', track, duration,
    codec: 'PCM', container: 'WAV', sampleRate: 22050, bitsPerSample: 16, channels: 1,
    lossless: true, addedAt: Date.now() - Math.floor(Math.random() * 100000)
  }))
  const injected = await ev(`(async () => {
    const api = window.electronAPI
    const paths = ${JSON.stringify(tracks.map((t) => t.path))}
    await api.mediaRegister(paths)
    const s = window.__magiStore.getState()
    s.addAudioTracks(${JSON.stringify(tracks)})
    await new Promise(r => setTimeout(r, 300))
    const s2 = window.__magiStore.getState()
    s2.setSection('music')
    await new Promise(r => setTimeout(r, 2000))
    return { total: s2.audioTracks.length, section: window.__magiStore.getState().section, base: api.mediaBaseUrl() }
  })()`)
  log('注入结果', injected)

  console.log('=== 2. 页面结构 ===')
  const dom = await ev(`(() => {
    const q = (s) => document.querySelectorAll(s).length
    const tree = [...document.querySelectorAll('.mu-tree-head')].map(e => e.innerText.trim())
    const items = [...document.querySelectorAll('.mu-tree-item')].map(e => e.innerText.trim()).slice(0, 12)
    const cols = [...document.querySelectorAll('.mu-col')].map(e => e.innerText.trim())
    return {
      page: q('.mu-page'), tree: q('.mu-tree'), rows: q('.mu-row'), cols, treeHeads: tree, treeItems: items,
      firstRow: document.querySelector('.mu-row')?.innerText?.replace(/\\s+/g, ' ').slice(0, 90),
      status: document.querySelector('.mu-status')?.innerText?.replace(/\\s+/g, ' ')
    }
  })()`)
  log('页面', dom)

  console.log('=== 3. 列排序（点「时长」）===')
  const sortRes = await ev(`(async () => {
    const cols = [...document.querySelectorAll('.mu-col')]
    const dur = cols.find(c => c.innerText.includes('时长'))
    const before = [...document.querySelectorAll('.mu-row')].map(r => r.children[5]?.innerText)
    dur.click()
    await new Promise(r => setTimeout(r, 700))
    const after = [...document.querySelectorAll('.mu-row')].map(r => r.children[5]?.innerText)
    return { before, after, headerOn: dur.className.includes('on') }
  })()`)
  log('排序前', sortRes.before)
  log('排序后', sortRes.after)
  log('表头激活', sortRes.headerOn)

  console.log('=== 4. 展开「专辑」分组并筛选 Album B ===')
  const filt = await ev(`(async () => {
    const head = [...document.querySelectorAll('.mu-tree-head')].find(h => h.innerText.includes('专辑'))
    if (!head) return { error: '找不到专辑分组头' }
    head.click()
    await new Promise(r => setTimeout(r, 400))
    const items = [...document.querySelectorAll('.mu-tree-item')]
    const target = items.find(i => i.innerText.includes('Album B'))
    if (!target) return { error: '展开后仍找不到 Album B', count: items.length, sample: items.slice(0,8).map(i=>i.innerText) }
    target.click()
    await new Promise(r => setTimeout(r, 900))
    return {
      rows: document.querySelectorAll('.mu-row').length,
      albums: [...document.querySelectorAll('.mu-row')].map(r => r.children[3]?.innerText),
      status: document.querySelector('.mu-status')?.innerText?.replace(/\\s+/g, ' ')
    }
  })()`)
  log('筛选结果', filt)

  console.log('=== 5. 双击播放 ===')
  const playRes = await ev(`(async () => {
    const row = document.querySelector('.mu-row')
    row.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))
    await new Promise(r => setTimeout(r, 1500))
    const a = document.querySelector('audio')
    const st = window.__magiStore.getState()
    return {
      currentId: st.audioCurrentId, playing: st.audioPlaying, queue: st.audioQueue.length,
      audioSrc: a?.getAttribute('src')?.slice(0, 60), currentTime: a?.currentTime, duration: a?.duration,
      error: a?.error ? a.error.code : null,
      hasBar: !!document.querySelector('.tb-bar'),
      barText: document.querySelector('.tb-bar')?.innerText?.replace(/\\s+/g, ' ').slice(0, 100)
    }
  })()`)
  log('播放结果', playRes)

  console.log('=== 6. 传输条控制 ===')
  const ctrl = await ev(`(async () => {
    const btns = [...document.querySelectorAll('.tb-btn')]
    const play = btns.find(b => b.className.includes('play'))
    play.click()
    await new Promise(r => setTimeout(r, 700))
    const paused = window.__magiStore.getState().audioPlaying
    play.click()
    await new Promise(r => setTimeout(r, 700))
    const resumed = window.__magiStore.getState().audioPlaying
    const vol = document.querySelector('.tb-vol input[type=range]')
    return { pausedState: paused, resumedState: resumed, hasVolume: !!vol }
  })()`)
  log('控制', ctrl)

  console.log('=== 7. 音量与进度 ===')
  const vp = await ev(`(async () => {
    const s = window.__magiStore.getState()
    s.patchAudioPrefs({ volume: 0.42 })
    await new Promise(r => setTimeout(r, 400))
    const a = document.querySelector('audio')
    const before = a.currentTime
    s.patchAudio({ audioPosition: 1.0, audioSeekToken: s.audioSeekToken + 1 })
    await new Promise(r => setTimeout(r, 600))
    return { volume: a.volume, timeBefore: before, timeAfter: a.currentTime, pct: document.querySelector('.tb-progress-fill')?.style.width }
  })()`)
  log('音量/进度', vp)

  console.log('=== 8. 清理注入的测试曲目 ===')
  const cleaned = await ev(`(async () => {
    const s = window.__magiStore.getState()
    const ids = ['a1','a2','a3','b1','b2']
    for (const id of ids) { try { window.__magiStore.getState().removeAudioTrack(id) } catch (e) {} }
    await new Promise(r => setTimeout(r, 400))
    const ids2 = ['a1','a2','a3','b1','b2']
    return window.__magiStore.getState().audioTracks.filter(t => ids2.includes(t.id)).length
  })()`)
  log('残留测试曲目', cleaned)

  console.log('=== 控制台错误 ===')
  if (!logs.length) console.log('  （无）')
  else logs.slice(0, 15).forEach((l) => console.log('  ' + l))
  ws.close()
}
main().catch((e) => { console.error('FATAL ' + e.message); process.exit(1) })
