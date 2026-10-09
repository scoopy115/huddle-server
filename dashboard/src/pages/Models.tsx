import { useCallback, useEffect, useMemo, useState } from "react";
import { Check, Download, HardDrive, RefreshCw, Star, Trash2 } from "lucide-react";
import { api, errorMessage } from "@/lib/api";
import type { DownloadCandidate, DownloadProgress, Environment, LocalModel, Resolution, UserSettings } from "@/types/engine";
import { fmtBytes } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Badge, Button, Card, DangerDialog, Row, Select, Spinner } from "@/components/ui";

/** The engine's candidate copy is written for the desktop app; on a server the platform is a given. */
const purposeOf = (c: DownloadCandidate) => c.purpose
  .replace(/ — works on any Mac and on Windows/i, "")
  .replace(/ — fits Macs with (.+?) or more/i, " — needs $1 of memory")
  .replace(/ for older or low-memory Macs/i, " for low-memory servers")
  .replace(/about 10× faster than the CPU version/i, "about 10× faster than on the CPU");

const title = (m: LocalModel) => m.task === "transcription" && m.meta.whisperSize ? `Whisper ${m.meta.whisperSize} (${m.format === "MLX" ? "Apple Silicon" : m.format === "CTranslate2" ? "CPU / CUDA" : m.format})` : m.name;

function CandidateRow({ c, progress, installed, memoryBytes, onStart, onCancel }: { c: DownloadCandidate; progress?: DownloadProgress; installed: boolean; memoryBytes?: number | null; onStart: () => void; onCancel: () => void }) {
  const pct = progress && progress.totalBytes ? Math.round((progress.receivedBytes / progress.totalBytes) * 100) : 0;
  const active = progress && (progress.state === "downloading" || progress.state === "verifying");
  const tooBig = !!c.minMemoryBytes && !!memoryBytes && memoryBytes < c.minMemoryBytes;
  return (
    <div className={cn("flex items-center gap-3 border-b border-border px-4 py-3 last:border-b-0", tooBig && !installed && "opacity-50")}>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 text-[13px] font-medium">{c.name}{c.recommended && <Badge tone="accent"><Star className="h-3 w-3" /> Recommended</Badge>}</div>
        <div className="mt-0.5 flex flex-wrap gap-x-3 text-[12px] text-muted"><span>{purposeOf(c)}</span><span className="inline-flex items-center gap-1"><Download className="h-3 w-3" />{c.sizeBytes ? fmtBytes(c.sizeBytes) : "size varies"}</span><span>{c.license}</span></div>
        {tooBig && !installed && <div className="mt-0.5 text-[12px] text-danger">Needs {fmtBytes(c.minMemoryBytes!)} of memory; this server has {fmtBytes(memoryBytes!)}.</div>}
        {active && <div className="mt-1.5 h-1 w-full overflow-hidden rounded bg-fg/10"><div className="h-full bg-accent transition-all" style={{ width: `${pct}%` }} /></div>}
        {progress?.state === "failed" && <div className="mt-1 text-[12px] text-danger">{progress.error}</div>}
      </div>
      <div className="shrink-0">
        {installed ? <Badge tone="good"><Check className="h-3 w-3" /> Installed</Badge>
          : active ? <div className="flex items-center gap-2 text-[12px] text-muted">{progress.state === "verifying" ? "Finishing…" : `${pct}%`}<Button size="sm" variant="ghost" onClick={onCancel}>Cancel</Button></div>
          : <Button size="sm" disabled={tooBig} onClick={onStart}><Download className="h-3.5 w-3.5" /> Download</Button>}
      </div>
    </div>
  );
}

