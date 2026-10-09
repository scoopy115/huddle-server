import { useCallback, useEffect, useState } from "react";
import { AlertCircle, ArrowLeft, Calendar, Check, CheckCircle2, Circle, Clock, Loader2, RotateCw, Timer, Trash2, Users } from "lucide-react";
import { api, errorMessage } from "@/lib/api";
import type { MeetingDetail, StageName } from "@/types/engine";
import { STAGES } from "@/types/engine";
import { fmtClock, fmtDate, fmtDuration, fmtTime } from "@/lib/format";
import { Link, navigate } from "@/lib/router";
import { cn, speakerColor } from "@/lib/utils";
import { Badge, Button, DangerDialog, SectionTitle, Spinner } from "@/components/ui";

const LABELS: Partial<Record<StageName, string>> = { preprocessing: "Audio", transcribing: "Transcript", diarizing: "Speakers", identifying_speakers: "Voices", refining: "Feedback", summarizing: "Notes", extracting_actions: "Action items", indexing: "Index" };

export function MeetingPage({ id }: { id: string }) {
  const [d, setD] = useState<MeetingDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const load = useCallback(() => api.meeting(id).then((x) => { setD(x); setError(null); }).catch((e) => setError(errorMessage(e))), [id]);
  useEffect(() => { load(); }, [load]);
  const processing = d?.job && (d.job.state === "running" || d.job.state === "queued");
  useEffect(() => { if (!processing) return; const t = setInterval(load, 1500); return () => clearInterval(t); }, [processing, load]);
  if (error && !d) return <div className="text-danger">{error}</div>;
  if (!d) return <Spinner />;
  const m = d.meeting;
  const names = new Map(d.speakers.map((s) => [s.id, s]));
  return (
    <>
      <div className="mb-3 flex items-center gap-2">
        <Link to="/meetings" className="inline-flex h-7 items-center gap-1 rounded-lg px-2 text-[12.5px] text-muted hover:bg-fg/[0.05] hover:text-fg"><ArrowLeft className="h-3.5 w-3.5" /> Meetings</Link>
        <div className="flex-1" />
        {d.audioPath && !processing && <Button size="sm" variant="ghost" onClick={async () => { await api.deleteAudio(id); load(); }}>Delete audio only</Button>}
        <Button size="sm" variant="ghost" onClick={() => setDeleting(true)}><Trash2 className="h-3.5 w-3.5 text-danger" /> Delete</Button>
      </div>
      <h1 className="selectable mb-2 font-display text-[26px] font-bold leading-tight tracking-tight">{m.title}</h1>
      <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-[12.5px] text-muted">
        <span className="inline-flex items-center gap-1.5"><Calendar className="h-3.5 w-3.5" />{fmtDate(m.startedAt)}</span>
        <span className="inline-flex items-center gap-1.5"><Clock className="h-3.5 w-3.5" />{fmtClock(m.startedAt)}</span>
        {m.durationSec ? <span className="inline-flex items-center gap-1.5"><Timer className="h-3.5 w-3.5" />{fmtDuration(m.durationSec)}</span> : null}
        {m.mode === "interview" && <Badge>Interview</Badge>}
      </div>
      {d.speakers.length > 0 && (
        <div className="mb-4 flex flex-wrap gap-1.5">
          {d.speakers.map((s) => { const c = speakerColor(s.colorIndex); const n = s.displayName || s.speakerName || s.label; return <span key={s.id} className={cn("inline-flex items-center gap-1.5 rounded-full border border-transparent px-2.5 py-1 text-[12.5px] font-medium", c.bg, c.text)}><Users className="h-3 w-3" />{n}</span>; })}
        </div>
      )}
      {d.audioPath && <audio controls preload="none" className="mb-4 w-full" src={`/engine/meetings/${encodeURIComponent(id)}/audio`} />}
      {error && <div className="mb-3 text-[12.5px] text-danger">{error}</div>}

      {d.job && d.job.state !== "ready" && (
        <div className="panel mb-4 p-4">
          <div className="mb-2 text-[13px] font-semibold">{d.job.state === "queued" ? "Waiting" : d.job.state === "running" ? "Processing" : "Needs attention"}</div>
          <ol className="flex flex-col gap-1.5">
            {STAGES.filter((s) => LABELS[s] && !(d.job!.stages[s]?.status === "skipped" && !d.job!.stages[s]?.error)).map((s) => {
              const st = d.job!.stages[s]?.status ?? "pending"; const prog = d.job!.stages[s]?.progress;
              return (
                <li key={s} className="flex items-center gap-2.5 text-[13px]">
                  {st === "done" && <Check className="h-3.5 w-3.5 text-emerald-600" />}{st === "running" && <Loader2 className="h-3.5 w-3.5 animate-spin text-accent" />}{st === "failed" && <AlertCircle className="h-3.5 w-3.5 text-danger" />}{(st === "pending" || st === "skipped") && <Circle className="h-3.5 w-3.5 text-muted/40" />}
                  <span className={cn(st === "pending" && "text-muted")}>{LABELS[s]}</span>
                  {st === "running" && prog != null && <span className="font-mono text-[11.5px] text-accent">{Math.round(prog * 100)}%</span>}
                  {d.job!.stages[s]?.detail && st !== "pending" && <span className="truncate text-[11px] text-muted">{d.job!.stages[s]!.detail}</span>}
                  {st === "failed" && <span className="text-[12px] text-danger">{d.job!.stages[s]?.error}</span>}
                  {st === "failed" && !processing && <Button size="sm" className="ml-auto" onClick={async () => { await api.retryStage(id, s); load(); }}><RotateCw className="h-3 w-3" /> Retry</Button>}
                </li>
              );
            })}
          </ol>
          {processing && <Button size="sm" variant="ghost" className="mt-2" onClick={async () => { await api.cancelProcessing(id); setTimeout(load, 800); }}>Cancel</Button>}
        </div>
      )}

      {d.summary && <section className="mb-6"><SectionTitle>Summary</SectionTitle><p className="selectable whitespace-pre-wrap text-[14px] leading-[1.65] text-fg/90">{d.summary.summary}</p></section>}
      {d.questions.length > 0 && (
        <section className="mb-6"><SectionTitle>Questions</SectionTitle>
          <ol className="selectable flex flex-col gap-4">{d.questions.map((q, i) => (
            <li key={q.id} className="flex gap-3"><span className="mt-[2px] w-5 shrink-0 text-right font-mono text-[11px] text-muted">{i + 1}</span>
              <div className="min-w-0 flex-1"><p className="text-[14px] font-semibold leading-snug">{q.question}</p><p className="mt-1 whitespace-pre-wrap text-[13.5px] leading-[1.6] text-fg/85">{q.answer}</p>{q.answeredBy && <div className="mt-1 text-[11.5px] text-muted">{q.answeredBy}</div>}</div></li>))}
          </ol>
        </section>
      )}
      {d.topics.length > 0 && <section className="mb-6"><SectionTitle>Topics</SectionTitle><ul className="selectable flex flex-col gap-1.5">{d.topics.map((t) => <li key={t.id} className="text-[13.5px]"><span className="font-medium">{t.title}</span>{t.summary && <span className="text-fg/70"> — {t.summary}</span>}</li>)}</ul></section>}
      {d.decisions.length > 0 && <section className="mb-6"><SectionTitle>Decisions</SectionTitle><ul className="selectable flex flex-col gap-1.5">{d.decisions.map((x) => <li key={x.id} className="flex items-start gap-2 text-[13.5px]"><CheckCircle2 className="mt-[3px] h-3.5 w-3.5 shrink-0 text-emerald-600" />{x.text}</li>)}</ul></section>}
      {d.actionItems.length > 0 && <section className="mb-6"><SectionTitle>Action items</SectionTitle><ul className="selectable flex flex-col gap-1.5">{d.actionItems.map((a) => <li key={a.id} className="flex items-start gap-2 text-[13.5px]"><Circle className="mt-[3px] h-3.5 w-3.5 shrink-0 text-muted" /><span>{a.text}<span className="ml-2 text-[12px] text-muted">{a.owner ?? "Unassigned"}{a.dueDate ? ` · ${a.dueDate}` : ""}</span></span></li>)}</ul></section>}
      {d.segments.length > 0 && (
        <section className="mb-6"><SectionTitle>Transcript</SectionTitle>
          <div className="selectable flex flex-col gap-2">{d.segments.map((s) => { const sp = s.meetingSpeakerId != null ? names.get(s.meetingSpeakerId) : undefined; const c = speakerColor(sp?.colorIndex ?? 0); return (
            <div key={s.id} className="flex gap-3 text-[13.5px]"><span className="w-12 shrink-0 pt-[2px] font-mono text-[11px] text-muted">{fmtTime(s.start)}</span><div><span className={cn("mr-2 font-medium", c.text)}>{s.speakerName ?? "Speaker"}</span><span className="text-fg/85">{s.text}</span></div></div>); })}</div>
        </section>
      )}
      <DangerDialog open={deleting} onClose={() => setDeleting(false)} title="Delete this meeting?" confirmLabel="Delete meeting" seconds={3} onConfirm={async () => { await api.deleteMeeting(id); navigate("/meetings"); }}>
        Audio, transcript and notes of “{m.title}” are removed from the server. The client that sent it keeps its own copy.
      </DangerDialog>
    </>
  );
}
