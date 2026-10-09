// Dashboard ↔ server. /api is the server's own API, /engine the embedded Huddle engine.
import type {
  ApiKey, DownloadCandidate, DownloadProgress, Environment, McpStatus, Meeting, MeetingDetail, Resolution,
  SetupPlan, StorageInfo, UserSettings,
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

export interface Me { user: { id: number; email: string; totpEnabled: boolean } | null; totpRequired: boolean }
export interface Client { id: number; name: string; prefix: string; createdAt: number; lastSeenAt: number | null; lastVersion: string | null; revoked: boolean; meetingCount: number; key: string | null }
export interface Overview {
  name: string; version: string; engineVersion: string; fingerprint: string | null;
  hardware: { os: string; osVersion: string; arch: string; cpuBrand: string | null; cpuCores: number; memoryBytes: number | null };
  capabilities: { transcription: string | null; diarization: boolean; llm: string | null };
  resolutions: Resolution[]; meetings: number; processing: number; activeJob: string | null; clients: number;
  recordingsBytes: number; maxBytes: number; retentionDays: number; mcp: McpStatus | null;
}

export const api = {
  // server
  setupState: () => get<{ needsSetup: boolean; name: string }>("/api/setup"),
  setup: (email: string, password: string) => post<Me>("/api/setup", { email, password }),
  login: (email: string, password: string) => post<Me>("/api/auth/login", { email, password }),
  loginTotp: (code: string) => post<Me>("/api/auth/totp", { code }),
  logout: () => post<{ ok: boolean }>("/api/auth/logout"),
  me: () => get<Me>("/api/auth/me"),
  info: () => get<{ name: string; version: string; engineVersion: string; fingerprint: string | null }>("/api/info"),
  overview: () => get<Overview>("/api/overview"),
  setServerName: (name: string) => put<{ name: string }>("/api/server", { name }),
  clients: () => get<Client[]>("/api/clients"),
  createClient: (name: string) => post<Client>("/api/clients", { name }),
  renameClient: (id: number, name: string) => patch<{ ok: boolean }>(`/api/clients/${id}`, { name }),
  revokeClient: (id: number) => post<{ ok: boolean }>(`/api/clients/${id}/revoke`),
  deleteClient: (id: number) => del<{ ok: boolean }>(`/api/clients/${id}`),
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
  meetings: (q?: string) => get<Meeting[]>(`/engine/meetings${q ? `?q=${encodeURIComponent(q)}` : ""}`),
  meeting: (id: string) => get<MeetingDetail>(`/engine/meetings/${id}`),
  deleteMeeting: (id: string) => del<{ ok: boolean }>(`/engine/meetings/${id}`),
  deleteAudio: (id: string) => post<{ freedBytes: number }>(`/engine/meetings/${id}/delete-audio`),
  retryStage: (id: string, stage: string) => post<unknown>(`/engine/meetings/${id}/retry/${stage}`),
  cancelProcessing: (id: string) => post<{ ok: boolean }>(`/engine/meetings/${id}/cancel`),
  mcpStatus: () => get<McpStatus>("/engine/mcp/status"),
  apiKeys: () => get<ApiKey[]>("/engine/mcp/keys"),
  createApiKey: (name: string, validityDays: number) => post<ApiKey>("/engine/mcp/keys", { name, validityDays }),
  renewApiKey: (id: number) => post<ApiKey>(`/engine/mcp/keys/${id}/renew`),
  deleteApiKey: (id: number) => del<{ ok: boolean }>(`/engine/mcp/keys/${id}`),
};
