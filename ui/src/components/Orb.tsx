export type OrbState = "idle" | "listening" | "thinking" | "speaking";

/**
 * The sphere on the TALK screen.
 *
 * Hand-drawn SVG plus CSS keyframes — the owner asked for a lightweight
 * animation rather than video or a paid service, and this ships as a few KB
 * with no dependency and no network call.
 *
 * `level` is live microphone amplitude (0–1). When listening, the waveform
 * bars and the glow follow the owner's actual voice instead of looping a
 * canned animation, which is what makes it feel responsive.
 */
export default function Orb({
  state,
  level = 0,
  size = 260,
}: {
  state: OrbState;
  level?: number;
  size?: number;
}) {
  const motion =
    state === "listening" ? "orb-listening"
    : state === "thinking" ? "orb-thinking"
    : state === "speaking" ? "orb-speaking"
    : "orb-idle";

  // Voice-reactive scale, clamped so a loud room cannot distort the layout.
  const reactive = state === "listening" || state === "speaking"
    ? 1 + Math.min(level, 1) * 0.12
    : 1;

  return (
    <div
      className="relative grid place-items-center"
      style={{ width: size, height: size }}
      aria-hidden
    >
      {/* Expanding rings — presence, without demanding attention. */}
      {(state === "listening" || state === "speaking") && (
        <>
          <span className="ring-pulse absolute inset-0 rounded-full border border-sky-400/30" />
          <span
            className="ring-pulse absolute inset-0 rounded-full border border-sky-400/20"
            style={{ animationDelay: "1.3s" }}
          />
        </>
      )}

      {/* Waveform, mirrored either side, as in the mockup. */}
      {state === "listening" && (
        <>
          <Waveform level={level} side="left" size={size} />
          <Waveform level={level} side="right" size={size} />
        </>
      )}

      <div
        className={motion}
        style={{ transform: `scale(${reactive})`, transition: "transform 90ms linear" }}
      >
        <svg width={size * 0.68} height={size * 0.68} viewBox="0 0 200 200">
          <defs>
            <radialGradient id="orbBody" cx="50%" cy="42%" r="62%">
              <stop offset="0%"   stopColor="#7db9ff" stopOpacity=".95" />
              <stop offset="45%"  stopColor="#2f6fd0" stopOpacity=".55" />
              <stop offset="100%" stopColor="#050a18" stopOpacity=".95" />
            </radialGradient>
            <radialGradient id="orbGlow" cx="50%" cy="50%" r="50%">
              <stop offset="60%"  stopColor="#2f80ff" stopOpacity="0" />
              <stop offset="100%" stopColor="#2f80ff" stopOpacity=".5" />
            </radialGradient>
            <filter id="orbBlur"><feGaussianBlur stdDeviation="2.2" /></filter>
          </defs>

          <circle cx="100" cy="100" r="94" fill="url(#orbGlow)" />
          <circle cx="100" cy="100" r="78" fill="url(#orbBody)" />
          <circle cx="100" cy="100" r="78" fill="none"
                  stroke="#a8d0ff" strokeOpacity=".55" strokeWidth="1.2" />

          {/* Interlaced arcs. The counter-rotating pair reads as depth,
              and speeds up while SOCIAL is thinking. */}
          <g
            className={state === "thinking" ? "orb-swirl-fast" : "orb-swirl"}
            filter="url(#orbBlur)"
            fill="none"
            stroke="#9ccbff"
            strokeOpacity=".5"
            strokeWidth="1.4"
          >
            {[0, 40, 80, 120].map((deg) => (
              <ellipse key={deg} cx="100" cy="100" rx="74" ry="34"
                       transform={`rotate(${deg} 100 100)`} />
            ))}
          </g>
          <g
            className={state === "thinking" ? "orb-swirl-fast" : "orb-swirl"}
            style={{ animationDirection: "reverse", animationDuration: "17s" }}
            fill="none"
            stroke="#d6e9ff"
            strokeOpacity=".32"
            strokeWidth="1"
          >
            {[20, 70, 110].map((deg) => (
              <ellipse key={deg} cx="100" cy="100" rx="52" ry="72"
                       transform={`rotate(${deg} 100 100)`} />
            ))}
          </g>

          <ellipse cx="82" cy="66" rx="26" ry="16" fill="#eaf4ff" opacity=".28"
                   filter="url(#orbBlur)" transform="rotate(-24 82 66)" />
        </svg>
      </div>
    </div>
  );
}

function Waveform({
  level, side, size,
}: { level: number; side: "left" | "right"; size: number }) {
  const bars = 7;
  return (
    <div
      className="pointer-events-none absolute flex items-center gap-1"
      style={{
        [side]: -size * 0.06,
        height: size * 0.42,
      } as React.CSSProperties}
    >
      {Array.from({ length: bars }).map((_, i) => {
        // Taller toward the sphere, so the shape mirrors the mockup.
        const nearness = side === "left" ? (i + 1) / bars : (bars - i) / bars;
        const height = 6 + nearness * (10 + level * 60);
        return (
          <span
            key={i}
            className="wave-bar block w-[3px] rounded-full bg-sky-400/70"
            style={{ height, animationDelay: `${i * 90}ms` }}
          />
        );
      })}
    </div>
  );
}
