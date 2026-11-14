// 自定义源端到端自检：真实打网络，验证「解析 → 搜索 → 取流 → 直链可播」四步。
// 用法: node scripts/test-sources.mjs [查询词] [源文件路径]
// 说明: 用 esbuild 把 TS 源就地打成临时 ESM 再加载，避免给测试单独配一套构建。
import { build } from 'esbuild'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const query = process.argv[2] || '周杰伦'
const specFile = process.argv[3] || new URL('../examples/sources/luoxue-music.json', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')

const dir = mkdtempSync(path.join(tmpdir(), 'magi-src-'))
const outfile = path.join(dir, 'custom.mjs')
await build({
  entryPoints: [new URL('../src/sources/custom.ts', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')],
  outfile,
  bundle: true,
  format: 'esm',
  platform: 'neutral',
  logLevel: 'error'
})

// 渲染层的 window.electronAPI 在 Node 里不存在，走 http.ts 的 fetch 兜底分支即可
globalThis.window = {}

const mod = await import(pathToFileURL(outfile).href)
const { parseCustomBundle, createCustomProvider } = mod

const text = readFileSync(specFile, 'utf8')
const report = parseCustomBundle(text)
console.log(`解析: 成功 ${report.specs.length} 个, 失败 ${report.errors.length} 个`)
for (const e of report.errors) console.log('   ✗ ' + e)

let allOk = true

for (const spec of report.specs) {
  const p = createCustomProvider(spec)
  const t0 = Date.now()
  let hits = []
  try {
    hits = await p.search({ query, limit: 10 })
  } catch (e) {
    allOk = false
    console.log(`\n[${spec.name}] 搜索失败: ${String(e?.message || e)}`)
    continue
  }
  console.log(`\n[${spec.name}] 搜索 ${hits.length} 条 / ${Date.now() - t0}ms`)
  for (const h of hits.slice(0, 3)) {
    console.log(`   · ${h.title}  —  ${h.subtitle || ''}  ${h.cover ? '[cover]' : ''}  id=${h.nativeId}`)
  }
  if (!p.resolveStream) {
    console.log('   (无 stream 模板，跳过取流)')
    continue
  }
  try {
    const t1 = Date.now()
    const url = await p.resolveStream(hits[0])
    console.log(`   取流 ${Date.now() - t1}ms → ${url ? url.slice(0, 90) : 'null'}`)
    if (!url) { allOk = false; continue }
    const r = await fetch(url, { headers: { Range: 'bytes=0-32767', 'User-Agent': 'MAGI/1.0' } })
    const buf = await r.arrayBuffer()
    const magic = new Uint8Array(buf.slice(0, 3))
    const isAudio = /^audio\//.test(r.headers.get('content-type') || '') || magic[0] === 0x49
    console.log(`   直链: HTTP ${r.status} ${r.headers.get('content-type')} ${buf.byteLength}B magic=${magic.join(',')} ${isAudio ? '✓ 可播' : '✗ 可疑'}`)
    if (!isAudio) allOk = false
  } catch (e) {
    allOk = false
    console.log(`   取流失败: ${String(e?.message || e)}`)
  }
}

console.log(`\n结果: ${allOk ? '全部通过' : '存在失败项'}`)
process.exit(allOk ? 0 : 1)
