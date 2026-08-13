import React, { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import {
  ArrowRight,
  Cloud,
  Eye,
  EyeOff,
  FileCheck,
  Loader2,
  Lock,
  Mail,
  ShieldCheck,
  User,
  Users,
} from 'lucide-react';
import Logo from '../components/Logo';
import { Field, Notice } from '../components/ui';
import { Sparkle, Squiggle } from '../components/Doodles';
import { heroReveal, heroRevealDelayed } from '../lib/motion';
import { api } from '../lib/api';
import { getRuntimeConfig, runtimeConfigMessage } from '../lib/config';
import {
  sendPasswordReset,
  signInWithPassword,
  signUpFaculty,
} from '../lib/supabase';

function FieldError({ children }) {
  return children ? <p className="mt-1 text-sm font-semibold text-[var(--brand-rose-ink)]">{children}</p> : null;
}

const benefitCards = [
  { icon: Cloud, tone: 'chip-lavender', title: 'Auto-save evidence', text: 'Never lose your progress.', className: '-left-4 top-6 sm:-left-8' },
  { icon: Users, tone: 'chip-mint', title: 'Role-based access', text: 'Secure. Relevant. For everyone.', className: '-right-4 top-1/2 sm:-right-8 -translate-y-1/2' },
  { icon: FileCheck, tone: 'chip-butter', title: 'Appraisal ready', text: 'Organized. Complete. Always ready.', className: '-bottom-2 left-2 sm:-left-4' },
];

export default function LoginPage({ initialMode = 'signin', onLogin }) {
  const [activeTab, setActiveTab] = useState(initialMode === 'register' ? 'register' : 'signin');
  const [signInEmail, setSignInEmail] = useState('');
  const [signInPassword, setSignInPassword] = useState('');
  const [showSignInPassword, setShowSignInPassword] = useState(false);
  const [regFullName, setRegFullName] = useState('');
  const [regEmail, setRegEmail] = useState('');
  const [regEmpCode, setRegEmpCode] = useState('');
  const [regInstitution, setRegInstitution] = useState('');
  const [regDept, setRegDept] = useState('');
  const [regPassword, setRegPassword] = useState('');
  const [showRegPassword, setShowRegPassword] = useState(false);
  const [agreeTerms, setAgreeTerms] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [fieldErrors, setFieldErrors] = useState({});
  const [notice, setNotice] = useState('');
  const [resetSent, setResetSent] = useState(false);

  const config = useMemo(getRuntimeConfig, []);
  const passwordRules = [
    { id: 'length', label: 'At least 10 characters', met: regPassword.length >= 10 },
    { id: 'uppercase', label: 'One uppercase letter', met: /[A-Z]/.test(regPassword) },
    { id: 'lowercase', label: 'One lowercase letter', met: /[a-z]/.test(regPassword) },
    { id: 'number', label: 'One number', met: /[0-9]/.test(regPassword) },
    { id: 'special', label: 'One special character', met: /[^A-Za-z0-9]/.test(regPassword) },
  ];

  const clearMessages = () => {
    setError('');
    setNotice('');
    setFieldErrors({});
  };

  const switchTab = (tab) => {
    clearMessages();
    setActiveTab(tab);
  };

  const finishAuthentication = async () => {
    const authMe = await api.authMe();
    onLogin?.(authMe);
  };

  const handleSignIn = async (event) => {
    event.preventDefault();
    clearMessages();
    if (!signInEmail.trim() || !signInPassword) {
      setError('Enter your institutional email and password.');
      return;
    }
    setBusy(true);
    try {
      await signInWithPassword(signInEmail.trim(), signInPassword);
      await finishAuthentication();
    } catch (authError) {
      setError(runtimeConfigMessage(authError));
    } finally {
      setBusy(false);
    }
  };

  const handleRegister = async (event) => {
    event.preventDefault();
    clearMessages();
    const nextFieldErrors = {};
    if (!regFullName.trim()) nextFieldErrors.full_name = 'Enter your full name.';
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(regEmail.trim())) nextFieldErrors.email = 'Enter a valid institutional email.';
    if (!regInstitution.trim()) nextFieldErrors.institution = 'Enter your institution.';
    if (!regDept) nextFieldErrors.department = 'Choose your department.';
    if (passwordRules.some((rule) => !rule.met)) nextFieldErrors.password = 'Use all of the password requirements below.';
    if (!agreeTerms) nextFieldErrors.terms = 'Accept the terms to create your faculty account.';
    if (Object.keys(nextFieldErrors).length) {
      setFieldErrors(nextFieldErrors);
      setError('Please correct the highlighted fields.');
      return;
    }

    setBusy(true);
    try {
      const result = await signUpFaculty({
        email: regEmail.trim(),
        password: regPassword,
        fullName: regFullName.trim(),
        institution: regInstitution.trim(),
        department: regDept,
        employeeCode: regEmpCode.trim(),
      });
      if (!result.session) {
        setNotice('Account created. Check your email to confirm the account, then sign in.');
      } else {
        await api.updateProfile({
          full_name: regFullName.trim(),
          institution_name: regInstitution.trim(),
          department_name: regDept,
          employee_code: regEmpCode.trim() || null,
        });
        await finishAuthentication();
      }
    } catch (authError) {
      setError(runtimeConfigMessage(authError));
    } finally {
      setBusy(false);
    }
  };

  const handleReset = async () => {
    clearMessages();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(signInEmail.trim())) {
      setFieldErrors({ email: 'Enter your email first.' });
      return;
    }
    setBusy(true);
    try {
      await sendPasswordReset(signInEmail.trim());
      setResetSent(true);
      setNotice('If that account exists, a password reset link is on its way.');
    } catch (resetError) {
      setError(runtimeConfigMessage(resetError));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-screen items-stretch bg-[var(--brand-canvas)] p-4 antialiased sm:p-6 lg:p-8">
      <div className="mx-auto flex w-full max-w-6xl flex-col overflow-hidden rounded-[28px] border border-[var(--brand-border-soft)] bg-[var(--brand-surface)] shadow-[var(--shadow-raised)] lg:flex-row">
        {/* Form column */}
        <div className="flex w-full flex-col justify-between p-7 sm:p-10 lg:w-1/2 lg:p-12">
          <div>
            <Link to="/" aria-label="Back to Sanchaya home" className="inline-flex"><Logo /></Link>

            {!config.isConfigured && (
              <Notice tone="error" className="mt-6">{config.missing.length ? `Configuration required: ${config.missing.join(', ')}.` : 'Configuration required.'}</Notice>
            )}

            <div className="mb-6 mt-8 flex rounded-[var(--radius-card)] bg-[var(--brand-surface-muted)] p-1" role="tablist" aria-label="Authentication mode">
              {['signin', 'register'].map((tab) => (
                <button
                  key={tab}
                  type="button"
                  role="tab"
                  aria-selected={activeTab === tab}
                  onClick={() => switchTab(tab)}
                  className={`flex-1 rounded-[var(--radius-control)] py-2.5 text-sm font-bold transition-all ${
                    activeTab === tab
                      ? 'bg-[var(--brand-primary-soft)] text-[var(--brand-primary-hover)] shadow-[var(--shadow-soft)]'
                      : 'text-[var(--brand-muted)] hover:text-[var(--brand-ink)]'
                  }`}
                >
                  {tab === 'signin' ? 'Sign In' : 'Create Account'}
                </button>
              ))}
            </div>

            {error && <Notice tone="error" className="mb-4">{error}</Notice>}
            {notice && <Notice tone="success" className="mb-4">{notice}</Notice>}

            {activeTab === 'signin' ? (
              <div>
                <div className="mb-6">
                  <h1 className="text-3xl font-extrabold tracking-tight text-[var(--brand-ink)]">Welcome back!</h1>
                  <div className="mb-2.5 mt-2 h-1.5 w-20 rounded-full bg-[var(--brand-primary)]" />
                  <p className="text-[15px] font-medium text-[var(--brand-muted)]">Sign in to continue your self-appraisal and showcase your impact.</p>
                </div>

                <form onSubmit={handleSignIn} className="space-y-4">
                  <Field label="Institutional Email" htmlFor="signin-email">
                    <div className="relative">
                      <Mail className="absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--brand-subtle)]" />
                      <input id="signin-email" type="email" value={signInEmail} onChange={(event) => setSignInEmail(event.target.value)} placeholder="you@yourinstitution.edu" className="input !py-3 !pl-11" required />
                    </div>
                    <FieldError>{fieldErrors.email}</FieldError>
                  </Field>
                  <Field label="Password" htmlFor="signin-password">
                    <div className="relative">
                      <Lock className="absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--brand-subtle)]" />
                      <input id="signin-password" type={showSignInPassword ? 'text' : 'password'} value={signInPassword} onChange={(event) => setSignInPassword(event.target.value)} placeholder="Enter your password" className="input !py-3 !pl-11 !pr-11" required />
                      <button type="button" onClick={() => setShowSignInPassword((value) => !value)} className="absolute right-3.5 top-1/2 -translate-y-1/2 p-1 text-[var(--brand-subtle)] transition hover:text-[var(--brand-primary)]" aria-label={showSignInPassword ? 'Hide password' : 'Show password'}>
                        {showSignInPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                      </button>
                    </div>
                  </Field>
                  <div className="flex items-center justify-end text-sm">
                    <button type="button" onClick={handleReset} disabled={busy || resetSent} className="font-bold text-[var(--brand-primary-hover)] hover:underline disabled:opacity-50">Forgot Password?</button>
                  </div>
                  <button type="submit" disabled={busy || !config.isConfigured} className="btn btn-primary btn-lg w-full">
                    {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <><span>Sign In</span><ArrowRight className="h-4 w-4" /></>}
                  </button>
                </form>

                <div className="relative my-6 text-center">
                  <div className="absolute inset-0 flex items-center"><div className="w-full border-t border-[var(--brand-border-soft)]" /></div>
                  <span className="relative bg-[var(--brand-surface)] px-3.5 text-sm font-semibold text-[var(--brand-subtle)]">or continue with</span>
                </div>
                <button type="button" disabled className="btn btn-secondary w-full !text-[var(--brand-subtle)]" title="Google sign-in is not enabled yet">
                  <span className="text-base font-extrabold">G</span><span>Google sign-in · Coming soon</span>
                </button>
                <p className="mt-3 text-center text-xs font-medium text-[var(--brand-subtle)]">Email and password are available today.</p>
                <p className="mt-5 text-center text-sm font-medium text-[var(--brand-muted)]">
                  New to Sanchaya? <button type="button" onClick={() => switchTab('register')} className="font-bold text-[var(--brand-primary-hover)] hover:underline">Create an account</button>
                </p>
              </div>
            ) : (
              <div>
                <div className="mb-6">
                  <h1 className="text-3xl font-extrabold tracking-tight text-[var(--brand-ink)]">Join Sanchaya</h1>
                  <div className="mb-2.5 mt-2 h-1.5 w-20 rounded-full bg-[var(--brand-primary)]" />
                  <p className="text-[15px] font-medium text-[var(--brand-muted)]">Create your faculty profile to automate appraisals and evidence collection.</p>
                </div>
                <form onSubmit={handleRegister} className="space-y-4">
                  <Field label="Full Name" htmlFor="reg-name">
                    <div className="relative"><User className="absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--brand-subtle)]" /><input id="reg-name" value={regFullName} onChange={(event) => setRegFullName(event.target.value)} placeholder="Your full name" className="input !pl-11" required /></div>
                    <FieldError>{fieldErrors.full_name}</FieldError>
                  </Field>
                  <Field label="Institutional Email" htmlFor="reg-email">
                    <div className="relative"><Mail className="absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--brand-subtle)]" /><input id="reg-email" type="email" value={regEmail} onChange={(event) => setRegEmail(event.target.value)} placeholder="you@yourinstitution.edu" className="input !pl-11" required /></div>
                    <FieldError>{fieldErrors.email}</FieldError>
                  </Field>
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <Field label="Institution" htmlFor="reg-institution">
                      <input id="reg-institution" value={regInstitution} onChange={(event) => setRegInstitution(event.target.value)} placeholder="Your university" className="input" required />
                      <FieldError>{fieldErrors.institution}</FieldError>
                    </Field>
                    <Field label="Employee Code" htmlFor="reg-code" optional>
                      <input id="reg-code" value={regEmpCode} onChange={(event) => setRegEmpCode(event.target.value)} placeholder="EMP-2026-001" className="input" />
                    </Field>
                  </div>
                  <Field label="Department" htmlFor="reg-dept">
                    <input id="reg-dept" value={regDept} onChange={(event) => setRegDept(event.target.value)} placeholder="Your department" className="input" required />
                    <FieldError>{fieldErrors.department}</FieldError>
                  </Field>
                  <Field label="Password" htmlFor="reg-password">
                    <div className="relative">
                      <Lock className="absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--brand-subtle)]" />
                      <input id="reg-password" type={showRegPassword ? 'text' : 'password'} value={regPassword} onChange={(event) => setRegPassword(event.target.value)} placeholder="Create a secure password" className="input !pl-11 !pr-11" required />
                      <button type="button" onClick={() => setShowRegPassword((value) => !value)} className="absolute right-3.5 top-1/2 -translate-y-1/2 p-1 text-[var(--brand-subtle)] transition hover:text-[var(--brand-primary)]" aria-label={showRegPassword ? 'Hide password' : 'Show password'}>
                        {showRegPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                      </button>
                    </div>
                    <div className="mt-2 grid grid-cols-2 gap-1 text-xs font-semibold text-[var(--brand-subtle)] sm:grid-cols-3">
                      {passwordRules.map((rule) => <span key={rule.id} className={rule.met ? 'text-[var(--brand-mint-ink)]' : ''}>{rule.met ? '✓' : '○'} {rule.label}</span>)}
                    </div>
                    <FieldError>{fieldErrors.password}</FieldError>
                  </Field>
                  <label className="flex items-start gap-2 text-sm font-medium text-[var(--brand-muted)]">
                    <input type="checkbox" checked={agreeTerms} onChange={(event) => setAgreeTerms(event.target.checked)} className="mt-1 accent-[var(--brand-primary)]" />
                    <span>I agree to institutional self-appraisal terms and data confidentiality policy.</span>
                  </label>
                  <FieldError>{fieldErrors.terms}</FieldError>
                  <button type="submit" disabled={busy || !config.isConfigured} className="btn btn-primary btn-lg w-full">
                    {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <><span>Create Faculty Account</span><ArrowRight className="h-4 w-4" /></>}
                  </button>
                </form>
              </div>
            )}
          </div>
          <p className="mt-8 border-t border-[var(--brand-border-soft)] pt-4 text-center text-xs font-medium text-[var(--brand-subtle)]">By continuing, you agree to our Terms of Service and Privacy Policy.</p>
        </div>

        {/* Visual column */}
        <div className="relative hidden w-1/2 flex-col justify-between overflow-hidden bg-[var(--brand-primary-softer)] p-10 lg:flex lg:p-12">
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-0"
            style={{ background: 'radial-gradient(ellipse 70% 55% at 50% 46%, var(--brand-lavender) 0%, var(--brand-primary-softer) 58%, transparent 82%)' }}
          />
          <Squiggle className="pointer-events-none absolute left-10 top-24 h-6 w-14 text-[var(--brand-lavender-strong)]" />
          <Sparkle className="pointer-events-none absolute right-12 top-16 h-8 w-8 text-[var(--brand-butter-strong)]" />

          <motion.div {...heroReveal} className="relative z-10 text-right">
            <span className="font-serif text-4xl font-bold text-[var(--brand-primary)]">“</span>
            <h2 className="text-2xl font-extrabold leading-snug tracking-tight text-[var(--brand-ink)]">
              Everything you need.<br />
              <span className="text-[var(--brand-primary-hover)]">All in one place.</span>
            </h2>
            <span className="font-serif text-4xl font-bold text-[var(--brand-primary)]">”</span>
          </motion.div>

          <motion.div {...heroRevealDelayed(0.15)} className="relative z-10 my-8 flex items-center justify-center">
            <div className="relative h-80 w-64 overflow-hidden rounded-[28px] border-4 border-[var(--brand-surface)] shadow-[var(--shadow-raised)]">
              <img src="/faculty-portrait.png" alt="A faculty member" className="h-full w-full object-cover object-top" />
            </div>
            {benefitCards.map((card, index) => {
              const Icon = card.icon;
              return (
                <div key={card.title} className={`app-surface absolute max-w-[172px] p-3.5 ${card.className} ${index === 0 ? 'animate-float' : ''}`}>
                  <span className={`icon-chip !h-8 !w-8 ${card.tone}`}><Icon className="h-4 w-4" aria-hidden="true" /></span>
                  <h4 className="mt-2 text-sm font-bold leading-tight text-[var(--brand-ink)]">{card.title}</h4>
                  <p className="mt-0.5 text-xs leading-snug text-[var(--brand-muted)]">{card.text}</p>
                </div>
              );
            })}
          </motion.div>

          <div className="relative z-10 flex items-center gap-2 text-sm font-bold text-[var(--brand-ink)]">
            <ShieldCheck className="h-4 w-4 text-[var(--brand-primary-hover)]" aria-hidden="true" />
            Built for faculty. <span className="underline decoration-[var(--brand-primary)] decoration-2 underline-offset-4">Backed by trust.</span>
          </div>
        </div>
      </div>
    </div>
  );
}
