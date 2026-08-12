import React from 'react';
import { Routes, Route, useNavigate } from 'react-router-dom';
import LandingPage from './pages/LandingPage';
import LoginPage from './pages/LoginPage';
import DashboardApp from './pages/DashboardApp';

function LoginRoute() {
  const navigate = useNavigate();
  return <LoginPage onLogin={(role) => navigate('/dashboard', { state: { role } })} />;
}

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<LandingPage />} />
      <Route path="/login" element={<LoginRoute />} />
      <Route path="/dashboard/*" element={<DashboardApp />} />
    </Routes>
  );
}
