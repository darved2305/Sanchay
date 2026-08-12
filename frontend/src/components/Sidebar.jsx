import React from 'react';
import { 
  LayoutDashboard, 
  Layers, 
  FileCheck, 
  FolderArchive, 
  BarChart3, 
  Calendar, 
  Settings, 
  ShieldCheck, 
  RefreshCw, 
  MessageSquare,
  ChevronRight,
  Headphones
} from 'lucide-react';
import { currentFaculty, adminUser } from '../data/mockData';

export default function Sidebar({ currentView, setCurrentView, currentRole, isSidebarOpen }) {
  const activeUser = currentRole === 'Admin' ? adminUser : currentFaculty;

  const facultyNavItems = [
    { id: 'dashboard', label: 'Overview / Dashboard', icon: LayoutDashboard },
    { id: 'activities', label: 'Activities/Submissions', icon: Layers },
    { id: 'reconstruct', label: 'Reconstruct My Year', icon: RefreshCw},
    { id: 'appraisal', label: 'Self-Appraisal 2026', icon: FileCheck },
    { id: 'evidence', label: 'Evidence Library', icon: FolderArchive },
    { id: 'reports', label: 'Reports & Analytics', icon: BarChart3 },
    { id: 'calendar', label: 'Academic Calendar', icon: Calendar },
    { id: 'messages', label: 'Messages', icon: MessageSquare, count: 3 },
  ];

  const adminNavItems = [
    { id: 'admin', label: 'Admin Dashboard', icon: ShieldCheck },
    { id: 'faculty-list', label: 'Faculty Appraisals', icon: Layers },
    { id: 'reports', label: 'Institutional Reports', icon: BarChart3 },
    { id: 'settings', label: 'System Settings', icon: Settings },
  ];

  const navItems = currentRole === 'Admin' ? adminNavItems : facultyNavItems;

  return (
    <aside className={`shrink-0 hidden lg:block bg-white border-r border-slate-200/80 p-4 min-h-[calc(100vh-72px)] flex flex-col justify-between select-none transition-all duration-300 ${
      isSidebarOpen ? 'w-72' : 'w-19'
    }`}>
      <div className="space-y-6">
        
        {/* Section Label */}
        {isSidebarOpen && (
          <p className="px-1 text-xs font-extrabold text-slate-400 uppercase tracking-wider">
            Navigation Menu
          </p>
        )}

        {/* User Profile Summary Card */}
        <div className={`transition-all ${
          isSidebarOpen
            ? 'p-3 bg-slate-50/90 rounded-2xl border border-slate-200/80 flex items-center gap-3.5'
            : 'flex justify-center'
        }`}>
          <img 
            src={activeUser.avatar} 
            alt={activeUser.name} 
            className="rounded-full object-cover border-2 border-orange-300 shadow-xs shrink-0 w-11 h-11"
            title={`${activeUser.name} (${activeUser.title})`}
          />
          {isSidebarOpen && (
            <div className="min-w-0 flex-1">
              <h3 className="text-base font-bold text-slate-900 truncate">{activeUser.name}</h3>
              <p className="text-base text-slate-500 truncate">{activeUser.title}</p>
              <span className="inline-block mt-1 px-2.5 py-0.5 bg-[#FFF4F0] text-[#FD6F3B] font-bold text-xs rounded-full border border-orange-200/60">
                {currentRole}
              </span>
            </div>
          )}
        </div>

        {/* Navigation Items List with Increased Font Size & Icon Dimensions */}
        <nav className="space-y-1.5">
          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive = currentView === item.id;
            return (
              <button
                key={item.id}
                onClick={() => setCurrentView(item.id)}
                title={!isSidebarOpen ? item.label : undefined}
                className={`w-full flex items-center rounded-2xl text-base font-bold transition-all group ${
                  isActive
                    ? 'bg-[#FD6F3B] text-white shadow-md shadow-orange-500/25'
                    : 'text-slate-700 hover:text-[#FD6F3B] hover:bg-orange-50/70'
                } ${
                  !isSidebarOpen
                    ? 'justify-center w-11 h-11 mx-auto p-0'
                    : 'justify-between px-4 py-3'
                }`}
              >
                <div className="flex items-center gap-3.5">
                  <Icon className={`w-5 h-5 transition-transform group-hover:scale-110 shrink-0 ${
                    isActive ? 'text-white' : 'text-slate-500 group-hover:text-[#FD6F3B]'
                  }`} />
                  {isSidebarOpen && <span className="text-base font-bold">{item.label}</span>}
                </div>
                
                {isSidebarOpen && item.badge && (
                  <span className={`text-xs font-extrabold px-2 py-0.5 rounded-full uppercase ${isActive ? 'bg-white/20 text-white' : 'bg-orange-100 text-[#FD6F3B]'}`}>
                    {item.badge}
                  </span>
                )}
                {isSidebarOpen && item.count && (
                  <span className={`text-xs font-extrabold px-2 py-0.5 rounded-full ${isActive ? 'bg-white/20 text-white' : 'bg-orange-100 text-[#FD6F3B]'}`}>
                    {item.count}
                  </span>
                )}
              </button>
            );
          })}
        </nav>

        {/* Feature Promo Card: Reconstruct My Year (Full View Only) */}
        {isSidebarOpen && currentRole !== 'Admin' && (
          <div className="p-4 bg-gradient-to-br from-orange-50 via-amber-50 to-orange-100/70 rounded-2xl border border-orange-200/80 relative overflow-hidden group">
            <div className="flex items-center gap-2 mb-2 text-orange-950 font-bold text-base">
              <RefreshCw className="w-4 h-4 text-[#FD6F3B] animate-spin-slow" />
              <span>Reconstruct My Year</span>
            </div>
            <p className="text-base text-slate-600 leading-relaxed mb-3.5">
              Instantly rebuild your academic year from emails, calendars, and documents.
            </p>
            <button
              onClick={() => setCurrentView('reconstruct')}
              className="w-full py-2.5 px-4 bg-[#FD6F3B] hover:bg-[#E05320] text-white rounded-xl text-base font-bold shadow-sm flex items-center justify-center gap-2 transition-all"
            >
              <span>Start Now</span>
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        )}

        {/* Pro Tip Card (Full View Only) */}
        {isSidebarOpen && currentRole !== 'Admin' && (
          <div className="p-4 bg-amber-50/80 rounded-2xl border border-amber-200/80 text-base space-y-1">
            <div className="flex items-center gap-1.5 font-bold text-amber-950 text-base">
              <span>Pro Tip</span>
            </div>
            <p className="text-base text-amber-900 leading-relaxed">
              Log activities regularly to keep your impact visible and up to date.
            </p>
          </div>
        )}

      </div>

      {/* Footer / Profile completion & Support */}
      <div className="mt-6 pt-4 border-t border-slate-100 space-y-3">
        {isSidebarOpen && currentRole !== 'Admin' && (
          <div className="space-y-2 px-1">
            <div className="flex justify-between items-center text-base font-bold text-slate-700">
              <span>Profile Completion</span>
              <span className="text-[#FD6F3B]">80%</span>
            </div>
            <div className="w-full bg-slate-100 h-2.5 rounded-full overflow-hidden">
              <div className="bg-[#FD6F3B] h-full rounded-full w-[80%]"></div>
            </div>
            <button 
              onClick={() => setCurrentView('appraisal')}
              className="text-base text-[#FD6F3B] hover:text-[#E05320] font-bold inline-flex items-center gap-1 mt-1"
            >
              <span>Complete your profile</span>
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        )}

        <button 
          onClick={() => alert("Sanchaya Support: support@sanchaya.edu")}
          title={!isSidebarOpen ? "Contact Support" : undefined}
          className={`w-full flex items-center gap-2.5 px-3.5 py-2.5 text-base font-bold text-slate-600 hover:text-slate-900 hover:bg-slate-100 rounded-2xl transition-all ${
            !isSidebarOpen ? 'justify-center px-0 w-11 h-11 mx-auto' : ''
          }`}
        >
          <Headphones className={`w-5 h-5 shrink-0 ${!isSidebarOpen ? 'text-slate-600' : 'text-slate-400'}`} />
          {isSidebarOpen && <span>Need Help? Contact Support</span>}
        </button>
      </div>

    </aside>
  );
}
