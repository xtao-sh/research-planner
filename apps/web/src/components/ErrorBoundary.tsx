import React from 'react';
import { withTranslation, type WithTranslation } from 'react-i18next';

interface ErrorBoundaryOwnProps {
  children: React.ReactNode;
}
type ErrorBoundaryProps = ErrorBoundaryOwnProps & WithTranslation;
interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
  resetKey: number;
}

class ErrorBoundaryInner extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { hasError: false, error: null, resetKey: 0 };

  static getDerivedStateFromError(error: Error): Partial<ErrorBoundaryState> {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    // eslint-disable-next-line no-console
    console.error('[ErrorBoundary]', error, info.componentStack);
  }

  reset = () => {
    this.setState((s) => ({ hasError: false, error: null, resetKey: s.resetKey + 1 }));
  };

  render() {
    const { t } = this.props;
    if (this.state.hasError && this.state.error) {
      return (
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            minHeight: '100vh',
            padding: 32,
            background: 'var(--rd-bg)',
            color: 'var(--rd-ink)',
            fontFamily: 'var(--font-sans)',
          }}
        >
          <div
            style={{
              maxWidth: 520,
              width: '100%',
              padding: 28,
              background: 'var(--rd-surface)',
              border: '1px solid var(--rd-line)',
              borderRadius: 12,
              boxShadow: 'var(--rd-shadow-2)',
            }}
          >
            <div style={{ fontSize: 28, marginBottom: 8 }}>⚠️</div>
            <h2 style={{ margin: '0 0 8px', fontSize: 18, fontWeight: 700 }}>
              {t('errorBoundary.title')}
            </h2>
            <p style={{ margin: '0 0 16px', color: 'var(--rd-ink-3)', fontSize: 13 }}>
              {t('errorBoundary.subtitle')}
            </p>
            <pre
              style={{
                margin: '0 0 16px',
                padding: 12,
                background: 'var(--rd-bg-sunk)',
                borderRadius: 6,
                fontSize: 11,
                fontFamily: 'var(--font-mono)',
                overflowX: 'auto',
                color: 'var(--rd-st-blocked)',
                maxHeight: 160,
              }}
            >
              {this.state.error.message || String(this.state.error)}
            </pre>
            <div style={{ display: 'flex', gap: 8 }}>
              <button
                type="button"
                className="rd-btn rd-btn-primary rd-btn-sm"
                onClick={this.reset}
              >
                {t('errorBoundary.tryAgain')}
              </button>
              <button
                type="button"
                className="rd-btn rd-btn-sm"
                onClick={() => window.location.reload()}
              >
                {t('errorBoundary.reload')}
              </button>
            </div>
          </div>
        </div>
      );
    }
    return <React.Fragment key={this.state.resetKey}>{this.props.children}</React.Fragment>;
  }
}

export const ErrorBoundary = withTranslation()(ErrorBoundaryInner);
