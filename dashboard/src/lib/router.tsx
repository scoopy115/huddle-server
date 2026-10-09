import type React from "react";
import { useEffect, useState } from "react";

/** Minimal history router: the server returns index.html for every path. */
export function useRoute(): string {
  const [path, setPath] = useState(window.location.pathname);
  const [, setSearch] = useState(window.location.search);
  useEffect(() => {
    const onPop = () => { setPath(window.location.pathname); setSearch(window.location.search); };
    window.addEventListener("popstate", onPop);
    window.addEventListener("huddle:navigate", onPop);
    return () => { window.removeEventListener("popstate", onPop); window.removeEventListener("huddle:navigate", onPop); };
  }, []);
  return path;
}

export function navigate(path: string) {
  if (path === window.location.pathname + window.location.search) return;
  window.history.pushState({}, "", path);
  window.dispatchEvent(new Event("huddle:navigate"));
}

export function Link({ to, className, children, onClick }: { to: string; className?: string; children: React.ReactNode; onClick?: () => void }) {
  return (
    <a href={to} className={className} onClick={(e) => { if (e.metaKey || e.ctrlKey) return; e.preventDefault(); onClick?.(); navigate(to); }}>{children}</a>
  );
}
