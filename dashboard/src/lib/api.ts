// Dashboard ↔ server. /api is the server's own API, /engine the embedded Huddle engine.
import type {
  ActionItem, AskResult, DownloadCandidate, DownloadProgress, Environment, KnownSpeaker, Meeting, MeetingDetail, MeetingSpeaker,
  ProcessesInfo, Project, ProjectDetail, Resolution, SearchHit, SetupPlan, StorageInfo, TranscriptSegment, UserSettings,
} from "@/types/engine";

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) { super(message); this.status = status; }
}

let onUnauthorized: (() => void) | null = null;
export const setUnauthorizedHandler = (fn: () => void) => { onUnauthorized = fn; };

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  const r = await fetch(path, {
    method,
    headers: { "X-Requested-With": "huddle", ...(body !== undefined ? { "Content-Type": "application/json" } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
    credentials: "same-origin",
  });
  if (r.status === 401 && !path.startsWith("/api/auth/") && path !== "/api/setup") onUnauthorized?.();
  const text = await r.text();
  let data: unknown = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  if (!r.ok) {
    const detail = (data && typeof data === "object" && "detail" in data) ? String((data as { detail: unknown }).detail) : r.statusText;
    throw new ApiError(r.status, detail);
  }
  return data as T;
}
const get = <T>(p: string) => call<T>("GET", p);
const post = <T>(p: string, b?: unknown) => call<T>("POST", p, b ?? {});
const put = <T>(p: string, b?: unknown) => call<T>("PUT", p, b);
const patch = <T>(p: string, b?: unknown) => call<T>("PATCH", p, b);
const del = <T>(p: string) => call<T>("DELETE", p);

export const errorMessage = (e: unknown) => (e instanceof Error ? e.message : String(e));

export type Role = "admin" | "user";
export interface User { id: number; email: string; name: string; totpEnabled: boolean; role: Role; approved: boolean; createdAt: number; totpPrompted?: boolean; clientCount?: number }
export interface Capabilities { transcription: string | null; diarization: boolean; llm: string | null }
export interface Me { user: User | null; totpRequired: boolean; registration: "invite" | "open"; canSeeAll?: boolean }
export interface Client { id: number; name: string; kind: "device" | "browser"; prefix: string; createdAt: number; lastSeenAt: number | null; lastVersion: string | null; revoked: boolean; userId: number | null; userEmail: string | null; scope: "own" | "all"; aiEnabled: boolean; meetingCount: number; tokenCount: number; key: string | null }
export interface McpToken { id: number; clientId: number; clientName: string; name: string; prefix: string; createdAt: number; expiresAt: number | null; lastUsedAt: number | null; expired: boolean; revoked: boolean; scope: "own" | "all"; token: string | null; url?: string }
export interface Invite { id: number; prefix: string; email: string | null; createdAt: number; expiresAt: number; used: boolean; expired: boolean; token?: string; url?: string }
export interface SpeakerModels { installed: boolean; downloading: boolean; progress: number; error: string | null }
export interface Overview {
  name: string; version: string; engineVersion: string; fingerprint: string | null; publicUrl: string;
  users: number; pendingUsers: number; mcpTokens: number; registration: "invite" | "open";
  processed: number; processedMinutes: number; perDay: { date: string; meetings: number; minutes: number }[];
  onboarded: boolean; speakerModels: SpeakerModels;
  hardware: { os: string; osVersion: string; arch: string; cpuBrand: string | null; cpuCores: number; memoryBytes: number | null; gpu: string | null };
  capabilities: { transcription: string | null; diarization: boolean; llm: string | null };
  resolutions: Resolution[]; meetings: number; processing: number; activeJob: string | null; clients: number;
  recordingsBytes: number; maxBytes: number; retentionDays: number;
}

export const api = {
  // server
  setupState: () => get<{ needsSetup: boolean; name: string; registration: "invite" | "open" }>("/api/setup"),
  setup: (name: string, email: string, password: string) => post<Me>("/api/setup", { name, email, password }),
  login: (email: string, password: string) => post<Me>("/api/auth/login", { email, password }),
  register: (name: string, email: string, password: string, invite?: string) => post<Me & { pending: boolean }>("/api/auth/register", { name, email, password, invite }),
  updateAccount: (name: string) => patch<User>("/api/account", { name }),
  mcpTools: () => get<{ name: string; description: string }[]>("/api/mcp/tools"),
  capabilities: () => get<Capabilities>("/api/capabilities"),
  markTotpPrompted: () => post<{ ok: boolean }>("/api/account/totp-prompted"),
  /** Upload a recording with progress (XHR: fetch has no upload progress). */
  record: (meta: Record<string, unknown>, blob: Blob, filename: string, onProgress?: (fraction: number) => void) =>
    new Promise<{ id: string }>((resolve, reject) => {
      const fd = new FormData();
      fd.append("meta", JSON.stringify(meta));
      fd.append("audio", blob, filename);
      const xhr = new XMLHttpRequest();
      xhr.open("POST", "/api/record");
      xhr.setRequestHeader("X-Requested-With", "huddle");
      xhr.upload.onprogress = (e) => { if (e.lengthComputable) onProgress?.(e.loaded / e.total); };
      xhr.onload = () => {
        let data: { id?: string; detail?: string } | null = null;
        try { data = JSON.parse(xhr.responseText); } catch { data = null; }
        if (xhr.status >= 200 && xhr.status < 300 && data?.id) resolve({ id: data.id });
        else reject(new ApiError(xhr.status, data?.detail || (xhr.status === 413 ? "The file is larger than the server or the proxy allows." : xhr.status === 0 ? "The upload was interrupted." : `Upload failed (${xhr.status}).`)));
      };
      xhr.onerror = () => reject(new ApiError(0, "The upload failed. Check the connection and any proxy limits."));
      xhr.ontimeout = () => reject(new ApiError(0, "The upload timed out."));
      xhr.send(fd);
    }),
  inviteState: (token: string) => get<{ valid: boolean; email: string | null }>(`/api/auth/invite/${encodeURIComponent(token)}`),
  loginTotp: (code: string) => post<Me>("/api/auth/totp", { code }),
  logout: () => post<{ ok: boolean }>("/api/auth/logout"),
  me: () => get<Me>("/api/auth/me"),
  info: () => get<{ name: string; fingerprint: string | null }>("/api/info"),
  overview: () => get<Overview>("/api/overview"),
  updateServer: (body: { name?: string; registration?: "invite" | "open" }) => put<{ name: string; registration: "invite" | "open" }>("/api/server", body),
  users: () => get<User[]>("/api/users"),
  patchUser: (id: number, body: { role?: Role; approved?: boolean }) => patch<User>(`/api/users/${id}`, body),
  deleteUser: (id: number) => del<{ ok: boolean }>(`/api/users/${id}`),
  resetUserPassword: (id: number, password: string) => post<{ ok: boolean }>(`/api/users/${id}/password`, { password }),
  invites: () => get<Invite[]>("/api/invites"),
  createInvite: (email?: string) => post<Invite>("/api/invites", { email: email || null }),
  deleteInvite: (id: number) => del<{ ok: boolean }>(`/api/invites/${id}`),
  clients: () => get<Client[]>("/api/clients"),
  createClient: (name: string) => post<Client>("/api/clients", { name }),
  patchClient: (id: number, body: { name?: string; scope?: "own" | "all"; ai_enabled?: boolean }) => patch<Client>(`/api/clients/${id}`, body),
  onboarding: () => get<{ completed: boolean }>("/api/onboarding"),
  setOnboarding: (completed: boolean) => put<{ completed: boolean }>("/api/onboarding", { completed }),
  speakerModels: () => get<SpeakerModels>("/api/setup/speaker-models"),
  downloadSpeakerModels: () => post<SpeakerModels>("/api/setup/speaker-models"),
  revokeClient: (id: number) => post<{ ok: boolean }>(`/api/clients/${id}/revoke`),
  deleteClient: (id: number) => del<{ ok: boolean }>(`/api/clients/${id}`),
  clientTokens: (id: number) => get<McpToken[]>(`/api/clients/${id}/mcp-tokens`),
  createClientToken: (id: number, name: string, days: number) => post<McpToken>(`/api/clients/${id}/mcp-tokens`, { name, days }),
  deleteToken: (id: number) => del<{ ok: boolean }>(`/api/mcp-tokens/${id}`),
  changePassword: (current: string, next: string) => post<{ ok: boolean }>("/api/account/password", { current, new: next }),
  totpSetup: () => post<{ secret: string; uri: string; svg: string }>("/api/account/totp/setup"),
  totpEnable: (code: string) => post<{ ok: boolean }>("/api/account/totp/enable", { code }),
  totpDisable: (code: string) => post<{ ok: boolean }>("/api/account/totp/disable", { code }),

  // engine
  settings: () => get<UserSettings>("/engine/settings"),
  updateSettings: (p: Partial<UserSettings>) => put<UserSettings>("/engine/settings", p),
  environment: () => get<Environment>("/engine/system/environment"),
  rescan: () => post<Environment>("/engine/system/rescan"),
  setupPlan: () => get<SetupPlan>("/engine/setup/plan"),
  storage: () => get<StorageInfo>("/engine/system/storage"),
  candidates: () => get<DownloadCandidate[]>("/engine/models/candidates"),
  downloads: () => get<DownloadProgress[]>("/engine/models/downloads"),
  startDownload: (id: string) => post<DownloadProgress>(`/engine/models/downloads/${id}`),
  cancelDownload: (id: string) => del<{ ok: boolean }>(`/engine/models/downloads/${id}`),
  deleteModel: (id: string) => del<{ ok: boolean }>(`/engine/models/${id}`),
  meetings: (q?: string) => get<Meeting[]>(`/api/meetings${q ? `?q=${encodeURIComponent(q)}` : ""}`),
  search: (q: string, meetingId?: string, projectId?: string) => get<SearchHit[]>(`/api/search?q=${encodeURIComponent(q)}${meetingId ? `&meeting_id=${encodeURIComponent(meetingId)}` : ""}${projectId ? `&project_id=${encodeURIComponent(projectId)}` : ""}`),
  askMeeting: (id: string, question: string) => post<AskResult>(`/api/meetings/${encodeURIComponent(id)}/ask`, { question }),
  askAll: (question: string, projectId?: string) => post<AskResult>("/api/ask", { question, project_id: projectId ?? null }),
  refine: (id: string, contextHtml: string) => post<{ ok: boolean }>(`/api/meetings/${encodeURIComponent(id)}/refine`, { context_html: contextHtml }),
  generateActionItems: (id: string) => post<{ ok: boolean }>(`/api/meetings/${encodeURIComponent(id)}/action-items/generate`),
  projects: () => get<Project[]>("/api/projects"),
  createProject: (body: { name: string; description?: string | null; meetingIds?: string[] }) => post<Project>("/api/projects", { name: body.name, description: body.description ?? null, meeting_ids: body.meetingIds ?? [] }),
  getProject: (id: string) => get<ProjectDetail>(`/api/projects/${id}`),
  updateProject: (id: string, body: { name?: string; description?: string }) => patch<Project>(`/api/projects/${id}`, body),
  deleteProject: (id: string) => del<{ ok: boolean }>(`/api/projects/${id}`),
  setMeetingProject: (meetingId: string, projectId: string | null) => put<Meeting>(`/api/meetings/${encodeURIComponent(meetingId)}/project`, { project_id: projectId }),
  suggestProject: (meetingId: string) => post<Meeting>(`/api/meetings/${encodeURIComponent(meetingId)}/project-suggestion`),
  dismissProjectSuggestion: (meetingId: string) => del<Meeting>(`/api/meetings/${encodeURIComponent(meetingId)}/project-suggestion`),
  renameSpeaker: (meetingId: string, meetingSpeakerId: number, name: string, enroll = true) => post<MeetingSpeaker>(`/api/meetings/${encodeURIComponent(meetingId)}/speakers/rename`, { meeting_speaker_id: meetingSpeakerId, name, enroll }),
  confirmSpeaker: (meetingId: string, meetingSpeakerId: number) => post<MeetingSpeaker>(`/api/meetings/${encodeURIComponent(meetingId)}/speakers/confirm`, { meeting_speaker_id: meetingSpeakerId }),
  mergeSpeakers: (meetingId: string, sourceId: number, targetId: number) => post<MeetingSpeaker[]>(`/api/meetings/${encodeURIComponent(meetingId)}/speakers/${sourceId}/merge-into/${targetId}`),
  knownSpeakers: () => get<KnownSpeaker[]>("/api/speakers"),
  deleteKnownSpeaker: (id: number) => del<{ ok: boolean }>(`/api/speakers/${id}`),
  updateSegment: (segmentId: number, body: { text?: string; meetingSpeakerId?: number }) => patch<TranscriptSegment>(`/api/segments/${segmentId}`, { text: body.text, meeting_speaker_id: body.meetingSpeakerId }),
  actionItems: (openOnly = false, projectId?: string) => get<ActionItem[]>(`/api/action-items?open_only=${openOnly}${projectId ? `&project_id=${encodeURIComponent(projectId)}` : ""}`),
  updateActionItem: (id: number, body: Partial<Pick<ActionItem, "text" | "owner" | "dueDate" | "done">>) => patch<ActionItem>(`/api/action-items/${id}`, { text: body.text, owner: body.owner, due_date: body.dueDate, done: body.done }),
  createActionItem: (meetingId: string, body: { text: string; owner?: string | null; dueDate?: string | null }) => post<ActionItem>(`/api/meetings/${encodeURIComponent(meetingId)}/action-items`, { text: body.text, owner: body.owner ?? null, due_date: body.dueDate ?? null }),
  deleteActionItem: (id: number) => del<{ ok: boolean }>(`/api/action-items/${id}`),
  processes: () => get<ProcessesInfo>("/api/processes"),
  updateMeetingTitle: (id: string, title: string) => patch<Meeting>(`/api/meetings/${encodeURIComponent(id)}`, { title }),
  meeting: (id: string) => get<MeetingDetail & { ownerUserId: number | null }>(`/api/meetings/${encodeURIComponent(id)}`),
  deleteMeeting: (id: string) => del<{ ok: boolean }>(`/api/meetings/${encodeURIComponent(id)}`),
  deleteAudio: (id: string) => post<{ freedBytes: number }>(`/api/meetings/${encodeURIComponent(id)}/delete-audio`),
  retryStage: (id: string, stage: string) => post<unknown>(`/api/meetings/${encodeURIComponent(id)}/retry/${stage}`),
  cancelProcessing: (id: string) => post<{ ok: boolean }>(`/api/meetings/${encodeURIComponent(id)}/cancel`),
};
