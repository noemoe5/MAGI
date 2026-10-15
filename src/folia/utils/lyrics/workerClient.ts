import { parseLyricsByFormat, type LyricParseFormat } from './parserCore';
import type { LyricData } from '../../types';
import type { LyricProcessingOptions } from './types';

// MAGI 版：不启用 Web Worker。
// 原因：Electron 生产环境以 file:// 载入渲染层，Worker 脚本源（file:// 不透明源）不可靠；
// 且歌词解析本身已足够轻量（parserCore 同步函数），直接就地计算，行为与 worker 分支完全一致。

type WorkerLyricProcessingOptions = Pick<LyricProcessingOptions, 'includeInterludes' | 'filterPattern'>;

// Keeps orchestration-only values such as provider callbacks outside the structured-clone boundary.
export const toWorkerLyricProcessingOptions = (
    options?: LyricProcessingOptions,
): WorkerLyricProcessingOptions | undefined => {
    if (!options) return undefined;
    return {
        ...(options.includeInterludes !== undefined ? { includeInterludes: options.includeInterludes } : {}),
        ...(options.filterPattern !== undefined ? { filterPattern: options.filterPattern } : {}),
    };
};

const normalizeWorkerFormat = (format: string): LyricParseFormat => {
    if (format === 'yrc' || format === 'qrc' || format === 'krc' || format === 'awlrc' || format === 'enhanced-lrc' || format === 'vtt' || format === 'ttml') {
        return format;
    }
    return 'lrc';
};

export const parseLyricsAsync = async (
    format: LyricParseFormat,
    content: string,
    translation?: string,
    options?: LyricProcessingOptions,
    romanization?: string
): Promise<LyricData | null> => {
    try {
        return parseLyricsByFormat(
            normalizeWorkerFormat(format),
            content,
            translation || '',
            options,
            romanization || '',
        );
    } catch (err) {
        console.warn('[LyricsWorker] parsing error:', String(err));
        return null;
    }
};

