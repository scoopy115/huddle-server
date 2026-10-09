import { useCallback, useEffect, useState } from "react";
import { Activity, FileAudio, KeyRound, LogOut, Mic, Settings as SettingsIcon, Sliders, UserRound, Users as UsersIcon } from "lucide-react";
import { api, errorMessage, setUnauthorizedHandler, type Me } from "@/lib/api";
import { Link, navigate, useRoute } from "@/lib/router";
import { cn } from "@/lib/utils";
import { BrandMark, Spinner } from "@/components/ui";
import { Login, Register, Setup } from "@/pages/Auth";
import { Users } from "@/pages/Users";
import { Overview } from "@/pages/Overview";
import { Clients } from "@/pages/Clients";
import { Meetings } from "@/pages/Meetings";
import { MeetingPage } from "@/pages/Meeting";
import { Models } from "@/pages/Models";
import { Settings } from "@/pages/Settings";
import { Account } from "@/pages/Account";
import { Onboarding } from "@/pages/Onboarding";
import { Record } from "@/pages/Record";

const NAV = [
  { to: "/", label: "Overview", icon: Activity, admin: true },
  { to: "/record", label: "Record", icon: Mic, admin: false },
  { to: "/meetings", label: "Meetings", icon: FileAudio, admin: false },
  { to: "/clients", label: "Clients", icon: KeyRound, admin: false },
  { to: "/users", label: "Users", icon: UsersIcon, admin: true },
  { to: "/models", label: "Models", icon: Sliders, admin: true },
  { to: "/settings", label: "Settings", icon: SettingsIcon, admin: true },
  { to: "/account", label: "Account", icon: UserRound, admin: false },
];

export function App() {
  const path = useRoute();
  const [me, setMe] = useState<Me | null | undefined>(undefined);
  const [needsSetup, setNeedsSetup] = useState<boolean | null>(null);
  const [name, setName] = useState("Huddle Server");
  const [onboarded, setOnboarded] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const [s, m] = await Promise.all([api.setupState(), api.me()]);
      setNeedsSetup(s.needsSetup); setName(s.name); setMe(m); setError(null);
      if (m.user?.role === "admin") setOnboarded((await api.onboarding()).completed); else setOnboarded(true);
    } catch (e) { setError(errorMessage(e)); setMe(null); }
  }, []);
  useEffect(() => { refresh(); }, [refresh]);
  useEffect(() => { setUnauthorizedHandler(() => setMe((m) => ({ user: null, totpRequired: false, registration: m?.registration ?? "invite" }))); }, []);
  useEffect(() => { document.title = `${name} · Huddle`; }, [name]);

  if (me === undefined || me === null || needsSetup === null) return <div className="flex h-full items-center justify-center">{error ? <div className="text-danger">{error}</div> : <Spinner />}</div>;
  if (needsSetup) return <Setup name={name} onDone={refresh} />;
  if (!me.user) {
    if (path.startsWith("/join/")) return <Register name={name} invite={decodeURIComponent(path.slice("/join/".length))} onDone={refresh} />;
    if (path === "/register" && me.registration === "open") return <Register name={name} onDone={refresh} />;
    return <Login name={name} totpRequired={me.totpRequired} registrationOpen={me.registration === "open"} onDone={refresh} />;
  }

  const isAdmin = me.user.role === "admin";
  if (isAdmin && onboarded === false) return <Onboarding onDone={() => { setOnboarded(true); navigate("/"); }} />;
  const nav = NAV.filter((n) => isAdmin || !n.admin);
  const logout = async () => { await api.logout(); refresh(); navigate("/"); };
  const page = path.startsWith("/meetings/") ? <MeetingPage id={decodeURIComponent(path.slice("/meetings/".length))} me={me} />
    : path === "/meetings" ? <Meetings />
    : path === "/record" ? <Record />
    : path === "/clients" ? <Clients isAdmin={isAdmin} />
    : path === "/users" && isAdmin ? <Users meId={me.user.id} />
    : path === "/models" && isAdmin ? <Models />
    : path === "/settings" && isAdmin ? <Settings onName={setName} />
    : path === "/account" ? <Account me={me} onChanged={refresh} />
    : isAdmin ? <Overview /> : <Meetings />;
  const active = nav.find((n) => (n.to === "/" ? path === "/" : path.startsWith(n.to)))?.to ?? (isAdmin ? "/" : "/meetings");

  return (
    <div className="flex h-full">
      <nav className="flex w-[210px] shrink-0 flex-col border-r border-border bg-sidebar/60">
        <div className="flex h-[56px] items-center gap-2 px-4"><BrandMark className="h-5 w-5 text-accent" /><span className="page-title truncate">{name}</span></div>
        <ul className="px-2">
          {nav.map((n) => (
            <li key={n.to}>
              <Link to={n.to} className={cn("relative mb-0.5 flex w-full items-center gap-2 rounded-lg px-2.5 py-[6px] text-[13px] transition-colors", active === n.to ? "bg-surface font-medium text-fg shadow-[0_1px_2px_rgb(28_25_24/0.06)] dark:bg-fg/[0.07] dark:shadow-none" : "text-fg/70 hover:bg-fg/[0.05]")}>
                <span className={cn("absolute -left-2 top-1/2 h-[14px] w-[3px] -translate-y-1/2 rounded-full bg-accent", active === n.to ? "opacity-100" : "opacity-0")} />
                <n.icon className="h-3.5 w-3.5 text-muted" />{n.label}
              </Link>
            </li>
          ))}
        </ul>
        <div className="flex-1" />
        <div className="border-t border-border px-4 py-3 text-[12px] text-muted">
          <div className="truncate text-fg/80">{me.user.name || me.user.email}</div>
          <div className="text-[11px]">{isAdmin ? "Admin" : "User"}</div>
          <button className="mt-1.5 inline-flex items-center gap-1 hover:text-fg" onClick={logout}><LogOut className="h-3 w-3" /> Log out</button>
        </div>
      </nav>
      <main className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-[860px] px-6 py-6">{page}</div>
      </main>
    </div>
  );
}
