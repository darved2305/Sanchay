import React, { useState } from 'react';
import { Bell, ChevronDown, LogOut, PanelLeft, PanelLeftClose, Plus, Search } from 'lucide-react';
import { api, listItems } from '../lib/api';
import { useApiQuery, invalidateQueries } from '../lib/queryCache';

function displayName(profile) {
  return profile?.full_name || profile?.name || profile?.faculty_profile?.full_name || 'Faculty member';
}

function initials(name) {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join('').toUpperCase() || 'F';
}

function profileRole(profile) {
  return ['admin', 'dept_admin', 'institution_admin', 'reviewer'].includes(profile?.role) ? 'Administrator' : 'Faculty';
}

export default function Header({ profile, currentRole, setCurrentView, onOpenAddModal, onSearch, isSidebarOpen, setIsSidebarOpen, onSignOut }) {
  const [showNotifications, setShowNotifications] = useState(false);
  const [showProfileMenu, setShowProfileMenu] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const name = displayName(profile);
  const notifications = useApiQuery(['notifications', { unread: true }], () => api.notifications({ unread: true }));
  const notificationItems = listItems(notifications.data);
  const unreadCount = notifications.data?.unread_count ?? notifications.data?.count ?? notificationItems.length;
  const avatar = profile?.avatar_url || profile?.photo_url || profile?.faculty_profile?.photo_url;

  const goHome = () => {
    setCurrentView(currentRole === 'Admin' ? 'admin' : 'dashboard');
    setShowProfileMenu(false);
  };

  const markNotificationsRead = async () => {
    if (!unreadCount) return;
    try {
      await api.markNotificationsRead({ all: true });
      invalidateQueries(['notifications']);
    } catch {
      // The list remains visible; the next realtime/poll refresh will retry.
    }
  };

  return (
    <header className="sticky top-0 z-30 border-b border-slate-200/80 bg-white/95 px-4 py-4 backdrop-blur-md transition-all sm:px-6">
      <div className="mx-auto flex max-w-7xl items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <button onClick={() => setIsSidebarOpen(!isSidebarOpen)} title={isSidebarOpen ? 'Collapse Sidebar' : 'Expand Sidebar'} className="flex items-center justify-center rounded-2xl border border-slate-200/80 p-2.5 text-slate-700 transition-all hover:bg-orange-50/80 hover:text-[#FD6F3B]">
            {isSidebarOpen ? <PanelLeftClose className="h-5 w-5 text-[#FD6F3B]" /> : <PanelLeft className="h-5 w-5" />}
          </button>
          <button onClick={goHome} className="group flex items-center gap-3 text-left">
            <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-gradient-to-tr from-[#FD6F3B] via-orange-500 to-amber-500 shadow-md shadow-orange-500/20 transition-transform group-hover:scale-105"><div className="h-5 w-5 rotate-45 rounded-md border-2 border-white/90 border-t-transparent" /></div>
            <div><span className="bg-gradient-to-r from-slate-900 via-orange-950 to-slate-900 bg-clip-text text-xl font-extrabold tracking-tight text-transparent">Sanchaya</span><p className="text-base font-semibold tracking-tight text-slate-500">Your Impact. Clearly.</p></div>
          </button>
        </div>

        <form className="hidden max-w-md flex-1 items-center md:flex md:mx-4" onSubmit={(event) => { event.preventDefault(); onSearch?.(searchQuery.trim()); }}>
          <div className="relative w-full"><Search className="absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-slate-400" /><input type="search" value={searchQuery} onChange={(event) => setSearchQuery(event.target.value)} placeholder="Search activities, publications, evidence..." className="w-full rounded-full border border-slate-200 bg-slate-100/70 py-2.5 pl-11 pr-4 text-base font-medium text-slate-900 placeholder-slate-400 focus:border-[#FD6F3B] focus:outline-none focus:ring-2 focus:ring-[#FD6F3B]/20" aria-label="Search activities" /></div>
        </form>

        <div className="flex items-center gap-2 sm:gap-3">
          {currentRole !== 'Admin' && <button onClick={() => onOpenAddModal?.()} className="hidden items-center gap-2 rounded-xl bg-[#FD6F3B] px-4 py-2 text-base font-bold text-white shadow-sm transition-all hover:bg-[#E05320] sm:flex"><Plus className="h-4 w-4" />Add Activity</button>}

          <div className="relative">
            <button onClick={() => { setShowNotifications((value) => !value); markNotificationsRead(); }} aria-label="Notifications" className="relative rounded-full p-2.5 text-slate-600 transition-all hover:bg-slate-100 hover:text-slate-900"><Bell className="h-5 w-5" />{unreadCount > 0 && <span className="absolute right-1.5 top-1.5 flex min-h-2.5 min-w-2.5 items-center justify-center rounded-full bg-[#FD6F3B] px-1 text-[9px] font-extrabold text-white ring-2 ring-white">{unreadCount > 9 ? '9+' : unreadCount}</span>}</button>
            {showNotifications && <div className="absolute right-0 z-50 mt-2 w-80 rounded-2xl border border-slate-200 bg-white p-4 shadow-xl"><div className="flex items-center justify-between border-b border-slate-100 pb-2.5"><h4 className="text-xs font-bold uppercase tracking-wider text-slate-900">Notifications</h4><button onClick={markNotificationsRead} className="text-xs font-bold text-[#FD6F3B]">Mark read</button></div><div className="divide-y divide-slate-100 text-sm">{notifications.loading && <p className="py-4 text-slate-500">Loading notifications…</p>}{notifications.error && <p className="py-4 text-red-600">Unable to load notifications.</p>}{!notifications.loading && !notifications.error && notificationItems.length === 0 && <p className="py-4 text-slate-500">You have no new notifications.</p>}{notificationItems.slice(0, 5).map((item) => <div key={item.id} className="py-3"><p className="font-bold text-slate-900">{item.title || item.kind || 'Notification'}</p><p className="mt-0.5 text-slate-500">{item.body || item.message || 'You have an update.'}</p></div>)}</div></div>}
          </div>

          <div className="relative">
            <button onClick={() => setShowProfileMenu((value) => !value)} className="flex items-center gap-3 rounded-2xl p-1 text-left transition-all hover:bg-slate-100">
              {avatar ? <img src={avatar} alt={name} className="h-10 w-10 rounded-full border-2 border-orange-200 object-cover shadow-xs" /> : <span className="flex h-10 w-10 items-center justify-center rounded-full border-2 border-orange-200 bg-orange-100 font-extrabold text-[#E05320]">{initials(name)}</span>}
              <div className="hidden lg:block"><p className="text-base font-bold leading-tight text-slate-900">{name}</p><p className="text-sm leading-tight text-slate-500">{profile?.designation || profile?.title || profileRole(profile)}</p></div>
              <ChevronDown className="hidden h-4 w-4 text-slate-400 lg:block" />
            </button>
            {showProfileMenu && <div className="absolute right-0 z-50 mt-2 w-64 rounded-2xl border border-slate-200 bg-white p-3.5 shadow-xl"><div className="mb-2 rounded-xl bg-[#FFF4F0] px-3.5 py-2.5"><p className="text-base font-bold text-orange-950">{name}</p><p className="break-all text-sm font-medium text-[#E05320]">{profile?.email || 'Signed-in account'}</p><span className="mt-1.5 inline-block rounded-full bg-orange-100 px-2.5 py-0.5 text-xs font-bold text-orange-900">{profileRole(profile)}</span></div><div className="space-y-1 text-base font-bold text-slate-700"><button onClick={goHome} className="w-full rounded-xl px-3.5 py-2.5 text-left transition-colors hover:bg-slate-100">Dashboard Home</button>{currentRole !== 'Admin' && <button onClick={() => { setCurrentView('profile'); setShowProfileMenu(false); }} className="w-full rounded-xl px-3.5 py-2.5 text-left transition-colors hover:bg-slate-100">My Profile</button>}<button onClick={() => { setShowProfileMenu(false); onSignOut?.(); }} className="flex w-full items-center gap-2 rounded-xl px-3.5 py-2.5 text-left text-red-600 transition-colors hover:bg-red-50"><LogOut className="h-4 w-4" />Sign Out</button></div></div>}
          </div>
        </div>
      </div>
    </header>
  );
}
