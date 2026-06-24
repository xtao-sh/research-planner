import React, { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';

interface ShortcutsHelpModalProps {
  open: boolean;
  onClose: () => void;
}

type DescriptionKey =
  | 'shortcuts.quickCapture'
  | 'shortcuts.commandPalette'
  | 'shortcuts.help'
  | 'shortcuts.saveInModal'
  | 'shortcuts.closeModal'
  | 'shortcuts.boardPickup'
  | 'shortcuts.boardMove'
  | 'shortcuts.boardOpen';

interface ShortcutDef {
  keys: { mac: string; other: string };
  descriptionKey: DescriptionKey;
}

// Source of truth for what the app actually binds. Keep this in sync with the
// real keydown handlers (AppLayout, QuickCaptureModal, CommandPalette).
const SHORTCUTS: ShortcutDef[] = [
  {
    keys: { mac: '⌘K', other: 'Ctrl+K' },
    descriptionKey: 'shortcuts.commandPalette',
  },
  {
    keys: { mac: '⌘⇧N', other: 'Ctrl+Shift+N' },
    descriptionKey: 'shortcuts.quickCapture',
  },
  {
    keys: { mac: '⌘↵', other: 'Ctrl+Enter' },
    descriptionKey: 'shortcuts.saveInModal',
  },
  {
    keys: { mac: '?', other: '?' },
    descriptionKey: 'shortcuts.help',
  },
  {
    keys: { mac: 'Esc', other: 'Esc' },
    descriptionKey: 'shortcuts.closeModal',
  },
  // Flow board (KanbanView) keyboard interactions — see KanbanView's
  // KeyboardSensor: Space picks up / drops a card, arrows move it, Enter
  // opens the focused card.
  {
    keys: { mac: 'Space', other: 'Space' },
    descriptionKey: 'shortcuts.boardPickup',
  },
  {
    keys: { mac: '← ↑ → ↓', other: '← ↑ → ↓' },
    descriptionKey: 'shortcuts.boardMove',
  },
  {
    keys: { mac: '↵', other: 'Enter' },
    descriptionKey: 'shortcuts.boardOpen',
  },
];

export function ShortcutsHelpModal({ open, onClose }: ShortcutsHelpModalProps) {
  const { t } = useTranslation();
  const trapRef = useRef<HTMLDivElement | null>(null);

  // Esc closes.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  // Focus trap (same pattern as TaskTreeDrawer / TaskDetailsDrawer).
  useEffect(() => {
    if (!open || !trapRef.current) return;
    const root = trapRef.current;
    const focusables = () =>
      Array.from(
        root.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'
        )
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
    setTimeout(() => focusables()[0]?.focus(), 30);
    return () => root.removeEventListener('keydown', onKey);
  }, [open]);

  if (!open) return null;
  const isMac =
    typeof navigator !== 'undefined' &&
    navigator.platform.toLowerCase().includes('mac');

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        ref={trapRef}
        role="dialog"
        aria-modal="true"
        aria-label={t('shortcuts.title')}
        tabIndex={-1}
        className="modal-content"
        onClick={(e) => e.stopPropagation()}
        style={{ maxWidth: 460 }}
      >
        <div className="modal-header">
          <h3>{t('shortcuts.title')}</h3>
          <button
            className="modal-close"
            onClick={onClose}
            aria-label={t('common.close')}
          >
            ✕
          </button>
        </div>
        <dl style={{ margin: 0 }}>
          {SHORTCUTS.map((s) => (
            <div
              key={s.descriptionKey}
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                padding: '0.5rem 0',
                borderBottom: '1px solid var(--rd-line)',
              }}
            >
              <dt style={{ fontSize: '0.875rem' }}>{t(s.descriptionKey)}</dt>
              <dd style={{ margin: 0 }}>
                <kbd
                  style={{
                    background: 'var(--rd-surface-2)',
                    border: '1px solid var(--rd-line)',
                    borderRadius: 4,
                    padding: '2px 8px',
                    fontFamily: 'inherit',
                    fontSize: '0.75rem',
                  }}
                >
                  {isMac ? s.keys.mac : s.keys.other}
                </kbd>
              </dd>
            </div>
          ))}
        </dl>
      </div>
    </div>
  );
}
