import { melSpectrogram, type MelSpectrogram } from './beatThis';
import { analyseTrack, type TrackProfile } from './trackProfile';

// src/services/automix/analysisOffThread.ts
// The same two measurements, asked for on a worker when there is one.
//
// Every path ends in the identical function, so "no worker" and "worker failed" are not degraded
// answers - they are the same answer computed elsewhere. That is what makes the fallback safe to
// leave untested outside the unit suite: it runs in Node with no `Worker`, so every maths test
// already exercises the fallback, and the worker branch adds no maths of its own.
//
// One worker, kept for the session. Analysis is serialised upstream in `profileService` - one decode
// at a time, since a decode allocates tens of megabytes - so a pool has nothing to parallelise, and
// one worker per track would pay a module graph's startup for a job measured in seconds.

type AnalyseOptions = Parameters<typeof analyseTrack>[2];

interface Reply {
    id: number;
    result?: unknown;
    error?: string;
}

let worker: Worker | null = null;
/** Set once the worker cannot be had or has failed; from then on everything runs in place. */
let offThreadDeclined = false;
let nextId = 0;
const pending = new Map<number, (reply: Reply) => void>();

/**
 * Gives up on the worker for the rest of the session.
 *
 * All three ways here are permanent for the life of the page - no `Worker` constructor, a module the
 * bundler could not give the worker, a runtime error inside it - so retrying only pays the
 * construction cost again per track to reach the same place.
 */
const decline = (why: string) => {
    if (!offThreadDeclined) console.warn(`[Automix] analysing on the main thread instead: ${why}`);
    offThreadDeclined = true;
    worker?.terminate();
    worker = null;
    // Nobody is left to answer them; the caller's own fallback picks each one up.
    for (const settle of pending.values()) settle({ id: -1, error: why });
    pending.clear();
};

const ensureWorker = (): Worker | null => {
    if (offThreadDeclined) return null;
    if (worker) return worker;
    // MAGI 版：不启用 worker。Electron 生产环境以 file:// 载入渲染层，Worker 脚本源不可靠；
    // 本模块的 worker 分支与就地计算调用的是同一套函数（melSpectrogram / analyseTrack），
    // 结果完全一致，只是计算位置不同，因此直接走就地分支。
    if (!offThreadDeclined) console.warn('[Automix] analysing on the main thread instead: worker disabled in MAGI build');
    offThreadDeclined = true;
    return null;
};

const send = (message: Record<string, unknown>): Promise<Reply> | null => {
    const active = ensureWorker();
    if (!active) return null;
    const id = (nextId += 1);
    return new Promise<Reply>((resolve) => {
        pending.set(id, resolve);
        try {
            active.postMessage({ ...message, id });
        } catch (error) {
            // A structured-clone failure, which would repeat for every track of the same shape.
            pending.delete(id);
            decline(String(error));
            resolve({ id, error: String(error) });
        }
    });
};

/** The spectrogram Beat This! is fed. Identical to `melSpectrogram`, computed elsewhere. */
export const melSpectrogramOffThread = async (mono: Float32Array): Promise<MelSpectrogram> => {
    const reply = await send({ kind: 'mel', mono });
    if (reply && !reply.error) return reply.result as MelSpectrogram;
    return melSpectrogram(mono);
};

/** One track measured. Identical to `analyseTrack`, computed elsewhere. */
export const analyseTrackOffThread = async (
    mono: Float32Array,
    sampleRate: number,
    options: AnalyseOptions = {},
): Promise<TrackProfile | null> => {
    const reply = await send({ kind: 'profile', mono, sampleRate, options });
    if (reply && !reply.error) return reply.result as TrackProfile | null;
    return analyseTrack(mono, sampleRate, options);
};
