import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  Search, ChevronDown, ArrowRight, Sparkles,
  RefreshCw, Layers, FileCheck, BarChart3, ShieldCheck, GraduationCap
} from 'lucide-react';
import { SiGoogle, SiOrcid } from 'react-icons/si';

const navLinks = [
  { label: 'Features', href: '#features' },
  { label: 'For Faculty', href: '/login' },
  { label: 'For Admins', href: '/login' },
  { label: 'Resources', href: '#features' },
  { label: 'About Us', href: '#about' },
];
const dropdownLinks = new Set(['Features', 'Resources']);

const suggestionPills = ['Reconstruct My Year', 'View My Timeline', 'Log an Activity', 'Check Impact Score'];

const features = [
  {
    title: 'Reconstruct My Year',
    description: 'Instantly rebuild your academic year from emails, calendars, and documents.',
    icon: RefreshCw,
    color: 'bg-orange-50 border-orange-200/80',
    iconColor: 'text-[#FD6F3B]',
  },
  {
    title: 'Activities & Submissions',
    description: 'Browse, add, and manage every academic and professional activity in one place.',
    icon: Layers,
    color: 'bg-blue-50 border-blue-200/80',
    iconColor: 'text-blue-600',
  },
  {
    title: 'Self-Appraisal',
    description: 'Complete your annual appraisal with auto-filled sections and attached evidence.',
    icon: FileCheck,
    color: 'bg-emerald-50 border-emerald-200/80',
    iconColor: 'text-emerald-600',
  },
  {
    title: 'Reports & Analytics',
    description: 'Visualize your teaching, research, and service contributions at a glance.',
    icon: BarChart3,
    color: 'bg-amber-50 border-amber-200/80',
    iconColor: 'text-amber-600',
  },
  {
    title: 'Admin Action Center',
    description: 'Review, verify, and approve faculty appraisals with full institutional oversight.',
    icon: ShieldCheck,
    color: 'bg-teal-50 border-teal-200/80',
    iconColor: 'text-teal-600',
  },
];

const stats = [
  { value: '—', label: 'Faculty records' },
  { value: '—', label: 'Institution records' },
  { value: '—', label: 'Activities logged' },
  { value: '—', label: 'Verified after sign-in' },
];

