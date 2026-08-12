import React, { useMemo, useState } from 'react';
import {
  AlertCircle,
  ArrowRight,
  CheckCircle2,
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
import { api } from '../lib/api';
import { getRuntimeConfig, runtimeConfigMessage } from '../lib/config';
import {
  sendPasswordReset,
  signInWithPassword,
  signUpFaculty,
} from '../lib/supabase';

function FieldError({ children }) {
  return children ? <p className="mt-1 text-sm font-semibold text-red-600">{children}</p> : null;
}

function ErrorBanner({ children }) {
  return children ? (
    <div role="alert" className="flex items-start gap-2 rounded-2xl border border-red-200 bg-red-50 p-3 text-sm font-semibold text-red-800">
      <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
      <span>{children}</span>
    </div>
  ) : null;
}

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
    <div className="min-h-screen bg-[#FAF9F7] p-4 font-sans sm:p-6 lg:p-8">
      <div className="mx-auto flex min-h-[calc(100vh-2rem)] max-w-6xl flex-col overflow-hidden rounded-3xl border border-slate-200/80 bg-white shadow-xl shadow-slate-200/60 lg:min-h-0 lg:flex-row">
        <div className="flex w-full flex-col justify-between p-7 sm:p-10 lg:w-1/2 lg:p-12">
          <div>
            <div className="mb-8 flex items-center gap-3.5">
              <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-gradient-to-tr from-[#FD6F3B] via-orange-500 to-amber-500 shadow-md shadow-orange-500/20">
                <div className="h-5 w-5 rotate-45 rounded-md border-2 border-white/90 border-t-transparent" />
              </div>
              <div>
                <span className="text-2xl font-extrabold tracking-tight text-slate-900">Sanchaya</span>
                <p className="text-base font-semibold text-slate-500">Your Impact. Clearly.</p>
              </div>
            </div>

            {!config.isConfigured && (
              <ErrorBanner>{config.missing.length ? `Configuration required: ${config.missing.join(', ')}.` : 'Configuration required.'}</ErrorBanner>
            )}

            <div className="mb-6 flex rounded-2xl bg-slate-100 p-1">
              {['signin', 'register'].map((tab) => (
                <button
                  key={tab}
                  type="button"
                  onClick={() => switchTab(tab)}
                  className={`flex-1 rounded-xl py-3 text-base font-bold transition-all ${activeTab === tab ? 'bg-orange-100 text-orange-950 shadow-xs' : 'text-slate-500 hover:text-slate-900'}`}
                >
                  {tab === 'signin' ? 'Sign In' : 'Create Account'}
                </button>
              ))}
            </div>

            <ErrorBanner>{error}</ErrorBanner>
            {notice && <div className="mb-4 flex items-start gap-2 rounded-2xl border border-emerald-200 bg-emerald-50 p-3 text-sm font-semibold text-emerald-800"><CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />{notice}</div>}

            {activeTab === 'signin' ? (
              <div>
                <div className="mb-6">
                  <h1 className="text-3xl font-extrabold tracking-tight text-slate-900">Welcome back!</h1>
                  <div className="mb-2.5 mt-1.5 h-1.5 w-20 rounded-full bg-[#FD6F3B]" />
                  <p className="text-base font-medium text-slate-600">Sign in to continue your self-appraisal and showcase your impact.</p>
                </div>

                <form onSubmit={handleSignIn} className="space-y-4">
                  <div>
                    <label htmlFor="signin-email" className="mb-1.5 block text-base font-bold text-slate-700">Institutional Email</label>
                    <div className="relative">
                      <Mail className="absolute left-4 top-1/2 h-4.5 w-4.5 -translate-y-1/2 text-slate-400" />
                      <input id="signin-email" type="email" value={signInEmail} onChange={(event) => setSignInEmail(event.target.value)} placeholder="you@yourinstitution.edu" className="w-full rounded-2xl border border-slate-200 bg-white py-3 pl-11 pr-4 text-base font-medium text-slate-900 focus:border-[#FD6F3B] focus:outline-none focus:ring-2 focus:ring-[#FD6F3B]/20" required />
                    </div>
                    <FieldError>{fieldErrors.email}</FieldError>
                  </div>
                  <div>
                    <label htmlFor="signin-password" className="mb-1.5 block text-base font-bold text-slate-700">Password</label>
                    <div className="relative">
                      <Lock className="absolute left-4 top-1/2 h-4.5 w-4.5 -translate-y-1/2 text-slate-400" />
                      <input id="signin-password" type={showSignInPassword ? 'text' : 'password'} value={signInPassword} onChange={(event) => setSignInPassword(event.target.value)} placeholder="Enter your password" className="w-full rounded-2xl border border-slate-200 bg-white py-3 pl-11 pr-11 text-base font-medium text-slate-900 focus:border-[#FD6F3B] focus:outline-none focus:ring-2 focus:ring-[#FD6F3B]/20" required />
                      <button type="button" onClick={() => setShowSignInPassword((value) => !value)} className="absolute right-3.5 top-1/2 -translate-y-1/2 p-1 text-slate-400 hover:text-[#FD6F3B]" aria-label={showSignInPassword ? 'Hide password' : 'Show password'}>
                        {showSignInPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                      </button>
                    </div>
                  </div>
                  <div className="flex items-center justify-end text-base">
                    <button type="button" onClick={handleReset} disabled={busy || resetSent} className="font-bold text-[#FD6F3B] hover:text-[#E05320] disabled:opacity-50">Forgot Password?</button>
                  </div>
                  <button type="submit" disabled={busy || !config.isConfigured} className="flex w-full items-center justify-center gap-2 rounded-2xl bg-[#FD6F3B] py-3.5 text-base font-bold text-white shadow-md shadow-orange-500/25 transition-all hover:bg-[#E05320] disabled:cursor-not-allowed disabled:opacity-50">
                    {busy ? <Loader2 className="h-4.5 w-4.5 animate-spin" /> : <><span>Sign In</span><ArrowRight className="h-4.5 w-4.5" /></>}
                  </button>
                </form>

                <div className="relative my-6 text-center">
                  <div className="absolute inset-0 flex items-center"><div className="w-full border-t border-slate-200" /></div>
                  <span className="relative bg-white px-3.5 text-base font-semibold text-slate-400">or continue with</span>
                </div>
                <button type="button" disabled className="flex w-full items-center justify-center gap-3 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-base font-bold text-slate-400 disabled:cursor-not-allowed disabled:opacity-70">
                  <span className="text-lg font-extrabold text-slate-400">G</span><span>Google sign-in · Coming soon</span>
                </button>
                <p className="mt-3 text-center text-xs font-medium text-slate-400">Email and password are available today.</p>
              </div>
            ) : (
              <div>
                <div className="mb-6">
                  <h1 className="text-3xl font-extrabold tracking-tight text-slate-900">Join Sanchaya</h1>
                  <div className="mb-2.5 mt-1.5 h-1.5 w-20 rounded-full bg-[#FD6F3B]" />
                  <p className="text-base font-medium text-slate-600">Create your faculty profile to automate appraisals and evidence collection.</p>
                </div>
                <form onSubmit={handleRegister} className="space-y-4 text-base">
                  <div>
                    <label htmlFor="reg-name" className="mb-1 block font-bold text-slate-700">Full Name</label>
                    <div className="relative"><User className="absolute left-4 top-1/2 h-4.5 w-4.5 -translate-y-1/2 text-slate-400" /><input id="reg-name" value={regFullName} onChange={(event) => setRegFullName(event.target.value)} placeholder="Your full name" className="w-full rounded-2xl border border-slate-200 py-2.5 pl-11 pr-4 font-medium focus:border-[#FD6F3B] focus:outline-none focus:ring-2 focus:ring-[#FD6F3B]/20" required /></div>
                    <FieldError>{fieldErrors.full_name}</FieldError>
                  </div>
                  <div>
                    <label htmlFor="reg-email" className="mb-1 block font-bold text-slate-700">Institutional Email</label>
                    <div className="relative"><Mail className="absolute left-4 top-1/2 h-4.5 w-4.5 -translate-y-1/2 text-slate-400" /><input id="reg-email" type="email" value={regEmail} onChange={(event) => setRegEmail(event.target.value)} placeholder="you@yourinstitution.edu" className="w-full rounded-2xl border border-slate-200 py-2.5 pl-11 pr-4 font-medium focus:border-[#FD6F3B] focus:outline-none focus:ring-2 focus:ring-[#FD6F3B]/20" required /></div>
                    <FieldError>{fieldErrors.email}</FieldError>
                  </div>
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <div><label htmlFor="reg-institution" className="mb-1 block font-bold text-slate-700">Institution</label><input id="reg-institution" value={regInstitution} onChange={(event) => setRegInstitution(event.target.value)} placeholder="Your university" className="w-full rounded-2xl border border-slate-200 px-3.5 py-2.5 font-medium focus:border-[#FD6F3B] focus:outline-none focus:ring-2 focus:ring-[#FD6F3B]/20" required /><FieldError>{fieldErrors.institution}</FieldError></div>
                    <div><label htmlFor="reg-code" className="mb-1 block font-bold text-slate-700">Employee Code <span className="font-medium text-slate-400">(optional)</span></label><input id="reg-code" value={regEmpCode} onChange={(event) => setRegEmpCode(event.target.value)} placeholder="EMP-2026-001" className="w-full rounded-2xl border border-slate-200 px-3.5 py-2.5 font-medium focus:border-[#FD6F3B] focus:outline-none focus:ring-2 focus:ring-[#FD6F3B]/20" /></div>
                  </div>
                  <div><label htmlFor="reg-dept" className="mb-1 block font-bold text-slate-700">Department</label><input id="reg-dept" value={regDept} onChange={(event) => setRegDept(event.target.value)} placeholder="Your department" className="w-full rounded-2xl border border-slate-200 bg-white px-3.5 py-2.5 font-bold focus:border-[#FD6F3B] focus:outline-none focus:ring-2 focus:ring-[#FD6F3B]/20" required /><FieldError>{fieldErrors.department}</FieldError></div>
                  <div><label htmlFor="reg-password" className="mb-1 block font-bold text-slate-700">Password</label><div className="relative"><Lock className="absolute left-4 top-1/2 h-4.5 w-4.5 -translate-y-1/2 text-slate-400" /><input id="reg-password" type={showRegPassword ? 'text' : 'password'} value={regPassword} onChange={(event) => setRegPassword(event.target.value)} placeholder="Create a secure password" className="w-full rounded-2xl border border-slate-200 py-2.5 pl-11 pr-11 font-medium focus:border-[#FD6F3B] focus:outline-none focus:ring-2 focus:ring-[#FD6F3B]/20" required /><button type="button" onClick={() => setShowRegPassword((value) => !value)} className="absolute right-3.5 top-1/2 -translate-y-1/2 p-1 text-slate-400" aria-label={showRegPassword ? 'Hide password' : 'Show password'}>{showRegPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}</button></div><div className="mt-2 grid grid-cols-2 gap-1 text-xs font-semibold text-slate-500 sm:grid-cols-3">{passwordRules.map((rule) => <span key={rule.id} className={rule.met ? 'text-emerald-700' : ''}>{rule.met ? '✓' : '○'} {rule.label}</span>)}</div><FieldError>{fieldErrors.password}</FieldError></div>
                  <label className="flex items-start gap-2 text-sm font-medium text-slate-600"><input type="checkbox" checked={agreeTerms} onChange={(event) => setAgreeTerms(event.target.checked)} className="mt-1 rounded text-[#FD6F3B] focus:ring-[#FD6F3B]" /><span>I agree to institutional self-appraisal terms and data confidentiality policy.</span></label>
                  <FieldError>{fieldErrors.terms}</FieldError>
                  <button type="submit" disabled={busy || !config.isConfigured} className="flex w-full items-center justify-center gap-2 rounded-2xl bg-[#FD6F3B] py-3.5 text-base font-bold text-white shadow-md shadow-orange-500/25 transition-all hover:bg-[#E05320] disabled:cursor-not-allowed disabled:opacity-50">{busy ? <Loader2 className="h-4.5 w-4.5 animate-spin" /> : <><span>Create Faculty Account</span><ArrowRight className="h-4.5 w-4.5" /></>}</button>
                </form>
              </div>
            )}
          </div>
          <p className="mt-8 border-t border-slate-100 pt-4 text-center text-xs font-medium text-slate-400">By continuing, you agree to our Terms of Service and Privacy Policy.</p>
        </div>

        <div className="relative flex w-full flex-col justify-between overflow-hidden bg-gradient-to-br from-orange-100/70 via-amber-50/50 to-orange-200/60 p-8 sm:p-12 lg:w-1/2">
          <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_center,_var(--tw-gradient-stops))] from-orange-200/40 via-transparent to-transparent" />
          <div className="relative z-10 text-right"><span className="font-serif text-4xl font-bold text-orange-400">“</span><h2 className="text-xl font-extrabold leading-snug tracking-tight text-orange-950">Everything you need.<br />All in one place.</h2><span className="font-serif text-4xl font-bold text-orange-400">”</span></div>
          <div className="relative z-10 my-6 flex items-center justify-center">
            <div className="absolute h-72 w-64 rounded-full bg-orange-200/80 blur-xl" />
            <div className="relative h-80 w-64 overflow-hidden rounded-3xl border-4 border-white shadow-2xl"><img src="/faculty-portrait.png" alt="Faculty member" className="h-full w-full object-cover object-top" /></div>
            <div className="absolute -left-4 top-4 max-w-[170px] rounded-2xl border border-slate-100 bg-white/95 p-4 shadow-xl"><div className="mb-2 flex h-8 w-8 items-center justify-center rounded-xl bg-orange-100 text-[#FD6F3B]"><Cloud className="h-4.5 w-4.5" /></div><h4 className="text-sm font-bold leading-tight text-slate-900">Auto-save evidence</h4><p className="mt-0.5 text-sm leading-snug text-slate-500">Keep every contribution verifiable.</p></div>
            <div className="absolute -right-4 top-1/2 max-w-[170px] -translate-y-1/2 rounded-2xl border border-slate-100 bg-white/95 p-4 shadow-xl"><div className="mb-2 flex h-8 w-8 items-center justify-center rounded-xl bg-emerald-100 text-emerald-600"><Users className="h-4.5 w-4.5" /></div><h4 className="text-sm font-bold leading-tight text-slate-900">Role-based access</h4><p className="mt-0.5 text-sm leading-snug text-slate-500">Secure and relevant for everyone.</p></div>
            <div className="absolute -bottom-2 -left-2 max-w-[170px] rounded-2xl border border-slate-100 bg-white/95 p-4 shadow-xl"><div className="mb-2 flex h-8 w-8 items-center justify-center rounded-xl bg-amber-100 text-amber-600"><FileCheck className="h-4.5 w-4.5" /></div><h4 className="text-sm font-bold leading-tight text-slate-900">Appraisal ready</h4><p className="mt-0.5 text-sm leading-snug text-slate-500">Organized from your real record.</p></div>
          </div>
          <div className="relative z-10 flex items-center gap-2 text-base font-serif italic font-bold text-orange-900"><ShieldCheck className="h-4 w-4" />Built for faculty. <span className="underline decoration-orange-400">Backed by trust.</span></div>
        </div>
      </div>
    </div>
  );
}
