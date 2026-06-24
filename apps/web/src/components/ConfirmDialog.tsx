import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from 'react';
import { useTranslation } from 'react-i18next';

/**
 * App-wide destructive-confirm mechanism.
 *
 * The Inbox deliberately dropped native confirm() ("those dialogs are awful
 * on macOS and don't match the toast/modal aesthetic of the rest of the app")
 * in favour of an in-app flow. This provides the single shared replacement so
 * every other destructive action (delete task / note / artifact / scenario,
 * remove member, revoke invite, delete project, change project mode) gets the
 * same themed, accessible dialog instead of the OS chrome.
 *
 * Usage:
 *   const confirm = useConfirm();
 *   if (!(await confirm({ message: t('task.confirmDelete') }))) return;
 *   // …proceed with the delete
 *
 * The promise resolves `true` on confirm and `false` on cancel / Esc /
 * backdrop click, so call sites read like the old `if (!confirm(...)) return;`.
 *
 * Mirrors the ToastProvider/useToast pattern: one provider near the app root,
 * a context-backed hook, and a single dialog instance shared by all callers.
 */
export interface ConfirmOptions {
  /** Body copy — the question. Caller passes an already-translated string. */
  message: string;
  /** Optional heading; falls back to the localized default ("Are you sure?"). */
  title?: string;
  /** Confirm-button label; falls back to the localized default ("Delete"). */
  confirmLabel?: string;
  /** Cancel-button label; falls back to common.cancel. */
  cancelLabel?: string;
  /**
   * Visual weight of the confirm button. 'danger' (default) is destructive
   * red; 'primary' is the neutral accent for non-destructive confirmations.
   */
  tone?: 'danger' | 'primary';
}

type ConfirmFn = (options: ConfirmOptions) => Promise<boolean>;

const ConfirmContext = createContext<ConfirmFn | null>(null);

interface PendingConfirm {
  options: ConfirmOptions;
  resolve: (ok: boolean) => void;
}

export function ConfirmProvider({ children }: { children: React.ReactNode }) {
  const [pending, setPending] = useState<PendingConfirm | null>(null);

  const confirm = useCallback<ConfirmFn>((options) => {
    return new Promise<boolean>((resolve) => {
      setPending({ options, resolve });
    });
  }, []);

  const settle = useCallback(
    (ok: boolean) => {
      setPending((cur) => {
        cur?.resolve(ok);
        return null;
      });
    },
    [],
  );

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      {pending && (
        <ConfirmDialog
          options={pending.options}
          onConfirm={() => settle(true)}
          onCancel={() => settle(false)}
        />
      )}
    </ConfirmContext.Provider>
  );
}

function ConfirmDialog({
  options,
  onConfirm,
  onCancel,
}: {
  options: ConfirmOptions;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const { t } = useTranslation();
  const trapRef = useRef<HTMLDivElement | null>(null);
  const tone = options.tone ?? 'danger';

  // Esc cancels — same convention as the app's other modals.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onCancel();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onCancel]);

  // Focus trap + initial focus on the confirm button (mirrors WelcomeModal).
  useEffect(() => {
    const root = trapRef.current;
    if (!root) return;
    const focusables = () =>
      Array.from(
        root.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ),
      ).filter((el) => !el.hasAttribute('inert'));
    function onKey(e: KeyboardEvent) {
      if (e.key !== 'Tab') return;
      const els = focusables();
      if (els.length === 0) return;
      const first = els[0];
      const last = els[els.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
    root.addEventListener('keydown', onKey);
    const confirmBtn = root.querySelector<HTMLElement>('[data-confirm-default]');
    setTimeout(() => (confirmBtn ?? focusables()[0])?.focus(), 30);
    return () => root.removeEventListener('keydown', onKey);
  }, []);

  return (
    <div className="modal-overlay" onClick={onCancel}>
      <div
        ref={trapRef}
        role="alertdialog"
        aria-modal="true"
        aria-label={options.title ?? t('confirm.title')}
        tabIndex={-1}
        className="modal-content"
        onClick={(e) => e.stopPropagation()}
        style={{ maxWidth: 440 }}
      >
        <div className="modal-header">
          <h3>{options.title ?? t('confirm.title')}</h3>
        </div>
        <p style={{ marginTop: 0, marginBottom: 20, fontSize: 14, lineHeight: 1.5 }}>
          {options.message}
        </p>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button type="button" className="rd-btn" onClick={onCancel}>
            {options.cancelLabel ?? t('common.cancel')}
          </button>
          <button
            type="button"
            className={tone === 'danger' ? 'rd-btn rd-btn-danger' : 'rd-btn rd-btn-primary'}
            onClick={onConfirm}
            data-confirm-default
          >
            {options.confirmLabel ?? t('confirm.confirmCta')}
          </button>
        </div>
      </div>
    </div>
  );
}

export function useConfirm(): ConfirmFn {
  const ctx = useContext(ConfirmContext);
  if (!ctx) throw new Error('useConfirm used outside ConfirmProvider');
  return ctx;
}
