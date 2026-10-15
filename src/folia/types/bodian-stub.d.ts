// bodian-music-api 是 folia 桌面端在线音乐服务用的第三方包（依赖主进程桥），
// MAGI 只做本地播放，不引入该包；这里按调用方的用法给一份最小类型声明。
declare module 'bodian-music-api' {
  /** 上游错误码，形状由包自己决定；MAGI 侧不解析，故放开为 any */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  export type BodianErrorCode = any
  export interface BodianLyricsPayload {
    mainText: string
    wordByWordText?: string
  }
  export type BodianOperation = string
  export type BodianParams = Record<string, unknown>
  export interface BodianResult<T = unknown> {
    ok: boolean
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    error?: any
    data?: T
  }
}
