# NovelReader

本地小说阅读器，基于 Electron 构建，克隆 Koodo Reader 的交互与视觉体验。支持 EPUB / TXT 阅读、双模式阅读、GPT-SoVITS 语音朗读。

## ✨ 功能特性

- 📚 **书架管理**：导入 EPUB / TXT，封面墙展示，支持删除后重新导入
- 📖 **双阅读模式**：竖向滚动 / 横向翻页，设置内一键切换
- 🎨 **阅读体验**：多主题、字体 / 字号 / 行距 / 边距可调
- 📑 **导航与记忆**：目录、书签、标注、阅读进度自动保存
- 🔊 **语音朗读**：GPT-SoVITS TTS，逐句朗读、自动翻页续读
- 🌐 **中英双语界面**

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
├── electron/main.cjs      # Electron 主进程（无边框窗口、IPC）
├── src/
│   ├── App.tsx            # 应用入口、主题与转场
│   ├── components/        # Home / Reader / 设置 / 目录 / 书签 等
│   ├── store/useStore.ts  # 全局状态（书架、设置、进度）
│   ├── lib/tts.ts         # GPT-SoVITS TTS 客户端
│   ├── theme/themes.ts    # 主题与默认设置
│   └── i18n/              # 中英文案
├── index.html
└── package.json
```

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
