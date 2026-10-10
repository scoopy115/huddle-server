import { useCallback, useEffect, useMemo, useState } from "react";
import { Activity, CheckSquare, Folder, KeyRound, LogOut, Menu, Mic, Search as SearchIcon, Settings as SettingsIcon, ShieldCheck, Sliders, UserRound, Users as UsersIcon, LayoutDashboard, X, type LucideIcon } from "lucide-react";
import { api, errorMessage, setUnauthorizedHandler, type Me } from "@/lib/api";
import type { Meeting } from "@/types/engine";
import { AiContext } from "@/lib/ai";
import { Link, navigate, useRoute } from "@/lib/router";
import { cn } from "@/lib/utils";
import { Button, Dialog, Spinner } from "@/components/ui";
import { CommandPalette } from "@/components/CommandPalette";
import logo from "@/assets/huddle-logo.svg";
import { Login, Register, Setup } from "@/pages/Auth";
import { Overview } from "@/pages/Overview";
import { Clients } from "@/pages/Clients";
import { Meetings } from "@/pages/Meetings";
import { MeetingPage } from "@/pages/Meeting";
import { Models } from "@/pages/Models";
import { Settings } from "@/pages/Settings";
import { Account } from "@/pages/Account";
import { Users } from "@/pages/Users";
import { Onboarding } from "@/pages/Onboarding";
import { Record } from "@/pages/Record";
import { Projects } from "@/pages/Projects";
import { ProjectPage } from "@/pages/Project";
import { ActionItems } from "@/pages/ActionItems";
import { Processes } from "@/pages/Processes";
import { Search } from "@/pages/Search";

const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);
const modKey = isMac ? "⌘" : "Ctrl+";
// Touch devices have no modifier keys: no shortcut hints there.
const hasKeyboard = typeof window !== "undefined" && !window.matchMedia("(pointer: coarse)").matches;

type Nav = { to: string; label: string; icon: LucideIcon; admin?: boolean; hint?: string; match?: (p: string) => boolean };
const NAV: Nav[] = [
  { to: "/meetings", label: "Meetings", icon: Mic, hint: `${modKey}1`, match: (p) => p.startsWith("/meetings") },
  { to: "/projects", label: "Projects", icon: Folder, hint: `${modKey}2`, match: (p) => p.startsWith("/projects") },
  { to: "/actions", label: "Action Items", icon: CheckSquare, hint: `${modKey}3` },
  { to: "/search", label: "Search", icon: SearchIcon, hint: `${modKey}K` },
  { to: "/processes", label: "Processes", icon: Activity, admin: true, hint: `${modKey}4` },
  { to: "/", label: "Overview", icon: LayoutDashboard, admin: true, hint: `${modKey}5`, match: (p) => p === "/" },
  { to: "/clients", label: "Clients", icon: KeyRound, hint: `${modKey}6` },
  { to: "/users", label: "Users", icon: UsersIcon, admin: true, hint: `${modKey}7` },
  { to: "/models", label: "Models", icon: Sliders, admin: true, hint: `${modKey}8` },
  { to: "/settings", label: "Settings", icon: SettingsIcon, admin: true, hint: `${modKey},` },
  { to: "/account", label: "Account", icon: UserRound, hint: `${modKey}9` },
];

function NavItem({ item, active, count, onNavigate }: { item: Nav; active: boolean; count?: number; onNavigate?: () => void }) {
  return (
    <Link to={item.to} onClick={onNavigate} className={cn("pressable group relative flex w-full items-center gap-2.5 rounded-lg px-2.5 py-[7px] text-[13px] font-medium",
      active ? "bg-surface text-fg shadow-[0_1px_2px_rgb(28_25_24/0.06)] dark:bg-fg/[0.07] dark:shadow-none" : "text-fg/65 hover:bg-fg/[0.04] hover:text-fg")}>
      <span className={cn("absolute -left-2 top-1/2 h-[14px] w-[3px] -translate-y-1/2 rounded-full bg-accent transition-opacity", active ? "opacity-100" : "opacity-0")} />
      <item.icon className={cn("h-4 w-4", active ? "text-accent" : "opacity-70")} />
      <span className="flex-1 text-left">{item.label}</span>
      {count ? <span className={cn("rounded-full px-1.5 text-[11px] tabular-nums", active ? "bg-accent-soft text-accent" : "bg-fg/[0.07] text-muted")}>{count}</span> : null}
      {item.hint && hasKeyboard && !count ? <kbd className="rounded border border-border px-1 font-sans text-[10.5px] text-muted/80 opacity-0 transition-opacity group-hover:opacity-100">{item.hint}</kbd> : null}
    </Link>
  );
}

