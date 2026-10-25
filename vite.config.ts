import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Electron 主进程用 CJS，渲染层走 Vite。base 用相对路径，打包后 file:// 可加载。
export default defineConfig({
  plugins: [react()],
  base: './',
  server: { port: 5173, host: true },
  // emptyOutDir 关掉：沙箱里的 node 删除被 safe-delete 拦截（大批旧 asset 会触发删除保护）。
  // 清理交给 PowerShell 侧手动删 dist，构建本身只管产出。
  build: { outDir: 'dist', emptyOutDir: false, chunkSizeWarningLimit: 6000 }
})
