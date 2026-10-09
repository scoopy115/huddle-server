import { useCallback, useEffect, useState } from "react";
import { Network } from "lucide-react";
import { api, errorMessage } from "@/lib/api";
import type { UserSettings } from "@/types/engine";
import { Card, Input, Row, Select, Spinner, Switch } from "@/components/ui";

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
          <Input className="w-[240px]" value={name} onChange={(e) => setName(e.target.value)} onBlur={async () => { const r = await api.updateServer({ name }); setName(r.name); onName(r.name); }} />
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

      <h3 className="mb-2 mt-6 font-display text-[11.5px] font-bold uppercase tracking-wider text-muted">MCP</h3>
      <Card>
        <Row label="MCP endpoint" hint="Always on at /mcp of the client address. Tokens are made per client and see what that client sees; manage them under Clients."><Network className="h-3.5 w-3.5 text-muted" /></Row>
      </Card>
    </>
  );
}
