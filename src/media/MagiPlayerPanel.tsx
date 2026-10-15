// folia 播放页侧栏（PlayerPanel → UnifiedPanel）的 MAGI 适配层。
//
// folia 里这一层由 App.tsx 组装 `playerPanelModel`：大部分字段来自 folia 自己的曲库/账号/在线
// provider store。MAGI 是纯本地播放，没有那些东西，所以这里直接调用 folia 的
// `buildPlayerPanelModel`，把 ambient（folia 自己该算的那部分）和 deps（调用方该给的那部分）
// 全部按 MAGI 的实际取值填进去 —— 组件本身仍是 folia 原件，未改写。
//
// 取不到的语义一律给「安全的空实现」：MAGI 没有专辑页/艺人页/在线歌词/账号/设备同步，
// 对应的按钮点了不做事，但绝不能崩。
import { useCallback, useMemo, useRef } from 'react'
import PlayerPanel from '../folia/components/app/PlayerPanel'
import {
  buildPlayerPanelModel,
  type PlayerPanelDeps
} from '../folia/components/app/player-panel/buildPlayerPanelModel'
import type { Album, Artist, SongResult, Theme } from '../folia/types'
import { DAYLIGHT_THEME, DEFAULT_THEME } from '../folia/services/baseThemes'
import { buildThemeSourceModel } from '../folia/hooks/themeControllerState'
import type { LibraryAccountController } from '../folia/library/core/contracts/account'
import { useAppChromeStore } from '../folia/stores/useAppChromeStore'
import { useAppViewStore } from '../folia/stores/useAppViewStore'
import { useAudioSettingsStore } from '../folia/stores/useAudioSettingsStore'
import { usePlayerChromeSettingsStore } from '../folia/stores/usePlayerChromeSettingsStore'
import { useThemeSettingsStore } from '../folia/stores/useThemeSettingsStore'
import { useVisualizerSettingsStore } from '../folia/stores/useVisualizerSettingsStore'
import { selectDisplayCoverUrl, selectDisplayLyrics, usePlaybackStore } from '../folia/stores/usePlaybackStore'
import { useStore as MAGI } from '../store/useStore'

const noop = () => undefined

/**
 * MAGI 没有 folia 的账号体系，但 UnifiedPanel 的「账户」标签是无条件出现的。
 * 这里给一个永不抛错的替身：`getSnapshot`/`subscribe` 供它订阅（返回空平台表），
 * 其余动作方法统一回答「不支持」，点了只是没反应。
 */
const EMPTY_ACCOUNT_SNAPSHOT = {
  providers: [],
  activeProviderId: 'netease',
  login: null,
  pendingSwitch: null,
  logout: { pendingProviderId: null },
  lastLoginCompletion: null
}

const createNullAccountController = (): LibraryAccountController => {
  const unsupported = async () => ({ status: 'unavailable', reason: 'not-configured' })
  return new Proxy({} as Record<string | symbol, unknown>, {
    get: (_target, prop) => {
      if (prop === 'getSnapshot') return () => EMPTY_ACCOUNT_SNAPSHOT
      if (prop === 'subscribe') return () => () => undefined
      if (prop === 'cancelSwitch') return () => ({ status: 'stale', requestId: 0 })
      if (prop === 'closeLogin') return () => ({ status: 'closed' })
      if (prop === 'buildLoginDiagnosticReport') return async () => ({ ok: false, lines: [] })
      return unsupported
    }
  }) as unknown as LibraryAccountController
}

export type MagiPlayerPanelProps = {
  /** folia 主题（MAGI 的 accent 派生） */
  theme: Theme
  /** 关闭侧栏（回到 MAGI 的曲库页） */
  onClose: () => void
  /** 切到歌曲墙（folia 的 lattice 档） */
  onOpenLattice: () => void
  currentSong: SongResult | null
  playerState: ReturnType<typeof usePlaybackStore.getState>['playerState']
  loopMode: 'off' | 'all' | 'one'
  onToggleLoop: () => void
  onTogglePlay: () => void
  onNext: () => void
  onPrev: () => void
  onPlaySong: (song: SongResult, queue: SongResult[]) => void
  queue: SongResult[]
  /** 歌词时间轴微调（ms），读写 MAGI 的 audioPrefs */
  lyricTimelineOffsetMs: number
  onLyricTimelineOffsetChange: (value: number) => void
}

