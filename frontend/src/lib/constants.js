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
