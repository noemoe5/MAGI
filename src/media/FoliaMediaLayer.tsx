// folia 播放界面层：底部播放条（FloatingPlayerControls）+ 全屏 Lattice 播放台。
//
// 这里只做两件事：把 MAGI 的音频状态喂给 folia 的 store / 每帧信号；
// 把 folia 界面上的操作原样交回 MAGI 的播放 action。UI 本身是 folia 的原组件，未改写。
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useAudioEngine } from '../lib/useAudioEngine'
import { audioGraph } from '../lib/audioGraph'
import { useStore } from '../store/useStore'
import type { SongResult } from '../folia/types'
import FloatingPlayerControls, {
  type SlotContextFromApp,
  type TrackNavigation
} from '../folia/components/FloatingPlayerControls'
import type { PlayerControlSlotActionId } from '../folia/components/floating-player/playerControlSlotActions'
import Lattice from '../folia/components/app/lattice/Lattice'
import MagiPlayerPanel from './MagiPlayerPanel'
import type { LatticePlaybackActions } from '../folia/components/app/lattice/LatticePlaybackProvider'
import type { LatticeLyricSource } from '../folia/components/app/lattice/lyrics/types'
import VisualizerRenderer from '../folia/components/visualizer/VisualizerRenderer'
import { useVisualizerRendererModel } from '../folia/components/visualizer/useVisualizerRendererModel'
import { VISUALIZER_REGISTRY, getVisualizerModeLabel } from '../folia/components/visualizer/registry'
import { useVisualizerSettingsStore } from '../folia/stores/useVisualizerSettingsStore'
import { setIsPanelOpen, setView } from '../folia/stores/useAppViewStore'
import {
  selectDisplayDuration,
  selectDisplayLyrics,
  selectDisplayPlayerState,
  selectDisplaySong,
  usePlaybackStore
} from '../folia/stores/usePlaybackStore'
import { currentTime, lyricCurrentTime } from '../folia/stores/motionSignals'
import {
  createFoliaTheme,
  lineIndexAt,
  loadLyrics,
  publishBands,
  publishLyrics,
  publishPlaying,
  publishQueue,
  publishTime,
  setCurrentLineIndex,
  toLoopMode
} from './foliaBridge'

const BOTTOM_BAR_OFFSET_KEY = 'magi_folia_bottom_bar_offset'
const SLEEP_STEPS = [0, 15, 30, 60, 90]

const songIdToTrackId = (id: unknown): string => String(id ?? '').replace(/^local:/, '')

