import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { BarChart3, Calendar, FolderArchive, MessageSquare } from 'lucide-react';
import Header from '../components/Header';
import Sidebar from '../components/Sidebar';
import DashboardOverview from './DashboardOverview';
import ActivitiesSubmissions from './ActivitiesSubmissions';
import ReconstructMyYear from './ReconstructMyYear';
import AdminPanel from './AdminPanel';
import ProfilePage from './ProfilePage';
import EvidencePage from './EvidencePage';
import AppraisalPage from './AppraisalPage';
import AddActivityModal from '../components/AddActivityModal';
import { api, payloadData } from '../lib/api';
import { clearQueryCache, invalidateQueries } from '../lib/queryCache';
import { getSession, signOut } from '../lib/supabase';
import { runtimeConfigMessage } from '../lib/config';
import { useFacultyRealtime } from '../lib/realtime';

function ErrorState({ message, onRetry }) {
  return <div className="mx-auto mt-20 max-w-lg rounded-3xl border border-red-200 bg-red-50 p-8 text-center"><h1 className="text-xl font-extrabold text-red-900">Sign-in required</h1><p className="mt-2 text-sm font-medium text-red-800">{message}</p><div className="mt-5 flex justify-center gap-2"><button onClick={onRetry} className="rounded-xl bg-red-700 px-4 py-2 text-sm font-bold text-white">Retry</button><a href="/login" className="rounded-xl border border-red-200 bg-white px-4 py-2 text-sm font-bold text-red-800">Go to login</a></div></div>;
}

const REALTIME_QUERY_KEYS = [['dashboard', 'faculty'], ['activities'], ['evidence'], ['appraisal'], ['notifications'], ['admin']];

export default function DashboardApp() {
  const navigate = useNavigate();
  const [profile, setProfile] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [authError, setAuthError] = useState('');
  const [currentView, setCurrentView] = useState('dashboard');
  const [activitySearch, setActivitySearch] = useState('');
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [editingActivity, setEditingActivity] = useState(null);
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);

  const loadAuth = async () => {
    setAuthLoading(true); setAuthError('');
    try {
      const session = await getSession();
      if (!session?.access_token) throw new Error('Your session has expired. Please sign in again.');
      const authMe = payloadData(await api.authMe());
      const nextProfile = payloadData(await api.profile());
      const resolved = { ...nextProfile, role: authMe.role, profile_id: authMe.profile_id };
      setProfile(resolved);
      setCurrentView(authMe.role === 'admin' || authMe.role === 'dept_admin' || authMe.role === 'institution_admin' || authMe.role === 'reviewer' ? 'admin' : 'dashboard');
    } catch (error) {
      setAuthError(runtimeConfigMessage(error));
    } finally { setAuthLoading(false); }
  };

  useEffect(() => { void loadAuth(); }, []);
  useFacultyRealtime({ profileId: profile?.id || profile?.profile_id, queryKeys: REALTIME_QUERY_KEYS });

  const currentRole = ['admin', 'dept_admin', 'institution_admin', 'reviewer'].includes(profile?.role) ? 'Admin' : 'Faculty';
  const openAddModal = (activity = null) => { setEditingActivity(activity); setIsAddModalOpen(true); };
  const closeAddModal = () => { setEditingActivity(null); setIsAddModalOpen(false); };
  const handleActivitySaved = () => { invalidateQueries(['activities']); invalidateQueries(['dashboard', 'faculty']); closeAddModal(); };
  const handleSignOut = async () => { try { await signOut(); } finally { clearQueryCache(); navigate('/'); } };
  const handleGlobalSearch = (value) => {
    if (currentRole === 'Faculty') {
      setActivitySearch(value);
      setCurrentView('activities');
    }
  };

  if (authLoading) return <div className="min-h-screen bg-[#FAF9F7] p-8"><div className="mx-auto max-w-7xl space-y-6"><div className="h-14 animate-pulse rounded-2xl bg-white" /><div className="h-[70vh] animate-pulse rounded-3xl bg-white" /></div></div>;
  if (authError || !profile) return <div className="min-h-screen bg-[#FAF9F7] p-6"><ErrorState message={authError || 'No authenticated profile was returned.'} onRetry={loadAuth} /></div>;

  return <div className="min-h-screen bg-[#FAF9F7] font-sans antialiased text-slate-900 selection:bg-orange-200 selection:text-orange-950">
    <Header profile={profile} currentRole={currentRole} setCurrentView={setCurrentView} onSearch={handleGlobalSearch} onOpenAddModal={() => openAddModal()} isSidebarOpen={isSidebarOpen} setIsSidebarOpen={setIsSidebarOpen} onSignOut={handleSignOut} />
    <div className="mx-auto flex min-h-[calc(100vh-72px)] w-full max-w-[1440px]">
      <Sidebar profile={profile} currentView={currentView} setCurrentView={setCurrentView} currentRole={currentRole} isSidebarOpen={isSidebarOpen} />
      <main className="min-w-0 flex-1 overflow-y-auto p-4 transition-all duration-300 sm:p-6 lg:p-8">
        {currentRole === 'Admin' && currentView === 'admin' && <AdminPanel />}
        {currentRole === 'Faculty' && currentView === 'dashboard' && <DashboardOverview profile={profile} setCurrentView={setCurrentView} onOpenAddModal={() => openAddModal()} />}
        {currentRole === 'Faculty' && currentView === 'activities' && <ActivitiesSubmissions initialQuery={activitySearch} setCurrentView={setCurrentView} onOpenAddModal={openAddModal} />}
        {currentRole === 'Faculty' && currentView === 'profile' && <ProfilePage />}
        {currentRole === 'Faculty' && currentView === 'evidence' && <EvidencePage />}
        {currentRole === 'Faculty' && currentView === 'appraisal' && <AppraisalPage />}
        {currentRole === 'Faculty' && currentView === 'reconstruct' && <ReconstructMyYear setCurrentView={setCurrentView} />}
        {currentRole === 'Faculty' && ['reports', 'calendar', 'messages'].includes(currentView) && <div className="rounded-3xl border border-slate-200/80 bg-white p-8 text-center shadow-xs"><div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-orange-100 text-[#FD6F3B]">{currentView === 'reports' ? <BarChart3 className="h-7 w-7" /> : currentView === 'messages' ? <MessageSquare className="h-7 w-7" /> : currentView === 'calendar' ? <Calendar className="h-7 w-7" /> : <FolderArchive className="h-7 w-7" />}</div><h2 className="mt-4 text-xl font-extrabold text-slate-900">{currentView === 'reports' ? 'Reports' : currentView === 'calendar' ? 'Academic Calendar' : 'Messages'}</h2><p className="mx-auto mt-2 max-w-md text-sm text-slate-500">This area is deferred outside today’s compulsory scope.</p><button onClick={() => setCurrentView('dashboard')} className="mt-5 rounded-xl bg-slate-100 px-4 py-2 text-sm font-bold text-slate-700 hover:bg-slate-200">Back to dashboard</button></div>}
      </main>
    </div>
    {currentRole === 'Faculty' && <AddActivityModal isOpen={isAddModalOpen} activity={editingActivity} onClose={closeAddModal} onAddSuccess={handleActivitySaved} />}
  </div>;
}
