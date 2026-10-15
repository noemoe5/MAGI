import path from 'path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { icuFoliaDataPlugin } from './dev/icuFolia/icuFoliaDataPlugin.mjs'
import { commandPinyinPlugin } from './dev/pinyin/commandPinyinPlugin.mjs'

// Electron 主进程用 CJS，渲染层走 Vite。base 用相对路径，打包后 file:// 可加载。
// 说明：@ 别名指向 src/folia —— 从 folia-major 移植过来的播放界面代码整体落在该目录下，
// 其内部 `@/xxx` 与相对 import 都按 folia 原结构（src/ ≡ src/folia/）解析。
export default defineConfig({
  plugins: [
    icuFoliaDataPlugin(),
    commandPinyinPlugin(),
    react()
  ],
  base: './',
  server: { port: 5173, host: true },
  build: { outDir: 'dist', emptyOutDir: true, chunkSizeWarningLimit: 6000 },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src/folia')
    }
  },
  define: {
    // folia 源码里用到的构建期常量（MAGI 版取值）
    __COMMIT_HASH__: JSON.stringify('magi'),
    __GIT_BRANCH__: JSON.stringify('main'),
    __BUILD_REPO__: JSON.stringify('noemoe5/MAGI'),
    __BUILD_COMMIT__: JSON.stringify('magi'),
    __BUILD_KIND__: JSON.stringify('official'),
    __BUILD_HOST__: JSON.stringify(''),
    __APP_VERSION__: JSON.stringify('2.1.0'),
    __APP_VERSION_LABEL__: JSON.stringify('MAGI'),
    __APP_RELEASE_CHANNEL__: JSON.stringify('magi'),
    __DOCKER_STACK_VERSION__: JSON.stringify('')
  }
})
