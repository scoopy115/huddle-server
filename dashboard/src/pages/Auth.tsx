import type React from "react";
import { useEffect, useState } from "react";
import { ShieldCheck } from "lucide-react";
import { api, errorMessage } from "@/lib/api";
import { Link } from "@/lib/router";
import { Button, Input } from "@/components/ui";
import { CodeInput } from "@/components/CodeInput";
import { Wordmark } from "@/components/Wordmark";

function Frame({ name, title, children }: { name: string; title: string; children: React.ReactNode }) {
  return (
    <div className="flex h-full items-center justify-center p-6">
      <div className="panel w-full max-w-[380px] p-6">
        <Wordmark className="mb-5 h-7 w-auto" />
        <div className="mb-4"><div className="page-title">{title}</div><div className="text-[12px] text-muted">{name}</div></div>
        {children}
      </div>
    </div>
  );
}

export function Setup({ name, onDone }: { name: string; onDone: () => void }) {
  const [who, setWho] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async () => {
    setBusy(true); setError(null);
    try { await api.setup(who, email, password); onDone(); } catch (e) { setError(errorMessage(e)); } finally { setBusy(false); }
  };
  return (
    <Frame name={name} title="Create the admin account">
      <form className="flex flex-col gap-3" onSubmit={(e) => { e.preventDefault(); submit(); }}>
        <Input placeholder="Name" autoFocus autoComplete="name" value={who} onChange={(e) => setWho(e.target.value)} />
        <Input type="email" placeholder="E-mail address" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} />
        <Input type="password" placeholder="Password (at least 10 characters)" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} />
        <Input type="password" placeholder="Repeat password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
        {confirm && confirm !== password && <div className="text-[12.5px] text-danger">The passwords differ.</div>}
        {error && <div className="text-[12.5px] text-danger">{error}</div>}
        <Button type="submit" variant="primary" size="lg" loading={busy} disabled={!who.trim() || !email || password.length < 10 || confirm !== password}>Create account</Button>
      </form>
    </Frame>
  );
}

export function Register({ name, invite, onDone }: { name: string; invite?: string; onDone: () => void }) {
  const [who, setWho] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [valid, setValid] = useState<boolean | null>(invite ? null : true);
  const [pending, setPending] = useState(false);
  useEffect(() => {
    if (!invite) return;
    api.inviteState(invite).then((s) => { setValid(s.valid); if (s.email) setEmail(s.email); }).catch(() => setValid(false));
  }, [invite]);
  const submit = async () => {
    setBusy(true); setError(null);
    try { const r = await api.register(who, email, password, invite); if (r.pending) setPending(true); else onDone(); } catch (e) { setError(errorMessage(e)); } finally { setBusy(false); }
  };
  if (valid === false) return <Frame name={name} title="Invitation"><p className="text-[13px]">This invitation link is no longer valid. Ask for a new one.</p><Link to="/" className="mt-3 block text-[12.5px] text-muted hover:text-fg">Log in</Link></Frame>;
  if (pending) return <Frame name={name} title="Account requested"><p className="text-[13px]">An admin has to approve your account before you can log in.</p><Link to="/" className="mt-3 block text-[12.5px] text-muted hover:text-fg">Back</Link></Frame>;
  return (
    <Frame name={name} title={invite ? "You are invited — create your account" : "Create an account"}>
      <form className="flex flex-col gap-3" onSubmit={(e) => { e.preventDefault(); submit(); }}>
        <Input placeholder="Name" autoFocus autoComplete="name" value={who} onChange={(e) => setWho(e.target.value)} />
        <Input type="email" placeholder="E-mail address" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} />
        <Input type="password" placeholder="Password (at least 10 characters)" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} />
        <Input type="password" placeholder="Repeat password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
        {confirm && confirm !== password && <div className="text-[12.5px] text-danger">The passwords differ.</div>}
        {error && <div className="text-[12.5px] text-danger">{error}</div>}
        <Button type="submit" variant="primary" size="lg" loading={busy} disabled={!who.trim() || !email || password.length < 10 || confirm !== password || valid === null}>Create account</Button>
        {!invite && <p className="text-[11.5px] text-muted">An admin approves new accounts before they can log in.</p>}
        <Link to="/" className="text-[11.5px] text-muted hover:text-fg">Already have an account? Log in</Link>
      </form>
    </Frame>
  );
}

export function Login({ name, totpRequired, registrationOpen, onDone }: { name: string; totpRequired: boolean; registrationOpen?: boolean; onDone: () => void }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async () => {
    setBusy(true); setError(null);
    try {
      if (totpRequired) await api.loginTotp(code);
      else await api.login(email, password);
      onDone();
    } catch (e) { setError(errorMessage(e)); } finally { setBusy(false); }
  };
  return (
    <Frame name={name} title={totpRequired ? "Authenticator code" : "Log in"}>
      <form className="flex flex-col gap-3" onSubmit={(e) => { e.preventDefault(); submit(); }}>
        {totpRequired ? (
          <>
            <CodeInput autoFocus value={code} onChange={setCode} onComplete={() => submit()} />
            <div className="flex items-center gap-1.5 text-[11.5px] text-muted"><ShieldCheck className="h-3.5 w-3.5" /> The six-digit code from your authenticator app.</div>
          </>
        ) : (
          <>
            <Input type="email" placeholder="E-mail address" autoFocus autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} />
            <Input type="password" placeholder="Password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
          </>
        )}
        {error && <div className="text-[12.5px] text-danger">{error}</div>}
        <Button type="submit" variant="primary" size="lg" loading={busy} disabled={totpRequired ? code.replace(/\s/g, "").length < 6 : !email || !password}>{totpRequired ? "Continue" : "Log in"}</Button>
        {totpRequired && <button type="button" className="text-[11.5px] text-muted hover:text-fg" onClick={async () => { await api.logout(); onDone(); }}>Use another account</button>}
        {!totpRequired && registrationOpen && <Link to="/register" className="text-[11.5px] text-muted hover:text-fg">Create an account</Link>}
      </form>
    </Frame>
  );
}
