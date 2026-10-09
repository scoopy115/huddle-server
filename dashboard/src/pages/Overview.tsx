import type React from "react";
import { useEffect, useState } from "react";
import { Copy, Check, Cpu, HardDrive, KeyRound, Mic, Network, Sparkles, Users } from "lucide-react";
import { api, errorMessage, type Overview as OverviewData } from "@/lib/api";
import { fmtBytes } from "@/lib/format";
import { Link } from "@/lib/router";
import { Badge, Button, Card, Row, Spinner } from "@/components/ui";

export function useCopy() {
  const [copied, setCopied] = useState(false);
  const copy = async (text: string) => { try { await navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { /* ignore */ } };
  return { copied, copy };
}

export function Overview() {
  const [d, setD] = useState<OverviewData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { copied, copy } = useCopy();
  useEffect(() => {
    const load = () => api.overview().then((o) => { setD(o); setError(null); }).catch((e) => setError(errorMessage(e)));
    load();
    const t = setInterval(load, 5000);
    return () => clearInterval(t);
  }, []);
  if (error) return <div className="text-danger">{error}</div>;
  if (!d) return <Spinner />;
  const url = d.publicUrl;
  return (
    <>
      <h2 className="mb-4 font-display text-[22px] font-bold tracking-tight">Overview</h2>
      <div className="mb-4 grid grid-cols-4 gap-3">
        <Stat icon={<Mic className="h-3.5 w-3.5" />} label="Meetings" value={String(d.meetings)} hint={d.processing ? `${d.processing} processing` : "idle"} />
        <Stat icon={<Users className="h-3.5 w-3.5" />} label="Users" value={String(d.users)} hint={d.pendingUsers ? <Link to="/users" className="text-accent hover:underline">{d.pendingUsers} waiting for approval</Link> : <Link to="/users" className="hover:text-fg">{d.registration === "open" ? "open registration" : "by invitation"}</Link>} />
        <Stat icon={<KeyRound className="h-3.5 w-3.5" />} label="Clients" value={String(d.clients)} hint={<Link to="/clients" className="hover:text-fg">{d.mcpTokens} MCP token{d.mcpTokens === 1 ? "" : "s"}</Link>} />
        <Stat icon={<HardDrive className="h-3.5 w-3.5" />} label="Audio stored" value={fmtBytes(d.recordingsBytes)} hint={d.maxBytes ? `cap ${fmtBytes(d.maxBytes)}` : "no cap"} />
      </div>

      <h3 className="mb-2 font-display text-[11.5px] font-bold uppercase tracking-wider text-muted">Processing</h3>
      <Card>
        <Row label="Transcription" hint={d.capabilities.transcription ?? "No model yet"}>{d.capabilities.transcription ? <Badge tone="good">Ready</Badge> : <Link to="/models"><Button size="sm" variant="primary">Install a model</Button></Link>}</Row>
        <Row label="Speaker detection" hint="Downloaded on first use"><Badge tone={d.capabilities.diarization ? "good" : "warn"}>{d.capabilities.diarization ? "Ready" : "Missing"}</Badge></Row>
        <Row label="Notes" hint={d.capabilities.llm ? `AI model ${d.capabilities.llm}` : "No AI model — clients write their notes themselves"}><Badge tone={d.capabilities.llm ? "good" : "neutral"}>{d.capabilities.llm ? "On this server" : "Off"}</Badge></Row>
        <Row label="Hardware" hint={`${d.hardware.cpuBrand ?? d.hardware.arch} · ${d.hardware.cpuCores} cores · ${fmtBytes(d.hardware.memoryBytes) || "memory unknown"} · ${d.hardware.os} ${d.hardware.osVersion}`}><Cpu className="h-3.5 w-3.5 text-muted" /></Row>
      </Card>

      <h3 className="mb-2 mt-6 font-display text-[11.5px] font-bold uppercase tracking-wider text-muted">Connect the Huddle app</h3>
      <Card>
        <Row label="Server address" hint="Settings → Server in Huddle. Use the port you forwarded for the app, not the dashboard port.">
          <code className="selectable rounded-md bg-fg/[0.04] px-2 py-1 font-mono text-[12px]">{url}</code>
          <Button size="sm" variant="ghost" onClick={() => copy(url)}>{copied ? <Check className="h-3.5 w-3.5 text-emerald-600" /> : <Copy className="h-3.5 w-3.5" />}</Button>
        </Row>
        {d.fingerprint && (
          <Row label="Certificate fingerprint" hint="Self-signed. Huddle shows this fingerprint when it connects for the first time; confirm only when it matches.">
            <code className="selectable max-w-[380px] break-all rounded-md bg-fg/[0.04] px-2 py-1 font-mono text-[11px] leading-relaxed">{d.fingerprint}</code>
          </Row>
        )}
        <Row label="Version" hint={`Huddle Server ${d.version} · engine ${d.engineVersion}`}><Sparkles className="h-3.5 w-3.5 text-muted" /></Row>
      </Card>

      <h3 className="mb-2 mt-6 font-display text-[11.5px] font-bold uppercase tracking-wider text-muted">MCP</h3>
      <Card>
        <Row label="MCP endpoint" hint={`${url}/mcp — tokens are made per client (Clients page or the Huddle app) and see what that client sees.`}>
          <Network className="h-3.5 w-3.5 text-muted" /><Badge tone="good">Running</Badge>
        </Row>
        <Row label="Known voices" hint="Voices are recognised on each Mac, not here: speaker names from the conversation are sent along, the voice match happens on the client."><Users className="h-3.5 w-3.5 text-muted" /></Row>
      </Card>
    </>
  );
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