export default function MagiPlayerPanel({
  theme,
  onClose,
  onOpenLattice,
  currentSong,
  playerState,
  loopMode,
  onToggleLoop,
  onTogglePlay,
  onNext,
  onPrev,
  onPlaySong,
  queue,
  lyricTimelineOffsetMs,
  onLyricTimelineOffsetChange
}: MagiPlayerPanelProps) {
  // —— folia 自己的 store：面板开合/标签页、界面 chrome、音量、白天模式、可视化模式 ——
  const isPanelOpen = useAppViewStore((s) => s.isPanelOpen)
  const panelTab = useAppViewStore((s) => s.panelTab)
  const isPanelGuideHotspotActive = useAppChromeStore((s) => s.isPlayerPanelGuideHotspotActive)
  const transparentPlayerBackground = usePlayerChromeSettingsStore((s) => s.transparentPlayerBackground)
  const showOpenPanelCloseButton = usePlayerChromeSettingsStore((s) => s.showOpenPanelCloseButton)
  const volume = useAudioSettingsStore((s) => s.volume)
  const isMuted = useAudioSettingsStore((s) => s.isMuted)
  const audioQuality = useAudioSettingsStore((s) => s.audioQuality)
  const visualizerMode = useVisualizerSettingsStore((s) => s.visualizerMode)
  const isDaylight = useThemeSettingsStore((s) => s.isDaylight)
  const useCoverColorBg = useThemeSettingsStore((s) => s.useCoverColorBg)
  const toggleCoverColorBg = useThemeSettingsStore((s) => s.handleToggleCoverColorBg)
  const setDaylight = useThemeSettingsStore((s) => s.setDaylightPreference)

  const coverUrl = usePlaybackStore(selectDisplayCoverUrl)
  const hasLyrics = usePlaybackStore((s) => Boolean(selectDisplayLyrics(s)))
  const patchAudio = MAGI((s) => s.patchAudio)

  const queueScrollRef = useRef<HTMLDivElement | null>(null)
  const accountController = useMemo(createNullAccountController, [])

  // 队列就地编辑：MAGI 的 store 没有专门的 reorder action，直接补丁 audioQueue 即可。
  // folia 传进来的是 SongResult（id 形如 `local:<trackId>`），写回时要还原成 MAGI 的 trackId。
  const patchQueue = useCallback((next: SongResult[]) => {
    const ids = next.map((s) => String(s.id).replace(/^local:/, '')).filter(Boolean)
    if (!ids.length) return
    const current = MAGI.getState().audioCurrentId
    patchAudio({ audioQueue: ids, audioIndex: current ? ids.indexOf(current) : -1 })
  }, [patchAudio])

  const deps: PlayerPanelDeps = useMemo(() => ({
    navigateToHome: onClose,
    navigateToLattice: onOpenLattice,
    handleDirectHomeFromPanel: onClose,
    currentSong,
    handleAlbumSelect: noop as (song: SongResult, album: Album) => void,
    handleArtistSelect: noop as (song: SongResult, artist: Artist) => void,
    effectiveLoopMode: loopMode,
    toggleLoop: onToggleLoop,
    handleLike: noop,
    generateAITheme: noop,
    isGeneratingTheme: false,
    canGenerateAITheme: false,
    theme,
    setTheme: noop as (t: Theme) => void,
    bgMode: 'default',
    handleBgModeChange: noop as (m: 'default' | 'ai' | 'custom') => void,
    hasCustomTheme: false,
    themeSourceModel: buildThemeSourceModel({
      bgMode: 'default',
      aiTheme: null,
      legacyTheme: null,
      customTheme: null,
      isDaylight: false,
      defaultTheme: DEFAULT_THEME,
      daylightTheme: DAYLIGHT_THEME,
      currentSongHasLocalAiTheme: false
    }),
    handleResetTheme: noop,
    toggleTransparentModeWithHandoff: () => {
      usePlayerChromeSettingsStore.setState({ transparentPlayerBackground: !transparentPlayerBackground })
    },
    // —— 在线匹配/在线歌词：MAGI 没有在线源，统一空实现 ——
    handleManualMatchOnline: noop,
    handleUpdateLocalLyrics: noop as PlayerPanelDeps['handleUpdateLocalLyrics'],
    handleChangeLyricsSource: noop as PlayerPanelDeps['handleChangeLyricsSource'],
    handleImportOnlineLyrics: noop as PlayerPanelDeps['handleImportOnlineLyrics'],
    handleChangeOnlineLyricsSource: noop as PlayerPanelDeps['handleChangeOnlineLyricsSource'],
    handleMatchOnlineLyrics: noop,
    handleClearOnlineLyricsState: noop,
    handleLyricTimelineOffsetChange: onLyricTimelineOffsetChange as PlayerPanelDeps['handleLyricTimelineOffsetChange'],
    handleChangeReplayGainMode: noop as PlayerPanelDeps['handleChangeReplayGainMode'],
    fmModeLabel: '',
    handleFmTrash: noop,
    handleNextTrack: onNext,
    handlePrevTrack: onPrev,
    togglePlay: onTogglePlay,
    handlePreviewVolume: noop as PlayerPanelDeps['handlePreviewVolume'],
    isNowPlayingControlDisabled: false,
    playQueue: queue,
    playSong: onPlaySong,
    queueScrollRef,
    shuffleQueue: () => {
      const next = [...queue]
      for (let i = next.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1))
        ;[next[i], next[j]] = [next[j], next[i]]
      }
      patchQueue(next)
    },
    removeQueueSong: (index: number) => {
      if (index < 0 || index >= queue.length) return
      patchQueue(queue.filter((_, i) => i !== index))
    },
    moveQueueSongToEnd: (index: number) => {
      if (index < 0 || index >= queue.length || index === queue.length - 1) return
      const next = [...queue]
      const [song] = next.splice(index, 1)
      next.push(song)
      patchQueue(next)
    },
    moveQueueSongToNext: (index: number) => {
      if (index < 0 || index >= queue.length - 1) return
      const next = [...queue]
      ;[next[index], next[index + 1]] = [next[index + 1], next[index]]
      patchQueue(next)
    },
    saveCurrentQueueAsLocalPlaylist: async () => undefined,
    user: null,
    accountController,
    cacheSize: '',
    handleClearCache: noop,
    handleSyncData: noop,
    isSyncing: false,
    handleToggleDaylight: () => setDaylight(!isDaylight)
  }), [
    accountController, coverUrl, currentSong, isDaylight, loopMode, onClose, onNext, onOpenLattice,
    onLyricTimelineOffsetChange, onPlaySong, onPrev, onToggleLoop, onTogglePlay, patchQueue, queue,
    setDaylight, theme, transparentPlayerBackground
  ])

  const model = useMemo(() => buildPlayerPanelModel({
    // —— ambient：folia 里由 usePlayerPanelModel 自己算的那部分 ——
    isPanelOpen,
    panelTab,
    coverUrl,
    isLiked: false,
    hasLyrics,
    defaultTheme: DEFAULT_THEME,
    daylightTheme: DAYLIGHT_THEME,
    visualizerMode,
    transparentPlayerBackground,
    onlineLyricsState: null,
    lyricTimelineOffsetMs,
    replayGainMode: 'off',
    isFmMode: false,
    playerState,
    volume,
    isMuted,
    showOpenPanelCloseButton,
    isPanelGuideHotspotActive,
    // 保留 folia 自己的开合按钮（右下角那颗）：MAGI 没有别的入口，藏了就再也打不开了
    hideToggleButton: false,
    activePlaybackContext: 'main',
    openCurrentLocalAlbum: noop,
    openCurrentLocalArtist: noop,
    openCurrentNavidromeAlbum: noop,
    openCurrentNavidromeArtist: noop,
    handleCopySongInfoSuccess: async () => undefined,
    audioQuality,
    useCoverColorBg,
    isDaylight,
    ...deps
  }), [
    accountController, audioQuality, coverUrl, deps, hasLyrics, isDaylight, isMuted,
    isPanelGuideHotspotActive, isPanelOpen, lyricTimelineOffsetMs, panelTab, playerState,
    showOpenPanelCloseButton, transparentPlayerBackground, useCoverColorBg, visualizerMode, volume
  ])

  return <PlayerPanel model={model} />
}
