import React, { useEffect } from 'react';
import { Navigate, Route, Routes, useNavigate } from 'react-router-dom';
import LandingPage from './pages/LandingPage';
import LoginPage from './pages/LoginPage';
import DashboardApp from './pages/DashboardApp';
import { getSession } from './lib/supabase';

function LoginRoute({ initialMode }) {
  const navigate = useNavigate();
  return <LoginPage initialMode={initialMode} onLogin={() => navigate('/dashboard', { replace: true })} />;
}

function HomeRoute() {
  const navigate = useNavigate();

  // An OAuth redirect can land here instead of /dashboard (e.g. the
  // provider's configured redirect allowlist doesn't have the exact path),
  // in which case supabase-js's detectSessionInUrl has already established a
  // real session behind the scenes -- getSession() picks it up -- but
  // nothing has navigated anywhere. Without this, an already-authenticated
  // visitor is stuck looking at the marketing page.
  useEffect(() => {
    let cancelled = false;
    getSession()
      .then((session) => {
        if (!cancelled && session?.access_token) navigate('/dashboard', { replace: true });
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [navigate]);

  return <LandingPage />;
}

export default function App() {
  return <Routes>
    <Route path="/" element={<HomeRoute />} />
    <Route path="/login" element={<LoginRoute initialMode="signin" />} />
    <Route path="/register" element={<LoginRoute initialMode="register" />} />
    <Route path="/dashboard/*" element={<DashboardApp />} />
    <Route path="*" element={<Navigate to="/" replace />} />
  </Routes>;
}
