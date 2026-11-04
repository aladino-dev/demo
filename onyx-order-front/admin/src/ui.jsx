import { useCallback, useRef, useState } from 'react';
import { KeyboardSensor, PointerSensor, TouchSensor, useSensor, useSensors } from '@dnd-kit/core';
import { sortableKeyboardCoordinates, useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';

const PATHS = {
  grip: 'M9 5h.01M9 12h.01M9 19h.01M15 5h.01M15 12h.01M15 19h.01',
  eye: 'M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12zM12 15a3 3 0 100-6 3 3 0 000 6z',
  eyeOff: 'M3 3l18 18M10.6 6.1A9.8 9.8 0 0112 6c6.4 0 10 6 10 6a17 17 0 01-3.2 3.9M6.6 7.6A17 17 0 002 12s3.6 7 10 7c1.6 0 3-.4 4.3-1M9.9 9.9a3 3 0 004.2 4.2',
  more: 'M5 12h.01M12 12h.01M19 12h.01',
  plus: 'M12 5v14M5 12h14',
  image: 'M4 5h16v14H4zM4 16l5-5 4 4 3-3 4 4M9 9h.01',
};

export function Icon({ name, size = 20 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={PATHS[name]} />
    </svg>
  );
}

/** Ligne déplaçable : poignée ⋮⋮ à gauche, ordre enregistré au lâcher (dnd-kit). */
export function Sortable({ id, children, className = '' }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });
  return (
    <div ref={setNodeRef} className={`cr-item ${className} ${isDragging ? 'drag' : ''}`} style={{ transform: CSS.Transform.toString(transform), transition }}>
      <button className="handle" {...attributes} {...listeners} aria-label="Déplacer" title="Glisser pour changer l'ordre"><Icon name="grip" size={18} /></button>
      {children}
    </div>
  );
}

/** Interrupteur type « toggle » : zone tactile ≥ 44 px, libellé à côté. */
export function Switch({ on, label, onChange, danger }) {
  return (
    <button role="switch" aria-checked={on} className={`cr-tg ${on ? (danger ? 'danger' : 'on') : ''}`} onClick={() => onChange(!on)}>
      <span className="track"><span className="knob" /></span><span className="lbl">{label}</span>
    </button>
  );
}

/** Capteurs de glisser-déposer : souris, tactile (appui long) et clavier. */
export function useDndSensors() {
  return useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 150, tolerance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }));
}

/** Message « Enregistré » en bas de l'écran (2 s), erreurs 4 s. */
export function useToast() {
  const [toast, setToast] = useState(null);
  const timer = useRef();
  const say = useCallback((text, bad) => {
    setToast({ text, bad });
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setToast(null), bad ? 4000 : 2000);
  }, []);
  const node = toast ? <div className={`cr-toast ${toast.bad ? 'bad' : ''}`} role="status">{toast.text}</div> : null;
  return [node, say];
}
