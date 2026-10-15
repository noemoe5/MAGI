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

// 开发期调试钩子：浏览器 / 无头 CDP 验收探针可直接操作 MAGI 与 folia 两侧的播放状态
// （folia 的歌词/封面走它自己的 store，只有把桥和后端解析器一起露出来才能在无 file:// 的
//  静态服务里注入素材做验收）。生产构建里 import.meta.env.DEV 是 false，这段会被整体摇掉。
if (import.meta.env.DEV) {
  const w = window as unknown as Record<string, unknown>
  w.__magiStore = useStore
  void Promise.all([
    import('./media/foliaBridge'),
    import('./folia/utils/lyrics/parserCore'),
    import('./folia/utils/lyrics/formatDetection'),
    import('./folia/stores/usePlaybackStore'),
    import('./folia/stores/useAppViewStore'),
    import('./folia/stores/useTypographySettingsStore'),
    import('./folia/stores/motionSignals')
  ]).then(([bridge, parserCore, formatDetection, playbackStore, appViewStore, typographyStore, motionSignals]) => {
    w.__foliaBridge = bridge
    w.__foliaParse = { ...parserCore, ...formatDetection }
    w.__foliaStore = playbackStore
    // 视图档位（歌词浮层的唯一开关）+ 字幕排版设置，探针要能直接核对它们
    w.__foliaView = appViewStore
    w.__foliaTypography = typographyStore
    w.__foliaSignals = motionSignals
  })
}

ReactDOM.createRoot(document.getElementById('root')!).render(overlay ? <VideoOverlay /> : <App />)
