// folia 的两个构建期虚拟模块（由 dev/ 下的 Vite 插件生成，已在 vite.config.ts 注册）。
// tsc 看不到 Vite 的虚拟模块，这里补一份类型声明。
declare module 'virtual:folia-command-pinyin' {
  /** 短语 → 拼音（全拼 + 首字母），构建期由 dev/pinyin/commandPinyinPlugin.mjs 生成 */
  export const PINYIN_BY_PHRASE: Record<string, { full: string; initials: string }>
  export const PINYIN_PHRASE_COUNT: number
}

declare module 'virtual:icu-folia-dict' {
  /** jieba 词典：换行分隔的已排序词表 */
  export const DICT_WORDS: string
  /** 词频：无符号 LEB128 打包后的 base64 */
  export const DICT_FREQS: string
  export const DICT_TOTAL: number
}

declare module 'virtual:icu-folia-hmm' {
  export const HMM_START: Record<string, number>
  export const HMM_TRANS: Record<string, Record<string, number>>
  export const HMM_EMIT: Record<string, [string, string]>
  /** 繁 → 简字符对，两两一组 */
  export const T2S_PAIRS: string
}
