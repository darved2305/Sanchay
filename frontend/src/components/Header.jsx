import React, { useState } from 'react';
import { Bell, ChevronDown, LogOut, Menu, PanelLeft, PanelLeftClose, Plus, Search, Sparkles } from 'lucide-react';
import Logo from './Logo';
import { Avatar } from './ui';
import { api, listItems } from '../lib/api';
import { useApiQuery, invalidateQueries } from '../lib/queryCache';

function displayName(profile) { return profile?.full_name || profile?.name || profile?.faculty_profile?.full_name || 'Faculty member'; }
function profileRole(profile) { return ['admin', 'dept_admin', 'institution_admin', 'reviewer'].includes(profile?.role) ? 'Administrator' : 'Faculty'; }

export default function Header({ profile, currentRole, setCurrentView, onOpenAddModal, onOpenQuickAdd, onSearch, isSidebarOpen, setIsSidebarOpen, onOpenMobileNav, onSignOut }) {
  const [showNotifications, setShowNotifications] = useState(false);
  const [showProfileMenu, setShowProfileMenu] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const name = displayName(profile);
  const notifications = useApiQuery(['notifications', { unread: true }], () => api.notifications({ unread: true }));
  const notificationItems = listItems(notifications.data);
  const unreadCount = notifications.data?.unread_count ?? notifications.data?.count ?? notificationItems.length;
  const avatar = profile?.avatar_url || profile?.photo_url || profile?.faculty_profile?.photo_url;
  const goHome = () => { setCurrentView(currentRole === 'Admin' ? 'admin' : 'dashboard'); setShowProfileMenu(false); };
  const markNotificationsRead = async () => { if (!unreadCount) return; try { await api.markNotificationsRead({ all: true }); invalidateQueries(['notifications']); } catch { /* realtime refresh retries */ } };
  const closeAllMenus = () => { setShowNotifications(false); setShowProfileMenu(false); };

  return (
    <header className="z-30 shrink-0 border-b border-[var(--brand-border-soft)] bg-[color:rgb(251_250_247_/_92%)] px-4 py-3 backdrop-blur-xl sm:px-6">
      <div className="mx-auto flex max-w-[1440px] items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <button
            type="button"
            onClick={onOpenMobileNav}
            aria-label="Open navigation"
            className="btn btn-secondary btn-sm !p-2.5 lg:hidden"
          >
            <Menu className="h-5 w-5" />
          </button>
          <button
            type="button"
            onClick={() => setIsSidebarOpen(!isSidebarOpen)}
            title={isSidebarOpen ? 'Collapse sidebar' : 'Expand sidebar'}
            className="hidden rounded-[var(--radius-control)] border border-[var(--brand-border)] bg-[var(--brand-surface)] p-2.5 text-[var(--brand-muted)] transition hover:bg-[var(--brand-primary-softer)] hover:text-[var(--brand-primary)] lg:flex"
          >
            {isSidebarOpen ? <PanelLeftClose className="h-5 w-5" /> : <PanelLeft className="h-5 w-5" />}
          </button>
          <Logo onClick={goHome} />
        </div>

        <form
          className="hidden max-w-md flex-1 md:mx-5 md:flex"
          onSubmit={(event) => { event.preventDefault(); onSearch?.(searchQuery.trim()); }}
        >
          <div className="relative w-full">
            <Search className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--brand-subtle)]" />
            <input
              type="search"
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              placeholder="Search your academic record..."
              className="input w-full !pl-10"
              aria-label="Search activities"
            />
          </div>
        </form>

        <div className="flex items-center gap-2 sm:gap-3">
          {currentRole !== 'Admin' && (
            <>
              <button
                type="button"
                onClick={() => onOpenQuickAdd?.()}
                aria-label="Quick add with natural language or voice"
                title="Quick Add"
                className="rounded-[var(--radius-control)] border border-[var(--brand-border)] bg-[var(--brand-surface)] p-2.5 text-[var(--brand-muted)] transition hover:bg-[var(--brand-primary-softer)] hover:text-[var(--brand-primary)]"
              >
                <Sparkles className="h-5 w-5" />
              </button>
              <ButtonAdd onClick={() => onOpenAddModal?.()} />
            </>
          )}

          <div className="relative">
            <button
              type="button"
              onClick={() => { closeAllMenus(); setShowNotifications((value) => !value); markNotificationsRead(); }}
              aria-label="Notifications"
              className="relative rounded-[var(--radius-control)] p-2.5 text-[var(--brand-muted)] transition hover:bg-[var(--brand-primary-softer)] hover:text-[var(--brand-primary)]"
            >
              <Bell className="h-5 w-5" />
              {unreadCount > 0 && (
                <span className="absolute right-1 top-1 flex min-h-4 min-w-4 items-center justify-center rounded-full bg-[var(--brand-primary)] px-1 text-[9px] font-extrabold text-white ring-2 ring-[var(--brand-canvas)]">
                  {unreadCount > 9 ? '9+' : unreadCount}
                </span>
              )}
            </button>
            {showNotifications && (
              <div className="app-surface absolute right-0 z-50 mt-2 w-80 max-w-[calc(100vw-2rem)] p-4">
                <div className="flex items-center justify-between border-b border-[var(--brand-border-soft)] pb-2.5">
                  <h4 className="text-xs font-bold uppercase tracking-wider text-[var(--brand-ink)]">Notifications</h4>
                  <button type="button" onClick={markNotificationsRead} className="text-xs font-bold text-[var(--brand-primary)]">Mark read</button>
                </div>
                <div className="divide-y divide-[var(--brand-border-soft)] text-sm">
                  {notifications.loading && <p className="py-4 text-[var(--brand-muted)]">Loading notifications…</p>}
                  {notifications.error && <p className="py-4 text-[var(--brand-rose-ink)]">Unable to load notifications.</p>}
                  {!notifications.loading && !notifications.error && notificationItems.length === 0 && (
                    <p className="py-4 text-[var(--brand-muted)]">You have no new notifications.</p>
                  )}
                  {notificationItems.slice(0, 5).map((item) => (
                    <div key={item.id} className="py-3">
                      <p className="font-bold text-[var(--brand-ink)]">{item.title || item.kind || 'Notification'}</p>
                      <p className="mt-0.5 text-[var(--brand-muted)]">{item.body || item.message || 'You have an update.'}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          <div className="relative">
            <button
              type="button"
              onClick={() => { closeAllMenus(); setShowProfileMenu((value) => !value); }}
              className="flex items-center gap-2 rounded-[var(--radius-control)] p-1 text-left transition hover:bg-[var(--brand-primary-softer)]"
            >
              <Avatar name={name} src={avatar} size="h-9 w-9" />
              <span className="hidden lg:block">
                <strong className="block text-sm leading-tight text-[var(--brand-ink)]">{name}</strong>
                <small className="block text-xs leading-tight text-[var(--brand-muted)]">{profile?.designation || profile?.title || profileRole(profile)}</small>
              </span>
              <ChevronDown className="hidden h-4 w-4 text-[var(--brand-subtle)] lg:block" />
            </button>
            {showProfileMenu && (
              <div className="app-surface absolute right-0 z-50 mt-2 w-64 max-w-[calc(100vw-2rem)] p-3">
                <div className="mb-2 rounded-[var(--radius-control)] bg-[var(--brand-primary-softer)] px-3 py-2.5">
                  <p className="font-bold text-[var(--brand-ink)]">{name}</p>
                  <p className="break-all text-xs text-[var(--brand-muted)]">{profile?.email || 'Signed-in account'}</p>
                  <span className="chip chip-primary mt-1.5">{profileRole(profile)}</span>
                </div>
                <div className="space-y-1 text-sm font-bold text-[var(--brand-text)]">
                  <button type="button" onClick={goHome} className="w-full rounded-lg px-3 py-2 text-left transition hover:bg-[var(--brand-primary-softer)]">Dashboard Home</button>
                  {currentRole !== 'Admin' && (
                    <button type="button" onClick={() => { setCurrentView('profile'); setShowProfileMenu(false); }} className="w-full rounded-lg px-3 py-2 text-left transition hover:bg-[var(--brand-primary-softer)]">My Profile</button>
                  )}
                  <button
                    type="button"
                    onClick={() => { setShowProfileMenu(false); onSignOut?.(); }}
                    className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-[var(--brand-rose-ink)] transition hover:bg-[var(--brand-danger-soft)]"
                  >
                    <LogOut className="h-4 w-4" /> Sign out
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </header>
  );
}

function ButtonAdd({ onClick }) {
  return (
    <button type="button" onClick={onClick} className="btn btn-primary btn-sm hidden sm:inline-flex">
      <Plus className="h-4 w-4" /> Add Activity
    </button>
  );
}
