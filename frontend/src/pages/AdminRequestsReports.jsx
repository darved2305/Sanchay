import React, { useCallback, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { Building2, Download, FileSpreadsheet, Loader2, Send, UploadCloud, Users } from 'lucide-react';
import { api, listItems, payloadData } from '../lib/api';
import { runtimeConfigMessage } from '../lib/config';
import { Button, Field, Notice, PageHeader, ProgressBar } from '../components/ui';
import { useApiQuery, invalidateQueries } from '../lib/queryCache';
import { pageEnter, cardEnter } from '../lib/motion';

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

async function pollRequest(requestId, onUpdate, { intervalMs = 1200, maxAttempts = 60 } = {}) {
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const request = payloadData(await api.adminRequests.get(requestId));
    onUpdate(request);
    if (request.job?.status === 'completed' || request.job?.status === 'failed') return request;
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  throw new Error('This is taking longer than expected. Check back shortly.');
}

function ExternalRequestPanel() {
  const inputRef = useRef(null);
  const [department, setDepartment] = useState('');
  const [academicYear, setAcademicYear] = useState('');
  const [stage, setStage] = useState('upload');
  const [request, setRequest] = useState(null);
  const [error, setError] = useState('');
  const [downloadUrl, setDownloadUrl] = useState('');
  const requests = useApiQuery(['admin', 'requests'], () => api.adminRequests.list());

  const runUpload = useCallback(async (file) => {
    setError('');
    if (file.type !== XLSX_MIME) {
      setError('Upload the request as an .xlsx file.');
      return;
    }
    setStage('processing');
    try {
      const created = payloadData(await api.adminRequests.uploadUrl(file));
      const uploadHeaders = new Headers();
      uploadHeaders.set('Content-Type', file.type);
      if (created.token) uploadHeaders.set('Authorization', `Bearer ${created.token}`);
      const uploadResponse = await fetch(created.upload_url, { method: 'PUT', headers: uploadHeaders, body: file });
      if (!uploadResponse.ok) throw new Error('The request file could not be uploaded. Please try again.');

      await api.adminRequests.process(created.request_id, { department: department.trim() || null, academic_year: academicYear.trim() || null });
      const finished = await pollRequest(created.request_id, setRequest);
      setRequest(finished);
      if (finished.job?.status === 'failed') {
        setError(finished.job.error || 'This request could not be completed.');
        setStage('upload');
        return;
      }
      const download = payloadData(await api.adminRequests.download(created.request_id));
      setDownloadUrl(download.url);
      setStage('done');
      invalidateQueries(['admin', 'requests']);
    } catch (err) {
      setError(runtimeConfigMessage(err));
      setStage('upload');
    }
  }, [department, academicYear]);

  const handleFileChange = (event) => {
    const file = event.target.files?.[0];
    if (file) void runUpload(file);
  };
  const handleDrop = (event) => {
    event.preventDefault();
    const file = event.dataTransfer.files?.[0];
    if (file) void runUpload(file);
  };

  const recentItems = listItems(requests.data);

  return (
    <motion.section {...cardEnter} className="app-surface space-y-5 p-6">
      <div className="flex items-center gap-2">
        <Send className="h-5 w-5 text-[var(--brand-primary)]" />
        <h2 className="text-lg font-extrabold text-[var(--brand-ink)]">Respond to External Request</h2>
      </div>
      <p className="text-sm font-medium text-[var(--brand-muted)]">
        Upload a university's request spreadsheet. We fill one row per matching faculty member from their confirmed records.
      </p>

      {error && <Notice tone="error">{error}</Notice>}

      {stage === 'upload' && (
        <>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Department" optional>
              <input type="text" value={department} onChange={(event) => setDepartment(event.target.value)} placeholder="e.g. Computer Science" className="input" />
            </Field>
            <Field label="Academic year" optional>
              <input type="text" value={academicYear} onChange={(event) => setAcademicYear(event.target.value)} placeholder="e.g. 2025-26" className="input" />
            </Field>
          </div>
          <div
            className="flex flex-col items-center gap-3 rounded-[var(--radius-card)] border-2 border-dashed border-[var(--brand-lavender-strong)] p-8 text-center"
            onDragOver={(event) => event.preventDefault()}
            onDrop={handleDrop}
          >
            <span className="icon-chip chip-lavender !h-12 !w-12"><UploadCloud className="h-6 w-6" /></span>
            <p className="text-sm font-bold text-[var(--brand-ink)]">Drop the request .xlsx here, or browse</p>
            <Button variant="primary" size="sm" onClick={() => inputRef.current?.click()}>Choose file</Button>
            <input ref={inputRef} type="file" accept=".xlsx" className="hidden" onChange={handleFileChange} />
          </div>
        </>
      )}

      {stage === 'processing' && (
        <div className="flex flex-col items-center gap-3 rounded-[var(--radius-card)] p-8 text-center">
          <Loader2 className="h-7 w-7 animate-spin text-[var(--brand-primary)]" />
          <p className="text-sm font-bold text-[var(--brand-ink)]">{request?.job?.progress_label || 'Working…'}</p>
          <ProgressBar value={request?.job?.progress || 15} className="w-full max-w-xs" />
        </div>
      )}

      {stage === 'done' && request && (
        <div className="space-y-3 rounded-[var(--radius-card)] border border-[var(--brand-mint-strong)] bg-[var(--brand-mint)] p-5 text-center">
          <p className="font-bold text-[var(--brand-ink)]">{request.faculty_count} faculty rows filled</p>
          {request.faculty_with_gaps > 0 && (
            <p className="text-sm font-medium text-[var(--brand-muted)]">{request.faculty_with_gaps} faculty have at least one field that needs manual follow-up.</p>
          )}
          <Button variant="primary" onClick={() => window.open(downloadUrl, '_blank', 'noopener')}>
            <Download className="h-4 w-4" /> Download completed request
          </Button>
          <button type="button" onClick={() => setStage('upload')} className="block w-full text-xs font-bold text-[var(--brand-primary-hover)] hover:underline">Start another request</button>
        </div>
      )}

      {recentItems.length > 0 && (
        <div className="border-t border-[var(--brand-border-soft)] pt-4">
          <h3 className="text-xs font-bold uppercase tracking-wider text-[var(--brand-muted)]">Recent requests</h3>
          <div className="mt-2 space-y-1.5">
            {recentItems.slice(0, 5).map((item) => (
              <div key={item.id} className="flex items-center justify-between text-sm">
                <span className="font-medium text-[var(--brand-ink)]">{item.original_file_name}</span>
                <span className="text-xs font-semibold text-[var(--brand-muted)]">{item.faculty_count} faculty</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </motion.section>
  );
}

function DepartmentReportPanel() {
  const [department, setDepartment] = useState('');
  const [academicYear, setAcademicYear] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState(null);

  const handleGenerate = async () => {
    setBusy(true); setError(''); setResult(null);
    try {
      const filters = { department: department.trim() || null, academic_year: academicYear.trim() || null };
      const generated = payloadData(await api.adminReports.department(filters));
      setResult(generated);
    } catch (err) {
      setError(runtimeConfigMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <motion.section {...cardEnter} className="app-surface space-y-5 p-6">
      <div className="flex items-center gap-2">
        <Building2 className="h-5 w-5 text-[var(--brand-primary)]" />
        <h2 className="text-lg font-extrabold text-[var(--brand-ink)]">Generate Department Report</h2>
      </div>
      <p className="text-sm font-medium text-[var(--brand-muted)]">
        A live snapshot of confirmed activities, publications and FDPs by department and year -- no upload required.
      </p>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Department" optional>
          <input type="text" value={department} onChange={(event) => setDepartment(event.target.value)} placeholder="e.g. Computer Science" className="input" />
        </Field>
        <Field label="Academic year" optional>
          <input type="text" value={academicYear} onChange={(event) => setAcademicYear(event.target.value)} placeholder="e.g. 2025-26" className="input" />
        </Field>
      </div>
      {error && <Notice tone="error">{error}</Notice>}
      <Button variant="primary" onClick={handleGenerate} disabled={busy}>
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileSpreadsheet className="h-4 w-4" />} Generate report
      </Button>
      {result && (
        <div className="space-y-2 rounded-[var(--radius-card)] border border-[var(--brand-border-soft)] p-4">
          <p className="text-sm font-bold text-[var(--brand-ink)]"><Users className="mr-1 inline h-4 w-4" />{result.faculty_count} faculty included</p>
          <Button variant="secondary" size="sm" onClick={() => window.open(result.download_url, '_blank', 'noopener')}>
            <Download className="h-3.5 w-3.5" /> Download PDF
          </Button>
        </div>
      )}
    </motion.section>
  );
}

export default function AdminRequestsReports() {
  return (
    <motion.div {...pageEnter} className="space-y-6 pb-12">
      <PageHeader title="Requests &amp; Reports" subtitle="Answer external data requests and generate internal reports from the same live faculty records." />
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        <ExternalRequestPanel />
        <DepartmentReportPanel />
      </div>
    </motion.div>
  );
}