export function Models() {
  const [env, setEnv] = useState<Environment | null>(null);
  const [settings, setSettings] = useState<UserSettings | null>(null);
  const [res, setRes] = useState<Resolution[]>([]);
  const [cands, setCands] = useState<DownloadCandidate[]>([]);
  const [downloads, setDownloads] = useState<DownloadProgress[]>([]);
  const [confirm, setConfirm] = useState<LocalModel | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    try {
      const [e, s, p, c] = await Promise.all([api.environment(), api.settings(), api.setupPlan(), api.candidates()]);
      setEnv(e); setSettings(s); setRes(p.resolutions); setCands(c); setError(null);
    } catch (e) { setError(errorMessage(e)); }
  }, []);
  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    const t = setInterval(async () => {
      const d = await api.downloads().catch(() => []);
      setDownloads((prev) => { if (prev.some((p) => p.state === "downloading") && d.some((x) => x.state === "done")) load(); return d; });
    }, 1000);
    return () => clearInterval(t);
  }, [load]);
  const update = async (p: Partial<UserSettings>) => { setSettings(await api.updateSettings(p)); setRes((await api.setupPlan()).resolutions); };

  const whisper = useMemo(() => env?.models.filter((m) => m.task === "transcription" && m.compatible) ?? [], [env]);
  const ai = useMemo(() => env?.models.filter((m) => m.task === "llm" && m.source === "ollama" && m.compatible && m.meta.generalChat !== false) ?? [], [env]);
  if (error) return <div className="text-danger">{error}</div>;
  if (!env || !settings) return <Spinner />;
  const inUse = new Set(res.map((r) => r.model?.id).filter(Boolean));
  const ollama = env.providers.find((p) => p.id === "ollama");
  const isInstalled = (c: DownloadCandidate) => c.task === "llm" ? env.models.some((m) => m.source === "ollama" && m.name === c.url)
    : env.models.some((m) => m.task === "transcription" && m.compatible && m.source === "our_app" && m.id === `our_app:${c.url}`);
  const candsFor = (task: string) => cands.filter((c) => c.task === task && (task !== "transcription" || !c.id.includes("mlx") || env.hardware.appleSilicon)).sort((a, b) => Number(b.recommended) - Number(a.recommended));

  const section = (task: "transcription" | "llm", key: "models.whisper" | "models.ai", models: LocalModel[], label: string) => (
    <>
      <h3 className="mb-2 mt-6 font-display text-[11.5px] font-bold uppercase tracking-wider text-muted">{label}</h3>
      <Card>
        <div className="flex items-center gap-3 border-b border-border px-4 py-3">
          <input type="radio" name={key} checked={!settings[key]} onChange={() => update({ [key]: null } as Partial<UserSettings>)} className="accent-[rgb(var(--accent))]" />
          <div className="text-[13px]">Automatic{res.find((r) => r.task === task)?.autoModel ? ` (${title(res.find((r) => r.task === task)!.autoModel!)})` : ""}</div>
        </div>
        {models.map((m) => (
          <div key={m.id} className="flex items-center gap-3 border-b border-border px-4 py-3 last:border-b-0">
            <input type="radio" name={key} checked={settings[key] === m.id} onChange={() => update({ [key]: m.id } as Partial<UserSettings>)} className="accent-[rgb(var(--accent))]" />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 text-[13px] font-medium">{title(m)}{inUse.has(m.id) && <Badge tone="good"><Check className="h-3 w-3" /> In use</Badge>}</div>
              <div className="flex gap-x-3 text-[12px] text-muted">{m.meta.parameterSize && <span>{m.meta.parameterSize} parameters</span>}{m.sizeBytes ? <span className="inline-flex items-center gap-1"><HardDrive className="h-3 w-3" />{fmtBytes(m.sizeBytes)}</span> : null}</div>
            </div>
            {(!m.externallyManaged || m.meta.pulledByHuddle) && <Button size="sm" variant="ghost" onClick={() => setConfirm(m)}><Trash2 className="h-3.5 w-3.5" /></Button>}
          </div>
        ))}
        {models.length === 0 && <div className="px-4 py-3 text-[12.5px] text-muted">{task === "llm" && ollama?.status !== "available" ? "Ollama is not reachable." : "Nothing installed yet."}</div>}
      </Card>
      <Card className="mt-3">
        {candsFor(task).map((c) => <CandidateRow key={c.id} c={c} progress={downloads.find((d) => d.id === c.id)} installed={isInstalled(c)} memoryBytes={env.hardware.memoryBytes}
          onStart={() => api.startDownload(c.id).then(() => api.downloads().then(setDownloads)).catch((e) => setError(errorMessage(e)))} onCancel={() => api.cancelDownload(c.id)} />)}
      </Card>
    </>
  );

  return (
    <>
      <div className="mb-4 flex items-center justify-between">
        <h2 className="font-display text-[22px] font-bold tracking-tight">Models</h2>
        <Button size="sm" variant="ghost" loading={env.scanning} onClick={async () => { await api.rescan(); load(); }}><RefreshCw className="h-3 w-3" /> Rescan</Button>
      </div>
      <Card>
        <Row label="Compute device" info="Where transcription runs. CUDA needs an NVIDIA GPU that the container can see.">
          <Select value={settings["general.computeDevice"]} onChange={(e) => update({ "general.computeDevice": e.target.value })}>
            <option value="auto">Automatic</option>
            {env.devices.filter((d) => d.available).map((d) => <option key={d.id} value={d.id}>{d.name} — {d.backend.toUpperCase()}</option>)}
          </Select>
        </Row>
      </Card>
      {section("transcription", "models.whisper", whisper, "Transcription")}
      {section("llm", "models.ai", ai, "Notes (AI model via Ollama)")}
      <DangerDialog open={!!confirm} onClose={() => setConfirm(null)} title="Remove this model?" confirmLabel="Remove" seconds={2}
        onConfirm={async () => { if (confirm) { await api.deleteModel(confirm.id); setConfirm(null); load(); } }}>
        {confirm && title(confirm)} is deleted from the server. You can download it again.
      </DangerDialog>
    </>
  );
}
