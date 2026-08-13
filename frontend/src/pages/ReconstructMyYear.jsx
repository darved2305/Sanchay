import React, { useState } from 'react';
import { motion } from 'framer-motion';
import {
  ArrowLeft, RefreshCw, CheckCircle2, Clock, XCircle,
  GraduationCap, ChevronDown, Check, Edit2, X, Download, TrendingUp, TrendingDown,
} from 'lucide-react';
import { SiGmail, SiGooglecalendar, SiGoogledrive, SiOrcid } from 'react-icons/si';
import { BarChart as ReBarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, PieChart as RePieChart, Pie, Cell } from 'recharts';
import { recoveredActivities, monthlyOverviewData, sourceCoverageData } from '../data/reconstructData';
import { chartPalette, chartVar, CHART_TOOLTIP_STYLE } from '../lib/chartTheme';
import { Button, PageHeader } from '../components/ui';
import { cardEnter, pageEnter } from '../lib/motion';

/* Deferred USP demo surface: presentation-only fixture data (see data/reconstructData.js). */

const SOURCE_CARDS = [
  { name: 'Gmail', count: 6, icon: SiGmail, brandColor: '#EA4335', chip: 'chip-rose' },
  { name: 'Calendar', count: 5, icon: SiGooglecalendar, brandColor: '#4285F4', chip: 'chip-sky' },
  { name: 'Drive', count: 3, icon: SiGoogledrive, brandColor: '#4285F4', chip: 'chip-butter' },
  { name: 'ORCID', count: 2, icon: SiOrcid, brandColor: '#A6CE39', chip: 'chip-mint' },
  { name: 'Student Records', count: 2, icon: GraduationCap, brandColor: null, chip: 'chip-lavender' },
];

const CATEGORY_TONES = {
  Service: 'peach',
  Workshops: 'butter',
  Mentorship: 'mint',
  Research: 'lavender',
  Committees: 'aqua',
};

