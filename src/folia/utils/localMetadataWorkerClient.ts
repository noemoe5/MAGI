// MAGI 版：folia 原本用 Worker 跑 music-metadata 解析本地文件标签。
// 打包后渲染层走 `file://`，Worker 脚本源不可靠；而且 MAGI 里这条路径本来就是死代码——
// 音频元数据统一由主进程的 `media-probe` 出（`electron/main.cjs`），渲染层不再自己读标签，
// music-metadata 也就没被打进渲染层包。
// 所以这里保留上游的导出面与类型，实现一律回答「拿不到」，调用方自然会走主进程那条路。

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

/** MAGI 里没有 worker；永远返回 null。 */
export const initMetadataWorker = (): Worker | null => null;

export const parseEmbeddedMetadataAsync = async (
    _file: File,
    _includeCover = false
): Promise<EmbeddedMetadataResult | null> => null;

export const hashLocalCoverBlobAsync = async (
    _cover: Blob
): Promise<HashedLocalCoverResult | null> => null;