export default function FoliaMediaLayer() {
  const audioRef = useRef<HTMLAudioElement>(null)
  useAudioEngine(audioRef)

  // —— MAGI 侧状态 ——
  const currentId = useStore((s) => s.audioCurrentId)
  const tracks = useStore((s) => s.audioTracks)
  const queueIds = useStore((s) => s.audioQueue)
  const playing = useStore((s) => s.audioPlaying)
  const prefs = useStore((s) => s.audioPrefs)
  const accent = useStore((s) => s.settings.accent)
  const nowPlayingOpen = useStore((s) => s.nowPlayingOpen)
  const playView = useStore((s) => s.playView)
  const sleepTimerEnd = useStore((s) => s.sleepTimerEnd)
  const patchAudio = useStore((s) => s.patchAudio)
  const patchAudioPrefs = useStore((s) => s.patchAudioPrefs)
  const toggleAudio = useStore((s) => s.toggleAudio)
  const audioNext = useStore((s) => s.audioNext)
  const audioPrev = useStore((s) => s.audioPrev)
  const cyclePlayMode = useStore((s) => s.cyclePlayMode)
  const playTrack = useStore((s) => s.playTrack)

  // —— folia 侧（它自己的 store 是界面唯一数据源）——
  const song = usePlaybackStore(selectDisplaySong)
  const lyrics = usePlaybackStore(selectDisplayLyrics)
  const displayState = usePlaybackStore(selectDisplayPlayerState)
  const displayDuration = usePlaybackStore(selectDisplayDuration)
  const playQueue = usePlaybackStore((s) => s.playQueue)
  const currentLineIndex = usePlaybackStore((s) => s.currentLineIndex)

  const theme = useMemo(() => createFoliaTheme(accent), [accent])
  const [, setBarOffset] = useState(() => {
    const raw = Number(localStorage.getItem(BOTTOM_BAR_OFFSET_KEY))
    return Number.isFinite(raw) && raw > 0 ? raw : 24
  })

  const track = tracks.find((t) => t.id === currentId) || null

  // 队列 / 当前曲目 → folia
  useEffect(() => {
    publishQueue(tracks, currentId)
  }, [tracks, currentId])

  useEffect(() => {
    publishPlaying(playing, !!track)
  }, [playing, track])

  // —— folia 的「当前在哪一档」——
  //
  // 这个 store 不只是导航记录：可视化器画不画歌词只认它（`resolveVisualizerShowText` 里
  // `currentView === 'player'` 是唯一放行条件），背景模糊、常驻返回按钮也各读它一次。
  // MAGI 的 nowPlayingOpen / playView 必须同步过去，否则歌词浮层永远被判成「不该显示」——
  // 这正是「没有歌词」的真正原因（跟音频数据无关）。
  //
  // 顺带把侧栏展开：folia 的封面位就在 UnifiedPanel 里（没有第二处封面），
  // 面板不展开就只剩一块动画背景，观感就是「没有封面、没有播放页」。
  useEffect(() => {
    if (!nowPlayingOpen) {
      setView('home')
      return
    }
    setView(playView)
    setIsPanelOpen(playView === 'player')
  }, [nowPlayingOpen, playView])

  // 歌词（同名 .lrc 优先，其次内嵌；解析结果缓存）
  useEffect(() => {
    let cancelled = false
    if (!track) {
      publishLyrics(null)
      return () => {
        cancelled = true
      }
    }
    loadLyrics(track).then((parsed) => {
      if (!cancelled) publishLyrics(parsed)
    })
    return () => {
      cancelled = true
    }
  }, [track?.id])

  // 每帧：位置 / 频谱 / 当前歌词行
  useEffect(() => {
    let raf = 0
    const tick = () => {
      const el = audioRef.current
      if (el) {
        publishTime(el.currentTime || 0, useStore.getState().audioPrefs.lyricOffsetMs)
        publishBands()
        const lines = usePlaybackStore.getState().lyrics?.lines ?? []
        const next = lineIndexAt(lines, lyricCurrentTime.get())
        if (next !== usePlaybackStore.getState().currentLineIndex) setCurrentLineIndex(next)
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [])

  // —— 操作回传 ——
  const onSeek = useCallback((time: number) => {
    patchAudio({ audioPosition: time, audioSeekToken: useStore.getState().audioSeekToken + 1 })
  }, [patchAudio])

  const onTogglePlay = useCallback(() => {
    const el = audioRef.current
    if (el && !useStore.getState().audioPlaying) {
      audioGraph.attach(el)
      audioGraph.resume()
    }
    toggleAudio()
  }, [toggleAudio])

  // 打开全屏播放层。folia 的 `currentView` 有三档（home / player / lattice）：
  //   player  = 播放页：可视化器全屏铺底（封面配色背景 + 自带歌词浮层）+ 侧栏（大封面/标签页）
  //   lattice = 歌曲墙：队列海报墙
  // MAGI 的底部条标题点进来给的是 player（这才是「桌面播放形式」），歌曲墙是单独一档。
  const onOpenPlayer = useCallback(() => {
    // 进播放页顺手把侧栏展开：folia 里这两件事是分开的开关，但用户点进「播放页」想看的就是封面
    setIsPanelOpen(true)
    patchAudio({ nowPlayingOpen: true, playView: 'player' })
  }, [patchAudio])
  const onOpenLattice = useCallback(() => patchAudio({ nowPlayingOpen: true, playView: 'lattice' }), [patchAudio])
  const onCloseLayer = useCallback(() => patchAudio({ nowPlayingOpen: false }), [patchAudio])
  const onCloseLattice = onOpenPlayer

  const cycleSleepTimer = useCallback(() => {
    const now = useStore.getState().sleepTimerEnd
    const currentIndex = now
      ? SLEEP_STEPS.findIndex((m) => Math.abs((now - Date.now()) / 60000 - m) < 1.5)
      : 0
    const next = SLEEP_STEPS[(currentIndex + 1) % SLEEP_STEPS.length]
    patchAudio({ sleepTimerEnd: next > 0 ? Date.now() + next * 60000 : null })
  }, [patchAudio])

  const invokeCommandById = useCallback((id: string) => {
    if (id === 'queue' || id === 'song-wall' || id === 'navigate-lattice') onOpenLattice()
    else if (id === 'sleep-timer') cycleSleepTimer()
    else if (id === 'playback-volume') patchAudioPrefs({ muted: !useStore.getState().audioPrefs.muted })
  }, [cycleSleepTimer, onOpenLattice, patchAudioPrefs])

  const canInvokeCommandById = useCallback(
    (id: string) => ['queue', 'song-wall', 'navigate-lattice', 'sleep-timer', 'playback-volume'].includes(id),
    []
  )

  const slotPrimary: PlayerControlSlotActionId = 'queue'
  const slotSecondary: PlayerControlSlotActionId = 'sleep-timer'

  const slotContext: SlotContextFromApp = useMemo(() => {
    const canPrev = queueIds.length > 1
    const canNext = queueIds.length > 1
    return {
      onShuffle: cyclePlayMode,
      canShuffle: true,
      onLike: () => undefined,
      isLiked: false,
      likeDisabled: true,
      invokeCommandById,
      canInvokeCommandById,
      canPrev,
      canNext,
      onPrev: audioPrev,
      onNext: () => audioNext()
    } as SlotContextFromApp
  }, [audioNext, audioPrev, canInvokeCommandById, cyclePlayMode, invokeCommandById, queueIds.length])

  const trackNavigation: TrackNavigation | null = useMemo(() => {
    if (!track || queueIds.length === 0) return null
    const idx = queueIds.indexOf(track.id)
    const prevId = queueIds[(idx - 1 + queueIds.length) % queueIds.length]
    const nextId = queueIds[(idx + 1) % queueIds.length]
    const prevTrack = tracks.find((t) => t.id === prevId)
    const nextTrack = tracks.find((t) => t.id === nextId)
    return {
      currentTrackKey: track.id,
      onPrev: audioPrev,
      onNext: () => audioNext(),
      canPrev: queueIds.length > 1,
      canNext: queueIds.length > 1,
      prevTitle: prevTrack?.name ?? null,
      nextTitle: nextTrack?.name ?? null,
      prevLabel: '上一首',
      nextLabel: '下一首'
    }
  }, [audioNext, audioPrev, queueIds, track, tracks])

  // Lattice 的歌词源（folia 的 pixi 逐字歌词直接吃这些）
  const lyricSource: LatticeLyricSource = useMemo(() => ({
    currentTime: lyricCurrentTime,
    currentLineIndex,
    lines: lyrics?.lines ?? [],
    theme,
    subtitleTheme: theme,
    showSubtitleTranslation: true,
    hideTranslationSubtitle: false,
    subtitleContentMode: 'translation',
    paused: !playing,
    staticMode: false
  }), [currentLineIndex, lyrics, playing, theme])

  const controls: LatticePlaybackActions = useMemo(() => ({
    playback: {
      prev: audioPrev,
      next: () => audioNext(),
      toggleLoop: cyclePlayMode,
      shuffleQueue: cyclePlayMode,
      toggleSongLike: () => undefined,
      isSongLiked: false,
      isFmMode: false
    },
    loopMode: toLoopMode(prefs.mode) as 'off' | 'all' | 'one',
    invokeCommandById,
    canInvokeCommandById
  }), [audioNext, audioPrev, canInvokeCommandById, cyclePlayMode, invokeCommandById, prefs.mode])

  const onPlaySong = useCallback((nextSong: SongResult, nextQueue: SongResult[]) => {
    const ids = nextQueue.map((s) => songIdToTrackId(s.id)).filter(Boolean)
    const targetId = songIdToTrackId(nextSong.id)
    if (targetId) playTrack(targetId, ids.length ? ids : undefined)
  }, [playTrack])

  // —— 可视化器（folia 的 14 个内建模式，原组件）——
  const { t: foliaT } = useTranslation()
  const visMode = useVisualizerSettingsStore((s) => s.visualizerMode)
  const setVisMode = useVisualizerSettingsStore((s) => s.handleSetVisualizerMode)
  const visModes = useMemo(() => VISUALIZER_REGISTRY.map((e) => e.mode), [])
  const visLabel = getVisualizerModeLabel(visMode, (key) => foliaT(key))

  const stepVisMode = useCallback((direction: -1 | 1) => {
    if (visModes.length < 2) return
    const index = visModes.indexOf(visMode)
    const next = visModes[(index + direction + visModes.length) % visModes.length]
    setVisMode(next, { notify: false })
  }, [setVisMode, visMode, visModes])

  const onLyricLineSeek = useCallback((index: number) => {
    const line = lyrics?.lines?.[index]
    if (line) onSeek(line.startTime)
  }, [lyrics, onSeek])

  const visualizerModel = useVisualizerRendererModel({
    theme,
    subtitleTheme: theme,
    seed: song?.id ?? track?.id,
    isObsBrowserSourceRendering: false,
    shouldPauseVisualizerBackground: false,
    hideTranslationSubtitle: false,
    isPlayerPageTransparent: false,
    onLyricLineSeek,
    onBack: onCloseLattice
  })

  if (!track && !song) return <audio ref={audioRef} preload='metadata' />

  return (
    <>
      <audio ref={audioRef} preload='metadata' />

      <FloatingPlayerControls
        currentSong={song ? { name: song.name } : null}
        playerState={displayState}
        currentTime={currentTime}
        lyricCurrentTime={lyricCurrentTime}
        duration={displayDuration}
        loopMode={toLoopMode(prefs.mode) as 'off' | 'all' | 'one'}
        currentView={nowPlayingOpen ? playView : 'home'}
        audioSrc={usePlaybackStore.getState().audioSrc}
        canTogglePlay
        lyrics={lyrics}
        onSeek={onSeek}
        onTogglePlay={onTogglePlay}
        onToggleLoop={cyclePlayMode}
        onNavigateToPlayer={onOpenPlayer}
        onFocusLatticeCurrentSong={onOpenLattice}
        primaryColor='var(--text-primary)'
        secondaryColor='var(--text-secondary)'
        theme={theme}
        isDaylight={false}
        // folia 只在歌曲墙那一档隐藏底部条（当前海报上自带控制），播放页上它是常驻的主传输条
        isHidden={nowPlayingOpen && playView === 'lattice'}
        trackNavigation={trackNavigation}
        slotPrimary={slotPrimary}
        slotSecondary={slotSecondary}
        slotContext={slotContext}
        onCommitBottomBarOffset={(offset) => {
          setBarOffset(offset)
          try { localStorage.setItem(BOTTOM_BAR_OFFSET_KEY, String(offset)) } catch { /* 忽略 */ }
        }}
      />

      {nowPlayingOpen && song && (
        <>
          {/* z-0 播放页本体 —— folia 的视觉层：「VISUALIZER (Background Layer & Main Click Target)」。
              封面配色背景 + 它自带的歌词浮层（VisualizerSubtitleOverlay）都长在这里，
              这就是「桌面播放形式」；歌曲墙是它上面的一档，不是它的替代品。 */}
          <div className='folia-player-surface' data-testid='player-visual-surface'>
            <VisualizerRenderer {...visualizerModel} />
          </div>

          {/* 模式步进器（folia 的入口在设置面板里，MAGI 侧给一颗最小控件） */}
          <div className='magi-vis-switch'>
            <button type='button' title='上一个动画' onClick={() => stepVisMode(-1)}>‹</button>
            <span className='magi-vis-label'>{visLabel}</span>
            <button type='button' title='下一个动画' onClick={() => stepVisMode(1)}>›</button>
          </div>

          {/* z-10 歌曲墙：只在 lattice 档出现 */}
          {playView === 'lattice' && (
            <div className='folia-lattice-host'>
              <Lattice
                controls={controls}
                lyrics={lyrics}
                lyricSource={lyricSource}
                lyricKeywordColoringEnabled={false}
                currentSong={song}
                playerState={displayState}
                currentTime={currentTime}
                playbackDuration={displayDuration}
                canTogglePlayback
                queue={playQueue}
                isDaylight={false}
                onBack={onOpenPlayer}
                onGoHome={onCloseLayer}
                onOpenPlayer={onOpenPlayer}
                onPlaySong={onPlaySong}
                onTogglePlayback={onTogglePlay}
                onSeek={onSeek}
              />
            </div>
          )}

          {/* z-60 播放页侧栏：folia 原 UnifiedPanel（大封面 + 标签页：封面/控制/队列/账户） */}
          {playView === 'player' && (
            <MagiPlayerPanel
              theme={theme}
              onClose={onCloseLayer}
              onOpenLattice={onOpenLattice}
              currentSong={song}
              playerState={displayState}
              loopMode={toLoopMode(prefs.mode) as 'off' | 'all' | 'one'}
              onToggleLoop={cyclePlayMode}
              onTogglePlay={onTogglePlay}
              onNext={() => audioNext()}
              onPrev={audioPrev}
              onPlaySong={onPlaySong}
              queue={playQueue}
              lyricTimelineOffsetMs={prefs.lyricOffsetMs ?? 0}
              onLyricTimelineOffsetChange={(value) => patchAudioPrefs({ lyricOffsetMs: value })}
            />
          )}
        </>
      )}
    </>
  )
}
