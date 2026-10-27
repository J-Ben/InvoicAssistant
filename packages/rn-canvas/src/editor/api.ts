import type { Board, EditRequest, EditResult, FlowLink, HistoryState, InspectResult, ProjectInfo } from '../shared/protocol.ts';

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
  events(onEvent: (type: string) => void): () => void {
    const source = new EventSource('/api/events');
    source.addEventListener('stories', () => onEvent('stories'));
    return () => source.close();
  },
};
