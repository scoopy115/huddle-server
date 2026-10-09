import type React from "react";
import { useCallback, useEffect, useState } from "react";
import { Check, Download, Mic, Sparkles, Users } from "lucide-react";
import { api, errorMessage, type SpeakerModels } from "@/lib/api";
import type { DownloadCandidate, DownloadProgress, Environment } from "@/types/engine";
import { fmtBytes } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Badge, Button, Card, Spinner } from "@/components/ui";
import { Wordmark } from "@/components/Wordmark";

/** First run: the three things a server needs before it can process a recording. */
export function Onboarding({ onDone }: { onDone: () => void }) {
  const [env, setEnv] = useState<Environment | null>(null);
  const [cands, setCands] = useState<DownloadCandidate[]>([]);
  const [downloads, setDownloads] = useState<DownloadProgress[]>([]);
  const [speakers, setSpeakers] = useState<SpeakerModels | null>(null);
  const [error, setError] = useState<string | null>(null);
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
      setDownloads((prev) => { if (prev.some((p) => p.state === "downloading") && d.some((x) => x.state === "done")) load(); return d; });
      if (sp) setSpeakers(sp);
    }, 1000);
    return () => clearInterval(t);
  }, [load]);
  if (error) return <div className="p-6 text-danger">{error}</div>;
  if (!env || !speakers) return <div className="flex h-full items-center justify-center"><Spinner /></div>;

  const installed = (task: "transcription" | "llm") => env.models.find((m) => m.task === task && m.compatible && (task !== "llm" || m.source === "ollama"));
  const pick = (task: "transcription" | "llm") => cands.filter((c) => c.task === task && (task !== "transcription" || !c.id.includes("mlx") || env.hardware.appleSilicon))
    .sort((a, b) => Number(b.recommended) - Number(a.recommended))[0];
  const ollama = env.providers.find((p) => p.id === "ollama")?.status === "available";
  const transcriptionReady = !!installed("transcription");
  const start = (id: string) => api.startDownload(id).then(() => api.downloads().then(setDownloads)).catch((e) => setError(errorMessage(e)));

  const Step = ({ n, icon, title, done, children }: { n: number; icon: React.ReactNode; title: string; done: boolean; children: React.ReactNode }) => (
    <Card className="p-4">
      <div className="mb-2 flex items-center gap-2.5">
        <span className={cn("flex h-6 w-6 items-center justify-center rounded-full text-[11px] font-bold", done ? "bg-emerald-500 text-white" : "bg-ink text-ink-fg")}>{done ? <Check className="h-3.5 w-3.5" /> : n}</span>
        <span className="text-muted">{icon}</span>
        <span className="text-[14px] font-semibold">{title}</span>
      </div>
      <div className="ml-[34px]">{children}</div>
    </Card>
  );
  const Candidate = ({ c }: { c: DownloadCandidate }) => {
    const p = downloads.find((d) => d.id === c.id);
    const active = p && (p.state === "downloading" || p.state === "verifying");
    const pct = p && p.totalBytes ? Math.round((p.receivedBytes / p.totalBytes) * 100) : 0;
    return (
      <div className="flex items-center gap-3">
        <div className="min-w-0 flex-1 text-[13px]">{c.name} <span className="text-muted">· {fmtBytes(c.sizeBytes)}</span>
          {active && <div className="mt-1.5 h-1 w-full overflow-hidden rounded bg-fg/10"><div className="h-full bg-accent transition-all" style={{ width: `${pct}%` }} /></div>}
          {p?.state === "failed" && <div className="mt-1 text-[12px] text-danger">{p.error}</div>}
        </div>
        {active ? <span className="text-[12px] text-muted">{p.state === "verifying" ? "Finishing…" : `${pct}%`}</span>
          : <Button size="sm" variant="primary" onClick={() => start(c.id)}><Download className="h-3.5 w-3.5" /> Download</Button>}
      </div>
    );
  };

  return (
    <div className="mx-auto max-w-[620px] px-6 py-10">
      <Wordmark className="mb-6 h-7 w-auto" />
      <h1 className="mb-1 font-display text-[22px] font-bold tracking-tight">Set up the server</h1>
      <p className="mb-5 text-[13px] text-muted">Three downloads, then the server can process recordings.</p>
      <div className="flex flex-col gap-3">
        <Step n={1} icon={<Mic className="h-4 w-4" />} title="Transcription model" done={transcriptionReady}>
          {transcriptionReady ? <div className="text-[13px] text-muted">{installed("transcription")!.name}</div> : pick("transcription") ? <Candidate c={pick("transcription")!} /> : <div className="text-[13px] text-muted">No model available for this platform.</div>}
        </Step>
        <Step n={2} icon={<Users className="h-4 w-4" />} title="Speaker separation" done={speakers.installed}>
          {speakers.installed ? <div className="text-[13px] text-muted">Installed</div> : (
            <div className="flex items-center gap-3">
              <div className="min-w-0 flex-1 text-[13px]">Segmentation and voice models <span className="text-muted">· 110 MB</span>
                {speakers.downloading && <div className="mt-1.5 h-1 w-full overflow-hidden rounded bg-fg/10"><div className="h-full bg-accent transition-all" style={{ width: `${Math.round(speakers.progress * 100)}%` }} /></div>}
                {speakers.error && <div className="mt-1 text-[12px] text-danger">{speakers.error}</div>}
              </div>
              {speakers.downloading ? <span className="text-[12px] text-muted">{Math.round(speakers.progress * 100)}%</span>
                : <Button size="sm" variant="primary" onClick={() => api.downloadSpeakerModels().then(setSpeakers)}><Download className="h-3.5 w-3.5" /> Download</Button>}
            </div>
          )}
        </Step>
        <Step n={3} icon={<Sparkles className="h-4 w-4" />} title="AI model for notes" done={!!installed("llm")}>
          {installed("llm") ? <div className="text-[13px] text-muted">{installed("llm")!.name}</div>
            : !ollama ? <div className="flex items-center gap-2 text-[13px] text-muted"><Badge tone="warn">Ollama not reachable</Badge> Start the ollama container, then come back.</div>
            : pick("llm") ? <><Candidate c={pick("llm")!} /><div className="mt-2 text-[12px] text-muted">Optional. Without it the server returns transcripts and the Huddle app writes the notes.</div></> : null}
        </Step>
      </div>
      <div className="mt-5 flex items-center gap-3">
        <Button variant="primary" size="lg" disabled={!transcriptionReady || !speakers.installed} onClick={async () => { await api.setOnboarding(true); onDone(); }}>Open the dashboard</Button>
        <button className="text-[12.5px] text-muted hover:text-fg" onClick={async () => { await api.setOnboarding(true); onDone(); }}>Skip for now</button>
      </div>
    </div>
  );
}
