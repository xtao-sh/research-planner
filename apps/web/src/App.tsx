import React from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import './App.css';
import { AppDataProvider, useAppData } from './contexts/AppDataContext';
import { AppLayout } from './features/layout/AppLayout';
import { NotFoundPage } from './features/layout/NotFoundPage';
import { NowPage } from './features/now/NowPage';
import { InboxPage } from './features/inbox/InboxPage';
import { ProjectsPage } from './features/projects/ProjectsPage';
import { ProjectDetailPage } from './features/projects/ProjectDetailPage';
import { ReviewPage } from './features/review/ReviewPage';
import { SearchPage } from './features/search/SearchPage';
import { SettingsPage } from './features/settings/SettingsPage';
import { ErrorBoundary } from './components/ErrorBoundary';

/**
 * Single-user local mode (post-Phase-I).
 *
 * The login screen and auth gate were removed. The server's auth preHandler
 * now auto-resolves every /api/* request to the seeded `demo@local` user, so
 * the client just needs to wait for the initial /api/auth/me to populate
 * useAuth, then mount the routed shell directly. The AuthScreen / AcceptInvite
 * components and the rest of the auth machinery (cookie session, /api/auth/*
 * endpoints, login/register API) are kept on disk but unused — flipping back
 * to multi-user later only needs reverting the auth.ts preHandler.
 */
export function App() {
  return (
    <AppDataProvider>
      <AppGate />
    </AppDataProvider>
  );
}

function AppGate() {
  const { auth } = useAppData();
  const { t } = useTranslation();

  if (auth.loading || !auth.user) {
    return (
      <div className="app-container">
        <div className="card">
          <p>{t('common.loading')}</p>
        </div>
      </div>
    );
  }

  return (
    <Routes>
      <Route element={<AppLayout />}>
        <Route index element={<Navigate to="/now" replace />} />
        <Route path="now" element={<ErrorBoundary><NowPage /></ErrorBoundary>} />
        <Route path="inbox" element={<InboxPage />} />
        <Route path="projects" element={<ProjectsPage />} />
        <Route path="review" element={<ReviewPage />} />
        <Route path="search" element={<ErrorBoundary><SearchPage /></ErrorBoundary>} />
        <Route path="settings" element={<SettingsPage />} />
        <Route path="projects/:projectId" element={<ErrorBoundary><ProjectDetailPage /></ErrorBoundary>} />
        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  );
}

