import React, { useState } from 'react';
import {
  Mail, Lock, Eye, EyeOff, ArrowRight, ShieldCheck, Building2, TrendingUp,
  Heart, CheckCircle2, XCircle, Cloud, Users, FileCheck, User, Building, Award, Loader2, X, AlertCircle
} from 'lucide-react';
import { SiOrcid } from 'react-icons/si';

export default function LoginPage({ onLogin }) {
  const [activeTab, setActiveTab] = useState('signin'); // 'signin' | 'register'
  
  // Sign In state
  const [signInEmail, setSignInEmail] = useState('ananya.sharma@westfield.edu');
  const [signInPassword, setSignInPassword] = useState('Ananya@2025');
  const [showSignInPassword, setShowSignInPassword] = useState(false);

  // Register state
  const [regFullName, setRegFullName] = useState('');
  const [regEmail, setRegEmail] = useState('');
  const [regEmpCode, setRegEmpCode] = useState('');
  const [regDept, setRegDept] = useState('Computer Science & Engineering');
  const [regRole, setRegRole] = useState('Faculty');
  const [regPassword, setRegPassword] = useState('');
  const [showRegPassword, setShowRegPassword] = useState(false);
  const [agreeTerms, setAgreeTerms] = useState(true);

  // SSO Modal State
  const [ssoProvider, setSsoProvider] = useState(null); // 'google' | 'microsoft' | 'orcid' | null
  const [isAuthenticating, setIsAuthenticating] = useState(false);
  const [selectedSsoAccount, setSelectedSsoAccount] = useState(null);

  // Password Rules Verification Helper
  const getPasswordRules = (pass) => {
    return [
      { id: 'length', label: 'At least 8 characters long', met: pass.length >= 8 },
      { id: 'uppercase', label: 'At least one uppercase letter (A-Z)', met: /[A-Z]/.test(pass) },
      { id: 'lowercase', label: 'At least one lowercase letter (a-z)', met: /[a-z]/.test(pass) },
      { id: 'number', label: 'At least one number (0-9)', met: /[0-9]/.test(pass) },
      { id: 'special', label: 'At least one special character (!@#$%^&*)', met: /[!@#$%^&*(),.?":{}|<>]/.test(pass) },
    ];
  };

  const regPasswordRules = getPasswordRules(regPassword);
  const isRegPasswordValid = regPasswordRules.every(r => r.met);
  const metRegRulesCount = regPasswordRules.filter(r => r.met).length;

  const handleSignInSubmit = (e) => {
    e.preventDefault();
    if (signInEmail.includes('admin') || signInEmail.includes('dean')) {
      onLogin('Admin');
    } else {
      onLogin('Faculty');
    }
  };

  const handleRegisterSubmit = (e) => {
    e.preventDefault();
    if (!regFullName || !regEmail || !isRegPasswordValid) return;
    onLogin(regRole);
  };

  const handleSsoSelectAccount = (accountEmail, role) => {
    setSelectedSsoAccount(accountEmail);
    setIsAuthenticating(true);
    setTimeout(() => {
      setIsAuthenticating(false);
      setSsoProvider(null);
      onLogin(role);
    }, 1200);
  };

  return (
    <div className="min-h-screen bg-[#FAF9F7] flex flex-col justify-between p-4 sm:p-6 lg:p-8 font-sans">
      <div className="max-w-6xl mx-auto w-full bg-white rounded-3xl shadow-xl shadow-slate-200/60 border border-slate-200/80 overflow-hidden flex flex-col lg:flex-row my-auto">
        
        {/* Left Column - Auth Form */}
        <div className="w-full lg:w-1/2 p-8 sm:p-12 flex flex-col justify-between">
          <div>
            {/* Logo */}
            <div className="flex items-center gap-3.5 mb-8">
              <div className="w-10 h-10 rounded-2xl bg-gradient-to-tr from-[#FD6F3B] via-orange-500 to-amber-500 flex items-center justify-center shadow-md shadow-orange-500/20">
                <div className="w-5 h-5 border-2 border-white/90 border-t-transparent rounded-md rotate-45 transform"></div>
              </div>
              <div>
                <span className="font-extrabold text-2xl tracking-tight text-slate-900">Sanchaya</span>
                <p className="text-base text-slate-500 font-semibold">Your Impact. Clearly.</p>
              </div>
            </div>

            {/* Quick Demo Switcher Banner for SIH Reviewers */}
            <div className="mb-6 p-3.5 bg-[#FFF4F0] rounded-2xl border border-orange-200/70 flex items-center justify-between text-base">
              <span className="font-bold text-orange-950 text-base">Quick Demo Login:</span>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setSignInEmail('ananya.sharma@westfield.edu');
                    onLogin('Faculty');
                  }}
                  className="px-3 py-1.5 bg-[#FD6F3B] hover:bg-[#E05320] text-white rounded-xl font-bold transition-all"
                >
                  Faculty
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setSignInEmail('dean.academics@westfield.edu');
                    onLogin('Admin');
                  }}
                  className="px-3 py-1.5 bg-slate-800 hover:bg-slate-900 text-white rounded-xl font-bold transition-all"
                >
                  Admin
                </button>
              </div>
            </div>

            {/* Segmented Control Tabs */}
            <div className="bg-slate-100 p-1 rounded-2xl flex mb-6">
              <button
                type="button"
                onClick={() => setActiveTab('signin')}
                className={`flex-1 py-3 text-base font-bold rounded-xl transition-all ${
                  activeTab === 'signin'
                    ? 'bg-orange-100 text-orange-950 shadow-xs'
                    : 'text-slate-500 hover:text-slate-900'
                }`}
              >
                Sign In
              </button>
              <button
                type="button"
                onClick={() => setActiveTab('register')}
                className={`flex-1 py-3 text-base font-bold rounded-xl transition-all ${
                  activeTab === 'register'
                    ? 'bg-orange-100 text-orange-950 shadow-xs'
                    : 'text-slate-500 hover:text-slate-900'
                }`}
              >
                Create Account
              </button>
            </div>

            {/* Dynamic Form Content based on Active Tab */}
            {activeTab === 'signin' ? (
              /* SIGN IN FORM */
              <div>
                <div className="mb-6">
                  <h1 className="text-3xl font-extrabold text-slate-900 tracking-tight">
                    Welcome back!
                  </h1>
                  <div className="w-20 h-1.5 bg-[#FD6F3B] rounded-full mt-1.5 mb-2.5"></div>
                  <p className="text-base text-slate-600 font-medium">
                    Sign in to continue your self-appraisal and showcase your impact.
                  </p>
                </div>

                <form onSubmit={handleSignInSubmit} className="space-y-4">
                  <div>
                    <label className="block text-base font-bold text-slate-700 mb-1.5">
                      Institutional Email
                    </label>
                    <div className="relative">
                      <Mail className="w-4.5 h-4.5 text-slate-400 absolute left-4 top-1/2 -translate-y-1/2" />
                      <input
                        type="email"
                        value={signInEmail}
                        onChange={(e) => setSignInEmail(e.target.value)}
                        required
                        placeholder="you@yourinstitution.edu"
                        className="w-full pl-11 pr-4 py-3 bg-white border border-slate-200 rounded-2xl text-base text-slate-900 font-medium focus:outline-none focus:ring-2 focus:ring-[#FD6F3B]/20 focus:border-[#FD6F3B] transition-all"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="block text-base font-bold text-slate-700 mb-1.5">
                      Password
                    </label>
                    <div className="relative">
                      <Lock className="w-4.5 h-4.5 text-slate-400 absolute left-4 top-1/2 -translate-y-1/2" />
                      <input
                        type={showSignInPassword ? "text" : "password"}
                        value={signInPassword}
                        onChange={(e) => setSignInPassword(e.target.value)}
                        required
                        placeholder="Enter your password"
                        className="w-full pl-11 pr-11 py-3 bg-white border border-slate-200 rounded-2xl text-base text-slate-900 font-medium focus:outline-none focus:ring-2 focus:ring-[#FD6F3B]/20 focus:border-[#FD6F3B] transition-all"
                      />
                      <button
                        type="button"
                        onClick={() => setShowSignInPassword(!showSignInPassword)}
                        className="absolute right-3.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-[#FD6F3B] transition-colors p-1"
                        title={showSignInPassword ? "Hide password" : "Show password"}
                      >
                        {showSignInPassword ? <EyeOff className="w-4 h-4 text-[#FD6F3B]" /> : <Eye className="w-4 h-4" />}
                      </button>
                    </div>
                  </div>

                  <div className="flex items-center justify-between text-base">
                    <label className="flex items-center gap-2 text-slate-600 cursor-pointer font-medium">
                      <input type="checkbox" defaultChecked className="rounded text-[#FD6F3B] focus:ring-[#FD6F3B]" />
                      <span>Remember me</span>
                    </label>
                    <a href="#forgot" onClick={(e) => e.preventDefault()} className="text-[#FD6F3B] hover:text-[#E05320] font-bold">
                      Forgot Password?
                    </a>
                  </div>

                  <button
                    type="submit"
                    className="w-full py-3.5 bg-[#FD6F3B] hover:bg-[#E05320] text-white rounded-2xl text-base font-bold shadow-md shadow-orange-500/25 flex items-center justify-center gap-2 transition-all active:scale-[0.99]"
                  >
                    <span>Sign In</span>
                    <ArrowRight className="w-4.5 h-4.5" />
                  </button>
                </form>

                {/* SSO Divider & Buttons */}
                <div className="relative my-6 text-center">
                  <div className="absolute inset-0 flex items-center">
                    <div className="w-full border-t border-slate-200"></div>
                  </div>
                  <span className="relative bg-white px-3.5 text-base text-slate-400 font-semibold">
                    or continue with
                  </span>
                </div>

                <div className="space-y-3">
                  <button
                    type="button"
                    onClick={() => setSsoProvider('google')}
                    className="w-full py-3 px-4 bg-white border border-slate-200 hover:bg-orange-50/50 hover:border-orange-200 rounded-2xl text-base font-bold text-slate-700 flex items-center justify-center gap-3 transition-all group"
                  >
                    <svg className="w-4.5 h-4.5 group-hover:scale-110 transition-transform" viewBox="0 0 24 24">
                      <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
                      <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                      <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"/>
                      <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"/>
                    </svg>
                    <span>Continue with Google</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setSsoProvider('microsoft')}
                    className="w-full py-3 px-4 bg-white border border-slate-200 hover:bg-orange-50/50 hover:border-orange-200 rounded-2xl text-base font-bold text-slate-700 flex items-center justify-center gap-3 transition-all group"
                  >
                    <svg className="w-4.5 h-4.5 group-hover:scale-110 transition-transform" viewBox="0 0 23 23">
                      <path fill="#f35325" d="M1 1h10v10H1z"/>
                      <path fill="#81bc06" d="M12 1h10v10H1z"/>
                      <path fill="#05a6f0" d="M1 12h10v10H1z"/>
                      <path fill="#ffba08" d="M12 12h10v10H1z"/>
                    </svg>
                    <span>Continue with Microsoft</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setSsoProvider('orcid')}
                    className="w-full py-3 px-4 bg-white border border-slate-200 hover:bg-orange-50/50 hover:border-orange-200 rounded-2xl text-base font-bold text-slate-700 flex items-center justify-center gap-3 transition-all group"
                  >
                    <SiOrcid className="w-4.5 h-4.5 group-hover:scale-110 transition-transform" style={{ color: '#A6CE39' }} />
                    <span>Continue with ORCID</span>
                  </button>
                </div>
              </div>

            ) : (

              /* DISTINCT CREATE ACCOUNT / REGISTER FORM WITH REAL-TIME PASSWORD VALIDATOR */
              <div>
                <div className="mb-6">
                  <h1 className="text-3xl font-extrabold text-slate-900 tracking-tight">
                    Join Sanchaya
                  </h1>
                  <div className="w-20 h-1.5 bg-[#FD6F3B] rounded-full mt-1.5 mb-2.5"></div>
                  <p className="text-base text-slate-600 font-medium">
                    Create your academic profile to automate appraisals and evidence collection.
                  </p>
                </div>

                <form onSubmit={handleRegisterSubmit} className="space-y-4 text-base">
                  <div>
                    <label className="block font-bold text-slate-700 mb-1">
                      Full Name (With Title)
                    </label>
                    <div className="relative">
                      <User className="w-4.5 h-4.5 text-slate-400 absolute left-4 top-1/2 -translate-y-1/2" />
                      <input
                        type="text"
                        required
                        value={regFullName}
                        onChange={(e) => setRegFullName(e.target.value)}
                        placeholder="Dr. Ananya Sharma"
                        className="w-full pl-11 pr-4 py-2.5 bg-white border border-slate-200 rounded-2xl text-slate-900 font-medium focus:outline-none focus:ring-2 focus:ring-[#FD6F3B]/20"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="block font-bold text-slate-700 mb-1">
                      Institutional Email
                    </label>
                    <div className="relative">
                      <Mail className="w-4.5 h-4.5 text-slate-400 absolute left-4 top-1/2 -translate-y-1/2" />
                      <input
                        type="email"
                        required
                        value={regEmail}
                        onChange={(e) => setRegEmail(e.target.value)}
                        placeholder="ananya.sharma@westfield.edu"
                        className="w-full pl-11 pr-4 py-2.5 bg-white border border-slate-200 rounded-2xl text-slate-900 font-medium focus:outline-none focus:ring-2 focus:ring-[#FD6F3B]/20"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block font-bold text-slate-700 mb-1">
                        Employee / Faculty Code
                      </label>
                      <input
                        type="text"
                        required
                        value={regEmpCode}
                        onChange={(e) => setRegEmpCode(e.target.value)}
                        placeholder="EMP-2024-8849"
                        className="w-full px-3.5 py-2.5 bg-white border border-slate-200 rounded-2xl text-slate-900 font-medium focus:outline-none focus:ring-2 focus:ring-[#FD6F3B]/20"
                      />
                    </div>

                    <div>
                      <label className="block font-bold text-slate-700 mb-1">
                        Institutional Role
                      </label>
                      <select
                        value={regRole}
                        onChange={(e) => setRegRole(e.target.value)}
                        className="w-full px-3.5 py-2.5 bg-white border border-slate-200 rounded-2xl text-slate-900 font-bold focus:outline-none focus:ring-2 focus:ring-[#FD6F3B]/20"
                      >
                        <option value="Faculty">Faculty Member</option>
                        <option value="Admin">HOD / Admin</option>
                      </select>
                    </div>
                  </div>

                  <div>
                    <label className="block font-bold text-slate-700 mb-1">
                      Department
                    </label>
                    <select
                      value={regDept}
                      onChange={(e) => setRegDept(e.target.value)}
                      className="w-full px-3.5 py-2.5 bg-white border border-slate-200 rounded-2xl text-slate-900 font-medium focus:outline-none focus:ring-2 focus:ring-[#FD6F3B]/20"
                    >
                      <option>Computer Science & Engineering</option>
                      <option>Electrical & Electronics Engineering</option>
                      <option>Mechanical Engineering</option>
                      <option>Biotechnology & Life Sciences</option>
                      <option>Physics & Nanotechnology</option>
                    </select>
                  </div>

                  {/* Create Password Input */}
                  <div>
                    <div className="flex justify-between items-center mb-1">
                      <label className="font-bold text-slate-700">
                        Create Password
                      </label>
                      {regPassword && (
                        <span className={`text-base font-extrabold inline-flex items-center gap-1 ${
                          metRegRulesCount === 5 ? 'text-emerald-600' :
                          metRegRulesCount >= 3 ? 'text-amber-600' : 'text-red-500'
                        }`}>
                          {metRegRulesCount === 5 ? (
                            <><CheckCircle2 className="w-3.5 h-3.5" /> Strong Password</>
                          ) : `${metRegRulesCount}/5 Rules Met`}
                        </span>
                      )}
                    </div>

                    <div className="relative">
                      <Lock className="w-4.5 h-4.5 text-slate-400 absolute left-4 top-1/2 -translate-y-1/2" />
                      <input
                        type={showRegPassword ? "text" : "password"}
                        required
                        value={regPassword}
                        onChange={(e) => setRegPassword(e.target.value)}
                        placeholder="e.g. Ananya@2025"
                        className={`w-full pl-11 pr-11 py-2.5 bg-white border rounded-2xl text-slate-900 font-medium focus:outline-none focus:ring-2 transition-all ${
                          regPassword.length > 0
                            ? isRegPasswordValid
                              ? 'border-emerald-500 focus:ring-emerald-500/20'
                              : 'border-red-300 focus:ring-red-500/20'
                            : 'border-slate-200 focus:ring-[#FD6F3B]/20'
                        }`}
                      />
                      <button
                        type="button"
                        onClick={() => setShowRegPassword(!showRegPassword)}
                        className="absolute right-3.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-[#FD6F3B] p-1"
                        title={showRegPassword ? "Hide password" : "Show password"}
                      >
                        {showRegPassword ? <EyeOff className="w-4 h-4 text-[#FD6F3B]" /> : <Eye className="w-4 h-4" />}
                      </button>
                    </div>

                    {/* Strength Progress Meter */}
                    {regPassword.length > 0 && (
                      <div className="w-full bg-slate-100 h-2 rounded-full overflow-hidden mt-2">
                        <div 
                          className={`h-full transition-all duration-300 rounded-full ${
                            metRegRulesCount === 5 ? 'bg-emerald-500 w-full' :
                            metRegRulesCount >= 3 ? 'bg-amber-500 w-3/5' :
                            'bg-red-500 w-1/5'
                          }`}
                        ></div>
                      </div>
                    )}

                    {/* Real-time Color-Coded Password Rules Checklist */}
                    <div className="mt-2.5 p-3.5 rounded-2xl bg-slate-50 border border-slate-200/80 space-y-2 text-base">
                      <span className="block font-bold text-slate-600 text-xs uppercase tracking-wider mb-1">
                        Password Requirements
                      </span>
                      {regPasswordRules.map((rule) => (
                        <div 
                          key={rule.id}
                          className={`flex items-center gap-2 font-medium transition-all ${
                            rule.met
                              ? 'text-emerald-700 font-bold'
                              : 'text-red-500'
                          }`}
                        >
                          {rule.met ? (
                            <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                          ) : (
                            <XCircle className="w-4 h-4 text-red-500 shrink-0" />
                          )}
                          <span>{rule.label}</span>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="pt-1">
                    <label className="flex items-start gap-2 text-slate-600 cursor-pointer">
                      <input 
                        type="checkbox" 
                        checked={agreeTerms} 
                        onChange={(e) => setAgreeTerms(e.target.checked)} 
                        className="mt-0.5 rounded text-[#FD6F3B] focus:ring-[#FD6F3B]" 
                      />
                      <span className="text-base leading-relaxed font-medium">
                        I agree to institutional self-appraisal terms and data confidentiality policy.
                      </span>
                    </label>
                  </div>

                  <button
                    type="submit"
                    disabled={!agreeTerms || !isRegPasswordValid}
                    className="w-full py-3.5 bg-[#FD6F3B] hover:bg-[#E05320] text-white rounded-2xl text-base font-bold shadow-md shadow-orange-500/25 flex items-center justify-center gap-2 transition-all active:scale-[0.99] disabled:opacity-50 disabled:cursor-not-allowed mt-2"
                  >
                    <span>Create Account & Start Appraisal</span>
                    <ArrowRight className="w-4.5 h-4.5" />
                  </button>
                </form>
              </div>

            )}

            <div className="mt-6 text-center text-base text-slate-500 font-medium">
              {activeTab === 'signin' ? (
                <>
                  New to Sanchaya?{' '}
                  <button onClick={() => setActiveTab('register')} className="text-[#FD6F3B] font-bold hover:underline">
                    Create an account
                  </button>
                </>
              ) : (
                <>
                  Already have an institutional account?{' '}
                  <button onClick={() => setActiveTab('signin')} className="text-[#FD6F3B] font-bold hover:underline">
                    Sign in
                  </button>
                </>
              )}
            </div>

          </div>

          <div className="mt-8 pt-4 border-t border-slate-100 text-base text-center text-slate-400 font-medium">
            By continuing, you agree to our <a href="#terms" onClick={(e)=>e.preventDefault()} className="underline hover:text-slate-600">Terms of Service</a> and <a href="#privacy" onClick={(e)=>e.preventDefault()} className="underline hover:text-slate-600">Privacy Policy</a>.
          </div>
        </div>

        {/* Right Column - Hero Graphic & Floating Feature Cards */}
        <div className="w-full lg:w-1/2 bg-gradient-to-br from-orange-100/70 via-amber-50/50 to-orange-200/60 p-8 sm:p-12 flex flex-col justify-between relative overflow-hidden">
          
          {/* Subtle Blob Background */}
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,_var(--tw-gradient-stops))] from-orange-200/40 via-transparent to-transparent pointer-events-none"></div>

          {/* Quote Annotation Top Right */}
          <div className="relative z-10 text-right">
            <span className="text-orange-400 font-serif text-4xl font-bold">“</span>
            <h2 className="text-xl font-extrabold text-orange-950 tracking-tight leading-snug">
              Everything you need.<br />All in one place.
            </h2>
            <span className="text-orange-400 font-serif text-4xl font-bold">”</span>
          </div>

          {/* Professor Hero Image & Floating Cards Container */}
          <div className="relative z-10 my-6 flex items-center justify-center">
            
            {/* Orange backdrop organic shape */}
            <div className="w-72 h-80 bg-orange-200/80 rounded-full blur-xl absolute -z-10 animate-pulse-subtle"></div>
            
            {/* Professor Photo */}
            <div className="relative w-64 h-80 rounded-3xl overflow-hidden border-4 border-white shadow-2xl">
              <img 
                src="/dr_ananya_sharma.png" 
                alt="Dr. Ananya Sharma" 
                className="w-full h-full object-cover object-top"
              />
            </div>

            {/* Floating Card 1: Top Left */}
            <div className="absolute top-4 -left-4 bg-white/95 backdrop-blur-md p-4 rounded-2xl shadow-xl border border-slate-100 max-w-[170px] animate-float">
              <div className="w-8 h-8 bg-orange-100 rounded-xl flex items-center justify-center text-[#FD6F3B] mb-2">
                <Cloud className="w-4.5 h-4.5" />
              </div>
              <h4 className="text-sm font-bold text-slate-900 leading-tight">Auto-save evidence</h4>
              <p className="text-sm text-slate-500 mt-0.5 leading-snug">Never lose your progress.</p>
            </div>

            {/* Floating Card 2: Middle Right */}
            <div className="absolute top-1/2 -right-4 -translate-y-1/2 bg-white/95 backdrop-blur-md p-4 rounded-2xl shadow-xl border border-slate-100 max-w-[170px]">
              <div className="w-8 h-8 bg-emerald-100 rounded-xl flex items-center justify-center text-emerald-600 mb-2">
                <Users className="w-4.5 h-4.5" />
              </div>
              <h4 className="text-sm font-bold text-slate-900 leading-tight">Role-based access</h4>
              <p className="text-sm text-slate-500 mt-0.5 leading-snug">Secure. Relevant. For everyone.</p>
            </div>

            {/* Floating Card 3: Bottom Left */}
            <div className="absolute bottom-4 -left-2 bg-white/95 backdrop-blur-md p-4 rounded-2xl shadow-xl border border-slate-100 max-w-[170px]">
              <div className="w-8 h-8 bg-amber-100 rounded-xl flex items-center justify-center text-amber-600 mb-2">
                <FileCheck className="w-4.5 h-4.5" />
              </div>
              <h4 className="text-sm font-bold text-slate-900 leading-tight">Appraisal ready</h4>
              <p className="text-sm text-slate-500 mt-0.5 leading-snug">Organized. Complete. Always ready.</p>
            </div>

          </div>

          {/* Bottom Annotation Doodle */}
          <div className="relative z-10 text-left">
            <p className="text-base font-serif italic font-bold text-orange-900">
              Built for faculty. <span className="underline decoration-orange-400">Backed by trust.</span>
            </p>
          </div>

        </div>

      </div>

    </div>
  );
}