export default function LandingPage() {
  const navigate = useNavigate();
  const [prompt, setPrompt] = useState('');

  const handlePromptSubmit = (e) => {
    e.preventDefault();
    navigate('/login');
  };

  return (
    <div className="min-h-screen bg-[#FAF9F7] text-slate-900 font-sans antialiased selection:bg-orange-200 selection:text-orange-950">

      {/* Top Nav */}
      <header className="sticky top-0 z-30 bg-white/95 backdrop-blur-md border-b border-slate-200/80 px-4 sm:px-6 py-4">
        <div className="max-w-7xl mx-auto flex items-center justify-between gap-4">
          <Link to="/" className="flex items-center gap-3 shrink-0">
            <div className="w-10 h-10 rounded-2xl bg-gradient-to-tr from-[#FD6F3B] via-orange-500 to-amber-500 flex items-center justify-center shadow-md shadow-orange-500/20">
              <div className="w-5 h-5 border-2 border-white/90 border-t-transparent rounded-md rotate-45 transform"></div>
            </div>
            <div>
              <span className="font-extrabold text-xl tracking-tight bg-gradient-to-r from-slate-900 via-orange-950 to-slate-900 bg-clip-text text-transparent block leading-tight">
                Sanchaya
              </span>
              <p className="text-xs text-slate-500 font-semibold tracking-tight">Your Impact. Clearly.</p>
            </div>
          </Link>

          <nav className="hidden lg:flex items-center gap-1">
            {navLinks.map((item) => (
              <Link
                key={item.label}
                to={item.href}
                className="px-3.5 py-2 rounded-xl text-sm font-bold text-slate-600 hover:text-slate-900 hover:bg-slate-100 transition-all flex items-center gap-1"
              >
                <span>{item.label}</span>
                {dropdownLinks.has(item.label) && <ChevronDown className="w-3.5 h-3.5" />}
              </Link>
            ))}
          </nav>

          <div className="flex items-center gap-3 shrink-0">
            <Link
              to="/login"
              className="px-4 py-2 rounded-xl text-sm font-bold text-slate-700 hover:bg-slate-100 border border-slate-200 transition-all"
            >
              Log in
            </Link>
            <Link
              to="/login"
              className="px-4 py-2 bg-[#FD6F3B] hover:bg-[#E05320] text-white rounded-xl text-sm font-bold shadow-sm transition-all active:scale-95"
            >
              Get Started Free
            </Link>
          </div>
        </div>
      </header>

      {/* Hero */}
      <section id="faculty" className="max-w-7xl mx-auto px-4 sm:px-6 pt-12 sm:pt-16 pb-20 grid grid-cols-1 lg:grid-cols-2 gap-12 items-center">

        <div>
          <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-white border border-slate-200 text-xs font-bold text-slate-600 shadow-2xs mb-6">
            <Sparkles className="w-3.5 h-3.5 text-[#FD6F3B]" />
            #1 Faculty Self-Appraisal Platform
          </span>

          <h1 className="text-5xl sm:text-6xl font-extrabold text-slate-900 tracking-tight leading-[1.05]">
            Less paperwork.<br />
            More impact.<br />
            <span className="relative inline-block">
              Finally visible.
              <span className="absolute left-0 -bottom-1 w-full h-1.5 bg-[#FD6F3B] rounded-full"></span>
            </span>
          </h1>

          <p className="mt-6 text-lg text-slate-500 font-medium max-w-md">
            Streamline self-appraisals, track academic activities, and showcase what truly matters. Built for faculty. Trusted by institutions.
          </p>

          {/* Prompt / Search Bar */}
          <form onSubmit={handlePromptSubmit} className="mt-8 flex items-center gap-2 bg-white border border-slate-200 rounded-2xl shadow-md shadow-slate-200/50 p-2 max-w-xl">
            <Search className="w-5 h-5 text-slate-400 ml-3 shrink-0" />
            <input
              type="text"
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="Ask anything about your academic year..."
              className="flex-1 min-w-0 bg-transparent text-sm text-slate-900 placeholder-slate-400 focus:outline-none py-2"
            />
            <button
              type="submit"
              className="shrink-0 px-4 py-2.5 bg-[#FD6F3B] hover:bg-[#E05320] text-white rounded-xl text-sm font-bold shadow-sm transition-all active:scale-95 flex items-center gap-1.5"
            >
              <span>Get Started</span>
              <ArrowRight className="w-4 h-4" />
            </button>
          </form>

          <div className="mt-4 flex flex-wrap items-center gap-2">
            <span className="text-xs font-bold text-slate-400">Try:</span>
            {suggestionPills.map((pill) => (
              <Link
                key={pill}
                to="/login"
                className="px-3 py-1.5 bg-white hover:bg-slate-50 border border-slate-200 rounded-full text-xs font-bold text-slate-600 transition-all"
              >
                {pill}
              </Link>
            ))}
          </div>
        </div>

        {/* Hero Photo + Floating Stat Cards */}
        <div className="relative flex items-center justify-center py-8">
          <div className="w-80 h-80 sm:w-96 sm:h-96 bg-gradient-to-br from-orange-200/80 to-amber-200/60 rounded-full blur-2xl absolute -z-10 animate-pulse-subtle"></div>

          <div className="relative w-72 h-72 sm:w-80 sm:h-80 rounded-full overflow-hidden border-4 border-white shadow-2xl">
            <img
              src="/faculty-portrait.png"
              alt="Faculty member"
              className="w-full h-full object-cover object-top"
            />
          </div>

          {/* Floating Card: Self-Appraisal Status */}
          <div className="absolute top-4 -left-4 sm:-left-8 bg-white/95 backdrop-blur-md p-4 rounded-2xl shadow-xl border border-slate-100 animate-float">
            <p className="text-sm font-bold text-slate-800">Annual self-appraisal</p>
            <span className="inline-flex items-center gap-1.5 mt-1 text-xs font-bold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-full border border-emerald-200">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500"></span>
              In Progress
            </span>
          </div>

          {/* Floating Card: Activities Logged */}
          <div className="absolute top-1/3 -right-4 sm:-right-8 bg-white/95 backdrop-blur-md p-4 rounded-2xl shadow-xl border border-slate-100">
            <p className="text-xs font-bold text-slate-400 uppercase tracking-wider">Activities Logged</p>
            <p className="text-2xl font-extrabold text-slate-900">—</p>
          </div>

          {/* Floating Card: Impact Score */}
          <div className="absolute bottom-4 -left-2 sm:-left-6 bg-white/95 backdrop-blur-md p-4 rounded-2xl shadow-xl border border-slate-100 animate-float">
            <p className="text-xs font-bold text-slate-400 uppercase tracking-wider">Impact Score</p>
            <p className="text-2xl font-extrabold text-[#FD6F3B] inline-flex items-center gap-1">
              —
            </p>
          </div>
        </div>
      </section>

      {/* Feature Cards */}
      <section id="features" className="max-w-7xl mx-auto px-4 sm:px-6 pb-20">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
          {features.map((feature) => {
            const Icon = feature.icon;
            return (
              <div key={feature.title} className={`p-4 rounded-2xl border ${feature.color} flex flex-col justify-between`}>
                <div>
                  <div className="w-10 h-10 rounded-xl bg-white/70 flex items-center justify-center mb-4">
                    <Icon className={`w-5 h-5 ${feature.iconColor}`} />
                  </div>
                  <h3 className="text-base font-bold text-slate-900">{feature.title}</h3>
                  <p className="text-sm text-slate-600 mt-1.5 leading-snug">{feature.description}</p>
                </div>
                <Link
                  to="/login"
                  className="mt-5 text-sm font-bold text-[#FD6F3B] hover:text-[#E05320] inline-flex items-center gap-1 transition-all"
                >
                  Explore <ArrowRight className="w-3.5 h-3.5" />
                </Link>
              </div>
            );
          })}
        </div>
      </section>

      {/* Trust / Stats Section */}
      <section id="about" className="max-w-7xl mx-auto px-4 sm:px-6 pb-20">
        <div className="bg-white rounded-3xl border border-slate-200/80 shadow-xs p-6 sm:p-8 flex flex-col lg:flex-row items-center gap-8">

          <div className="relative shrink-0 flex items-center justify-center w-40 h-40">
            <div className="w-36 h-36 bg-orange-200/70 rounded-full absolute -z-10"></div>
            <div className="w-32 h-32 rounded-full overflow-hidden border-4 border-white shadow-lg">
              <img src="/faculty-portrait.png" alt="Faculty member" className="w-full h-full object-cover object-top" />
            </div>
          </div>

          <div className="flex-1 w-full">
            <h2 className="text-lg font-bold text-slate-900">Trusted by educators. Built for impact.</h2>

            <div className="mt-5 grid grid-cols-2 sm:grid-cols-4 gap-4">
              {stats.map((stat) => (
                <div key={stat.label}>
                  <p className="text-2xl font-extrabold text-slate-900">{stat.value}</p>
                  <p className="text-sm text-slate-500 font-semibold">{stat.label}</p>
                </div>
              ))}
            </div>

            <div className="mt-6 pt-6 border-t border-slate-100">
              <p className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-3">Integrated with your ecosystem</p>
              <div className="flex flex-wrap items-center gap-3">
                <span className="inline-flex items-center gap-2 px-3.5 py-2 bg-slate-50 border border-slate-200 rounded-xl text-sm font-bold text-slate-700">
                  <SiGoogle className="w-4 h-4" style={{ color: '#4285F4' }} />
                  Google Workspace
                </span>
                <span className="inline-flex items-center gap-2 px-3.5 py-2 bg-slate-50 border border-slate-200 rounded-xl text-sm font-bold text-slate-700">
                  <svg className="w-4 h-4" viewBox="0 0 23 23">
                    <path fill="#f35325" d="M1 1h10v10H1z" />
                    <path fill="#81bc06" d="M12 1h10v10H1z" />
                    <path fill="#05a6f0" d="M1 12h10v10H1z" />
                    <path fill="#ffba08" d="M12 12h10v10H1z" />
                  </svg>
                  Microsoft 365
                </span>
                <span className="inline-flex items-center gap-2 px-3.5 py-2 bg-slate-50 border border-slate-200 rounded-xl text-sm font-bold text-slate-700">
                  <GraduationCap className="w-4 h-4 text-slate-500" />
                  Learning Management Systems
                </span>
                <span className="inline-flex items-center gap-2 px-3.5 py-2 bg-slate-50 border border-slate-200 rounded-xl text-sm font-bold text-slate-700">
                  <SiOrcid className="w-4 h-4" style={{ color: '#A6CE39' }} />
                  ORCID
                </span>
              </div>
            </div>
          </div>
        </div>
      </section>

    </div>
  );
}
