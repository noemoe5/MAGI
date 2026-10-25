## MAGI v2.2.0 — 音乐换 foobar 范式，视频换 libVLC

**破坏性变更。** 这一版把「整合」时期留下的两条技术债一次性砍了：音乐层不再是 folia-major 的源码移植，视频层不再随包塞一个 mpv.exe。阅读器（EPUB / TXT）一行没动。

为什么非砍不可：folia 那一层是把上游 1039 个文件按 import 闭包原样搬进来的，它的在线账号、歌词 provider、封面 CDN 在纯本地场景全是空实现，任何一处 noop 兜不住就整块崩——这就是「整合之后一堆 bug」的来源。mpv 则是另一个方向的债：115 MB 的可执行文件随包分发，靠命名管道传 JSON，还得为它单独维护一套「找不到就降级」的分支。

### 音乐：foobar2000 / MusicBee 范式

`src/folia/` 整体删除，`src/music/` 从零写。取值取向是桌面音乐**管理器**，不是网页播放器：信息密度优先，动效让位。

- **左侧媒体库树** —— 全部 / 最近添加 / 最常播放 / 从未播放，加上按 **艺术家 / 专辑 / 流派 / 年份 / 文件夹** 五种维度实时聚合。聚合是从曲目数组现算的，不落索引，导入完立刻就有。分组默认收起，点标题展开。
- **右侧多列表格** —— `# / 标题 / 艺术家 / 专辑 / 年份 / 时长 / 规格`，每一列都能点表头排序。`#` 列默认按**专辑内曲序**而不是文件名（foobar 语义）；「规格」列把 codec + 采样率 + 位深 + 声道压成一行 `FLAC 44.1k 24bit`，一眼看出无损还是转码。
- **底部传输条** —— 扁平一条，常驻，是全应用**唯一**的 `<audio>` 元素宿主，所以切页面不会断音、也不会出现两条进度互相打架。顶部一条细线就是进度条，直接拖拽 seek。
- **队列跟随筛选** —— 双击某一行时，队列用的是**当前筛选后的列表**，不是全库。在「2024 年」里双击第一首，下一首就是同一年的下一首。

视觉参数都是按桌面软件的密度调的：行高 27px、数字等宽、斑马纹、播放中那行用强调色而不是换背景。屏外行用 `content-visibility: auto` 跳过渲染，53 首和 5000 首的滚动开销差别很小。

### 视频：libVLC 3.0.21

`electron/mpv.cjs` → `electron/vlc.cjs`，用 **koffi**（N-API 预编译绑定）直接 FFI 加载 `libvlc.dll`——不需要 MSVC，不需要 node-gyp，Windows 上 `npm i` 完就能跑。

窗口结构沿用上一版那套（因为它是对的）：`videoWin`（`focusable: false`，只负责提供一个 HWND）+ `overlayWin`（透明覆盖，承载控制条 UI）。`libvlc_media_player_set_hwnd()` 把 vout 挂进前者，原生子窗口永远画在网页内容之上，所以 UI 必须放在另一个窗口里。

状态回推改了做法：不再解析 `libvlc_event_t`——那是带 union 的 C 结构体，跨 FFI 读字段极易错位，一个字段偏移错了就是整块状态乱跳。改成 **10Hz 轮询** `get_state / get_time / get_length / audio_get_volume`，稳定、可预期，代价可以忽略。

硬解默认 `--avcodec-hw=d3d11va`；`--file-caching=1200` + `--drop-late-frames` + `--skip-frames` 保证本地大码率片源不追帧。

**这一版踩到的三个坑**（都记进 README 了）：

| 症状 | 根因 | 修法 |
| --- | --- | --- |
| `open` 返回 false，`media-new-failed` | `libvlc_media_new_path` 在 Windows 上不认 `D:/x.mp4` 这种正斜杠路径，直接返回 NULL | `toVlcPath()` 统一归一反斜杠 |
| 视频跑到独立窗口里去了 | `set_hwnd` 写在 `play()` 之后，VLC 已经建好 vout | 顺序固定为 `new_path` → `new_player` → `set_hwnd` → `play` |
| 插件加载失败 / 解码器缺失 | `--plugin-path` 在 libvlc 3.x 已废弃，传了也没用 | 改走环境变量 `VLC_PLUGIN_PATH` + dll 同级 `plugins/` |

另外 `libvlc_media_player_set_aspect_ratio` 是 2.x 的 API，3.0 里根本没这个符号，比例控制要拆成 `video_set_aspect_ratio` + `video_set_crop_geometry` + `video_set_scale` 三件套。

### 体积

| | 2.1.1 | 2.2.0 |
| --- | --- | --- |
| 直接依赖 | 34 | **8** |
| `node_modules` 顶层项 | 1000+ | **437** |
| 渲染层产物 `dist/` | 数十 MB | **0.85 MB**（3 files） |
| 安装包 | 146 MB | 约 250 MB（大头是 180 MB 的 libVLC） |

`dist/` 这一项差了两个数量级，主要是 pixi + three + folia 的样式与字体资源一起走了。安装包反而变大，因为 libVLC 比 mpv 大——但它换来的是不用再维护「找不到内核就降级」这条分支。

libVLC 不入库（解压后 180 MB，超 GitHub 单文件上限），自建时先跑 `node scripts/fetch-vlc.mjs`，它会按 清华 → 中科大 → 官方 三镜像回退下载 3.0.21 并解压到 `vendor/vlc/`，`electron-builder` 自动复制成包内 `resources/vlc`。

### 验收

三个无头 CDP 探针，跑在真实运行的应用里，不是静态 DOM 断言。

**视频 11 项**（开发版与生产打包版都跑了一遍）：

```
available=true   engine=libvlc 3.0.21
open=true (620ms / 生产版 455ms)   time advancing=YES
seek → 120s 生效    volume=45 → 0.42   mute=true   rate=1.5
pause → resume 正常    轨道列表 1 video / 1 audio
aspect: fit / fill / 16:9 三态切换正常
snapshot → 1376×768 真实视频帧（确认 vout 真的在画，不是黑窗）
close → buffered/width/height 全部归零
console errors = 0
```

**音乐全项**：`.mu-page` 渲染、58 行、7 列表头齐全、点「时长」排序后 `0:01 → 7:12`、展开专辑分组筛出 2 行、双击播放 `currentId=b2 playing=true queue=2`、传输条暂停/继续、音量 0.42、进度 seek 生效。注入的测试曲目跑完自动清理，残留 0。

**整体冒烟 8 项**：标题、preload 桥接 25 个方法、左侧三分区、canvas=0、`#root` 挂载、语言包 IPC、控制台无错误、无未捕获异常。

`tsc --noEmit` 与 `vite build` 均 exit 0。

### 其余

- 顺带修掉几处过期配置：`release.yml` 里还在拉便携 mpv、产物目录还写着 `../nr_out`；`tsconfig.json` 的 `@/*` 还指向被删掉的 `src/folia/*`；`LICENSE` 的第三方声明还写着「因移植 folia 而必须 AGPL」——现在删了移植层，继续用 AGPL 是选择而不是义务，声明里如实改了。
- 许可证不变：**AGPL-3.0-or-later**。libVLC 是 LGPL-2.1+，以未修改的独立 DLL 随包分发、运行时 FFI 加载，可按 LGPL 要求自行替换。
- folia 带走的还有 14 种可视化与 Lattice 歌曲墙。它们依赖在线歌词 provider 与账号态，本地跑起来只有空壳——想要可视化的话，Web Audio 那条通路还留着（`src/lib/visualizer.ts`），只是暂时没有消费者。
