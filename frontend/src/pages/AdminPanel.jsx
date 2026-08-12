import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Activity,
  AlertCircle,
  ArrowUpDown,
  Building2,
  CalendarDays,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  CircleHelp,
  ClipboardList,
  Clock3,
  Download,
  Eye,
  FileText,
  Filter,
  LoaderCircle,
  MessageSquare,
  RefreshCw,
  Search,
  Send,
  ShieldCheck,
  UsersRound,
  X,
} from 'lucide-react';
import { apiRequest } from '../lib/api';
import { subscribeToFacultyUpdates } from '../lib/realtime';

const PAGE_SIZE = 25;
const POLL_INTERVAL_MS = 5000;

const INITIAL_FILTERS = {
  q: '',
  department: '',
  academic_year: '',
  status: '',
  sort: 'name',
  order: 'asc',
  page: 1,
  page_size: PAGE_SIZE,
};

const REVIEWABLE_STATUSES = new Set(['submitted', 'under_review', 'pending', 'pending_review', 'in_review']);
const RETURNED_STATUSES = new Set(['returned', 'revision_requested', 'revisions_requested']);
const FINAL_STATUSES = new Set(['approved', 'rejected']);

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function firstDefined(...values) {
  return values.find((value) => value !== undefined && value !== null && value !== '') ?? '';
}

function unwrapPayload(payload) {
  if (isObject(payload) && payload.data !== undefined) return payload.data;
  return payload;
}

function getRootObject(payload) {
  const root = unwrapPayload(payload);
  return isObject(root) ? root : {};
}

function toArray(value) {
  return Array.isArray(value) ? value : [];
}

function getCollection(payload, keys = []) {
  const root = unwrapPayload(payload);
  if (Array.isArray(root)) return { items: root, root: {}, total: root.length };

  const candidates = [root, root?.result, root?.payload].filter(isObject);
  for (const candidate of candidates) {
    for (const key of [...keys, 'items', 'results', 'rows', 'data']) {
      if (Array.isArray(candidate[key])) {
        const pagination = candidate.pagination ?? candidate.meta ?? {};
        return {
          items: candidate[key],
          root: candidate,
          total: firstDefined(candidate.total, candidate.count, pagination.total, candidate[key].length),
        };
      }
    }
  }

  const pagination = root?.pagination ?? root?.meta ?? {};
  return {
    items: [],
    root: isObject(root) ? root : {},
    total: firstDefined(root?.total, root?.count, pagination.total, 0),
  };
}

function getOptionSources(payload, keys) {
  const root = getRootObject(payload);
  const containers = [
    root,
    root.meta,
    root.filters,
    root.filter_options,
    root.facets,
    root.pagination,
  ].filter(isObject);

  return containers.flatMap((container) => keys.flatMap((key) => {
    const value = container[key];
    if (Array.isArray(value)) return value;
    if (isObject(value)) return Object.entries(value).map(([optionValue, label]) => ({ value: optionValue, label }));
    return [];
  }));
}

function normalizeOptions(values) {
  const options = [];
  const seen = new Set();

  values.forEach((item) => {
    const value = typeof item === 'string' || typeof item === 'number'
      ? String(item)
      : firstDefined(item?.value, item?.id, item?.code, item?.key, item?.name);
    if (!value || seen.has(value)) return;
    seen.add(value);
    options.push({
      value,
      label: firstDefined(item?.label, item?.name, item?.title, value),
    });
  });

  return options;
}

function personFor(record) {
  if (!isObject(record)) return {};
  return [record.profile, record.faculty_profile, record.faculty, record.owner, record.user]
    .find(isObject) ?? record;
}

function submissionFor(record) {
  if (!isObject(record)) return {};
  return [record.submission, record.appraisal_submission, record.appraisal, record.current_submission]
    .find(isObject) ?? {};
}

function normalizeStatus(status) {
  return String(status ?? '')
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_');
}

function humanize(value) {
  if (value === undefined || value === null || value === '') return '—';
  return String(value)
    .replace(/[_-]+/g, ' ')
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function formatDate(value) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date);
}

function initials(name) {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
  return parts.slice(0, 2).map((part) => part[0]).join('').toUpperCase() || '?';
}

function numberValue(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value))) return Number(value);
  return null;
}

function normalizePerson(record) {
  const profile = personFor(record);
  const submission = submissionFor(record);
  return {
    id: firstDefined(profile.id, record?.profile_id, record?.faculty_id),
    name: firstDefined(
      record?.faculty_name,
      record?.full_name,
      record?.name,
      profile.full_name,
      profile.name,
      profile.display_name,
      record?.email,
      profile.email,
    ),
    employeeCode: firstDefined(
      record?.employee_code,
      record?.employeeCode,
      profile.employee_code,
      profile.employeeCode,
    ),
    department: firstDefined(
      record?.department_name,
      record?.department,
      profile.department_name,
      profile.department,
      profile.department?.name,
    ),
    designation: firstDefined(record?.designation, profile.designation, profile.title),
    email: firstDefined(record?.email, profile.email),
    avatar: firstDefined(record?.avatar_url, record?.avatar, profile.avatar_url, profile.avatar),
    academicYear: firstDefined(
      record?.academic_year,
      submission.academic_year,
      record?.cycle?.academic_year,
      submission.cycle?.academic_year,
    ),
  };
}

function normalizeRecord(record, kind = 'submission') {
  const person = normalizePerson(record);
  const submission = submissionFor(record);
  const submissionId = firstDefined(
    record?.submission_id,
    record?.appraisal_submission_id,
    submission.id,
    kind === 'submission' ? record?.id : '',
  );
  const id = kind === 'submission'
    ? firstDefined(record?.id, submission.id, record?.submission_id)
    : firstDefined(record?.id, person.id, record?.profile_id, record?.faculty_id);
  const status = firstDefined(
    record?.appraisal_status,
    record?.submission_status,
    submission.status,
    record?.status,
  );

  return {
    ...person,
    id,
    submissionId,
    status,
    submissionDate: firstDefined(
      record?.submission_date,
      record?.date_submitted,
      record?.submitted_at,
      submission.submission_date,
      submission.submitted_at,
    ),
    readiness: firstDefined(record?.readiness, record?.readiness_score, submission.readiness),
    evidenceCompleteness: firstDefined(
      record?.evidence_completeness,
      record?.evidence_completion,
      record?.evidence_percent,
      submission.evidence_completeness,
    ),
    activityCount: firstDefined(
      record?.activity_count,
      record?.total_activities,
      record?.activities_count,
      submission.activity_count,
    ),
    raw: record,
  };
}

