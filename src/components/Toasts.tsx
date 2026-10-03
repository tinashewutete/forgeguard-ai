import { X } from 'lucide-react';
import { useApp } from '../state/AppContext';

export function Toasts() {
  const { toasts, dismissToast } = useApp();
  return (
    <div className="toasts" role="region" aria-label="Notifications" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className={`toast ${t.tone}`}>
          <span>{t.text}</span>
          <button onClick={() => dismissToast(t.id)} aria-label="Dismiss notification"><X size={13} /></button>
        </div>
      ))}
    </div>
  );
}
