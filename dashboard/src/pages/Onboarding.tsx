import { useCallback, useEffect, useState } from "react";
import { Check, Download, Mic, Sparkles, Star, Users } from "lucide-react";
import { api, errorMessage, type SpeakerModels } from "@/lib/api";
import type { DownloadCandidate, DownloadProgress, Environment } from "@/types/engine";
import { fmtBytes } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Badge, Button, Card, Input, Select, Spinner } from "@/components/ui";
import { fmtBytes as fmtMem } from "@/lib/format";

const LANGS: [string, string][] = [["en", "English"], ["nl", "Dutch"], ["de", "German"], ["fr", "French"], ["es", "Spanish"], ["it", "Italian"], ["pt", "Portuguese"], ["pl", "Polish"], ["sv", "Swedish"], ["da", "Danish"], ["no", "Norwegian"], ["fi", "Finnish"], ["tr", "Turkish"], ["ja", "Japanese"], ["ko", "Korean"], ["zh", "Chinese"]];
import { Wordmark } from "@/components/Wordmark";
import { purposeOf } from "@/pages/Models";

/** First run, one step per screen: transcription model, speaker separation, AI model (optional). */
export function Onboarding({ onDone }: { onDone: () => void }) {
  const [step, setStep] = useState(0);
  const [env, setEnv] = useState<Environment | null>(null);
  const [cands, setCands] = useState<DownloadCandidate[]>([]);
  const [downloads, setDownloads] = useState<DownloadProgress[]>([]);
  const [speakers, setSpeakers] = useState<SpeakerModels | null>(null);
  const [custom, setCustom] = useState("");
  const [notesLang, setNotesLang] = useState<string>("auto");
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { api.settings().then((st) => setNotesLang(String(st["general.uiLanguage"] || "auto"))).catch(() => {}); }, []);
  const load = useCallback(async () => {
    try {
      const [e, c, sp] = await Promise.all([api.environment(), api.candidates(), api.speakerModels()]);
      setEnv(e); setCands(c); setSpeakers(sp); setError(null);
    } catch (e) { setError(errorMessage(e)); }
  }, []);
  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    const t = setInterval(async () => {
      const [d, sp] = await Promise.all([api.downloads().catch(() => [] as DownloadProgress[]), api.speakerModels().catch(() => null)]);
      setDownloads((prev) => { if (prev.some((p) => p.state === "downloading" || p.state === "verifying") && d.some((x) => x.state === "done")) load(); return d; });
      if (sp) setSpeakers(sp);
    }, 1000);
    return () => clearInterval(t);
  }, [load]);
  if (error) return <div className="p-6 text-danger">{error}</div>;
  if (!env || !speakers) return <div className="flex h-full items-center justify-center"><Spinner /></div>;

  const installedList = (task: "transcription" | "llm") => env.models.filter((m) => m.task === task && m.compatible && (task !== "llm" || m.source === "ollama"));
  const candsFor = (task: "transcription" | "llm") => cands.filter((c) => c.task === task && (task !== "transcription" || !c.id.includes("mlx") || env.hardware.appleSilicon))
    .sort((a, b) => Number(b.recommended) - Number(a.recommended));
  // The engine says whether a candidate is installed (it knows the ids its downloads produce: a
  // Parakeet ONNX archive lands as our_app:parakeet/<name>, not our_app:<url>); the lookup below
  // is only for an engine that does not report it yet.
  const isInstalled = (c: DownloadCandidate) => c.installed ?? (c.task === "llm" ? env.models.some((m) => m.source === "ollama" && m.name === c.url)
    : c.id.startsWith("parakeet:onnx-") ? env.models.some((m) => m.task === "transcription" && m.source === "our_app" && m.family === "parakeet" && m.format === "ONNX")
    : env.models.some((m) => m.task === "transcription" && m.source === "our_app" && m.id === `our_app:${c.url}`));
  const ollama = env.providers.find((p) => p.id === "ollama")?.status === "available";
  const start = (id: string) => api.startDownload(id).then(() => api.downloads().then(setDownloads)).catch((e) => setError(errorMessage(e)));
  const done = [installedList("transcription").length > 0, speakers.installed, installedList("llm").length > 0];
  const finish = async () => { await api.setOnboarding(true); onDone(); };

  const steps = [
    { icon: <Mic className="h-4 w-4" />, title: "Transcription model", body: (
      <>
        <Marketplace cands={candsFor("transcription")} downloads={downloads} installed={isInstalled} memoryBytes={env.hardware.memoryBytes} onStart={start} />
      </>
    ) },
    { icon: <Users className="h-4 w-4" />, title: "Speaker separation", body: (
      <Card>
        <div className="flex items-center gap-3 px-4 py-3">
          <div className="min-w-0 flex-1">
            <div className="text-[13px] font-medium">pyannote segmentation 3.0 and TitaNet</div>
            <div className="text-[12px] text-muted">Who spoke when, and voice embeddings for the clients</div>
            {speakers.downloading && <div className="mt-1.5 h-1 w-full overflow-hidden rounded bg-fg/10"><div className="h-full bg-accent transition-all" style={{ width: `${Math.round(speakers.progress * 100)}%` }} /></div>}
            {speakers.error && <div className="mt-1 text-[12px] text-danger">{speakers.error}</div>}
          </div>
          {speakers.installed ? <Badge tone="good"><Check className="h-3 w-3" /> Installed</Badge>
            : speakers.downloading ? <span className="text-[12px] text-muted">{Math.round(speakers.progress * 100)}%</span>
            : <Button size="sm" variant="primary" onClick={() => api.downloadSpeakerModels().then(setSpeakers)}><Download className="h-3.5 w-3.5" /> Install</Button>}
        </div>
      </Card>
    ) },
    { icon: <Sparkles className="h-4 w-4" />, title: "AI model for notes (optional)", body: (
      <>
        <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-[12.5px] text-muted">
          <span>This server: {fmtMem(env.hardware.memoryBytes) || "unknown memory"}, {env.devices.some((d) => d.available && d.deviceType === "gpu") ? "GPU" : "no GPU"}</span>
          <span>Models that need more memory are greyed out.</span>
        </div>
        {!ollama && <div className="mb-3 flex items-center gap-2 text-[13px] text-muted"><Badge tone="warn">Ollama not reachable</Badge> Start the ollama container, then come back.</div>}
        <Marketplace cands={candsFor("llm")} downloads={downloads} installed={isInstalled} memoryBytes={env.hardware.memoryBytes} onStart={start} />
        <div className="mt-3 flex items-center gap-2">
          <Input placeholder="Any model from the Ollama library, e.g. llama3.1:8b" value={custom} onChange={(e) => setCustom(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && custom.trim()) { start(`ollama:${custom.trim()}`); setCustom(""); } }} />
          <Button disabled={!custom.trim() || !ollama} onClick={() => { start(`ollama:${custom.trim()}`); setCustom(""); }}><Download className="h-3.5 w-3.5" /> Pull</Button>
        </div>
        <p className="mt-2 text-[12px] text-muted">Without a model the server returns transcripts and speakers; the Huddle app writes the notes itself.</p>
        <Card className="mt-4">
          <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
            <div className="text-[13px]">Language of the notes<div className="text-[12px] text-muted">A client can ask for another language per recording.</div></div>
            <Select value={notesLang} onChange={(e) => { setNotesLang(e.target.value); api.updateSettings({ "general.uiLanguage": e.target.value }).catch((er) => setError(errorMessage(er))); }}>
              <option value="auto">Server default</option>
              {LANGS.map(([c, l]) => <option key={c} value={c}>{l}</option>)}
            </Select>
          </div>
        </Card>
      </>
    ) },
  ];
  const s = steps[step];
  return (
    <div className="mx-auto max-w-[680px] px-6 py-10">
      <Wordmark className="mb-6 h-7 w-auto" />
      <div className="mb-5 flex items-center gap-2">
        {steps.map((x, i) => (
          <button key={x.title} onClick={() => setStep(i)} className={cn("flex items-center gap-2 rounded-full border px-3 py-1.5 text-[12.5px]", i === step ? "border-accent bg-accent-soft text-accent" : "border-border text-muted hover:text-fg")}>
            <span className={cn("flex h-5 w-5 items-center justify-center rounded-full text-[11px] font-bold", done[i] ? "bg-emerald-500 text-white" : i === step ? "bg-accent text-white" : "bg-fg/10")}>{done[i] ? <Check className="h-3 w-3" /> : i + 1}</span>{x.title}
          </button>
        ))}
      </div>
      <h1 className="mb-1 flex items-center gap-2 font-display text-[22px] font-bold tracking-tight"><span className="text-muted">{s.icon}</span>{s.title}</h1>
      <p className="mb-4 text-[13px] text-muted">{step === 0 ? "Pick one. Larger models are more accurate and slower." : step === 1 ? "Needed to tell speakers apart." : "Writes the summary, questions and action items."}</p>
      {s.body}
      <div className="mt-6 flex items-center gap-3">
        {step > 0 && <Button variant="ghost" onClick={() => setStep(step - 1)}>Back</Button>}
        <div className="flex-1" />
        {step < 2 ? <Button variant="primary" size="lg" disabled={!done[step]} onClick={() => setStep(step + 1)}>Next</Button>
          : <Button variant="primary" size="lg" onClick={finish}>Open the dashboard</Button>}
        <button className="text-[12.5px] text-muted hover:text-fg" onClick={finish}>Skip for now</button>
      </div>
    </div>
  );
}

