import React, { useState } from 'react';
import { Search, Bell, Plus, UserCheck, Shield, ChevronDown, Check, LogOut, PanelLeft, PanelLeftClose } from 'lucide-react';
import { currentFaculty, adminUser } from '../data/mockData';

export default function Header({ currentRole, setCurrentRole, currentView, setCurrentView, onOpenAddModal, isSidebarOpen, setIsSidebarOpen, onSignOut }) {
  const [showNotifications, setShowNotifications] = useState(false);
  const [showProfileMenu, setShowProfileMenu] = useState(false);

  const activeUser = currentRole === 'Admin' ? adminUser : currentFaculty;

  return (
    <header className="sticky top-0 z-30 bg-white/95 backdrop-blur-md border-b border-slate-200/80 px-4 sm:px-6 py-4 transition-all">
      <div className="max-w-7xl mx-auto flex items-center justify-between gap-4">
        
        {/* Left Section: Sidebar Toggle & Brand / Logo */}
        <div className="flex items-center gap-3">
          
          {/* Sidebar Toggle Button */}
          <button
            onClick={() => setIsSidebarOpen(!isSidebarOpen)}
            title={isSidebarOpen ? "Collapse Sidebar" : "Expand Sidebar"}
            className="p-2.5 text-slate-700 hover:text-[#FD6F3B] hover:bg-orange-50/80 rounded-2xl transition-all border border-slate-200/80 active:scale-95 flex items-center justify-center"
          >
            {isSidebarOpen ? <PanelLeftClose className="w-5 h-5 text-[#FD6F3B]" /> : <PanelLeft className="w-5 h-5 text-slate-700" />}
          </button>

          {/* Brand / Logo */}
          <div 
            onClick={() => setCurrentView(currentRole === 'Admin' ? 'admin' : 'dashboard')}
            className="flex items-center gap-3 cursor-pointer group"
          >
            <div className="w-10 h-10 rounded-2xl bg-gradient-to-tr from-[#FD6F3B] via-orange-500 to-amber-500 flex items-center justify-center shadow-md shadow-orange-500/20 group-hover:scale-105 transition-transform">
              <div className="w-5 h-5 border-2 border-white/90 border-t-transparent rounded-md rotate-45 transform"></div>
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="font-extrabold text-xl tracking-tight bg-gradient-to-r from-slate-900 via-orange-950 to-slate-900 bg-clip-text text-transparent">
                  Sanchaya
                </span>
              </div>
              <p className="text-base text-slate-500 font-semibold tracking-tight">Your Impact. Clearly.</p>
            </div>
          </div>

        </div>

        {/* Search Bar */}
        <div className="hidden md:flex items-center flex-1 max-w-md mx-4">
          <div className="relative w-full">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
            <input
              type="text"
              placeholder="Search activities, forms, publications, evidence..."
              className="w-full pl-11 pr-4 py-2.5 bg-slate-100/70 border border-slate-200 rounded-full text-base text-slate-900 font-medium placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-[#FD6F3B]/20 focus:border-[#FD6F3B] transition-all"
            />
          </div>
        </div>

        {/* Controls & User Profile */}
        <div className="flex items-center gap-3">
          
          {/* Quick Add Activity Button */}
          {currentRole !== 'Admin' && (
            <button
              onClick={onOpenAddModal}
              className="hidden sm:flex items-center gap-2 px-4 py-2 bg-[#FD6F3B] hover:bg-[#E05320] text-white rounded-xl text-base font-bold shadow-sm transition-all active:scale-95"
            >
              <Plus className="w-4 h-4" />
              <span>Add Activity</span>
            </button>
          )}

          {/* Role Switcher Pill */}
          <div className="flex items-center bg-slate-100 p-1 rounded-2xl border border-slate-200">
            <button
              onClick={() => {
                setCurrentRole('Faculty');
                setCurrentView('dashboard');
              }}
              className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl text-base font-bold transition-all ${
                currentRole === 'Faculty'
                  ? 'bg-white text-[#FD6F3B] shadow-xs border border-slate-200/60'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <UserCheck className="w-4 h-4" />
              <span>Faculty</span>
            </button>
            <button
              onClick={() => {
                setCurrentRole('Admin');
                setCurrentView('admin');
              }}
              className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl text-base font-bold transition-all ${
                currentRole === 'Admin'
                  ? 'bg-[#FD6F3B] text-white shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <Shield className="w-4 h-4" />
              <span>Admin Panel</span>
            </button>
          </div>

          {/* Notifications Dropdown */}
          <div className="relative">
            <button 
              onClick={() => setShowNotifications(!showNotifications)}
              className="relative p-2.5 text-slate-600 hover:text-slate-900 hover:bg-slate-100 rounded-full transition-all"
            >
              <Bell className="w-5 h-5" />
              <span className="absolute top-1.5 right-1.5 w-2.5 h-2.5 bg-[#FD6F3B] rounded-full ring-2 ring-white"></span>
            </button>

            {showNotifications && (
              <div className="absolute right-0 mt-2 w-80 bg-white rounded-2xl shadow-xl border border-slate-200 p-4 z-50 animate-in fade-in slide-in-from-top-2">
                <div className="flex items-center justify-between pb-2.5 border-b border-slate-100">
                  <h4 className="text-xs font-bold text-slate-900 uppercase tracking-wider">Notifications</h4>
                  <span className="text-base text-[#FD6F3B] font-bold">2 New</span>
                </div>
                <div className="divide-y divide-slate-100 text-base">
                  <div className="py-3">
                    <p className="font-bold text-slate-900">Self-Appraisal Deadline Approaching</p>
                    <p className="text-slate-500 mt-0.5">Submit your 2024-25 appraisal by May 31.</p>
                  </div>
                  <div className="py-3">
                    <p className="font-bold text-slate-900">Scopus Publication Synced</p>
                    <p className="text-slate-500 mt-0.5">1 paper detected via ORCID & Google Scholar.</p>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* User Profile Card */}
          <div className="relative">
            <button 
              onClick={() => setShowProfileMenu(!showProfileMenu)}
              className="flex items-center gap-3 p-1 rounded-2xl hover:bg-slate-100 transition-all text-left"
            >
              <img 
                src={activeUser.avatar} 
                alt={activeUser.name} 
                className="w-10 h-10 rounded-full object-cover border-2 border-orange-200 shadow-xs"
              />
              <div className="hidden lg:block">
                <p className="text-base font-bold text-slate-900 leading-tight">{activeUser.name}</p>
                <p className="text-base text-slate-500 leading-tight">{activeUser.title}</p>
              </div>
              <ChevronDown className="w-4 h-4 text-slate-400 hidden lg:block" />
            </button>

            {showProfileMenu && (
              <div className="absolute right-0 mt-2 w-64 bg-white rounded-2xl shadow-xl border border-slate-200 p-3.5 z-50">
                <div className="px-3.5 py-2.5 bg-[#FFF4F0] rounded-xl mb-2">
                  <p className="text-base font-bold text-orange-950">{activeUser.name}</p>
                  <p className="text-base text-[#E05320] font-medium">{activeUser.email}</p>
                  <span className="inline-block mt-1.5 text-xs font-bold px-2.5 py-0.5 bg-orange-100 text-orange-900 rounded-full">
                    {activeUser.role} • {activeUser.employeeCode}
                  </span>
                </div>
                
                <div className="space-y-1 text-base font-bold text-slate-700">
                  <button 
                    onClick={() => {
                      setCurrentView(currentRole === 'Admin' ? 'admin' : 'dashboard');
                      setShowProfileMenu(false);
                    }}
                    className="w-full text-left px-3.5 py-2.5 hover:bg-slate-100 rounded-xl transition-colors"
                  >
                    Dashboard Home
                  </button>
                  <button 
                    onClick={() => {
                      setShowProfileMenu(false);
                      onSignOut?.();
                    }}
                    className="w-full text-left px-3.5 py-2.5 text-red-600 hover:bg-red-50 rounded-xl transition-colors flex items-center gap-2"
                  >
                    <LogOut className="w-4 h-4" />
                    <span>Sign Out</span>
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
