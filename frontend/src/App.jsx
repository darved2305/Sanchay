import React from 'react';
import { Navigate, Route, Routes, useNavigate } from 'react-router-dom';
import LandingPage from './pages/LandingPage';
import LoginPage from './pages/LoginPage';
import DashboardApp from './pages/DashboardApp';

function LoginRoute({ initialMode }) {
  const navigate = useNavigate();
  return <LoginPage initialMode={initialMode} onLogin={() => navigate('/dashboard', { replace: true })} />;
}

export default function App() {
  return <Routes>
    <Route path="/" element={<LandingPage />} />
    <Route path="/login" element={<LoginRoute initialMode="signin" />} />
    <Route path="/register" element={<LoginRoute initialMode="register" />} />
    <Route path="/dashboard/*" element={<DashboardApp />} />
    <Route path="*" element={<Navigate to="/" replace />} />
  </Routes>;
}
