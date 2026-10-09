import type React from "react";
import { useEffect, useState } from "react";
import { Clock, FileAudio, HardDrive, KeyRound, Mic, Network, Users } from "lucide-react";
import { api, errorMessage, type Overview as OverviewData } from "@/lib/api";
import { fmtBytes } from "@/lib/format";
import { Link } from "@/lib/router";
import { Badge, Button, Card, Row, Spinner } from "@/components/ui";

export function useCopy() {
  const [copied, setCopied] = useState(false);
  const copy = async (text: string) => { try { await navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { /* ignore */ } };
  return { copied, copy };
}

const hours = (min: number) => (min < 60 ? `${min} min` : `${(min / 60).toFixed(min >= 600 ? 0 : 1)} h`);

export function Overview() {
  const [d, setD] = useState<OverviewData | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    const load = () => api.overview().then((o) => { setD(o); setError(null); }).catch((e) => setError(errorMessage(e)));
    load();
    const t = setInterval(load, 5000);
    return () => clearInterval(t);
  }, []);
  if (error) return <div className="text-danger">{error}</div>;
  if (!d) return <Spinner />;
  const tr = d.resolutions.find((r) => r.task === "transcription");
  return (
    <>
      <h2 className="mb-4 font-display text-[22px] font-bold tracking-tight">Overview</h2>
      <div className="mb-3 grid grid-cols-4 gap-3">
        <Stat icon={<Mic className="h-3.5 w-3.5" />} label="Meetings" value={String(d.meetings)} hint={d.processing ? `${d.processing} processing now` : "none processing"} />
        <Stat icon={<Clock className="h-3.5 w-3.5" />} label="Processed" value={hours(d.processedMinutes)} hint={`${d.processed} meeting${d.processed === 1 ? "" : "s"}`} />
        <Stat icon={<Users className="h-3.5 w-3.5" />} label="Users" value={String(d.users)} hint={d.pendingUsers ? <Link to="/users" className="text-accent hover:underline">{d.pendingUsers} waiting for approval</Link> : undefined} />
        <Stat icon={<HardDrive className="h-3.5 w-3.5" />} label="Audio stored" value={fmtBytes(d.recordingsBytes) || "0 MB"} hint={d.maxBytes ? `cap ${fmtBytes(d.maxBytes)}` : "no cap"} />
      </div>
      <div className="mb-4 grid grid-cols-4 gap-3">
        <Stat icon={<KeyRound className="h-3.5 w-3.5" />} label="Clients" value={String(d.clients)} hint={<Link to="/clients" className="hover:text-fg">Manage</Link>} />
        <Stat icon={<Network className="h-3.5 w-3.5" />} label="MCP tokens" value={String(d.mcpTokens)} />
        <Card className="col-span-2 p-4"><Chart days={d.perDay} /></Card>
      </div>

      <h3 className="mb-2 font-display text-[11.5px] font-bold uppercase tracking-wider text-muted">Processing</h3>
      <Card>
        <Row label="Transcription" hint={d.capabilities.transcription ?? (tr?.status === "download_required" ? "No model yet" : tr?.reason ?? "No model yet")}>
          {d.capabilities.transcription ? <Badge tone="good">Ready</Badge> : <Link to="/models"><Button size="sm" variant="primary">Install a model</Button></Link>}
        </Row>
        <Row label="Speaker separation" hint={d.speakerModels.installed ? "pyannote segmentation 3.0 · TitaNet" : "No model yet"}>
          {d.speakerModels.installed ? <Badge tone="good">Ready</Badge> : <Button size="sm" variant="primary" loading={d.speakerModels.downloading} onClick={() => api.downloadSpeakerModels()}>{d.speakerModels.downloading ? `${Math.round(d.speakerModels.progress * 100)}%` : "Install a model"}</Button>}
        </Row>
        <Row label="Notes" hint={d.capabilities.llm ?? "No AI model yet"}>
          {d.capabilities.llm ? <Badge tone="good">Ready</Badge> : <Link to="/models"><Button size="sm" variant="primary">Install a model</Button></Link>}
        </Row>
      </Card>

      <h3 className="mb-2 mt-6 font-display text-[11.5px] font-bold uppercase tracking-wider text-muted">Hardware</h3>
      <Card>
        <Row label="CPU"><Value main={d.hardware.cpuBrand ?? d.hardware.arch} sub={`${d.hardware.cpuCores} cores`} /></Row>
        <Row label="GPU"><Value main={d.hardware.gpu ?? "None"} /></Row>
        <Row label="Memory"><Value main={fmtBytes(d.hardware.memoryBytes) || "Unknown"} /></Row>
        <Row label="System"><Value main={`${d.hardware.os} ${d.hardware.osVersion}`} sub={d.hardware.arch} /></Row>
        <Row label="Huddle Server"><Value main={d.version} sub="version" /></Row>
        <Row label="Huddle Engine"><Value main={d.engineVersion} sub="version" /></Row>
      </Card>
    </>
  );
}

