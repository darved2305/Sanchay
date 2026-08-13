export const ACTIVITY_CATEGORIES = [
  { id: 'teaching', label: 'Teaching' },
  { id: 'research', label: 'Research' },
  { id: 'publication', label: 'Publication' },
  { id: 'project', label: 'Project' },
  { id: 'grant', label: 'Grant' },
  { id: 'workshop_fdp', label: 'Workshop / FDP' },
  { id: 'seminar', label: 'Seminar' },
  { id: 'invited_talk', label: 'Invited Talk' },
  { id: 'mentorship', label: 'Mentorship' },
  { id: 'committee', label: 'Committee' },
  { id: 'institutional_service', label: 'Institutional Service' },
  { id: 'community_engagement', label: 'Community Engagement' },
  { id: 'award', label: 'Award' },
  { id: 'patent', label: 'Patent' },
  { id: 'reviewing', label: 'Reviewing' },
  { id: 'conference', label: 'Conference' },
  { id: 'other', label: 'Other' },
];

// Shared visual semantics for category chips, timelines, charts, and filters.
// Components should use the token names rather than inventing page-local colors.
export const CATEGORY_COLOR_TOKENS = {
  teaching: 'sky',
  research: 'lavender',
  publication: 'lavender',
  project: 'mint',
  grant: 'mint',
  workshop_fdp: 'butter',
  seminar: 'butter',
  invited_talk: 'sky',
  mentorship: 'mint',
  committee: 'aqua',
  institutional_service: 'peach',
  community_engagement: 'peach',
  award: 'butter',
  patent: 'lavender',
  reviewing: 'sky',
  conference: 'sky',
  other: 'surface',
};

export const EVIDENCE_ACCEPT = '.pdf,.png,.jpg,.jpeg,.docx,.xlsx';
export const EVIDENCE_MIME_TYPES = [
  'application/pdf',
  'image/png',
  'image/jpeg',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
];
export const MAX_EVIDENCE_BYTES = 25 * 1024 * 1024;

export function categoryLabel(category) {
  return ACTIVITY_CATEGORIES.find((item) => item.id === category)?.label || category || 'Other';
}
