import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Electron 主进程用 CJS，渲染层走 Vite。base 用相对路径，打包后 file:// 可加载。
export default defineConfig({
  plugins: [react()],
  base: './',
  server: { port: 5173, host: true },
  build: { outDir: 'dist', emptyOutDir: true }
})