function Value({ main, sub }: { main: string; sub?: string }) {
  return <div className="text-right"><div className="text-[13px]">{main}</div>{sub && <div className="text-[12px] text-muted">{sub}</div>}</div>;
}

function Stat({ icon, label, value, hint }: { icon: React.ReactNode; label: string; value: string; hint?: React.ReactNode }) {
  return (
    <Card className="p-4">
      <div className="mb-1 flex items-center gap-1.5 font-display text-[11.5px] font-bold uppercase tracking-wider text-muted">{icon}{label}</div>
      <div className="font-display text-[24px] font-bold tracking-tight">{value}</div>
      {hint && <div className="text-[12px] text-muted">{hint}</div>}
    </Card>
  );
}

/** Minutes of audio received per day, last 30 days. One series, so no legend; hover for the value. */
function Chart({ days }: { days: { date: string; meetings: number; minutes: number }[] }) {
  const by = new Map(days.map((d) => [d.date, d]));
  const today = new Date();
  const series = Array.from({ length: 30 }, (_, i) => {
    const d = new Date(today.getFullYear(), today.getMonth(), today.getDate() - (29 - i));
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    return { key, label: d.toLocaleDateString(undefined, { day: "numeric", month: "short" }), ...(by.get(key) ?? { meetings: 0, minutes: 0 }) };
  });
  const max = Math.max(1, ...series.map((s) => s.minutes));
  const W = 300, H = 64, gap = 2, bw = (W - gap * 29) / 30;
  const total = series.reduce((n, s) => n + s.minutes, 0);
  return (
    <div>
      <div className="mb-1 flex items-center justify-between font-display text-[11.5px] font-bold uppercase tracking-wider text-muted"><span className="inline-flex items-center gap-1.5"><FileAudio className="h-3.5 w-3.5" />Last 30 days</span><span className="normal-case tracking-normal font-sans font-normal">{hours(Math.round(total))} received</span></div>
      <svg viewBox={`0 0 ${W} ${H}`} className="h-16 w-full" role="img" aria-label="Minutes of audio received per day, last 30 days">
        <line x1="0" y1={H - 0.5} x2={W} y2={H - 0.5} stroke="rgb(var(--border))" strokeWidth="1" />
        {series.map((s, i) => {
          const h = s.minutes ? Math.max(3, (s.minutes / max) * (H - 4)) : 0;
          return (
            <g key={s.key}>
              <rect x={i * (bw + gap)} y={0} width={bw} height={H - 1} fill="transparent"><title>{`${s.label}: ${Math.round(s.minutes)} min · ${s.meetings} meeting${s.meetings === 1 ? "" : "s"}`}</title></rect>
              {h > 0 && <rect x={i * (bw + gap)} y={H - 1 - h} width={bw} height={h} rx="2" fill="rgb(var(--accent))" />}
            </g>
          );
        })}
      </svg>
      <div className="mt-0.5 flex justify-between text-[10.5px] text-muted"><span>{series[0].label}</span><span>{series[29].label}</span></div>
    </div>
  );
}
