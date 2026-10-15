import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import VideoOverlay from './video/VideoOverlay'
import { useStore } from './store/useStore'
import './styles/global.css'
import './styles/media.css'
// folia 移植层：Tailwind 4（跳过 Preflight）+ folia 自己的 i18n 实例（react-i18next）
import './folia-entry.css'
import './folia/i18n/config'

// 同一个 dist 被三种窗口复用：
//   主窗口          —— 整个 MAGI
//   #vp-overlay     —— 视频播放的透明覆盖 UI（mpv 的视频窗口在它下面画像素）
const overlay = window.location.hash.replace(/^#/, '') === 'vp-overlay'

// 开发期调试钩子：浏览器 / 无头 CDP 里可直接操作播放状态
if (import.meta.env.DEV) (window as unknown as Record<string, unknown>).__magiStore = useStore

ReactDOM.createRoot(document.getElementById('root')!).render(overlay ? <VideoOverlay /> : <App />)
