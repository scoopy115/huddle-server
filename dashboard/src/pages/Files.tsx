import { useEffect, useState } from "react";
import { ChevronRight, Download, File, Folder, HardDrive, Trash2 } from "lucide-react";
import { api, errorMessage, type FileEntry } from "@/lib/api";
import { fmtBytes, fmtDate } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Button, Card, DangerDialog, Spinner } from "@/components/ui";

/** Admin: everything Huddle keeps on disk, read-only apart from loose recording files. */
export function Files() {
  const [path, setPath] = useState("");
  const [data, setData] = useState<{ entries: FileEntry[]; total?: number; root?: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<FileEntry | null>(null);
  const load = () => api.files(path).then((d) => { setData(d); setError(null); }).catch((e) => setError(errorMessage(e)));
  useEffect(() => { setData(null); load(); }, [path]); // oxlint-disable-line react-hooks/exhaustive-deps
  const crumbs = path ? path.split("/").filter(Boolean) : [];
  const deletable = (e: FileEntry) => e.kind === "file" && !e.virtual && /^(recordings|logs|hf)(\/|$)/.test(path);
  return (
    <>
      <h2 className="mb-4 font-display text-[22px] font-bold tracking-tight">Files</h2>
      <div className="mb-3 flex flex-wrap items-center gap-1 text-[13px]">
        <button className={cn("inline-flex items-center gap-1 rounded px-1.5 py-0.5 hover:bg-fg/[0.05]", !path && "font-medium")} onClick={() => setPath("")}><HardDrive className="h-3.5 w-3.5 text-muted" /> Data</button>
        {crumbs.map((c, i) => (
          <span key={i} className="inline-flex items-center gap-1"><ChevronRight className="h-3 w-3 text-muted" /><button className={cn("rounded px-1.5 py-0.5 hover:bg-fg/[0.05]", i === crumbs.length - 1 && "font-medium")} onClick={() => setPath(crumbs.slice(0, i + 1).join("/"))}>{c}</button></span>
        ))}
        <div className="flex-1" />
        {data?.total != null && <span className="text-[12px] text-muted">{fmtBytes(data.total)}</span>}
      </div>
      {error && <div className="mb-3 text-[12.5px] text-danger">{error}</div>}
      {!data ? <Spinner /> : (
        <Card>
          {data.entries.map((e) => (
            <div key={e.name} className="flex items-center gap-3 border-b border-border px-4 py-2.5 last:border-b-0">
              {e.kind === "folder" ? <Folder className="h-4 w-4 shrink-0 text-muted" /> : <File className="h-4 w-4 shrink-0 text-muted" />}
              <div className="min-w-0 flex-1">
                {e.kind === "folder" ? <button className="truncate text-[13px] hover:text-accent" onClick={() => setPath(path ? `${path}/${e.name}` : e.name)}>{e.name}</button> : <span className="truncate text-[13px]">{e.name}</span>}
                <div className="flex flex-wrap gap-x-3 text-[12px] text-muted">{e.label && <span>{e.label}</span>}<span>{fmtBytes(e.size) || "0 KB"}</span><span>{fmtDate(e.modified)}</span></div>
              </div>
              {e.kind === "file" && <a href={`/api/files/download?path=${encodeURIComponent(path ? `${path}/${e.name}` : e.name)}`} className="rounded-lg p-1.5 text-muted hover:bg-fg/[0.06] hover:text-fg" title="Download"><Download className="h-3.5 w-3.5" /></a>}
              {deletable(e) && <Button size="sm" variant="ghost" title="Delete" onClick={() => setDeleting(e)}><Trash2 className="h-3.5 w-3.5 text-danger" /></Button>}
            </div>
          ))}
          {data.entries.length === 0 && <div className="px-4 py-3 text-[12.5px] text-muted">Empty.</div>}
        </Card>
      )}
      <DangerDialog open={!!deleting} onClose={() => setDeleting(null)} title="Delete this file?" confirmLabel="Delete file" seconds={3}
        onConfirm={async () => { if (deleting) { await api.deleteFile(path ? `${path}/${deleting.name}` : deleting.name); setDeleting(null); load(); } }}>
        {deleting?.name} is removed from the server. The meeting keeps its transcript and notes.
      </DangerDialog>
    </>
  );
}
