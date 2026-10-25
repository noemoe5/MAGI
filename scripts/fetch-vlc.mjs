#!/usr/bin/env node
/**
 * 下载便携版 libVLC 到 vendor/vlc/
 *
 * 为什么单独拉：VLC 3.0.21 解压后约 180 MB，超过 GitHub 单文件 100 MB 上限，
 * 不入库。任何人 clone 后跑一次这个脚本就能拿到与发布版一致的内核。
 *
 *   node scripts/fetch-vlc.mjs
 *
 * 装完之后 `npm run build && npx electron-builder --dir` 会把 vendor/vlc
 * 原样复制进 resources/vlc，运行时由 electron/vlc.cjs 用 koffi 加载 libvlc.dll。
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { pipeline } from 'node:stream/promises'
import { Readable } from 'node:stream'
import unzipper from 'unzipper'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.join(HERE, '..')
const VENDOR = path.join(ROOT, 'vendor')
const TARGET = path.join(VENDOR, 'vlc')
const ZIP = path.join(VENDOR, 'vlc-3.0.21-win64.zip')

// 版本固定：libVLC 的 ABI 跨大版本不保证兼容，vlc.cjs 里的函数签名按 3.0.x 写的
const VERSION = '3.0.21'
const URLS = [
  `https://mirrors.tuna.tsinghua.edu.cn/videolan-ftp/vlc/${VERSION}/win64/vlc-${VERSION}-win64.zip`,
  `https://mirrors.ustc.edu.cn/videolan-ftp/vlc/${VERSION}/win64/vlc-${VERSION}-win64.zip`,
  `https://get.videolan.org/vlc/${VERSION}/win64/vlc-${VERSION}-win64.zip`
]

const log = (...a) => console.log('[vlc]', ...a)

async function download(url, dest) {
  log('下载', url)
  const res = await fetch(url, { redirect: 'follow' })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const total = Number(res.headers.get('content-length') || 0)
  let got = 0
  let lastPrint = 0
  const src = Readable.fromWeb(res.body)
  src.on('data', (c) => {
    got += c.length
    const now = Date.now()
    if (now - lastPrint > 1000) {
      lastPrint = now
      const pct = total ? ((got / total) * 100).toFixed(1) + '%' : ''
      process.stdout.write(`\r[vlc] ${(got / 1048576).toFixed(1)} MB ${pct}   `)
    }
  })
  await pipeline(src, fs.createWriteStream(dest))
  process.stdout.write('\n')
  if (total && got !== total) throw new Error(`下载不完整：${got}/${total}`)
  log('下载完成', (got / 1048576).toFixed(1), 'MB')
}

async function main() {
  if (fs.existsSync(path.join(TARGET, 'libvlc.dll'))) {
    log('已存在，跳过：', TARGET)
    return
  }
  fs.mkdirSync(VENDOR, { recursive: true })

  if (!fs.existsSync(ZIP)) {
    let ok = false
    for (const u of URLS) {
      try { await download(u, ZIP); ok = true; break } catch (e) { log('失败：', e.message) }
    }
    if (!ok) throw new Error('所有镜像都下载失败，请检查网络或手动放进 vendor/')
  } else {
    log('压缩包已存在，直接解压')
  }

  log('解压中…')
  const tmp = path.join(VENDOR, '_unzip')
  fs.rmSync(tmp, { recursive: true, force: true })
  fs.mkdirSync(tmp, { recursive: true })
  await pipeline(
    fs.createReadStream(ZIP),
    unzipper.Extract({ path: tmp })
  )

  // zip 里是一层 vlc-<ver> 目录，摊平到 vendor/vlc
  const inner = fs.readdirSync(tmp).map((n) => path.join(tmp, n)).find((p) => fs.statSync(p).isDirectory())
  if (!inner) throw new Error('压缩包结构异常：找不到顶层目录')
  fs.rmSync(TARGET, { recursive: true, force: true })
  fs.renameSync(inner, TARGET)
  fs.rmSync(tmp, { recursive: true, force: true })
  fs.rmSync(ZIP, { force: true })

  if (!fs.existsSync(path.join(TARGET, 'libvlc.dll'))) throw new Error('解压后没有 libvlc.dll')
  const size = fs.readdirSync(TARGET).length
  log('完成：', TARGET, `(${size} 个顶层条目)`)
}

main().catch((e) => {
  console.error('[vlc] 失败：', e.message)
  process.exit(1)
})
