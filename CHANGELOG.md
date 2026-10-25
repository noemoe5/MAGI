# 更新日志

本项目遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

## [2.2.0] — 2026-10-25

音乐层与视频层的内核整体换掉。**这是破坏性变更**：`src/folia/` 移植层（1039 文件）与内嵌 mpv 方案全部移除，不再有任何保留接口。阅读器（EPUB / TXT）行为未变。

### 变更

- **音乐：弃用 folia 移植 → 自研 foobar2000 / MusicBee 范式曲库**（`src/music/`）
  - 左侧媒体库树：全部 / 最近添加 / 最常播放 / 从未播放，以及按 艺术家 / 专辑 / 流派 / 年份 / 文件夹 实时聚合（`LibraryTree.tsx`，折叠态默认收起）。
  - 右侧多列可排序表格：`# / 标题 / 艺术家 / 专辑 / 年份 / 时长 / 规格`，`#` 列默认按专辑内曲序（foobar 语义），规格列压成 `FLAC 44.1k 24bit`。
  - 底部扁平传输条（`TransportBar.tsx`）是全应用**唯一**的 `<audio>` 宿主，与 zustand store 双向绑定；顶部细线可拖拽 seek。
  - 队列跟随当前筛选结果，双击某行即用「筛后列表」重建播放队列，与 foobar 行为一致。
  - 视觉按桌面音乐管理器的密度调：行高 27px、等宽数字、斑马纹、`content-visibility: auto` 跳过屏外渲染。
  - 原 folia 的 14 种可视化 / Lattice 歌曲墙 / pixi 逐字歌词随移植层一并移除——它们依赖在线歌词 provider 与账号态，在纯本地场景下是 noop + 崩溃来源。
- **视频：内嵌 mpv → libVLC 3.0.21**（`electron/vlc.cjs`）
  - 用 **koffi**（N-API 预编译）直接 FFI 加载 `libvlc.dll`，不需要 MSVC / node-gyp，Windows 上开箱可用。
  - `libvlc_media_player_set_hwnd()` 把 vout 挂进原生子窗口：`videoWin`（`focusable:false`，只提供 HWND）+ `overlayWin`（透明，承载控制 UI）。
  - 状态改用 **10Hz 轮询** `get_state / get_time / get_length / audio_get_volume`，不再解析 `libvlc_event_t`——那是带 union 的 C 结构体，跨 FFI 读极易错位。
  - 字幕走 `libvlc_media_player_add_slave()`；字号/位置改动需 `reloadKeepingPosition()` 重载（freetype 参数在 vout 建窗时即固定）。
  - 硬解默认 `--avcodec-hw=d3d11va`，`--file-caching=1200` + `--drop-late-frames` 防止本地大码率片源追帧。

### 修复

- **`libvlc_media_new_path` 返回 NULL**：VLC 3.0 Windows 版不认 `D:/x.mp4` 这种正斜杠路径，统一由 `toVlcPath()` 归一回反斜杠。
- **VLC 自开独立窗口而不嵌入**：`set_hwnd` 必须早于 `play()`，顺序写反就逃出窗口。
- **插件加载失败**：`--plugin-path` 在 libvlc 3.x 已废弃，改走环境变量 `VLC_PLUGIN_PATH` + dll 同级 `plugins/` 目录。
- **`libvlc_media_player_set_aspect_ratio` 符号不存在**：该 API 在 3.0 已移除，改用 `video_set_aspect_ratio` + `video_set_crop_geometry` + `video_set_scale` 三件套。
- `tsc --noEmit` 报 `Property 'env' does not exist on type 'ImportMeta'`：删 folia 时带走了 `vite/client` 类型引用，补 `src/vite-env.d.ts`。

### 移除

- `src/folia/`（1039 文件）、`src/folia-entry.css`、`src/media/FoliaMediaLayer.tsx`、`src/media/MagiPlayerPanel.tsx`、`src/media/foliaBridge.ts`、`src/components/AudioPlayerBar.tsx`、`src/components/NowPlaying.tsx`。
- `electron/mpv.cjs`、`dev/`、`postcss.config.mjs`、`vite.config.ts` 里的 `icuFoliaDataPlugin()` / `commandPinyinPlugin()` / `@ → src/folia` 别名 / 全部 `__BUILD_*` define。
- 依赖 **34 → 8**（`epubjs, framer-motion, koffi, music-metadata, react, react-dom, unzipper, zustand`）。

