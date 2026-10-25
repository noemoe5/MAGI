#!/usr/bin/env node
/**
 * MAGI 冒烟测试：连上已运行的 Electron（或 Edge/Chrome）调试端口，检查渲染层是否真的起来了。
 *
 * 用法：
 *   1) 先用调试端口启动应用
 *        electron . --remote-debugging-port=9333 --no-sandbox --in-process-gpu
 *      （在本项目里 `npm run smoke` 会自动完成这两步）
 *   2) 只跑探针：
 *        node scripts/smoke.mjs 9333
 *
 * 退出码：0 = 全通过；1 = 有断言失败。
 */

const port = Number(process.argv[2] || 9333)
const timeoutMs = Number(process.argv[3] || 20000)

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function waitForTargets() {
  const deadline = Date.now() + timeoutMs
  let lastErr
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/json`)
      const list = await res.json()
      const page = list.find((t) => t.type === 'page' && t.webSocketDebuggerUrl)
      if (page) return page
    } catch (e) {
      lastErr = e
    }
    await sleep(500)
  }
  throw new Error(`等不到调试目标（端口 ${port}）：${lastErr?.message ?? 'timeout'}`)
}

function connect(url) {
  const ws = new WebSocket(url)
  let seq = 0
  const pending = new Map()
  const events = []

  const ready = new Promise((resolve, reject) => {
    ws.addEventListener('open', () => resolve())
    ws.addEventListener('error', (e) => reject(new Error('WS 连接失败：' + (e.message || 'unknown'))))
  })

  ws.addEventListener('message', (ev) => {
    const msg = JSON.parse(ev.data)
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id)
      pending.delete(msg.id)
      msg.error ? reject(new Error(JSON.stringify(msg.error))) : resolve(msg.result)
    } else if (msg.method) {
      events.push(msg)
    }
  })

  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const id = ++seq
      pending.set(id, { resolve, reject })
      ws.send(JSON.stringify({ id, method, params }))
    })

  const evaluate = async (expression) => {
    const r = await send('Runtime.evaluate', {
      expression: `(async () => { try { return JSON.stringify({ ok: true, value: (await (${expression})) }) } catch (e) { return JSON.stringify({ ok: false, error: String(e) }) } })()`,
      returnByValue: true,
      awaitPromise: true,
    })
    const raw = r?.result?.value
    if (typeof raw !== 'string') return { ok: false, error: 'evaluate 无返回' }
    return JSON.parse(raw)
  }

  return { ready, send, evaluate, events, close: () => ws.close() }
}

function fail(msgs, text) {
  msgs.push(text)
  console.log('  ✗ ' + text)
}

function pass(text) {
  console.log('  ✓ ' + text)
}

const main = async () => {
  console.log(`\nMAGI 冒烟测试 —— 调试端口 ${port}\n`)
  const target = await waitForTargets()
  console.log(`目标页面：${target.title} (${target.url.slice(0, 80)})\n`)

  const cdp = connect(target.webSocketDebuggerUrl)
  await cdp.ready
  await cdp.send('Runtime.enable')
  await cdp.send('Log.enable')

  // 等 React 挂载 + 首屏渲染
  await sleep(2500)

  const failures = []

  const title = await cdp.evaluate('document.title')
  title.ok && title.value === 'MAGI' ? pass(`标题 = ${title.value}`) : fail(failures, `标题异常：${JSON.stringify(title)}`)

  const api = await cdp.evaluate(
    "(() => { const names = ['electronAPI','api','magi']; const hits = names.filter(n => window[n] && typeof window[n] === 'object'); return { names: hits, methods: hits.length ? Object.keys(window[hits[0]]).length : 0 } })()"
  )
  api.ok && api.value?.names?.length > 0
    ? pass(`preload 桥接可用：window.${api.value.names[0]}（${api.value.methods} 个方法）`)
    : fail(failures, 'contextBridge 桥接不可用（window.electronAPI 未注入）')

  const nav = await cdp.evaluate(
    "[...document.querySelectorAll('nav.rail button, nav.rail [role=button]')].map(e => (e.innerText || '').trim()).filter(Boolean)"
  )
  nav.ok && Array.isArray(nav.value) && nav.value.length === 3
    ? pass(`左侧三分区就位：${nav.value.join(' / ')}`)
    : fail(failures, `分区导航异常：${JSON.stringify(nav.value)}`)

  const canvas = await cdp.evaluate("document.querySelectorAll('canvas').length")
  canvas.ok ? pass(`canvas 数量 = ${canvas.value}`) : fail(failures, 'canvas 检测失败')

  const root = await cdp.evaluate("document.getElementById('root')?.childElementCount ?? -1")
  root.ok && root.value > 0 ? pass(`#root 已挂载（${root.value} 个子节点）`) : fail(failures, `#root 未挂载（${root.value}）`)

  // 语言包 IPC：主进程扫描 languages 目录后应返回 packs 数组（可以是空数组）
  const langs = await cdp.evaluate(
    "window.electronAPI.langList().then(r => ({ packs: (r?.packs || []).map(p => p.code + ':' + p.name), dirs: (r?.dirs || []).length }))"
  )
  langs.ok && Array.isArray(langs.value?.packs)
    ? pass(`语言包 IPC 可用（${langs.value.dirs} 个搜索目录，已加载 ${langs.value.packs.length} 个外部包${langs.value.packs.length ? '：' + langs.value.packs.join(', ') : ''}）`)
    : fail(failures, `语言包 IPC 异常：${JSON.stringify(langs)}`)

  // 控制台错误（渲染层崩溃/资源 404 会在这里出现）
  const errors = cdp.events
    .filter((e) => e.method === 'Log.entryAdded' && e.params?.entry?.level === 'error')
    .map((e) => e.params.entry.text)
    .filter((t) => !/Unsupported pixel format|favicon|Autofill/i.test(t))

  if (errors.length === 0) pass('控制台无错误')
  else {
    fail(failures, `控制台有 ${errors.length} 条错误`)
    errors.slice(0, 5).forEach((t) => console.log('      · ' + t.slice(0, 160)))
  }

  const exceptions = cdp.events
    .filter((e) => e.method === 'Runtime.exceptionThrown')
    .map((e) => e.params?.exceptionDetails?.exception?.description || e.params?.exceptionDetails?.text)
  if (exceptions.length === 0) pass('无未捕获异常')
  else {
    fail(failures, `有 ${exceptions.length} 个未捕获异常`)
    exceptions.slice(0, 3).forEach((t) => console.log('      · ' + String(t).slice(0, 160)))
  }

  cdp.close()
  console.log('')
  if (failures.length === 0) {
    console.log('结果：全部通过 ✓\n')
    process.exit(0)
  } else {
    console.log(`结果：${failures.length} 项失败 ✗\n`)
    process.exit(1)
  }
}

main().catch((e) => {
  console.error('冒烟测试崩了：', e.message)
  process.exit(1)
})
