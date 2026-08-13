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
import { Avatar, StatusBadge } from '../components/ui';

const PAGE_SIZE = 25;
const POLL_INTERVAL_MS = 5000;
const ADMIN_REALTIME_QUERY_KEYS = [['admin']];

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

function LoadingRows({ columns = 7, rows = 4 }) {
  return Array.from({ length: rows }, (_, rowIndex) => (
    <tr key={rowIndex}>
      {Array.from({ length: columns }, (_, columnIndex) => (
        <td key={columnIndex} className="py-4 px-4">
          <div className="skeleton h-3 w-3/4" />
        </td>
      ))}
    </tr>
  ));
}

function EmptyRow({ columns, children }) {
  return (
    <tr>
      <td colSpan={columns} className="py-14 px-6 text-center">
        <div className="empty-state-icon mx-auto mb-3">
          <ClipboardList className="w-6 h-6" />
        </div>
        <p className="font-bold text-[var(--brand-ink)]">{children}</p>
        <p className="text-sm font-medium text-[var(--brand-muted)] mt-1">Try changing the server-side filters or search.</p>
      </td>
    </tr>
  );
}

function Pagination({ page, total, pageSize, onPageChange, disabled }) {
  const totalPages = Math.max(1, Math.ceil((numberValue(total) ?? 0) / pageSize));
  return (
    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-4 mt-2 border-t border-[var(--brand-border-soft)] text-sm font-medium text-[var(--brand-muted)]">
      <span>
        Page {page} of {totalPages} · {numberValue(total) ?? 0} records
      </span>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => onPageChange(page - 1)}
          disabled={disabled || page <= 1}
          className="btn btn-secondary btn-sm !p-2"
          aria-label="Previous page"
        >
          <ChevronLeft className="w-4 h-4" />
        </button>
        <span className="min-w-8 h-8 rounded-lg bg-[var(--brand-primary)] text-white font-bold flex items-center justify-center">{page}</span>
        <button
          type="button"
          onClick={() => onPageChange(page + 1)}
          disabled={disabled || page >= totalPages}
          className="btn btn-secondary btn-sm !p-2"
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
    <div className="app-surface p-5">
      <span className="text-sm font-bold text-[var(--brand-muted)] block truncate" title={metric.label}>{metric.label}</span>
      <div className="flex items-baseline justify-between gap-3 mt-2">
        <span className="text-3xl font-extrabold tracking-tight text-[var(--brand-ink)]">{metric.value ?? '—'}</span>
        {metric.detail && <span className="text-xs font-semibold text-[var(--brand-subtle)] text-right">{metric.detail}</span>}
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
      channelName: `admin-updates:${realtimeProfileId}`,
      queryKeys: ADMIN_REALTIME_QUERY_KEYS,
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
        <div className={`notice ${notice.type === 'error' ? 'notice-error' : 'notice-success'}`} role="status">
          {notice.type === 'error' ? <AlertCircle className="w-5 h-5 shrink-0 mt-0.5" /> : <CheckCircle2 className="w-5 h-5 shrink-0 mt-0.5" />}
          <p className="flex-1">{notice.message}</p>
          <button type="button" onClick={() => setNotice(null)} aria-label="Dismiss message"><X className="w-4 h-4" /></button>
        </div>
      )}

      <div className="app-surface flex flex-col justify-between gap-4 !rounded-[var(--radius-panel)] p-6 md:flex-row md:items-center">
        <div className="flex min-w-0 items-center gap-4">
          <span className="icon-chip !h-12 !w-12 !rounded-2xl bg-[var(--brand-primary)] text-white shadow-[0_6px_16px_rgb(139_124_246_/_22%)]">
            <ShieldCheck className="w-6 h-6" />
          </span>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-2xl font-extrabold tracking-tight text-[var(--brand-ink)] sm:text-3xl">Admin Action Center</h1>
              <span className="chip chip-primary max-w-full truncate uppercase">{institutionName}</span>
            </div>
            <p className="mt-1 text-sm font-medium text-[var(--brand-muted)]">
              {adminName ? `Signed in as ${adminName}.` : 'Review institution-scoped faculty appraisals and submissions.'}
              {cycleName ? ` Current cycle: ${cycleName}.` : ''}
            </p>
          </div>
        </div>

        <button type="button" onClick={refreshAll} className="btn btn-primary self-start md:self-auto">
          <RefreshCw className="w-4 h-4" />
          Refresh data
        </button>
      </div>

      {overviewState.error && (
        <div className="notice notice-error" role="alert">
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
          ? Array.from({ length: 4 }, (_, index) => <div key={index} className="skeleton h-24 !rounded-[var(--radius-card)]" />)
          : metrics.length > 0
            ? metrics.map((metric) => <MetricCard key={metric.key} metric={metric} />)
            : <div className="app-surface flex items-center gap-2 p-5 text-sm font-medium text-[var(--brand-muted)] sm:col-span-2 lg:col-span-4">
              <CircleHelp className="w-4 h-4" /> No summary metrics were returned by the institution API.
            </div>}
      </div>

      <div className="app-surface space-y-4 p-5">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div>
            <h2 className="text-xl font-extrabold text-[var(--brand-ink)]">Institution-scoped filters</h2>
            <p className="text-sm font-medium text-[var(--brand-muted)] mt-1">Search, filtering, sorting, and pagination are handled by the API.</p>
          </div>
          <span className="chip chip-mint">
            <Activity className="w-3.5 h-3.5" /> Live refresh enabled
          </span>
        </div>

        <div className="flex flex-col xl:flex-row gap-3">
          <div className="relative flex-1 min-w-0">
            <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--brand-subtle)]" />
            <input
              type="search"
              value={filters.q}
              onChange={(event) => updateFilter('q', event.target.value)}
              placeholder="Search name, email, or employee code"
              className="input !pl-10"
            />
          </div>

          <label className="flex items-center gap-2 text-sm font-semibold text-[var(--brand-muted)]">
            <Building2 className="w-4 h-4 text-[var(--brand-subtle)] shrink-0" />
            <select
              value={filters.department}
              onChange={(event) => updateFilter('department', event.target.value)}
              className="input !w-auto min-w-40 font-semibold"
            >
              <option value="">All departments</option>
              {filterOptions.departments.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
          </label>

          <label className="flex items-center gap-2 text-sm font-semibold text-[var(--brand-muted)]">
            <CalendarDays className="w-4 h-4 text-[var(--brand-subtle)] shrink-0" />
            <select
              value={filters.academic_year}
              onChange={(event) => updateFilter('academic_year', event.target.value)}
              className="input !w-auto min-w-36 font-semibold"
            >
              <option value="">All academic years</option>
              {filterOptions.academicYears.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
          </label>

          <label className="flex items-center gap-2 text-sm font-semibold text-[var(--brand-muted)]">
            <Filter className="w-4 h-4 text-[var(--brand-subtle)] shrink-0" />
            <select
              value={filters.status}
              onChange={(event) => updateFilter('status', event.target.value)}
              className="input !w-auto min-w-36 font-semibold"
            >
              <option value="">All statuses</option>
              {filterOptions.statuses.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
          </label>
        </div>

        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-t border-[var(--brand-border-soft)] pt-4">
          <div className="flex flex-wrap items-center gap-2 text-sm font-semibold text-[var(--brand-muted)]">
            <ArrowUpDown className="w-4 h-4 text-[var(--brand-primary)]" />
            <span>Sort by</span>
            <select
              value={filters.sort}
              onChange={(event) => updateFilter('sort', event.target.value)}
              className="input !w-auto !bg-[var(--brand-primary-softer)] !border-[var(--brand-lavender-strong)] font-bold !text-[var(--brand-primary-hover)]"
            >
              <option value="name">Name</option>
              <option value="employee_code">Employee code</option>
              <option value="submission_date">Submission date</option>
            </select>
            <select
              value={filters.order}
              onChange={(event) => updateFilter('order', event.target.value)}
              className="input !w-auto font-semibold"
              aria-label="Sort order"
            >
              <option value="asc">Ascending</option>
              <option value="desc">Descending</option>
            </select>
          </div>
          <label className="flex items-center gap-2 text-sm font-semibold text-[var(--brand-muted)]">
            Rows per page
            <select
              value={filters.page_size}
              onChange={(event) => updateFilter('page_size', Number(event.target.value))}
              className="input !w-auto font-semibold"
            >
              <option value={25}>25</option>
              <option value={50}>50</option>
              <option value={100}>100</option>
            </select>
          </label>
        </div>
      </div>

      <section className="app-surface overflow-hidden">
        <div className="px-6 py-4 border-b border-[var(--brand-border-soft)] flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div>
            <h2 className="text-xl font-extrabold text-[var(--brand-ink)] flex items-center gap-2"><UsersRound className="w-5 h-5 text-[var(--brand-primary)]" /> Faculty directory</h2>
            <p className="text-sm font-medium text-[var(--brand-muted)] mt-1">Profiles visible to this institution.</p>
          </div>
          {facultyState.error && <button type="button" onClick={() => loadFaculty()} className="text-sm font-bold text-[var(--brand-primary-hover)] underline">Retry directory</button>}
        </div>
        {facultyState.error && (
          <div className="m-5 notice notice-error" role="alert">
            <AlertCircle className="w-5 h-5 shrink-0" />
            <p>{facultyState.error}</p>
          </div>
        )}
        <div className="table-shell">
          <table className="table min-w-[900px]">
            <thead>
              <tr>
                <th>Faculty member</th>
                <th>Employee code</th>
                <th>Department & role</th>
                <th>Academic year</th>
                <th>Appraisal status</th>
                <th>Submission date</th>
                <th className="text-right">Action</th>
              </tr>
            </thead>
            <tbody>
              {facultyState.loading && !facultyState.data ? <LoadingRows columns={7} /> : facultyRows.length === 0 ? <EmptyRow columns={7}>No faculty match these filters.</EmptyRow> : facultyRows.map((row) => (
                <tr key={row.id}>
                  <td>
                    <div className="flex items-center gap-3">
                      <Avatar name={row.name} src={row.avatar} size="h-9 w-9" />
                      <div className="min-w-0">
                        <p className="font-bold text-[var(--brand-ink)] whitespace-nowrap">{row.name || 'Unnamed faculty member'}</p>
                        <p className="text-xs font-medium text-[var(--brand-muted)] truncate max-w-56">{row.email || '—'}</p>
                      </div>
                    </div>
                  </td>
                  <td className="font-mono font-semibold text-[var(--brand-text)]">{row.employeeCode || '—'}</td>
                  <td>
                    <p className="font-semibold text-[var(--brand-ink)]">{row.department || '—'}</p>
                    <p className="text-xs font-medium text-[var(--brand-subtle)]">{row.designation || '—'}</p>
                  </td>
                  <td className="text-[var(--brand-muted)]">{row.academicYear || '—'}</td>
                  <td><StatusBadge status={row.status} /></td>
                  <td className="text-[var(--brand-muted)]">{formatDate(row.submissionDate)}</td>
                  <td className="text-right">
                    {row.submissionId ? (
                      <button type="button" onClick={() => openSubmission({ ...row, id: row.submissionId })} className="btn btn-soft btn-sm">
                        <Eye className="w-3.5 h-3.5" /> Review
                      </button>
                    ) : <span className="text-xs font-medium text-[var(--brand-subtle)]">No submission</span>}
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

      <section className="app-surface overflow-hidden">
        <div className="px-6 py-4 border-b border-[var(--brand-border-soft)] flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div>
            <h2 className="text-xl font-extrabold text-[var(--brand-ink)] flex items-center gap-2"><FileText className="w-5 h-5 text-[var(--brand-primary)]" /> Appraisal submissions</h2>
            <p className="text-sm font-medium text-[var(--brand-muted)] mt-1">Review the current institution-scoped submission queue.</p>
          </div>
          {submissionsState.error && <button type="button" onClick={() => loadSubmissions()} className="text-sm font-bold text-[var(--brand-primary-hover)] underline">Retry queue</button>}
        </div>
        {submissionsState.error && (
          <div className="m-5 notice notice-error" role="alert">
            <AlertCircle className="w-5 h-5 shrink-0" />
            <p>{submissionsState.error}</p>
          </div>
        )}
        <div className="table-shell">
          <table className="table min-w-[980px]">
            <thead>
              <tr>
                <th>Faculty member</th>
                <th>Employee code</th>
                <th>Department</th>
                <th>Academic year</th>
                <th>Submission date</th>
                <th>Readiness / evidence</th>
                <th>Status</th>
                <th className="text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {submissionsState.loading && !submissionsState.data ? <LoadingRows columns={8} /> : submissionRows.length === 0 ? <EmptyRow columns={8}>No submissions match these filters.</EmptyRow> : submissionRows.map((row) => {
                const readiness = numberValue(row.readiness);
                const evidence = numberValue(row.evidenceCompleteness);
                return (
                  <tr key={row.id}>
                    <td>
                      <div className="flex items-center gap-3">
                        <Avatar name={row.name} src={row.avatar} size="h-9 w-9" />
                        <div className="min-w-0">
                          <p className="font-bold text-[var(--brand-ink)] whitespace-nowrap">{row.name || 'Unnamed faculty member'}</p>
                          <p className="text-xs font-medium text-[var(--brand-muted)] truncate max-w-56">{row.email || '—'}</p>
                        </div>
                      </div>
                    </td>
                    <td className="font-mono font-semibold text-[var(--brand-text)]">{row.employeeCode || '—'}</td>
                    <td className="text-[var(--brand-text)]">{row.department || '—'}</td>
                    <td className="text-[var(--brand-muted)]">{row.academicYear || '—'}</td>
                    <td className="text-[var(--brand-muted)]">{formatDate(row.submissionDate)}</td>
                    <td className="min-w-40">
                      {readiness !== null || evidence !== null ? (
                        <div className="space-y-1.5">
                          {readiness !== null && <div><div className="flex justify-between text-xs font-medium text-[var(--brand-muted)]"><span>Readiness</span><span>{readiness}%</span></div><div className="progress-track !h-1.5"><div className="progress-fill" style={{ width: `${Math.max(0, Math.min(100, readiness))}%` }} /></div></div>}
                          {evidence !== null && <div><div className="flex justify-between text-xs font-medium text-[var(--brand-muted)]"><span>Evidence</span><span>{evidence}%</span></div><div className="progress-track !h-1.5"><div className="progress-fill" style={{ width: `${Math.max(0, Math.min(100, evidence))}%`, background: 'var(--brand-success)' }} /></div></div>}
                        </div>
                      ) : <span className="text-[var(--brand-subtle)]">—</span>}
                    </td>
                    <td><StatusBadge status={row.status} /></td>
                    <td>
                      <div className="flex items-center justify-end gap-2">
                        <button type="button" onClick={() => openSubmission(row)} className="btn btn-soft btn-sm">
                          <Eye className="w-3.5 h-3.5" /> Inspect
                        </button>
                        <button type="button" onClick={() => downloadPdf(row)} disabled={pdfState.id === row.id} className="btn btn-secondary btn-sm disabled:cursor-wait">
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
        <div className="fixed inset-0 z-50 bg-[rgb(28_27_32_/_45%)] backdrop-blur-sm flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-label="Submission review">
          <div className="app-surface !rounded-[var(--radius-panel)] max-w-4xl w-full relative max-h-[92vh] overflow-y-auto">
            <button type="button" onClick={closeSubmission} className="absolute top-4 right-4 z-10 rounded-full p-2 text-[var(--brand-subtle)] transition hover:bg-[var(--brand-surface-muted)] hover:text-[var(--brand-ink)]" aria-label="Close submission review">
              <X className="w-5 h-5" />
            </button>

            {detailState.loading && !detailState.data ? (
              <div className="p-8 space-y-5">
                <div className="skeleton h-8 w-2/3" />
                <div className="skeleton h-4 w-1/3" />
                <div className="skeleton h-32 !rounded-[var(--radius-card)]" />
              </div>
            ) : detailState.error ? (
              <div className="p-8 text-center">
                <div className="empty-state-icon mx-auto mb-3" style={{ background: 'var(--brand-danger-soft)', color: 'var(--brand-rose-ink)' }}><AlertCircle className="w-6 h-6" /></div>
                <h2 className="text-xl font-extrabold text-[var(--brand-ink)]">Submission details unavailable</h2>
                <p className="text-sm font-semibold text-[var(--brand-rose-ink)] mt-2" role="alert">{detailState.error}</p>
                <button type="button" onClick={() => loadDetail(selectedSubmission)} className="btn btn-primary mt-5">Retry</button>
              </div>
            ) : detail ? (
              <div className="p-6 sm:p-8 space-y-6">
                <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4 border-b border-[var(--brand-border-soft)] pb-5 pr-8">
                  <div className="flex items-center gap-4 min-w-0">
                    <Avatar name={detail.profile?.name || detail.name} src={detail.profile?.avatar || detail.avatar} size="h-14 w-14" />
                    <div className="min-w-0">
                      <h2 className="text-2xl font-extrabold text-[var(--brand-ink)] truncate">{detail.profile?.name || detail.name || 'Unnamed faculty member'}</h2>
                      <p className="text-sm font-medium text-[var(--brand-muted)] mt-1">{detail.profile?.designation || detail.designation || '—'} · {detail.profile?.department || detail.department || '—'}</p>
                      <div className="flex flex-wrap items-center gap-2 mt-2">
                        <span className="chip chip-surface font-mono">{detail.profile?.employeeCode || detail.employeeCode || '—'}</span>
                        <StatusBadge status={detail.status} />
                      </div>
                    </div>
                  </div>
                  <button type="button" onClick={() => downloadPdf(detail)} disabled={pdfState.id === detail.id} className="btn btn-secondary shrink-0 disabled:cursor-wait">
                    {pdfState.id === detail.id ? <LoaderCircle className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />} Download PDF
                  </button>
                </div>

                {pdfState.error && <div className="notice notice-error" role="alert">{pdfState.error}</div>}

                <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 text-sm">
                  <div className="rounded-[var(--radius-control)] border border-[var(--brand-border-soft)] bg-[var(--brand-canvas-soft)] p-3"><span className="block text-xs font-semibold text-[var(--brand-subtle)]">Submitted</span><span className="font-bold text-[var(--brand-ink)]">{formatDate(detail.submissionDate)}</span></div>
                  <div className="rounded-[var(--radius-control)] border border-[var(--brand-border-soft)] bg-[var(--brand-canvas-soft)] p-3"><span className="block text-xs font-semibold text-[var(--brand-subtle)]">Academic year</span><span className="font-bold text-[var(--brand-ink)]">{detail.academicYear || '—'}</span></div>
                  <div className="rounded-[var(--radius-control)] border border-[var(--brand-border-soft)] bg-[var(--brand-canvas-soft)] p-3"><span className="block text-xs font-semibold text-[var(--brand-subtle)]">Activities</span><span className="font-bold text-[var(--brand-ink)]">{detail.activityCount ?? '—'}</span></div>
                  <div className="rounded-[var(--radius-control)] border border-[var(--brand-border-soft)] bg-[var(--brand-canvas-soft)] p-3"><span className="block text-xs font-semibold text-[var(--brand-subtle)]">Current status</span><span className="font-bold text-[var(--brand-ink)]">{detail.status ? humanize(detail.status) : '—'}</span></div>
                </div>

                <section className="space-y-3">
                  <div className="flex items-center gap-2"><ClipboardList className="w-5 h-5 text-[var(--brand-primary)]" /><h3 className="text-lg font-extrabold text-[var(--brand-ink)]">Sections and activities</h3></div>
                  {detail.sections.length === 0 ? (
                    <div className="rounded-[var(--radius-card)] border border-dashed border-[var(--brand-border)] p-5 text-sm font-medium text-[var(--brand-muted)]">No section or activity data was returned for this submission.</div>
                  ) : detail.sections.map((section) => (
                    <div key={section.id} className="space-y-3 rounded-[var(--radius-card)] border border-[var(--brand-border-soft)] bg-[var(--brand-canvas-soft)] p-4">
                      <div>
                        <h4 className="font-bold text-[var(--brand-ink)]">{section.title}</h4>
                        {section.description && <p className="text-sm font-medium text-[var(--brand-muted)] mt-1">{section.description}</p>}
                      </div>
                      {section.activities.length === 0 ? <p className="text-sm font-medium text-[var(--brand-subtle)]">No activities in this section.</p> : (
                        <div className="space-y-2">
                          {section.activities.map((activity) => (
                            <div key={activity.id} className="rounded-[var(--radius-control)] border border-[var(--brand-border-soft)] bg-[var(--brand-surface)] p-3">
                              <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-2">
                                <div>
                                  <p className="font-bold text-[var(--brand-ink)]">{activity.title || 'Untitled activity'}</p>
                                  {activity.description && <p className="text-sm font-medium text-[var(--brand-muted)] mt-1">{activity.description}</p>}
                                </div>
                                <div className="flex flex-wrap items-center gap-2 text-xs font-medium text-[var(--brand-muted)] shrink-0">
                                  {activity.category && <span className="chip chip-primary !text-[11px]">{humanize(activity.category)}</span>}
                                  {activity.date && <span>{formatDate(activity.date)}</span>}
                                </div>
                              </div>
                              {activity.evidence.length > 0 && <div className="flex flex-wrap gap-2 mt-3">{activity.evidence.map((evidence) => evidence.url ? <a key={evidence.id} href={evidence.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs font-bold text-[var(--brand-primary-hover)] hover:underline"><FileText className="w-3.5 h-3.5" />{evidence.name}</a> : <span key={evidence.id} className="inline-flex items-center gap-1 text-xs font-semibold text-[var(--brand-muted)]"><FileText className="w-3.5 h-3.5" />{evidence.name}</span>)}</div>}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                </section>

                <section className="space-y-3">
                  <div className="flex items-center gap-2"><MessageSquare className="w-5 h-5 text-[var(--brand-primary)]" /><h3 className="text-lg font-extrabold text-[var(--brand-ink)]">Review history</h3></div>
                  {detail.reviews.length === 0 ? <div className="rounded-[var(--radius-card)] border border-dashed border-[var(--brand-border)] p-5 text-sm font-medium text-[var(--brand-muted)]">No review history was returned for this submission.</div> : <div className="space-y-2">{detail.reviews.map((review) => <div key={review.id} className="rounded-[var(--radius-control)] border border-[var(--brand-border-soft)] bg-[var(--brand-surface)] p-3"><div className="flex flex-wrap justify-between gap-2"><span className="font-bold text-[var(--brand-ink)]">{humanize(review.action)}</span><span className="text-xs font-medium text-[var(--brand-muted)]">{review.reviewer || 'Reviewer'} · {formatDate(review.createdAt)}</span></div>{review.comment && <p className="text-sm font-medium text-[var(--brand-muted)] mt-2 whitespace-pre-wrap">{review.comment}</p>}</div>)}</div>}
                </section>

                <section className="border-t border-[var(--brand-border-soft)] pt-5 space-y-3">
                  <div><h3 className="text-lg font-extrabold text-[var(--brand-ink)]">Add review comment</h3><p className="text-sm font-medium text-[var(--brand-muted)] mt-1">The backend validates the current status and institution scope before applying any action.</p></div>
                  <textarea
                    value={reviewComment}
                    onChange={(event) => setReviewComment(event.target.value)}
                    rows={3}
                    placeholder="Write a comment for the faculty member or review history"
                    className="input resize-y"
                  />
                  {reviewState.error && <p className="text-sm font-semibold text-[var(--brand-rose-ink)]" role="alert">{reviewState.error}</p>}
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                    <button type="button" onClick={() => submitReview('comment')} disabled={!canReviewAction(activeStatus, 'comment') || Boolean(reviewState.action)} className="btn btn-secondary"><Send className="w-4 h-4" /> Post comment</button>
                    <div className="flex flex-wrap items-center gap-2 justify-end">
                      <button type="button" onClick={() => submitReview('return')} disabled={!canReviewAction(activeStatus, 'return') || Boolean(reviewState.action)} className="btn btn-attention">Request changes</button>
                      <button type="button" onClick={() => submitReview('reject')} disabled={!canReviewAction(activeStatus, 'reject') || Boolean(reviewState.action)} className="btn btn-destructive">Reject</button>
                      <button type="button" onClick={() => submitReview('approve')} disabled={!canReviewAction(activeStatus, 'approve') || Boolean(reviewState.action)} className="btn btn-success-solid">{reviewState.action === 'approve' ? <LoaderCircle className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />} Approve</button>
                    </div>
                  </div>
                  {!canReviewAction(activeStatus, 'approve') && <p className="text-xs font-medium text-[var(--brand-muted)]">Review actions are disabled for the current submission status.</p>}
                </section>
              </div>
            ) : null}
          </div>
        </div>
      )}
    </div>
  );
}
