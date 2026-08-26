import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { BarChart3, Calendar, FolderArchive } from 'lucide-react';
import Header from '../components/Header';
import Sidebar from '../components/Sidebar';
import DashboardOverview from './DashboardOverview';
import ActivitiesSubmissions from './ActivitiesSubmissions';
import ActionInboxPage from './ActionInboxPage';
import GrantOpsPage from './GrantOpsPage';
import ReconstructMyYear from './ReconstructMyYear';
import CvImportPage from './CvImportPage';
import CareerGrowthPage from './CareerGrowthPage';
import AnyFormPage from './AnyFormPage';
import DeadlineRescuePage from './DeadlineRescuePage';
import AdminPanel from './AdminPanel';
import AdminInstitutionEvents from './AdminInstitutionEvents';
import AdminRequestsReports from './AdminRequestsReports';
import TeachingChangePage from './TeachingChangePage';
import LorStudioPage from './LorStudioPage';
import CommunityPage from './CommunityPage';
import ProfilePage from './ProfilePage';
import EvidencePage from './EvidencePage';
import AppraisalPage from './AppraisalPage';
import AssistantPage from './AssistantPage';
import AddActivityModal from '../components/AddActivityModal';
import QuickAddModal from '../components/QuickAddModal';
import { Button, EmptyState, Skeleton } from '../components/ui';
import { api, payloadData } from '../lib/api';
import { clearQueryCache, invalidateQueries } from '../lib/queryCache';
import { getSession, signOut } from '../lib/supabase';
import { runtimeConfigMessage } from '../lib/config';
import { useFacultyRealtime } from '../lib/realtime';

const REALTIME_QUERY_KEYS = [
  ['dashboard', 'faculty'], ['activities'], ['evidence'], ['appraisal'], ['notifications'], ['admin'],
  ['career'], ['lor'], ['reconstruct'], ['teaching'], ['community'], ['action-inbox'], ['grantops'],
];

function AuthError({ message, onRetry }) {
  return (
    <div className="flex min-h-[60vh] items-center justify-center p-6">
      <EmptyState
        title="Sign-in required"
        detail={message}
        action={
          <div className="flex justify-center gap-2">
            <Button variant="primary" onClick={onRetry}>Retry</Button>
            <Button variant="secondary" onClick={() => { window.location.href = '/login'; }}>Go to login</Button>
          </div>
        }
      />
    </div>
  );
}

function ShellSkeleton() {
  return (
    <div className="min-h-screen p-6 sm:p-8">
      <div className="mx-auto max-w-7xl space-y-6">
        <Skeleton className="h-14" />
        <Skeleton className="h-[60vh] !rounded-[var(--radius-panel)]" />
      </div>
    </div>
  );
}

const DEFERRED_VIEWS = {
  reports: { label: 'Reports', icon: BarChart3 },
  calendar: { label: 'Academic Calendar', icon: Calendar },
};

