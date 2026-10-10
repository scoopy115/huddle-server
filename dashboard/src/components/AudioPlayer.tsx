// Ported from the Huddle desktop app (apps/desktop/src/components/AudioPlayer.tsx).
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Pause, Play, RotateCcw, RotateCw } from "lucide-react";
import { fmtTime } from "@/lib/format";
import { Button } from "@/components/ui";

export interface PlayerHandle {
  seekTo: (sec: number, play?: boolean) => void;
}

const SKIP_SEC = 15;

export function AudioPlayer({
  meetingId,
  path,
  durationHint,
  onTime,
  handleRef,
}: {
  meetingId: string;
  path: string | null;
  durationHint?: number | null;
  onTime?: (t: number) => void;
  handleRef: React.MutableRefObject<PlayerHandle | null>;
}) {
  const audio = useRef<HTMLAudioElement>(null);
  const bar = useRef<HTMLDivElement>(null);
  // The main bar sits above the transcript; once it scrolls out of view a small
  // floating player takes over in the bottom-right corner.
  const [barVisible, setBarVisible] = useState(true);
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(durationHint ?? 0);
  const [rate, setRate] = useState(1);
  // While the thumb is dragged only the label follows; the seek happens on release.
  const [scrub, setScrub] = useState<number | null>(null);
  const last = useRef({ t: 0, playing: false });
  // The path changes once the server has prepared the audio; that reloads the element.
  const src = path ? `/api/meetings/${encodeURIComponent(meetingId)}/audio?v=${encodeURIComponent(path.split("/").pop() ?? "")}` : null;

  useEffect(() => {
    handleRef.current = {
      seekTo: (sec, play = true) => {
        const a = audio.current;
        if (!a) return;
        a.currentTime = Math.max(0, sec);
        if (play) a.play().catch(() => {});
      },
    };
  }, [handleRef]);

  useEffect(() => {
    const a = audio.current;
    if (!a) return;
    const onT = () => {
      last.current.t = a.currentTime;
      setTime(a.currentTime);
      onTime?.(a.currentTime);
    };
    const onPlay = () => { last.current.playing = true; setPlaying(true); };
    const onPause = () => { last.current.playing = false; setPlaying(false); };
    const onD = () => setDuration(isFinite(a.duration) ? a.duration : durationHint ?? 0);
    a.addEventListener("timeupdate", onT);
    a.addEventListener("durationchange", onD);
    a.addEventListener("play", onPlay);
    a.addEventListener("pause", onPause);
    a.addEventListener("ended", onPause);
    return () => {
      a.removeEventListener("timeupdate", onT);
      a.removeEventListener("durationchange", onD);
      a.removeEventListener("play", onPlay);
      a.removeEventListener("pause", onPause);
      a.removeEventListener("ended", onPause);
    };
  }, [onTime, durationHint, src]);

  // The server swaps in a compact copy of the audio once it is ready; keep the position.
  useEffect(() => {
    const a = audio.current;
    const { t, playing } = last.current;
    if (!a || t <= 0) return;
    const resume = () => {
      a.currentTime = t;
      if (playing) a.play().catch(() => {});
    };
    a.addEventListener("loadedmetadata", resume, { once: true });
    return () => a.removeEventListener("loadedmetadata", resume);
  }, [src]);

  useEffect(() => {
    if (audio.current) audio.current.playbackRate = rate;
  }, [rate]);

  useEffect(() => {
    const el = bar.current;
    if (!el) return;
    const obs = new IntersectionObserver(([entry]) => setBarVisible(entry.isIntersecting), { threshold: 0 });
    obs.observe(el);
    return () => obs.disconnect();
  }, [src]);

  if (!src) {
    return <div className="rounded-lg border border-dashed border-border px-4 py-3 text-[12px] text-muted">Audio not available yet.</div>;
  }

  const toggle = () => {
    const a = audio.current;
    if (!a) return;
    if (a.paused) a.play().catch(() => {});
    else a.pause();
  };
  const commitScrub = () => {
    const a = audio.current;
    if (a && scrub != null) a.currentTime = scrub;
    setScrub(null);
  };
  const skip = (d: number) => {
    const a = audio.current;
    if (a) a.currentTime = Math.min(Math.max(0, a.currentTime + d), duration || a.currentTime + d);
  };

  const controls = (
    <>
      <Button variant="ghost" size="sm" onClick={() => skip(-SKIP_SEC)} title={`Back ${SKIP_SEC} s`}><RotateCcw className="h-3.5 w-3.5" /></Button>
      <Button variant="record" size="sm" className="h-8 w-8 rounded-full p-0" onClick={toggle} title={playing ? "Pause" : "Play"}>
        {playing ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5 translate-x-px" />}
      </Button>
      <Button variant="ghost" size="sm" onClick={() => skip(SKIP_SEC)} title={`Forward ${SKIP_SEC} s`}><RotateCw className="h-3.5 w-3.5" /></Button>
    </>
  );

  return (
    <div ref={bar} className="flex items-center gap-2 panel px-3 py-2 sm:gap-3">
      <audio ref={audio} src={src} preload="metadata" />
      {controls}
      <span className="w-[44px] text-right font-mono text-[11px] tabular-nums text-muted">{fmtTime(scrub ?? time)}</span>
      <input
        type="range"
        min={0}
        max={duration || 1}
        step={0.1}
        value={Math.min(scrub ?? time, duration || 1)}
        onChange={(e) => setScrub(Number(e.target.value))}
        onPointerUp={commitScrub}
        onKeyUp={commitScrub}
        onTouchEnd={commitScrub}
        className="min-w-0 flex-1 accent-[rgb(var(--accent))]"
      />
      <span className="w-[44px] font-mono text-[11px] tabular-nums text-muted">{fmtTime(duration)}</span>
      <button
        className="hidden rounded px-1.5 py-0.5 text-[11px] font-medium text-muted hover:bg-fg/[0.06] sm:block"
        onClick={() => setRate(rate === 1 ? 1.25 : rate === 1.25 ? 1.5 : rate === 1.5 ? 2 : 1)}
      >
        {rate}×
      </button>
      {!barVisible &&
        createPortal(
          <div className="animate-rise fixed bottom-5 right-5 z-30 flex items-center gap-1.5 panel py-1.5 pl-1.5 pr-3 shadow-xl">
            {controls}
            <span className="ml-1 font-mono text-[11px] tabular-nums text-muted">
              {fmtTime(time)} <span className="opacity-60">/ {fmtTime(duration)}</span>
            </span>
          </div>,
          document.body,
        )}
    </div>
  );
}
