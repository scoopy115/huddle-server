import { useEffect, useState } from "react";
import { Clock, Search, Timer, Users } from "lucide-react";
import { api, errorMessage } from "@/lib/api";
import type { Meeting } from "@/types/engine";
import { fmtClock, fmtDuration, fmtRelativeDay } from "@/lib/format";
import { Link } from "@/lib/router";
import { Badge, Input, Spinner } from "@/components/ui";

const STAGE_WORD: Record<string, string> = { preprocessing: "Preparing audio", transcribing: "Transcribing", diarizing: "Detecting speakers", identifying_speakers: "Checking voices", summarizing: "Writing notes", indexing: "Indexing" };

export function statusBadge(m: Meeting) {
  if (m.status === "processing") return <Badge tone="neutral"><Spinner className="h-3 w-3 text-accent" /> {m.jobState === "queued" ? "Waiting" : STAGE_WORD[m.jobStage ?? ""] ?? "Processing"}{m.jobProgress ? ` ${Math.round(m.jobProgress * 100)}%` : ""}</Badge>;
  if (m.status === "failed") return <Badge tone="bad">Failed</Badge>;
  if (m.status === "saved") return <Badge>Saved</Badge>;
  return null;
}

export function Meetings() {
  const [list, setList] = useState<Meeting[] | null>(null);
  const [q, setQ] = useState("");
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    const load = () => api.meetings(q.trim() || undefined).then(setList).catch((e) => setError(errorMessage(e)));
    load();
    const t = setInterval(load, 4000);
    return () => clearInterval(t);
  }, [q]);
  const groups: { label: string; items: Meeting[] }[] = [];
  for (const m of list ?? []) {
    const label = fmtRelativeDay(m.startedAt);
    const g = groups[groups.length - 1];
    if (g && g.label === label) g.items.push(m); else groups.push({ label, items: [m] });
  }
  return (
    <>
      <div className="mb-4 flex items-center justify-between gap-3">
        <h2 className="font-display text-[22px] font-bold tracking-tight">Meetings</h2>
        <div className="relative w-[260px]"><Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted" /><Input className="pl-8" placeholder="Search" value={q} onChange={(e) => setQ(e.target.value)} /></div>
      </div>
      {error && <div className="mb-3 text-[12.5px] text-danger">{error}</div>}
      {!list ? <Spinner /> : list.length === 0 ? <div className="text-[13px] text-muted">No meetings yet. They appear here when a Huddle app sends a recording.</div> : groups.map((g) => (
        <section key={g.label} className="mb-5">
          <h3 className="mb-2 font-display text-[11.5px] font-bold uppercase tracking-wider text-muted">{g.label}</h3>
          <div className="panel">
            {g.items.map((m) => (
              <Link key={m.id} to={`/meetings/${encodeURIComponent(m.id)}`} className="flex items-center gap-4 border-b border-border px-4 py-3 last:border-b-0 hover:bg-fg/[0.03]">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2"><span className="truncate font-display text-[14.5px] font-bold tracking-tight">{m.title}</span>{statusBadge(m)}{m.mode === "interview" && <Badge>Interview</Badge>}</div>
                  <div className="mt-1 flex flex-wrap gap-x-3.5 text-[12px] text-muted">
                    <span className="inline-flex items-center gap-1"><Clock className="h-3 w-3" />{fmtClock(m.startedAt)}</span>
                    {m.durationSec ? <span className="inline-flex items-center gap-1"><Timer className="h-3 w-3" />{fmtDuration(m.durationSec)}</span> : null}
                    {m.speakerCount ? <span className="inline-flex items-center gap-1 truncate"><Users className="h-3 w-3" />{m.participants.length ? m.participants.join(", ") : `${m.speakerCount} speakers`}</span> : null}
                  </div>
                  {m.summaryPreview && <div className="mt-1 line-clamp-1 text-[12.5px] text-fg/60">{m.summaryPreview}</div>}
                </div>
              </Link>
            ))}
          </div>
        </section>
      ))}
    </>
  );
}
