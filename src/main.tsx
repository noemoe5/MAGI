import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import VideoOverlay from './video/VideoOverlay'
import { useStore } from './store/useStore'
import { loadExternalLanguages } from './i18n'
import './styles/global.css'
import './styles/media.css'
import './music/music.css'

// 同一个 dist 被两种窗口复用：
//   主窗口          —— 整个 MAGI
//   #vp-overlay     —— 视频播放的透明覆盖 UI（VLC 的 vout 在它下面画像素）
const overlay = window.location.hash.replace(/^#/, '') === 'vp-overlay'

// 开发期调试钩子：无头 CDP 验收探针直接操作 MAGI 的 store 与播放状态。
// 生产构建里 import.meta.env.DEV 是 false，这段会被整体摇掉。
if (import.meta.env.DEV) {
  const w = window as unknown as Record<string, unknown>
  w.__magiStore = useStore
}

// 先把外部语言包（languages/*.json）读进来再挂载：设置面板第一次打开时语言列表就是全的。
// 读不到（浏览器里跑 / 目录为空 / json 坏了）也只当没有，内置 zh/en 永远够用。
void loadExternalLanguages().finally(() => {
  ReactDOM.createRoot(document.getElementById('root')!).render(overlay ? <VideoOverlay /> : <App />)
})