export default function DashboardApp() {
  const navigate = useNavigate();
  const [profile, setProfile] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [authError, setAuthError] = useState('');
  const [currentView, setCurrentView] = useState('dashboard');
  // Latches on the first visit to the Assistant so it is never mounted for
  // users who don't open it, but is never unmounted afterwards either.
  const [assistantOpened, setAssistantOpened] = useState(false);
  useEffect(() => {
    if (currentView === 'assistant') setAssistantOpened(true);
  }, [currentView]);
  const [activitySearch, setActivitySearch] = useState('');
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [editingActivity, setEditingActivity] = useState(null);
  const [isQuickAddOpen, setIsQuickAddOpen] = useState(false);
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const [isMobileNavOpen, setIsMobileNavOpen] = useState(false);

  const loadAuth = async () => {
    setAuthLoading(true); setAuthError('');
    try {
      const session = await getSession();
      if (!session?.access_token) throw new Error('Your session has expired. Please sign in again.');
      const authMe = payloadData(await api.authMe());
      const nextProfile = payloadData(authMe.profile) || payloadData(await api.profile());
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
  const handleQuickAddConfirmed = () => { invalidateQueries(['activities']); invalidateQueries(['dashboard', 'faculty']); };
  const handleSignOut = async () => { try { await signOut(); } finally { clearQueryCache(); navigate('/'); } };
  const handleGlobalSearch = (value) => {
    if (currentRole === 'Faculty') {
      setActivitySearch(value);
      setCurrentView('activities');
    }
  };

  if (authLoading) return <ShellSkeleton />;
  if (authError || !profile) return <AuthError message={authError || 'No authenticated profile was returned.'} onRetry={loadAuth} />;

  const DeferredIcon = DEFERRED_VIEWS[currentView]?.icon || FolderArchive;

  return (
    <div className="app-shell antialiased">
      <Header
        profile={profile}
        currentRole={currentRole}
        setCurrentView={setCurrentView}
        onSearch={handleGlobalSearch}
        onOpenAddModal={() => openAddModal()}
        onOpenQuickAdd={() => setIsQuickAddOpen(true)}
        isSidebarOpen={isSidebarOpen}
        setIsSidebarOpen={setIsSidebarOpen}
        onOpenMobileNav={() => setIsMobileNavOpen(true)}
        onSignOut={handleSignOut}
      />
      <div className="app-shell-row mx-auto w-full max-w-[1440px]">
        <Sidebar
          profile={profile}
          currentView={currentView}
          setCurrentView={setCurrentView}
          currentRole={currentRole}
          isSidebarOpen={isSidebarOpen}
          isMobileOpen={isMobileNavOpen}
          onCloseMobile={() => setIsMobileNavOpen(false)}
        />
        <main className="app-shell-main p-4 transition-all duration-300 sm:p-6 lg:p-8">
          {currentRole === 'Admin' && currentView === 'admin' && <AdminPanel />}
          {currentRole === 'Admin' && currentView === 'admin-events' && <AdminInstitutionEvents />}
          {currentRole === 'Admin' && currentView === 'admin-requests' && <AdminRequestsReports />}
          {currentRole === 'Faculty' && currentView === 'dashboard' && <DashboardOverview profile={profile} setCurrentView={setCurrentView} onOpenAddModal={() => openAddModal()} />}
          {/* The Assistant stays mounted once opened, and is hidden rather than
              unmounted when another view is active. A turn can take tens of
              seconds; unmounting mid-flight abandoned the request and dropped
              the conversation back to an empty one on return. */}
          {currentRole === 'Faculty' && assistantOpened && (
            <div className={currentView === 'assistant' ? undefined : 'hidden'} aria-hidden={currentView !== 'assistant'}>
              <AssistantPage setCurrentView={setCurrentView} />
            </div>
          )}
          {currentRole === 'Faculty' && currentView === 'activities' && <ActivitiesSubmissions initialQuery={activitySearch} setCurrentView={setCurrentView} onOpenAddModal={openAddModal} />}
          {currentRole === 'Faculty' && currentView === 'action-inbox' && <ActionInboxPage />}
          {currentRole === 'Faculty' && currentView === 'grantops' && <GrantOpsPage />}
          {currentRole === 'Faculty' && currentView === 'profile' && <ProfilePage />}
          {currentRole === 'Faculty' && currentView === 'evidence' && <EvidencePage />}
          {currentRole === 'Faculty' && currentView === 'appraisal' && <AppraisalPage />}
          {currentRole === 'Faculty' && currentView === 'reconstruct' && <ReconstructMyYear setCurrentView={setCurrentView} />}
          {currentRole === 'Faculty' && currentView === 'cv-import' && <CvImportPage setCurrentView={setCurrentView} />}
          {currentRole === 'Faculty' && currentView === 'career' && <CareerGrowthPage />}
          {currentRole === 'Faculty' && currentView === 'teaching-change' && <TeachingChangePage setCurrentView={setCurrentView} />}
          {currentRole === 'Faculty' && currentView === 'lor-studio' && <LorStudioPage setCurrentView={setCurrentView} />}
          {currentRole === 'Faculty' && currentView === 'community' && <CommunityPage />}
          {currentRole === 'Faculty' && currentView === 'forms' && <AnyFormPage setCurrentView={setCurrentView} />}
          {currentRole === 'Faculty' && currentView === 'rescue' && <DeadlineRescuePage setCurrentView={setCurrentView} />}
          {currentRole === 'Faculty' && DEFERRED_VIEWS[currentView] && (
            <div className="app-surface">
              <EmptyState
                icon={DeferredIcon}
                title={DEFERRED_VIEWS[currentView].label}
                detail="This area is deferred outside today's compulsory scope."
                action={<Button variant="secondary" onClick={() => setCurrentView('dashboard')}>Back to dashboard</Button>}
              />
            </div>
          )}
        </main>
      </div>
      {currentRole === 'Faculty' && <AddActivityModal isOpen={isAddModalOpen} activity={editingActivity} onClose={closeAddModal} onAddSuccess={handleActivitySaved} />}
      {currentRole === 'Faculty' && (
        <QuickAddModal isOpen={isQuickAddOpen} onClose={() => setIsQuickAddOpen(false)} onConfirmed={handleQuickAddConfirmed} />
      )}
    </div>
  );
}
