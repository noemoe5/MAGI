// 全局音频图单例：AudioPlayerBar 负责 attach（用户手势中），NowPlaying 负责取数据画可视化
import { AudioVisualizer } from './visualizer'

export const audioGraph = new AudioVisualizer()
