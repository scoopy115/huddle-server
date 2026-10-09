import { useCallback, useEffect, useState } from "react";
import { Check, ChevronDown, Clock, Copy, Eye, HelpCircle, KeyRound, Mic, Pencil, Plus, Sparkles, Trash2 } from "lucide-react";
import { api, errorMessage, type Client, type McpToken } from "@/lib/api";
import { fmtDate } from "@/lib/format";
import { cn } from "@/lib/utils";
import { useCopy } from "@/pages/Overview";
import { Badge, Button, Card, DangerDialog, Dialog, Input, Row, Select, Switch } from "@/components/ui";

export function Clients({ isAdmin }: { isAdmin: boolean }) {
  const [list, setList] = useState<Client[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [fresh, setFresh] = useState<Client | null>(null);
  const [renaming, setRenaming] = useState<Client | null>(null);
  const [deleting, setDeleting] = useState<Client | null>(null);
  const [open, setOpen] = useState<number | null>(null);
  const [explain, setExplain] = useState(false);
  const { copied, copy } = useCopy();
  const load = useCallback(() => api.clients().then(setList).catch((e) => setError(errorMessage(e))), []);
  useEffect(() => { load(); }, [load]);
  const act = async (fn: () => Promise<unknown>) => { try { await fn(); await load(); } catch (e) { setError(errorMessage(e)); } };

  const create = async () => { try { const c = await api.createClient(name.trim() || "Mac"); setCreating(false); setFresh(c); load(); } catch (e) { setError(errorMessage(e)); } };
  const groups = isAdmin ? Array.from(list.reduce((m, c) => m.set(c.userEmail ?? "—", [...(m.get(c.userEmail ?? "—") ?? []), c]), new Map<string, Client[]>())) : [["", list] as [string, Client[]]];

  return (
    <>
      <div className="mb-4 flex items-center justify-between">
        <h2 className="font-display text-[22px] font-bold tracking-tight">Clients</h2>
        <Button variant="primary" onClick={() => { setName(""); setCreating(true); }}><Plus className="h-3.5 w-3.5" /> New client key</Button>
      </div>
      {error && <div className="mb-3 text-[12.5px] text-danger">{error}</div>}
      {list.length === 0 && <Card><div className="px-4 py-6 text-center text-[13px] text-muted">No clients yet.</div></Card>}
      {groups.map(([email, items]) => (
        <section key={email} className="mb-4">
          {isAdmin && <h3 className="mb-2 font-display text-[11.5px] font-bold uppercase tracking-wider text-muted">{email}</h3>}
          <Card>
            {items.map((c) => (
              <div key={c.id}>
                <Row label={c.name} hintNode={<span className="flex flex-wrap gap-3"><span className="inline-flex items-center gap-1 font-mono"><KeyRound className="h-3 w-3" />{c.prefix}…</span><span className="inline-flex items-center gap-1"><Clock className="h-3 w-3" />{c.lastSeenAt ? `last seen ${fmtDate(c.lastSeenAt)}${c.lastVersion ? ` · Huddle ${c.lastVersion}` : ""}` : "never connected"}</span><span className="inline-flex items-center gap-1"><Mic className="h-3 w-3" />{c.meetingCount} meeting{c.meetingCount === 1 ? "" : "s"}</span><button className="inline-flex items-center gap-1 hover:text-fg" onClick={() => setOpen(open === c.id ? null : c.id)}>{c.tokenCount} MCP token{c.tokenCount === 1 ? "" : "s"} <ChevronDown className={cn("h-3 w-3 transition-transform", open === c.id && "rotate-180")} /></button></span>}>
                  {c.revoked ? <Badge tone="bad">Revoked</Badge> : isAdmin ? (
                    <>
                      <span className="inline-flex items-center gap-1.5 text-[12px] text-muted" title="AI notes for this client's recordings"><Sparkles className="h-3 w-3" /><Switch checked={c.aiEnabled} onChange={(v) => act(() => api.patchClient(c.id, { ai_enabled: v }))} /></span>
                      <Select value={c.scope} onChange={(e) => act(() => api.patchClient(c.id, { scope: e.target.value as "own" | "all" }))}>
                        <option value="own">Own recordings</option>
                        <option value="all">All recordings</option>
                      </Select>
                      <button className="text-muted hover:text-fg" title="What do these mean?" onClick={() => setExplain(true)}><HelpCircle className="h-3.5 w-3.5" /></button>
                    </>
                  ) : <><Badge><Eye className="h-3 w-3" />{c.scope === "all" ? "All recordings" : "Own recordings"}</Badge>{!c.aiEnabled && <Badge tone="neutral">No AI notes</Badge>}</>}
                  {!c.revoked && <Button size="sm" variant="ghost" onClick={() => act(() => api.revokeClient(c.id))}>Revoke</Button>}
                  <Button size="sm" variant="ghost" title="Rename" onClick={() => { setName(c.name); setRenaming(c); }}><Pencil className="h-3.5 w-3.5" /></Button>
                  <Button size="sm" variant="ghost" title="Delete" onClick={() => setDeleting(c)}><Trash2 className="h-3.5 w-3.5 text-danger" /></Button>
                </Row>
                {open === c.id && <Tokens client={c} onChanged={load} />}
              </div>
            ))}
            {items.length === 0 && <div className="px-4 py-3 text-[12.5px] text-muted">No clients yet.</div>}
          </Card>
        </section>
      ))}

      <Dialog open={creating} onClose={() => setCreating(false)} title="New client key"
        footer={<><Button variant="ghost" onClick={() => setCreating(false)}>Cancel</Button><Button variant="primary" onClick={create}><KeyRound className="h-3.5 w-3.5" /> Generate</Button></>}>
        <label className="block text-[12px] text-muted">Device name</label>
        <Input autoFocus className="mt-1" value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && create()} />
      </Dialog>
      <Dialog open={explain} onClose={() => setExplain(false)} title="What a client may see" footer={<Button variant="primary" onClick={() => setExplain(false)}>Close</Button>}>
        <dl className="flex flex-col gap-3 text-[13px]">
          <div><dt className="font-medium">Own recordings</dt><dd className="text-muted">The recordings this client sent. Other clients and accounts never see them.</dd></div>
          <div><dt className="font-medium">All recordings</dt><dd className="text-muted">Every recording on the server, including other accounts'. Reading only; changing stays with the sender.</dd></div>
          <div><dt className="font-medium">AI notes</dt><dd className="text-muted">Off: the server transcribes and separates speakers but writes no summary for this client.</dd></div>
          <div><dt className="font-medium">MCP tokens</dt><dd className="text-muted">Made per client and see exactly what the client sees.</dd></div>
        </dl>
      </Dialog>
      <Dialog open={!!renaming} onClose={() => setRenaming(null)} title="Rename client"
        footer={<><Button variant="ghost" onClick={() => setRenaming(null)}>Cancel</Button><Button variant="primary" onClick={() => act(async () => { if (renaming) await api.patchClient(renaming.id, { name }); setRenaming(null); })}>Save</Button></>}>
        <Input autoFocus value={name} onChange={(e) => setName(e.target.value)} />
      </Dialog>
      <Dialog open={!!fresh} onClose={() => setFresh(null)} title={`Key for ${fresh?.name}`} width={520} footer={<Button variant="primary" onClick={() => setFresh(null)}>Done</Button>}>
        <div className="mb-3 flex items-center gap-2 rounded-lg border border-accent/30 bg-accent-soft/60 px-3 py-2 text-[12.5px]"><KeyRound className="h-3.5 w-3.5 shrink-0 text-accent" /> Shown once. Copy it now.</div>
        <div className="relative"><pre className="selectable overflow-x-auto rounded-lg border border-border bg-fg/[0.03] p-3 pr-10 font-mono text-[12px] break-all whitespace-pre-wrap">{fresh?.key}</pre><Button size="sm" variant="ghost" className="absolute right-1.5 top-1.5" onClick={() => fresh?.key && copy(fresh.key)}>{copied ? <Check className="h-3.5 w-3.5 text-emerald-600" /> : <Copy className="h-3.5 w-3.5" />}</Button></div>
        <p className="mt-2 text-[11.5px] text-muted">Open Huddle on that device and connect with this key under Settings → Server.</p>
      </Dialog>
      <DangerDialog open={!!deleting} onClose={() => setDeleting(null)} title="Delete this client?" confirmLabel="Delete client" seconds={3}
        onConfirm={() => act(async () => { if (deleting) await api.deleteClient(deleting.id); setDeleting(null); })}>
        “{deleting?.name}” and its MCP tokens lose access immediately. Recordings it sent stay on the server.
      </DangerDialog>
    </>
  );
}

