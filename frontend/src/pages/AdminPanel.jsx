import React, { useState } from 'react';
import { 
  ShieldCheck, Search, Filter, ArrowUpDown, FileText, Download, CheckCircle2, 
  Clock, AlertCircle, Eye, User, Calendar, Building, ChevronRight, X
} from 'lucide-react';
import { adminFacultySubmissions, adminUser } from '../data/mockData';
import { generateAppraisalPDF } from '../utils/pdfGenerator';

export default function AdminPanel() {
  const [submissions, setSubmissions] = useState(adminFacultySubmissions);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedDepartment, setSelectedDepartment] = useState('All');
  const [selectedStatus, setSelectedStatus] = useState('All');
  const [sortBy, setSortBy] = useState('name'); // 'name' | 'empCode' | 'date'
  const [inspectModalItem, setInspectModalItem] = useState(null);
  const [toastMsg, setToastMsg] = useState(null);

  const showToast = (msg) => {
    setToastMsg(msg);
    setTimeout(() => setToastMsg(null), 3000);
  };

  // Filter & Search Logic
  const filteredList = submissions.filter(item => {
    const matchesSearch = item.facultyName.toLowerCase().includes(searchQuery.toLowerCase()) ||
                          item.employeeCode.toLowerCase().includes(searchQuery.toLowerCase()) ||
                          item.department.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesDept = selectedDepartment === 'All' || item.department === selectedDepartment;
    const matchesStatus = selectedStatus === 'All' || item.verificationStatus === selectedStatus;
    return matchesSearch && matchesDept && matchesStatus;
  });

  // Sort Logic
  const sortedList = [...filteredList].sort((a, b) => {
    if (sortBy === 'name') {
      return a.facultyName.localeCompare(b.facultyName);
    } else if (sortBy === 'empCode') {
      return a.employeeCode.localeCompare(b.employeeCode);
    } else if (sortBy === 'date') {
      return new Date(b.dateSubmitted) - new Date(a.dateSubmitted);
    }
    return 0;
  });

  const handleApprove = (id, name) => {
    setSubmissions(prev => prev.map(s => s.id === id ? { ...s, verificationStatus: 'Approved' } : s));
    showToast(`Approved appraisal for ${name}!`);
    if (inspectModalItem && inspectModalItem.id === id) {
      setInspectModalItem(prev => ({ ...prev, verificationStatus: 'Approved' }));
    }
  };

  const handleReject = (id, name) => {
    setSubmissions(prev => prev.map(s => s.id === id ? { ...s, verificationStatus: 'Rejection Requested' } : s));
    showToast(`Requested revisions for ${name}.`);
    if (inspectModalItem && inspectModalItem.id === id) {
      setInspectModalItem(prev => ({ ...prev, verificationStatus: 'Rejection Requested' }));
    }
  };

  return (
    <div className="space-y-6 pb-12">
      
      {/* Toast Notification */}
      {toastMsg && (
        <div className="fixed bottom-6 right-6 z-50 bg-slate-900 text-white px-4 py-3 rounded-2xl shadow-2xl text-base font-semibold flex items-center gap-2 animate-in fade-in slide-in-from-bottom-2">
          <CheckCircle2 className="w-4 h-4 text-emerald-400" />
          <span>{toastMsg}</span>
        </div>
      )}

      {/* Header Banner */}
      <div className="p-6 bg-gradient-to-r from-slate-900 via-orange-950 to-slate-900 rounded-3xl text-white shadow-xl flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 rounded-2xl bg-gradient-to-tr from-[#FD6F3B] via-orange-500 to-amber-500 flex items-center justify-center text-white shadow-lg shadow-orange-500/20">
            <ShieldCheck className="w-6 h-6" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-3xl font-extrabold tracking-tight">University Admin & IQAC Panel</h1>
              <span className="px-2.5 py-0.5 bg-orange-500/30 text-orange-200 text-xs font-bold rounded-full border border-orange-400/30 uppercase">
                Westfield University
              </span>
            </div>
            <p className="text-base text-slate-300 mt-1">
              Logged in as <span className="font-bold text-white">{adminUser.name}</span> ({adminUser.title}). Review, verify, and approve annual faculty self-appraisals.
            </p>
          </div>
        </div>

        <button
          onClick={() => generateAppraisalPDF()}
          className="px-4 py-2.5 bg-[#FD6F3B] hover:bg-[#E05320] text-white rounded-xl text-base font-bold shadow-md shadow-orange-500/20 flex items-center gap-2 transition-all self-start md:self-auto"
        >
          <Download className="w-4 h-4" />
          <span>Export Institutional PDF Report</span>
        </button>
      </div>

      {/* Metrics Summary Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="p-4 bg-white rounded-2xl border border-slate-200/80 shadow-2xs">
          <span className="text-base text-slate-400 font-semibold block">Total Appraisals</span>
          <div className="flex items-baseline justify-between mt-1">
            <span className="text-2xl font-extrabold text-slate-900">{submissions.length}</span>
            <span className="text-xs font-bold text-slate-500 bg-slate-100 px-2 py-0.5 rounded-full">AY 2024-25</span>
          </div>
        </div>

        <div className="p-4 bg-white rounded-2xl border border-slate-200/80 shadow-2xs">
          <span className="text-base text-emerald-600 font-semibold block">Approved Submissions</span>
          <div className="flex items-baseline justify-between mt-1">
            <span className="text-2xl font-extrabold text-emerald-700">
              {submissions.filter(s => s.verificationStatus === 'Approved').length}
            </span>
            <span className="text-xs font-bold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-full border border-emerald-200">Verified</span>
          </div>
        </div>

        <div className="p-4 bg-white rounded-2xl border border-slate-200/80 shadow-2xs">
          <span className="text-base text-amber-600 font-semibold block">Pending IQAC Verification</span>
          <div className="flex items-baseline justify-between mt-1">
            <span className="text-2xl font-extrabold text-amber-700">
              {submissions.filter(s => s.verificationStatus === 'Pending Verification').length}
            </span>
            <span className="text-xs font-bold text-amber-700 bg-amber-50 px-2 py-0.5 rounded-full border border-amber-200">Action Needed</span>
          </div>
        </div>

        <div className="p-4 bg-white rounded-2xl border border-slate-200/80 shadow-2xs">
          <span className="text-base text-[#FD6F3B] font-semibold block">Average PBAS Score</span>
          <div className="flex items-baseline justify-between mt-1">
            <span className="text-2xl font-extrabold text-slate-900">274 / 300</span>
            <span className="text-xs font-bold text-[#E05320] bg-orange-50 px-2 py-0.5 rounded-full border border-orange-200">High Impact</span>
          </div>
        </div>
      </div>

      {/* Filter, Search & Sorting Controls */}
      <div className="bg-white p-6 rounded-3xl border border-slate-200/80 shadow-xs flex flex-col md:flex-row items-center justify-between gap-4">
        
        {/* Search Bar */}
        <div className="relative w-full md:w-80">
          <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search by Faculty Name or Emp Code..."
            className="w-full pl-10 pr-4 py-2 bg-slate-50 border border-slate-200 rounded-xl text-base text-slate-900 focus:outline-none focus:ring-2 focus:ring-[#FD6F3B]/20 focus:border-[#FD6F3B]"
          />
        </div>

        {/* Filter Dropdowns & Sorting */}
        <div className="flex flex-wrap items-center gap-3 w-full md:w-auto justify-end">
          
          {/* Department Filter */}
          <div className="flex items-center gap-1.5 text-base font-semibold text-slate-600">
            <Building className="w-4 h-4 text-slate-400" />
            <select
              value={selectedDepartment}
              onChange={(e) => setSelectedDepartment(e.target.value)}
              className="bg-slate-50 border border-slate-200 text-slate-800 rounded-xl px-3 py-1.5 outline-none font-bold text-base"
            >
              <option value="All">All Departments</option>
              <option value="Computer Science & Engineering">CSE</option>
              <option value="Electrical & Electronics Engineering">EEE</option>
              <option value="Mechanical Engineering">Mechanical</option>
              <option value="Biotechnology & Life Sciences">Biotech</option>
              <option value="Physics & Nanotechnology">Physics</option>
            </select>
          </div>

          {/* Status Filter */}
          <div className="flex items-center gap-1.5 text-base font-semibold text-slate-600">
            <Filter className="w-4 h-4 text-slate-400" />
            <select
              value={selectedStatus}
              onChange={(e) => setSelectedStatus(e.target.value)}
              className="bg-slate-50 border border-slate-200 text-slate-800 rounded-xl px-3 py-1.5 outline-none font-bold text-base"
            >
              <option value="All">All Statuses</option>
              <option value="Approved">Approved</option>
              <option value="Pending Verification">Pending Verification</option>
              <option value="Rejection Requested">Revisions Requested</option>
            </select>
          </div>

          {/* Sorting Control */}
          <div className="flex items-center gap-1.5 text-base font-semibold text-slate-600">
            <ArrowUpDown className="w-4 h-4 text-[#FD6F3B]" />
            <span className="text-base text-slate-400">Sort by:</span>
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value)}
              className="bg-[#FFF4F0] border border-orange-200 text-[#FD6F3B] rounded-xl px-3 py-1.5 outline-none font-bold text-base"
            >
              <option value="name">Faculty Name</option>
              <option value="empCode">Employee Code</option>
              <option value="date">Date of Submission</option>
            </select>
          </div>

        </div>
      </div>

      {/* Submissions Table */}
      <div className="bg-white rounded-3xl border border-slate-200/80 shadow-xs overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between">
          <h3 className="text-xl font-bold text-slate-800">Faculty Submissions Log</h3>
          <span className="text-base text-slate-500">Showing {sortedList.length} of {submissions.length} Records</span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-base border-collapse">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200/80 text-slate-400 font-bold uppercase text-xs tracking-wider">
                <th className="py-3.5 px-4">Faculty Member</th>
                <th className="py-3.5 px-4">Employee Code</th>
                <th className="py-3.5 px-4">Department & Role</th>
                <th className="py-3.5 px-4">Submission Date</th>
                <th className="py-3.5 px-4">PBAS Score</th>
                <th className="py-3.5 px-4">Status</th>
                <th className="py-3.5 px-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {sortedList.map((item) => (
                <tr key={item.id} className="hover:bg-slate-50/70 transition-colors">
                  
                  {/* Faculty Member */}
                  <td className="py-4 px-4">
                    <div className="flex items-center gap-3">
                      <img 
                        src={item.avatar || "/dr_ananya_sharma.png"} 
                        alt={item.facultyName} 
                        className="w-9 h-9 rounded-full object-cover border-2 border-orange-200"
                      />
                      <div>
                        <p className="font-bold text-slate-900 text-base whitespace-nowrap">{item.facultyName}</p>
                        <p className="text-base text-slate-500">{item.designation}</p>
                      </div>
                    </div>
                  </td>

                  {/* Employee Code */}
                  <td className="py-4 px-4 font-mono text-slate-700 font-semibold">
                    {item.employeeCode}
                  </td>

                  {/* Department */}
                  <td className="py-4 px-4 text-slate-600">
                    <p className="font-medium text-slate-800">{item.department}</p>
                    <p className="text-base text-slate-400">{item.totalActivities} activities logged</p>
                  </td>

                  {/* Date of Submission */}
                  <td className="py-4 px-4 text-slate-500 font-medium">
                    {item.dateSubmitted}
                  </td>

                  {/* PBAS Score */}
                  <td className="py-4 px-4">
                    <span className="font-extrabold text-slate-900 text-base">{item.pbasScore}</span>
                    <span className="text-base text-slate-400 font-semibold"> / 300</span>
                  </td>

                  {/* Verification Status */}
                  <td className="py-4 px-4">
                    {item.verificationStatus === 'Approved' ? (
                      <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">
                        <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                        Approved
                      </span>
                    ) : item.verificationStatus === 'Rejection Requested' ? (
                      <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold bg-rose-50 text-rose-700 border border-rose-200">
                        <AlertCircle className="w-3.5 h-3.5 text-rose-600" />
                        Revisions Needed
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold bg-amber-50 text-amber-700 border border-amber-200">
                        <Clock className="w-3.5 h-3.5 text-amber-600" />
                        Pending Verification
                      </span>
                    )}
                  </td>

                  {/* Action Buttons */}
                  <td className="py-4 px-4 text-right">
                    <div className="flex items-center justify-end gap-2">
                      <button
                        onClick={() => setInspectModalItem(item)}
                        className="px-2.5 py-1 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg text-base font-semibold flex items-center gap-1 transition-all"
                      >
                        <Eye className="w-4 h-4" />
                        Inspect
                      </button>

                      {item.verificationStatus !== 'Approved' && (
                        <button
                          onClick={() => handleApprove(item.id, item.facultyName)}
                          className="px-2.5 py-1 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-base font-semibold shadow-2xs transition-all"
                        >
                          Approve
                        </button>
                      )}
                    </div>
                  </td>

                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* INSPECT MODAL FOR DETAILED FORM REVIEW */}
      {inspectModalItem && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl max-w-2xl w-full p-6 shadow-2xl border border-slate-200 space-y-6 relative max-h-[90vh] overflow-y-auto">
            
            <button 
              onClick={() => setInspectModalItem(null)}
              className="absolute top-4 right-4 p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-full"
            >
              <X className="w-5 h-5" />
            </button>

            {/* Modal Header */}
            <div className="flex items-center gap-4 border-b border-slate-100 pb-4">
              <img 
                src={inspectModalItem.avatar || "/dr_ananya_sharma.png"} 
                alt={inspectModalItem.facultyName} 
                className="w-14 h-14 rounded-full object-cover border-2 border-orange-200 shadow-md"
              />
              <div>
                <h2 className="text-xl font-extrabold text-slate-900">{inspectModalItem.facultyName}</h2>
                <p className="text-base text-slate-500">{inspectModalItem.designation} • {inspectModalItem.department}</p>
                <div className="flex items-center gap-2 mt-1">
                  <span className="text-base font-mono font-bold bg-slate-100 text-slate-700 px-2 py-0.5 rounded-md">
                    {inspectModalItem.employeeCode}
                  </span>
                  <span className="text-xs font-bold bg-orange-100 text-orange-950 px-2 py-0.5 rounded-full">
                    PBAS Score: {inspectModalItem.pbasScore}/300
                  </span>
                </div>
              </div>
            </div>

            {/* Submission Breakdown */}
            <div className="space-y-4">
              <h3 className="text-xs font-bold text-slate-800 uppercase tracking-wider">Submitted Appraisal Summary (AY 2024-25)</h3>
              
              <div className="grid grid-cols-2 gap-3 text-base">
                <div className="p-3 bg-slate-50 rounded-2xl border border-slate-200">
                  <span className="text-slate-400 font-semibold block">Date Submitted</span>
                  <span className="font-bold text-slate-800">{inspectModalItem.dateSubmitted}</span>
                </div>
                <div className="p-3 bg-slate-50 rounded-2xl border border-slate-200">
                  <span className="text-slate-400 font-semibold block">Total Logged Activities</span>
                  <span className="font-bold text-slate-800">{inspectModalItem.totalActivities} Activities</span>
                </div>
                <div className="p-3 bg-slate-50 rounded-2xl border border-slate-200">
                  <span className="text-slate-400 font-semibold block">Evidence Attached</span>
                  <span className="font-bold text-emerald-600">100% Uploaded & Verified</span>
                </div>
                <div className="p-3 bg-slate-50 rounded-2xl border border-slate-200">
                  <span className="text-slate-400 font-semibold block">Verification Status</span>
                  <span className="font-bold text-[#FD6F3B]">{inspectModalItem.verificationStatus}</span>
                </div>
              </div>

              {/* Research & Publications Section */}
              <div className="p-4 bg-orange-50/50 rounded-2xl border border-orange-200/80 space-y-2">
                <h4 className="text-lg font-bold text-orange-950">Auto-Tracked Scopus & Google Scholar Publications</h4>
                <ul className="text-base space-y-1.5 text-slate-700">
                  <li className="flex items-center justify-between gap-2">
                    <span className="min-w-0">1. "Deep Learning for Time Series Forecasting in Industrial IoT" (IEEE Access)</span>
                    <span className="font-bold text-emerald-600 text-base shrink-0">Verified</span>
                  </li>
                  <li className="flex items-center justify-between gap-2">
                    <span className="min-w-0">2. "AI in Higher Education: Trends & Ethical Frameworks" (IJET 2024)</span>
                    <span className="font-bold text-emerald-600 text-base shrink-0">Verified</span>
                  </li>
                </ul>
              </div>
            </div>

            {/* Modal Actions */}
            <div className="flex items-center justify-between pt-4 border-t border-slate-100">
              <button
                onClick={() => generateAppraisalPDF(inspectModalItem)}
                className="px-4 py-2 bg-[#FD6F3B] hover:bg-[#E05320] text-white rounded-xl text-base font-bold shadow-xs flex items-center gap-2 transition-all"
              >
                <Download className="w-4 h-4" />
                <span>Export Individual PDF</span>
              </button>

              <div className="flex items-center gap-2">
                {inspectModalItem.verificationStatus !== 'Rejection Requested' && (
                  <button
                    onClick={() => handleReject(inspectModalItem.id, inspectModalItem.facultyName)}
                    className="px-4 py-2 bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200 rounded-xl text-base font-bold transition-all"
                  >
                    Request Revision
                  </button>
                )}

                {inspectModalItem.verificationStatus !== 'Approved' && (
                  <button
                    onClick={() => handleApprove(inspectModalItem.id, inspectModalItem.facultyName)}
                    className="px-5 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-base font-bold shadow-md shadow-emerald-500/20 transition-all"
                  >
                    Approve Appraisal
                  </button>
                )}
              </div>
            </div>

          </div>
        </div>
      )}

    </div>
  );
}
