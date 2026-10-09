import { useCallback, useEffect, useRef, useState } from "react";
import { Languages, Mic, Monitor, NotebookPen, Pause, Play, Square, Users } from "lucide-react";
import { api, errorMessage } from "@/lib/api";
import { fmtTime } from "@/lib/format";
import { navigate } from "@/lib/router";
import { cn } from "@/lib/utils";
import { Button, Input, Select } from "@/components/ui";

const LANGS: [string, string][] = [["auto", "Detect automatically"], ["en", "English"], ["nl", "Dutch"], ["de", "German"], ["fr", "French"], ["es", "Spanish"], ["it", "Italian"], ["pt", "Portuguese"], ["pl", "Polish"], ["sv", "Swedish"], ["da", "Danish"], ["no", "Norwegian"], ["fi", "Finnish"], ["tr", "Turkish"], ["ja", "Japanese"], ["ko", "Korean"], ["zh", "Chinese"]];
const NOTES_LANGS = LANGS.filter(([c]) => c !== "auto");
const BARS = 48;

function mimeType(): { mime: string; ext: string } {
  for (const [mime, ext] of [["audio/webm;codecs=opus", "webm"], ["audio/webm", "webm"], ["audio/mp4", "m4a"], ["audio/ogg;codecs=opus", "ogg"]] as const) {
    if (typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(mime)) return { mime, ext };
  }
  return { mime: "", ext: "webm" };
}

