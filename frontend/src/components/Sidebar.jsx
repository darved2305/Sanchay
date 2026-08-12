import React from 'react';
import { FileCheck, FolderArchive, Layers, LayoutDashboard, RefreshCw, UserRound } from 'lucide-react';

function displayName(profile) {
  return profile?.full_name || profile?.name || profile?.faculty_profile?.full_name || 'Faculty member';
}

function initials(name) {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join('').toUpperCase() || 'F';
}

export default function Sidebar({ profile, currentView, setCurrentView, currentRole, isSidebarOpen }) {
  const name = displayName(profile);
  const avatar = profile?.avatar_url || profile?.photo_url || profile?.faculty_profile?.photo_url;
  const facultyNavItems = [
    { id: 'dashboard', label: 'Overview / Dashboard', icon: LayoutDashboard },
    { id: 'activities', label: 'Activities / Record', icon: Layers },
    { id: 'reconstruct', label: 'Reconstruct My Year', icon: RefreshCw },
    { id: 'appraisal', label: 'Self-Appraisal', icon: FileCheck },
    { id: 'evidence', label: 'Evidence Library', icon: FolderArchive },
    { id: 'profile', label: 'My Profile', icon: UserRound },
  ];
  const adminNavItems = [{ id: 'admin', label: 'Admin Dashboard', icon: LayoutDashboard }];
  const navItems = currentRole === 'Admin' ? adminNavItems : facultyNavItems;

  return (
    <aside className={`hidden min-h-[calc(100vh-72px)] shrink-0 select-none flex-col justify-between border-r border-slate-200/80 bg-white p-4 transition-all duration-300 lg:flex ${isSidebarOpen ? 'w-72' : 'w-20'}`}>
      <div className="space-y-6">
        {isSidebarOpen && <p className="px-1 text-xs font-extrabold uppercase tracking-wider text-slate-400">Navigation Menu</p>}
        <div className={`transition-all ${isSidebarOpen ? 'flex items-center gap-3.5 rounded-2xl border border-slate-200/80 bg-slate-50/90 p-3' : 'flex justify-center'}`}>
          {avatar ? <img src={avatar} alt={name} className="h-11 w-11 shrink-0 rounded-full border-2 border-orange-300 object-cover shadow-xs" /> : <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full border-2 border-orange-300 bg-orange-100 font-extrabold text-[#E05320]">{initials(name)}</span>}
          {isSidebarOpen && <div className="min-w-0 flex-1"><h3 className="truncate text-base font-bold text-slate-900">{name}</h3><p className="truncate text-sm text-slate-500">{profile?.designation || profile?.title || 'Faculty member'}</p><span className="mt-1 inline-block rounded-full border border-orange-200/60 bg-[#FFF4F0] px-2.5 py-0.5 text-xs font-bold text-[#FD6F3B]">{currentRole}</span></div>}
        </div>
        <nav className="space-y-1.5">{navItems.map((item) => { const Icon = item.icon; const active = currentView === item.id; return <button key={item.id} onClick={() => setCurrentView(item.id)} title={!isSidebarOpen ? item.label : undefined} className={`group flex w-full items-center rounded-2xl text-left text-base font-bold transition-all ${active ? 'bg-[#FD6F3B] text-white shadow-md shadow-orange-500/25' : 'text-slate-700 hover:bg-orange-50/70 hover:text-[#FD6F3B]'} ${isSidebarOpen ? 'justify-between px-4 py-3' : 'mx-auto h-11 w-11 justify-center p-0'}`}><span className="flex items-center gap-3.5"><Icon className="h-5 w-5 shrink-0 transition-transform group-hover:scale-110" />{isSidebarOpen && <span>{item.label}</span>}</span>{isSidebarOpen && item.id === 'appraisal' && <span className={`rounded-md px-1.5 py-0.5 text-[10px] ${active ? 'bg-white/20 text-white' : 'bg-orange-100 text-[#E05320]'}`}>P0</span>}</button>; })}</nav>
      </div>
      {isSidebarOpen && <div className="space-y-3 border-t border-slate-100 pt-4"><p className="px-1 text-xs font-semibold leading-relaxed text-slate-400">Your record, evidence and appraisal stay connected to the institution API.</p><button onClick={() => setCurrentView('profile')} className="w-full rounded-xl border border-orange-200 bg-[#FFF4F0] px-3 py-2.5 text-left text-sm font-bold text-[#E05320] hover:bg-orange-100">Keep profile current</button></div>}
    </aside>
  );
}
