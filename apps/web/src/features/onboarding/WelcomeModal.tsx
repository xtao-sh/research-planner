import React, { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';

interface WelcomeModalProps {
  open: boolean;
  onClose: () => void;
}

/**
 * First-run welcome moment. Mounted in AppLayout and gated on the
 * `rp.onboard.seen` localStorage flag (see AppLayout) so it shows exactly
 * once per browser — and can be re-opened on demand from the Help &
 * shortcuts modal via the `rp:show-welcome` event.
 *
 * Three short panels map to the product's three beliefs, each with one
 * concrete next action that fires an existing global event:
 *   - progress over deadlines → create a project (`rp:new-project`)
 *   - capture before structure → quick-capture (`rp:open-capture`)
 *   - context on re-entry → (copy only — taught, no action)
 *
 * Copy-only and fully i18n'd so it ships in both locales. Dismissing
 * (any path) marks it seen via onClose in the parent.
 */
export function WelcomeModal({ open, onClose }: WelcomeModalProps) {
  const { t } = useTranslation();
  const trapRef = useRef<HTMLDivElement | null>(null);

  // Esc closes (same convention as ShortcutsHelpModal / drawers).
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  // Focus trap (mirrors ShortcutsHelpModal).
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

  const beliefs: {
    key: 'progress' | 'capture' | 'reentry';
    glyph: string;
    action?: { labelKey: string; run: () => void };
  }[] = [
    {
      key: 'progress',
      glyph: '◔',
      action: {
        labelKey: 'onboard.belief.progressCta',
        run: () => {
          onClose();
          window.dispatchEvent(new CustomEvent('rp:new-project'));
        },
      },
    },
    {
      key: 'capture',
      glyph: '↓',
      action: {
        labelKey: 'onboard.belief.captureCta',
        run: () => {
          onClose();
          window.dispatchEvent(new CustomEvent('rp:open-capture'));
        },
      },
    },
    {
      key: 'reentry',
      glyph: '●',
    },
  ];

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        ref={trapRef}
        role="dialog"
        aria-modal="true"
        aria-label={t('onboard.title')}
        tabIndex={-1}
        className="modal-content"
        onClick={(e) => e.stopPropagation()}
        style={{ maxWidth: 520 }}
      >
        <div className="modal-header">
          <h3>{t('onboard.title')}</h3>
          <button
            className="modal-close"
            onClick={onClose}
            aria-label={t('common.close')}
          >
            ✕
          </button>
        </div>
        <p
          className="muted"
          style={{ marginTop: 0, marginBottom: 14, fontSize: 13, lineHeight: 1.5 }}
        >
          {t('onboard.subtitle')}
        </p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {beliefs.map((b) => (
            <div
              key={b.key}
              style={{
                display: 'flex',
                gap: 12,
                alignItems: 'flex-start',
                padding: '12px 14px',
                border: '1px solid var(--rd-line)',
                borderRadius: 10,
                background: 'var(--rd-surface)',
              }}
            >
              <span
                aria-hidden="true"
                style={{
                  fontSize: 16,
                  lineHeight: '22px',
                  color: 'var(--rd-ink-3)',
                  flex: '0 0 auto',
                }}
              >
                {b.glyph}
              </span>
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--rd-ink)' }}>
                  {t(`onboard.belief.${b.key}Title` as const)}
                </div>
                <div
                  className="muted"
                  style={{ fontSize: 12.5, lineHeight: 1.5, marginTop: 2 }}
                >
                  {t(`onboard.belief.${b.key}Body` as const)}
                </div>
                {b.action && (
                  <button
                    type="button"
                    className="rd-btn rd-btn-ghost rd-btn-sm"
                    style={{ marginTop: 8 }}
                    onClick={b.action.run}
                  >
                    {t(b.action.labelKey as 'onboard.belief.progressCta')}
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
        <div
          style={{
            marginTop: 16,
            display: 'flex',
            justifyContent: 'flex-end',
          }}
        >
          <button
            type="button"
            className="rd-btn rd-btn-primary"
            onClick={onClose}
          >
            {t('onboard.dismiss')}
          </button>
        </div>
      </div>
    </div>
  );
}
