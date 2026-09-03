/**
 * Continuous voice conversation: listen → detect the end of speech → send.
 *
 * The owner asked to talk without pressing anything between turns, so the
 * hard part is deciding when they have finished speaking. Browsers give no
 * such signal, so amplitude is measured through an AnalyserNode and silence
 * is timed.
 *
 * Two thresholds matter, and both are about not cutting people off:
 *   - Nothing is submitted until speech has actually been heard, so a quiet
 *     room never fires an empty turn.
 *   - Silence must persist for SILENCE_MS. Japanese speech carries natural
 *     pauses mid-sentence; too short a window truncates the owner mid-thought.
 *     800ms is the shortest that held up in testing without clipping.
 */

// 800ms, down from 1400. Long enough to ride out the natural pauses in
// Japanese speech, short enough that the owner is not left waiting after
// they have clearly finished. Measured as ~0.6s off every turn.
const SILENCE_MS = 800;
const SPEECH_LEVEL = 0.045;   // above this counts as speech
const MAX_TURN_MS = 60_000;   // hard stop, so a stuck mic cannot run forever

export type VoiceLoopHandlers = {
  onLevel: (level: number) => void;
  onSpeechEnd: (audio: Blob) => void | Promise<void>;
  onError: (message: string) => void;
};

export type VoiceLoop = {
  stop: () => void;
  /** Pause capture while SOCIAL speaks, so it does not hear itself. */
  pause: () => void;
  resume: () => Promise<void>;
  isRunning: () => boolean;
};

export async function startVoiceLoop(
  h: VoiceLoopHandlers,
  pickMimeType: () => string | undefined,
): Promise<VoiceLoop> {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { echoCancellation: true, noiseSuppression: true },
  });

  const AudioCtx =
    window.AudioContext ??
    (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  const ctx = new AudioCtx();
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 512;
  ctx.createMediaStreamSource(stream).connect(analyser);
  const buf = new Uint8Array(analyser.frequencyBinCount);

  let recorder: MediaRecorder | null = null;
  let chunks: Blob[] = [];
  let running = true;
  let paused = false;
  let heardSpeech = false;
  let silenceSince = 0;
  let turnStart = 0;
  let raf = 0;

  function beginTurn() {
    const mimeType = pickMimeType();
    recorder = mimeType
      ? new MediaRecorder(stream, { mimeType })
      : new MediaRecorder(stream);
    chunks = [];
    heardSpeech = false;
    silenceSince = 0;
    turnStart = performance.now();

    recorder.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
    recorder.onstop = () => {
      const audio = new Blob(chunks, { type: recorder?.mimeType || "audio/webm" });
      // Only surface a turn that actually contained speech.
      if (heardSpeech && audio.size > 1200) void h.onSpeechEnd(audio);
      else if (running && !paused) beginTurn();
    };
    recorder.start(250);
  }

  function tick() {
    if (!running) return;
    raf = requestAnimationFrame(tick);
    if (paused || !recorder) return;

    analyser.getByteTimeDomainData(buf);
    // RMS around the 128 midpoint gives a stable 0–1 loudness.
    let sum = 0;
    for (const v of buf) {
      const d = (v - 128) / 128;
      sum += d * d;
    }
    const level = Math.sqrt(sum / buf.length);
    h.onLevel(level);

    const now = performance.now();
    if (level > SPEECH_LEVEL) {
      heardSpeech = true;
      silenceSince = 0;
    } else if (heardSpeech) {
      if (!silenceSince) silenceSince = now;
      if (now - silenceSince > SILENCE_MS && recorder.state === "recording") {
        recorder.stop();
        return;
      }
    }

    if (now - turnStart > MAX_TURN_MS && recorder.state === "recording") {
      recorder.stop();
    }
  }

  beginTurn();
  tick();

  return {
    isRunning: () => running,
    pause() {
      paused = true;
      if (recorder?.state === "recording") {
        recorder.onstop = null;      // this stop is not an end-of-speech
        recorder.stop();
      }
      recorder = null;
      h.onLevel(0);
    },
    async resume() {
      if (!running) return;
      paused = false;
      if (ctx.state === "suspended") await ctx.resume();
      beginTurn();
    },
    stop() {
      running = false;
      paused = true;
      cancelAnimationFrame(raf);
      if (recorder?.state === "recording") {
        recorder.onstop = null;
        recorder.stop();
      }
      recorder = null;
      stream.getTracks().forEach((t) => t.stop());
      void ctx.close().catch(() => {});
    },
  };
}
