// MAGI 版：不启用 Web Worker。
// folia 原版用 worker + music-metadata 在渲染层解析本地文件标签；MAGI 的媒体库元数据统一由
// Electron 主进程（`mediaProbe` / `mediaSidecar`）提供，这条渲染层路径在 MAGI 里不会被走到。
// 保留接口形状（含 EmbeddedMetadataResult / HashedLocalCoverResult），实现改为就地空实现，
// 既避免把 music-metadata 打进渲染层，也避开 Electron file:// 下 Worker 源不可靠的问题。

export interface EmbeddedMetadataResult {
    title?: string;
    artist?: string;
    artists?: string[];
    album?: string;
    trackNumber?: number;
    discNumber?: number;
    cover?: Blob;
    coverAssetId?: string;
    bitrate?: number;
    lyrics?: string;
    translationLyrics?: string;
    replayGain?: number;
    replayGainTrackGain?: number;
    replayGainTrackPeak?: number;
    replayGainAlbumGain?: number;
    replayGainAlbumPeak?: number;
    duration?: number;
}

export interface HashedLocalCoverResult {
    cover: Blob;
    coverAssetId: string;
}

/** 保留导出以免调用方改动；MAGI 下为无操作。 */
export const initMetadataWorker = (): Worker | null => null;

export const parseEmbeddedMetadataAsync = async (
    _file: File,
    _includeCover = false
): Promise<EmbeddedMetadataResult | null> => null;

export const hashLocalCoverBlobAsync = async (
    _cover: Blob
): Promise<HashedLocalCoverResult | null> => null;

