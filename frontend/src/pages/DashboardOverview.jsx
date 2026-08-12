import React from 'react';
import { 
  PieChart as RePieChart, Pie, Cell, ResponsiveContainer 
} from 'recharts';
import { 
  Calendar, Upload, ArrowRight, Plus, RefreshCw, 
  Download, Clock, TrendingUp, Award, CheckCircle2, ChevronRight, FileText
} from 'lucide-react';
import { 
  currentFaculty, 
  upcomingDeadlines, 
  pendingEvidenceItems, 
  recentActivitiesLog 
} from '../data/mockData';
import { generateAppraisalPDF } from '../utils/pdfGenerator';

export default function DashboardOverview({ setCurrentView, onOpenAddModal }) {
  
  // Donut chart data for breakdown
  const breakdownData = [
    { name: 'Teaching', value: 62, color: '#FD6F3B' }, // Carrot Orange
    { name: 'Research', value: 45, color: '#10B981' }, // Mint green
    { name: 'Service', value: 27, color: '#F59E0B' },  // Amber
  ];

  return (
    <div className="space-y-7 pb-12">
      
      {/* Top Banner / Greeting */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-extrabold text-slate-900 tracking-tight flex items-center gap-2.5">
            Good morning, Dr. Ananya
          </h1>
          <p className="text-base text-slate-600 font-medium mt-1">
            Here's your annual appraisal overview. You're making a meaningful academic impact.
          </p>
        </div>

        {/* Academic Year Selector Pill */}
        <div className="flex items-center gap-2.5 bg-white px-4 py-2 rounded-full border border-slate-200 shadow-2xs self-start sm:self-auto">
          <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse"></span>
          <span className="text-base font-bold text-slate-800">Self-Appraisal 2024-25</span>
          <span className="text-xs font-extrabold px-2.5 py-0.5 bg-emerald-100 text-emerald-800 rounded-full">
            In Progress
          </span>
        </div>
      </div>

      {/* Top Section Grid (Overall Appraisal Progress & You're on track!) */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        
        {/* Card 1: Overall Appraisal Progress */}
        <div className="lg:col-span-7 bg-white p-6 rounded-3xl border border-slate-200/80 shadow-xs flex flex-col justify-between">
          <div>
            <h3 className="text-xl font-bold text-slate-900 mb-5">Overall Appraisal Progress</h3>

            <div className="flex flex-col sm:flex-row items-center gap-6">
              {/* Radial Donut Progress */}
              <div className="relative w-40 h-40 shrink-0 flex items-center justify-center">
                <svg className="w-full h-full transform -rotate-90" viewBox="0 0 36 36">
                  <path
                    className="text-slate-100"
                    strokeWidth="3.5"
                    stroke="currentColor"
                    fill="none"
                    d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
                  />
                  <path
                    className="text-[#FD6F3B]"
                    strokeDasharray="72, 100"
                    strokeWidth="3.5"
                    strokeLinecap="round"
                    stroke="currentColor"
                    fill="none"
                    d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
                  />
                </svg>
                <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
                  <span className="text-3xl font-extrabold text-slate-900">72%</span>
                  <span className="text-base font-bold text-slate-500">Complete</span>
                </div>
              </div>

              {/* Sub Metrics */}
              <div className="space-y-4 flex-1 w-full">
                <p className="text-base font-bold text-slate-700">Great progress! Keep going.</p>
                <div className="w-full bg-slate-100 h-2.5 rounded-full overflow-hidden">
                  <div className="bg-[#FD6F3B] h-full w-[72%] rounded-full"></div>
                </div>

                <div className="grid grid-cols-3 gap-3 pt-3 border-t border-slate-100 text-center">
                  <div>
                    <span className="block text-lg font-extrabold text-slate-900">12/16</span>
                    <span className="text-base text-slate-500 font-semibold">Sections Done</span>
                  </div>
                  <div>
                    <span className="block text-lg font-extrabold text-slate-900">48/67</span>
                    <span className="text-base text-slate-500 font-semibold">Activities Logged</span>
                  </div>
                  <div>
                    <span className="block text-lg font-extrabold text-slate-900">82%</span>
                    <span className="text-base text-slate-500 font-semibold">Evidence Attached</span>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div className="mt-7 pt-4 border-t border-slate-100 flex justify-start">
            <button
              onClick={() => setCurrentView('appraisal')}
              className="py-3 px-6 bg-[#FD6F3B] hover:bg-[#E05320] text-white rounded-xl text-base font-bold shadow-md shadow-orange-500/20 flex items-center gap-2 transition-all active:scale-95"
            >
              <span>Continue Self-Appraisal</span>
              <ArrowRight className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Card 2: You're on track! Banner Card */}
        <div className="lg:col-span-5 bg-gradient-to-br from-orange-50 via-amber-50/60 to-orange-100 p-6 rounded-3xl border border-orange-200/80 shadow-xs flex justify-between items-center relative overflow-hidden">
          <div className="space-y-4 z-10 max-w-[220px]">
            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-orange-200/90 text-orange-950 font-bold text-xs">
              <Award className="w-4 h-4 text-[#FD6F3B]" />
              <span>You're on track!</span>
            </span>
            <h3 className="text-xl font-extrabold text-orange-950 leading-snug">
              Your consistent efforts are building real academic impact.
            </h3>
            <button
              onClick={() => setCurrentView('activities')}
              className="py-2.5 px-4 bg-white hover:bg-orange-50 text-[#FD6F3B] border border-orange-200 rounded-xl text-base font-bold shadow-xs flex items-center gap-2 transition-all mt-2"
            >
              <span>View Impact Summary</span>
              <ArrowRight className="w-4 h-4" />
            </button>
          </div>

          {/* Professor Photo Illustration */}
          <div className="relative shrink-0 w-36 h-48 rounded-2xl overflow-hidden border-2 border-white shadow-lg z-10">
            <img 
              src="/dr_ananya_sharma.png" 
              alt="Dr. Ananya Sharma" 
              className="w-full h-full object-cover"
            />
          </div>

          <div className="absolute -bottom-10 -right-10 w-44 h-44 bg-orange-300/30 rounded-full blur-2xl"></div>
        </div>

      </div>

      {/* Middle Section Grid (3 Columns: Deadlines, Pending Evidence, Recent Activities) */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        
        {/* Column 1: Upcoming Deadlines */}
        <div className="bg-white p-6 rounded-3xl border border-slate-200/80 shadow-xs flex flex-col">
          <div className="flex items-center gap-2.5 mb-5">
            <Clock className="w-5 h-5 text-[#FD6F3B]" />
            <h3 className="text-xs font-bold text-slate-800 uppercase tracking-wider">Upcoming Deadlines</h3>
          </div>

          <div className="flex-1 flex flex-col justify-between gap-3.5">
            {upcomingDeadlines.map((item) => (
              <div key={item.id} className="p-3.5 bg-slate-50 rounded-2xl border border-slate-100 flex items-center gap-3.5">
                <div className="px-3 py-2 rounded-xl border text-center font-bold shrink-0 bg-[#FFF4F0] text-[#E05320] border-orange-200">
                  <span className="block text-xs uppercase tracking-wider leading-none font-extrabold">{item.month}</span>
                  <span className="block text-lg leading-tight font-extrabold mt-0.5">{item.day}</span>
                </div>
                <div>
                  <h4 className="text-lg font-bold text-slate-900">{item.title}</h4>
                  <p className="text-base text-slate-500 font-medium">{item.subtitle}</p>
                </div>
              </div>
            ))}
          </div>

          <button
            onClick={() => setCurrentView('calendar')}
            className="mt-5 pt-4 border-t border-slate-100 text-base font-bold text-[#FD6F3B] hover:text-[#E05320] flex items-center justify-start gap-1"
          >
            <span>View All Deadlines</span>
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>

        {/* Column 2: Pending Evidence */}
        <div className="bg-white p-6 rounded-3xl border border-slate-200/80 shadow-xs flex flex-col">
          <div className="flex items-center gap-2.5 mb-5">
            <Upload className="w-5 h-5 text-amber-600" />
            <h3 className="text-xs font-bold text-slate-800 uppercase tracking-wider">Pending Evidence</h3>
          </div>

          <div className="flex-1 flex flex-col justify-between gap-3.5">
            {pendingEvidenceItems.map((item) => (
              <div key={item.id} className="p-3.5 bg-slate-50 rounded-2xl border border-slate-100 flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <h4 className="text-lg font-bold text-slate-900">{item.category}</h4>
                  <p className="text-base text-slate-500 font-medium">{item.count}</p>
                </div>
                <button
                  onClick={() => setCurrentView('evidence')}
                  className="px-3.5 py-1.5 bg-amber-50 hover:bg-amber-100 text-amber-800 border border-amber-200 rounded-xl text-base font-bold transition-all shrink-0"
                >
                  Upload
                </button>
              </div>
            ))}
          </div>

          <button
            onClick={() => setCurrentView('evidence')}
            className="mt-5 pt-4 border-t border-slate-100 text-base font-bold text-[#FD6F3B] hover:text-[#E05320] flex items-center justify-start gap-1"
          >
            <span>Go to Evidence Library</span>
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>

        {/* Column 3: Recent Activities */}
        <div className="bg-white p-6 rounded-3xl border border-slate-200/80 shadow-xs flex flex-col">
          <div className="flex items-center gap-2.5 mb-5">
            <TrendingUp className="w-5 h-5 text-emerald-600" />
            <h3 className="text-xs font-bold text-slate-800 uppercase tracking-wider">Recent Activities</h3>
          </div>

          <div className="flex-1 flex flex-col justify-between gap-3.5 text-base">
            {recentActivitiesLog.map((item) => (
              <div key={item.id} className="flex items-start gap-3">
                <div className="w-7 h-7 rounded-full flex items-center justify-center shrink-0 mt-0.5 bg-orange-100 text-[#FD6F3B]">
                  <CheckCircle2 className="w-4 h-4" />
                </div>
                <div>
                  <p className="text-lg font-bold text-slate-900">{item.text}</p>
                  <p className="text-base text-slate-400 mt-0.5 font-medium">{item.timestamp}</p>
                </div>
              </div>
            ))}
          </div>

          <button
            onClick={() => setCurrentView('activities')}
            className="mt-5 pt-4 border-t border-slate-100 text-base font-bold text-[#FD6F3B] hover:text-[#E05320] flex items-center justify-start gap-1"
          >
            <span>View All Activities</span>
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>

      </div>

      {/* Lower Section Grid (Faculty Activity Breakdown & Impact Snapshot) */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        
        {/* Faculty Activity Breakdown Donut & Progress */}
        <div className="lg:col-span-7 bg-white p-6 rounded-3xl border border-slate-200/80 shadow-xs flex flex-col">
          <div className="mb-5">
            <h3 className="text-xl font-bold text-slate-900">Faculty Activity Breakdown</h3>
            <p className="text-base text-slate-500 font-medium">Your contributions across key academic areas.</p>
          </div>

          <div className="flex-1 flex flex-col sm:flex-row items-center justify-center gap-6">
            {/* Recharts Pie Chart */}
            <div className="w-48 h-48 relative shrink-0">
              <ResponsiveContainer width="100%" height="100%">
                <RePieChart>
                  <Pie
                    data={breakdownData}
                    innerRadius={60}
                    outerRadius={80}
                    paddingAngle={4}
                    dataKey="value"
                  >
                    {breakdownData.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={entry.color} />
                    ))}
                  </Pie>
                </RePieChart>
              </ResponsiveContainer>
              <div className="absolute inset-0 flex flex-col items-center justify-center text-center pointer-events-none">
                <span className="text-2xl font-extrabold text-slate-900">134</span>
                <span className="text-base font-bold text-slate-500">Total Activities</span>
              </div>
            </div>

            {/* Progress Bars */}
            <div className="flex-1 w-full space-y-4">
              <div>
                <div className="flex justify-between text-base font-bold text-slate-800 mb-1.5">
                  <span>Teaching</span>
                  <span>62 (46%)</span>
                </div>
                <div className="w-full bg-slate-100 h-2.5 rounded-full overflow-hidden">
                  <div className="bg-[#FD6F3B] h-full w-[46%] rounded-full"></div>
                </div>
              </div>

              <div>
                <div className="flex justify-between text-base font-bold text-slate-800 mb-1.5">
                  <span>Research</span>
                  <span>45 (34%)</span>
                </div>
                <div className="w-full bg-slate-100 h-2.5 rounded-full overflow-hidden">
                  <div className="bg-emerald-500 h-full w-[34%] rounded-full"></div>
                </div>
              </div>

              <div>
                <div className="flex justify-between text-base font-bold text-slate-800 mb-1.5">
                  <span>Service</span>
                  <span>27 (20%)</span>
                </div>
                <div className="w-full bg-slate-100 h-2.5 rounded-full overflow-hidden">
                  <div className="bg-amber-500 h-full w-[20%] rounded-full"></div>
                </div>
              </div>
            </div>
          </div>

          <div className="mt-5 pt-4 border-t border-slate-100 text-left">
            <button 
              onClick={() => setCurrentView('activities')}
              className="text-base font-bold text-[#FD6F3B] hover:text-[#E05320] flex items-center gap-1"
            >
              <span>View Detailed Breakdown</span>
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Impact Snapshot */}
        <div className="lg:col-span-5 bg-white p-6 rounded-3xl border border-slate-200/80 shadow-xs flex flex-col">
          <h3 className="text-xl font-bold text-slate-900 mb-5">Impact Snapshot</h3>

          <div className="flex-1 flex flex-col justify-between gap-4">
            <div className="p-4 bg-[#FFF4F0] rounded-2xl border border-orange-100 flex items-center justify-between gap-2">
              <div className="min-w-0">
                <span className="block text-2xl font-extrabold text-orange-950">92%</span>
                <span className="text-base text-[#FD6F3B] font-bold">Impact Score</span>
              </div>
              <span className="inline-flex items-center gap-1 text-xs font-extrabold text-emerald-700 bg-emerald-50 px-3 py-1 rounded-full border border-emerald-200 shrink-0">
                <TrendingUp className="w-3 h-3" /> 8% this year
              </span>
            </div>

            <div className="p-4 bg-rose-50/70 rounded-2xl border border-rose-100 flex items-center justify-between gap-2">
              <div className="min-w-0">
                <span className="block text-2xl font-extrabold text-rose-950">1.8M+</span>
                <span className="text-base text-rose-800 font-bold">Students Impacted</span>
              </div>
              <span className="inline-flex items-center gap-1 text-xs font-extrabold text-emerald-700 bg-emerald-50 px-3 py-1 rounded-full border border-emerald-200 shrink-0">
                <TrendingUp className="w-3 h-3" /> 12% this year
              </span>
            </div>

            <div className="p-4 bg-amber-50/70 rounded-2xl border border-amber-100 flex items-center justify-between gap-2">
              <div className="min-w-0">
                <span className="block text-2xl font-extrabold text-amber-950">128</span>
                <span className="text-base text-amber-900 font-bold">Activities Logged</span>
              </div>
              <span className="inline-flex items-center gap-1 text-xs font-extrabold text-emerald-700 bg-emerald-50 px-3 py-1 rounded-full border border-emerald-200 shrink-0">
                <TrendingUp className="w-3 h-3" /> 15% this year
              </span>
            </div>
          </div>

          <button
            onClick={() => setCurrentView('reports')}
            className="mt-5 pt-4 border-t border-slate-100 text-base font-bold text-[#FD6F3B] hover:text-[#E05320] flex items-center gap-1"
          >
            <span>View Impact Summary</span>
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>

      </div>

      {/* Quick Actions Grid (5 Action Cards) */}
      <div>
        <h3 className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-3.5">Quick Actions</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">

          <button
            onClick={onOpenAddModal}
            className="p-4 bg-[#FFF4F0] hover:bg-orange-100/70 border border-orange-200/80 rounded-2xl text-left transition-all group"
          >
            <div className="w-10 h-10 bg-[#FD6F3B] text-white rounded-xl flex items-center justify-center mb-3 shadow-xs group-hover:scale-105 transition-transform">
              <Plus className="w-5 h-5" />
            </div>
            <h4 className="text-lg font-bold text-orange-950">Log an Activity</h4>
            <p className="text-base text-[#E05320] mt-1 font-medium">Add a new activity to your profile.</p>
          </button>

          <button 
            onClick={() => setCurrentView('evidence')}
            className="p-4 bg-amber-50/70 hover:bg-amber-100/70 border border-amber-200/80 rounded-2xl text-left transition-all group"
          >
            <div className="w-10 h-10 bg-amber-500 text-white rounded-xl flex items-center justify-center mb-3 shadow-xs group-hover:scale-105 transition-transform">
              <Upload className="w-5 h-5" />
            </div>
            <h4 className="text-lg font-bold text-amber-950">Add Evidence</h4>
            <p className="text-base text-amber-800 mt-1 font-medium">Upload supporting proof documents.</p>
          </button>

          <button 
            onClick={() => setCurrentView('reconstruct')}
            className="p-4 bg-orange-50/70 hover:bg-orange-100/70 border border-orange-200/70 rounded-2xl text-left transition-all group"
          >
            <div className="w-10 h-10 bg-orange-600 text-white rounded-xl flex items-center justify-center mb-3 shadow-xs group-hover:scale-105 transition-transform">
              <RefreshCw className="w-5 h-5" />
            </div>
            <h4 className="text-lg font-bold text-orange-950">Reconstruct My Year</h4>
            <p className="text-base text-[#E05320] mt-1 font-medium">Auto-generate from emails & calendars.</p>
          </button>

          <button 
            onClick={() => setCurrentView('activities')}
            className="p-4 bg-sky-50/80 hover:bg-sky-100/80 border border-sky-200/80 rounded-2xl text-left transition-all group"
          >
            <div className="w-10 h-10 bg-sky-600 text-white rounded-xl flex items-center justify-center mb-3 shadow-xs group-hover:scale-105 transition-transform">
              <Clock className="w-5 h-5" />
            </div>
            <h4 className="text-lg font-bold text-sky-950">View My Timeline</h4>
            <p className="text-base text-sky-800 mt-1 font-medium">See your annual journey.</p>
          </button>

          <button 
            onClick={() => generateAppraisalPDF()}
            className="p-4 bg-emerald-50/80 hover:bg-emerald-100/80 border border-emerald-200/80 rounded-2xl text-left transition-all group"
          >
            <div className="w-10 h-10 bg-emerald-600 text-white rounded-xl flex items-center justify-center mb-3 shadow-xs group-hover:scale-105 transition-transform">
              <Download className="w-5 h-5" />
            </div>
            <h4 className="text-lg font-bold text-emerald-950">Download Report</h4>
            <p className="text-base text-emerald-800 mt-1 font-medium">Export your progress report.</p>
          </button>

        </div>
      </div>

      {/* Bottom Footer Banner */}
      <div className="p-6 bg-gradient-to-r from-orange-100/70 via-amber-50 to-orange-100/70 rounded-3xl border border-orange-200/80 flex flex-col sm:flex-row items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 bg-orange-200/80 rounded-2xl flex items-center justify-center text-[#FD6F3B] shrink-0">
            <Award className="w-6 h-6" />
          </div>
          <div>
            <h4 className="text-xl font-extrabold text-orange-950">Make every effort count.</h4>
            <p className="text-base text-orange-900 font-medium">Keep your profile updated to reflect your true academic impact.</p>
          </div>
        </div>

        <button 
          onClick={() => alert("Explore best practices: Submit evidence early for HOD & Dean approval!")}
          className="px-5 py-2.5 bg-[#FD6F3B] hover:bg-[#E05320] text-white rounded-xl text-base font-bold shadow-xs transition-all shrink-0 inline-flex items-center gap-2"
        >
          <span>Explore Tips & Best Practices</span>
          <ArrowRight className="w-4 h-4" />
        </button>
      </div>

    </div>
  );
}
