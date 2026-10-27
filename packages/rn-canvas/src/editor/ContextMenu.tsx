import { useEffect, useLayoutEffect, useRef, useState } from 'react';

export interface MenuItem {
  label: string;
  /** Raccourci affiché à droite (ex. ⌘D). */
  hint?: string;
  danger?: boolean;
  disabled?: boolean;
  run: () => void;
}

/** Menu du clic droit, à la position de la souris ; se ferme au clic ailleurs, avec Échap ou au défilement. */
export function ContextMenu({ x, y, title, items, onClose }: { x: number; y: number; title?: string; items: (MenuItem | 'separator')[]; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ left: x, top: y });

  // Reste dans la fenêtre près des bords.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const { width, height } = el.getBoundingClientRect();
    setPosition({ left: Math.min(x, window.innerWidth - width - 8), top: Math.min(y, window.innerHeight - height - 8) });
  }, [x, y]);

  useEffect(() => {
    const close = (e: Event) => {
      if (e instanceof KeyboardEvent && e.key !== 'Escape') return;
      if (e.type === 'pointerdown' && ref.current?.contains(e.target as Node)) return;
      onClose();
    };
    window.addEventListener('pointerdown', close, true);
    window.addEventListener('keydown', close, true);
    window.addEventListener('wheel', close, true);
    window.addEventListener('blur', close);
    return () => {
      window.removeEventListener('pointerdown', close, true);
      window.removeEventListener('keydown', close, true);
      window.removeEventListener('wheel', close, true);
      window.removeEventListener('blur', close);
    };
  }, [onClose]);

  return (
    <div ref={ref} className="context-menu" role="menu" style={position} onContextMenu={(e) => e.preventDefault()}>
      {title && <div className="context-menu-title">{title}</div>}
      {items.map((item, i) =>
        item === 'separator' ? (
          <div key={i} className="context-menu-separator" role="separator" />
        ) : (
          <button
            key={i}
            role="menuitem"
            className={item.danger ? 'danger' : ''}
            disabled={item.disabled}
            onClick={() => {
              onClose();
              item.run();
            }}
          >
            <span>{item.label}</span>
            {item.hint && <kbd>{item.hint}</kbd>}
          </button>
        ),
      )}
    </div>
  );
}
