# MAGI

本地影音综合体：小说阅读器 + 音乐播放器 + 视频播放器，基于 Electron 构建。阅读交互克隆 Koodo Reader；**音频播放界面是把 [folia](https://github.com/chthollyphile/folia-major) 的播放代码整体移植进来的一比一还原**（底部播放条 + Lattice 全屏舞台 + pixi 逐字歌词 + 14 种可视化模式），不是仿写；**视频播放改用内嵌 mpv 引擎**，拿到 Chromium 做不到的真 HDR 直通与全格式解码。支持 EPUB / TXT 阅读、双模式阅读、GPT-SoVITS 语音朗读。

> 名字取自 EVA 里 NERV 的三贤机——书、乐、影三个分区，一个中枢。

## ✨ 功能特性

- 📚 **书架管理**：导入 EPUB / TXT，封面墙展示，支持删除后重新导入
- 📖 **双阅读模式**：竖向滚动 / 横向翻页，设置内一键切换
- 🎨 **阅读体验**：多主题、字体 / 字号 / 行距 / 边距可调
- 📑 **导航与记忆**：目录、书签、标注、阅读进度自动保存
- 🔊 **语音朗读**：GPT-SoVITS TTS，逐句朗读、自动翻页续读
- 🔍 **文献查阅中心**：划词即查 + 搜索台 + 学术文献库 + 本地词库（见下）
- 🎵 **音乐播放（folia 一比一移植）**：见下
- 🎬 **视频播放（内嵌 mpv · 真 HDR）**：见下
- 🌐 **中英双语界面**

## 🎵 音乐播放（folia 一比一移植）

左侧导航切换「音乐」分区。这一块不是「参考 folia 做的」，而是**把 folia-major 的源码按 import 闭包整体搬进 `src/folia/`**（1039 个文件），再用别名 `@ → src/folia` 让 folia 内部的 `@/xxx` 与相对引用原样解析 —— 所以界面、动效、状态机、样式都和上游一致。

- **底部播放条**：folia 原版 Folium 胶囊进度条，随全局常驻；首页态收成一条细进度胶囊，悬停展开（点它 = 进播放页）
- **播放页**（`currentView = 'player'`，进播放层的默认档）：可视化器全屏铺底 —— 封面取色背景 + 它自带的逐字歌词与译文字幕浮层 —— 右侧展开 folia 的 `UnifiedPanel` 侧栏（512px 大封面 + 五个标签页：封面 / 在线歌词 / 控制 / 队列 / 账户）
- **Lattice 全屏舞台**（`currentView = 'lattice'`）：大封面海报墙 + 世界层 + 逐行歌词 + 铬层工具 + 播放队列，framer-motion 转场。它叠在可视化器**之上**，是播放页之外的另一档，不是播放页的替代品
- **逐字歌词**：pixi 8 渲染，标准 LRC 与增强型逐字都支持（同名 `.lrc` 或 ID3 内嵌），带歌词快慢微调与译文字幕叠加
- **14 种可视化模式**：`cadenza` `cappella` `claddagh` `classic` `diorama` `fume` `lumiere` `monet` `partita` `pendolo` `sonnet` `still` `tempera` `tilt`，另有 6 种背景模式（`common` `latent` `monet` `nomand` `sora` `url`）；每种模式独立分包按需加载，diorama 内含 three.js
- **本地音乐库**：单文件导入 / 递归扫描文件夹；ID3v2 / FLAC / Vorbis / MP4 元数据与内嵌封面（由主进程探测后下发）
- **断点续播**：每首歌记住播放位置；队列 / 音量 / 播放模式跨会话保留
- 支持 Windows SMTC 媒体键（Media Session）
- 播放引擎：HTML5 Audio + Web Audio 可视化，主进程 HTTP 服务带 Range 支持

> **移植时的三处必要改动**：① folia 的 3 处 Web Worker 路径在 MAGI 里被禁用（打包后渲染层走 `file://`，Worker 脚本加载不可靠；这三处在 MAGI 都是死代码，元数据改由主进程 `mediaProbe` 提供，歌词解析改为同步就地计算，automix 分析退回主线程跑同一套数学）。② folia 依赖 `file-type@^21` 的 `./core` 导出，MAGI 的 `music-metadata@12` 带的是 `file-type@22`，已改为 `from 'file-type'`。③ folia 的 `App.tsx` / `useAppNavigation` 没进闭包（导航要驱动 `window.history`），所以「当前在哪一档」由 MAGI 侧写入 `useAppViewStore.view` —— **这个 store 不能省**：可视化器画不画歌词只认 `resolveVisualizerShowText` 里的 `currentView === 'player'`，漏写就是「有音频、没歌词」。

## 🎬 视频播放（内嵌 mpv · 真 HDR）

左侧导航切换「视频」分区。

Chromium 的 `<video>` 在 Windows 上拿不到 HDR 色彩直通，所以视频改由**自带便携 mpv**（随包分发，`resources/mpv/mpv.exe`，v0.41.0 + libplacebo v7.375.0）解码：

- **真 HDR 直通**：`--vo=gpu-next --gpu-api=d3d11 --target-colorspace-hint=yes`，并走 `--hwdec=auto-safe` 硬解
- **全格式**：mpv/FFmpeg 支持的容器与编码基本都能放，不受 Chromium 内核限制
- **窗口结构**：mpv 通过 `--wid` 嵌进一个专用的原生视频窗口（原生子窗口永远画在网页内容之上，UI 压不住它），控制 UI 由**另一个透明覆盖窗口**承载，两层尺寸位置始终跟随主窗口 —— 观感仍是「视频在 MAGI 里」
- **通信**：mpv JSON IPC over Windows 命名管道，`observe_property` 实时回推 时间轴 / 时长 / 缓冲 / 暂停 / 音量 / 静音 / 倍速 / 分辨率 / EOF
- **控制 UI**：
  - 手势：左右拖动快进快退（OSD 提示）、双击左右 ±10s、双击中间全屏、长按 2 倍速、滚轮调音量
  - 控制栏 3 秒无操作自动隐藏，单击唤出；进度条带缓冲显示与拖拽 seek
  - 倍速（0.5x–2x）、画面比例（适应/裁剪/拉伸）、截图保存
  - 字幕：外挂 `.srt` / `.vtt` / `.ass`（自动优先挂中文字幕）+ 内封字幕轨道选择，字号 / 位置可调、开关与延迟微调
  - 播放队列连播、断点续播、播完自动下一集
  - 键盘：空格播放暂停、←/→、↑/↓ 音量、F 全屏、M 静音、Esc 退出
- **降级**：机器上找不到 mpv（例如自行构建时未带 `resources/mpv`）会自动退回 Chromium `<video>` 播放器，功能不丢、只是没有 HDR 直通

> 视频/音频文件通过主进程本地 HTTP 服务（`127.0.0.1` 随机端口 + Range）提供给播放器，仅限导入过的路径可访问。

## 🔍 文献查阅中心

一个统一的查阅模块，阅读时随取随用（阅读页顶部栏 / 书库工具栏均可呼出）。

### 1. 划词查阅
在正文里选中任意文字，底部会弹出浮条：

- **查阅** → 打开查阅面板并自动检索该词
- **收藏** → 直接存为笔记（带书名与位置）

选中即高亮，查阅面板也支持手动输入关键词检索。

### 2. 数据来源（联网 + 本地双层）

| 来源 | 用途 | 说明 |
| --- | --- | --- |
| 本地词库 | 离线兜底 | 内置 16 条文学 / 出版 / 学术词条，可自行导入扩展 |
| 百度百科 | 通用名词 | 摘要最完整（400 字级），响应约 0.1–0.3s |
| 萌娘百科 | ACG / 轻小说 / 角色名 | 站内搜索，一次返回多条相关词条 |
| 维基百科 · DuckDuckGo | 无网络限制环境 | 作为末位兜底源 |

- 匹配规则：等值 > 前缀 > 包含 > **反向包含**（划一整句也能命中句中的词条）
- 可一键关闭「联网查阅」，纯离线使用本地词库
- 联网请求统一由主进程代理（8s 超时、仅允许 http(s)、响应截断），不使用任何 API Key
- 附带「译成中/英」按钮（MyMemory 免费接口）

### 3. 收藏与本地词库
- **收藏**：查阅结果一键存为笔记，可复制、打开原文链接、随时删除
- **本地词库**：搜索 / 新增 / 导入 JSON / 导出 JSON / 恢复内置词条

### 4. 学术文献库
- 录入文献（标题 / 作者 / 年份 / 出版社 / 链接 / 标签 / 备注），可按标签与关键词筛选
- 一键生成并复制 **GB/T 7714-2015** 或 **APA 7th** 著录
- 支持关联到某本书、导入导出 JSON

所有查阅数据（笔记、文献、词库）随书库一起保存在本地 `library.json`，不上传任何服务器。

## 🛠 技术栈

| 分类 | 技术 |
| --- | --- |
| 运行时 | Electron 32 |
| 前端 | React 19 + Vite 5 + TypeScript 5 |
| 样式 | Tailwind 4（分层引入，跳过 preflight，避免冲掉既有样式） |
| 渲染 | EPUB.js 0.3.93 |
| 动画 | framer-motion 13 |
| 状态 | zustand 5 |
| 歌词渲染 | pixi.js 8 |
| 元数据 | music-metadata 12（主进程探测） |
| 视频引擎 | 便携 mpv 0.41 + libplacebo 7（`--wid` 嵌入 + JSON IPC over named pipe） |

## 📂 目录结构

```
MAGI/
├── electron/
│   ├── main.cjs           # 主进程（无边框窗口、IPC、流式解压 + 本地 HTTP 目录/媒体服务、联网代理、视频层两窗口编排）
│   ├── mpv.cjs            # mpv 控制器（--wid 嵌入、JSON IPC、状态回推、语义化 command 动词）
│   └── preload.cjs        # 桥接层（含 mpv 命名空间与 mpv:init/state/opened/closed 订阅）
├── resources/mpv/         # 随包分发的便携 mpv（mpv.exe / mpv.com / d3dcompiler_43.dll）
├── src/
│   ├── App.tsx            # 应用入口、分区导航、主题与转场
│   ├── main.tsx           # 按 location.hash 分流：主窗口渲染 App，覆盖窗口渲染 VideoOverlay
│   ├── folia/             # ★ folia-major 一比一移植代码（`@` 别名指向此处）
│   │   ├── components/    # 播放条 / Lattice 舞台 / 歌词 / 14 种可视化模式 + 6 种背景
│   │   ├── stores/        # folia 的 zustand 状态（播放、舞台、可视化设置…）
│   │   ├── services/      # 音频图、automix、元数据…
│   │   └── i18n/          # folia 自带多语言
│   ├── media/FoliaMediaLayer.tsx  # folia 播放层与 MAGI 曲库/主进程探测的对接层
│   ├── video/
│   │   ├── MpvStage.tsx   # 主窗口侧挂载点：开片、时间轴落盘、覆盖窗口事件翻译；无 mpv 时回落 HTML5
│   │   └── VideoOverlay.tsx # 透明覆盖窗口的控制 UI（手势 / 菜单 / 键盘 / OSD）
│   ├── components/        # Reader / 设置 / 目录 / 书签 / 查阅面板 / 文献库 / 音乐库 / 视频库 等
│   ├── store/useStore.ts  # 全局状态（书架、设置、进度、笔记、文献、词库、音频、视频）
│   ├── lib/tts.ts         # GPT-SoVITS TTS 客户端
│   ├── lib/lookup.ts      # 查阅引擎（本地匹配 + 多源联网 + 引用著录）
│   ├── lib/subtitle.ts    # SRT / VTT / ASS 字幕解析
│   ├── data/knowledge.json# 内置离线词库
│   ├── theme/themes.ts    # 主题与默认设置
│   └── i18n/              # 中英文案
├── index.html
└── package.json
```

## 📚 大文件支持

数百 MB 乃至 GB 级 EPUB 也能正常导入与阅读：

- 主进程用 `unzipper` **流式解压**到临时目录（内存 O(1)，不会把整本书塞进内存）
- 再用本地 `http://127.0.0.1:<随机端口>` 暴露解压目录，EPUB.js 走**目录模式**按需读取单文件，彻底绕开 JSZip 整包解压
- 实测 657MB / 394 章 EPUB：解压 7.7s，打开 0.2s

## 🚀 开发

前置：Node.js 22+

```bash
npm install
npm run electron:dev   # Vite + Electron 开发模式（热更新）
```

仅调试前端 UI 可在浏览器打开 `npm run dev`（默认 http://localhost:5173）。

## 📦 打包

```bash
npm run dist   # 产出 NSIS 安装版 + portable 单文件（输出到 ../nr_out）
npm run pack   # 仅产出解压目录 win-unpacked
```

> 受限网络环境可使用镜像加速：
> `npm_config_registry=https://registry.npmmirror.com ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/`
>
> **便携 mpv 不入库**（`mpv.exe` 约 115 MB，超 GitHub 单文件 100 MB 上限，`.gitignore` 已排除 `resources/mpv/`），但**随安装包分发**。从源码自行打包前需要先把它放到位：
>
> 1. 取 [shinchiro/mpv-winbuild-cmake](https://github.com/shinchiro/mpv-winbuild-cmake/releases) 的 `mpv-x86_64-*.7z`（国内可用 `https://gh-proxy.com/` 作前缀加速）。本仓库用的构建是 `mpv v0.41.0-1175-g492bae0768` + `libplacebo v7.375.0` + `FFmpeg N-127552`；**`gpu-next` 必须存在**，否则没有 HDR 直通。
> 2. 解压后只需要三个文件：把 `mpv.exe`、`mpv.com`、`d3dcompiler_43.dll` 放进 `resources/mpv/`（`doc/` `installer/` `*.bat` 都可以不要）。
> 3. `npm run dist` 会自动通过 `extraResources` 打进安装包，安装后的路径是 `resources/mpv/`。
>
> **不放也能构建**，只是应用里视频会降级到 Chromium `<video>`，没有真 HDR。
> 安装包体积较大（安装版约 146 MB / 便携版约 130 MB）主要就是这 115 MB 的 mpv。
>
> **同一个输出目录不要连跑多个 target**（第二次运行会清空已有的 `win-unpacked`，且可能因 `app.asar` 被锁而残缺）；每个 target 各自用全新目录。

## 🔊 TTS 配置（GPT-SoVITS）

在设置面板填写：

| 字段 | 说明 |
| --- | --- |
| base_url | GPT-SoVITS WebUI **实际端口**（常是 `987x`，**不是** `9880`；9880 是独立 `api.py` 端口） |
| 参考音频 | 参考音频文件完整路径 |
| 提示文本 / 语言 | 参考音频对应的文本与语言 |

注意：

- GPT-SoVITS 必须跑在**有 GPU 的机器**上；WebUI 需加 `--api` 参数启动才会暴露 `/tts` 接口（否则 `POST /tts` 返回 404）。
- 跨机场景：`base_url` 用局域网 IP，GPT-SoVITS 加 `--host 0.0.0.0` 允许跨机访问。

## 📥 下载

Windows 安装版（NSIS）与免安装单文件（portable）见 [Releases](https://github.com/noemoe5/MAGI/releases)。

## 📌 说明

当前版本仅构建 Windows 安装包。macOS / Linux 可自行 `npm run dist` 构建。

- 音乐播放界面代码移植自 [folia-major](https://github.com/chthollyphile/folia-major)（AGPL-3.0），视频引擎使用 [mpv](https://mpv.io/)（GPL-2.0+ / LGPL）便携构建。
- 沙箱/无 GUI 环境无法实跑验收时，可静态校验：`npx tsc --noEmit`、`npm run build`、`node --check electron/*.cjs`。
