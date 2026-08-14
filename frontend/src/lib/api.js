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

// FastAPI's default 422 body is `{"detail": [{"msg": "...", "loc": [...], ...}, ...]}`
// -- a Pydantic ValidationError, not a plain string -- so every request-body
// validator (date-range checks, required-comment checks, etc.) fell through
// to a generic "Request failed (422)." instead of ever showing the actual
// reason, no matter how clear the backend's error message was.
function pydanticValidationMessage(detail) {
  if (!Array.isArray(detail) || detail.length === 0) return null;
  const messages = detail
    .map((item) => (typeof item?.msg === 'string' ? item.msg.replace(/^Value error,\s*/, '') : null))
    .filter(Boolean);
  return messages.length ? messages.join('; ') : null;
}

function getDetail(payload, fallback) {
  if (typeof payload === 'string' && payload.trim()) return payload;
  if (typeof payload?.detail === 'string') return payload.detail;
  const pydanticMessage = pydanticValidationMessage(payload?.detail) || pydanticValidationMessage(payload?.error?.detail);
  if (pydanticMessage) return pydanticMessage;
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
    matches: (id) => apiRequest(`/evidence/${id}/matches`),
    classificationJob: (jobId) => apiRequest(`/evidence/classification-jobs/${jobId}`),
    confirmClassification: (id, body) => apiRequest(`/evidence/${id}/confirm-classification`, { method: 'POST', body }),
    bulkDownload: (body) => apiRequest('/evidence/bulk-download', { method: 'POST', body }),
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
    rescue: () => apiRequest('/appraisals/rescue', { method: 'POST' }),
    rescueStatus: (jobId) => apiRequest(`/appraisals/rescue/${jobId}`),
  },

  jobs: {
    get: (id) => apiRequest(`/jobs/${id}`),
  },

  activitiesQuickAdd: (text) => apiRequest('/activities/quick-add', { method: 'POST', body: { text } }),
  activitiesImportCv: (body) => apiRequest('/activities/import/cv', { method: 'POST', body }),
  activitiesBulkConfirm: (activityIds) => apiRequest('/activities/bulk-confirm', { method: 'POST', body: { activity_ids: activityIds } }),

  cvImport: {
    uploadUrl: (file) => apiRequest('/cv-import/upload-url', {
      method: 'POST',
      body: { file_name: file.name, mime: file.type, size: file.size },
    }),
    process: (jobId) => apiRequest(`/cv-import/${jobId}/process`, { method: 'POST' }),
    get: (jobId) => apiRequest(`/cv-import/${jobId}`),
  },

  reconstruct: {
    sources: () => apiRequest('/reconstruct/sources'),
    start: (academicYear) => apiRequest('/reconstruct/runs', { method: 'POST', body: { academic_year: academicYear } }),
    get: (runId) => apiRequest(`/reconstruct/runs/${runId}`),
    candidates: (runId, status = 'proposed') => apiRequest(`/reconstruct/runs/${runId}/candidates${queryString({ status })}`),
    confirmCandidate: (candidateId) => apiRequest(`/reconstruct/candidates/${candidateId}/confirm`, { method: 'POST' }),
    ignoreCandidate: (candidateId) => apiRequest(`/reconstruct/candidates/${candidateId}/ignore`, { method: 'POST' }),
    oauthStart: (provider) => apiRequest(`/reconstruct/oauth/${provider}/start`),
    oauthDisconnect: (provider) => apiRequest(`/reconstruct/oauth/${provider}/disconnect`, { method: 'POST' }),
    cachedCandidates: () => apiRequest('/reconstruct/candidates'),
    sync: () => apiRequest('/reconstruct/sync', { method: 'POST' }),
    syncJob: (jobId) => apiRequest(`/reconstruct/sync/${jobId}`),
    confirmCached: (clusterId) => apiRequest(`/reconstruct/candidates/cached/${clusterId}/confirm`, { method: 'POST' }),
    ignoreCached: (clusterId) => apiRequest(`/reconstruct/candidates/cached/${clusterId}/ignore`, { method: 'POST' }),
  },

  actionInbox: {
    list: (params) => apiRequest(`/action-inbox${queryString(params)}`),
    get: (id) => apiRequest(`/action-inbox/${id}`),
    act: (id, action) => apiRequest(`/action-inbox/${id}/action`, { method: 'POST', body: { action } }),
    draft: (id, body) => apiRequest(`/action-inbox/${id}/draft`, { method: 'POST', body }),
    sync: () => apiRequest('/action-inbox/sync', { method: 'POST' }),
    syncJob: (jobId) => apiRequest(`/action-inbox/sync/${jobId}`),
  },

  grantops: {
    opportunities: () => apiRequest('/grantops/opportunities'),
    createOpportunity: (body) => apiRequest('/grantops/opportunities', { method: 'POST', body }),
    eligibility: (opportunityId) => apiRequest(`/grantops/opportunities/${opportunityId}/eligibility`),
    startWorkspace: (opportunityId) => apiRequest(`/grantops/opportunities/${opportunityId}/workspace`, { method: 'POST' }),
    workspaces: () => apiRequest('/grantops/workspaces'),
    workspace: (id) => apiRequest(`/grantops/workspaces/${id}`),
    updateStage: (id, body) => apiRequest(`/grantops/workspaces/${id}`, { method: 'PATCH', body }),
    addTask: (id, body) => apiRequest(`/grantops/workspaces/${id}/tasks`, { method: 'POST', body }),
    toggleTask: (taskId) => apiRequest(`/grantops/tasks/${taskId}/toggle`, { method: 'POST' }),
    teamSuggestions: (id) => apiRequest(`/grantops/workspaces/${id}/team-suggestions`),
    inviteMember: (id, body) => apiRequest(`/grantops/workspaces/${id}/members`, { method: 'POST', body }),
    award: (id, body) => apiRequest(`/grantops/workspaces/${id}/award`, { method: 'POST', body }),
  },

  forms: {
    uploadUrl: (file) => apiRequest('/forms/upload-url', {
      method: 'POST',
      body: { file_name: file.name, mime: file.type, size: file.size },
    }),
    analyze: (jobId) => apiRequest(`/forms/${jobId}/analyze`, { method: 'POST' }),
    get: (jobId) => apiRequest(`/forms/${jobId}`),
    updateField: (jobId, fieldId, value) => apiRequest(`/forms/${jobId}/fields/${fieldId}`, { method: 'PATCH', body: { value } }),
    generate: (jobId) => apiRequest(`/forms/${jobId}/generate`, { method: 'POST' }),
    download: (jobId) => apiRequest(`/forms/${jobId}/download`),
  },

  career: {
    goals: () => apiRequest('/career/goals'),
    rules: () => apiRequest('/career/rules'),
    setGoal: (careerRuleId) => apiRequest('/career/goals', { method: 'POST', body: { career_rule_id: careerRuleId } }),
    progress: () => apiRequest('/career/progress'),
    recommendations: () => apiRequest('/career/recommendations'),
    dismissRecommendation: (id) => apiRequest(`/career/recommendations/${id}/dismiss`, { method: 'POST' }),
    dossier: () => apiRequest('/career/dossier', { method: 'POST' }),
    parseGoal: (text) => apiRequest('/career/goals/parse', { method: 'POST', body: { text } }),
    createCustomGoal: (body) => apiRequest('/career/goals/custom', { method: 'POST', body }),
    suggestedGoals: () => apiRequest('/career/goals/suggested'),
    allGoals: () => apiRequest('/career/goals/all'),
    updateCustomGoal: (id, status) => apiRequest(`/career/goals/custom/${id}`, { method: 'PATCH', body: { status } }),
    goalOpportunities: (id) => apiRequest(`/career/goals/custom/${id}/opportunities`),
  },
  opportunities: {
    list: (params) => apiRequest(`/opportunities${queryString(params)}`),
  },

  institutionEvents: {
    list: () => apiRequest('/admin/events'),
    create: (body) => apiRequest('/admin/events', { method: 'POST', body }),
    participants: (eventId) => apiRequest(`/admin/events/${eventId}/participants`),
  },
  eventProposals: {
    list: () => apiRequest('/activities/proposals/events'),
    confirm: (participantId) => apiRequest(`/activities/proposals/events/${participantId}/confirm`, { method: 'POST' }),
    decline: (participantId) => apiRequest(`/activities/proposals/events/${participantId}/decline`, { method: 'POST' }),
  },

  adminRequests: {
    list: () => apiRequest('/admin/requests'),
    uploadUrl: (file) => apiRequest('/admin/requests/upload-url', {
      method: 'POST',
      body: { file_name: file.name, mime: file.type, size: file.size },
    }),
    process: (requestId, filters) => apiRequest(`/admin/requests/${requestId}/process`, { method: 'POST', body: filters || {} }),
    get: (requestId) => apiRequest(`/admin/requests/${requestId}`),
    download: (requestId) => apiRequest(`/admin/requests/${requestId}/download`),
  },
  adminReports: {
    department: (filters) => apiRequest('/admin/reports/department', { method: 'POST', body: filters || {} }),
  },

  teaching: {
    snapshots: () => apiRequest('/teaching/snapshots'),
    createSnapshot: (courseTitle, academicYear) => apiRequest('/teaching/snapshots', { method: 'POST', body: { course_title: courseTitle, academic_year: academicYear } }),
    fileUploadUrl: (snapshotId, file) => apiRequest(`/teaching/snapshots/${snapshotId}/files/upload-url${queryString({ file_name: file.name, mime: file.type, size: file.size })}`, { method: 'POST' }),
    finalizeFile: (snapshotId, fileName, storagePath, mimeType) => apiRequest(`/teaching/snapshots/${snapshotId}/files/finalize${queryString({ file_name: fileName, storage_path: storagePath, mime_type: mimeType })}`, { method: 'POST' }),
    compare: (snapshotAId, snapshotBId) => apiRequest('/teaching/compare', { method: 'POST', body: { snapshot_a_id: snapshotAId, snapshot_b_id: snapshotBId } }),
    getRun: (runId) => apiRequest(`/teaching/runs/${runId}`),
    approveChange: (changeId) => apiRequest(`/teaching/changes/${changeId}/approve`, { method: 'POST' }),
    dismissChange: (changeId) => apiRequest(`/teaching/changes/${changeId}/dismiss`, { method: 'POST' }),
  },

  students: {
    list: () => apiRequest('/students'),
    create: (payload) => apiRequest('/students', { method: 'POST', body: payload }),
    addAchievement: (studentId, payload) => apiRequest(`/students/${studentId}/achievements`, { method: 'POST', body: payload }),
  },
  lor: {
    list: () => apiRequest('/lor'),
    draft: (studentId, purpose) => apiRequest('/lor/draft', { method: 'POST', body: { student_id: studentId, purpose } }),
    get: (letterId) => apiRequest(`/lor/${letterId}`),
    update: (letterId, draftText) => apiRequest(`/lor/${letterId}`, { method: 'PATCH', body: { draft_text: draftText } }),
    export: (letterId) => apiRequest(`/lor/${letterId}/export`, { method: 'POST' }),
  },

  community: {
    people: (params) => apiRequest(`/community/people${queryString(params)}`),
    recommendations: (intent) => apiRequest(`/community/recommendations${queryString({ intent })}`),
    sendConnectionRequest: (toProfileId, note) => apiRequest('/community/connections/requests', { method: 'POST', body: { to_profile_id: toProfileId, note: note || null } }),
    connectionRequests: () => apiRequest('/community/connections/requests'),
    respondConnectionRequest: (requestId, action) => apiRequest(`/community/connections/requests/${requestId}/respond`, { method: 'POST', body: { action } }),
    connections: () => apiRequest('/community/connections'),
    communities: () => apiRequest('/community/communities'),
    createCommunity: (name, description) => apiRequest('/community/communities', { method: 'POST', body: { name, description: description || null } }),
    joinCommunity: (communityId) => apiRequest(`/community/communities/${communityId}/join`, { method: 'POST' }),
    leaveCommunity: (communityId) => apiRequest(`/community/communities/${communityId}/leave`, { method: 'POST' }),
    feed: () => apiRequest('/community/feed'),
    createPost: (body, kind, communityId, collaborationPayload) => apiRequest('/community/posts', { method: 'POST', body: { body, kind, community_id: communityId || null, collaboration_payload: collaborationPayload || null } }),
    comments: (postId) => apiRequest(`/community/posts/${postId}/comments`),
    addComment: (postId, body) => apiRequest(`/community/posts/${postId}/comments`, { method: 'POST', body: { body } }),
    react: (postId, reactionType = 'like') => apiRequest(`/community/posts/${postId}/reaction`, { method: 'PUT', body: { reaction_type: reactionType } }),
    unreact: (postId) => apiRequest(`/community/posts/${postId}/reaction`, { method: 'DELETE' }),
    expressInterest: (postId) => apiRequest(`/community/posts/${postId}/interest`, { method: 'POST' }),
    interested: (postId) => apiRequest(`/community/posts/${postId}/interested`),
    follow: (profileId) => apiRequest(`/community/follow/${profileId}`, { method: 'POST' }),
    unfollow: (profileId) => apiRequest(`/community/follow/${profileId}`, { method: 'DELETE' }),
    collaborationWorkspaces: () => apiRequest('/community/collaboration-workspaces'),
    createCollaborationWorkspace: (body) => apiRequest('/community/collaboration-workspaces', { method: 'POST', body }),
    collaborationWorkspace: (id) => apiRequest(`/community/collaboration-workspaces/${id}`),
    addCollaborationMember: (id, body) => apiRequest(`/community/collaboration-workspaces/${id}/members`, { method: 'POST', body }),
  },
  messages: {
    conversations: () => apiRequest('/messages/conversations'),
    startConversation: (peerProfileId) => apiRequest('/messages/conversations', { method: 'POST', body: { peer_profile_id: peerProfileId } }),
    getMessages: (conversationId) => apiRequest(`/messages/conversations/${conversationId}`),
    sendMessage: (conversationId, body) => apiRequest(`/messages/conversations/${conversationId}`, { method: 'POST', body: { body } }),
    markRead: (conversationId) => apiRequest(`/messages/conversations/${conversationId}/read`, { method: 'POST' }),
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
