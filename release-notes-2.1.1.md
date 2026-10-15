## MAGI v2.1.1 — 补上 folia 的播放页（封面 / 歌词 / 桌面播放形式）

v2.1.0 把 folia 的播放层搬进来了，但**只搬到了「歌曲墙」那一档**：`currentView === 'player'` 的整块播放页从没进过闭包。所以点开一首歌只有海报墙，没有大封面、没有歌词、也不是 folia 的桌面播放形式。这一版把缺的那一块补齐。

### 修了什么

- **播放页（`player` 档）补齐** —— 闭包新增 `PlayerPanel.tsx` + `buildPlayerPanelModel.ts`（闭包从 4 个入口长到 6 个，340 个文件 / 64925 行），外加 `UnifiedPanel` 的 MAGI 适配层 `src/media/MagiPlayerPanel.tsx`。
- **歌曲封面出来了** —— folia 的封面位只有一个，就在 `UnifiedPanel` 侧栏里（`img alt="Art"`，512px 请求尺寸 / 320px 展示）。之前侧栏被 `AnimatePresence {isOpen && …}` 挡着，封面根本没渲染。现在进播放页默认展开侧栏：大封面 + 五个标签页（封面 / 在线歌词 / 控制 / 队列 / 账户）+ 歌名 / 艺人 / 专辑。
- **歌词出来了** —— 根因不在音频数据，而在视图档位：可视化器画不画歌词只认 `resolveVisualizerShowText`，它的唯一放行条件是 `useAppViewStore.view === 'player'`，而这个 store 在 v2.1.0 里从没被写过（恒为 `'home'`），于是 `showText` 恒为 `false`，歌词浮层直接返回 `shouldRenderOverlay: false`。现在 MAGI 的 `nowPlayingOpen` / `playView` 会同步进 `useAppViewStore.view`（并给该 store 补了 module-level 的 `setView`，对齐它自己已有的导出风格）。
- **「桌面播放形式」回来了** —— 分层按 folia 原样：可视化器 `z-0` 全屏铺底（封面取色背景 + 逐字大歌词 + 底部后续行预览）→ 歌曲墙 `z-10`（只在 `lattice` 档出现）→ 侧栏 `z-60`。

### 现在的交互

| 操作 | 结果 |
| --- | --- |
| 点底部播放条胶囊 | 进**播放页**：可视化器铺底 + 侧栏大封面（folia 的默认档） |
| 播放条 / 侧栏里的「歌曲墙」 | 进 **Lattice 海报墙**（叠在可视化器之上） |
| 侧栏右下 `×` | 收起侧栏，只剩纯可视化器（歌照样唱、歌词照样走） |

### 验收

无头 CDP 探针（静态服 `dist/` → Edge headless + `Emulation.setDeviceMetricsOverride` 1600×900），走**真实路径**（对 `[data-ponder="player-bar"]` 派发真点击，而不是直接改 store）：

```
B/PLAYER   view=player  isPanelOpen=true  panel=1  coverVisible=true(320×320)
           tabs=[cover,onlineLyrics,controls,queue,account]
           panelTitle=少女☆歌劇 レヴュースタァライト | アメリカ民謡研究会 | 永遠に違うよ。
           visActiveLine=僕の今日まで  glowWordCount=15  (主歌词行真的画出来了)
D/NOPANEL  view=player  isPanelOpen=false  visActiveLine=抱きしめて  glowWordCount=15
C/LATTICE  view=lattice  lattice=1  panel=0
E/CLOSED   view=home     playerSurface=0
```

14 种可视化模式巡览：全部有 canvas；封面作为画内图像出现的只有 `monet`（莫奈），其余模式的封面走侧栏与背景取色 —— 与上游一致。

> 探针踩到的坑：假的音源播不动，`<audio>.currentTime` 钉在 0，而 `GlowWord` 的词态迁移靠 `useMotionValueEvent(currentTime, 'change')`，值不变就一次都不触发，所有词卡在 `waiting` 初态（DOM 里有、肉眼看不见）。探针里把 `currentTime` 换成可拨动的墙钟才验出真结果 —— 这不是产品缺陷。

### 其余

- 版本号 2.1.0 → 2.1.1；README 的音频段补上「播放页 / 歌曲墙」两档说明与第三处移植改动。
- `tsc --noEmit` 0 error。
- 构建与打包参数不变：`CODEBUDDY_SAFE_DELETE_ENABLED=0`，每个 target 用全新输出目录、串行跑。
