## MAGI v2.1.0 — folia 一比一移植 + 内嵌 mpv 真 HDR 视频

这一版把上一版"参考 folia 做的形态"整个换掉了：音频播放界面现在是**folia-major 的源码本身**。

### 音频：folia 一比一移植

不再仿写，而是按 **import 闭包整体搬运** —— 把 folia-major 的播放相关代码 1039 个文件原样复制进 `src/folia/`，再用别名 `@ → src/folia` 让 folia 内部的 `@/xxx` 与相对引用原样成立（folia 的 `src/` ≡ MAGI 的 `src/folia/`）。**没有重写一行 UI 代码**，所以界面、动效、状态机、样式都与上游一致。

- **底部播放条**：folia 原版 Folium 胶囊进度条，全局常驻；首页态收成一条细进度胶囊，**悬停展开**
- **Lattice 全屏舞台**：大封面海报墙 + 世界层 + 逐行歌词 + 铬层工具 + 播放队列，framer-motion 转场
- **逐字歌词**：pixi 8 渲染，标准 LRC 与增强型逐字都支持（同名 `.lrc` 或 ID3 内嵌），带歌词快慢微调与译文字幕叠加
- **14 种可视化模式**：`cadenza` `cappella` `claddagh` `classic` `diorama` `fume` `lumiere` `monet` `partita` `pendolo` `sonnet` `still` `tempera` `tilt`，另有 6 种背景模式；每种独立分包按需加载
- 样式用 Tailwind 4 分层引入并**跳过 preflight**，避免 reset 冲掉既有的手写样式

> **移植时的两处必要改动**：① folia 的 3 处 Web Worker 路径在 MAGI 里被禁用（打包后渲染层走 `file://`，Worker 脚本加载不可靠；这三处在 MAGI 都是死代码——元数据改由主进程提供，歌词解析改为同步就地计算，automix 分析退回主线程跑同一套数学）。② folia 依赖 `file-type@^21` 的 `./core` 导出，MAGI 的 `music-metadata@12` 带的是 `file-type@22`，已改为根导入。

### 视频：内嵌 mpv，真 HDR

Chromium 的 `<video>` 在 Windows 上拿不到 HDR 色彩直通，所以视频改由**随包分发的便携 mpv**（v0.41.0 + libplacebo v7.375.0）解码：

- **真 HDR 直通**：`--vo=gpu-next --gpu-api=d3d11 --target-colorspace-hint=yes`，并走 `--hwdec=auto-safe` 硬解
- **全格式**：mpv/FFmpeg 支持的容器与编码基本都能放，不再受 Chromium 内核限制
- **窗口结构**：mpv 用 `--wid` 嵌进一个专用的原生视频窗口（原生子窗口永远画在网页内容之上，UI 压不住它），控制 UI 由**另一个透明覆盖窗口**承载，两层尺寸位置始终跟随主窗口 —— 观感仍是「视频在 MAGI 里」
- **通信**：mpv JSON IPC over Windows 命名管道，`observe_property` 实时回推 时间轴 / 时长 / 缓冲 / 暂停 / 音量 / 静音 / 倍速 / 分辨率 / EOF
- **控制 UI**：左右拖动快进快退（OSD 提示）、双击左右 ±10s、双击中间全屏、长按 2 倍速、滚轮调音量；控制栏 3 秒无操作自动隐藏；倍速 0.5x–2x；画面比例（适应/裁剪/拉伸）；截图保存；外挂 `.srt`/`.vtt`/`.ass`（自动优先挂中文字幕）+ 内封字幕轨道选择、字号位置可调；队列连播、断点续播、播完自动下一集；键盘 空格 / ←→ / ↑↓ / F / M / Esc
- **降级**：机器上找不到 mpv 会自动退回 Chromium `<video>` 播放器，功能不丢、只是没有 HDR 直通

### 说明

- 安装包体积明显变大（安装版 146 MB / 便携版 125 MB）是因为 **115 MB 的 mpv 随包分发**。从源码自建时按 README「打包」一节把 mpv 放到 `resources/mpv/` 即可；不放也能构建，视频会降级。
- `mpv.exe` 超过 GitHub 单文件 100 MB 上限，因此不入库（`.gitignore` 已排除 `resources/mpv/`），但**随下面两个安装包分发**。

### 文件

| 文件 | 说明 |
| --- | --- |
| `MAGI Setup 2.1.0.exe` | NSIS 安装版，可选安装目录、建桌面快捷方式 |
| `MAGI-portable-2.1.0.exe` | 免安装单文件 |

**Windows x64。** 当前仅构建 Windows 安装包。
