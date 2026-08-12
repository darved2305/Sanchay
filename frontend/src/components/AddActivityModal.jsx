import React, { useState } from 'react';
import { X, Search, Sparkles, CheckCircle2, Upload, FileText, Loader2, ArrowRight } from 'lucide-react';
import { SiGooglescholar } from 'react-icons/si';

export default function AddActivityModal({ isOpen, onClose, onAddSuccess }) {
  const [activeTab, setActiveTab] = useState('manual'); // 'manual' | 'scholar'
  const [scholarQuery, setScholarQuery] = useState('');
  const [isSearchingScholar, setIsSearchingScholar] = useState(false);
  const [autoFetchedPaper, setAutoFetchedPaper] = useState(null);

  // Manual Form State
  const [title, setTitle] = useState('');
  const [category, setCategory] = useState('Research & Publications');
  const [date, setDate] = useState('');
  const [description, setDescription] = useState('');
  const [evidenceName, setEvidenceName] = useState('');

  if (!isOpen) return null;

  const handleScholarSearch = (e) => {
    e.preventDefault();
    if (!scholarQuery) return;

    setIsSearchingScholar(true);
    setAutoFetchedPaper(null);

    // Simulate Google Scholar / DOI API fetch delay
    setTimeout(() => {
      setIsSearchingScholar(false);
      setAutoFetchedPaper({
        title: "Deep Learning for Time Series Forecasting in Industrial IoT Systems",
        journal: "IEEE Transactions on Industrial Informatics (Vol 19, Issue 4)",
        doi: "10.1109/TII.2024.3298410",
        citations: 42,
        pubDate: "2024-03-15",
        authors: "Dr. Ananya Sharma, R. K. Gupta, S. Mehta",
        evidenceFile: "IEEE_Paper_FullText_Verified.pdf",
      });
    }, 1200);
  };

  const handleImportPaper = () => {
    if (!autoFetchedPaper) return;
    setTitle(autoFetchedPaper.title);
    setCategory('Research & Publications');
    setDate(autoFetchedPaper.pubDate);
    setDescription(`DOI: ${autoFetchedPaper.doi} | Journal: ${autoFetchedPaper.journal} | Citations: ${autoFetchedPaper.citations}`);
    setEvidenceName(autoFetchedPaper.evidenceFile);
    setActiveTab('manual');
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!title || !date) return;

    const newActivity = {
      id: Date.now(),
      activity: title,
      category: category,
      categoryKey: category.toLowerCase().includes('teaching') ? 'teaching' : 'research',
      dateAdded: date,
      detail: description || 'Manual entry with verified evidence attached',
      status: 'Approved',
    };

    onAddSuccess(newActivity);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-white rounded-3xl max-w-xl w-full p-6 shadow-2xl border border-slate-200 space-y-5 relative max-h-[90vh] overflow-y-auto animate-in fade-in zoom-in-95">
        
        {/* Close Button */}
        <button 
          onClick={onClose}
          className="absolute top-4 right-4 p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-full transition-colors"
        >
          <X className="w-5 h-5" />
        </button>

        {/* Modal Header */}
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-xl font-extrabold text-slate-900">Log New Activity</h2>
            <span className="text-xs font-bold px-2 py-0.5 bg-orange-100 text-orange-950 rounded-full">
              AY 2024-25
            </span>
          </div>
          <p className="text-base text-slate-500 mt-0.5">
            Add an activity manually or auto-fetch using Google Scholar / DOI.
          </p>
        </div>

        {/* Segmented Control Tabs */}
        <div className="bg-slate-100 p-1 rounded-2xl flex">
          <button
            type="button"
            onClick={() => setActiveTab('manual')}
            className={`flex-1 py-2 text-base font-bold rounded-xl transition-all ${
              activeTab === 'manual'
                ? 'bg-white text-slate-900 shadow-xs'
                : 'text-slate-500 hover:text-slate-900'
            }`}
          >
            Manual Entry
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('scholar')}
            className={`flex-1 py-2 text-base font-bold rounded-xl transition-all flex items-center justify-center gap-1.5 ${
              activeTab === 'scholar'
                ? 'bg-[#FD6F3B] text-white shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <SiGooglescholar className="w-4 h-4" />
            <span>Google Scholar / DOI Auto-Fetch</span>
          </button>
        </div>

        {/* TAB 1: MANUAL ENTRY FORM */}
        {activeTab === 'manual' && (
          <form onSubmit={handleSubmit} className="space-y-4 text-base">
            
            <div>
              <label className="block font-bold text-slate-700 mb-1">
                Activity Title *
              </label>
              <input
                type="text"
                required
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="e.g. Published paper in IEEE Transactions on Industrial Informatics"
                className="w-full px-3.5 py-2.5 bg-white border border-slate-200 rounded-xl text-slate-900 focus:outline-none focus:ring-2 focus:ring-[#FD6F3B]/20 focus:border-[#FD6F3B]"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block font-bold text-slate-700 mb-1">
                  Category *
                </label>
                <select
                  value={category}
                  onChange={(e) => setCategory(e.target.value)}
                  className="w-full px-3 py-2.5 bg-white border border-slate-200 rounded-xl text-slate-900 font-medium focus:outline-none focus:ring-2 focus:ring-[#FD6F3B]/20 focus:border-[#FD6F3B]"
                >
                  <option>Research & Publications</option>
                  <option>Teaching & Curriculum</option>
                  <option>Mentorship & Guidance</option>
                  <option>Workshops & FDPs</option>
                  <option>Service & Community</option>
                  <option>Committees & Admin</option>
                </select>
              </div>

              <div>
                <label className="block font-bold text-slate-700 mb-1">
                  Date of Activity *
                </label>
                <input
                  type="date"
                  required
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                  className="w-full px-3 py-2.5 bg-white border border-slate-200 rounded-xl text-slate-900 focus:outline-none focus:ring-2 focus:ring-[#FD6F3B]/20 focus:border-[#FD6F3B]"
                />
              </div>
            </div>

            <div>
              <label className="block font-bold text-slate-700 mb-1">
                Description / Impact Notes
              </label>
              <textarea
                rows={3}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Provide context, citations, key outcomes, or DOI..."
                className="w-full px-3.5 py-2 bg-white border border-slate-200 rounded-xl text-slate-900 focus:outline-none focus:ring-2 focus:ring-[#FD6F3B]/20 focus:border-[#FD6F3B]"
              ></textarea>
            </div>

            {/* Evidence File Upload */}
            <div>
              <label className="block font-bold text-slate-700 mb-1">
                Attach Evidence (PDF / Proof Document)
              </label>
              <div className="p-4 bg-slate-50 border-2 border-dashed border-slate-200 rounded-2xl text-center space-y-2 cursor-pointer hover:bg-orange-50/50 transition-colors">
                <Upload className="w-6 h-6 text-[#FD6F3B] mx-auto" />
                <div className="text-base text-slate-500">
                  {evidenceName ? (
                    <span className="font-bold text-emerald-700 flex items-center justify-center gap-1">
                      <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                      {evidenceName}
                    </span>
                  ) : (
                    <>
                      <span className="font-bold text-[#FD6F3B]">Click to upload</span> or drag and drop proof certificate
                    </>
                  )}
                </div>
              </div>
            </div>

            {/* Modal Actions */}
            <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-base font-bold transition-all"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="px-5 py-2 bg-[#FD6F3B] hover:bg-[#E05320] text-white rounded-xl text-base font-bold shadow-md shadow-orange-500/20 transition-all active:scale-95"
              >
                Save & Add Activity
              </button>
            </div>

          </form>
        )}

        {/* TAB 2: GOOGLE SCHOLAR / DOI AUTO-FETCH */}
        {activeTab === 'scholar' && (
          <div className="space-y-4 text-base">
            <form onSubmit={handleScholarSearch} className="space-y-3">
              <label className="block font-bold text-slate-700">
                Enter DOI, Paper Title, or Google Scholar ID
              </label>
              <div className="flex gap-2">
                <div className="relative flex-1">
                  <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    value={scholarQuery}
                    onChange={(e) => setScholarQuery(e.target.value)}
                    placeholder="e.g. 10.1109/TII.2024.3298410 or 'Deep Learning IoT'"
                    className="w-full pl-9 pr-3 py-2 bg-white border border-slate-200 rounded-xl text-base text-slate-900 focus:outline-none focus:ring-2 focus:ring-[#FD6F3B]/20"
                  />
                </div>
                <button
                  type="submit"
                  disabled={isSearchingScholar}
                  className="px-4 py-2 bg-[#FD6F3B] hover:bg-[#E05320] text-white font-bold rounded-xl text-base flex items-center gap-1.5 transition-all disabled:opacity-50"
                >
                  {isSearchingScholar ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      <span>Fetching...</span>
                    </>
                  ) : (
                    <span>Auto-Fetch</span>
                  )}
                </button>
              </div>
            </form>

            {/* Quick Demo Autofill Suggestions */}
            <div className="flex items-center gap-2">
              <span className="text-base text-slate-400 font-semibold">Try sample DOI:</span>
              <button
                type="button"
                onClick={() => {
                  setScholarQuery("10.1109/TII.2024.3298410");
                }}
                className="text-base text-[#FD6F3B] font-mono hover:underline bg-orange-50 px-2 py-0.5 rounded-md"
              >
                10.1109/TII.2024.3298410
              </button>
            </div>

            {/* Auto-Fetched Paper Result Card */}
            {autoFetchedPaper && (
              <div className="p-4 bg-[#FFF4F0] rounded-2xl border border-orange-200/80 space-y-3 animate-in fade-in slide-in-from-top-2">
                <div className="flex items-start justify-between">
                  <span className="text-xs font-bold px-2 py-0.5 bg-emerald-100 text-emerald-800 rounded-full flex items-center gap-1">
                    <CheckCircle2 className="w-3 h-3" />
                    Verified via Scopus & Google Scholar
                  </span>
                  <span className="text-base text-slate-500 font-mono">DOI: {autoFetchedPaper.doi}</span>
                </div>

                <div>
                  <h4 className="text-lg font-extrabold text-slate-900">{autoFetchedPaper.title}</h4>
                  <p className="text-base text-slate-600 mt-1">{autoFetchedPaper.journal}</p>
                  <p className="text-base text-slate-400 mt-0.5">Authors: {autoFetchedPaper.authors}</p>
                </div>

                <div className="flex items-center justify-between text-base pt-2 border-t border-orange-200/60">
                  <span className="font-bold text-[#E05320]">Citations: {autoFetchedPaper.citations}</span>
                  <span className="text-slate-500">Pub Date: {autoFetchedPaper.pubDate}</span>
                </div>

                <button
                  type="button"
                  onClick={handleImportPaper}
                  className="w-full py-2 bg-[#FD6F3B] hover:bg-[#E05320] text-white font-bold rounded-xl text-base flex items-center justify-center gap-1.5 transition-all shadow-xs"
                >
                  <span>Import into Form & Review</span>
                  <ArrowRight className="w-4 h-4" />
                </button>
              </div>
            )}

          </div>
        )}

      </div>
    </div>
  );
}
