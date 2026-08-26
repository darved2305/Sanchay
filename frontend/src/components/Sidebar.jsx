import React from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Award, Bot, CalendarPlus, FileCheck, FileUp, FolderArchive, GitCompare, GraduationCap, Inbox, Layers, LayoutDashboard, RefreshCw, Send, Sparkles, TrendingUp, Users, UserRound, X, Zap } from 'lucide-react';
import { Avatar } from './ui';

function displayName(profile) { return profile?.full_name || profile?.name || profile?.faculty_profile?.full_name || 'Faculty member'; }

const FACULTY_NAV = [
  { id: 'dashboard', label: 'Overview', icon: LayoutDashboard },
  { id: 'assistant', label: 'Assistant', icon: Bot },
  { id: 'activities', label: 'Activities & Record', icon: Layers },
  { id: 'action-inbox', label: 'Action Inbox', icon: Inbox },
  { id: 'grantops', label: 'GrantOps', icon: Award },
  { id: 'reconstruct', label: 'Reconstruct My Year', icon: RefreshCw },
  { id: 'forms', label: 'Any Form Assistant', icon: Sparkles },
  { id: 'rescue', label: 'Deadline Rescue', icon: Zap },
  { id: 'cv-import', label: 'Import Old Records', icon: FileUp },
  { id: 'career', label: 'Career Growth', icon: TrendingUp },
  { id: 'teaching-change', label: 'Teaching Change', icon: GitCompare },
  { id: 'lor-studio', label: 'LOR Studio', icon: GraduationCap },
  { id: 'community', label: 'Community', icon: Users },
  { id: 'appraisal', label: 'Self-Appraisal', icon: FileCheck },
  { id: 'evidence', label: 'Evidence Library', icon: FolderArchive },
  { id: 'profile', label: 'My Profile', icon: UserRound },
];
const ADMIN_NAV = [
  { id: 'admin', label: 'Admin Action Center', icon: LayoutDashboard },
  { id: 'admin-events', label: 'Institution Events', icon: CalendarPlus },
  { id: 'admin-requests', label: 'Requests & Reports', icon: Send },
];

function NavItems({ navItems, currentView, onSelect, collapsed }) {
  return (
    <nav className="space-y-1.5" aria-label="Primary">
      {navItems.map((item) => {
        const Icon = item.icon;
        const active = currentView === item.id;
        return (
          <button
            key={item.id}
            type="button"
            onClick={() => onSelect(item.id)}
            title={collapsed ? item.label : undefined}
            aria-current={active ? 'page' : undefined}
            className={`group flex w-full items-center rounded-[var(--radius-control)] text-left text-sm font-bold transition ${
              active
                ? 'bg-[var(--brand-primary-soft)] text-[var(--brand-primary-hover)] shadow-[inset_3px_0_0_var(--brand-primary)]'
                : 'text-[var(--brand-text)] hover:bg-[var(--brand-surface)] hover:text-[var(--brand-primary-hover)]'
            } ${collapsed ? 'mx-auto h-11 w-11 justify-center' : 'gap-3 px-3 py-3'}`}
          >
            <Icon className="h-[18px] w-[18px] shrink-0" aria-hidden="true" />
            {!collapsed && <span>{item.label}</span>}
          </button>
        );
      })}
    </nav>
  );
}

function ProfileBlock({ profile, collapsed }) {
  const name = displayName(profile);
  const avatar = profile?.avatar_url || profile?.photo_url || profile?.faculty_profile?.photo_url;
  if (collapsed) {
    return <div className="flex justify-center"><Avatar name={name} src={avatar} size="h-10 w-10" /></div>;
  }
  return (
    <div className="app-surface flex items-center gap-3 !rounded-2xl p-3">
      <Avatar name={name} src={avatar} size="h-10 w-10" />
      <div className="min-w-0">
        <h3 className="truncate text-sm font-bold text-[var(--brand-ink)]">{name}</h3>
        <p className="truncate text-xs text-[var(--brand-muted)]">{profile?.designation || profile?.title || 'Faculty member'}</p>
      </div>
    </div>
  );
}

export default function Sidebar({ profile, currentView, setCurrentView, currentRole, isSidebarOpen, isMobileOpen, onCloseMobile }) {
  const navItems = currentRole === 'Admin' ? ADMIN_NAV : FACULTY_NAV;
  const select = (id) => { setCurrentView(id); onCloseMobile?.(); };

  return (
    <>
      {/* Desktop / tablet sidebar */}
      <aside
        className={`hidden h-full shrink-0 flex-col justify-between overflow-y-auto border-r border-[var(--brand-border-soft)] bg-[var(--brand-canvas)] px-3 py-5 transition-all duration-300 lg:flex ${
          isSidebarOpen ? 'w-60' : 'w-[76px]'
        }`}
      >
        <div className="space-y-7">
          <ProfileBlock profile={profile} collapsed={!isSidebarOpen} />
          <NavItems navItems={navItems} currentView={currentView} onSelect={select} collapsed={!isSidebarOpen} />
        </div>
        {isSidebarOpen && currentRole !== 'Admin' && (
          <div className="rounded-[var(--radius-card)] border border-[var(--brand-lavender-strong)] bg-[var(--brand-primary-softer)] p-4">
            <p className="text-xs font-semibold leading-relaxed text-[var(--brand-muted)]">Your record, evidence and appraisal stay connected.</p>
            <button type="button" onClick={() => select('profile')} className="mt-3 text-xs font-bold text-[var(--brand-primary-hover)] hover:underline">
              Keep profile current →
            </button>
          </div>
        )}
      </aside>

      {/* Mobile drawer navigation */}
      <AnimatePresence>
        {isMobileOpen && (
          <div className="fixed inset-0 z-40 lg:hidden" role="dialog" aria-modal="true" aria-label="Navigation">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.18 }}
              className="absolute inset-0 bg-[rgb(28_27_32_/_35%)] backdrop-blur-[2px]"
              onClick={onCloseMobile}
            />
            <motion.aside
              initial={{ x: -280 }}
              animate={{ x: 0 }}
              exit={{ x: -280 }}
              transition={{ type: 'spring', damping: 30, stiffness: 320 }}
              className="absolute left-0 top-0 flex h-full w-72 max-w-[85vw] flex-col gap-6 overflow-y-auto border-r border-[var(--brand-border-soft)] bg-[var(--brand-canvas)] p-4"
            >
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold uppercase tracking-wider text-[var(--brand-subtle)]">Menu</span>
                <button
                  type="button"
                  onClick={onCloseMobile}
                  aria-label="Close navigation"
                  className="rounded-[var(--radius-control)] p-2 text-[var(--brand-muted)] transition hover:bg-[var(--brand-surface-muted)]"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>
              <ProfileBlock profile={profile} collapsed={false} />
              <NavItems navItems={navItems} currentView={currentView} onSelect={select} collapsed={false} />
            </motion.aside>
          </div>
        )}
      </AnimatePresence>
    </>
  );
}
