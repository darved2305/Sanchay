import React, { useEffect, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { Loader2, Save, UserRound } from 'lucide-react';
import { api, payloadData } from '../lib/api';
import { useApiQuery } from '../lib/queryCache';
import { runtimeConfigMessage } from '../lib/config';
import { Button, Field, Notice, Skeleton } from '../components/ui';
import { pageEnter } from '../lib/motion';

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

function Section({ title, description, children }) {
  return (
    <section className="app-surface p-6">
      <h2 className="text-lg font-extrabold text-[var(--brand-ink)]">{title}</h2>
      {description && <p className="mt-1 text-sm font-medium text-[var(--brand-muted)]">{description}</p>}
      <div className="mt-5 grid grid-cols-1 gap-4 md:grid-cols-2">{children}</div>
    </section>
  );
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

  const field = useMemo(() => (key, label, type = 'text', hint) => (
    <Field key={key} label={label} htmlFor={`profile-${key}`} hint={hint}>
      <input id={`profile-${key}`} type={type} value={form[key]} onChange={(event) => update(key, event.target.value)} className="input" />
    </Field>
  ), [form]);

  const data = payloadData(profile.data);
  const loading = profile.loading && !data;
  const profileError = profile.error;

  if (loading) return <Skeleton className="h-80 !rounded-[var(--radius-card)]" />;
  if (profileError) {
    return (
      <Notice tone="error">
        {runtimeConfigMessage(profileError)} <button type="button" onClick={() => profile.refetch()} className="ml-2 underline">Retry</button>
      </Notice>
    );
  }

  return (
    <motion.div {...pageEnter} className="mx-auto max-w-4xl space-y-6 pb-12">
      <div className="flex items-center gap-3.5">
        <span className="icon-chip !h-12 !w-12 !rounded-[var(--radius-card)] bg-[var(--brand-primary-soft)] text-[var(--brand-primary-hover)]">
          <UserRound className="h-6 w-6" />
        </span>
        <div>
          <h1 className="text-3xl font-extrabold tracking-tight text-[var(--brand-ink)]">Faculty Profile</h1>
          <p className="mt-1 text-sm font-medium text-[var(--brand-muted)]">Your saved profile is used by appraisal, admin review and publication discovery.</p>
        </div>
      </div>

      <form onSubmit={save} className="space-y-6">
        {error && <Notice tone="error">{error}</Notice>}
        {notice && <Notice tone="success">{notice}</Notice>}

        <Section title="Basic details" description="Who you are and how the institution addresses you.">
          {field('full_name', 'Full name')}
          <Field label="Email" htmlFor="profile-email" hint="Email is managed by Supabase Auth.">
            <input id="profile-email" value={form.email} readOnly className="input" />
          </Field>
        </Section>

        <Section title="Institution" description="Where you work and your current role.">
          {field('institution_name', 'Institution')}
          {field('department_name', 'Department')}
          {field('designation', 'Designation')}
          {field('employee_code', 'Employee code')}
          {field('date_joined', 'Joining date', 'date')}
          {field('current_academic_year', 'Academic year')}
        </Section>

        <Section title="Academic identity" description="Qualifications and the identifiers publication sync relies on.">
          {field('qualifications', 'Qualifications (comma separated)')}
          {field('orcid_id', 'ORCID iD')}
          {field('openalex_author_id', 'OpenAlex author ID')}
        </Section>

        <Section title="Research profile" description="Interests and expertise used for discovery and matching.">
          {field('research_interests', 'Research interests (comma separated)')}
          {field('expertise', 'Expertise (comma separated)')}
          <div className="md:col-span-2">
            <Field label="Bio" htmlFor="profile-bio">
              <textarea id="profile-bio" rows={5} value={form.bio} onChange={(event) => update('bio', event.target.value)} className="input" placeholder="Describe your academic focus and contribution." />
            </Field>
          </div>
        </Section>

        <div className="flex justify-end">
          <Button variant="primary" size="lg" type="submit" disabled={busy}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            Save profile
          </Button>
        </div>
      </form>
    </motion.div>
  );
}
