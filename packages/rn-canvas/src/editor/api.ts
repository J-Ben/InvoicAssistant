import type { Board, CreateInfo, CreateRequest, CreateResult, EditRequest, EditResult, FlowLink, GitInfo, HistoryState, InspectResult, MemoryStats, ProjectInfo, SnapshotStatus } from '../shared/protocol.ts';

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  const body = await res.json().catch(() => ({ error: `Réponse invalide (${res.status})` }));
  if (!res.ok) throw new ApiError(body.error ?? `Erreur ${res.status}`, res.status);
  return body as T;
}

export class ApiError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

export const api = {
  project: () => request<ProjectInfo>('/api/project'),
  inspect: (loc: string, name?: string) =>
    request<InspectResult>(`/api/inspect?loc=${encodeURIComponent(loc)}${name ? `&name=${encodeURIComponent(name)}` : ''}`),
  edit: (body: EditRequest) =>
    request<EditResult>('/api/edit', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
  history: () => request<HistoryState>('/api/history'),
  board: () => request<Board>('/api/board'),
  saveBoard: (board: Board) => request<Board>('/api/board', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(board) }),
  missingRoutes: () => request<{ file: string; name: string; title: string; params: string[] }[]>('/api/routes'),
  generateRoutes: (files?: string[]) =>
    request<{ created: string[] }>('/api/routes', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ files }) }),
  flows: () => request<FlowLink[]>('/api/flows'),
  componentStory: (file: string, name: string) =>
    request<{ story: string; file: string; created: boolean }>('/api/component-story', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ file, name }) }),
  undo: () => request<EditResult>('/api/undo', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }),
  redo: () => request<EditResult>('/api/redo', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }),
  images: () => request<string[]>('/api/assets'),
  /** Copie une image dans les assets du projet ; renvoie son chemin. */
  importImage: async (file: File) => request<{ path: string }>(`/api/assets?name=${encodeURIComponent(file.name)}`, { method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: await file.arrayBuffer() }),
  imageUrl: (path: string) => `/api/asset?path=${encodeURIComponent(path)}`,
  icons: (q: string) => request<{ installed: boolean; icons: { name: string; code: number }[] }>(`/api/icons?q=${encodeURIComponent(q)}`),
  fonts: () => request<string[]>('/api/fonts'),
  git: () => request<GitInfo | null>('/api/git'),
  memory: () => request<MemoryStats>('/api/memory'),
  createBranch: (name: string, base?: string) =>
    request<GitInfo>('/api/git/branch', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, base }) }),
  switchBranch: (branch: string) =>
    request<GitInfo>('/api/git/switch', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ branch }) }),
  conventions: () => request<CreateInfo>('/api/create'),
  /** Fichiers que créerait la demande, sans rien écrire. */
  previewCreate: (body: CreateRequest) => request<CreateResult>('/api/create/preview', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
  create: (body: CreateRequest) => request<CreateResult>('/api/create', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
  snapshots: (w: number, h: number) => request<SnapshotStatus>(`/api/snapshots?w=${w}&h=${h}`),
  /** Écrans visibles, capturés en premier. */
  snapshotPriority: (w: number, h: number, ids: string[]) =>
    request<{ ok: true }>('/api/snapshots/priority', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ w, h, ids }) }),
  refreshSnapshots: (w: number, h: number, ids?: string[]) =>
    request<{ ok: true }>('/api/snapshots/refresh', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ w, h, ids }) }),
  snapshotUrl: (id: string, w: number, h: number, version: string) => `/api/snapshot?id=${encodeURIComponent(id)}&w=${w}&h=${h}&v=${version}`,
  events(onEvent: (type: string, data: unknown) => void): () => void {
    const source = new EventSource('/api/events');
    for (const type of ['stories', 'snapshot', 'snapshots']) {
      source.addEventListener(type, (event) => {
        let data: unknown = null;
        try {
          data = JSON.parse((event as MessageEvent).data);
        } catch {
          // Événement sans données.
        }
        onEvent(type, data);
      });
    }
    return () => source.close();
  },
};