function Tokens({ client, onChanged }: { client: Client; onChanged: () => void }) {
  const [tokens, setTokens] = useState<McpToken[]>([]);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [days, setDays] = useState(90);
  const [fresh, setFresh] = useState<McpToken | null>(null);
  const [deleting, setDeleting] = useState<McpToken | null>(null);
  const { copied, copy } = useCopy();
  const load = useCallback(() => api.clientTokens(client.id).then(setTokens).catch(() => {}), [client.id]);
  useEffect(() => { load(); }, [load]);
  const snippet = (t: McpToken) => `{\n  "mcpServers": {\n    "huddle": {\n      "type": "http",\n      "url": "${t.url ?? `${window.location.origin}/mcp`}",\n      "headers": { "Authorization": "Bearer ${t.token}" }\n    }\n  }\n}`;
  return (
    <div className="border-b border-border bg-fg/[0.02] px-4 py-3 last:border-b-0">
      <div className="mb-2 flex items-center justify-between"><span className="text-[12px] font-medium text-muted">MCP tokens for {client.name} — {client.scope === "all" ? "see all recordings" : "see this client's recordings"}</span>{!client.revoked && <Button size="sm" onClick={() => { setName(""); setDays(90); setCreating(true); }}><Plus className="h-3 w-3" /> New token</Button>}</div>
      {tokens.map((t) => (
        <div key={t.id} className="flex items-center gap-3 py-1.5 text-[12.5px]">
          <span className="font-medium">{t.name}</span><span className="font-mono text-muted">{t.prefix}…</span>
          <span className="text-muted">{t.expired ? "expired" : t.expiresAt ? `until ${fmtDate(t.expiresAt)}` : ""}{t.lastUsedAt ? ` · used ${fmtDate(t.lastUsedAt)}` : ""}</span>
          <div className="flex-1" />
          <Button size="sm" variant="ghost" onClick={() => setDeleting(t)}><Trash2 className="h-3.5 w-3.5" /></Button>
        </div>
      ))}
      {tokens.length === 0 && <div className="text-[12px] text-muted">No tokens.</div>}
      <Dialog open={creating} onClose={() => setCreating(false)} title="New MCP token" footer={<><Button variant="ghost" onClick={() => setCreating(false)}>Cancel</Button><Button variant="primary" onClick={async () => { const t = await api.createClientToken(client.id, name.trim() || "MCP client", days); setCreating(false); setFresh(t); load(); onChanged(); }}>Generate</Button></>}>
        <label className="block text-[12px] text-muted">Name</label>
        <Input autoFocus className="mt-1" value={name} onChange={(e) => setName(e.target.value)} />
        <label className="mt-3 block text-[12px] text-muted">Valid for</label>
        <div className="mt-1 flex gap-2">{[30, 90, 365].map((d) => <button key={d} onClick={() => setDays(d)} className={cn("flex-1 rounded-lg border px-3 py-2 text-[13px]", days === d ? "border-accent bg-accent-soft font-medium text-accent" : "border-border hover:bg-fg/[0.04]")}>{d} days</button>)}</div>
      </Dialog>
      <Dialog open={!!fresh} onClose={() => setFresh(null)} title="MCP token" width={560} footer={<Button variant="primary" onClick={() => setFresh(null)}>Done</Button>}>
        <p className="mb-2 text-[12.5px] text-muted">Shown once. Add this to the MCP configuration of your tool.</p>
        <div className="relative"><pre className="selectable overflow-x-auto rounded-lg border border-border bg-fg/[0.03] p-3 pr-10 font-mono text-[11.5px] leading-relaxed">{fresh && snippet(fresh)}</pre><Button size="sm" variant="ghost" className="absolute right-1.5 top-1.5" onClick={() => fresh && copy(snippet(fresh))}>{copied ? <Check className="h-3.5 w-3.5 text-emerald-600" /> : <Copy className="h-3.5 w-3.5" />}</Button></div>
      </Dialog>
      <DangerDialog open={!!deleting} onClose={() => setDeleting(null)} title="Delete this token?" confirmLabel="Delete token" seconds={2} onConfirm={async () => { if (deleting) { await api.deleteToken(deleting.id); setDeleting(null); load(); onChanged(); } }}>
        “{deleting?.name}” loses access immediately.
      </DangerDialog>
    </div>
  );
}