function normalizeEvidence(evidence) {
  return toArray(evidence).map((item, index) => {
    if (typeof item === 'string') return { id: `${item}-${index}`, name: item, url: '' };
    return {
      id: firstDefined(item?.id, item?.evidence_id, `${index}`),
      name: firstDefined(item?.name, item?.file_name, item?.filename, item?.title, 'Evidence'),
      url: firstDefined(item?.url, item?.signed_url, item?.download_url),
    };
  });
}

function normalizeActivity(activity, index) {
  const source = activity?.activity ?? activity;
  return {
    id: firstDefined(source?.id, activity?.id, activity?.activity_id, `${index}`),
    title: firstDefined(source?.title, source?.name, source?.activity, source?.activity_name),
    description: firstDefined(source?.description, source?.detail, source?.summary),
    category: firstDefined(source?.category, source?.category_name, source?.type),
    date: firstDefined(source?.date, source?.start_date, source?.activity_date, source?.occurred_at),
    evidence: normalizeEvidence(source?.evidence ?? source?.attachments ?? source?.proof),
    raw: activity,
  };
}

function normalizeSections(payload, submission) {
  const root = getRootObject(payload);
  const sectionSource = [
    root.sections,
    submission.sections,
    root.section_data,
    submission.section_data,
  ].find(Array.isArray);

  if (sectionSource) {
    return sectionSource.map((section, sectionIndex) => {
      const activities = section?.activities ?? section?.items ?? section?.entries ?? [];
      return {
        id: firstDefined(section?.id, section?.section_id, `${sectionIndex}`),
        title: firstDefined(section?.title, section?.name, section?.label, 'Section'),
        description: firstDefined(section?.description, section?.summary),
        activities: toArray(activities).map(normalizeActivity),
      };
    });
  }

  const itemSource = [root.items, submission.items, root.activities, submission.activities]
    .find(Array.isArray);
  if (!itemSource) return [];

  const grouped = new Map();
  itemSource.forEach((item, index) => {
    const key = firstDefined(item?.section_id, item?.section, item?.section_name, 'General');
    const group = grouped.get(key) ?? { id: key, title: humanize(key), activities: [] };
    group.activities.push(normalizeActivity(item, index));
    grouped.set(key, group);
  });
  return [...grouped.values()];
}

function normalizeReview(review, index) {
  const reviewer = review?.reviewer ?? review?.reviewed_by ?? review?.actor ?? review?.user ?? {};
  return {
    id: firstDefined(review?.id, `${index}`),
    action: firstDefined(review?.action, review?.type),
    comment: firstDefined(review?.comment, review?.body, review?.message),
    reviewer: firstDefined(reviewer?.name, reviewer?.full_name, review?.reviewer_name, reviewer?.email),
    createdAt: firstDefined(review?.created_at, review?.createdAt, review?.timestamp),
  };
}

function normalizeDetail(payload, fallback) {
  const root = getRootObject(payload);
  const submission = submissionFor(root).id ? submissionFor(root) : root.submission ?? root;
  const record = normalizeRecord({ ...fallback?.raw, ...submission, profile: root.profile ?? submission.profile ?? fallback?.raw?.profile }, 'submission');
  const reviewsSource = [root.reviews, submission.reviews, root.review_history, submission.review_history]
    .find(Array.isArray);

  return {
    ...record,
    profile: normalizePerson(root.profile ?? submission.profile ?? fallback?.raw ?? fallback),
    sections: normalizeSections(root, submission),
    reviews: toArray(reviewsSource).map(normalizeReview),
  };
}

function extractSignedUrl(payload) {
  const root = getRootObject(payload);
  const result = isObject(root.result) ? root.result : {};
  return firstDefined(
    root.signed_url,
    root.url,
    root.download_url,
    result.signed_url,
    result.url,
    result.download_url,
  );
}

function extractMetrics(payload) {
  const root = getRootObject(payload);
  const arrayCandidate = [root.action_cards, root.cards, root.metrics]
    .find(Array.isArray);
  if (arrayCandidate) {
    return arrayCandidate.map((item, index) => ({
      key: firstDefined(item?.key, item?.id, `${index}`),
      label: firstDefined(item?.label, item?.name, item?.title, 'Metric'),
      value: firstDefined(item?.value, item?.count, item?.total),
      detail: firstDefined(item?.detail, item?.description),
    }));
  }

  const objectCandidate = [root.metrics, root.counts, root.summary, root].find(isObject);
  if (!objectCandidate) return [];

  return Object.entries(objectCandidate)
    .map(([key, value]) => {
      if (isObject(value)) {
        return {
          key,
          label: firstDefined(value.label, value.name, humanize(key)),
          value: firstDefined(value.value, value.count, value.total),
          detail: value.detail,
        };
      }
      return { key, label: humanize(key), value, detail: '' };
    })
    .filter((item) => numberValue(item.value) !== null || (typeof item.value === 'string' && item.value.trim() !== ''))
    .slice(0, 6);
}

function buildQuery(filters) {
  const params = new URLSearchParams();
  params.set('q', filters.q);
  params.set('department', filters.department);
  params.set('academic_year', filters.academic_year);
  params.set('status', filters.status);
  params.set('sort', filters.sort);
  params.set('order', filters.order);
  params.set('page', String(filters.page));
  params.set('page_size', String(filters.page_size));
  return params.toString();
}

async function requestJson(path, options) {
  return apiRequest(path, options);
}

function apiErrorMessage(error, fallback) {
  const detail = error?.response?.data?.detail
    ?? error?.response?.detail
    ?? error?.body?.detail
    ?? error?.detail;
  if (Array.isArray(detail)) return detail.map((item) => item?.msg ?? item?.message ?? String(item)).join(', ');
  if (typeof detail === 'string') return detail;
  if (typeof error?.message === 'string' && error.message.trim()) return error.message;
  return fallback;
}

function canReviewAction(status, action) {
  const normalized = normalizeStatus(status);
  if (FINAL_STATUSES.has(normalized)) return false;
  if (RETURNED_STATUSES.has(normalized)) return action === 'comment';
  if (normalized === 'submitted') return true;
  return REVIEWABLE_STATUSES.has(normalized);
}

