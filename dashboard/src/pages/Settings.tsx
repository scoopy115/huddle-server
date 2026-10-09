import { useCallback, useEffect, useState } from "react";
import { api, errorMessage } from "@/lib/api";
import type { UserSettings } from "@/types/engine";
import { Card, InfoTip, Input, Row, Select, Spinner, Switch } from "@/components/ui";
import { UnsavedBar } from "@/components/UnsavedBar";

const GB = 1024 ** 3;

export function Settings({ onName }: { onName: (n: string) => void }) {
  const [saved, setSaved] = useState<UserSettings | null>(null);    // what the server has
  const [s, setS] = useState<UserSettings | null>(null);            // what the form shows
  const [savedName, setSavedName] = useState("");
  const [name, setName] = useState("");
  const [tools, setTools] = useState<{ name: string; description: string }[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    try {
      const [st, info, t] = await Promise.all([api.settings(), api.info(), api.mcpTools().catch(() => [])]);
      setSaved(st); setS(st); setSavedName(info.name); setName(info.name); setTools(t);
    } catch (e) { setError(errorMessage(e)); }
  }, []);
  useEffect(() => { load(); }, [load]);
  const update = async (p: Partial<UserSettings>) => setS((x) => (x ? { ...x, ...p } : x));
  const dirty = !!s && !!saved && (JSON.stringify(s) !== JSON.stringify(saved) || name !== savedName);
  const save = async () => {
    if (!s) return;
    setSaving(true); setError(null);
    try {
      const patch = Object.fromEntries(Object.entries(s).filter(([k, v]) => JSON.stringify(v) !== JSON.stringify(saved?.[k])));
      if (Object.keys(patch).length) setSaved(await api.updateSettings(patch as Partial<UserSettings>)); else setSaved(s);
      if (name !== savedName) { const r = await api.updateServer({ name }); setSavedName(r.name); setName(r.name); onName(r.name); }
    } catch (e) { setError(errorMessage(e)); } finally { setSaving(false); }
  };
  if (error && !s) return <div className="text-danger">{error}</div>;
  if (!s) return <Spinner />;
  const gb = Math.round((s["storage.maxBytes"] || 0) / GB);
  return (
    <>
      <h2 className="mb-4 font-display text-[22px] font-bold tracking-tight">Settings</h2>
      {error && <div className="mb-3 text-[12.5px] text-danger">{error}</div>}
      <Card>
        <Row label="Server name" hint="Shown in the dashboard and in the Huddle app.">
          <Input className="w-[240px]" value={name} onChange={(e) => setName(e.target.value)} />
        </Row>
      </Card>

      <h3 className="mb-2 mt-6 font-display text-[11.5px] font-bold uppercase tracking-wider text-muted">Notes</h3>
      <Card>
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

      <h3 className="mb-2 mt-6 flex items-center gap-1.5 font-display text-[11.5px] font-bold uppercase tracking-wider text-muted">MCP <InfoTip text="Model Context Protocol: AI tools such as Claude Code, Claude Desktop or Cursor connect to this endpoint with a token and can then search and read the meetings that token may see. Tokens are made per client under Clients." /></h3>
      <Card>
        <Row label="Endpoint" hint={`${window.location.origin}/mcp`}><span className="text-[12.5px] text-muted">Tokens under Clients</span></Row>
        {tools.length > 0 && (
          <div className="px-4 py-3">
            <div className="mb-1.5 text-[12px] text-muted">Available tools</div>
            <ul className="grid grid-cols-2 gap-x-4 gap-y-1 text-[12.5px]">
              {tools.map((t) => <li key={t.name}><span className="font-mono">{t.name}</span><span className="text-muted"> — {t.description}</span></li>)}
            </ul>
          </div>
        )}
      </Card>
      <UnsavedBar visible={dirty} saving={saving} onSave={save} onDiscard={() => { setS(saved); setName(savedName); }} />
    </>
  );
}