/** Record in the browser; the server processes it like any client's recording. */
export function Record() {
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [device, setDevice] = useState<string>("");
  const [title, setTitle] = useState("");
  const [language, setLanguage] = useState("auto");
  const [notesLanguage, setNotesLanguage] = useState(() => (navigator.language || "en").slice(0, 2));
  const [mode, setMode] = useState<"meeting" | "interview">("meeting");
  const [speakers, setSpeakers] = useState(0);
  const [systemAudio, setSystemAudio] = useState(false);
  const canShare = typeof navigator !== "undefined" && !!navigator.mediaDevices?.getDisplayMedia;
  const display = useRef<MediaStream | null>(null);
  const [state, setState] = useState<"idle" | "recording" | "paused" | "uploading">("idle");
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [unsupported] = useState(() => typeof MediaRecorder === "undefined" || !navigator.mediaDevices);
  const rec = useRef<MediaRecorder | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const chunks = useRef<Blob[]>([]);
  const startedAt = useRef(0);
  const pausedFor = useRef(0);
  const pausedAt = useRef(0);
  const levels = useRef<number[]>(Array.from({ length: BARS }, () => 0));
  const analyser = useRef<AnalyserNode | null>(null);
  const audioCtx = useRef<AudioContext | null>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const raf = useRef(0);
  const lastSample = useRef(0);

  useEffect(() => {
    navigator.mediaDevices?.enumerateDevices().then((d) => setDevices(d.filter((x) => x.kind === "audioinput"))).catch(() => {});
  }, []);

  const draw = useCallback(() => {
    const c = canvas.current;
    if (c) {
      const ctx = c.getContext("2d")!;
      const dpr = window.devicePixelRatio || 1;
      const w = c.clientWidth, h = c.clientHeight;
      if (c.width !== w * dpr) { c.width = w * dpr; c.height = h * dpr; }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      if (analyser.current && state === "recording" && performance.now() - lastSample.current >= 100) {
        lastSample.current = performance.now();
        const buf = new Uint8Array(analyser.current.fftSize);
        analyser.current.getByteTimeDomainData(buf);
        let sum = 0;
        for (const v of buf) { const x = (v - 128) / 128; sum += x * x; }
        const rms = Math.sqrt(sum / buf.length);
        levels.current.push(Math.min(1, Math.max(0, (20 * Math.log10(Math.max(rms, 1e-6)) + 50) / 40)));
        if (levels.current.length > BARS) levels.current.shift();
      }
      const gap = 3, bw = (w - gap * (BARS - 1)) / BARS;
      const accent = getComputedStyle(document.documentElement).getPropertyValue("--accent").trim();
      for (let i = 0; i < BARS; i++) {
        const v = levels.current[i] ?? 0;
        const bh = Math.max(3, v * h);
        ctx.fillStyle = `rgb(${accent} / ${state === "recording" ? 0.3 + v * 0.7 : 0.18})`;
        ctx.beginPath(); ctx.roundRect(i * (bw + gap), (h - bh) / 2, bw, bh, 2); ctx.fill();
      }
    }
    raf.current = requestAnimationFrame(draw);
  }, [state]);
  useEffect(() => { raf.current = requestAnimationFrame(draw); return () => cancelAnimationFrame(raf.current); }, [draw]);
  useEffect(() => {
    if (state !== "recording") return;
    const t = setInterval(() => setElapsed((Date.now() - startedAt.current - pausedFor.current) / 1000), 250);
    return () => clearInterval(t);
  }, [state]);

  const start = async () => {
    setError(null);
    try {
      const mic = await navigator.mediaDevices.getUserMedia({ audio: device ? { deviceId: { exact: device } } : true });
      navigator.mediaDevices.enumerateDevices().then((d) => setDevices(d.filter((x) => x.kind === "audioinput"))).catch(() => {});
      const ac = new AudioContext();
      audioCtx.current = ac;
      const an = ac.createAnalyser(); an.fftSize = 1024;
      const mix = ac.createMediaStreamDestination();
      ac.createMediaStreamSource(mic).connect(mix);
      let s: MediaStream = mic;
      if (systemAudio && canShare) {
        // The browser asks which tab, window or screen to share; only its audio is kept.
        // Chrome and Edge deliver system or tab audio, Safari and Firefox deliver none.
        const d = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
        d.getVideoTracks().forEach((t) => t.stop());
        if (d.getAudioTracks().length === 0) { mic.getTracks().forEach((t) => t.stop()); ac.close().catch(() => {}); setError("The shared source carried no audio. Pick a tab or screen with 'Share audio' on, or record the microphone only."); return; }
        display.current = d;
        ac.createMediaStreamSource(new MediaStream(d.getAudioTracks())).connect(mix);
        s = mix.stream;
      }
      stream.current = mic;
      ac.createMediaStreamSource(s).connect(an);
      analyser.current = an;
      const { mime } = mimeType();
      const r = new MediaRecorder(s, mime ? { mimeType: mime } : undefined);
      chunks.current = [];
      r.ondataavailable = (e) => { if (e.data.size) chunks.current.push(e.data); };
      r.start(1000);
      rec.current = r;
      startedAt.current = Date.now(); pausedFor.current = 0; setElapsed(0);
      levels.current = Array.from({ length: BARS }, () => 0);
      setState("recording");
    } catch (e) { setError(errorMessage(e)); }
  };
  const togglePause = () => {
    const r = rec.current; if (!r) return;
    if (r.state === "recording") { r.pause(); pausedAt.current = Date.now(); setState("paused"); }
    else if (r.state === "paused") { r.resume(); pausedFor.current += Date.now() - pausedAt.current; setState("recording"); }
  };
  const stop = async () => {
    const r = rec.current; if (!r) return;
    if (r.state === "paused") pausedFor.current += Date.now() - pausedAt.current;
    const duration = (Date.now() - startedAt.current - pausedFor.current) / 1000;
    setState("uploading");
    await new Promise<void>((resolve) => { r.onstop = () => resolve(); r.stop(); });
    stream.current?.getTracks().forEach((t) => t.stop());
    display.current?.getTracks().forEach((t) => t.stop());
    display.current = null;
    audioCtx.current?.close().catch(() => {});
    analyser.current = null;
    const { ext } = mimeType();
    const blob = new Blob(chunks.current, { type: r.mimeType || "audio/webm" });
    if (duration < 1 || blob.size < 1000) { setError("The recording was too short to keep."); setState("idle"); return; }
    const d = new Date(startedAt.current);
    const pad = (n: number) => String(n).padStart(2, "0");
    const id = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}-web${Math.random().toString(16).slice(2, 8)}`;
    try {
      const res = await api.record({
        id, startedAt: startedAt.current / 1000, durationSec: duration, format: ext, title: title.trim() || null,
        language: language === "auto" ? null : language, notesLanguage, mode, speakerCount: speakers || null,
        inputDevice: (devices.find((x) => x.deviceId === device)?.label || "Browser microphone") + (display.current || systemAudio ? " + system audio" : ""),
      }, blob, `recording.${ext}`);
      navigate(`/meetings/${encodeURIComponent(res.id)}`);
    } catch (e) { setError(errorMessage(e)); setState("idle"); }
  };

  const busy = state === "recording" || state === "paused";
  if (unsupported) return <div className="text-[13px] text-muted">This browser cannot record audio. Use a current Chrome, Safari, Firefox or Edge.</div>;
  return (
    <div className="relative -mx-6 -my-6 flex min-h-full flex-col items-center gap-7 px-6 py-12">
      <div className={cn("pointer-events-none absolute inset-0 transition-opacity duration-700 wash-accent", busy ? "opacity-100" : "opacity-60")} />
      <div className="relative text-center">
        {state === "recording" && (
          <>
            <span className="pointer-events-none absolute left-1/2 top-1/2 h-[220px] w-[220px] -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-accent/40 animate-ring" />
            <span className="pointer-events-none absolute left-1/2 top-1/2 h-[220px] w-[220px] -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-accent/40 animate-ring [animation-delay:1.2s]" />
          </>
        )}
        <div className="relative font-display text-[72px] font-bold leading-none tabular-nums tracking-tight">{fmtTime(elapsed)}</div>
        <div className="relative mt-3 flex items-center justify-center gap-2 text-[13px] text-muted">
          {state === "recording" ? <><span className="h-2 w-2 rounded-full bg-record animate-record" /> Recording</> : state === "paused" ? <><Pause className="h-3.5 w-3.5" /> Paused</> : state === "uploading" ? "Sending to the server…" : <><Mic className="h-3.5 w-3.5" /> Ready to record</>}
        </div>
      </div>
      <canvas ref={canvas} className="relative h-[72px] w-full max-w-[560px]" />
      {!busy ? (
        <div className="panel relative flex w-full max-w-[460px] flex-col gap-3 p-4">
          <label className="flex items-center justify-between gap-3 text-[13px]">
            <span className="inline-flex items-center gap-2 text-muted"><Mic className="h-3.5 w-3.5" /> Microphone</span>
            <Select value={device} onChange={(e) => setDevice(e.target.value)}>
              <option value="">Default microphone</option>
              {devices.map((d) => <option key={d.deviceId} value={d.deviceId}>{d.label || "Microphone"}</option>)}
            </Select>
          </label>
          {canShare && (
            <label className="flex items-center justify-between gap-3 text-[13px]">
              <span className="inline-flex items-center gap-2 text-muted" title="Chrome and Edge: the audio of a tab or screen you pick when recording starts"><Monitor className="h-3.5 w-3.5" /> System audio</span>
              <Select value={systemAudio ? "on" : "off"} onChange={(e) => setSystemAudio(e.target.value === "on")}>
                <option value="off">Off</option>
                <option value="on">A tab or screen (online calls)</option>
              </Select>
            </label>
          )}
          <label className="flex items-center justify-between gap-3 text-[13px]">
            <span className="inline-flex items-center gap-2 text-muted"><Languages className="h-3.5 w-3.5" /> Spoken language</span>
            <Select value={language} onChange={(e) => setLanguage(e.target.value)}>{LANGS.map(([c, l]) => <option key={c} value={c}>{l}</option>)}</Select>
          </label>
          <label className="flex items-center justify-between gap-3 text-[13px]">
            <span className="inline-flex items-center gap-2 text-muted"><NotebookPen className="h-3.5 w-3.5" /> Notes</span>
            <div className="flex gap-2">
              <Select className="!w-[116px]" value={mode} onChange={(e) => setMode(e.target.value as "meeting" | "interview")}><option value="meeting">Meeting</option><option value="interview">Interview</option></Select>
              <Select className="!w-[116px]" value={notesLanguage} onChange={(e) => setNotesLanguage(e.target.value)}>{NOTES_LANGS.map(([c, l]) => <option key={c} value={c}>{l}</option>)}</Select>
            </div>
          </label>
          <label className="flex items-center justify-between gap-3 text-[13px]">
            <span className="inline-flex items-center gap-2 text-muted"><Users className="h-3.5 w-3.5" /> People speaking</span>
            <Select value={String(speakers)} onChange={(e) => setSpeakers(Number(e.target.value))}>{[0, 1, 2, 3, 4, 5, 6, 7, 8].map((n) => <option key={n} value={n}>{n === 0 ? "Detect automatically" : n === 1 ? "1 person" : `${n} people`}</option>)}</Select>
          </label>
          <Input placeholder="Title (optional)" value={title} onChange={(e) => setTitle(e.target.value)} />
          <Button variant="record" size="lg" loading={state === "uploading"} onClick={start} className="mt-1 rounded-full"><span className="h-2.5 w-2.5 rounded-full bg-white" /> Start Recording</Button>
        </div>
      ) : (
        <div className="relative flex items-center gap-2">
          <Button variant="secondary" size="lg" onClick={togglePause} className="rounded-full px-6">{state === "paused" ? <><Play className="h-3.5 w-3.5 fill-current" /> Resume</> : <><Pause className="h-3.5 w-3.5 fill-current" /> Pause</>}</Button>
          <Button variant="primary" size="lg" onClick={stop} className="rounded-full px-7"><Square className="h-3.5 w-3.5 fill-current" /> Stop Recording</Button>
        </div>
      )}
      {error && <div className={cn("max-w-[460px] rounded-lg border border-danger/30 bg-danger/5 px-3 py-2 text-center text-[12.5px] text-danger")}>{error}</div>}
    </div>
  );
}