function Avatar({ name, src, size = 'w-10 h-10' }) {
  if (src) {
    return <img src={src} alt={name || 'Faculty member'} className={`${size} rounded-full object-cover border-2 border-orange-200`} />;
  }
  return (
    <div className={`${size} rounded-full bg-orange-100 text-[#E05320] border-2 border-orange-200 flex items-center justify-center font-extrabold text-xs`} aria-hidden="true">
      {initials(name)}
    </div>
  );
}

function StatusBadge({ status }) {
  const normalized = normalizeStatus(status);
  const isApproved = normalized === 'approved';
  const isRejected = normalized === 'rejected';
  const isReturned = RETURNED_STATUSES.has(normalized);
  const className = isApproved
    ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
    : isRejected || isReturned
      ? 'bg-rose-50 text-rose-700 border-rose-200'
      : normalized === 'submitted' || normalized === 'under_review' || normalized === 'pending' || normalized === 'pending_review'
        ? 'bg-amber-50 text-amber-700 border-amber-200'
        : 'bg-slate-100 text-slate-700 border-slate-200';
  const Icon = isApproved ? CheckCircle2 : isRejected || isReturned ? AlertCircle : normalized ? Clock3 : CircleHelp;

  return (
    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold border ${className}`}>
      <Icon className="w-3.5 h-3.5" />
      {status ? humanize(status) : 'Status unavailable'}
    </span>
  );
}

function LoadingRows({ columns = 7, rows = 4 }) {
  return Array.from({ length: rows }, (_, rowIndex) => (
    <tr key={rowIndex} className="animate-pulse">
      {Array.from({ length: columns }, (_, columnIndex) => (
        <td key={columnIndex} className="py-4 px-4">
          <div className="h-3 bg-slate-100 rounded w-3/4" />
        </td>
      ))}
    </tr>
  ));
}

function EmptyRow({ columns, children }) {
  return (
    <tr>
      <td colSpan={columns} className="py-14 px-6 text-center">
        <div className="w-12 h-12 rounded-2xl bg-slate-100 text-slate-400 flex items-center justify-center mx-auto mb-3">
          <ClipboardList className="w-6 h-6" />
        </div>
        <p className="font-bold text-slate-800">{children}</p>
        <p className="text-sm text-slate-500 mt-1">Try changing the server-side filters or search.</p>
      </td>
    </tr>
  );
}

function Pagination({ page, total, pageSize, onPageChange, disabled }) {
  const totalPages = Math.max(1, Math.ceil((numberValue(total) ?? 0) / pageSize));
  return (
    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-4 mt-2 border-t border-slate-100 text-sm text-slate-500">
      <span>
        Page {page} of {totalPages} · {numberValue(total) ?? 0} records
      </span>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => onPageChange(page - 1)}
          disabled={disabled || page <= 1}
          className="p-1.5 rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed"
          aria-label="Previous page"
        >
          <ChevronLeft className="w-4 h-4" />
        </button>
        <span className="min-w-8 h-8 rounded-lg bg-[#FD6F3B] text-white font-bold flex items-center justify-center">{page}</span>
        <button
          type="button"
          onClick={() => onPageChange(page + 1)}
          disabled={disabled || page >= totalPages}
          className="p-1.5 rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed"
          aria-label="Next page"
        >
          <ChevronRight className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}

function MetricCard({ metric }) {
  return (
    <div className="p-4 bg-white rounded-2xl border border-slate-200/80 shadow-2xs">
      <span className="text-sm text-slate-500 font-semibold block truncate" title={metric.label}>{metric.label}</span>
      <div className="flex items-baseline justify-between gap-3 mt-1">
        <span className="text-2xl font-extrabold text-slate-900">{metric.value ?? '—'}</span>
        {metric.detail && <span className="text-xs text-slate-400 font-semibold text-right">{metric.detail}</span>}
      </div>
    </div>
  );
}

export default function AdminPanel() {
  const [filters, setFilters] = useState(INITIAL_FILTERS);
  const [overviewState, setOverviewState] = useState({ data: null, loading: true, error: null });
  const [facultyState, setFacultyState] = useState({ data: null, loading: true, error: null });
  const [submissionsState, setSubmissionsState] = useState({ data: null, loading: true, error: null });
  const [selectedSubmission, setSelectedSubmission] = useState(null);
  const [detailState, setDetailState] = useState({ data: null, loading: false, error: null });
  const [reviewComment, setReviewComment] = useState('');
  const [reviewState, setReviewState] = useState({ action: null, error: null });
  const [pdfState, setPdfState] = useState({ id: null, error: null });
  const [notice, setNotice] = useState(null);

  const query = useMemo(() => buildQuery(filters), [filters]);

  const loadOverview = useCallback(async ({ silent = false } = {}) => {
    if (!silent) setOverviewState((previous) => ({ ...previous, loading: true, error: null }));
    try {
      const data = await requestJson('/admin/overview');
      setOverviewState({ data, loading: false, error: null });
    } catch (error) {
      setOverviewState((previous) => ({
        ...previous,
        loading: false,
        error: apiErrorMessage(error, 'Unable to load the institution overview.'),
      }));
    }
  }, []);

  const loadFaculty = useCallback(async ({ silent = false } = {}) => {
    if (!silent) setFacultyState((previous) => ({ ...previous, loading: true, error: null }));
    try {
      const data = await requestJson(`/admin/faculty?${query}`);
      setFacultyState({ data, loading: false, error: null });
    } catch (error) {
      setFacultyState((previous) => ({
        ...previous,
        loading: false,
        error: apiErrorMessage(error, 'Unable to load the faculty directory.'),
      }));
    }
  }, [query]);

  const loadSubmissions = useCallback(async ({ silent = false } = {}) => {
    if (!silent) setSubmissionsState((previous) => ({ ...previous, loading: true, error: null }));
    try {
      const data = await requestJson(`/admin/submissions?${query}`);
      setSubmissionsState({ data, loading: false, error: null });
    } catch (error) {
      setSubmissionsState((previous) => ({
        ...previous,
        loading: false,
        error: apiErrorMessage(error, 'Unable to load the appraisal queue.'),
      }));
    }
  }, [query]);

  const loadDetail = useCallback(async (row, { silent = false } = {}) => {
    if (!row?.id) return;
    if (!silent) setDetailState({ data: null, loading: true, error: null });
    try {
      const data = await requestJson(`/appraisals/submissions/${encodeURIComponent(row.id)}`);
      setDetailState({ data: normalizeDetail(data, row), loading: false, error: null });
    } catch (error) {
      setDetailState((previous) => ({
        ...previous,
        loading: false,
        error: apiErrorMessage(error, 'Unable to load this submission.'),
      }));
    }
  }, []);

  const refreshAll = useCallback(() => {
    void loadOverview({ silent: true });
    void loadFaculty({ silent: true });
    void loadSubmissions({ silent: true });
    if (selectedSubmission) void loadDetail(selectedSubmission, { silent: true });
  }, [loadDetail, loadFaculty, loadOverview, loadSubmissions, selectedSubmission]);

  useEffect(() => {
    void loadOverview();
  }, [loadOverview]);

  useEffect(() => {
    void loadFaculty();
    void loadSubmissions();
  }, [loadFaculty, loadSubmissions]);

  useEffect(() => {
    const intervalId = window.setInterval(() => {
      if (document.visibilityState !== 'hidden') refreshAll();
    }, POLL_INTERVAL_MS);
    const handleFocus = () => refreshAll();
    window.addEventListener('focus', handleFocus);
    return () => {
      window.clearInterval(intervalId);
      window.removeEventListener('focus', handleFocus);
    };
  }, [refreshAll]);

  const facultyCollection = useMemo(
    () => getCollection(facultyState.data, ['faculty', 'profiles']),
    [facultyState.data],
  );
  const submissionsCollection = useMemo(
    () => getCollection(submissionsState.data, ['submissions', 'appraisals']),
    [submissionsState.data],
  );
  const facultyRows = useMemo(
    () => facultyCollection.items.map((item) => normalizeRecord(item, 'faculty')),
    [facultyCollection.items],
  );
  const submissionRows = useMemo(
    () => submissionsCollection.items.map((item) => normalizeRecord(item, 'submission')),
    [submissionsCollection.items],
  );

  const filterOptions = useMemo(() => ({
    departments: normalizeOptions([
      ...getOptionSources(facultyState.data, ['departments', 'department_options']),
      ...getOptionSources(submissionsState.data, ['departments', 'department_options']),
      ...facultyRows.map((row) => row.department),
      ...submissionRows.map((row) => row.department),
    ]),
    academicYears: normalizeOptions([
      ...getOptionSources(facultyState.data, ['academic_years', 'academic_year_options', 'cycles']),
      ...getOptionSources(submissionsState.data, ['academic_years', 'academic_year_options', 'cycles']),
      ...facultyRows.map((row) => row.academicYear),
      ...submissionRows.map((row) => row.academicYear),
    ]),
    statuses: normalizeOptions([
      ...getOptionSources(facultyState.data, ['statuses', 'status_options']),
      ...getOptionSources(submissionsState.data, ['statuses', 'status_options']),
      ...facultyRows.map((row) => row.status),
      ...submissionRows.map((row) => row.status),
    ]),
  }), [facultyRows, facultyState.data, submissionRows, submissionsState.data]);

  const overviewRoot = getRootObject(overviewState.data);
  const metrics = extractMetrics(overviewState.data);
  const institutionName = firstDefined(
    overviewRoot.institution?.name,
    overviewRoot.institution_name,
    overviewRoot.organisation_name,
    overviewRoot.viewer?.institution_name,
    'Institution administration',
  );
  const adminName = firstDefined(
    overviewRoot.admin?.name,
    overviewRoot.admin?.full_name,
    overviewRoot.viewer?.name,
    overviewRoot.viewer?.full_name,
    overviewRoot.current_user?.name,
    overviewRoot.current_user?.full_name,
    overviewRoot.admin_name,
  );
  const realtimeProfileId = firstDefined(
    overviewRoot.admin?.id,
    overviewRoot.viewer?.id,
    overviewRoot.current_user?.id,
    overviewRoot.admin_id,
  );
  const cycleName = firstDefined(
    overviewRoot.cycle?.name,
    overviewRoot.cycle?.academic_year,
    overviewRoot.academic_year,
  );

  useEffect(() => {
    if (!realtimeProfileId) return undefined;
    return subscribeToFacultyUpdates({
      profileId: realtimeProfileId,
      queryKeys: [['admin']],
      onEvent: refreshAll,
    });
  }, [realtimeProfileId, refreshAll]);

  const updateFilter = (key, value) => {
    setFilters((previous) => ({
      ...previous,
      [key]: value,
      page: key === 'page' ? Number(value) : 1,
    }));
  };

  const openSubmission = (row) => {
    setSelectedSubmission(row);
    setReviewComment('');
    setReviewState({ action: null, error: null });
    setPdfState({ id: null, error: null });
    void loadDetail(row);
  };

  const closeSubmission = () => {
    setSelectedSubmission(null);
    setDetailState({ data: null, loading: false, error: null });
    setReviewState({ action: null, error: null });
  };

  const downloadPdf = async (row) => {
    if (!row?.id) return;
    setPdfState({ id: row.id, error: null });
    try {
      const payload = await requestJson(`/appraisals/submissions/${encodeURIComponent(row.id)}/pdf`, {
        method: 'POST',
      });
      const signedUrl = extractSignedUrl(payload);
      if (!signedUrl) throw new Error('The PDF service did not return a signed download URL.');
      window.open(signedUrl, '_blank', 'noopener,noreferrer');
      setNotice({ type: 'success', message: 'The submission PDF is ready in a new tab.' });
    } catch (error) {
      const message = apiErrorMessage(error, 'Unable to generate the submission PDF.');
      setPdfState({ id: row.id, error: message });
      setNotice({ type: 'error', message });
    } finally {
      setPdfState((previous) => ({ ...previous, id: null }));
    }
  };

  const submitReview = async (action) => {
    const detail = detailState.data;
    const row = selectedSubmission;
    if (!detail || !row || !canReviewAction(detail.status, action)) return;
    const comment = reviewComment.trim();
    if (action === 'comment' && !comment) {
      setReviewState({ action: null, error: 'Add a comment before posting it to the review history.' });
      return;
    }

    setReviewState({ action, error: null });
    try {
      await requestJson(`/appraisals/submissions/${encodeURIComponent(row.id)}/review`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: { action, comment },
      });
      setReviewComment('');
      setNotice({ type: 'success', message: `${humanize(action)} was recorded.` });
      await Promise.all([loadOverview({ silent: true }), loadFaculty({ silent: true }), loadSubmissions({ silent: true })]);
      await loadDetail(row);
      setReviewState({ action: null, error: null });
    } catch (error) {
      const message = apiErrorMessage(error, 'The review action could not be completed.');
      setReviewState({ action: null, error: message });
      setNotice({ type: 'error', message });
    }
  };

  const detail = detailState.data;
  const activeStatus = detail?.status ?? selectedSubmission?.status;

  return (
    <div className="space-y-6 pb-12">
      {notice && (
        <div className={`flex items-start gap-3 p-4 rounded-2xl border ${notice.type === 'error' ? 'bg-rose-50 border-rose-200 text-rose-800' : 'bg-emerald-50 border-emerald-200 text-emerald-800'}`} role="status">
          {notice.type === 'error' ? <AlertCircle className="w-5 h-5 shrink-0 mt-0.5" /> : <CheckCircle2 className="w-5 h-5 shrink-0 mt-0.5" />}
          <p className="font-semibold text-sm flex-1">{notice.message}</p>
          <button type="button" onClick={() => setNotice(null)} aria-label="Dismiss message"><X className="w-4 h-4" /></button>
        </div>
      )}

      <div className="p-6 bg-gradient-to-r from-slate-900 via-orange-950 to-slate-900 rounded-3xl text-white shadow-xl flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="flex items-center gap-4 min-w-0">
          <div className="w-12 h-12 rounded-2xl bg-gradient-to-tr from-[#FD6F3B] via-orange-500 to-amber-500 flex items-center justify-center text-white shadow-lg shadow-orange-500/20 shrink-0">
            <ShieldCheck className="w-6 h-6" />
          </div>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-3xl font-extrabold tracking-tight">Institution Admin Console</h1>
              <span className="px-2.5 py-0.5 bg-orange-500/30 text-orange-200 text-xs font-bold rounded-full border border-orange-400/30 uppercase truncate max-w-full">
                {institutionName}
              </span>
            </div>
            <p className="text-base text-slate-300 mt-1">
              {adminName ? `Signed in as ${adminName}.` : 'Review institution-scoped faculty appraisals and submissions.'}
              {cycleName ? ` Current cycle: ${cycleName}.` : ''}
            </p>
          </div>
        </div>

        <button
          type="button"
          onClick={refreshAll}
          className="px-4 py-2.5 bg-[#FD6F3B] hover:bg-[#E05320] text-white rounded-xl text-sm font-bold shadow-md shadow-orange-500/20 flex items-center gap-2 transition-all self-start md:self-auto"
        >
          <RefreshCw className="w-4 h-4" />
          Refresh data
        </button>
      </div>

      {overviewState.error && (
        <div className="p-4 rounded-2xl border border-rose-200 bg-rose-50 text-rose-800 flex items-start gap-3" role="alert">
          <AlertCircle className="w-5 h-5 shrink-0 mt-0.5" />
          <div className="flex-1">
            <p className="font-bold">Overview unavailable</p>
            <p className="text-sm mt-1">{overviewState.error}</p>
          </div>
          <button type="button" onClick={() => loadOverview()} className="text-sm font-bold underline">Retry</button>
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {overviewState.loading && !overviewState.data
          ? Array.from({ length: 4 }, (_, index) => <div key={index} className="h-24 bg-white rounded-2xl border border-slate-200/80 animate-pulse" />)
          : metrics.length > 0
            ? metrics.map((metric) => <MetricCard key={metric.key} metric={metric} />)
            : <div className="sm:col-span-2 lg:col-span-4 p-5 bg-white rounded-2xl border border-slate-200/80 text-sm text-slate-500 flex items-center gap-2">
              <CircleHelp className="w-4 h-4" /> No summary metrics were returned by the institution API.
            </div>}
      </div>

      <div className="bg-white p-5 rounded-3xl border border-slate-200/80 shadow-xs space-y-4">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div>
            <h2 className="text-xl font-bold text-slate-800">Institution-scoped filters</h2>
            <p className="text-sm text-slate-500 mt-1">Search, filtering, sorting, and pagination are handled by the API.</p>
          </div>
          <span className="inline-flex items-center gap-1.5 text-xs font-bold text-slate-500 bg-slate-100 px-2.5 py-1 rounded-full">
            <Activity className="w-3.5 h-3.5 text-emerald-600" /> Live refresh enabled
          </span>
        </div>

        <div className="flex flex-col xl:flex-row gap-3">
          <div className="relative flex-1 min-w-0">
            <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <input
              type="search"
              value={filters.q}
              onChange={(event) => updateFilter('q', event.target.value)}
              placeholder="Search name, email, or employee code"
              className="w-full pl-10 pr-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-[#FD6F3B]/20 focus:border-[#FD6F3B]"
            />
          </div>

          <label className="flex items-center gap-2 text-sm font-semibold text-slate-600">
            <Building2 className="w-4 h-4 text-slate-400 shrink-0" />
            <select
              value={filters.department}
              onChange={(event) => updateFilter('department', event.target.value)}
              className="bg-slate-50 border border-slate-200 text-slate-800 rounded-xl px-3 py-2.5 outline-none font-semibold min-w-40"
            >
              <option value="">All departments</option>
              {filterOptions.departments.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
          </label>

          <label className="flex items-center gap-2 text-sm font-semibold text-slate-600">
            <CalendarDays className="w-4 h-4 text-slate-400 shrink-0" />
            <select
              value={filters.academic_year}
              onChange={(event) => updateFilter('academic_year', event.target.value)}
              className="bg-slate-50 border border-slate-200 text-slate-800 rounded-xl px-3 py-2.5 outline-none font-semibold min-w-36"
            >
              <option value="">All academic years</option>
              {filterOptions.academicYears.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
          </label>

          <label className="flex items-center gap-2 text-sm font-semibold text-slate-600">
            <Filter className="w-4 h-4 text-slate-400 shrink-0" />
            <select
              value={filters.status}
              onChange={(event) => updateFilter('status', event.target.value)}
              className="bg-slate-50 border border-slate-200 text-slate-800 rounded-xl px-3 py-2.5 outline-none font-semibold min-w-36"
            >
              <option value="">All statuses</option>
              {filterOptions.statuses.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
          </label>
        </div>

        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-t border-slate-100 pt-4">
          <div className="flex flex-wrap items-center gap-2 text-sm font-semibold text-slate-600">
            <ArrowUpDown className="w-4 h-4 text-[#FD6F3B]" />
            <span>Sort by</span>
            <select
              value={filters.sort}
              onChange={(event) => updateFilter('sort', event.target.value)}
              className="bg-[#FFF4F0] border border-orange-200 text-[#FD6F3B] rounded-xl px-3 py-2 outline-none font-bold"
            >
              <option value="name">Name</option>
              <option value="employee_code">Employee code</option>
              <option value="submission_date">Submission date</option>
            </select>
            <select
              value={filters.order}
              onChange={(event) => updateFilter('order', event.target.value)}
              className="bg-slate-50 border border-slate-200 text-slate-700 rounded-xl px-3 py-2 outline-none font-semibold"
              aria-label="Sort order"
            >
              <option value="asc">Ascending</option>
              <option value="desc">Descending</option>
            </select>
          </div>
          <label className="flex items-center gap-2 text-sm font-semibold text-slate-600">
            Rows per page
            <select
              value={filters.page_size}
              onChange={(event) => updateFilter('page_size', Number(event.target.value))}
              className="bg-slate-50 border border-slate-200 text-slate-700 rounded-xl px-3 py-2 outline-none font-semibold"
            >
              <option value={25}>25</option>
              <option value={50}>50</option>
              <option value={100}>100</option>
            </select>
          </label>
        </div>
      </div>

      <section className="bg-white rounded-3xl border border-slate-200/80 shadow-xs overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-100 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div>
            <h2 className="text-xl font-bold text-slate-800 flex items-center gap-2"><UsersRound className="w-5 h-5 text-[#FD6F3B]" /> Faculty directory</h2>
            <p className="text-sm text-slate-500 mt-1">Profiles visible to this institution.</p>
          </div>
          {facultyState.error && <button type="button" onClick={() => loadFaculty()} className="text-sm font-bold text-[#FD6F3B] underline">Retry directory</button>}
        </div>
        {facultyState.error && (
          <div className="m-5 p-4 rounded-2xl border border-rose-200 bg-rose-50 text-rose-800 flex items-start gap-3" role="alert">
            <AlertCircle className="w-5 h-5 shrink-0" />
            <p className="text-sm font-semibold">{facultyState.error}</p>
          </div>
        )}
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm border-collapse min-w-[900px]">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200/80 text-slate-400 font-bold uppercase text-xs tracking-wider">
                <th className="py-3.5 px-4">Faculty member</th>
                <th className="py-3.5 px-4">Employee code</th>
                <th className="py-3.5 px-4">Department & role</th>
                <th className="py-3.5 px-4">Academic year</th>
                <th className="py-3.5 px-4">Appraisal status</th>
                <th className="py-3.5 px-4">Submission date</th>
                <th className="py-3.5 px-4 text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {facultyState.loading && !facultyState.data ? <LoadingRows columns={7} /> : facultyRows.length === 0 ? <EmptyRow columns={7}>No faculty match these filters.</EmptyRow> : facultyRows.map((row) => (
                <tr key={row.id} className="hover:bg-slate-50/70 transition-colors">
                  <td className="py-4 px-4">
                    <div className="flex items-center gap-3">
                      <Avatar name={row.name} src={row.avatar} size="w-9 h-9" />
                      <div className="min-w-0">
                        <p className="font-bold text-slate-900 whitespace-nowrap">{row.name || 'Unnamed faculty member'}</p>
                        <p className="text-xs text-slate-500 truncate max-w-56">{row.email || '—'}</p>
                      </div>
                    </div>
                  </td>
                  <td className="py-4 px-4 font-mono text-slate-700 font-semibold">{row.employeeCode || '—'}</td>
                  <td className="py-4 px-4 text-slate-600">
                    <p className="font-semibold text-slate-800">{row.department || '—'}</p>
                    <p className="text-xs text-slate-400">{row.designation || '—'}</p>
                  </td>
                  <td className="py-4 px-4 text-slate-500">{row.academicYear || '—'}</td>
                  <td className="py-4 px-4"><StatusBadge status={row.status} /></td>
                  <td className="py-4 px-4 text-slate-500">{formatDate(row.submissionDate)}</td>
                  <td className="py-4 px-4 text-right">
                    {row.submissionId ? (
                      <button type="button" onClick={() => openSubmission({ ...row, id: row.submissionId })} className="px-2.5 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg text-xs font-bold inline-flex items-center gap-1 transition-all">
                        <Eye className="w-3.5 h-3.5" /> Review
                      </button>
                    ) : <span className="text-xs text-slate-400">No submission</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="px-6 pb-5">
          <Pagination page={filters.page} total={facultyCollection.total} pageSize={filters.page_size} onPageChange={(page) => updateFilter('page', page)} disabled={facultyState.loading} />
        </div>
      </section>

      <section className="bg-white rounded-3xl border border-slate-200/80 shadow-xs overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-100 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div>
            <h2 className="text-xl font-bold text-slate-800 flex items-center gap-2"><FileText className="w-5 h-5 text-[#FD6F3B]" /> Appraisal submissions</h2>
            <p className="text-sm text-slate-500 mt-1">Review the current institution-scoped submission queue.</p>
          </div>
          {submissionsState.error && <button type="button" onClick={() => loadSubmissions()} className="text-sm font-bold text-[#FD6F3B] underline">Retry queue</button>}
        </div>
        {submissionsState.error && (
          <div className="m-5 p-4 rounded-2xl border border-rose-200 bg-rose-50 text-rose-800 flex items-start gap-3" role="alert">
            <AlertCircle className="w-5 h-5 shrink-0" />
            <p className="text-sm font-semibold">{submissionsState.error}</p>
          </div>
        )}
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm border-collapse min-w-[980px]">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200/80 text-slate-400 font-bold uppercase text-xs tracking-wider">
                <th className="py-3.5 px-4">Faculty member</th>
                <th className="py-3.5 px-4">Employee code</th>
                <th className="py-3.5 px-4">Department</th>
                <th className="py-3.5 px-4">Academic year</th>
                <th className="py-3.5 px-4">Submission date</th>
                <th className="py-3.5 px-4">Readiness / evidence</th>
                <th className="py-3.5 px-4">Status</th>
                <th className="py-3.5 px-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {submissionsState.loading && !submissionsState.data ? <LoadingRows columns={8} /> : submissionRows.length === 0 ? <EmptyRow columns={8}>No submissions match these filters.</EmptyRow> : submissionRows.map((row) => {
                const readiness = numberValue(row.readiness);
                const evidence = numberValue(row.evidenceCompleteness);
                return (
                  <tr key={row.id} className="hover:bg-slate-50/70 transition-colors">
                    <td className="py-4 px-4">
                      <div className="flex items-center gap-3">
                        <Avatar name={row.name} src={row.avatar} size="w-9 h-9" />
                        <div className="min-w-0">
                          <p className="font-bold text-slate-900 whitespace-nowrap">{row.name || 'Unnamed faculty member'}</p>
                          <p className="text-xs text-slate-500 truncate max-w-56">{row.email || '—'}</p>
                        </div>
                      </div>
                    </td>
                    <td className="py-4 px-4 font-mono text-slate-700 font-semibold">{row.employeeCode || '—'}</td>
                    <td className="py-4 px-4 text-slate-600">{row.department || '—'}</td>
                    <td className="py-4 px-4 text-slate-500">{row.academicYear || '—'}</td>
                    <td className="py-4 px-4 text-slate-500">{formatDate(row.submissionDate)}</td>
                    <td className="py-4 px-4 min-w-40">
                      {readiness !== null || evidence !== null ? (
                        <div className="space-y-1.5">
                          {readiness !== null && <div><div className="flex justify-between text-xs text-slate-500"><span>Readiness</span><span>{readiness}%</span></div><div className="h-1.5 bg-slate-100 rounded-full overflow-hidden"><div className="h-full bg-[#FD6F3B] rounded-full" style={{ width: `${Math.max(0, Math.min(100, readiness))}%` }} /></div></div>}
                          {evidence !== null && <div><div className="flex justify-between text-xs text-slate-500"><span>Evidence</span><span>{evidence}%</span></div><div className="h-1.5 bg-slate-100 rounded-full overflow-hidden"><div className="h-full bg-emerald-500 rounded-full" style={{ width: `${Math.max(0, Math.min(100, evidence))}%` }} /></div></div>}
                        </div>
                      ) : <span className="text-slate-400">—</span>}
                    </td>
                    <td className="py-4 px-4"><StatusBadge status={row.status} /></td>
                    <td className="py-4 px-4">
                      <div className="flex items-center justify-end gap-2">
                        <button type="button" onClick={() => openSubmission(row)} className="px-2.5 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg text-xs font-bold inline-flex items-center gap-1 transition-all">
                          <Eye className="w-3.5 h-3.5" /> Inspect
                        </button>
                        <button type="button" onClick={() => downloadPdf(row)} disabled={pdfState.id === row.id} className="px-2.5 py-1.5 bg-[#FFF4F0] hover:bg-orange-100 text-[#E05320] border border-orange-200 rounded-lg text-xs font-bold inline-flex items-center gap-1 transition-all disabled:opacity-50 disabled:cursor-wait">
                          {pdfState.id === row.id ? <LoaderCircle className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />} PDF
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="px-6 pb-5">
          <Pagination page={filters.page} total={submissionsCollection.total} pageSize={filters.page_size} onPageChange={(page) => updateFilter('page', page)} disabled={submissionsState.loading} />
        </div>
      </section>

      {selectedSubmission && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-label="Submission review">
          <div className="bg-white rounded-3xl max-w-4xl w-full shadow-2xl border border-slate-200 relative max-h-[92vh] overflow-y-auto">
            <button type="button" onClick={closeSubmission} className="absolute top-4 right-4 z-10 p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-full" aria-label="Close submission review">
              <X className="w-5 h-5" />
            </button>

            {detailState.loading && !detailState.data ? (
              <div className="p-8 space-y-5 animate-pulse">
                <div className="h-8 bg-slate-100 rounded w-2/3" />
                <div className="h-4 bg-slate-100 rounded w-1/3" />
                <div className="h-32 bg-slate-100 rounded-2xl" />
              </div>
            ) : detailState.error ? (
              <div className="p-8 text-center">
                <div className="w-12 h-12 rounded-2xl bg-rose-50 text-rose-600 flex items-center justify-center mx-auto mb-3"><AlertCircle className="w-6 h-6" /></div>
                <h2 className="text-xl font-bold text-slate-900">Submission details unavailable</h2>
                <p className="text-sm text-rose-700 mt-2" role="alert">{detailState.error}</p>
                <button type="button" onClick={() => loadDetail(selectedSubmission)} className="mt-5 px-4 py-2 rounded-xl bg-[#FD6F3B] text-white text-sm font-bold">Retry</button>
              </div>
            ) : detail ? (
              <div className="p-6 sm:p-8 space-y-6">
                <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4 border-b border-slate-100 pb-5 pr-8">
                  <div className="flex items-center gap-4 min-w-0">
                    <Avatar name={detail.profile?.name || detail.name} src={detail.profile?.avatar || detail.avatar} size="w-14 h-14" />
                    <div className="min-w-0">
                      <h2 className="text-2xl font-extrabold text-slate-900 truncate">{detail.profile?.name || detail.name || 'Unnamed faculty member'}</h2>
                      <p className="text-sm text-slate-500 mt-1">{detail.profile?.designation || detail.designation || '—'} · {detail.profile?.department || detail.department || '—'}</p>
                      <div className="flex flex-wrap items-center gap-2 mt-2">
                        <span className="text-xs font-mono font-bold bg-slate-100 text-slate-700 px-2 py-1 rounded-md">{detail.profile?.employeeCode || detail.employeeCode || '—'}</span>
                        <StatusBadge status={detail.status} />
                      </div>
                    </div>
                  </div>
                  <button type="button" onClick={() => downloadPdf(detail)} disabled={pdfState.id === detail.id} className="px-3 py-2 bg-[#FFF4F0] hover:bg-orange-100 text-[#E05320] border border-orange-200 rounded-xl text-sm font-bold inline-flex items-center justify-center gap-2 transition-all disabled:opacity-50 disabled:cursor-wait">
                    {pdfState.id === detail.id ? <LoaderCircle className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />} Download PDF
                  </button>
                </div>

                {pdfState.error && <div className="p-3 rounded-xl border border-rose-200 bg-rose-50 text-rose-800 text-sm font-semibold" role="alert">{pdfState.error}</div>}

                <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 text-sm">
                  <div className="p-3 bg-slate-50 rounded-2xl border border-slate-200"><span className="text-slate-400 font-semibold block">Submitted</span><span className="font-bold text-slate-800">{formatDate(detail.submissionDate)}</span></div>
                  <div className="p-3 bg-slate-50 rounded-2xl border border-slate-200"><span className="text-slate-400 font-semibold block">Academic year</span><span className="font-bold text-slate-800">{detail.academicYear || '—'}</span></div>
                  <div className="p-3 bg-slate-50 rounded-2xl border border-slate-200"><span className="text-slate-400 font-semibold block">Activities</span><span className="font-bold text-slate-800">{detail.activityCount ?? '—'}</span></div>
                  <div className="p-3 bg-slate-50 rounded-2xl border border-slate-200"><span className="text-slate-400 font-semibold block">Current status</span><span className="font-bold text-slate-800">{detail.status ? humanize(detail.status) : '—'}</span></div>
                </div>

                <section className="space-y-3">
                  <div className="flex items-center gap-2"><ClipboardList className="w-5 h-5 text-[#FD6F3B]" /><h3 className="text-lg font-bold text-slate-800">Sections and activities</h3></div>
                  {detail.sections.length === 0 ? (
                    <div className="p-5 rounded-2xl border border-dashed border-slate-300 text-sm text-slate-500">No section or activity data was returned for this submission.</div>
                  ) : detail.sections.map((section) => (
                    <div key={section.id} className="p-4 bg-slate-50/70 rounded-2xl border border-slate-200 space-y-3">
                      <div>
                        <h4 className="font-bold text-slate-900">{section.title}</h4>
                        {section.description && <p className="text-sm text-slate-500 mt-1">{section.description}</p>}
                      </div>
                      {section.activities.length === 0 ? <p className="text-sm text-slate-400">No activities in this section.</p> : (
                        <div className="space-y-2">
                          {section.activities.map((activity) => (
                            <div key={activity.id} className="p-3 bg-white rounded-xl border border-slate-200">
                              <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-2">
                                <div>
                                  <p className="font-bold text-slate-800">{activity.title || 'Untitled activity'}</p>
                                  {activity.description && <p className="text-sm text-slate-500 mt-1">{activity.description}</p>}
                                </div>
                                <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500 shrink-0">
                                  {activity.category && <span className="px-2 py-1 rounded-full bg-orange-50 text-orange-800 font-bold">{humanize(activity.category)}</span>}
                                  {activity.date && <span>{formatDate(activity.date)}</span>}
                                </div>
                              </div>
                              {activity.evidence.length > 0 && <div className="flex flex-wrap gap-2 mt-3">{activity.evidence.map((evidence) => evidence.url ? <a key={evidence.id} href={evidence.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs font-semibold text-[#E05320] hover:underline"><FileText className="w-3.5 h-3.5" />{evidence.name}</a> : <span key={evidence.id} className="inline-flex items-center gap-1 text-xs font-semibold text-slate-500"><FileText className="w-3.5 h-3.5" />{evidence.name}</span>)}</div>}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                </section>

                <section className="space-y-3">
                  <div className="flex items-center gap-2"><MessageSquare className="w-5 h-5 text-[#FD6F3B]" /><h3 className="text-lg font-bold text-slate-800">Review history</h3></div>
                  {detail.reviews.length === 0 ? <div className="p-5 rounded-2xl border border-dashed border-slate-300 text-sm text-slate-500">No review history was returned for this submission.</div> : <div className="space-y-2">{detail.reviews.map((review) => <div key={review.id} className="p-3 rounded-xl border border-slate-200 bg-white"><div className="flex flex-wrap justify-between gap-2"><span className="font-bold text-slate-800">{humanize(review.action)}</span><span className="text-xs text-slate-500">{review.reviewer || 'Reviewer'} · {formatDate(review.createdAt)}</span></div>{review.comment && <p className="text-sm text-slate-600 mt-2 whitespace-pre-wrap">{review.comment}</p>}</div>)}</div>}
                </section>

                <section className="border-t border-slate-100 pt-5 space-y-3">
                  <div><h3 className="text-lg font-bold text-slate-800">Add review comment</h3><p className="text-sm text-slate-500 mt-1">The backend validates the current status and institution scope before applying any action.</p></div>
                  <textarea
                    value={reviewComment}
                    onChange={(event) => setReviewComment(event.target.value)}
                    rows={3}
                    placeholder="Write a comment for the faculty member or review history"
                    className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-sm text-slate-900 resize-y focus:outline-none focus:ring-2 focus:ring-[#FD6F3B]/20 focus:border-[#FD6F3B]"
                  />
                  {reviewState.error && <p className="text-sm text-rose-700 font-semibold" role="alert">{reviewState.error}</p>}
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                    <button type="button" onClick={() => submitReview('comment')} disabled={!canReviewAction(activeStatus, 'comment') || Boolean(reviewState.action)} className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-sm font-bold inline-flex items-center justify-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed"><Send className="w-4 h-4" /> Post comment</button>
                    <div className="flex flex-wrap items-center gap-2 justify-end">
                      <button type="button" onClick={() => submitReview('return')} disabled={!canReviewAction(activeStatus, 'return') || Boolean(reviewState.action)} className="px-4 py-2 bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200 rounded-xl text-sm font-bold inline-flex items-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed">Request changes</button>
                      <button type="button" onClick={() => submitReview('reject')} disabled={!canReviewAction(activeStatus, 'reject') || Boolean(reviewState.action)} className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 border border-slate-200 rounded-xl text-sm font-bold inline-flex items-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed">Reject</button>
                      <button type="button" onClick={() => submitReview('approve')} disabled={!canReviewAction(activeStatus, 'approve') || Boolean(reviewState.action)} className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-sm font-bold inline-flex items-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed">{reviewState.action === 'approve' ? <LoaderCircle className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />} Approve</button>
                    </div>
                  </div>
                  {!canReviewAction(activeStatus, 'approve') && <p className="text-xs text-slate-500">Review actions are disabled for the current submission status.</p>}
                </section>
              </div>
            ) : null}
          </div>
        </div>
      )}
    </div>
  );
}
