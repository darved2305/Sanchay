import React, { useState } from 'react';
import {
  ArrowLeft, RefreshCw, CheckCircle2, Clock, XCircle,
  GraduationCap, Filter, ChevronDown, Check, Edit2, X, Download, TrendingUp, TrendingDown
} from 'lucide-react';
import { SiGmail, SiGooglecalendar, SiGoogledrive, SiOrcid } from 'react-icons/si';
import { BarChart as ReBarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, PieChart as RePieChart, Pie, Cell } from 'recharts';
import { recoveredActivities, monthlyOverviewData, sourceCoverageData } from '../data/reconstructData';

export default function ReconstructMyYear({ setCurrentView }) {
  const [activities, setActivities] = useState(recoveredActivities);
  const [isScanning, setIsScanning] = useState(false);
  const [toastMessage, setToastMessage] = useState(null);

  const handleConfirm = (id) => {
    setActivities(prev => prev.map(a => a.id === id ? { ...a, status: 'confirmed' } : a));
    showToast("Activity confirmed and added to 2024-25 appraisal record!");
  };

  const handleIgnore = (id) => {
    setActivities(prev => prev.map(a => a.id === id ? { ...a, status: 'ignored' } : a));
    showToast("Activity excluded from appraisal.");
  };

  const handleScanAgain = () => {
    setIsScanning(true);
    setTimeout(() => {
      setIsScanning(false);
      showToast("Auto-Scan Complete! Synced with Google Scholar, ORCID & Gmail.");
    }, 1500);
  };

  const showToast = (msg) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 3000);
  };

  const readyCount = activities.filter(a => a.status === 'ready' || a.status === 'confirmed').length;
  const reviewCount = activities.filter(a => a.status === 'review').length;
  const ignoredCount = activities.filter(a => a.status === 'ignored').length;

  const donutColors = ['#FD6F3B', '#10B981', '#F59E0B', '#3B82F6', '#EC4899'];

  return (
    <div className="space-y-6 pb-12">
      
      {/* Toast Notification */}
      {toastMessage && (
        <div className="fixed bottom-6 right-6 z-50 bg-slate-900 text-white px-4 py-3 rounded-2xl shadow-2xl text-base font-semibold flex items-center gap-2 animate-in fade-in slide-in-from-bottom-2">
          <CheckCircle2 className="w-4 h-4 text-emerald-400" />
          <span>{toastMessage}</span>
        </div>
      )}

      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <button 
            onClick={() => setCurrentView('dashboard')}
            className="p-2 bg-white hover:bg-slate-100 border border-slate-200 rounded-full transition-colors"
          >
            <ArrowLeft className="w-4 h-4 text-slate-700" />
          </button>
          <div>
            <h1 className="text-3xl font-bold text-slate-900 tracking-tight flex items-center gap-2">
              Reconstruct My Year
            </h1>
            <p className="text-base text-slate-500 mt-0.5">
              We scan your activities from multiple sources and help you rebuild your academic year.
            </p>
          </div>
        </div>

        <button
          onClick={handleScanAgain}
          disabled={isScanning}
          className="px-4 py-2 bg-[#FD6F3B] hover:bg-[#E05320] text-white rounded-xl text-base font-bold shadow-md shadow-orange-500/20 flex items-center gap-2 transition-all self-start sm:self-auto disabled:opacity-50"
        >
          <RefreshCw className={`w-4 h-4 ${isScanning ? 'animate-spin' : ''}`} />
          <span>{isScanning ? 'Scanning Integrations...' : 'Scan Again'}</span>
        </button>
      </div>

      {/* 5 Integration Source Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        <div className="p-3 bg-white rounded-2xl border border-slate-200/80 shadow-2xs flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-8 h-8 rounded-xl bg-red-50 flex items-center justify-center shrink-0">
              <SiGmail className="w-4 h-4" style={{ color: '#EA4335' }} />
            </div>
            <div className="min-w-0">
              <h4 className="text-lg font-bold text-slate-800">Gmail</h4>
              <p className="text-base text-slate-400">6 activities</p>
            </div>
          </div>
          <span className="inline-flex items-center gap-1 text-xs font-bold text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-full border border-emerald-200 shrink-0">
            <CheckCircle2 className="w-3 h-3" /> Scanned
          </span>
        </div>

        <div className="p-3 bg-white rounded-2xl border border-slate-200/80 shadow-2xs flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-8 h-8 rounded-xl bg-blue-50 flex items-center justify-center shrink-0">
              <SiGooglecalendar className="w-4 h-4" style={{ color: '#4285F4' }} />
            </div>
            <div className="min-w-0">
              <h4 className="text-lg font-bold text-slate-800">Calendar</h4>
              <p className="text-base text-slate-400">5 activities</p>
            </div>
          </div>
          <span className="inline-flex items-center gap-1 text-xs font-bold text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-full border border-emerald-200 shrink-0">
            <CheckCircle2 className="w-3 h-3" /> Scanned
          </span>
        </div>

        <div className="p-3 bg-white rounded-2xl border border-slate-200/80 shadow-2xs flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-8 h-8 rounded-xl bg-slate-100 flex items-center justify-center shrink-0">
              <SiGoogledrive className="w-4 h-4" style={{ color: '#4285F4' }} />
            </div>
            <div className="min-w-0">
              <h4 className="text-lg font-bold text-slate-800">Drive</h4>
              <p className="text-base text-slate-400">3 activities</p>
            </div>
          </div>
          <span className="inline-flex items-center gap-1 text-xs font-bold text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-full border border-emerald-200 shrink-0">
            <CheckCircle2 className="w-3 h-3" /> Scanned
          </span>
        </div>

        <div className="p-3 bg-white rounded-2xl border border-slate-200/80 shadow-2xs flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-8 h-8 rounded-xl bg-lime-50 flex items-center justify-center shrink-0">
              <SiOrcid className="w-4 h-4" style={{ color: '#A6CE39' }} />
            </div>
            <div className="min-w-0">
              <h4 className="text-lg font-bold text-slate-800">ORCID</h4>
              <p className="text-base text-slate-400">2 activities</p>
            </div>
          </div>
          <span className="inline-flex items-center gap-1 text-xs font-bold text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-full border border-emerald-200 shrink-0">
            <CheckCircle2 className="w-3 h-3" /> Scanned
          </span>
        </div>

        <div className="p-3 bg-white rounded-2xl border border-slate-200/80 shadow-2xs flex flex-wrap items-center justify-between gap-2 col-span-2 sm:col-span-1">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-8 h-8 rounded-xl bg-orange-50 text-[#FD6F3B] flex items-center justify-center shrink-0">
              <GraduationCap className="w-4 h-4" />
            </div>
            <div className="min-w-0">
              <h4 className="text-lg font-bold text-slate-800">Student Records</h4>
              <p className="text-base text-slate-400">2 activities</p>
            </div>
          </div>
          <span className="inline-flex items-center gap-1 text-xs font-bold text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-full border border-emerald-200 shrink-0">
            <CheckCircle2 className="w-3 h-3" /> Scanned
          </span>
        </div>
      </div>

      {/* Main 2-Column Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        
        {/* Left Column - Recovered Activities List */}
        <div className="lg:col-span-8 bg-white p-6 rounded-3xl border border-slate-200/80 shadow-xs space-y-6">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-4 border-b border-slate-100">
            <div>
              <h2 className="text-xl font-bold text-slate-800">Recovered Activities</h2>
              <p className="text-base text-slate-500">Review and confirm the activities to include in your academic year.</p>
            </div>
            <div className="flex items-center gap-2 self-start sm:self-auto">
              <button className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-base font-semibold">
                <Filter className="w-4 h-4" />
                <span>Filters</span>
              </button>
              <select className="px-3 py-1.5 bg-slate-100 text-slate-700 rounded-xl text-base font-semibold outline-none border border-slate-200">
                <option>Most recent</option>
                <option>By Category</option>
                <option>By Source</option>
              </select>
            </div>
          </div>

          {/* Activities List */}
          <div className="space-y-4">
            {activities.map((item) => (
              <div 
                key={item.id} 
                className={`p-4 rounded-2xl border transition-all flex flex-col sm:flex-row sm:flex-wrap sm:items-center justify-between gap-4 ${
                  item.status === 'confirmed' ? 'bg-emerald-50/40 border-emerald-200' :
                  item.status === 'ignored' ? 'bg-slate-50 border-slate-200 opacity-60' :
                  'bg-white border-slate-200/80 hover:border-orange-200 hover:shadow-2xs'
                }`}
              >
                <div className="flex items-start gap-3.5 min-w-0">
                  <div className="text-center shrink-0 w-16 pt-1">
                    <span className="block text-xs font-extrabold text-slate-500 uppercase">{item.date}</span>
                  </div>

                  <div className="space-y-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <h4 className="text-lg font-extrabold text-slate-900">{item.title}</h4>
                      <span className="text-xs font-bold px-2 py-0.5 bg-orange-100 text-orange-950 rounded-full">
                        {item.description}
                      </span>
                      {item.status === 'confirmed' && (
                        <span className="text-xs font-bold px-2 py-0.5 bg-emerald-100 text-emerald-800 rounded-full flex items-center gap-1">
                          <CheckCircle2 className="w-3 h-3" /> Confirmed
                        </span>
                      )}
                    </div>
                    <p className="text-base text-slate-500">{item.type}</p>
                    
                    {/* Evidence Source Pills */}
                    <div className="flex items-center gap-1.5 pt-1">
                      <span className="text-base font-bold text-slate-400">Evidence:</span>
                      {item.sources.map(src => (
                        <span key={src} className="px-2 py-0.5 bg-slate-100 text-slate-600 text-base font-semibold rounded-md">
                          {src}
                        </span>
                      ))}
                    </div>
                  </div>
                </div>

                {/* Actions */}
                <div className="flex items-center gap-2 self-end sm:self-center shrink-0">
                  {item.status !== 'confirmed' && (
                    <button
                      onClick={() => handleConfirm(item.id)}
                      className="px-3 py-1.5 bg-emerald-50 hover:bg-emerald-100 text-emerald-700 border border-emerald-200 rounded-xl text-base font-bold flex items-center gap-1 transition-all"
                    >
                      <Check className="w-4 h-4" />
                      <span>Confirm</span>
                    </button>
                  )}
                  <button
                    onClick={() => alert(`Editing activity: ${item.title}`)}
                    className="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-base font-semibold flex items-center gap-1 transition-all"
                  >
                    <Edit2 className="w-4 h-4 text-slate-500" />
                    <span>Edit</span>
                  </button>
                  {item.status !== 'ignored' && (
                    <button
                      onClick={() => handleIgnore(item.id)}
                      className="px-3 py-1.5 bg-slate-100 hover:bg-red-50 text-slate-500 hover:text-red-600 rounded-xl text-base font-semibold flex items-center gap-1 transition-all"
                    >
                      <X className="w-4 h-4" />
                      <span>Ignore</span>
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>

          <div className="text-center pt-2">
            <button className="text-base font-bold text-[#FD6F3B] hover:text-[#E05320] inline-flex items-center gap-1">
              <span>Show 12 more activities</span>
              <ChevronDown className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Right Column - Summaries & Analytics */}
        <div className="lg:col-span-4 space-y-6">
          
          {/* Reconstruction Summary Box */}
          <div className="bg-white p-6 rounded-3xl border border-slate-200/80 shadow-xs space-y-4">
            <h3 className="text-xs font-bold text-slate-800 uppercase tracking-wider">Reconstruction Summary</h3>

            <div className="space-y-2.5">
              <div className="p-3 bg-emerald-50/70 rounded-2xl border border-emerald-100 flex items-center justify-between">
                <div className="flex items-center gap-2.5">
                  <div className="w-7 h-7 rounded-full bg-emerald-500 text-white flex items-center justify-center">
                    <CheckCircle2 className="w-4 h-4" />
                  </div>
                  <div>
                    <h4 className="text-lg font-bold text-slate-800">Ready to add</h4>
                    <p className="text-base text-slate-500">Confirmed and ready to include</p>
                  </div>
                </div>
                <span className="text-lg font-extrabold text-emerald-800">{readyCount}</span>
              </div>

              <div className="p-3 bg-amber-50/70 rounded-2xl border border-amber-100 flex items-center justify-between">
                <div className="flex items-center gap-2.5">
                  <div className="w-7 h-7 rounded-full bg-amber-500 text-white flex items-center justify-center">
                    <Clock className="w-4 h-4" />
                  </div>
                  <div>
                    <h4 className="text-lg font-bold text-slate-800">Needs review</h4>
                    <p className="text-base text-slate-500">Please review and confirm</p>
                  </div>
                </div>
                <span className="text-lg font-extrabold text-amber-800">{reviewCount}</span>
              </div>

              <div className="p-3 bg-slate-100 rounded-2xl border border-slate-200 flex items-center justify-between">
                <div className="flex items-center gap-2.5">
                  <div className="w-7 h-7 rounded-full bg-slate-400 text-white flex items-center justify-center">
                    <XCircle className="w-4 h-4" />
                  </div>
                  <div>
                    <h4 className="text-lg font-bold text-slate-800">Ignored</h4>
                    <p className="text-base text-slate-500">Excluded from this year</p>
                  </div>
                </div>
                <span className="text-lg font-extrabold text-slate-600">{ignoredCount}</span>
              </div>
            </div>

            <button
              onClick={() => showToast("All 12 confirmed activities added to your annual appraisal record!")}
              className="w-full py-3 bg-[#FD6F3B] hover:bg-[#E05320] text-white rounded-xl text-base font-bold shadow-md shadow-orange-500/20 transition-all active:scale-95"
            >
              Add {readyCount} Activities to My Year
            </button>

            <button 
              onClick={() => showToast("Exporting AI suggestions to CSV...")}
              className="w-full text-center text-base font-bold text-[#FD6F3B] hover:text-[#E05320] flex items-center justify-center gap-1.5"
            >
              <Download className="w-4 h-4" />
              <span>Export Suggestions</span>
            </button>
          </div>

          {/* Monthly Activity Overview Stacked Bar Chart */}
          <div className="bg-white p-6 rounded-3xl border border-slate-200/80 shadow-xs space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-bold text-slate-800 uppercase tracking-wider">Monthly Activity Overview</h3>
              <select className="text-base font-semibold text-slate-600 bg-slate-100 border border-slate-200 rounded-lg px-2 py-1 outline-none">
                <option>May 2025</option>
                <option>Apr 2025</option>
              </select>
            </div>

            <div className="h-44 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <ReBarChart data={monthlyOverviewData}>
                  <XAxis dataKey="month" tickLine={false} axisLine={false} stroke="#94A3B8" fontSize={10} />
                  <YAxis tickLine={false} axisLine={false} stroke="#94A3B8" fontSize={10} />
                  <Tooltip />
                  <Bar dataKey="Teaching" stackId="a" fill="#FD6F3B" />
                  <Bar dataKey="Research" stackId="a" fill="#10B981" />
                  <Bar dataKey="Mentoring" stackId="a" fill="#F59E0B" />
                  <Bar dataKey="Service" stackId="a" fill="#EC4899" />
                </ReBarChart>
              </ResponsiveContainer>
            </div>

            <div className="grid grid-cols-3 gap-2 pt-2 border-t border-slate-100 text-center">
              <div>
                <span className="block text-base font-extrabold text-slate-800">18</span>
                <span className="text-base text-slate-500 font-medium">Total Detected</span>
              </div>
              <div>
                <span className="block text-base font-extrabold text-emerald-600">12</span>
                <span className="text-base text-slate-500 font-medium">Ready to Add</span>
              </div>
              <div>
                <span className="block text-base font-extrabold text-amber-600">4</span>
                <span className="text-base text-slate-500 font-medium">Needs Review</span>
              </div>
            </div>
          </div>

          {/* Source Coverage Donut Chart */}
          <div className="bg-white p-6 rounded-3xl border border-slate-200/80 shadow-xs space-y-4">
            <h3 className="text-xs font-bold text-slate-800 uppercase tracking-wider">Source Coverage</h3>
            
            <div className="flex items-center justify-between">
              <div className="w-28 h-28 relative shrink-0">
                <ResponsiveContainer width="100%" height="100%">
                  <RePieChart>
                    <Pie
                      data={sourceCoverageData}
                      innerRadius={28}
                      outerRadius={42}
                      paddingAngle={3}
                      dataKey="value"
                    >
                      {sourceCoverageData.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={donutColors[index % donutColors.length]} />
                      ))}
                    </Pie>
                  </RePieChart>
                </ResponsiveContainer>
                <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
                  <span className="text-base font-extrabold text-slate-900">18</span>
                  <span className="text-base text-slate-400 font-bold">Total</span>
                </div>
              </div>

              <div className="space-y-1 text-base font-semibold text-slate-600 flex-1 pl-3">
                {sourceCoverageData.map((src, i) => (
                  <div key={src.name} className="flex justify-between items-center">
                    <span className="flex items-center gap-1.5">
                      <span className="w-2 h-2 rounded-full" style={{ backgroundColor: donutColors[i] }}></span>
                      {src.name}
                    </span>
                    <span>{src.value} ({src.percentage})</span>
                  </div>
                ))}
              </div>
            </div>
          </div>

        </div>

      </div>

      {/* Bottom Full Width Year Summary */}
      <div className="p-6 bg-white rounded-3xl border border-slate-200/80 shadow-xs space-y-4">
        <div>
          <h3 className="text-xl font-bold text-slate-800">Year Summary <span className="text-base text-slate-400 font-normal">(After Adding Confirmed Activities)</span></h3>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          
          <div className="p-4 bg-[#FFF4F0] rounded-2xl border border-orange-100 flex items-center justify-between gap-2">
            <div className="min-w-0">
              <span className="text-base font-bold text-orange-950 block">Teaching</span>
              <span className="text-2xl font-extrabold text-[#FD6F3B]">32</span>
              <span className="text-base text-slate-500 font-medium block">Activities</span>
            </div>
            <span className="inline-flex items-center gap-1 text-xs font-bold text-emerald-600 bg-emerald-50 px-2 py-1 rounded-full border border-emerald-200 shrink-0">
              <TrendingUp className="w-3 h-3" /> 14% vs last year
            </span>
          </div>

          <div className="p-4 bg-emerald-50/60 rounded-2xl border border-emerald-100 flex items-center justify-between gap-2">
            <div className="min-w-0">
              <span className="text-base font-bold text-emerald-900 block">Research</span>
              <span className="text-2xl font-extrabold text-emerald-950">47</span>
              <span className="text-base text-slate-500 font-medium block">Activities</span>
            </div>
            <span className="inline-flex items-center gap-1 text-xs font-bold text-emerald-600 bg-emerald-50 px-2 py-1 rounded-full border border-emerald-200 shrink-0">
              <TrendingUp className="w-3 h-3" /> 22% vs last year
            </span>
          </div>

          <div className="p-4 bg-amber-50/60 rounded-2xl border border-amber-100 flex items-center justify-between gap-2">
            <div className="min-w-0">
              <span className="text-base font-bold text-amber-900 block">Mentoring</span>
              <span className="text-2xl font-extrabold text-amber-950">20</span>
              <span className="text-base text-slate-500 font-medium block">Activities</span>
            </div>
            <span className="inline-flex items-center gap-1 text-xs font-bold text-emerald-600 bg-emerald-50 px-2 py-1 rounded-full border border-emerald-200 shrink-0">
              <TrendingUp className="w-3 h-3" /> 11% vs last year
            </span>
          </div>

          <div className="p-4 bg-rose-50/60 rounded-2xl border border-rose-100 flex items-center justify-between gap-2">
            <div className="min-w-0">
              <span className="text-base font-bold text-rose-900 block">Service</span>
              <span className="text-2xl font-extrabold text-rose-950">15</span>
              <span className="text-base text-slate-500 font-medium block">Activities</span>
            </div>
            <span className="inline-flex items-center gap-1 text-xs font-bold text-rose-600 bg-rose-50 px-2 py-1 rounded-full border border-rose-200 shrink-0">
              <TrendingDown className="w-3 h-3" /> 5% vs last year
            </span>
          </div>

        </div>

        <p className="text-base text-slate-400">
          * These numbers will be updated once you add the confirmed activities to your academic year.
        </p>
      </div>

    </div>
  );
}
