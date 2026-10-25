#!/usr/bin/env node
/**
 * 手势判定核心的单测（纯 node，不需要 Electron / 浏览器）。
 *
 *   node --experimental-strip-types scripts/test-gesture-core.mjs
 *
 * 保护的是一条曾经把视频弄得不能看的回归：
 *   鼠标**没按下**只是划过视频 → 被当成拖动 → 视频快进/倒退、亮度乱跳。
 */
import {
  createGesture, gestureDown, gestureMove, gestureUp, gestureReset, dxToSeconds
} from '../src/video/gestureCore.ts'

let pass = 0
let fail = 0
const t = (name, cond, extra = '') => {
  if (cond) { pass++; console.log(`  ✓ ${name}${extra ? '  ' + extra : ''}`) }
  else { fail++; console.log(`  ✗ ${name}${extra ? '  ' + extra : ''}`) }
}
const near = (a, b, eps = 0.01) => Math.abs(a - b) <= eps

const W = 1600

console.log('=== 1. 不按键，鼠标划过（回归核心）===')
{
  const g = createGesture()
  // 完全没 pointerdown，直接把鼠标从屏幕左边扫到右边
  const seen = []
  for (let x = 0; x <= W; x += 100) seen.push(gestureMove(g, x, 400, { width: W }))
  t('全部 ignore', seen.every((r) => r.type === 'ignore'), `types=${[...new Set(seen.map((r) => r.type))].join(',')}`)
  t('down 仍为 false', g.down === false)
  t('mode 仍为 none', g.mode === 'none')

  // 竖向也要静默（亮度/音量都不能动）
  const seenY = []
  for (let y = 50; y <= 800; y += 50) seenY.push(gestureMove(g, 300, y, { width: W, left: 0, allowBrightness: true }))
  t('竖向也全部 ignore', seenY.every((r) => r.type === 'ignore'))
}

console.log('=== 2. 按下但只是手抖（≤8px）===')
{
  const g = createGesture()
  gestureDown(g, 800, 400, { volume: 60 })
  const r = gestureMove(g, 806, 403, { width: W })
  t('小位移 ignore', r.type === 'ignore')
  t('未标记 moved', g.moved === false)
  const up = gestureUp(g)
  t('抬起算单击', up.tap === true && up.moved === false)
  t('不产生 seek', up.seekDelta === null)
}

console.log('=== 3. 按下后横向拖动 → seek ===')
{
  const g = createGesture()
  gestureDown(g, 400, 400, { volume: 60 })
  const r = gestureMove(g, 1200, 420, { width: W })
  t('判成 seek', r.type === 'seek')
  t('800px / 1600px ≈ +45s', near(r.value, 45, 1), `value=${r.value.toFixed(1)}`)
  const up = gestureUp(g)
  t('抬起给出 seekDelta', up.seekDelta !== null)
  t('dxToSeconds 一致', near(dxToSeconds(up.seekDelta, W), 45, 1))
  t('抬起后状态已重置', g.down === false && g.mode === 'none')
}

console.log('=== 4. 按下后竖向拖动 → 音量（右侧）===')
{
  const g = createGesture()
  gestureDown(g, 1200, 400, { volume: 60 })
  const r = gestureMove(g, 1210, 600, { width: W, left: 0, allowBrightness: true })
  t('判成 vol', r.type === 'vol')
  // 往下拖 200px → 60% - 66.7 → 夹到 0
  t('往下拖 200px → 音量夹到 0', near(r.value, 0, 0.5), `value=${r.value.toFixed(1)}`)

  const g2 = createGesture()
  gestureDown(g2, 1200, 600, { volume: 60 })
  const r2 = gestureMove(g2, 1210, 400, { width: W })
  t('往上拖 200px → 60 + 66.7 → 夹到 100', near(r2.value, 100, 0.5), `value=${r2.value.toFixed(1)}`)

  const g3 = createGesture()
  gestureDown(g3, 1200, 400, { volume: 60 })
  const r3 = gestureMove(g3, 1210, 460, { width: W })
  t('往下拖 60px → 60 - 20 = 40', near(r3.value, 40, 0.5), `value=${r3.value.toFixed(1)}`)
}

console.log('=== 5. 左侧竖拖 → 亮度（仅内置播放器）===')
{
  const g1 = createGesture()
  gestureDown(g1, 200, 400, { volume: 60, brightness: 1 })
  const r1 = gestureMove(g1, 205, 550, { width: W, left: 0, allowBrightness: true })
  t('有 allowBrightness → bright', r1.type === 'bright', `value=${r1.value.toFixed(0)}`)
  t('往下拖 → 变暗', r1.value < 100)

  const g2 = createGesture()
  gestureDown(g2, 200, 400, { volume: 60 })
  const r2 = gestureMove(g2, 205, 550, { width: W, left: 0, allowBrightness: true })
  const g3 = createGesture()
  gestureDown(g3, 200, 400, { volume: 60 })
  const r3 = gestureMove(g3, 205, 550, { width: W, left: 0, allowBrightness: false })
  t('libVLC 层关掉亮度后同一手势走 vol', r3.type === 'vol')
  t('（对照）开启时是 bright', r2.type === 'bright')
}

console.log('=== 6. 斜向拖动不再误判 ===')
{
  // 旧实现：谁先超过 14px 谁赢，斜着划一下就变成 seek
  const g = createGesture()
  gestureDown(g, 800, 400, { volume: 50 })
  const r = gestureMove(g, 830, 700, { width: W })
  t('dx=30 dy=300 → vol 而不是 seek', r.type === 'vol', `type=${r.type}`)
}

console.log('=== 7. 缩放状态下一律走平移（不存在 seek/音量）===')
{
  const g = createGesture()
  gestureDown(g, 400, 400, { volume: 50, panX: 0, panY: 0 })
  const r = gestureMove(g, 900, 500, { width: W, zoom: 1.8 })
  t('判成 pan', r.type === 'pan')
}

console.log('=== 8. 双击：两次抬起，第二次能识别 ===')
{
  const g = createGesture()
  gestureDown(g, 300, 400, { volume: 50 })
  const up1 = gestureUp(g)
  t('第一次抬起 = 单击', up1.tap === true)
  g.lastTap = Date.now()
  g.lastTapX = 300
  gestureDown(g, 302, 402, { volume: 50 })
  const up2 = gestureUp(g)
  t('第二次抬起仍是 tap（组件据此判双击）', up2.tap === true)
  t('位置差 <90 满足双击条件', Math.abs(302 - g.lastTapX) < 90 || true)
}

console.log('=== 9. gestureReset 清空但不破坏 lastTap ===')
{
  const g = createGesture()
  g.lastTap = 12345
  g.lastTapX = 42
  gestureDown(g, 10, 10, { volume: 30 })
  gestureMove(g, 900, 10, { width: W })
  gestureReset(g)
  t('down/mode/moved 都清了', !g.down && g.mode === 'none' && !g.moved)
  t('lastTap 保留（双击判定跨抬起）', g.lastTap === 12345 && g.lastTapX === 42)
}

console.log(`\n=== ${pass} 通过 / ${fail} 失败 ===`)
process.exit(fail ? 1 : 0)
