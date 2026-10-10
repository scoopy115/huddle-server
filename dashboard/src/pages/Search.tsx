// Ported from the Huddle desktop app.
import { useEffect, useState } from "react";
import { MessageSquareText, Search as SearchIcon } from "lucide-react";
import { api, errorMessage } from "@/lib/api";
import type { AskResult, SearchHit } from "@/types/engine";
import { fmtDate, fmtTime } from "@/lib/format";
import { navigate } from "@/lib/router";
import { cn } from "@/lib/utils";
import { BrandMark, Button, EmptyState, Input, Spinner } from "@/components/ui";

export function Search({ initialQuery, nonce }: { initialQuery?: string; nonce?: number }) {
  const [q, setQ] = useState(initialQuery ?? "");
  const [hits, setHits] = useState<SearchHit[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [ask, setAsk] = useState<AskResult | null>(null);
  const [asking, setAsking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // A new query arriving from ⌘K (or elsewhere) replaces the current one.
  useEffect(() => { if (initialQuery != null) { setQ(initialQuery); setAsk(null); } }, [initialQuery, nonce]);

  useEffect(() => {
    if (!q.trim()) { setHits(null); return; }
    const t = setTimeout(async () => {
      setLoading(true);
      try { setHits(await api.search(q)); setError(null); } catch (e) { setError(errorMessage(e)); } finally { setLoading(false); }
    }, 220);
    return () => clearTimeout(t);
  }, [q]);

  const doAsk = async () => {
    if (!q.trim()) return;
    setAsking(true);
    setAsk(null);
    try { setAsk(await api.askAll(q)); } catch (e) { setError(errorMessage(e)); } finally { setAsking(false); }
  };

  const grouped = (hits ?? []).reduce<Record<string, SearchHit[]>>((acc, h) => { (acc[h.meetingId] ??= []).push(h); return acc; }, {});
  const empty = !q.trim();

  return (
    <div className="flex flex-col">
      <div className="relative flex-1">
        {/* The search field keeps its place in the tree in both layouts, so typing the first
            character does not remount it and steal focus. */}
        <div className={cn("mx-auto flex w-full max-w-[860px] flex-col", empty ? "min-h-[60vh] items-center justify-center py-10" : "")}>
          {empty ? (
            <div className="relative mb-6 flex flex-col items-center text-center">
              <BrandMark className="pointer-events-none absolute left-1/2 top-1/2 h-[300px] w-[300px] -translate-x-1/2 -translate-y-1/2 text-accent opacity-[0.045] dark:opacity-[0.07]" />
              <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-accent text-white glow-accent"><SearchIcon className="h-6 w-6 text-white" /></div>
              <div className="font-display text-[17px] font-bold tracking-tight">Search your meeting memory</div>
              <p className="mt-1 max-w-sm text-[13px] text-muted">Full-text search across every transcript, or ask a question. Click a result to jump to that moment in the recording.</p>
            </div>
          ) : false}
          <div className={cn("flex w-full gap-2", empty && "max-w-[560px]")}>
            <div className="relative flex-1">
              <SearchIcon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
              <Input autoFocus className="h-10 pl-9 text-[14px]" placeholder="Search all transcripts, or ask a question…" value={q}
                onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === "Enter" && doAsk()} />
            </div>
            <Button variant="primary" className="h-10" loading={asking} onClick={doAsk} disabled={empty}><MessageSquareText className="h-4 w-4" /> Ask</Button>
          </div>

          {!empty && (
            <div className="w-full">
              {error && <div className="mt-3 text-[12.5px] text-danger">{error}</div>}

              {ask && (
                <div className="selectable panel mt-4 p-4">
                  <div className="mb-1 font-display text-[11.5px] font-bold uppercase tracking-wider text-muted">Answer · local AI</div>
                  <p className="whitespace-pre-wrap text-[13.5px] leading-relaxed">{ask.answer}</p>
                  {ask.sources.length > 0 && (
                    <div className="mt-3 flex flex-wrap gap-1.5">
                      {ask.sources.slice(0, 8).map((s) => (
                        <button key={s.segmentId} className="rounded-md border border-border px-2 py-0.5 text-[11px] text-muted hover:border-accent/50 hover:text-accent"
                          onClick={() => navigate(`/meetings/${encodeURIComponent(s.meetingId)}?t=${s.start}&seg=${s.segmentId}`)}>
                          {s.meetingTitle} · {fmtTime(s.start)}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}

              <div className="mt-5">
                {loading && !hits && <div className="flex justify-center py-8"><Spinner /></div>}
                {hits && hits.length === 0 && <EmptyState title="No matches" body={`Nothing in your transcripts matches “${q}”.`} />}
                {Object.entries(grouped).map(([mid, list]) => (
                  <section key={mid} className="mb-5">
                    <button className="mb-1.5 flex items-baseline gap-2 px-1 text-left" onClick={() => navigate(`/meetings/${encodeURIComponent(mid)}`)}>
                      <span className="text-[13.5px] font-semibold">{list[0].meetingTitle}</span>
                      <span className="text-[12px] text-muted">{fmtDate(list[0].meetingStartedAt)}</span>
                      <span className="text-[11px] text-muted">{list.length} match{list.length === 1 ? "" : "es"}</span>
                    </button>
                    <div className="panel overflow-hidden">
                      {list.map((h) => (
                        <button key={h.segmentId} className="flex w-full items-start gap-3 border-b border-border px-4 py-2.5 text-left last:border-b-0 hover:bg-fg/[0.03]"
                          onClick={() => navigate(`/meetings/${encodeURIComponent(h.meetingId)}?t=${h.start}&seg=${h.segmentId}`)}>
                          <span className="w-[120px] shrink-0 truncate text-[12px] font-medium text-fg/70">{h.speakerName ?? "Speaker"} <span className="font-mono text-muted">{fmtTime(h.start)}</span></span>
                          <span className="text-[13px] text-fg/85" dangerouslySetInnerHTML={{ __html: escapeSnippet(h.snippet) }} />
                        </button>
                      ))}
                    </div>
                  </section>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function escapeSnippet(s: string) {
  const esc = s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return esc.replace(/\[([^\]]+)\]/g, '<mark class="rounded bg-accent-soft px-0.5 text-accent">$1</mark>');
}
