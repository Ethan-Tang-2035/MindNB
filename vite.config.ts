import { defineConfig } from 'vite'
import { createRemoteMiddleware } from './scripts/remote-middleware.ts'

/**
 * MINDNB_REMOTE=1 npm run dev → 本地挂 /api（FileBlobStore 顶替 Vercel Blob，票 04 冒烟/票 08 走查用）。
 * 默认 npm run dev 不挂：保持 spec §② 的「无 /api → 引擎 fail-soft」纯本地路径。
 */
export default defineConfig(() => ({
  plugins: [
    {
      name: 'mindnb-remote-local',
      configureServer(server) {
        if (!process.env.MINDNB_REMOTE) return
        const dir = process.env.MINDNB_REMOTE_DIR ?? '.scratch/.remote-blob'
        server.middlewares.use(createRemoteMiddleware(dir))
        console.log(`[mindnb] MINDNB_REMOTE=1：/api 本地 shim 已挂载（store: ${dir}）`)
      },
    },
  ],
}))
