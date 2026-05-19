import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from 'react';
import { useTranslation } from 'react-i18next';

type ToastKind = 'info' | 'success' | 'error' | 'warning';

interface Toast {
  id: number;
  message: string;
  kind: ToastKind;
  action?: { label: string; onClick: () => void };
  /** ms; 0 means sticky (only the action / close button dismisses) */
  duration: number;
}

interface ToastContextValue {
  push: (message: string, opts?: Partial<Omit<Toast, 'id' | 'message'>>) => number;
  dismiss: (id: number) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  // Per-provider id counter so StrictMode double-mount + HMR don't collide
  // across remounted providers.
  const nextIdRef = useRef<number>(1);
  // Track auto-dismiss timer handles per toast id so a manual dismiss
  // cancels the pending timer (prevents the orphan timer from firing
  // dismiss(id) on a since-recycled id, which would wrongly drop a
  // newer toast).
  const timersRef = useRef<Map<number, number>>(new Map());

  const dismiss = useCallback((id: number) => {
    const handle = timersRef.current.get(id);
    if (handle !== undefined) {
      window.clearTimeout(handle);
      timersRef.current.delete(id);
    }
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const push = useCallback(
    (message: string, opts: Partial<Omit<Toast, 'id' | 'message'>> = {}) => {
      const id = nextIdRef.current++;
      const t: Toast = {
        id,
        message,
        kind: opts.kind ?? 'info',
        action: opts.action,
        duration: opts.duration ?? (opts.kind === 'error' ? 6000 : 3500),
      };
      setToasts((prev) => [...prev, t]);
      if (t.duration > 0) {
        const handle = window.setTimeout(() => {
          timersRef.current.delete(id);
          setToasts((prev) => prev.filter((x) => x.id !== id));
        }, t.duration);
        timersRef.current.set(id, handle);
      }
      return id;
    },
    [],
  );

  // On unmount, clear every pending timer so we don't fire setState on
  // an unmounted tree (e.g. test teardown, HMR reload).
  useEffect(() => {
    const timers = timersRef.current;
    return () => {
      for (const h of timers.values()) window.clearTimeout(h);
      timers.clear();
    };
  }, []);

  return (
    <ToastContext.Provider value={{ push, dismiss }}>
      {children}
      {/* Split into two stacks so error/warning gets the assertive live region. */}
      <div className="rd-toast-stack" role="status" aria-live="polite">
        {toasts
          .filter((t) => t.kind === 'info' || t.kind === 'success')
          .map((t) => (
            <ToastRow key={t.id} toast={t} onDismiss={() => dismiss(t.id)} />
          ))}
      </div>
      <div className="rd-toast-stack rd-toast-stack--alert" role="alert" aria-live="assertive">
        {toasts
          .filter((t) => t.kind === 'error' || t.kind === 'warning')
          .map((t) => (
            <ToastRow key={t.id} toast={t} onDismiss={() => dismiss(t.id)} />
          ))}
      </div>
    </ToastContext.Provider>
  );
}

function ToastRow({ toast, onDismiss }: { toast: Toast; onDismiss: () => void }) {
  const { t } = useTranslation();
  return (
    <div className={`rd-toast rd-toast--${toast.kind}`}>
      <span className="rd-toast-msg">{toast.message}</span>
      {toast.action && (
        <button
          type="button"
          className="rd-toast-action"
          onClick={() => {
            toast.action!.onClick();
            onDismiss();
          }}
        >
          {toast.action.label}
        </button>
      )}
      <button
        type="button"
        className="rd-toast-close"
        onClick={onDismiss}
        aria-label={t('common.dismiss')}
      >
        ×
      </button>
    </div>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast used outside ToastProvider');
  return ctx;
}
