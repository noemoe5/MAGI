// 网络流入口判定的单测：不需要 libvlc.dll，只验「哪条入口 + 挂哪些 option」。
// 用法: node scripts/test-stream-plan.mjs
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const { planMedia, isRemoteUrl } = require('../electron/vlc.cjs')

let pass = 0
const fails = []
function check(name, cond, detail) {
  if (cond) { pass++; return }
  fails.push(`${name}${detail ? ' → ' + detail : ''}`)
}

// 1. 协议判定
const remoteCases = [
  'https://a.com/x/index.m3u8',
  'http://a.com/v.mp4',
  'rtsp://1.2.3.4/live',
  'rtmp://live/a',
  'mms://old/wm'
]
for (const u of remoteCases) check(`识别网络流 ${u}`, isRemoteUrl(u) === true)

const localCases = ['D:\\v\\a.mkv', 'D:/v/a.mkv', '\\\\nas\\share\\a.mp4', 'relative.mp4']
for (const p of localCases) check(`不误判本地 ${p}`, isRemoteUrl(p) === false)

// 2. 本地路径归一（VLC 3 在 Windows 只认反斜杠）
const p1 = planMedia('D:/v/a.mkv')
check('本地走 path 入口', p1.remote === false)
check('正斜杠转反斜杠', p1.source === 'D:\\v\\a.mkv', p1.source)
check('本地不挂网络 option', p1.options.length === 0, JSON.stringify(p1.options))

// 3. 网络流
const p2 = planMedia('https://cdn.com/live/index.m3u8')
check('网络走 location 入口', p2.remote === true)
check('URL 原样保留', p2.source === 'https://cdn.com/live/index.m3u8', p2.source)
check('默认 UA', p2.options.some((o) => o.startsWith(':http-user-agent=')), JSON.stringify(p2.options))
check('默认无 referer', !p2.options.some((o) => o.includes('http-referrer')), JSON.stringify(p2.options))
check('默认缓冲 1500', p2.options.includes(':network-caching=1500'), JSON.stringify(p2.options))

// 4. Referer / UA 覆盖 / 缓冲钳制
const p3 = planMedia('https://cdn.com/x.m3u8', { headers: { Referer: 'https://site.com/', 'User-Agent': 'Mozilla/5.0' } })
check('带 Referer', p3.options.includes(':http-referrer=https://site.com/'), JSON.stringify(p3.options))
check('UA 可覆盖', p3.options.includes(':http-user-agent=Mozilla/5.0'), JSON.stringify(p3.options))

check('缓冲下限 500', planMedia('https://c/x.m3u8', { networkCaching: 10 }).options.includes(':network-caching=500'))
check('缓冲上限 8000', planMedia('https://c/x.m3u8', { networkCaching: 999999 }).options.includes(':network-caching=8000'))

// 5. 前后空格不该带进 VLC
check('URL 去空格', planMedia('  https://c/x.m3u8  ').source === 'https://c/x.m3u8')

console.log(`通过 ${pass} 条`)
if (fails.length) {
  console.log('失败:')
  for (const f of fails) console.log('  ✗ ' + f)
  process.exit(1)
}
console.log('全部通过')