function Marketplace({ cands, downloads, installed, memoryBytes, onStart }: { cands: DownloadCandidate[]; downloads: DownloadProgress[]; installed: (c: DownloadCandidate) => boolean; memoryBytes: number | null; onStart: (id: string) => void }) {
  return (
    <Card>
      {cands.map((c) => {
        const p = downloads.find((d) => d.id === c.id);
        const active = p && (p.state === "downloading" || p.state === "verifying");
        const known = !!p && p.totalBytes >= c.sizeBytes * 0.5;   // the engine reports per file; only a whole-model total is meaningful
        const pct = p && known ? Math.min(100, Math.round((p.receivedBytes / p.totalBytes) * 100)) : null;
        const tooBig = !!c.minMemoryBytes && !!memoryBytes && memoryBytes < c.minMemoryBytes;
        const has = installed(c);
        return (
          <div key={c.id} className={cn("flex items-center gap-3 border-b border-border px-4 py-3 last:border-b-0", tooBig && !has && "opacity-50")}>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 text-[13px] font-medium">{c.name}{c.recommended && <Badge tone="accent"><Star className="h-3 w-3" /> Recommended</Badge>}</div>
              <div className="flex flex-wrap gap-x-3 text-[12px] text-muted"><span>{purposeOf(c)}</span><span className="inline-flex items-center gap-1"><Download className="h-3 w-3" />{c.sizeBytes ? fmtBytes(c.sizeBytes) : "size varies"}</span></div>
              {tooBig && !has && <div className="text-[12px] text-danger">Needs {fmtBytes(c.minMemoryBytes!)} of memory.</div>}
              {active && <div className="mt-1.5 h-1 w-full overflow-hidden rounded bg-fg/10"><div className={cn("h-full bg-accent transition-all", pct == null && "w-1/3 animate-pulse")} style={pct != null ? { width: `${pct}%` } : undefined} /></div>}
              {p?.state === "failed" && <div className="mt-1 text-[12px] text-danger">{p.error}</div>}
            </div>
            {has ? <Badge tone="good"><Check className="h-3 w-3" /> Installed</Badge>
              : active ? <span className="text-[12px] text-muted">{p.state === "verifying" ? "Finishing…" : pct != null ? `${pct}%` : "Downloading…"}</span>
              : <Button size="sm" variant="primary" disabled={tooBig} onClick={() => onStart(c.id)}><Download className="h-3.5 w-3.5" /> Install</Button>}
          </div>
        );
      })}
      {cands.length === 0 && <div className="px-4 py-3 text-[12.5px] text-muted">Nothing available for this platform.</div>}
    </Card>
  );
}

