import { useEffect, useMemo, useRef, useState } from "react";
import { FileAudio, Mic, Search as SearchIcon } from "lucide-react";
import type { Meeting, Project } from "@/types/engine";
import { api, errorMessage } from "@/lib/api";
import { navigate } from "@/lib/router";
import { Button, EmptyState, Input, Select, Spinner } from "@/components/ui";
import { MeetingGroups } from "@/components/MeetingList";

const ALL = "";
const NONE = "__none__";

export function Meetings({ meetings, onChanged }: { meetings: Meeting[] | null; onChanged: () => void }) {
  const [filter, setFilter] = useState("");
  const [project, setProject] = useState(ALL);
  const [projects, setProjects] = useState<Project[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const file = useRef<HTMLInputElement>(null);
  useEffect(() => { api.projects().then(setProjects).catch(() => {}); }, [meetings]);
  useEffect(() => { if (project && project !== NONE && !projects.some((p) => p.id === project)) setProject(ALL); }, [projects, project]);

  const list = useMemo(() => {
    const f = filter.toLowerCase();
    return (meetings ?? []).filter((m) =>
      (project === ALL || (project === NONE ? !m.projectId : m.projectId === project))
      && (!f || m.title.toLowerCase().includes(f) || m.participants.some((p) => p.toLowerCase().includes(f)) || (m.projectName ?? "").toLowerCase().includes(f)));
  }, [meetings, filter, project]);

  const importFile = async (f: File) => {
    setImporting(true); setError(null);
    try {
      const ext = (f.name.split(".").pop() || "wav").toLowerCase();
      const d = new Date();
      const pad = (n: number) => String(n).padStart(2, "0");
      const id = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}-imp${Math.random().toString(16).slice(2, 8)}`;
      const res = await api.record({ id, startedAt: f.lastModified / 1000, durationSec: 0, format: ext, title: f.name.replace(/\.[^.]+$/, ""), inputDevice: "Imported file" }, f, f.name);
      onChanged();
      navigate(`/meetings/${encodeURIComponent(res.id)}`);
    } catch (e) { setError(errorMessage(e)); } finally { setImporting(false); }
  };

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <h2 className="font-display text-[22px] font-bold tracking-tight">Meetings</h2>
        <div className="flex-1" />
        {projects.length > 0 && (
          <Select className="!w-[180px]" value={project} onChange={(e) => setProject(e.target.value)} title="Show one project">
            <option value={ALL}>All projects</option>
            <option value={NONE}>No project</option>
            {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </Select>
        )}
        <div className="relative w-[220px]"><SearchIcon className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted" /><Input className="pl-8" placeholder="Filter meetings" value={filter} onChange={(e) => setFilter(e.target.value)} /></div>
        <input ref={file} type="file" accept=".wav,.mp3,.m4a,.mp4,.webm,.flac,.ogg,audio/*" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) importFile(f); e.target.value = ""; }} />
        <Button variant="secondary" loading={importing} onClick={() => file.current?.click()}><FileAudio className="h-3.5 w-3.5" /> Import audio</Button>
      </div>
      {error && <div className="mb-3 text-[12.5px] text-danger">{error}</div>}
      {!meetings ? <div className="flex justify-center py-10"><Spinner /></div>
        : !meetings.length ? <EmptyState icon={<Mic className="h-6 w-6" />} title="No meetings yet" body="Record here, import a file, or send a recording from the Huddle app." action={<Button variant="record" onClick={() => navigate("/record")}><Mic className="h-4 w-4" /> New Recording</Button>} />
        : !list.length ? <div className="py-10 text-center text-[13px] text-muted">No meetings match.</div>
        : <MeetingGroups meetings={list} showProject={project === ALL} onOpen={(m) => navigate(`/meetings/${encodeURIComponent(m.id)}`)} />}
    </>
  );
}
