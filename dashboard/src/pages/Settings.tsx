import { useCallback, useEffect, useState } from "react";
import { Calendar, Check, Clock, Copy, Key, RefreshCw, Trash2 } from "lucide-react";
import { api, errorMessage } from "@/lib/api";
import type { ApiKey, McpStatus, UserSettings } from "@/types/engine";
import { fmtDate } from "@/lib/format";
import { cn } from "@/lib/utils";
import { useCopy } from "@/pages/Overview";
import { Badge, Button, Card, DangerDialog, Dialog, Input, Row, Select, Spinner, Switch } from "@/components/ui";

const GB = 1024 ** 3;
const LANGS: [string, string][] = [["auto", "Automatic (server language)"], ["en", "English"], ["nl", "Dutch"], ["de", "German"], ["fr", "French"], ["es", "Spanish"], ["it", "Italian"], ["pt", "Portuguese"], ["pl", "Polish"], ["sv", "Swedish"], ["da", "Danish"], ["no", "Norwegian"], ["fi", "Finnish"], ["tr", "Turkish"], ["ja", "Japanese"], ["zh", "Chinese"]];

export function Settings({ onName }: { onName: (n: string) => void }) {
  const [s, setS] = useState<UserSettings | null>(null);
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    try { const [st, info] = await Promise.all([api.settings(), api.info()]); setS(st); setName(info.name); } catch (e) { setError(errorMessage(e)); }
  }, []);
  useEffect(() => { load(); }, [load]);
  const update = async (p: Partial<UserSettings>) => { try { setS(await api.updateSettings(p)); } catch (e) { setError(errorMessage(e)); } };
  if (error) return <div className="text-danger">{error}</div>;
  if (!s) return <Spinner />;
  const gb = Math.round((s["storage.maxBytes"] || 0) / GB);
  return (
    <>
      <h2 className="mb-4 font-display text-[22px] font-bold tracking-tight">Settings</h2>
      <Card>
        <Row label="Server name" hint="Shown in the dashboard and in the Huddle app.">
          <Input className="w-[240px]" value={name} onChange={(e) => setName(e.target.value)} onBlur={async () => { const r = await api.setServerName(name); setName(r.name); onName(r.name); }} />
        </Row>
      </Card>

      <h3 className="mb-2 mt-6 font-display text-[11.5px] font-bold uppercase tracking-wider text-muted">Notes</h3>
      <Card>
        <Row label="Language of the notes" hint="Transcripts keep the spoken language.">
          <Select value={s["general.uiLanguage"]} onChange={(e) => update({ "general.uiLanguage": e.target.value })}>{LANGS.map(([c, l]) => <option key={c} value={c}>{l}</option>)}</Select>
        </Row>
        <Row label="Action items with every summary"><Switch checked={!!s["notes.autoActionItems"]} onChange={(v) => update({ "notes.autoActionItems": v })} /></Row>
        <Row label="Name speakers from the conversation" hint="“Daan, kun jij…” → the next speaker is Daan."><Switch checked={s["speakers.inferNames"] !== false} onChange={(v) => update({ "speakers.inferNames": v })} /></Row>
      </Card>

      <h3 className="mb-2 mt-6 font-display text-[11.5px] font-bold uppercase tracking-wider text-muted">Storage</h3>
      <Card>
        <Row label="Keep audio for" hint="Transcripts and notes are kept forever; only the audio is removed.">
          <Select value={String(s["privacy.retentionDays"] ?? 0)} onChange={(e) => update({ "privacy.retentionDays": Number(e.target.value) })}>
            <option value="0">Forever</option><option value="7">7 days</option><option value="30">30 days</option><option value="90">90 days</option><option value="365">1 year</option>
          </Select>
        </Row>
        <Row label="Audio storage cap" hint="Oldest audio goes first when the cap is reached.">
          <Select value={String(gb)} onChange={(e) => update({ "storage.maxBytes": Number(e.target.value) * GB })}>
            {[0, 5, 10, 20, 50, 100, 200, 500].map((g) => <option key={g} value={g}>{g === 0 ? "No cap" : `${g} GB`}</option>)}{![0, 5, 10, 20, 50, 100, 200, 500].includes(gb) && <option value={gb}>{gb} GB</option>}
          </Select>
        </Row>
      </Card>

      <Mcp s={s} update={update} />
    </>
  );
}

