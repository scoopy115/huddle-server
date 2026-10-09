import { useEffect, useState } from "react";
import { ShieldCheck, ShieldOff } from "lucide-react";
import { api, errorMessage, type Me } from "@/lib/api";
import { Badge, Button, Card, Dialog, Input, Row } from "@/components/ui";
import { CodeInput } from "@/components/CodeInput";

export function Account({ me, onChanged }: { me: Me; onChanged: () => void }) {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [setup, setSetup] = useState<{ secret: string; uri: string; svg: string } | null>(null);
  const [code, setCode] = useState("");
  const [disabling, setDisabling] = useState(false);
  const user = me.user!;
  const [name, setName] = useState(user.name);
  const [confirmPw, setConfirmPw] = useState("");
  const saveName = async () => { setError(null); try { await api.updateAccount(name); onChanged(); } catch (e) { setError(errorMessage(e)); } };
  const changePw = async () => {
    setError(null); setMsg(null);
    try { await api.changePassword(current, next); setMsg("Password changed. Log in again."); setTimeout(onChanged, 1200); } catch (e) { setError(errorMessage(e)); }
  };
  const [dialogError, setDialogError] = useState<string | null>(null);
  const startTotp = async () => { setError(null); setDialogError(null); setCode(""); setSetup(await api.totpSetup()); };
  useEffect(() => { if (window.location.search.includes("totp=1") && !user.totpEnabled) { window.history.replaceState({}, "", "/account"); startTotp(); } }, []); // oxlint-disable-line react-hooks/exhaustive-deps
  const enable = async (c = code) => { setDialogError(null); try { await api.totpEnable(c); setSetup(null); setCode(""); onChanged(); } catch (e) { setDialogError(errorMessage(e)); } };
  const disable = async (c = code) => { setDialogError(null); try { await api.totpDisable(c); setDisabling(false); setCode(""); onChanged(); } catch (e) { setDialogError(errorMessage(e)); } };
  return (
    <>
      <h2 className="mb-4 font-display text-[22px] font-bold tracking-tight">Account</h2>
      <Card>
        <Row label="Name"><Input className="w-[240px]" value={name} onChange={(e) => setName(e.target.value)} onBlur={() => name.trim() && name !== user.name && saveName()} /></Row>
        <Row label="E-mail address"><span className="text-[13px]">{user.email}</span></Row>
        <Row label="Two-factor authentication" hint="A six-digit code from an authenticator app at every login.">
          {user.totpEnabled ? <><Badge tone="good"><ShieldCheck className="h-3 w-3" /> On</Badge><Button size="sm" variant="ghost" onClick={() => { setCode(""); setDialogError(null); setDisabling(true); }}>Turn off</Button></> : <Button size="sm" variant="primary" onClick={startTotp}><ShieldCheck className="h-3.5 w-3.5" /> Turn on</Button>}
        </Row>
      </Card>
      <h3 className="mb-2 mt-6 font-display text-[11.5px] font-bold uppercase tracking-wider text-muted">Password</h3>
      <Card>
        <Row label="Current password"><Input type="password" className="w-[260px]" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} /></Row>
        <Row label="New password" hint="At least 10 characters."><Input type="password" className="w-[260px]" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} /></Row>
        <Row label="Repeat new password"><Input type="password" className="w-[260px]" autoComplete="new-password" value={confirmPw} onChange={(e) => setConfirmPw(e.target.value)} /></Row>
        <div className="flex items-center gap-3 border-t border-border px-4 py-3"><Button variant="primary" disabled={!current || next.length < 10 || next !== confirmPw} onClick={changePw}>Change password</Button>{msg && <span className="text-[12.5px] text-muted">{msg}</span>}{confirmPw && confirmPw !== next && <span className="text-[12.5px] text-danger">The passwords differ.</span>}</div>
      </Card>
      {error && <div className="mt-2 text-[12.5px] text-danger">{error}</div>}

      <Dialog open={!!setup} onClose={() => { setSetup(null); setDialogError(null); }} title="Set up two-factor authentication" width={460}
        footer={<><Button variant="ghost" onClick={() => { setSetup(null); setDialogError(null); }}>Cancel</Button><Button variant="primary" disabled={code.length < 6} onClick={() => enable()}>Turn on</Button></>}>
        <p className="mb-3 text-muted">Scan the code with an authenticator app (1Password, Google Authenticator, Authy…), then enter the six digits it shows.</p>
        <div className="mx-auto mb-3 w-[180px] rounded-lg bg-white p-2 [&_svg]:h-full [&_svg]:w-full" dangerouslySetInnerHTML={{ __html: setup?.svg ?? "" }} />
        <details className="mb-3 text-[11.5px] text-muted"><summary>Can’t scan? Enter the key by hand</summary><code className="selectable mt-1 block break-all font-mono">{setup?.secret}</code></details>
        <CodeInput autoFocus value={code} onChange={setCode} onComplete={(c) => enable(c)} />
        {dialogError && <div className="mt-2 text-[12.5px] text-danger">{dialogError}</div>}
      </Dialog>

      <Dialog open={disabling} onClose={() => { setDisabling(false); setDialogError(null); }} title="Turn off two-factor authentication?"
        footer={<><Button variant="ghost" onClick={() => { setDisabling(false); setDialogError(null); }}>Cancel</Button><Button variant="danger" disabled={code.length < 6} onClick={() => disable()}><ShieldOff className="h-3.5 w-3.5" /> Turn off</Button></>}>
        <p className="mb-3 text-muted">Enter a current code to confirm.</p>
        <CodeInput autoFocus value={code} onChange={setCode} />
        {dialogError && <div className="mt-2 text-[12.5px] text-danger">{dialogError}</div>}
      </Dialog>
    </>
  );
}