export function App() {
  const path = useRoute();
  const params = new URLSearchParams(window.location.search);
  const [me, setMe] = useState<Me | null | undefined>(undefined);
  const [needsSetup, setNeedsSetup] = useState<boolean | null>(null);
  const [name, setName] = useState("Huddle Server");
  const [onboarded, setOnboarded] = useState<boolean | null>(null);
  const [totpAsk, setTotpAsk] = useState(false);
  const [ai, setAi] = useState({ ready: false, model: null as string | null });
  const [meetings, setMeetings] = useState<Meeting[] | null>(null);
  const [palette, setPalette] = useState(false);
  const [drawer, setDrawer] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const [s, m] = await Promise.all([api.setupState(), api.me()]);
      setNeedsSetup(s.needsSetup); setName(s.name); setMe(m); setError(null);
      if (m.user?.role === "admin") setOnboarded((await api.onboarding()).completed); else setOnboarded(true);
      if (m.user) api.capabilities().then((c) => setAi({ ready: !!c.llm, model: c.llm })).catch(() => {});
    } catch (e) { setError(errorMessage(e)); setMe(null); }
  }, []);
  const refreshMeetings = useCallback(() => api.meetings().then(setMeetings).catch(() => {}), []);
  useEffect(() => { refresh(); }, [refresh]);
  useEffect(() => { setUnauthorizedHandler(() => setMe((m) => ({ user: null, totpRequired: false, registration: m?.registration ?? "invite" }))); }, []);
  useEffect(() => { document.title = `${name} · Huddle`; }, [name]);
  useEffect(() => { if (me?.user) refreshMeetings(); }, [me?.user, refreshMeetings, path]);
  const anyProcessing = useMemo(() => meetings?.some((m) => m.status === "processing") ?? false, [meetings]);
  useEffect(() => { if (!anyProcessing) return; const t = setInterval(refreshMeetings, 2500); return () => clearInterval(t); }, [anyProcessing, refreshMeetings]);

  // Keyboard: ⌘K palette, ⌘1–4 sections, ⌘, settings
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey)) return;
      const k = e.key.toLowerCase();
      const map: Record<string, string> = { "1": "/meetings", "2": "/projects", "3": "/actions", "4": "/processes", "5": "/", "6": "/clients", "7": "/users", "8": "/models", "9": "/account", ",": "/settings" };
      if (k === "k") { e.preventDefault(); setPalette((p) => !p); }
      else if (map[k]) { e.preventDefault(); navigate(map[k]); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  if (me === undefined || me === null || needsSetup === null) return <div className="flex h-full items-center justify-center">{error ? <div className="text-danger">{error}</div> : <Spinner />}</div>;
  if (needsSetup) return <Setup name={name} onDone={refresh} />;
  if (!me.user) {
    if (path.startsWith("/join/")) return <Register name={name} invite={decodeURIComponent(path.slice("/join/".length))} onDone={refresh} />;
    if (path === "/register" && me.registration === "open") return <Register name={name} onDone={refresh} />;
    return <Login name={name} totpRequired={me.totpRequired} registrationOpen={me.registration === "open"} onDone={refresh} />;
  }

  const isAdmin = me.user.role === "admin";
  if (isAdmin && onboarded === false) return <Onboarding onDone={() => { setOnboarded(true); navigate("/"); }} />;
  const askTotp = !me.user.totpEnabled && me.user.totpPrompted === false && !totpAsk;
  const dismissTotp = async () => { setTotpAsk(true); await api.markTotpPrompted().catch(() => {}); };
  const nav = NAV.filter((n) => isAdmin || !n.admin);
  const logout = async () => { await api.logout(); refresh(); navigate("/"); };
  const openActions = meetings?.reduce((n, m) => n + m.openActionCount, 0) ?? 0;
  const running = meetings?.filter((m) => m.status === "processing").length ?? 0;
  const changed = () => { refreshMeetings(); };

  const seek = params.get("t") ? Number(params.get("t")) : undefined;
  const seg = params.get("seg") ? Number(params.get("seg")) : undefined;
  const page = path.startsWith("/meetings/") ? <MeetingPage id={decodeURIComponent(path.slice("/meetings/".length))} seek={seek} segmentId={seg} nonce={seek} me={me} onChanged={changed} />
    : path === "/meetings" ? <Meetings meetings={meetings} onChanged={changed} />
    : path === "/record" ? <Record />
    : path.startsWith("/projects/") ? <ProjectPage id={decodeURIComponent(path.slice("/projects/".length))} onChanged={changed} />
    : path === "/projects" ? <Projects />
    : path === "/actions" ? <ActionItems onChanged={changed} />
    : path === "/search" ? <Search initialQuery={params.get("q") ?? undefined} nonce={seek} />
    : path === "/processes" && isAdmin ? <Processes onChanged={changed} />
    : path === "/clients" ? <Clients isAdmin={isAdmin} />
    : path === "/users" && isAdmin ? <Users meId={me.user.id} />
    : path === "/models" && isAdmin ? <Models />
    : path === "/settings" && isAdmin ? <Settings onName={setName} />
    : path === "/account" ? <Account me={me} onChanged={refresh} />
    : isAdmin ? <Overview /> : <Meetings meetings={meetings} onChanged={changed} />;
  const active = nav.find((n) => (n.match ? n.match(path) : path.startsWith(n.to)))?.to ?? (isAdmin ? "/" : "/meetings");
  const recording = path === "/record";

  const sidebar = (
    <>
      <div className="pointer-events-none absolute inset-x-0 top-0 h-40 bg-[radial-gradient(70%_60%_at_30%_0%,rgb(var(--accent)/0.12),transparent_70%)]" />
      <div className="relative flex items-center justify-between px-4 pb-8 pt-7 md:justify-center">
        <Link to="/meetings" onClick={() => setDrawer(false)} title="Meetings"><img src={logo} alt="Huddle" className="h-9 w-auto select-none" draggable={false} /></Link>
        <button className="md:hidden" onClick={() => setDrawer(false)} aria-label="Close menu"><X className="h-5 w-5 text-muted" /></button>
      </div>
      <nav className="relative flex flex-col gap-0.5 px-3">
        {nav.map((n) => <NavItem key={n.to} item={n} active={active === n.to} count={n.to === "/actions" ? openActions : n.to === "/processes" ? running : undefined} onNavigate={() => setDrawer(false)} />)}
      </nav>
      <div className="flex-1" />
      <div className="relative px-3 pb-3">
        <button onClick={() => { setDrawer(false); navigate("/record"); }} className={cn("pressable flex w-full items-center justify-center gap-2 rounded-full bg-record px-3 py-2.5 text-[13px] font-semibold text-white glow-accent", !recording && "hover:brightness-110")}>
          <Mic className="h-4 w-4 text-white" /> New Recording
        </button>
        <div className="mt-3 border-t border-border pt-3 text-[12px] text-muted">
          <div className="truncate text-fg/80">{me.user.name || me.user.email}</div>
          <div className="text-[11px]">{isAdmin ? "Admin" : "User"}</div>
          <button className="mt-1.5 inline-flex items-center gap-1 hover:text-fg" onClick={logout}><LogOut className="h-3 w-3" /> Log out</button>
        </div>
      </div>
    </>
  );

  return (
    <AiContext.Provider value={ai}>
      <div className="flex h-full flex-col md:flex-row">
        {/* Phones and small tablets: a top bar with a menu button; the sidebar becomes a drawer. */}
        <header className="flex h-[52px] shrink-0 items-center justify-between border-b border-border bg-sidebar px-4 md:hidden">
          <Link to="/meetings" title="Meetings"><img src={logo} alt="Huddle" className="h-7 w-auto" draggable={false} /></Link>
          <button onClick={() => setDrawer(true)} aria-label="Menu" className="rounded-lg p-1.5 hover:bg-fg/[0.06]"><Menu className="h-5 w-5" /></button>
        </header>
        {drawer && <div className="fixed inset-0 z-40 bg-black/30 md:hidden" onClick={() => setDrawer(false)} />}
        <aside className={cn("fixed inset-y-0 left-0 z-50 flex w-[260px] flex-col border-r border-border bg-sidebar transition-transform md:static md:z-auto md:h-full md:w-[224px] md:shrink-0 md:translate-x-0", drawer ? "translate-x-0" : "-translate-x-full")}>
          {sidebar}
        </aside>
        <main className="flex-1 overflow-y-auto">
          <div className="mx-auto min-h-full max-w-[860px] px-4 py-5 md:px-6 md:py-6">{page}</div>
        </main>
        <CommandPalette open={palette} onClose={() => setPalette(false)} meetings={meetings ?? []} />
        <Dialog open={askTotp} onClose={dismissTotp} title="Protect this account?" width={440}
          footer={<><Button variant="ghost" onClick={dismissTotp}>Later</Button><Button variant="primary" onClick={async () => { await dismissTotp(); navigate("/account?totp=1"); }}><ShieldCheck className="h-3.5 w-3.5" /> Set up now</Button></>}>
          <p className="text-muted">Two-factor authentication asks for a code from an authenticator app at every login. It takes a minute to set up under Account.</p>
        </Dialog>
      </div>
    </AiContext.Provider>
  );
}
