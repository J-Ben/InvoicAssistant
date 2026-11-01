import { useEffect, useState } from 'react';
import type { MemoryStats } from '../shared/protocol.ts';
import { api } from './api.ts';

type HeapPerformance = Performance & { memory?: { usedJSHeapSize: number } };

const format = (mb: number) => (mb >= 1024 ? `${(mb / 1024).toFixed(1)} Go` : `${mb} Mo`);

/**
 * Mémoire utilisée, discrète dans la barre du haut : processus lancés par l'éditeur (serveur, app,
 * captures) et, dans Chrome, le tas JavaScript de cet onglet. Le détail est dans l'info-bulle.
 */
export function MemoryBadge() {
  const [stats, setStats] = useState<MemoryStats | null>(null);
  const [tab, setTab] = useState<number | null>(null);
  useEffect(() => {
    let stopped = false;
    const tick = () => {
      api.memory().then((s) => !stopped && setStats(s), () => {});
      const heap = (performance as HeapPerformance).memory?.usedJSHeapSize;
      setTab(heap ? Math.round(heap / 1024 / 1024) : null);
    };
    tick();
    // Onglet en arrière-plan : pas de mesure (la première a déjà eu lieu).
    const timer = window.setInterval(() => !document.hidden && tick(), 5000);
    return () => {
      stopped = true;
      window.clearInterval(timer);
    };
  }, []);
  if (!stats) return null;
  const total = stats.total + (tab ?? 0);
  const detail = [
    `Serveur de l'éditeur : ${format(stats.server)}`,
    stats.app !== null && `App (Expo, Metro) : ${format(stats.app)}`,
    stats.captures !== null && `Navigateur des captures : ${format(stats.captures)}`,
    tab !== null && `Cet onglet (JavaScript) : ${format(tab)}`,
  ].filter(Boolean);
  return (
    <span className={`memory-badge ${total >= 4096 ? 'high' : ''}`} title={`Mémoire utilisée\n${detail.join('\n')}`}>
      {format(total)}
    </span>
  );
}
