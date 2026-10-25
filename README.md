# MAGI

[![Release](https://img.shields.io/github/v/release/noemoe5/MAGI?sort=semver)](https://github.com/noemoe5/MAGI/releases)
[![CI](https://github.com/noemoe5/MAGI/actions/workflows/ci.yml/badge.svg)](https://github.com/noemoe5/MAGI/actions/workflows/ci.yml)
[![License: AGPL-3.0](https://img.shields.io/badge/license-AGPL--3.0-blue.svg)](./LICENSE)
[![Platform](https://img.shields.io/badge/platform-Windows-0078d4.svg)](#-下载)
[![Electron](https://img.shields.io/badge/Electron-32-47848f.svg)](https://www.electronjs.org/)

本地影音综合体：**EPUB / TXT 阅读器 + foobar2000 式本地音乐库 + libVLC 视频播放器**，一个窗口搞定。

阅读交互沿用 Koodo Reader 的手感；音乐走 foobar2000 / MusicBee 的**曲库管理范式**（媒体库树 + 多列可排序表格 + 全局传输条），不搞播放器皮肤；视频内核换成 **libVLC**，通过 FFI 直接驱动 `libvlc.dll` 并把 vout 嵌进原生窗口。

> 名字取自 EVA 里 NERV 的三贤机——书、乐、影三个分区，一个中枢。

## ✨ 功能特性

- 📚 **书架管理**：导入 EPUB / TXT，封面墙展示，删除后可重新导入
- 📖 **双阅读模式**：竖向滚动 / 横向翻页，设置内一键切换
- 🎨 **阅读体验**：多主题、字体 / 字号 / 行距 / 边距可调
- 📑 **导航与记忆**：目录、书签、标注、阅读进度自动保存
- 🔊 **语音朗读**：GPT-SoVITS TTS，逐句朗读、自动翻页续读
- 🔍 **文献查阅中心**：划词即查 + 搜索台 + 学术文献库 + 本地词库
- 🎵 **音乐库（foobar2000 范式）**：媒体库树 + 多列排序表格 + 全局传输条
- 🎬 **视频播放（libVLC 内核）**：硬解、外挂字幕、倍速、截图、断点续播
- 🌐 **界面语言包外挂**

## 🎵 音乐库（foobar2000 / MusicBee 范式）

左侧导航切换「音乐」分区。这一块的取向是**曲库管理工具**，不是播放器皮肤：高信息密度、细行高、等宽数字、列头即排序。

**左侧媒体库树**（从曲目数据实时聚合，不额外维护索引）

- 媒体库：全部音乐 / 最近添加
- 艺术家 / 专辑 / 流派 / 年份 / 文件夹（各自可折叠，带曲目计数）
- 播放列表：最常播放 / 从未播放

**主区多列表格**

| # | 标题 | 艺术家 | 专辑 | 年份 | 时长 | 规格 |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | 安和桥 | 宋冬野 | 安和桥北 | — | 4:11 | FLAC 44.1k 24bit |

- **点列头排序**，再点一次反向；`#` 列按专辑内曲序排（foobar 的默认语义）
- 斑马纹 + 悬停高亮 + 当前播放行带标记与强调色
- 双击播放，**播放队列跟随当前筛选结果**（筛到某张专辑，播完就停在这张专辑）
- 长列表用 `content-visibility: auto` 跳过屏外渲染
- 规格列把容器/编码与采样规格压在一列，扫一眼就能分辨无损与码率档位

**全局传输条**（只要选过歌就常驻，书架 / 音乐 / 视频页都能控制）

- 顶部细进度线可拖动 seek，时间码与总时长等宽显示
- 上一首 / 播放暂停 / 下一首、音量滑杆、播放模式（顺序 / 随机 / 单曲循环）
- 底部状态栏：当前视图、曲目数、总时长、无损曲目数、播放全部 / 随机 / 从曲库移除

**其它**

- 单文件导入 / 递归扫描文件夹；ID3v2 / FLAC / Vorbis / MP4 元数据与内嵌封面由主进程探测后下发
- 每首歌记住断点；队列 / 音量 / 播放模式跨会话保留
- 支持 Windows SMTC 媒体键（Media Session）
- 播放内核：Chromium 音频栈（`<audio>` + Web Audio），主进程本地 HTTP 服务带 Range 支持

> **2.2.0 起弃用 folia 移植层。** 早期版本把 [folia-major](https://github.com/chthollyphile/folia-major) 的源码整体搬进 `src/folia/`（1039 个文件）做一比一还原，但那层移植带来大量不稳定——在线账号/歌词 providers 在本地场景全是空实现，任何一处 noop 兜不住就整块崩；同时 pixi/three 让构建体积膨胀到几十 MB。现已整体移除，改为自研的稳定实现，产物从数十 MB 降到 **0.85 MB**。

## 🎬 视频播放（libVLC 内核）

左侧导航切换「视频」分区。Chromium 的 `<video>` 在 Windows 上拿不到 HDR 色彩直通，所以视频像素交给 **libVLC 3.0.21**（便携版，随包分发在 `resources/vlc/`）。

**接入方式**

- **FFI 直调**：用 [koffi](https://koffi.dev/)（N-API 预编译，无需 MSVC / node-gyp）加载 `libvlc.dll`，不依赖本机安装 VLC，也不弹独立播放器窗口
- **HWND 嵌入**：`libvlc_media_player_set_hwnd()` 把 VLC 的 vout 挂进专用视频窗口。原生子窗口永远画在网页内容之上，所以控制 UI 由**另一个透明覆盖窗口**承载，两层尺寸位置始终跟随主窗口 —— 观感仍是「视频在 MAGI 里」
- **状态轮询而非事件回调**：`libvlc_event_t` 是带 union 的 C 结构体，跨 FFI 解析脆弱。改为 10Hz 轮询 `get_state / get_time / get_length / audio_get_volume`，纯标量读取，`Ended` / `Error` 直接判定，不会漏事件

**能力**

- 硬解：`--avcodec-hw=d3d11va`，失败自动回落软解
- 倍速 0.1x–8x、音量 / 静音、画面比例三态（适应 / 裁剪铺满 / 拉伸）
- 字幕：运行时 `add_slave` 挂外挂 `.srt` / `.vtt` / `.ass`，内封轨道切换与开关；字号与位置改动后重载媒体并**保持原播放位置**
- 截图：`libvlc_video_take_snapshot` 直接落盘到图片目录
- 播放队列连播、断点续播、播完自动下一集
- 键盘：空格播放暂停、←/→ seek、↑/↓ 音量、F 全屏、M 静音、Esc 退出
- **降级**：找不到 `libvlc.dll`（例如自行构建时未拉内核）自动退回 Chromium `<video>`，功能不丢

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

## 🌏 界面语言（语言包外挂）

界面语言不写死在代码里：往语言目录丢一个 `.json`，它就会出现在「设置 → 语言」里，删掉即消失。

| 位置 | 说明 |
| --- | --- |
| `%APPDATA%\MAGI\languages\` | 自己装的语言包，优先级最高 |
| `<安装目录>\resources\languages\` | 随包分发 |
| `<仓库根>\languages\` | 开发期直接用 |

```json
{
  "code": "ja",
  "name": "日本語",
  "strings": { "library": "本棚", "settings": "設定", "sectionMusic": "音楽" }
}
```

只写要覆盖的词条即可，没写的自动回落英文，再没有就显示键名；json 写坏会被跳过、不影响启动。设置面板里的「打开语言包目录」会直接打开用户目录。完整键表见 `src/i18n/index.ts`，模板见 `languages/_template.json`。

## ✅ 质量保障

- **静态校验**：`npx tsc --noEmit`、`node --check electron/*.cjs`、`npm run build` 三项在 CI 里每次 push / PR 都跑（`.github/workflows/ci.yml`）。
- **CDP 验收探针**：不起 GUI 也能核对真实运行结果 —— 探针连上调试端口，直接在运行中的应用里操作并断言。

  ```bash
  # 终端 A：带调试端口启动
  npx electron . --remote-debugging-port=9333 --no-sandbox --in-process-gpu
  # 终端 B：任选
  npm run smoke          # 窗口/桥接/分区/语言包/控制台错误
  npm run probe:video    # libVLC：开片→播放推进→seek→音量→速率→暂停→轨道→比例→截图→关闭复位
  npm run probe:music    # 音乐库：渲染→列排序→分组筛选→双击播放→传输条→音量进度
  ```

- **自动发版**：推 `v*` 标签即触发 GitHub Actions 构建 NSIS + portable 并上传 Release（`.github/workflows/release.yml`）。

## 🛠 技术栈

| 分类 | 技术 |
| --- | --- |
| 运行时 | Electron 32 |
| 前端 | React 19 + Vite 5 + TypeScript 5 |
| 样式 | 手写 CSS + 主题变量（无 CSS 框架） |
| 渲染 | EPUB.js 0.3.93 |
| 动画 | framer-motion 13 |
| 状态 | zustand 5 |
| 元数据 | music-metadata 12（主进程探测） |
| 视频引擎 | libVLC 3.0.21（koffi FFI + `set_hwnd` 嵌入） |
| 音频引擎 | Chromium `<audio>` + Web Audio |

## 📂 目录结构

```
MAGI/
├── electron/
│   ├── main.cjs           # 主进程（无边框窗口、IPC、流式解压 + 本地 HTTP 目录/媒体服务、联网代理、视频层两窗口编排）
│   ├── vlc.cjs            # libVLC 控制器（koffi 绑定、HWND 嵌入、状态轮询、语义化 command 动词）
│   └── preload.cjs        # 桥接层（含 vlc 命名空间与 vlc:init/state/opened/closed 订阅）
├── vendor/vlc/            # 便携 libVLC（npm run fetch:vlc 下载，不入库）
├── src/
│   ├── App.tsx            # 应用入口、分区导航、主题与转场
│   ├── main.tsx           # 按 location.hash 分流：主窗口渲染 App，覆盖窗口渲染 VideoOverlay
│   ├── music/             # ★ 音乐库（foobar2000 范式）
│   │   ├── MusicPage.tsx  # 主容器：顶栏 / 库树 / 表格 / 状态栏
│   │   ├── LibraryTree.tsx# 左侧媒体库树（艺术家/专辑/流派/年份/文件夹/播放列表）
│   │   ├── TrackTable.tsx # 多列表格（列头排序、规格串、播放行高亮）
│   │   ├── TransportBar.tsx # 全局传输条（唯一 <audio> 宿主）
│   │   └── music.css      # 音乐模块样式
│   ├── video/
│   │   ├── VideoStage.tsx # 主窗口侧挂载点：开片、时间轴落盘、覆盖窗口事件翻译；无 VLC 时回落 HTML5
│   │   └── VideoOverlay.tsx # 透明覆盖窗口的控制 UI（手势 / 菜单 / 键盘 / OSD）
│   ├── components/        # Reader / 设置 / 目录 / 书签 / 查阅面板 / 文献库 / 视频库 等
│   ├── store/useStore.ts  # 全局状态（书架、设置、进度、笔记、文献、词库、音频、视频）
│   ├── lib/tts.ts         # GPT-SoVITS TTS 客户端
│   ├── lib/lookup.ts      # 查阅引擎（本地匹配 + 多源联网 + 引用著录）
│   ├── lib/subtitle.ts    # SRT / VTT / ASS 字幕解析
│   ├── data/knowledge.json# 内置离线词库
│   ├── theme/themes.ts    # 主题与默认设置
│   └── i18n/              # 中英文案
├── index.html
├── languages/             # 外挂语言包目录（丢一个 json 就是一种新语言）
├── scripts/
│   ├── smoke.mjs          # CDP 冒烟测试
│   ├── probe-video.mjs    # libVLC 内核验收
│   ├── probe-music.mjs    # 音乐库验收
│   └── fetch-vlc.mjs      # 下载便携 libVLC 到 vendor/vlc
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
node scripts/fetch-vlc.mjs   # 拉便携 libVLC（约 180 MB，仅首次；不拉则视频降级为 <video>）
npm run electron:dev         # Vite + Electron 开发模式（热更新）
```

仅调试前端 UI 可在浏览器打开 `npm run dev`（默认 http://localhost:5173）。

## 📦 打包

```bash
npm run dist   # 产出 NSIS 安装版 + portable 单文件（输出到 ../magi_out）
npm run pack   # 仅产出解压目录 win-unpacked
```

> 受限网络环境可使用镜像加速：
> `npm_config_registry=https://registry.npmmirror.com ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/`
>
> **便携 libVLC 不入库**（解压后约 180 MB，超 GitHub 单文件 100 MB 上限，`.gitignore` 已排除 `vendor/`），但**随安装包分发**。从源码自行打包前先跑 `node scripts/fetch-vlc.mjs`，它会把 VLC 3.0.21 下到 `vendor/vlc/`，`extraResources` 再原样复制成安装目录下的 `resources/vlc/`。
>
> **不放也能构建**，只是应用里视频会降级到 Chromium `<video>`，没有硬解与全格式支持。
> 安装包体积较大（约 480 MB 解压后）主要就是这 180 MB 的 VLC 内核。
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

当前版本仅构建 Windows 安装包。macOS / Linux 可自行 `npm run dist` 构建（视频层是 Windows HWND 专用，非 Windows 平台会自动降级到 `<video>`）。

- 视频内核使用 [libVLC](https://www.videolan.org/vlc/libvlc.html)（LGPL-2.1+），以动态库形式单独分发并按需加载。
- 沙箱/无 GUI 环境无法实跑验收时，可静态校验：`npx tsc --noEmit`、`npm run build`、`node --check electron/*.cjs`。
