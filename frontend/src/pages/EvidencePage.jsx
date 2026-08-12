import React, { useMemo, useState } from 'react';
import { Download, FileCheck2, Loader2, Paperclip, Upload } from 'lucide-react';
import { api, listItems, payloadData, uploadEvidenceFile } from '../lib/api';
import { useApiQuery, invalidateQueries } from '../lib/queryCache';
import { EVIDENCE_ACCEPT, EVIDENCE_MIME_TYPES, MAX_EVIDENCE_BYTES } from '../lib/constants';
import { runtimeConfigMessage } from '../lib/config';

export default function EvidencePage() {
  const evidence = useApiQuery(['evidence'], () => api.evidence.list({ limit: 100 }));
  const activities = useApiQuery(['activities', { forEvidence: true }], () => api.activities.list({ limit: 100 }));
  const [file, setFile] = useState(null);
  const [activityId, setActivityId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const items = listItems(evidence.data);
  const activityItems = listItems(activities.data).filter((item) => item.status !== 'archived');
  const selectedActivity = useMemo(() => activityItems.find((item) => item.id === activityId), [activityId, activityItems]);

  const selectFile = (event) => {
    const next = event.target.files?.[0] || null;
    setError('');
    if (!next) return setFile(null);
    if (!EVIDENCE_MIME_TYPES.includes(next.type)) return setError('Use PDF, PNG, JPG, JPEG, DOCX or XLSX evidence files.');
    if (next.size > MAX_EVIDENCE_BYTES) return setError('Evidence files must be 25 MB or smaller.');
    setFile(next);
  };
  const upload = async (event) => {
    event.preventDefault();
    if (!file) return setError('Choose a file before uploading.');
    setBusy(true); setError(''); setNotice('');
    try {
      await uploadEvidenceFile(file, activityId ? [activityId] : []);
      setFile(null); event.target.reset(); setNotice(selectedActivity ? 'Evidence uploaded and attached.' : 'Evidence uploaded. Attach it to an activity when ready.');
      invalidateQueries(['evidence']); invalidateQueries(['activities']); invalidateQueries(['dashboard', 'faculty']);
    } catch (uploadError) { setError(runtimeConfigMessage(uploadError)); } finally { setBusy(false); }
  };
  const download = async (item) => {
    try { const result = payloadData(await api.evidence.download(item.id)); const url = result.url || result.download_url; if (url) window.open(url, '_blank', 'noopener,noreferrer'); else setError('The storage service did not return a download URL.'); } catch (downloadError) { setError(runtimeConfigMessage(downloadError)); }
  };
  const attach = async (item) => {
    if (!activityId) return setError('Choose an activity before attaching evidence.');
    setBusy(true); setError('');
    try { await api.evidence.attach(item.id, activityId); invalidateQueries(['evidence']); invalidateQueries(['activities']); setNotice('Evidence attached.'); } catch (attachError) { setError(runtimeConfigMessage(attachError)); } finally { setBusy(false); }
  };

  return <div className="space-y-6 pb-12"><div><h1 className="text-3xl font-extrabold tracking-tight text-slate-900">Evidence &amp; Proof Library</h1><p className="mt-2 text-base text-slate-500">Files are stored in a private Supabase Storage bucket and linked to your activities.</p></div>
    <section className="rounded-3xl border border-orange-200/80 bg-[#FFF4F0] p-6 shadow-xs"><form onSubmit={upload} className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_260px_auto] lg:items-end"><label className="space-y-1.5"><span className="block text-sm font-bold text-orange-950">Choose evidence</span><input type="file" accept={EVIDENCE_ACCEPT} onChange={selectFile} className="block w-full rounded-xl border border-orange-200 bg-white px-3 py-2 text-sm font-medium" /><span className="block text-xs font-medium text-orange-900">PDF, PNG, JPG, DOCX or XLSX · max 25 MB</span></label><label className="space-y-1.5"><span className="block text-sm font-bold text-orange-950">Attach to activity</span><select value={activityId} onChange={(event) => setActivityId(event.target.value)} className="w-full rounded-xl border border-orange-200 bg-white px-3 py-2.5 text-sm font-medium"><option value="">No activity yet</option>{activityItems.map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}</select></label><button disabled={busy || !file} className="flex items-center justify-center gap-2 rounded-xl bg-[#FD6F3B] px-4 py-2.5 text-sm font-bold text-white hover:bg-[#E05320] disabled:opacity-50">{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}Upload file</button></form>{error && <p role="alert" className="mt-4 rounded-xl border border-red-200 bg-red-50 p-3 text-sm font-semibold text-red-800">{error}</p>}{notice && <p role="status" className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm font-semibold text-emerald-800">{notice}</p>}</section>
    <section className="overflow-hidden rounded-3xl border border-slate-200/80 bg-white shadow-xs"><div className="flex items-center justify-between border-b border-slate-100 p-6"><div><h2 className="text-xl font-bold text-slate-900">Your stored evidence</h2><p className="mt-1 text-sm text-slate-500">{evidence.loading ? 'Loading…' : `${items.length} file${items.length === 1 ? '' : 's'} returned by the API`}</p></div><FileCheck2 className="h-6 w-6 text-[#FD6F3B]" /></div>{evidence.error && <p className="p-6 text-sm font-semibold text-red-700">{runtimeConfigMessage(evidence.error)} <button onClick={() => evidence.refetch()} className="ml-2 underline">Retry</button></p>}{!evidence.loading && !evidence.error && items.length === 0 && <div className="p-12 text-center"><Paperclip className="mx-auto h-10 w-10 text-slate-300" /><h3 className="mt-3 text-lg font-bold text-slate-800">No evidence stored yet</h3><p className="mt-1 text-sm text-slate-500">Upload a certificate, paper or supporting document above.</p></div>}{items.length > 0 && <div className="divide-y divide-slate-100">{items.map((item) => <div key={item.id} className="flex flex-col justify-between gap-3 p-5 sm:flex-row sm:items-center"><div className="min-w-0"><p className="truncate font-bold text-slate-900">{item.file_name}</p><p className="mt-1 text-xs font-medium text-slate-500">{item.mime_type} · {Math.ceil(Number(item.size_bytes || 0) / 1024)} KB · {item.created_at ? new Date(item.created_at).toLocaleDateString() : 'date unavailable'}</p></div><div className="flex shrink-0 gap-2"><button onClick={() => attach(item)} disabled={busy || !activityId} className="flex items-center gap-1.5 rounded-lg border border-orange-200 px-3 py-1.5 text-xs font-bold text-[#E05320] hover:bg-orange-50 disabled:opacity-40"><Paperclip className="h-3.5 w-3.5" />Attach</button><button onClick={() => download(item)} className="flex items-center gap-1.5 rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-bold text-white hover:bg-slate-700"><Download className="h-3.5 w-3.5" />Download</button></div></div>)}</div>}</section>
  </div>;
}
