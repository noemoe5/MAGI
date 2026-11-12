// 远程试听曲目：直接塞进播放队列，不落 library.json（container === 'remote' 的条目在快照时被过滤）。
import { useStore } from '../store/useStore'
import type { AudioTrack } from '../types'

export function addRemoteTrackAndPlay(track: AudioTrack, queue?: AudioTrack[]) {
  const s = useStore.getState()
  const known = new Set(s.audioTracks.map((t) => t.id))
  const incoming = queue?.length ? [track, ...queue] : [track]
  const fresh = incoming.filter((t) => !known.has(t.id))
  if (fresh.length) {
    // 走原生 setState：远程直链不需要（也不应该）进主进程的本地路径白名单
    useStore.setState({ audioTracks: [...fresh, ...s.audioTracks] })
  }
  const queueIds = (queue?.length ? queue.map((t) => t.id) : [track.id])
  useStore.getState().playTrack(track.id, queueIds)
}