export default function ReconstructMyYear({ setCurrentView }) {
  const [activities, setActivities] = useState(recoveredActivities);
  const [isScanning, setIsScanning] = useState(false);
  const [toastMessage, setToastMessage] = useState(null);

  const handleConfirm = (id) => {
    setActivities(prev => prev.map(a => a.id === id ? { ...a, status: 'confirmed' } : a));
    showToast('Activity confirmed and added to 2024-25 appraisal record!');
  };

  const handleIgnore = (id) => {
    setActivities(prev => prev.map(a => a.id === id ? { ...a, status: 'ignored' } : a));
    showToast('Activity excluded from appraisal.');
  };

  const handleScanAgain = () => {
    setIsScanning(true);
    setTimeout(() => {
      setIsScanning(false);
      showToast('Auto-Scan Complete! Synced with connected sources.');
    }, 1500);
  };

  const showToast = (msg) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 3000);
  };

  const readyCount = activities.filter(a => a.status === 'ready' || a.status === 'confirmed').length;
  const reviewCount = activities.filter(a => a.status === 'review').length;
  const ignoredCount = activities.filter(a => a.status === 'ignored').length;

  const donutColors = chartPalette();

  return (
    <motion.div {...pageEnter} className="space-y-6 pb-12">
      {toastMessage && (
        <div className="fixed bottom-6 right-6 z-50 flex items-center gap-2 rounded-[var(--radius-card)] bg-[var(--brand-ink)] px-4 py-3 text-sm font-semibold text-white shadow-[var(--shadow-raised)]">
          <CheckCircle2 className="h-4 w-4 text-[var(--brand-mint-strong)]" />
          <span>{toastMessage}</span>
        </div>
      )}

      <PageHeader
        title="Reconstruct My Year"
        subtitle="We scan your connected sources and help you rebuild your academic year. Review and confirm before anything is added."
        breadcrumb={
          <button type="button" onClick={() => setCurrentView('dashboard')} className="btn btn-ghost btn-sm mb-2 -ml-2">
            <ArrowLeft className="h-4 w-4" /> Back to Dashboard
          </button>
        }
        actions={
          <Button variant="primary" onClick={handleScanAgain} disabled={isScanning}>
            <RefreshCw className={`h-4 w-4 ${isScanning ? 'animate-spin' : ''}`} />
            {isScanning ? 'Scanning integrations…' : 'Scan Again'}
          </Button>
        }
      />

      {/* Connected sources */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {SOURCE_CARDS.map((source) => {
          const Icon = source.icon;
          return (
            <div key={source.name} className="app-surface flex flex-wrap items-center justify-between gap-2 !rounded-[var(--radius-card)] p-3">
              <div className="flex items-center gap-2.5 min-w-0">
                <span className={`icon-chip !h-8 !w-8 ${source.chip}`}>
                  <Icon className="h-4 w-4" style={source.brandColor ? { color: source.brandColor } : undefined} />
                </span>
                <div className="min-w-0">
                  <h4 className="truncate text-sm font-bold text-[var(--brand-ink)]">{source.name}</h4>
                  <p className="text-xs font-medium text-[var(--brand-subtle)]">{source.count} activities</p>
                </div>
              </div>
              <span className="chip chip-mint !border-0 !px-2 !py-0 !text-[11px]">
                <CheckCircle2 className="h-3 w-3" /> Scanned
              </span>
            </div>
          );
        })}
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        <motion.section {...cardEnter} className="app-surface space-y-5 p-6 lg:col-span-8">
          <div className="flex flex-col justify-between gap-2 border-b border-[var(--brand-border-soft)] pb-4 sm:flex-row sm:items-center">
            <div>
              <h2 className="text-xl font-extrabold text-[var(--brand-ink)]">Recovered Activities</h2>
              <p className="mt-1 text-sm font-medium text-[var(--brand-muted)]">Review and confirm the activities to include in your academic year.</p>
            </div>
            <span className="chip chip-surface self-start sm:self-auto">Demo preview</span>
          </div>

          <div className="space-y-3.5">
            {activities.map((item) => (
              <div
                key={item.id}
                className={`flex flex-col justify-between gap-4 rounded-[var(--radius-card)] border p-4 transition sm:flex-row sm:flex-wrap sm:items-center ${
                  item.status === 'confirmed'
                    ? 'border-[var(--brand-mint-strong)] bg-[var(--brand-success-soft)]'
                    : item.status === 'ignored'
                      ? 'border-[var(--brand-border)] bg-[var(--brand-surface-muted)] opacity-60'
                      : 'border-[var(--brand-border-soft)] bg-[var(--brand-surface)] hover:border-[var(--brand-lavender-strong)] hover:shadow-[var(--shadow-soft)]'
                }`}
              >
                <div className="flex min-w-0 items-start gap-3.5">
                  <span className="chip chip-lavender w-16 shrink-0 justify-center !px-2 text-center uppercase">{item.date}</span>
                  <div className="min-w-0 space-y-1.5">
                    <div className="flex flex-wrap items-center gap-2">
                      <h4 className="text-base font-extrabold text-[var(--brand-ink)]">{item.title}</h4>
                      <span className={`chip chip-${CATEGORY_TONES[item.category] || 'surface'} !border-0 !text-[11px]`}>{item.description}</span>
                      {item.status === 'confirmed' && (
                        <span className="chip chip-mint !border-0 !text-[11px]"><CheckCircle2 className="h-3 w-3" /> Confirmed</span>
                      )}
                    </div>
                    <p className="text-sm font-medium text-[var(--brand-muted)]">{item.type}</p>
                    <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
                      <span className="text-xs font-bold text-[var(--brand-subtle)]">Evidence:</span>
                      {item.sources.map((src) => (
                        <span key={src} className="rounded-md bg-[var(--brand-surface-muted)] px-2 py-0.5 text-xs font-semibold text-[var(--brand-muted)]">{src}</span>
                      ))}
                    </div>
                  </div>
                </div>

                <div className="flex shrink-0 items-center gap-2 self-end sm:self-center">
                  {item.status !== 'confirmed' && (
                    <Button variant="success" size="sm" onClick={() => handleConfirm(item.id)}>
                      <Check className="h-4 w-4" /> Confirm
                    </Button>
                  )}
                  <Button variant="secondary" size="sm" onClick={() => showToast(`Editing "${item.title}" opens in the activity form once sources are live.`)}>
                    <Edit2 className="h-3.5 w-3.5" /> Edit
                  </Button>
                  {item.status !== 'ignored' && (
                    <Button variant="ghost" size="sm" onClick={() => handleIgnore(item.id)} className="hover:!bg-[var(--brand-danger-soft)] hover:!text-[var(--brand-rose-ink)]">
                      <X className="h-4 w-4" /> Ignore
                    </Button>
                  )}
                </div>
              </div>
            ))}
          </div>

          <div className="pt-1 text-center">
            <button type="button" onClick={() => showToast('More recovered items appear here after a live scan.')} className="inline-flex items-center gap-1 text-sm font-bold text-[var(--brand-primary-hover)] hover:underline">
              <span>Show more activities</span>
              <ChevronDown className="h-4 w-4" />
            </button>
          </div>
        </motion.section>

        <motion.aside {...cardEnter} className="space-y-6 lg:col-span-4">
          <section className="app-surface space-y-4 p-6">
            <h3 className="text-xs font-bold uppercase tracking-wider text-[var(--brand-muted)]">Reconstruction Summary</h3>
            <div className="space-y-2.5">
              <div className="flex items-center justify-between rounded-[var(--radius-control)] border border-[var(--brand-mint-strong)] bg-[var(--brand-success-soft)] p-3">
                <div className="flex items-center gap-2.5">
                  <span className="flex h-7 w-7 items-center justify-center rounded-full bg-[var(--brand-success)] text-white"><CheckCircle2 className="h-4 w-4" /></span>
                  <div>
                    <h4 className="text-sm font-bold text-[var(--brand-ink)]">Ready to add</h4>
                    <p className="text-xs font-medium text-[var(--brand-muted)]">Confirmed and ready to include</p>
                  </div>
                </div>
                <span className="text-lg font-extrabold text-[var(--brand-mint-ink)]">{readyCount}</span>
              </div>
              <div className="flex items-center justify-between rounded-[var(--radius-control)] border border-[var(--brand-butter-strong)] bg-[var(--brand-warning-soft)] p-3">
                <div className="flex items-center gap-2.5">
                  <span className="flex h-7 w-7 items-center justify-center rounded-full bg-[var(--brand-warning)] text-white"><Clock className="h-4 w-4" /></span>
                  <div>
                    <h4 className="text-sm font-bold text-[var(--brand-ink)]">Needs review</h4>
                    <p className="text-xs font-medium text-[var(--brand-muted)]">Please review and confirm</p>
                  </div>
                </div>
                <span className="text-lg font-extrabold text-[var(--brand-butter-ink)]">{reviewCount}</span>
              </div>
              <div className="flex items-center justify-between rounded-[var(--radius-control)] border border-[var(--brand-border)] bg-[var(--brand-surface-muted)] p-3">
                <div className="flex items-center gap-2.5">
                  <span className="flex h-7 w-7 items-center justify-center rounded-full bg-[var(--brand-subtle)] text-white"><XCircle className="h-4 w-4" /></span>
                  <div>
                    <h4 className="text-sm font-bold text-[var(--brand-ink)]">Ignored</h4>
                    <p className="text-xs font-medium text-[var(--brand-muted)]">Excluded from this year</p>
                  </div>
                </div>
                <span className="text-lg font-extrabold text-[var(--brand-muted)]">{ignoredCount}</span>
              </div>
            </div>
            <Button variant="primary" className="w-full" onClick={() => showToast(`All ${readyCount} confirmed activities added to your annual appraisal record!`)}>
              Add {readyCount} Activities to My Year
            </Button>
            <button type="button" onClick={() => showToast('Exporting suggestions to CSV...')} className="flex w-full items-center justify-center gap-1.5 text-sm font-bold text-[var(--brand-primary-hover)] hover:underline">
              <Download className="h-4 w-4" /> Export Suggestions
            </button>
          </section>

          <section className="app-surface space-y-4 p-6">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-bold uppercase tracking-wider text-[var(--brand-muted)]">Monthly Activity Overview</h3>
              <span className="chip chip-surface !text-[11px]">Demo data</span>
            </div>
            <div className="h-44 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <ReBarChart data={monthlyOverviewData}>
                  <XAxis dataKey="month" tickLine={false} axisLine={false} stroke={chartVar('--brand-muted')} fontSize={10} />
                  <YAxis tickLine={false} axisLine={false} stroke={chartVar('--brand-muted')} fontSize={10} />
                  <Tooltip contentStyle={CHART_TOOLTIP_STYLE} cursor={{ fill: 'var(--brand-primary-softer)' }} />
                  <Bar dataKey="Teaching" stackId="a" fill={chartVar('--brand-chart-4')} radius={[0, 0, 0, 0]} />
                  <Bar dataKey="Research" stackId="a" fill={chartVar('--brand-chart-1')} radius={[0, 0, 0, 0]} />
                  <Bar dataKey="Mentoring" stackId="a" fill={chartVar('--brand-chart-2')} radius={[0, 0, 0, 0]} />
                  <Bar dataKey="Service" stackId="a" fill={chartVar('--brand-chart-3')} radius={[4, 4, 0, 0]} />
                </ReBarChart>
              </ResponsiveContainer>
            </div>
            <div className="grid grid-cols-3 gap-2 border-t border-[var(--brand-border-soft)] pt-3 text-center">
              <div>
                <span className="block text-base font-extrabold text-[var(--brand-ink)]">18</span>
                <span className="text-xs font-medium text-[var(--brand-muted)]">Total Detected</span>
              </div>
              <div>
                <span className="block text-base font-extrabold text-[var(--brand-mint-ink)]">12</span>
                <span className="text-xs font-medium text-[var(--brand-muted)]">Ready to Add</span>
              </div>
              <div>
                <span className="block text-base font-extrabold text-[var(--brand-butter-ink)]">4</span>
                <span className="text-xs font-medium text-[var(--brand-muted)]">Needs Review</span>
              </div>
            </div>
          </section>

          <section className="app-surface space-y-4 p-6">
            <h3 className="text-xs font-bold uppercase tracking-wider text-[var(--brand-muted)]">Source Coverage</h3>
            <div className="flex items-center justify-between gap-3">
              <div className="relative h-28 w-28 shrink-0">
                <ResponsiveContainer width="100%" height="100%">
                  <RePieChart>
                    <Pie data={sourceCoverageData} innerRadius={28} outerRadius={42} paddingAngle={3} dataKey="value">
                      {sourceCoverageData.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={donutColors[index % donutColors.length]} />
                      ))}
                    </Pie>
                  </RePieChart>
                </ResponsiveContainer>
                <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
                  <span className="text-base font-extrabold text-[var(--brand-ink)]">18</span>
                  <span className="text-xs font-bold text-[var(--brand-subtle)]">Total</span>
                </div>
              </div>
              <div className="flex-1 space-y-1 text-xs font-semibold text-[var(--brand-muted)]">
                {sourceCoverageData.map((src, i) => (
                  <div key={src.name} className="flex items-center justify-between">
                    <span className="flex items-center gap-1.5">
                      <span className="h-2 w-2 rounded-full" style={{ backgroundColor: donutColors[i % donutColors.length] }} />
                      {src.name}
                    </span>
                    <span>{src.value} ({src.percentage})</span>
                  </div>
                ))}
              </div>
            </div>
          </section>
        </motion.aside>
      </div>

      {/* Year summary (fixture preview of post-confirm state) */}
      <motion.section {...cardEnter} className="app-surface space-y-4 p-6">
        <h3 className="text-xl font-extrabold text-[var(--brand-ink)]">
          Year Summary <span className="text-sm font-medium text-[var(--brand-subtle)]">(after adding confirmed activities)</span>
        </h3>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {[
            { label: 'Teaching', count: 32, trend: '14% vs last year', up: true, chip: 'chip-sky' },
            { label: 'Research', count: 47, trend: '22% vs last year', up: true, chip: 'chip-lavender' },
            { label: 'Mentoring', count: 20, trend: '11% vs last year', up: true, chip: 'chip-mint' },
            { label: 'Service', count: 15, trend: '5% vs last year', up: false, chip: 'chip-peach' },
          ].map((card) => (
            <div key={card.label} className="flex items-center justify-between gap-2 rounded-[var(--radius-card)] border border-[var(--brand-border-soft)] bg-[var(--brand-canvas-soft)] p-4">
              <div className="min-w-0">
                <span className={`chip ${card.chip} !border-0 !text-[11px]`}>{card.label}</span>
                <span className="mt-2 block text-2xl font-extrabold tracking-tight text-[var(--brand-ink)]">{card.count}</span>
                <span className="text-xs font-medium text-[var(--brand-muted)]">Activities</span>
              </div>
              <span className={`chip !border-0 !text-[11px] ${card.up ? 'chip-mint' : 'chip-rose'} shrink-0`}>
                {card.up ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />} {card.trend}
              </span>
            </div>
          ))}
        </div>
        <p className="text-xs font-medium text-[var(--brand-subtle)]">
          * Preview figures update once confirmed activities join your academic year.
        </p>
      </motion.section>
    </motion.div>
  );
}
