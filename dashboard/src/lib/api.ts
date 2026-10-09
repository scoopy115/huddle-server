// Dashboard ↔ server. /api is the server's own API, /engine the embedded Huddle engine.
import type {
  DownloadCandidate, DownloadProgress, Environment, Meeting, MeetingDetail, Resolution, SetupPlan, StorageInfo, UserSettings,
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
  record: async (meta: Record<string, unknown>, blob: Blob, filename: string) => {
    const fd = new FormData();
    fd.append("meta", JSON.stringify(meta));
    fd.append("audio", blob, filename);
    const r = await fetch("/api/record", { method: "POST", body: fd, headers: { "X-Requested-With": "huddle" }, credentials: "same-origin" });
    const data = await r.json().catch(() => null);
    if (!r.ok) throw new ApiError(r.status, (data && data.detail) || r.statusText);
    return data as { id: string };
  },
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
  meeting: (id: string) => get<MeetingDetail & { ownerUserId: number | null }>(`/api/meetings/${encodeURIComponent(id)}`),
  deleteMeeting: (id: string) => del<{ ok: boolean }>(`/api/meetings/${encodeURIComponent(id)}`),
  deleteAudio: (id: string) => post<{ freedBytes: number }>(`/api/meetings/${encodeURIComponent(id)}/delete-audio`),
  retryStage: (id: string, stage: string) => post<unknown>(`/api/meetings/${encodeURIComponent(id)}/retry/${stage}`),
  cancelProcessing: (id: string) => post<{ ok: boolean }>(`/api/meetings/${encodeURIComponent(id)}/cancel`),
};
