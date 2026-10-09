import { useCallback, useEffect, useState } from "react";
import { Check, Copy, KeyRound, Pencil, Plus, Trash2 } from "lucide-react";
import { api, errorMessage, type Client } from "@/lib/api";
import { fmtDate } from "@/lib/format";
import { useCopy } from "@/pages/Overview";
import { Badge, Button, Card, DangerDialog, Dialog, Input, Row } from "@/components/ui";

export function Clients() {
  const [list, setList] = useState<Client[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [fresh, setFresh] = useState<Client | null>(null);
  const [renaming, setRenaming] = useState<Client | null>(null);
  const [deleting, setDeleting] = useState<Client | null>(null);
  const { copied, copy } = useCopy();
  const load = useCallback(() => api.clients().then(setList).catch((e) => setError(errorMessage(e))), []);
  useEffect(() => { load(); }, [load]);

  const create = async () => {
    try { const c = await api.createClient(name.trim() || "Mac"); setCreating(false); setFresh(c); load(); } catch (e) { setError(errorMessage(e)); }
  };
  return (
    <>
      <div className="mb-4 flex items-center justify-between">
        <h2 className="font-display text-[22px] font-bold tracking-tight">Clients</h2>
        <Button variant="primary" onClick={() => { setName(""); setCreating(true); }}><Plus className="h-3.5 w-3.5" /> New client key</Button>
      </div>
      {error && <div className="mb-3 text-[12.5px] text-danger">{error}</div>}
      <Card>
        <div className="border-b border-border px-4 py-3 text-[12.5px] text-muted">One key per device. The key is shown once; paste it in Huddle under Settings → Server.</div>
        {list.map((c) => (
          <Row key={c.id} label={c.name} hintNode={<span className="flex flex-wrap gap-3"><span className="inline-flex items-center gap-1 font-mono"><KeyRound className="h-3 w-3" />{c.prefix}…</span><span>created {fmtDate(c.createdAt)}</span><span>{c.lastSeenAt ? `last seen ${fmtDate(c.lastSeenAt)}${c.lastVersion ? ` · Huddle ${c.lastVersion}` : ""}` : "never connected"}</span><span>{c.meetingCount} meeting{c.meetingCount === 1 ? "" : "s"}</span></span>}>
            {c.revoked ? <Badge tone="bad">Revoked</Badge> : <Button size="sm" variant="ghost" onClick={() => api.revokeClient(c.id).then(load)}>Revoke</Button>}
            <Button size="sm" variant="ghost" title="Rename" onClick={() => { setName(c.name); setRenaming(c); }}><Pencil className="h-3.5 w-3.5" /></Button>
            <Button size="sm" variant="ghost" title="Delete" onClick={() => setDeleting(c)}><Trash2 className="h-3.5 w-3.5 text-danger" /></Button>
          </Row>
        ))}
        {list.length === 0 && <div className="px-4 py-3 text-[12.5px] text-muted">No clients yet.</div>}
      </Card>

      <Dialog open={creating} onClose={() => setCreating(false)} title="New client key"
        footer={<><Button variant="ghost" onClick={() => setCreating(false)}>Cancel</Button><Button variant="primary" onClick={create}><KeyRound className="h-3.5 w-3.5" /> Generate</Button></>}>
        <label className="block text-[12px] text-muted">Device name</label>
        <Input autoFocus className="mt-1" placeholder="Dylan’s MacBook" value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && create()} />
      </Dialog>

      <Dialog open={!!renaming} onClose={() => setRenaming(null)} title="Rename client"
        footer={<><Button variant="ghost" onClick={() => setRenaming(null)}>Cancel</Button><Button variant="primary" onClick={async () => { if (renaming) { await api.renameClient(renaming.id, name); setRenaming(null); load(); } }}>Save</Button></>}>
        <Input autoFocus value={name} onChange={(e) => setName(e.target.value)} />
      </Dialog>

      <Dialog open={!!fresh} onClose={() => setFresh(null)} title={`Key for ${fresh?.name}`} width={520} footer={<Button variant="primary" onClick={() => setFresh(null)}>Done</Button>}>
        <div className="mb-3 flex items-center gap-2 rounded-lg border border-accent/30 bg-accent-soft/60 px-3 py-2 text-[12.5px]"><KeyRound className="h-3.5 w-3.5 shrink-0 text-accent" /> Shown once. Copy it now.</div>
        <div className="relative">
          <pre className="selectable overflow-x-auto rounded-lg border border-border bg-fg/[0.03] p-3 pr-10 font-mono text-[12px] break-all whitespace-pre-wrap">{fresh?.key}</pre>
          <Button size="sm" variant="ghost" className="absolute right-1.5 top-1.5" onClick={() => fresh?.key && copy(fresh.key)}>{copied ? <Check className="h-3.5 w-3.5 text-emerald-600" /> : <Copy className="h-3.5 w-3.5" />}</Button>
        </div>
        <p className="mt-2 text-[11.5px] text-muted">In Huddle: Settings → Server → paste the address of this server and this key → Connect.</p>
      </Dialog>

      <DangerDialog open={!!deleting} onClose={() => setDeleting(null)} title="Delete this client?" confirmLabel="Delete client" seconds={3}
        onConfirm={async () => { if (deleting) { await api.deleteClient(deleting.id); setDeleting(null); load(); } }}>
        “{deleting?.name}” loses access immediately. Meetings it sent stay on the server.
      </DangerDialog>
    </>
  );
}
