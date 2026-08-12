import React, { useState } from 'react';
import { 
  BookOpen, FlaskConical, Heart, Users, Award, ShieldCheck,
  Plus, CheckCircle2, Clock, MoreHorizontal, Download, ChevronRight, ChevronLeft, TrendingUp
} from 'lucide-react';
import { PieChart as RePieChart, Pie, Cell, ResponsiveContainer } from 'recharts';
import { activityCategories, initialSubmissions } from '../data/mockData';
import { generateAppraisalPDF } from '../utils/pdfGenerator';

export default function ActivitiesSubmissions({ onOpenAddModal, setCurrentView }) {
  const [selectedFilter, setSelectedFilter] = useState('All');
  const [submissionsList, setSubmissionsList] = useState(initialSubmissions);
  const [currentPage, setCurrentPage] = useState(1);

  // Icon mapping
  const getCategoryIcon = (iconName) => {
    switch (iconName) {
      case 'BookOpen': return BookOpen;
      case 'FlaskConical': return FlaskConical;
      case 'Heart': return Heart;
      case 'Users': return Users;
      case 'Award': return Award;
      case 'ShieldCheck': return ShieldCheck;
      default: return BookOpen;
    }
  };

  const filteredSubmissions = submissionsList.filter(item => {
    if (selectedFilter === 'All') return true;
    return item.category.toLowerCase() === selectedFilter.toLowerCase();
  });

  // Category donut data
  const categoryDonutData = activityCategories.map(cat => ({
    name: cat.title.split(' ')[0],
    value: cat.percentage,
    color: cat.id === 'teaching' ? '#FD6F3B' : 
           cat.id === 'research' ? '#10B981' : 
           cat.id === 'service' ? '#F97316' : 
           cat.id === 'mentorship' ? '#F59E0B' : 
           cat.id === 'workshops' ? '#0EA5E9' : '#14B8A6'
  }));

  return (
    <div className="space-y-6 pb-12">
      
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-base text-slate-400 font-medium">
        <span className="hover:text-slate-600 cursor-pointer" onClick={() => setCurrentView('dashboard')}>Dashboard</span>
        <span>/</span>
        <span className="text-[#FD6F3B] font-semibold">Activities & Submissions</span>
      </div>

      {/* Page Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-extrabold text-slate-900 tracking-tight">
            Activities & Submissions
          </h1>
          <p className="text-base text-slate-500 mt-2">
            Browse, add, and manage your academic and professional activities across all categories.
          </p>
        </div>
      </div>

      {/* Main 2-Column Layout (Left Main Content + Right Sidebar) */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        
        {/* Left Column (Categories & Submissions Table) */}
        <div className="lg:col-span-8 space-y-6">
          
          {/* Category Filter Pills */}
          <div className="flex items-center gap-2 overflow-x-auto pb-2 scrollbar-none">
            {['All', 'Teaching', 'Research', 'Service', 'Mentorship', 'Workshops', 'Committees'].map((filter) => (
              <button
                key={filter}
                onClick={() => setSelectedFilter(filter)}
                className={`px-4 py-1.5 rounded-full text-base font-bold transition-all shrink-0 ${
                  selectedFilter === filter
                    ? 'bg-[#FD6F3B] text-white shadow-sm'
                    : 'bg-white text-slate-600 hover:bg-slate-100 border border-slate-200'
                }`}
              >
                {filter}
              </button>
            ))}
          </div>

          {/* Section: Browse Activities */}
          <div className="bg-white p-6 rounded-3xl border border-slate-200/80 shadow-xs">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-xl font-bold text-slate-800">Browse Activities</h2>
              <button className="text-base font-semibold text-[#FD6F3B] hover:text-[#E05320] flex items-center gap-1">
                <span>View all categories</span>
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
            <p className="text-base text-slate-500 mb-5">
              Explore and add new activities to your record.
            </p>

            {/* 6 Category Cards Grid */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              {activityCategories.map((cat) => {
                const IconComponent = getCategoryIcon(cat.iconName);
                return (
                  <div key={cat.id} className="p-4 bg-slate-50/60 rounded-2xl border border-slate-100 flex flex-col justify-between hover:shadow-xs transition-all">
                    <div>
                      <div className={`w-9 h-9 rounded-xl flex items-center justify-center mb-3 ${cat.color}`}>
                        <IconComponent className="w-5 h-5" />
                      </div>
                      <h3 className="text-lg font-bold text-slate-900">{cat.title}</h3>
                      <p className="text-base text-slate-500 mt-1 leading-snug min-h-[48px]">
                        {cat.description}
                      </p>
                      <span className="inline-block mt-3 text-base font-bold text-slate-600">
                        {cat.count} activities
                      </span>
                    </div>

                    <button
                      onClick={onOpenAddModal}
                      className={`mt-4 w-full py-2 px-3 rounded-xl text-base font-bold transition-all flex items-center justify-center gap-1 ${cat.btnBg}`}
                    >
                      <span>Add Activity</span>
                    </button>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Section: Recent Submissions Table */}
          <div className="bg-white p-6 rounded-3xl border border-slate-200/80 shadow-xs">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-xl font-bold text-slate-800">Recent Submissions</h2>
              <button className="text-base font-semibold text-[#FD6F3B] hover:text-[#E05320] flex items-center gap-1">
                <span>View all submissions</span>
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
            <p className="text-base text-slate-500 mb-4">
              Your most recently added or updated activities.
            </p>

            {/* Table */}
            <div className="overflow-x-auto">
              <table className="w-full text-left text-base border-collapse">
                <thead>
                  <tr className="border-b border-slate-200/80 text-slate-400 font-bold uppercase text-xs tracking-wider">
                    <th className="py-3 px-3">Activity</th>
                    <th className="py-3 px-3">Category</th>
                    <th className="py-3 px-3">Date Added</th>
                    <th className="py-3 px-3">Status</th>
                    <th className="py-3 px-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filteredSubmissions.map((sub) => (
                    <tr key={sub.id} className="hover:bg-slate-50/70 transition-colors">
                      <td className="py-3.5 px-3">
                        <p className="font-bold text-slate-800 text-lg">{sub.activity}</p>
                        <p className="text-base text-slate-400 mt-0.5">{sub.detail}</p>
                      </td>
                      <td className="py-3.5 px-3">
                        <span className={`px-2.5 py-1 rounded-full text-xs font-bold ${
                          sub.categoryKey === 'teaching' ? 'bg-emerald-100 text-emerald-800' :
                          sub.categoryKey === 'research' ? 'bg-blue-100 text-blue-800' :
                          sub.categoryKey === 'mentorship' ? 'bg-orange-100 text-orange-900' :
                          sub.categoryKey === 'workshops' ? 'bg-amber-100 text-amber-800' :
                          'bg-teal-100 text-teal-800'
                        }`}>
                          {sub.category}
                        </span>
                      </td>
                      <td className="py-3.5 px-3 text-slate-500 font-medium">
                        {sub.dateAdded}
                      </td>
                      <td className="py-3.5 px-3">
                        {sub.status === 'Approved' ? (
                          <span className="inline-flex items-center gap-1 text-xs font-bold text-emerald-700 bg-emerald-50 px-2.5 py-1 rounded-full border border-emerald-200">
                            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                            <span>Approved</span>
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-xs font-bold text-amber-700 bg-amber-50 px-2.5 py-1 rounded-full border border-amber-200">
                            <Clock className="w-3.5 h-3.5 text-amber-600" />
                            <span>Pending</span>
                          </span>
                        )}
                      </td>
                      <td className="py-3.5 px-3 text-right">
                        <button className="p-1.5 hover:bg-slate-100 rounded-lg text-slate-400 hover:text-slate-700 transition-colors">
                          <MoreHorizontal className="w-4 h-4" />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Pagination Footer */}
            <div className="flex items-center justify-between pt-4 mt-2 border-t border-slate-100 text-base text-slate-500">
              <span>Showing 1 to {filteredSubmissions.length} of 12 results</span>
              <div className="flex items-center gap-1">
                <button className="p-1.5 rounded-lg border border-slate-200 text-slate-400 hover:bg-slate-50 disabled:opacity-50">
                  <ChevronLeft className="w-4 h-4" />
                </button>
                <button className="w-7 h-7 rounded-lg bg-[#FD6F3B] text-white font-bold flex items-center justify-center">
                  1
                </button>
                <button className="w-7 h-7 rounded-lg hover:bg-slate-100 font-bold flex items-center justify-center">
                  2
                </button>
                <button className="w-7 h-7 rounded-lg hover:bg-slate-100 font-bold flex items-center justify-center">
                  3
                </button>
                <button className="p-1.5 rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50">
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>
            </div>

          </div>

        </div>

        {/* Right Column (Quick Summary, Top Categories Donut, Stay on Track, Export Data, Banner) */}
        <div className="lg:col-span-4 space-y-6">
          
          {/* Primary Action Button */}
          <button
            onClick={onOpenAddModal}
            className="w-full py-3 bg-gradient-to-r from-[#FD6F3B] to-orange-600 hover:from-[#E05320] hover:to-orange-700 text-white rounded-2xl text-base font-bold shadow-md shadow-orange-500/25 flex items-center justify-center gap-2 transition-all active:scale-95"
          >
            <Plus className="w-4 h-4" />
            <span>Add Activity</span>
          </button>

          {/* Quick Summary Card */}
          <div className="bg-white p-6 rounded-3xl border border-slate-200/80 shadow-xs">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-xs font-bold text-slate-800 uppercase tracking-wider">Quick Summary</h3>
              <select className="text-base font-semibold text-slate-600 bg-slate-100 border border-slate-200 rounded-lg px-2 py-1 outline-none">
                <option>2024-25 Academic Year</option>
                <option>2023-24 Academic Year</option>
              </select>
            </div>

            <div className="space-y-4">
              <div>
                <span className="text-base text-slate-400 font-semibold block">Total Activities</span>
                <div className="flex items-baseline justify-between">
                  <span className="text-3xl font-extrabold text-slate-900">128</span>
                  {/* Mini Sparkline SVG */}
                  <svg className="w-20 h-6 text-[#FD6F3B]" viewBox="0 0 100 30" fill="none">
                    <path d="M0 25 L 20 20 L 40 22 L 60 10 L 80 15 L 100 5" stroke="currentColor" strokeWidth="3" strokeLinecap="round" fill="none" />
                  </svg>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3 pt-3 border-t border-slate-100">
                <div className="p-3 bg-emerald-50/70 rounded-2xl border border-emerald-100">
                  <span className="text-base text-emerald-700 font-bold block">Approved</span>
                  <span className="text-xl font-extrabold text-emerald-800">98</span>
                </div>
                <div className="p-3 bg-amber-50/70 rounded-2xl border border-amber-100">
                  <span className="text-base text-amber-700 font-bold block">Pending</span>
                  <span className="text-xl font-extrabold text-amber-800">18</span>
                </div>
              </div>

              <div className="p-3 bg-[#FFF4F0] rounded-2xl border border-orange-100 flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <span className="text-base text-orange-950 font-bold block">Impact Score</span>
                  <span className="text-xl font-extrabold text-[#FD6F3B] inline-flex items-center gap-1">92% <TrendingUp className="w-4 h-4" /></span>
                </div>
                <span className="text-xs font-bold px-2 py-0.5 bg-emerald-100 text-emerald-800 rounded-full shrink-0">
                  Excellent
                </span>
              </div>
            </div>
          </div>

          {/* Top Categories Donut Chart */}
          <div className="bg-white p-6 rounded-3xl border border-slate-200/80 shadow-xs">
            <h3 className="text-xs font-bold text-slate-800 uppercase tracking-wider mb-4">Top Categories</h3>
            
            <div className="flex items-center justify-between">
              <div className="w-28 h-28 relative shrink-0">
                <ResponsiveContainer width="100%" height="100%">
                  <RePieChart>
                    <Pie
                      data={categoryDonutData}
                      innerRadius={30}
                      outerRadius={45}
                      paddingAngle={3}
                      dataKey="value"
                    >
                      {categoryDonutData.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={entry.color} />
                      ))}
                    </Pie>
                  </RePieChart>
                </ResponsiveContainer>
              </div>

              <div className="space-y-1.5 text-base font-semibold text-slate-600 flex-1 pl-4">
                <div className="flex justify-between items-center"><span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-[#FD6F3B]"></span>Teaching</span> <span>34%</span></div>
                <div className="flex justify-between items-center"><span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-emerald-500"></span>Research</span> <span>26%</span></div>
                <div className="flex justify-between items-center"><span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-orange-500"></span>Service</span> <span>18%</span></div>
                <div className="flex justify-between items-center"><span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-amber-500"></span>Mentorship</span> <span>12%</span></div>
                <div className="flex justify-between items-center"><span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-sky-500"></span>Workshops</span> <span>6%</span></div>
                <div className="flex justify-between items-center"><span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-teal-500"></span>Committees</span> <span>4%</span></div>
              </div>
            </div>
          </div>

          {/* Stay on Track Card */}
          <div className="p-6 bg-[#FFF4F0] rounded-3xl border border-orange-200/70 space-y-3">
            <h4 className="text-lg font-bold text-orange-950">Stay on Track</h4>
            <p className="text-base text-orange-900 leading-snug">
              Keep your activities updated to maintain an accurate impact profile.
            </p>
            <button 
              onClick={() => setCurrentView('activities')}
              className="text-base font-bold text-[#FD6F3B] hover:text-[#E05320] flex items-center gap-1"
            >
              <span>View My Timeline</span>
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>

          {/* Export Your Data Card */}
          <div className="p-6 bg-orange-50/50 rounded-3xl border border-orange-200/60 space-y-3">
            <h4 className="text-lg font-bold text-orange-950">Export Your Data</h4>
            <p className="text-base text-orange-900 leading-snug">
              Download your activities and reports anytime.
            </p>
            <button
              onClick={() => generateAppraisalPDF()}
              className="w-full py-2 px-3 bg-orange-100 hover:bg-orange-200 text-orange-950 rounded-xl text-base font-bold flex items-center justify-center gap-2 transition-all"
            >
              <Download className="w-4 h-4 text-[#FD6F3B]" />
              <span>Export Now</span>
            </button>
          </div>

          {/* Bottom Illustration Banner */}
          <div className="p-6 bg-gradient-to-b from-orange-50 to-amber-50 rounded-3xl border border-orange-100 text-center space-y-3 relative overflow-hidden">
            <div className="w-20 h-20 rounded-full overflow-hidden border-2 border-white shadow-md mx-auto">
              <img 
                src="/dr_ananya_sharma.png" 
                alt="Dr. Ananya Sharma Impact" 
                className="w-full h-full object-cover"
              />
            </div>
            <h4 className="text-lg font-extrabold text-slate-800">Impact Matters.</h4>
            <p className="text-base text-slate-500 leading-snug">
              Your work creates change. We help you showcase it.
            </p>
          </div>

        </div>

      </div>

    </div>
  );
}
