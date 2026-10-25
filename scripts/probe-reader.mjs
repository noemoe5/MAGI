#!/usr/bin/env node
/**
 * 阅读器回归探针：打开一本真实 EPUB，逐项验证「整合之后」的阅读链路。
 *
 * 只跑探针（需先有一份带 --remote-debugging-port 在跑的应用）：
 *   node scripts/probe-reader.mjs <端口> <epub绝对路径>
 *   npm run probe:reader -- <epub绝对路径>
 *
 * 退出码：0 = 全通过；1 = 有断言失败。
 */
const port = Number(process.argv[2] || 9333)
const epubPath = process.argv[3] || ''
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function waitForTargets(timeoutMs = 25000) {
  const deadline = Date.now() + timeoutMs
  let lastErr
  while (Date.now() < deadline) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${port}/json`)).json()
      const page = list.find((t) => t.type === 'page' && t.webSocketDebuggerUrl && !t.url.includes('vp-overlay'))
      if (page) return page
    } catch (e) { lastErr = e }
    await sleep(400)
  }
  throw new Error(`等不到调试目标（端口 ${port}）：${lastErr?.message ?? 'timeout'}`)
}

function connect(url) {
  const ws = new WebSocket(url)
  let seq = 0
  const pending = new Map()
  const events = []
  const ready = new Promise((res, rej) => {
    ws.addEventListener('open', () => res())
    ws.addEventListener('error', (e) => rej(new Error('WS 失败：' + (e.message || '?'))))
  })
  ws.addEventListener('message', (ev) => {
    const msg = JSON.parse(ev.data)
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id)
      pending.delete(msg.id)
      msg.error ? reject(new Error(JSON.stringify(msg.error))) : resolve(msg.result)
    } else if (msg.method) events.push(msg)
  })
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++seq
    pending.set(id, { resolve, reject })
    ws.send(JSON.stringify({ id, method, params }))
  })
  const evaluate = async (expression) => {
    const r = await send('Runtime.evaluate', {
      expression: `(async () => { try { return JSON.stringify({ ok: true, value: (await (${expression})) }) } catch (e) { return JSON.stringify({ ok: false, error: String(e) }) } })()`,
      returnByValue: true, awaitPromise: true,
    })
    const raw = r?.result?.value
    if (typeof raw !== 'string') return { ok: false, error: 'evaluate 无返回' }
    return JSON.parse(raw)
  }
  return { ready, send, evaluate, events, close: () => ws.close() }
}

const failures = []
const pass = (t) => console.log('  ✓ ' + t)
const fail = (t) => { failures.push(t); console.log('  ✗ ' + t) }
const info = (t) => console.log('    · ' + t)

const main = async () => {
  console.log(`\nMAGI 阅读器探针（端口 ${port}）\n`)
  const target = await waitForTargets()
  const cdp = connect(target.webSocketDebuggerUrl)
  await cdp.ready
  await cdp.send('Runtime.enable')
  await cdp.send('Log.enable')
  await sleep(2500)

  // —— 0. 打开一本书 ——
  const opened = await cdp.evaluate(`(async () => {
    const st = window.__magiStore
    if (!st) return { error: '__magiStore 不存在（需 dev 构建）' }
    const s = st.getState()
    if (!s.books.length) {
      const path = ${JSON.stringify(epubPath)}
      if (!path) return { error: '没有书且未传路径' }
      s.addBooks([{ id: 'probe-' + Date.now(), path, name: '探针书', progress: 0,
                    favorite: false, status: 'unread', addedAt: Date.now(), kind: 'epub' }])
      await new Promise(r => setTimeout(r, 300))
    }
    const b = st.getState().books[0]
    st.getState().setCurrent(b.id)
    return { id: b.id, name: b.name, kind: b.kind }
  })()`)
  if (!opened.ok || opened.value?.error) { fail('打开书籍失败：' + JSON.stringify(opened.value || opened.error)); return finish(cdp) }
  pass(`已打开《${opened.value.name}》（${opened.value.kind}）`)
  await sleep(6000)

  // —— 1. 正文是否真的渲染出来 ——
  const body = await cdp.evaluate(`(() => {
    const fr = document.querySelector('.viewer iframe')
    if (!fr) return { iframe: false }
    let len = 0, txt = ''
    try { txt = fr.contentDocument?.body?.innerText || ''; len = txt.trim().length } catch (e) { return { iframe: true, err: String(e) } }
    const c = document.querySelector('.epub-container')
    return { iframe: true, len, head: txt.trim().slice(0, 40),
             containerH: c?.clientHeight ?? -1, scrollH: c?.scrollHeight ?? -1,
             viewers: document.querySelectorAll('.viewer iframe').length }
  })()`)
  const bv = body.value || {}
  bv.len > 50 ? pass(`正文已渲染（${bv.len} 字）：${JSON.stringify(bv.head)}`) : fail(`正文为空/过短：${JSON.stringify(bv)}`)

  // —— 2. 调试面板不应该出现在正常阅读界面 ——
  const dbg = await cdp.evaluate(`(() => { const d = document.querySelector('.epub-debug'); return {
      exists: !!d, text: d ? (d.innerText || '').replace(/\\s+/g, ' ').slice(0, 60) : '' } })()`)
  dbg.value?.exists ? fail(`诊断面板常驻在界面上：${dbg.value.text}`) : pass('无调试面板常驻')

  // —— 3. 正文能否被选中（划词）——关键：点击热区不能盖住文字 ——
  const hit = await cdp.evaluate(`(() => {
    const vr = document.querySelector('.viewer')?.getBoundingClientRect()
    if (!vr) return { error: 'no viewer' }
    const x = vr.left + vr.width / 2, y = vr.top + vr.height / 2
    const el = document.elementFromPoint(x, y)
    return { tag: el?.tagName, cls: el?.className || '', hitTapZone: !!el?.closest?.('.tap-zone') }
  })()`)
  hit.value?.hitTapZone
    ? fail(`阅读区中心被翻页热区拦截（elementFromPoint = ${hit.value.tag}.${hit.value.cls}）→ 划词/选字/点链接全部失效`)
    : pass(`阅读区中心可交互（命中 ${hit.value?.tag}.${hit.value?.cls}）`)

  // —— 4. 竖向模式滚动一屏 ——
  const before = await cdp.evaluate(`(() => { const c = document.querySelector('.epub-container'); return c ? c.scrollTop : -1 })()`)
  const turn = await cdp.evaluate(`(async () => {
    const z = document.querySelector('.tap-zone.right') || document.querySelector('.tap-zone.left')
    if (z) z.click()
    await new Promise(r => setTimeout(r, 700))
    const c = document.querySelector('.epub-container')
    const post = window.__magiStore.getState().books[0]
    return { scrollTop: c ? c.scrollTop : -1, progress: post?.progress, cfi: !!post?.cfi }
  })()`)
  const moved = (turn.value?.scrollTop ?? -1) !== (before.value ?? -1) || (turn.value?.progress ?? 0) > 0
  moved ? pass(`翻页生效（scrollTop ${before.value} → ${turn.value?.scrollTop}，进度 ${turn.value?.progress}%）`)
        : fail(`翻页没反应（scrollTop ${before.value} → ${turn.value?.scrollTop}）`)

  // —— 5. 切分区再回来，阅读器是否还正常 ——
  await cdp.evaluate(`(async () => { const s = window.__magiStore.getState(); s.setCurrent(null); s.setSection('music'); await new Promise(r=>setTimeout(r,1200)); const t = window.__magiStore.getState(); t.setSection('books'); const b = t.books[0]; t.setCurrent(b.id); return 1 })()`)
  await sleep(5000)
  const again = await cdp.evaluate(`(() => {
    const fr = document.querySelector('.viewer iframe')
    let len = 0
    try { len = (fr?.contentDocument?.body?.innerText || '').trim().length } catch (e) { return { err: String(e) } }
    return { len, iframes: document.querySelectorAll('.viewer iframe').length, url: location.href }
  })()`)
  const rv = again.value || {}
  rv.len > 50 ? pass(`往返切换后正文仍在（${rv.len} 字，${rv.iframes} 个 iframe）`)
              : fail(`往返切换后正文丢失：${JSON.stringify(rv)}`)

  // —— 6. 控制台错误 ——
  const errors = cdp.events
    .filter((e) => e.method === 'Log.entryAdded' && e.params?.entry?.level === 'error')
    .map((e) => e.params.entry.text)
    .filter((t) => !/Unsupported pixel format|favicon|Autofill|DevTools/i.test(t))
  errors.length === 0 ? pass('控制台无错误') : (fail(`控制台 ${errors.length} 条错误`), errors.slice(0, 6).forEach((t) => info(t.slice(0, 150))))

  const exc = cdp.events.filter((e) => e.method === 'Runtime.exceptionThrown')
    .map((e) => e.params?.exceptionDetails?.exception?.description || e.params?.exceptionDetails?.text)
  exc.length === 0 ? pass('无未捕获异常') : (fail(`${exc.length} 个未捕获异常`), exc.slice(0, 3).forEach((t) => info(String(t).slice(0, 150))))

  finish(cdp)
}

function finish(cdp) {
  try { cdp.close() } catch { /* */ }
  console.log('')
  if (failures.length === 0) { console.log('结果：全部通过 ✓\n'); process.exit(0) }
  console.log(`结果：${failures.length} 项失败 ✗\n`); process.exit(1)
}

main().catch((e) => { console.error('探针崩了：', e.message); process.exit(1) })
