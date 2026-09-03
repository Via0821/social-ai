/**
 * Playback for SOCIAL's voice.
 *
 * Safari — and increasingly Chrome — only allow `play()` inside a user
 * gesture. In TALK the owner taps once to start, then every reply plays from
 * deep inside an async chain (record → transcribe → ask → speak), by which
 * point the gesture context is long gone and playback is silently refused.
 * Text arrived, voice did not.
 *
 * The fix is to create ONE element during the tap, unlock it there, and reuse
 * it for every later reply. A element unlocked by a gesture stays unlocked.
 */

let el: HTMLAudioElement | null = null;
let unlocked = false;

/** 50ms of silence — enough to satisfy the gesture requirement. */
const SILENCE =
  "data:audio/mpeg;base64,SUQzBAAAAAAAI1RTU0UAAAAPAAADTGF2ZjU4Ljc2LjEwMAAAAAAAAAAAAAAA" +
  "//tAwAAAAAAAAAAAAAAAAAAAAAAASW5mbwAAAA8AAAAEAAABIADAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDA" +
  "wMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDA" +
  "AAAAOQAAAAAAAAAAAAAAAAAAAAD/+xDEAAPAAAGkAAAAIAAANIAAAARMQU1FMy4xMDBVVVVVVVVVVVVVVVVV";

/**
 * Call this synchronously from a click/tap handler, before any `await`.
 * Safe to call repeatedly.
 */
export function unlockAudio(): void {
  if (!el) {
    el = new Audio();
    el.preload = "auto";
  }
  if (unlocked) return;
  el.src = SILENCE;
  el.play()
    .then(() => { unlocked = true; })
    .catch(() => { /* some browsers need a second gesture; try again later */ });
}

export type PlayResult = "played" | "blocked" | "failed";

/** Play a reply. Resolves once playback finishes (or immediately on failure). */
export async function speak(
  blob: Blob,
  onEnded: () => void,
): Promise<PlayResult> {
  if (!el) el = new Audio();
  const url = URL.createObjectURL(blob);

  return new Promise<PlayResult>((resolve) => {
    const audio = el as HTMLAudioElement;
    const cleanup = () => {
      audio.onended = null;
      audio.onerror = null;
      URL.revokeObjectURL(url);
    };

    audio.onended = () => { cleanup(); onEnded(); resolve("played"); };
    audio.onerror = () => { cleanup(); onEnded(); resolve("failed"); };
    audio.src = url;

    audio.play().catch((err) => {
      cleanup();
      onEnded();
      // NotAllowedError is the autoplay block specifically — worth telling
      // the owner apart from a genuine playback failure.
      resolve(
        err instanceof DOMException && err.name === "NotAllowedError"
          ? "blocked"
          : "failed",
      );
    });
  });
}

export function stopSpeaking(): void {
  if (!el) return;
  el.pause();
  el.currentTime = 0;
}
