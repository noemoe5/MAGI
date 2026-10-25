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
 *
 * 三个镜像依次回退；每个镜像都走「下载 → 校验结构 → 解压 → 校验产物」，
 * 任意一步失败就换下一个，不会留半截文件。
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { pipeline } from 'node:stream/promises'
import { Readable } from 'node:stream'
import { execFileSync } from 'node:child_process'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.join(HERE, '..')
const VENDOR = path.join(ROOT, 'vendor')
const TARGET = path.join(VENDOR, 'vlc')
const ZIP = path.join(VENDOR, 'vlc-3.0.21-win64.zip')
const TMP = path.join(VENDOR, '_unzip')

// 版本固定：libVLC 的 ABI 跨大版本不保证兼容，vlc.cjs 里的函数签名按 3.0.x 写的
const VERSION = '3.0.21'
const URLS = [
  `https://mirrors.tuna.tsinghua.edu.cn/videolan-ftp/vlc/${VERSION}/win64/vlc-${VERSION}-win64.zip`,
  `https://mirrors.ustc.edu.cn/videolan-ftp/vlc/${VERSION}/win64/vlc-${VERSION}-win64.zip`,
  `https://get.videolan.org/vlc/${VERSION}/win64/vlc-${VERSION}-win64.zip`
]

const log = (...a) => console.log('[vlc]', ...a)
const MB = (n) => (n / 1048576).toFixed(1)

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
      process.stdout.write(`\r[vlc] ${MB(got)} MB ${pct}   `)
    }
  })
  await pipeline(src, fs.createWriteStream(dest))
  process.stdout.write('\n')
  // content-length 对不上就是半截文件，直接判失败换镜像——半截 zip 解压会报
  // "Premature close" 这种看不出原因的错
  if (total && got !== total) throw new Error(`下载不完整：${MB(got)} / ${MB(total)} MB`)
  log('下载完成', MB(got), 'MB')
}

/**
 * 解压：优先用 Windows 自带的 bsdtar（Win10 1803 起在 System32，能读 zip 且校验 CRC），
 * 只有在没有 bsdtar 的环境才退回 unzipper。
 *
 * 注意不能直接写 'tar'：GitHub Actions 的 bash 步骤里 PATH 首位是 Git Bash 的
 * /usr/bin，那里是 GNU tar——它根本不认 zip，会以 "This does not look like a tar
 * archive" 失败。所以这里显式走 System32 的 bsdtar。CI 上 unzipper 的 Extract
 * 流水线也会中途抛 "Premature close"，bsdtar 没这个问题。
 */
function bsdtarPath() {
  if (process.platform !== 'win32') return 'tar'
  const cand = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe')
  return fs.existsSync(cand) ? cand : 'tar'
}

async function extract(zip, dest) {
  fs.rmSync(dest, { recursive: true, force: true })
  fs.mkdirSync(dest, { recursive: true })
  for (const bin of [bsdtarPath(), 'tar']) {
    try {
      execFileSync(bin, ['-xf', zip, '-C', dest], { stdio: 'pipe' })
      log('解压完成（' + path.basename(bin) + '）')
      return
    } catch (e) {
      log('解压失败，换下一个方式：', e.message.split('\n')[0])
    }
  }
  const unzipper = (await import('unzipper')).default
  await pipeline(fs.createReadStream(zip), unzipper.Extract({ path: dest }))
  log('解压完成（unzipper）')
}

/** 摊平 zip 里那层 vlc-<ver> 目录到 vendor/vlc，并校验产物 */
function promote(dest) {
  const entries = fs.readdirSync(dest).map((n) => path.join(dest, n))
  const inner = entries.find((p) => {
    try { return fs.statSync(p).isDirectory() } catch { return false }
  })
  const srcDir = inner || dest

  if (!fs.existsSync(path.join(srcDir, 'libvlc.dll'))) {
    throw new Error('压缩包里没有 libvlc.dll，可能是镜像返回了错误页')
  }
  const pluginsSrc = path.join(srcDir, 'plugins')
  if (!fs.existsSync(pluginsSrc)) throw new Error('压缩包里没有 plugins/ 目录')

  fs.rmSync(TARGET, { recursive: true, force: true })
  if (srcDir === dest) {
    fs.renameSync(dest, TARGET)
  } else {
    fs.renameSync(srcDir, TARGET)
    fs.rmSync(dest, { recursive: true, force: true })
  }

  const dll = fs.statSync(path.join(TARGET, 'libvlc.dll')).size
  // plugins/ 下面是 29 个分类目录、合计几百个 .dll，数目录会误判，必须递归数文件
  const modules = countFiles(path.join(TARGET, 'plugins'))
  if (modules < 100) throw new Error(`plugins/ 只有 ${modules} 个文件，解压不完整`)
  log('完成：', TARGET, `(libvlc.dll ${MB(dll)} MB / plugins ${modules} 个模块)`)
  log('确认可用：node -e "require(\'koffi\').load(\'vendor/vlc/libvlc.dll\')"')
}

function countFiles(dir) {
  let n = 0
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.isDirectory()) n += countFiles(path.join(dir, e.name))
    else n++
  }
  return n
}

async function main() {
  if (fs.existsSync(path.join(TARGET, 'libvlc.dll'))) {
    log('已存在，跳过：', TARGET)
    return
  }
  fs.mkdirSync(VENDOR, { recursive: true })
  fs.rmSync(TMP, { recursive: true, force: true })

  const errors = []
  for (const url of URLS) {
    try {
      await download(url, ZIP)
      await extract(ZIP, TMP)
      promote(TMP)
      fs.rmSync(ZIP, { force: true })
      return
    } catch (e) {
      errors.push(`${url}\n    ${e.message.split('\n')[0]}`)
      log('这个镜像不行，换下一个')
      fs.rmSync(ZIP, { force: true })
      fs.rmSync(TMP, { recursive: true, force: true })
    }
  }
  throw new Error('所有镜像都下载失败：\n  ' + errors.join('\n  '))
}

main().catch((e) => {
  console.error('[vlc] 失败：', e.message)
  process.exit(1)
})