function Mcp({ s, update }: { s: UserSettings; update: (p: Partial<UserSettings>) => Promise<void> }) {
  const [status, setStatus] = useState<McpStatus | null>(null);
  const [keys, setKeys] = useState<ApiKey[]>([]);
  const [newKey, setNewKey] = useState<ApiKey | null>(null);
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState<ApiKey | null>(null);
  const [name, setName] = useState("");
  const [days, setDays] = useState(30);
  const { copied, copy } = useCopy();
  const load = useCallback(() => { api.mcpStatus().then(setStatus).catch(() => {}); api.apiKeys().then(setKeys).catch(() => {}); }, []);
  useEffect(() => { load(); }, [load, s]);
  const url = `${window.location.protocol}//${window.location.hostname}/mcp`;
  const create = async () => { const k = await api.createApiKey(name.trim() || "MCP client", days); setCreating(false); setNewKey(k); load(); };
  const snippet = (key: string) => `{\n  "mcpServers": {\n    "huddle": {\n      "type": "http",\n      "url": "${url}",\n      "headers": { "Authorization": "Bearer ${key}" }\n    }\n  }\n}`;
  return (
    <>
      <h3 className="mb-2 mt-6 font-display text-[11.5px] font-bold uppercase tracking-wider text-muted">MCP</h3>
      <Card>
        <Row label="MCP over the network" hint="AI tools (Claude Code, Cursor, …) search and read the meetings on this server.">
          <Switch checked={!!s["mcp.networkEnabled"]} onChange={(v) => update({ "mcp.networkEnabled": v })} />
        </Row>
        {s["mcp.networkEnabled"] && <Row label="Endpoint" hint={status?.error ?? url}><Badge tone={status?.running ? "good" : status?.error ? "bad" : "warn"}>{status?.running ? "Running" : status?.error ? "Error" : "Starting"}</Badge></Row>}
      </Card>
      {s["mcp.networkEnabled"] && (
        <Card className="mt-3">
          {keys.map((k) => (
            <Row key={k.id} label={k.name} hintNode={<span className="flex flex-wrap gap-3"><span className="inline-flex items-center gap-1 font-mono"><Key className="h-3 w-3" />{k.prefix}…</span><span className="inline-flex items-center gap-1"><Calendar className="h-3 w-3" />created {fmtDate(k.createdAt)}</span><span className={cn("inline-flex items-center gap-1", k.expired && "text-danger")}><Clock className="h-3 w-3" />{k.expired ? `expired ${fmtDate(k.expiresAt)}` : `expires ${fmtDate(k.expiresAt)}`}</span></span>}>
              <Button size="sm" onClick={async () => { await api.renewApiKey(k.id); load(); }}><RefreshCw className="h-3 w-3" /> Renew</Button>
              <Button size="sm" variant="ghost" onClick={() => setDeleting(k)}><Trash2 className="h-3.5 w-3.5" /></Button>
            </Row>
          ))}
          {keys.length === 0 && <div className="px-4 py-3 text-[12.5px] text-muted">No keys yet.</div>}
          <div className="border-t border-border px-4 py-3"><Button variant="primary" onClick={() => { setName(""); setDays(30); setCreating(true); }}><Key className="h-3.5 w-3.5" /> Generate key</Button></div>
        </Card>
      )}
      <Dialog open={creating} onClose={() => setCreating(false)} title="New MCP key" footer={<><Button variant="ghost" onClick={() => setCreating(false)}>Cancel</Button><Button variant="primary" onClick={create}>Generate</Button></>}>
        <label className="block text-[12px] text-muted">Name</label>
        <Input autoFocus className="mt-1" placeholder="Claude Code on the studio Mac" value={name} onChange={(e) => setName(e.target.value)} />
        <label className="mt-3 block text-[12px] text-muted">Valid for</label>
        <div className="mt-1 flex gap-2">{[30, 60, 90].map((d) => <button key={d} onClick={() => setDays(d)} className={cn("flex-1 rounded-lg border px-3 py-2 text-[13px]", days === d ? "border-accent bg-accent-soft font-medium text-accent" : "border-border hover:bg-fg/[0.04]")}>{d} days</button>)}</div>
      </Dialog>
      <Dialog open={!!newKey} onClose={() => setNewKey(null)} title="MCP key" width={560} footer={<Button variant="primary" onClick={() => setNewKey(null)}>Done</Button>}>
        <p className="mb-2 text-[12.5px] text-muted">Shown once. Add this to the MCP configuration of your tool.</p>
        <div className="relative"><pre className="selectable overflow-x-auto rounded-lg border border-border bg-fg/[0.03] p-3 pr-10 font-mono text-[11.5px] leading-relaxed">{snippet(newKey?.key ?? "")}</pre><Button size="sm" variant="ghost" className="absolute right-1.5 top-1.5" onClick={() => copy(snippet(newKey?.key ?? ""))}>{copied ? <Check className="h-3.5 w-3.5 text-emerald-600" /> : <Copy className="h-3.5 w-3.5" />}</Button></div>
      </Dialog>
      <DangerDialog open={!!deleting} onClose={() => setDeleting(null)} title="Delete this key?" confirmLabel="Delete key" seconds={2} onConfirm={async () => { if (deleting) { await api.deleteApiKey(deleting.id); setDeleting(null); load(); } }}>
        “{deleting?.name}” loses access immediately.
      </DangerDialog>
    </>
  );
}
