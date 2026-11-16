// 内置源端到端自检：真实打网络，验证「搜索 → 详情 → 取流」。
// 用法: node scripts/test-builtin.mjs [查询词] [源id1,源id2]
// 说明: 用 esbuild 把 src/sources/index.ts 打成临时 ESM 再加载，避免给测试单独配构建。
import { build } from 'esbuild'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const query = process.argv[2] || '火影'
const only = (process.argv[3] || 'agedm,dm84,luoxue').split(',').map((s) => s.trim())

const dir = mkdtempSync(path.join(tmpdir(), 'magi-builtin-'))
const outfile = path.join(dir, 'sources.mjs')

await build({
  entryPoints: [path.resolve('src/sources/index.ts')],
  outfile,
  bundle: true,
  format: 'esm',
  platform: 'neutral',
  logLevel: 'error'
})

// 渲染层的 window.electronAPI 在 Node 里不存在，走 http.ts 的 fetch 兜底
globalThis.window = {}

const mod = await import(pathToFileURL(outfile).href)
const { BUILTIN_SOURCES } = mod

console.log(`查询: ${query}   目标源: ${only.join(', ')}`)

for (const p of BUILTIN_SOURCES.filter((s) => only.includes(s.id))) {
  const t0 = Date.now()
  try {
    const hits = await p.search({ query, limit: 6 })
    console.log(`\n[${p.name}] 搜索 ${hits.length} 条 / ${Date.now() - t0}ms`)
    for (const h of hits.slice(0, 3)) {
      console.log(`   · ${h.title}  —  ${h.subtitle || ''}  ${h.cover ? '[cover]' : '[无封面]'}  id=${h.nativeId}`)
    }
    if (p.detail && hits[0]) {
      const t1 = Date.now()
      const d = await p.detail(hits[0])
      console.log(`   详情 ${Date.now() - t1}ms: ${d?.leaves?.length ?? 0} 集, ${d?.facts?.length ?? 0} 条事实`)
      if (d?.leaves?.length) {
        console.log(`     首集: ${d.leaves[0].title} → ${(d.leaves[0].openUrl || d.leaves[0].playUrl || '无链接').slice(0, 72)}`)
      }
      if (d?.description) console.log(`     简介: ${d.description.slice(0, 60)}...`)
    }
    if (p.resolveStream && hits[0]) {
      const t2 = Date.now()
      const url = await p.resolveStream(hits[0])
      console.log(`   取流 ${Date.now() - t2}ms → ${url ? url.slice(0, 80) : 'null（回退 openUrl）'}`)
    }
  } catch (e) {
    console.log(`\n[${p.name}] 失败: ${String(e?.message || e)}`)
  }
}
