import { useCallback, useEffect, useState } from "react";
import { Calendar, Check, Copy, KeyRound, Link2, Plus, Shield, ShieldCheck, Trash2 } from "lucide-react";
import { api, errorMessage, type Invite, type User } from "@/lib/api";
import { fmtDate } from "@/lib/format";
import { useCopy } from "@/pages/Overview";
import { Badge, Button, Card, DangerDialog, Dialog, Input, Row, Select } from "@/components/ui";

export function Users({ meId }: { meId: number }) {
  const [users, setUsers] = useState<User[]>([]);
  const [invites, setInvites] = useState<Invite[]>([]);
  const [registration, setRegistration] = useState<"invite" | "open">("invite");
  const [error, setError] = useState<string | null>(null);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviting, setInviting] = useState(false);
  const [fresh, setFresh] = useState<Invite | null>(null);
  const [resetting, setResetting] = useState<User | null>(null);
  const [newPw, setNewPw] = useState("");
  const [newPw2, setNewPw2] = useState("");
  const [deletingInvite, setDeletingInvite] = useState<Invite | null>(null);
  const [deleting, setDeleting] = useState<User | null>(null);
  const { copied, copy } = useCopy();
  const load = useCallback(async () => {
    try {
      const [u, i, s] = await Promise.all([api.users(), api.invites(), api.setupState()]);
      setUsers(u); setInvites(i); setRegistration(s.registration); setError(null);
    } catch (e) { setError(errorMessage(e)); }
  }, []);
  useEffect(() => { load(); }, [load]);
  const act = async (fn: () => Promise<unknown>) => { try { await fn(); await load(); } catch (e) { setError(errorMessage(e)); } };
  const pending = users.filter((u) => !u.approved);
  const active = users.filter((u) => u.approved);

  return (
    <>
      <div className="mb-4 flex items-center justify-between">
        <h2 className="font-display text-[22px] font-bold tracking-tight">Users</h2>
        <Button variant="primary" onClick={() => { setInviteEmail(""); setInviting(true); }}><Plus className="h-3.5 w-3.5" /> Invite</Button>
      </div>
      {error && <div className="mb-3 text-[12.5px] text-danger">{error}</div>}

      <Card>
        <Row label="Registration" hint={registration === "open" ? "Anyone with the dashboard address can create an account; you approve it here." : "Only people with an invitation link can create an account."}>
          <Select value={registration} onChange={(e) => act(() => api.updateServer({ registration: e.target.value as "invite" | "open" }))}>
            <option value="invite">By invitation</option>
            <option value="open">Open, with approval</option>
          </Select>
        </Row>
      </Card>

      {pending.length > 0 && (
        <>
          <h3 className="mb-2 mt-6 font-display text-[11.5px] font-bold uppercase tracking-wider text-muted">Waiting for approval</h3>
          <Card>
            {pending.map((u) => (
              <Row key={u.id} label={u.email} hint={`requested ${fmtDate(u.createdAt)}`}>
                <Button size="sm" variant="primary" onClick={() => act(() => api.patchUser(u.id, { approved: true }))}><Check className="h-3.5 w-3.5" /> Approve</Button>
                <Button size="sm" variant="ghost" onClick={() => act(() => api.deleteUser(u.id))}>Reject</Button>
              </Row>
            ))}
          </Card>
        </>
      )}

      <h3 className="mb-2 mt-6 font-display text-[11.5px] font-bold uppercase tracking-wider text-muted">Accounts</h3>
      <Card>
        {active.map((u) => (
          <Row key={u.id} label={u.email} hintNode={<span className="flex flex-wrap gap-3"><span className="inline-flex items-center gap-1"><KeyRound className="h-3 w-3" />{u.clientCount ?? 0} client{u.clientCount === 1 ? "" : "s"}</span><span className="inline-flex items-center gap-1"><ShieldCheck className="h-3 w-3" />{u.totpEnabled ? "2FA on" : "2FA off"}</span><span className="inline-flex items-center gap-1"><Calendar className="h-3 w-3" />since {fmtDate(u.createdAt)}</span></span>}>
            {u.id === meId ? <Badge tone="accent"><Shield className="h-3 w-3" /> Admin (you)</Badge> : (
              <Select value={u.role} onChange={(e) => act(() => api.patchUser(u.id, { role: e.target.value as "admin" | "user" }))}>
                <option value="user">User</option><option value="admin">Admin</option>
              </Select>
            )}
            <Button size="sm" variant="ghost" title="Set a new password" onClick={() => { setNewPw(""); setNewPw2(""); setResetting(u); }}><KeyRound className="h-3.5 w-3.5" /></Button>
            {u.id !== meId && <Button size="sm" variant="ghost" title="Delete account" onClick={() => setDeleting(u)}><Trash2 className="h-3.5 w-3.5 text-danger" /></Button>}
          </Row>
        ))}
      </Card>

      <h3 className="mb-2 mt-6 font-display text-[11.5px] font-bold uppercase tracking-wider text-muted">Invitations</h3>
      <Card>
        {invites.map((i) => (
          <Row key={i.id} label={i.email ?? "Anyone with the link"} hint={i.used ? "Used" : i.expired ? "Expired" : `valid until ${fmtDate(i.expiresAt)}`}>
            {i.used ? <Badge tone="good">Used</Badge> : i.expired ? <Badge tone="bad">Expired</Badge> : <Badge>Open</Badge>}
            <Button size="sm" variant="ghost" onClick={() => setDeletingInvite(i)}><Trash2 className="h-3.5 w-3.5" /></Button>
          </Row>
        ))}
        {invites.length === 0 && <div className="px-4 py-3 text-[12.5px] text-muted">No invitations yet.</div>}
      </Card>

      <Dialog open={inviting} onClose={() => setInviting(false)} title="Invite someone"
        footer={<><Button variant="ghost" onClick={() => setInviting(false)}>Cancel</Button><Button variant="primary" onClick={async () => { try { const inv = await api.createInvite(inviteEmail.trim() || undefined); setInviting(false); setFresh(inv); load(); } catch (e) { setError(errorMessage(e)); } }}><Link2 className="h-3.5 w-3.5" /> Create link</Button></>}>
        <label className="block text-[12px] text-muted">E-mail address <span className="text-muted/70">— optional, binds the link to that address</span></label>
        <Input autoFocus className="mt-1" type="email" value={inviteEmail} onChange={(e) => setInviteEmail(e.target.value)} />
        <p className="mt-2 text-[11.5px] text-muted">Valid once, 7 days.</p>
      </Dialog>

      <Dialog open={!!fresh} onClose={() => setFresh(null)} title="Invitation link" width={520} footer={<Button variant="primary" onClick={() => setFresh(null)}>Done</Button>}>
        <div className="relative"><pre className="selectable overflow-x-auto rounded-lg border border-border bg-fg/[0.03] p-3 pr-10 font-mono text-[12px] break-all whitespace-pre-wrap">{fresh?.url}</pre><Button size="sm" variant="ghost" className="absolute right-1.5 top-1.5" onClick={() => fresh?.url && copy(fresh.url)}>{copied ? <Check className="h-3.5 w-3.5 text-emerald-600" /> : <Copy className="h-3.5 w-3.5" />}</Button></div>
      </Dialog>

      <Dialog open={!!resetting} onClose={() => setResetting(null)} title={`New password for ${resetting?.email}`}
        footer={<><Button variant="ghost" onClick={() => setResetting(null)}>Cancel</Button><Button variant="primary" disabled={newPw.length < 10 || newPw !== newPw2} onClick={() => act(async () => { if (resetting) await api.resetUserPassword(resetting.id, newPw); setResetting(null); })}>Set password</Button></>}>
        <Input autoFocus type="password" placeholder="At least 10 characters" autoComplete="new-password" value={newPw} onChange={(e) => setNewPw(e.target.value)} />
        <Input className="mt-2" type="password" placeholder="Repeat password" autoComplete="new-password" value={newPw2} onChange={(e) => setNewPw2(e.target.value)} />
        {newPw2 && newPw2 !== newPw && <div className="mt-1 text-[12px] text-danger">The passwords differ.</div>}
      </Dialog>
      <DangerDialog open={!!deletingInvite} onClose={() => setDeletingInvite(null)} title="Delete this invitation?" confirmLabel="Delete" seconds={0}
        onConfirm={() => act(async () => { if (deletingInvite) await api.deleteInvite(deletingInvite.id); setDeletingInvite(null); })}>
        The link stops working.
      </DangerDialog>

      <DangerDialog open={!!deleting} onClose={() => setDeleting(null)} title="Delete this account?" confirmLabel="Delete account" seconds={3}
        onConfirm={() => act(async () => { if (deleting) await api.deleteUser(deleting.id); setDeleting(null); })}>
        {deleting?.email} loses access, together with their clients and MCP tokens. Recordings stay on the server.
      </DangerDialog>
    </>
  );
}
