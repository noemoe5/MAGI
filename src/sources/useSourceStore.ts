// 源启用状态与自定义源（localStorage 持久化，跟 library.json 解耦）。
import { create } from 'zustand'
import { BUILTIN_SOURCES, buildProviders } from './index'
import type { CustomSourceSpec, SourceProvider } from './types'

const KEY = 'magi.sources.v1'

interface Persisted {
  enabled: Record<string, boolean>
  customs: CustomSourceSpec[]
}

function load(): Persisted {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return { enabled: {}, customs: [] }
    const p = JSON.parse(raw)
    return {
      enabled: p?.enabled ?? {},
      customs: Array.isArray(p?.customs) ? p.customs : []
    }
  } catch {
    return { enabled: {}, customs: [] }
  }
}

function save(enabled: Record<string, boolean>, customs: CustomSourceSpec[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify({ enabled, customs }))
  } catch {
    /* 配额满时忽略：源配置丢了也不影响主功能 */
  }
}

interface SourceStore {
  enabled: Record<string, boolean>
  customs: CustomSourceSpec[]
  managerOpen: boolean

  setManagerOpen: (v: boolean) => void
  toggle: (id: string, on?: boolean) => void
  addCustom: (spec: CustomSourceSpec) => void
  /** 批量导入：同 id 覆盖，返回实际写入条数 */
  addCustoms: (specs: CustomSourceSpec[]) => number
  removeCustom: (id: string) => void
  /** 当前启用中的 provider（内置 + 自定义） */
  activeProviders: () => SourceProvider[]
  /** 全部 provider（含停用的，用于源管理页） */
  allProviders: () => SourceProvider[]
}

export const useSourceStore = create<SourceStore>((set, get) => {
  const init = load()
  return {
    enabled: init.enabled,
    customs: init.customs,
    managerOpen: false,

    setManagerOpen: (v) => set({ managerOpen: v }),

    toggle: (id, on) => {
      const next = { ...get().enabled }
      const provider = get().allProviders().find((p) => p.id === id)
      const current = next[id] ?? provider?.defaultEnabled ?? true
      next[id] = on ?? !current
      set({ enabled: next })
      save(next, get().customs)
    },

    addCustom: (spec) => {
      get().addCustoms([spec])
    },

    addCustoms: (specs) => {
      if (!specs.length) return 0
      const incoming = new Set(specs.map((s) => s.id))
      const customs = [...get().customs.filter((c) => !incoming.has(c.id)), ...specs]
      const enabled = { ...get().enabled }
      // 新导入的源默认打开；已存在同 id 的源保留用户原有开关状态
      specs.forEach((s) => {
        if (enabled[s.id] === undefined) enabled[s.id] = true
      })
      set({ customs, enabled })
      save(enabled, customs)
      return specs.length
    },

    removeCustom: (id) => {
      const customs = get().customs.filter((c) => c.id !== id)
      const enabled = { ...get().enabled }
      delete enabled[id]
      set({ customs, enabled })
      save(enabled, customs)
    },

    allProviders: () => buildProviders(get().customs),

    activeProviders: () => {
      const { enabled } = get()
      // 默认按源自身的 defaultEnabled（不填视为开启），显式开关优先
      return get().allProviders().filter((p) => enabled[p.id] ?? p.defaultEnabled ?? true)
    }
  }
})

/** 内置源 id，UI 用来区分「内置/自定义」角标 */
export const BUILTIN_IDS = new Set(BUILTIN_SOURCES.map((s) => s.id))
