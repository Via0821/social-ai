/**
 * Speak sentences as they arrive, instead of waiting for the whole answer.
 *
 * Synthesising a full reply took ~1.6s before a single word was heard. The
 * server now emits complete sentences as the model writes them, so the first
 * one can be synthesised and played while the rest is still being generated —
 * the owner hears SOCIAL start talking roughly a second sooner.
 *
 * Synthesis runs ahead of playback (a small look-ahead), but playback stays
 * strictly in order, or sentences would overlap.
 */

import { api } from "./api";
import { speak, stopSpeaking } from "./audioOut";

const LOOKAHEAD = 2;

export type TtsQueue = {
  /** Queue a sentence. Safe to call while earlier ones are still playing. */
  push: (sentence: string) => void;
  /** No more sentences are coming. Resolves once the last one finishes. */
  finish: () => Promise<void>;
  /** Abandon everything, including audio already playing (barge-in, stop). */
  cancel: () => void;
};

export function createTtsQueue(onError?: (m: string) => void): TtsQueue {
  const audio: (Promise<Blob> | null)[] = [];
  let queued = 0;
  let playIndex = 0;
  let cancelled = false;
  let closed = false;
  let playing: Promise<void> = Promise.resolve();
  let resolveDone: (() => void) | null = null;
  const done = new Promise<void>((r) => { resolveDone = r; });

  function maybeFinish() {
    if (closed && playIndex >= queued && resolveDone) {
      resolveDone();
      resolveDone = null;
    }
  }

  function synthesiseFrom(index: number) {
    // Keep a couple of sentences synthesising ahead of the one being played,
    // without firing every request at once.
    for (let i = index; i < Math.min(queued, index + LOOKAHEAD); i++) {
      if (audio[i] === null) {
        audio[i] = api.speak(sentences[i]).catch((e) => {
          throw e;
        });
      }
    }
  }

  const sentences: string[] = [];

  function pump() {
    playing = playing.then(async () => {
      if (cancelled) return;
      const index = playIndex;
      if (index >= queued) { maybeFinish(); return; }

      synthesiseFrom(index);
      try {
        const blob = await audio[index]!;
        if (cancelled) return;
        await speak(blob, () => {});
      } catch {
        onError?.("音声を再生できませんでした。");
      } finally {
        audio[index] = null;   // release the blob
        playIndex = index + 1;
        maybeFinish();
      }
      if (!cancelled && playIndex < queued) pump();
    });
  }

  return {
    push(sentence: string) {
      if (cancelled || closed) return;
      const text = sentence.trim();
      if (!text) return;
      sentences.push(text);
      audio.push(null);
      queued += 1;
      synthesiseFrom(playIndex);
      if (playIndex === queued - 1) pump();   // nothing was playing
    },
    finish() {
      closed = true;
      maybeFinish();
      return done;
    },
    cancel() {
      cancelled = true;
      closed = true;
      stopSpeaking();
      if (resolveDone) { resolveDone(); resolveDone = null; }
    },
  };
}
