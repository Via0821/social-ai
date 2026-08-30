/**
 * Microphone recording that works on Safari as well as Chrome.
 *
 * The owner reported voice "not being recognised at all". The old code
 * hard-coded `audio/webm`: Chrome produces that, but Safari on iOS and macOS
 * does not support it and records `audio/mp4` instead. Asking for an
 * unsupported type makes MediaRecorder throw, so nothing was ever sent.
 *
 * Here the browser is asked what it can actually produce, and the filename
 * extension is derived from the resulting blob so the API sees a type that
 * matches the bytes.
 */

const CANDIDATES = [
  "audio/webm;codecs=opus",
  "audio/webm",
  "audio/mp4",
  "audio/mpeg",
  "audio/ogg;codecs=opus",
];

const EXT: Record<string, string> = {
  "audio/webm": "webm",
  "audio/mp4": "m4a",
  "audio/mpeg": "mp3",
  "audio/ogg": "ogg",
};

export function pickMimeType(): string | undefined {
  if (typeof MediaRecorder === "undefined") return undefined;
  for (const type of CANDIDATES) {
    try {
      if (MediaRecorder.isTypeSupported(type)) return type;
    } catch {
      /* older browsers throw rather than return false */
    }
  }
  return undefined; // let the browser choose its own default
}

export function extensionFor(blob: Blob): string {
  const base = (blob.type || "").split(";")[0].trim();
  return EXT[base] ?? "webm";
}

export function isRecordingSupported(): boolean {
  return (
    typeof navigator !== "undefined" &&
    !!navigator.mediaDevices?.getUserMedia &&
    typeof MediaRecorder !== "undefined"
  );
}

export type Recording = {
  stop: () => void;
  cancel: () => void;
};

/** Start recording; `onDone` receives the audio once `stop()` is called. */
export async function startRecording(
  onDone: (blob: Blob) => void | Promise<void>,
): Promise<Recording> {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  const mimeType = pickMimeType();
  const rec = mimeType
    ? new MediaRecorder(stream, { mimeType })
    : new MediaRecorder(stream);

  const chunks: Blob[] = [];
  let cancelled = false;

  rec.ondataavailable = (e) => {
    if (e.data.size > 0) chunks.push(e.data);
  };
  rec.onstop = () => {
    stream.getTracks().forEach((t) => t.stop());
    if (cancelled) return;
    void onDone(new Blob(chunks, { type: rec.mimeType || mimeType || "audio/webm" }));
  };

  // Timeslice so Safari flushes data even on a short recording.
  rec.start(250);

  return {
    stop: () => { if (rec.state !== "inactive") rec.stop(); },
    cancel: () => {
      cancelled = true;
      if (rec.state !== "inactive") rec.stop();
      stream.getTracks().forEach((t) => t.stop());
    },
  };
}
