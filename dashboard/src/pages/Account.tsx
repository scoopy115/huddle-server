import { useState } from "react";
import { ShieldCheck, ShieldOff } from "lucide-react";
import { api, errorMessage, type Me } from "@/lib/api";
import { Badge, Button, Card, Dialog, Input, Row } from "@/components/ui";

export function Account({ me, onChanged }: { me: Me; onChanged: () => void }) {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [setup, setSetup] = useState<{ secret: string; uri: string; svg: string } | null>(null);
  const [code, setCode] = useState("");
  const [disabling, setDisabling] = useState(false);
  const user = me.user!;
  const changePw = async () => {
    setError(null); setMsg(null);
    try { await api.changePassword(current, next); setMsg("Password changed. Log in again."); setTimeout(onChanged, 1200); } catch (e) { setError(errorMessage(e)); }
  };
  const startTotp = async () => { setError(null); setCode(""); setSetup(await api.totpSetup()); };
  const enable = async () => { try { await api.totpEnable(code); setSetup(null); onChanged(); } catch (e) { setError(errorMessage(e)); } };
  const disable = async () => { try { await api.totpDisable(code); setDisabling(false); setCode(""); onChanged(); } catch (e) { setError(errorMessage(e)); } };
  return (
    <>
      <h2 className="mb-4 font-display text-[22px] font-bold tracking-tight">Account</h2>
      <Card>
        <Row label="E-mail address"><span className="text-[13px]">{user.email}</span></Row>
        <Row label="Two-factor authentication" hint="A six-digit code from an authenticator app at every login. Strongly recommended for a server reachable from the internet.">
          {user.totpEnabled ? <><Badge tone="good"><ShieldCheck className="h-3 w-3" /> On</Badge><Button size="sm" variant="ghost" onClick={() => { setCode(""); setDisabling(true); }}>Turn off</Button></> : <Button size="sm" variant="primary" onClick={startTotp}><ShieldCheck className="h-3.5 w-3.5" /> Turn on</Button>}
        </Row>
      </Card>
      <h3 className="mb-2 mt-6 font-display text-[11.5px] font-bold uppercase tracking-wider text-muted">Password</h3>
      <Card>
        <Row label="Current password"><Input type="password" className="w-[260px]" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} /></Row>
        <Row label="New password" hint="At least 10 characters."><Input type="password" className="w-[260px]" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} /></Row>
        <div className="flex items-center gap-3 border-t border-border px-4 py-3"><Button variant="primary" disabled={!current || next.length < 10} onClick={changePw}>Change password</Button>{msg && <span className="text-[12.5px] text-muted">{msg}</span>}</div>
      </Card>
      {error && !setup && !disabling && <div className="mt-2 text-[12.5px] text-danger">{error}</div>}

      <Dialog open={!!setup} onClose={() => setSetup(null)} title="Set up two-factor authentication" width={460}
        footer={<><Button variant="ghost" onClick={() => setSetup(null)}>Cancel</Button><Button variant="primary" disabled={code.replace(/\s/g, "").length < 6} onClick={enable}>Turn on</Button></>}>
        <p className="mb-3 text-muted">Scan the code with an authenticator app (1Password, Google Authenticator, Authy…), then enter the six digits it shows.</p>
        <div className="mx-auto mb-3 w-[180px] rounded-lg bg-white p-2 [&_svg]:h-full [&_svg]:w-full" dangerouslySetInnerHTML={{ __html: setup?.svg ?? "" }} />
        <details className="mb-3 text-[11.5px] text-muted"><summary>Can’t scan? Enter the key by hand</summary><code className="selectable mt-1 block break-all font-mono">{setup?.secret}</code></details>
        <Input inputMode="numeric" autoComplete="one-time-code" placeholder="123 456" value={code} onChange={(e) => setCode(e.target.value)} onKeyDown={(e) => e.key === "Enter" && enable()} className="text-center font-mono text-[16px] tracking-widest" />
        {error && <div className="mt-2 text-[12.5px] text-danger">{error}</div>}
      </Dialog>

      <Dialog open={disabling} onClose={() => setDisabling(false)} title="Turn off two-factor authentication?"
        footer={<><Button variant="ghost" onClick={() => setDisabling(false)}>Cancel</Button><Button variant="danger" disabled={code.replace(/\s/g, "").length < 6} onClick={disable}><ShieldOff className="h-3.5 w-3.5" /> Turn off</Button></>}>
        <p className="mb-3 text-muted">Enter a current code to confirm.</p>
        <Input inputMode="numeric" placeholder="123 456" value={code} onChange={(e) => setCode(e.target.value)} className="text-center font-mono text-[16px] tracking-widest" />
        {error && <div className="mt-2 text-[12.5px] text-danger">{error}</div>}
      </Dialog>
    </>
  );
}
