# NovelReader

本地小说阅读器，基于 Electron 构建，克隆 Koodo Reader 的交互与视觉体验。支持 EPUB / TXT 阅读、双模式阅读、GPT-SoVITS 语音朗读。

## ✨ 功能特性

- 📚 **书架管理**：导入 EPUB / TXT，封面墙展示，支持删除后重新导入
- 📖 **双阅读模式**：竖向滚动 / 横向翻页，设置内一键切换
- 🎨 **阅读体验**：多主题、字体 / 字号 / 行距 / 边距可调
- 📑 **导航与记忆**：目录、书签、标注、阅读进度自动保存
- 🔊 **语音朗读**：GPT-SoVITS TTS，逐句朗读、自动翻页续读
- 🔍 **文献查阅中心**：划词即查 + 搜索台 + 学术文献库 + 本地词库（见下）
- 🌐 **中英双语界面**

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
| 前端 | React 18 + Vite 5 + TypeScript 5 |
| 渲染 | EPUB.js 0.3.93 |
| 动画 | framer-motion 11 |
| 状态 | zustand 5 |

## 📂 目录结构

```
NovelReaderElectron/
├── electron/main.cjs      # Electron 主进程（无边框窗口、IPC、大文件流式解压 + 本地 HTTP 目录服务、联网代理）
├── src/
│   ├── App.tsx            # 应用入口、主题与转场
│   ├── components/        # Home / Reader / 设置 / 目录 / 书签 / 查阅面板 / 文献库 等
│   ├── store/useStore.ts  # 全局状态（书架、设置、进度、笔记、文献、词库）
│   ├── lib/tts.ts         # GPT-SoVITS TTS 客户端
│   ├── lib/lookup.ts      # 查阅引擎（本地匹配 + 多源联网 + 引用著录）
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

Windows 安装版（NSIS）与免安装单文件（portable）见 [Releases](https://github.com/noemoe5/NovelReaderElectron/releases)。

## 📌 说明

当前版本仅构建 Windows 安装包。macOS / Linux 可自行 `npm run dist` 构建。
