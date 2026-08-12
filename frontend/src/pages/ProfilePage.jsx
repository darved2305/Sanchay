import React, { useEffect, useMemo, useState } from 'react';
import { CheckCircle2, Loader2, Save, UserRound } from 'lucide-react';
import { api, payloadData } from '../lib/api';
import { useApiQuery } from '../lib/queryCache';
import { runtimeConfigMessage } from '../lib/config';

const fieldClass = 'w-full rounded-xl border border-slate-200 px-3.5 py-2.5 text-sm font-medium text-slate-900 focus:border-[#FD6F3B] focus:outline-none focus:ring-2 focus:ring-[#FD6F3B]/20';

function tags(value) {
  return Array.isArray(value) ? value.join(', ') : value || '';
}

function asForm(profile) {
  const faculty = profile?.faculty_profile || {};
  return {
    full_name: profile?.full_name || '',
    email: profile?.email || '',
    employee_code: faculty.employee_code || '',
    institution_name: profile?.institution_name || profile?.institution?.name || '',
    department_name: profile?.department_name || profile?.department?.name || '',
    designation: faculty.designation || '',
    date_joined: faculty.date_joined || '',
    current_academic_year: faculty.current_academic_year || '',
    qualifications: Array.isArray(faculty.qualifications) ? faculty.qualifications.map((item) => item?.name || item).join(', ') : '',
    orcid_id: faculty.orcid_id || '',
    openalex_author_id: faculty.openalex_author_id || '',
    research_interests: tags(profile?.research_interests),
    expertise: tags(profile?.expertise),
    bio: profile?.bio || '',
  };
}

export default function ProfilePage() {
  const profile = useApiQuery(['profile'], api.profile);
  const [form, setForm] = useState(() => asForm(null));
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    if (profile.data) setForm(asForm(payloadData(profile.data)));
  }, [profile.data]);

  const update = (key, value) => setForm((previous) => ({ ...previous, [key]: value }));
  const save = async (event) => {
    event.preventDefault();
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await api.updateProfile({
        full_name: form.full_name.trim(),
        employee_code: form.employee_code.trim() || null,
        institution_name: form.institution_name.trim() || null,
        department_name: form.department_name.trim() || null,
        designation: form.designation.trim() || null,
        date_joined: form.date_joined || null,
        current_academic_year: form.current_academic_year.trim() || null,
        qualifications: form.qualifications.split(',').map((item) => item.trim()).filter(Boolean).map((name) => ({ name })),
        orcid_id: form.orcid_id.trim() || null,
        openalex_author_id: form.openalex_author_id.trim() || null,
        research_interests: form.research_interests.split(',').map((item) => item.trim()).filter(Boolean),
        expertise: form.expertise.split(',').map((item) => item.trim()).filter(Boolean),
        bio: form.bio.trim() || null,
      });
      await profile.refetch();
      setNotice('Profile saved to the database.');
    } catch (saveError) {
      setError(runtimeConfigMessage(saveError));
    } finally {
      setBusy(false);
    }
  };

  const fields = useMemo(() => [
    ['full_name', 'Full name', 'text'],
    ['employee_code', 'Employee code', 'text'],
    ['institution_name', 'Institution', 'text'],
    ['department_name', 'Department', 'text'],
    ['designation', 'Designation', 'text'],
    ['date_joined', 'Joining date', 'date'],
    ['current_academic_year', 'Academic year', 'text'],
    ['qualifications', 'Qualifications', 'text'],
    ['orcid_id', 'ORCID iD', 'text'],
    ['openalex_author_id', 'OpenAlex author ID', 'text'],
    ['research_interests', 'Research interests (comma separated)', 'text'],
    ['expertise', 'Expertise (comma separated)', 'text'],
  ], []);
  const data = payloadData(profile.data);
  const loading = profile.loading && !data;
  const profileError = profile.error;

  if (loading) return <div className="h-80 animate-pulse rounded-3xl bg-white" />;
  if (profileError) return <div className="rounded-3xl border border-red-200 bg-red-50 p-6 text-sm font-semibold text-red-800">{runtimeConfigMessage(profileError)} <button onClick={() => profile.refetch()} className="ml-2 underline">Retry</button></div>;

  return (
    <div className="mx-auto max-w-4xl space-y-6 pb-12">
      <div><div className="flex items-center gap-3"><div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-orange-100 text-[#FD6F3B]"><UserRound className="h-6 w-6" /></div><div><h1 className="text-3xl font-extrabold tracking-tight text-slate-900">Faculty Profile</h1><p className="mt-1 text-sm font-medium text-slate-500">Your saved profile is used by appraisal, admin review and publication discovery.</p></div></div></div>
      <form onSubmit={save} className="space-y-6 rounded-3xl border border-slate-200/80 bg-white p-6 shadow-xs">
        {error && <div role="alert" className="rounded-2xl border border-red-200 bg-red-50 p-3 text-sm font-semibold text-red-800">{error}</div>}
        {notice && <div role="status" className="flex items-center gap-2 rounded-2xl border border-emerald-200 bg-emerald-50 p-3 text-sm font-semibold text-emerald-800"><CheckCircle2 className="h-4 w-4" />{notice}</div>}
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">{fields.map(([key, label, type]) => <label key={key} className="space-y-1.5"><span className="block text-sm font-bold text-slate-700">{label}</span><input type={type} value={form[key]} onChange={(event) => update(key, event.target.value)} className={fieldClass} /></label>)}</div>
        <label className="block space-y-1.5"><span className="text-sm font-bold text-slate-700">Email</span><input value={form.email} readOnly className={`${fieldClass} bg-slate-50 text-slate-500`} /><span className="block text-xs font-medium text-slate-400">Email is managed by Supabase Auth.</span></label>
        <label className="block space-y-1.5"><span className="text-sm font-bold text-slate-700">Bio</span><textarea rows={5} value={form.bio} onChange={(event) => update('bio', event.target.value)} className={fieldClass} placeholder="Describe your academic focus and contribution." /></label>
        <div className="flex justify-end border-t border-slate-100 pt-4"><button type="submit" disabled={busy} className="flex items-center gap-2 rounded-xl bg-[#FD6F3B] px-5 py-2.5 text-sm font-bold text-white hover:bg-[#E05320] disabled:opacity-50">{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}Save profile</button></div>
      </form>
    </div>
  );
}
