// Deferred USP-only presentation data. Compulsory pages do not import this file.
export const recoveredActivities = [
  { id: 'REC-01', date: 'May 14 2025', type: 'Invited Talk', title: 'AI in Higher Education: Trends and Impact', description: 'National Conference on AI in Education', sources: ['Gmail', 'Calendar', 'Drive'], status: 'ready', category: 'Service' },
  { id: 'REC-02', date: 'Apr 28 2025', type: 'Seminar Certificate', title: 'Participant in Data Science Seminar', description: 'Organized by Department of Statistics', sources: ['Drive', 'Email'], status: 'ready', category: 'Workshops' },
  { id: 'REC-03', date: 'May 10 2025', type: 'Student Mentorship', title: 'Mentoring activity certified final-year project', description: 'Final-year project team', sources: ['Student Records', 'Email'], status: 'ready', category: 'Mentorship' },
  { id: 'REC-04', date: 'May 1 2025', type: 'Publication', title: 'Deep Learning for Time Series Forecasting', description: 'Publication candidate awaiting review', sources: ['ORCID', 'Crossref', 'Drive'], status: 'ready', category: 'Research' },
  { id: 'REC-05', date: 'Apr 22 2025', type: 'Committee Meeting', title: 'Department Research Committee', description: 'Monthly review meeting', sources: ['Calendar', 'Email'], status: 'review', category: 'Committees' },
  { id: 'REC-06', date: 'Mar 30 2025', type: 'Project Review', title: 'Reviewed research proposal submissions', description: 'Internal review panel', sources: ['Email', 'Drive'], status: 'review', category: 'Research' },
];

export const integrationSources = [
  { name: 'Gmail', count: 6, icon: 'Mail', scanned: true },
  { name: 'Calendar', count: 5, icon: 'Calendar', scanned: true },
  { name: 'Drive', count: 3, icon: 'HardDrive', scanned: true },
  { name: 'ORCID', count: 2, icon: 'Globe', scanned: true },
  { name: 'Student Records', count: 2, icon: 'GraduationCap', scanned: true },
];

export const monthlyOverviewData = [
  { month: 'Jan', Teaching: 15, Research: 8, Mentoring: 5, Service: 4 },
  { month: 'Feb', Teaching: 18, Research: 12, Mentoring: 7, Service: 6 },
  { month: 'Mar', Teaching: 22, Research: 16, Mentoring: 9, Service: 5 },
  { month: 'Apr', Teaching: 28, Research: 20, Mentoring: 12, Service: 8 },
  { month: 'May', Teaching: 32, Research: 25, Mentoring: 15, Service: 10 },
];

export const sourceCoverageData = [
  { name: 'Email', value: 6, percentage: '33%' },
  { name: 'Calendar', value: 5, percentage: '28%' },
  { name: 'Drive', value: 3, percentage: '17%' },
  { name: 'ORCID', value: 2, percentage: '11%' },
  { name: 'Student Records', value: 2, percentage: '11%' },
];
