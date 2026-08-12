import React, { useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { FileCheck, FolderArchive, BarChart3, Calendar, MessageSquare } from 'lucide-react';
import Header from '../components/Header';
import Sidebar from '../components/Sidebar';
import DashboardOverview from './DashboardOverview';
import ActivitiesSubmissions from './ActivitiesSubmissions';
import ReconstructMyYear from './ReconstructMyYear';
import AdminPanel from './AdminPanel';
import AddActivityModal from '../components/AddActivityModal';

export default function DashboardApp() {
  const location = useLocation();
  const navigate = useNavigate();
  const initialRole = location.state?.role === 'Admin' ? 'Admin' : 'Faculty';

  const [currentRole, setCurrentRole] = useState(initialRole);
  const [currentView, setCurrentView] = useState(initialRole === 'Admin' ? 'admin' : 'dashboard');
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);

  const handleAddActivity = (newActivity) => {
    console.log("New activity added:", newActivity);
  };

  const handleSignOut = () => {
    navigate('/');
  };

  return (
    <div className="min-h-screen bg-[#FAF9F7] text-slate-900 flex flex-col font-sans antialiased selection:bg-orange-200 selection:text-orange-950">

      {/* Persistent Modern Navigation Header */}
      <Header
        currentRole={currentRole}
        setCurrentRole={setCurrentRole}
        currentView={currentView}
        setCurrentView={setCurrentView}
        onOpenAddModal={() => setIsAddModalOpen(true)}
        isSidebarOpen={isSidebarOpen}
        setIsSidebarOpen={setIsSidebarOpen}
        onSignOut={handleSignOut}
      />

      {/* Main Layout Container (Sidebar + Page Canvas) */}
      <div className="flex-1 max-w-[1440px] w-full mx-auto flex">

        {/* Left Navigation Sidebar */}
        <Sidebar
          currentView={currentView}
          setCurrentView={setCurrentView}
          currentRole={currentRole}
          isSidebarOpen={isSidebarOpen}
        />

        {/* Main Viewport Content */}
        <main className="flex-1 p-4 sm:p-6 lg:p-8 min-w-0 overflow-y-auto transition-all duration-300">
          {currentView === 'dashboard' && (
            <DashboardOverview
              setCurrentView={setCurrentView}
              onOpenAddModal={() => setIsAddModalOpen(true)}
            />
          )}

          {currentView === 'activities' && (
            <ActivitiesSubmissions
              setCurrentView={setCurrentView}
              onOpenAddModal={() => setIsAddModalOpen(true)}
            />
          )}

          {currentView === 'reconstruct' && (
            <ReconstructMyYear
              setCurrentView={setCurrentView}
            />
          )}

          {currentView === 'admin' && (
            <AdminPanel />
          )}

          {(currentView === 'appraisal' || currentView === 'evidence' || currentView === 'reports' || currentView === 'calendar' || currentView === 'messages') && (
            <div className="space-y-6">
              <div className="p-6 bg-white rounded-3xl border border-slate-200/80 shadow-xs text-center space-y-4">
                <div className="w-16 h-16 bg-orange-100 text-[#FD6F3B] rounded-2xl flex items-center justify-center mx-auto">
                  {currentView === 'appraisal' ? <FileCheck className="w-7 h-7" /> :
                   currentView === 'evidence' ? <FolderArchive className="w-7 h-7" /> :
                   currentView === 'reports' ? <BarChart3 className="w-7 h-7" /> :
                   currentView === 'messages' ? <MessageSquare className="w-7 h-7" /> :
                   <Calendar className="w-7 h-7" />}
                </div>
                <h2 className="text-xl font-extrabold text-slate-900 capitalize">
                  {currentView === 'appraisal' ? 'Self-Appraisal Form 2024-25' :
                   currentView === 'evidence' ? 'Evidence & Proof Library' :
                   currentView === 'reports' ? 'Institutional & Personal Reports' :
                   currentView === 'calendar' ? 'Academic Calendar & Deadlines' : 'Faculty Messages'}
                </h2>
                <p className="text-base text-slate-500 max-w-md mx-auto">
                  Consolidated digital portal for paperless faculty evaluation and academic documentation.
                </p>
                <div className="pt-2 flex justify-center gap-3">
                  <button
                    onClick={() => setCurrentView('activities')}
                    className="px-4 py-2 bg-[#FD6F3B] text-white font-bold text-base rounded-xl hover:bg-[#E05320] transition-all"
                  >
                    Go to Activities & Submissions
                  </button>
                  <button
                    onClick={() => setCurrentView('dashboard')}
                    className="px-4 py-2 bg-slate-100 text-slate-700 font-bold text-base rounded-xl hover:bg-slate-200 transition-all"
                  >
                    Back to Dashboard Overview
                  </button>
                </div>
              </div>
            </div>
          )}
        </main>

      </div>

      {/* Global Interactive Modal for Logging Activity */}
      <AddActivityModal
        isOpen={isAddModalOpen}
        onClose={() => setIsAddModalOpen(false)}
        onAddActivity={handleAddActivity}
      />

    </div>
  );
}
