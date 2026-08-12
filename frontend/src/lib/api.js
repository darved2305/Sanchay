import { getSession } from './supabase';
import { requireRuntimeConfig } from './config';

export class ApiError extends Error {
  constructor(message, { status = 0, fieldErrors = null, payload = null } = {}) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.fieldErrors = fieldErrors;
    this.payload = payload;
  }

  get isUnauthorized() {
    return this.status === 401 || this.status === 403;
  }
}

function getDetail(payload, fallback) {
  if (typeof payload === 'string' && payload.trim()) return payload;
  if (typeof payload?.detail === 'string') return payload.detail;
  if (typeof payload?.error?.detail === 'string') return payload.error.detail;
  if (typeof payload?.message === 'string') return payload.message;
  if (typeof payload?.error?.message === 'string') return payload.error.message;
  return fallback;
}

function getFieldErrors(payload) {
  return payload?.field_map || payload?.error?.field_map || payload?.error?.detail?.field_map || null;
}

export async function apiRequest(path, options = {}) {
  const { apiUrl } = requireRuntimeConfig();
  const {
    method = 'GET',
    body,
    headers = {},
    signal,
    auth = true,
  } = options;

  const requestHeaders = new Headers(headers);
  if (auth) {
    const session = await getSession();
    if (!session?.access_token) {
      throw new ApiError('Your session has expired. Please sign in again.', { status: 401 });
    }
    requestHeaders.set('Authorization', `Bearer ${session.access_token}`);
  }

  let requestBody = body;
  if (body !== undefined && !(body instanceof FormData) && !(body instanceof Blob)) {
    requestHeaders.set('Content-Type', 'application/json');
    requestBody = JSON.stringify(body);
  }

  let response;
  try {
    response = await fetch(`${apiUrl}${path.startsWith('/') ? path : `/${path}`}`, {
      method,
      headers: requestHeaders,
      body: requestBody,
      signal,
    });
  } catch (error) {
    throw new ApiError(error?.message || 'Could not reach the Sanchaya service.', { payload: error });
  }

  const contentType = response.headers.get('content-type') || '';
  const payload = contentType.includes('application/json')
    ? await response.json().catch(() => null)
    : await response.text().catch(() => '');

  if (!response.ok) {
    throw new ApiError(getDetail(payload, `Request failed (${response.status}).`), {
      status: response.status,
      fieldErrors: getFieldErrors(payload),
      payload,
    });
  }

  return payload;
}

function queryString(params = {}) {
  const search = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && String(value).trim() !== '') search.set(key, String(value));
  });
  const value = search.toString();
  return value ? `?${value}` : '';
}

export function listItems(payload) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.items)) return payload.items;
  if (Array.isArray(payload?.data)) return payload.data;
  if (Array.isArray(payload?.data?.items)) return payload.data.items;
  return [];
}

export function payloadData(payload) {
  return payload?.data ?? payload;
}

export const api = {
  authMe: () => apiRequest('/auth/me'),
  dashboardFaculty: () => apiRequest('/dashboard/faculty'),
  profile: () => apiRequest('/profile'),
  updateProfile: (fields) => apiRequest('/profile', { method: 'PATCH', body: fields }),
  completeOnboarding: () => apiRequest('/profile/onboarding/complete', { method: 'POST' }),

  activities: {
    list: (params) => apiRequest(`/activities${queryString(params)}`),
    get: (id) => apiRequest(`/activities/${id}`),
    create: (activity) => apiRequest('/activities', { method: 'POST', body: activity }),
    update: (id, activity) => apiRequest(`/activities/${id}`, { method: 'PATCH', body: activity }),
    archive: (id) => apiRequest(`/activities/${id}/archive`, { method: 'POST' }),
    confirm: (id, fields) => apiRequest(`/activities/${id}/confirm`, { method: 'POST', body: fields }),
  },

  evidence: {
    list: (params) => apiRequest(`/evidence${queryString(params)}`),
    uploadUrl: (file) => apiRequest('/evidence/upload-url', {
      method: 'POST',
      body: { file_name: file.name, mime: file.type, size: file.size },
    }),
    finalize: (id) => apiRequest(`/evidence/${id}/finalize`, { method: 'POST' }),
    attach: (id, activityId) => apiRequest(`/evidence/${id}/attach`, {
      method: 'POST',
      body: { activity_id: activityId },
    }),
    detach: (id, activityId) => apiRequest(`/evidence/${id}/attach/${activityId}`, { method: 'DELETE' }),
    download: (id) => apiRequest(`/evidence/${id}/download`),
    delete: (id) => apiRequest(`/evidence/${id}`, { method: 'DELETE' }),
  },

  publications: {
    candidates: (status = 'pending') => apiRequest(`/publications/candidates${queryString({ status })}`),
    sync: () => apiRequest('/publications/sync', { method: 'POST' }),
    confirm: (id) => apiRequest(`/publications/candidates/${id}/confirm`, { method: 'POST' }),
    reject: (id) => apiRequest(`/publications/candidates/${id}/reject`, { method: 'POST' }),
  },

  notifications: (params) => apiRequest(`/notifications${queryString(params)}`),
  markNotificationsRead: (body) => apiRequest('/notifications/read', { method: 'POST', body }),

  appraisals: {
    cycles: () => apiRequest('/appraisals/cycles'),
    readiness: (cycleId) => apiRequest(`/appraisals/readiness${queryString({ cycle_id: cycleId })}`),
    draft: (cycleId) => apiRequest(`/appraisals/cycles/${cycleId}/draft`, { method: 'POST' }),
    submission: (id) => apiRequest(`/appraisals/submissions/${id}`),
    updateItems: (id, body) => apiRequest(`/appraisals/submissions/${id}/items`, { method: 'PATCH', body }),
    submit: (id) => apiRequest(`/appraisals/submissions/${id}/submit`, { method: 'POST' }),
    pdf: (id) => apiRequest(`/appraisals/submissions/${id}/pdf`, { method: 'POST' }),
  },

};

export async function uploadEvidenceFile(file, activityIds = []) {
  let evidenceId;
  try {
    const upload = payloadData(await api.evidence.uploadUrl(file));
    const uploadUrl = upload?.upload_url || upload?.signed_upload_url || upload?.url;
    evidenceId = upload?.evidence_id || upload?.id;
    if (!uploadUrl || !evidenceId) {
      throw new ApiError('The evidence upload service returned an incomplete upload instruction.', { payload: upload });
    }

    const uploadHeaders = new Headers(upload?.headers || {});
    if (!uploadHeaders.has('Content-Type')) uploadHeaders.set('Content-Type', file.type);
    const uploadResponse = await fetch(uploadUrl, {
      method: upload?.method || 'PUT',
      headers: uploadHeaders,
      body: file,
    });
    if (!uploadResponse.ok) {
      throw new ApiError('The file could not be uploaded. Please try again.', { status: uploadResponse.status });
    }

    const evidence = payloadData(await api.evidence.finalize(evidenceId));
    await Promise.all(activityIds.map((activityId) => api.evidence.attach(evidenceId, activityId)));
    return evidence;
  } catch (error) {
    if (evidenceId) await api.evidence.delete(evidenceId).catch(() => {});
    throw error;
  }
}
