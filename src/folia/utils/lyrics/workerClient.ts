import { LyricData } from '../../types';
import { parseLyricsByFormat, type LyricParseFormat } from './parserCore';
import type { LyricProcessingOptions } from './types';

// MAGI 版：folia 原本把歌词解析丢给 Web Worker（`workers/lyricsParser.worker.ts`）。
// 打包后渲染层走 `file://`，Worker 脚本源不可靠，所以这里改成**同一段逻辑就地跑**——
// 依赖的 `parseLyricsByFormat` 本来就是纯函数，不碰 DOM，省掉结构克隆反而更快。
// 导出面（`toWorkerLyricProcessingOptions` / `normalizeWorkerFormat` / `parseLyricsAsync`）与上游保持一致，
// 调用方（三个 LyricAdapter）不需要改。

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

/** 与 `workers/lyricsParser.worker.ts` 里的 normalizeWorkerFormat 同义（保留原签名以便调用方不变） */
export const normalizeWorkerFormat = (format: string): LyricParseFormat => {
    if (
        format === 'yrc' || format === 'qrc' || format === 'krc' || format === 'awlrc'
        || format === 'enhanced-lrc' || format === 'vtt' || format === 'ttml'
    ) {
        return format;
    }
    return 'lrc';
};

/** MAGI 里没有 worker 了；保留这个导出只为兼容可能存在的调用，永远返回 null。 */
export const initLyricsWorker = (): Worker | null => null;

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
            toWorkerLyricProcessingOptions(options) as LyricProcessingOptions | undefined,
            romanization || ''
        );
    } catch (err) {
        console.warn('[Lyrics] parsing failed:', err);
        return null;
    }
};