### 构建

- 渲染层产物 **数十 MB → 0.85 MB**（3 files），`node_modules` 1000+ → 437 项。
- `extraResources`：`resources/mpv` → `vendor/vlc` → 包内 `resources/vlc`；`asarUnpack` 加 `node_modules/koffi/**/*`（原生模块不能留在 asar 里）。
- 输出目录 `../nr_out` → `../magi_out`。
- 新增 `scripts/fetch-vlc.mjs`：从清华 / 中科大 / 官方三镜像回退下载 VLC 3.0.21 win64 并解压到 `vendor/vlc/`（CI 与本地共用）。
- 新增验收探针：`npm run probe:video`（11 项：播放推进 / seek / 音量 / 静音 / 速率 / 暂停恢复 / 轨道 / 比例三态 / 截图 / 关闭复位）、`npm run probe:music`（页面结构 / 列排序 / 分组筛选 / 双击播放 / 传输条 / 音量进度）。

### 许可

- 仍以 **AGPL-3.0-or-later** 发布。注意理由已变：2.2.0 之前是因为移植了 AGPL 的 folia-major 而必须沿用；`src/folia/` 删除后不再构成强制约束，本项目继续沿用同一许可证。

### 基础设施（随本版一起落地）

- `.github/workflows/ci.yml`：每次 push / PR 跑 `node --check electron/*.cjs`、`tsc --noEmit`、`vite build`。
- `.github/workflows/release.yml`：推 `v*` 标签自动拉 libVLC、构建 NSIS + portable 并上传 Release。
- `package.json` 补齐 `license` / `repository` / `bugs` / `homepage` / `keywords` / `engines`。

## [2.1.1] — 2026-10-15

补上 folia 的播放页（大封面 / 歌词 / 桌面播放形式）。

### 修复

- **播放页（`player` 档）补齐**：闭包新增 `PlayerPanel.tsx` + `buildPlayerPanelModel.ts`（入口 4 → 6，340 文件 / 64925 行），并加 MAGI 适配层 `src/media/MagiPlayerPanel.tsx`。
- **歌曲封面不显示**：`UnifiedPanel` 侧栏原先被 `AnimatePresence { isOpen && … }` 挡着；现在进播放页默认展开侧栏（512px 大封面 + 五个标签页）。
- **歌词不显示**：根因是 `useAppViewStore.view` 从没被写过，`resolveVisualizerShowText` 恒为 `false`。现在 `nowPlayingOpen` / `playView` 会同步进该 store。
- **「桌面播放形式」分层还原**：可视化器 `z-0` → 歌曲墙 `z-10`（仅 `lattice`）→ 侧栏 `z-60`。

## [2.1.0] — 2026-10-14

- folia-major 播放层整体移植进 `src/folia/`（`@` 别名指过去），底部播放条 / Lattice 歌曲墙 / pixi 逐字歌词 / 14 种可视化 + 6 种背景可用。
- 移植必要改动：3 处 Web Worker 禁用（元数据改由主进程 `mediaProbe`、歌词解析改同步）、`file-type` 导入路径、由 MAGI 侧写入 `useAppViewStore.view`。

## [2.0.x] — 2026-10

- 视频层改用内嵌便携 mpv（`--wid` 嵌入 + JSON IPC over named pipe），支持真 HDR 直通、全格式解码、外挂/内封字幕、手势与快捷键，找不到 mpv 时回落 Chromium `<video>`。
- 文献查阅中心：划词查阅、本地词库 + 百度百科 / 萌娘百科 / 维基 / DuckDuckGo 多源、学术文献库与 GB/T 7714-2015 / APA 7th 著录。
- 大文件 EPUB：主进程 `unzipper` 流式解压 + 本地 HTTP 目录模式（实测 657MB / 394 章：解压 7.7s，打开 0.2s）。

## [1.x] — 2026-08

- 初版（NovelReader）：EPUB / TXT 阅读、书架、书签标注、双阅读模式、GPT-SoVITS 朗读、中英双语界面。
