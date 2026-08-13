import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import {
  ArrowRight, BookOpenCheck, CalendarClock, CheckCircle2, FileCheck2,
  FileText, FlaskConical, FolderCheck, Layers, Menu, RefreshCw, ShieldCheck, Sparkles,
  UploadCloud, UsersRound, X,
} from 'lucide-react';
import { SiOrcid } from 'react-icons/si';
import Logo from '../components/Logo';
import { LoopArrow, Sparkle, Squiggle, Underline } from '../components/Doodles';
import { heroReveal, heroRevealDelayed } from '../lib/motion';

const navLinks = [
  { label: 'Features', href: '#features' },
  { label: 'For Faculty', href: '#faculty' },
  { label: 'For Admins', href: '#admins' },
  { label: 'About', href: '#about' },
];

const heroCards = [
  { title: 'Self-Appraisal 2024–25', state: 'In Progress', tone: 'chip-butter', icon: FileCheck2, className: 'top-6 -left-3 sm:-left-10' },
  { title: 'Evidence', state: 'Connected', tone: 'chip-mint', icon: FolderCheck, className: 'top-1/3 -right-3 sm:-right-10' },
  { title: 'Academic Record', state: 'Up to date', tone: 'chip-sky', icon: Layers, className: 'bottom-8 -left-2 sm:-left-8' },
];

const tryPills = ['Reconstruct My Year', 'Log an Activity', 'Upload Evidence', 'Generate Appraisal'];

const flows = [
  {
    icon: BookOpenCheck,
    tone: 'sky',
    title: 'Academic Record',
    text: 'One permanent home for teaching, research, mentorship, service, and everything in between.',
  },
  {
    icon: FlaskConical,
    tone: 'lavender',
    title: 'Automatic Publication Tracking',
    text: 'ORCID, OpenAlex, and Crossref candidates arrive on their own. You only confirm what is yours.',
  },
  {
    icon: FileCheck2,
    tone: 'mint',
    title: 'Evidence + Appraisal',
    text: 'Proof attaches to your record once, and the appraisal writes itself from confirmed work.',
  },
];

const automations = [
  {
    icon: RefreshCw,
    tone: 'lavender',
    title: 'Reconstruct My Year',
    text: 'Rebuild your academic year from the places your work already lives, then confirm what is right.',
    available: true,
  },
  {
    icon: FileText,
    tone: 'peach',
    title: 'Any Form Assistant',
    text: 'Drop in a university form and get it back understood and filled from your record.',
    available: false,
  },
  {
    icon: CalendarClock,
    tone: 'butter',
    title: 'Deadline Rescue',
    text: 'Appraisal due tomorrow? One orchestrated run closes the gaps with you.',
    available: false,
  },
  {
    icon: Sparkles,
    tone: 'sky',
    title: 'Teaching Change Detector',
    text: 'Compare course snapshots across years and surface real, approvable improvements.',
    available: false,
  },
];

const facultySteps = [
  { icon: UploadCloud, title: 'Capture', text: 'Add work in seconds, sync publications, or upload proof.' },
  { icon: Layers, title: 'Organize', text: 'Everything lands in one canonical record with evidence attached.' },
  { icon: CheckCircle2, title: 'Submit', text: 'Generate, review, and submit your appraisal with a PDF export.' },
];

const adminPoints = [
  { icon: UsersRound, title: 'Live review queue', text: 'Submissions arrive in real time — comment, return, approve, or reject in one place.' },
  { icon: ShieldCheck, title: 'Search and filters', text: 'Find faculty by name or employee code; filter by department, year, and status.' },
  { icon: FileText, title: 'Reports and PDF', text: 'Every submission exports to a clean, institution-ready PDF.' },
];

const cardEnterLazy = {
  initial: { opacity: 0, y: 6 },
  whileInView: { opacity: 1, y: 0 },
  viewport: { once: true, margin: '-60px' },
  transition: { duration: 0.3, ease: 'easeOut' },
};

function toneSurface(tone) {
  switch (tone) {
    case 'sky': return 'bg-[var(--brand-sky)] border-[var(--brand-sky-strong)]';
    case 'lavender': return 'bg-[var(--brand-primary-softer)] border-[var(--brand-lavender-strong)]';
    case 'mint': return 'bg-[var(--brand-mint)] border-[var(--brand-mint-strong)]';
    case 'peach': return 'bg-[var(--brand-peach)] border-[var(--brand-peach-strong)]';
    case 'butter': return 'bg-[var(--brand-butter)] border-[var(--brand-butter-strong)]';
    default: return 'bg-[var(--brand-surface)] border-[var(--brand-border-soft)]';
  }
}

export default function LandingPage() {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  return (
    <div className="min-h-screen bg-[var(--brand-canvas)] text-[var(--brand-text)] antialiased">
      {/* Public header */}
      <header className="sticky top-0 z-40 border-b border-[var(--brand-border-soft)] bg-[color:rgb(251_250_247_/_90%)] backdrop-blur-xl">
        <div className="mx-auto flex max-w-[1360px] items-center justify-between gap-4 px-5 py-3.5 sm:px-10 lg:px-14">
          <Link to="/" aria-label="Sanchaya home"><Logo /></Link>
          <nav className="hidden items-center gap-1 lg:flex" aria-label="Public">
            {navLinks.map((item) => (
              <a
                key={item.label}
                href={item.href}
                className="flex items-center gap-1 rounded-[var(--radius-control)] px-3.5 py-2 text-sm font-bold text-[var(--brand-muted)] transition hover:bg-[var(--brand-primary-softer)] hover:text-[var(--brand-ink)]"
              >
                {item.label}
              </a>
            ))}
          </nav>
          <div className="hidden items-center gap-2.5 lg:flex">
            <Link to="/login" className="btn btn-secondary btn-sm !px-4">Log in</Link>
            <Link to="/register" className="btn btn-primary btn-sm !px-4">Get Started Free</Link>
          </div>
          <button
            type="button"
            className="btn btn-secondary btn-sm !p-2.5 lg:hidden"
            aria-label={mobileMenuOpen ? 'Close menu' : 'Open menu'}
            onClick={() => setMobileMenuOpen((value) => !value)}
          >
            {mobileMenuOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </button>
        </div>
        {mobileMenuOpen && (
          <div className="border-t border-[var(--brand-border-soft)] bg-[var(--brand-canvas)] px-5 py-4 lg:hidden">
            <nav className="flex flex-col gap-1" aria-label="Public mobile">
              {navLinks.map((item) => (
                <a
                  key={item.label}
                  href={item.href}
                  onClick={() => setMobileMenuOpen(false)}
                  className="rounded-[var(--radius-control)] px-3 py-2.5 text-sm font-bold text-[var(--brand-text)] transition hover:bg-[var(--brand-primary-softer)]"
                >
                  {item.label}
                </a>
              ))}
              <div className="mt-3 flex gap-2">
                <Link to="/login" className="btn btn-secondary flex-1">Log in</Link>
                <Link to="/register" className="btn btn-primary flex-1">Get Started Free</Link>
              </div>
            </nav>
          </div>
        )}
      </header>

      {/* Hero */}
      <section className="relative mx-auto grid max-w-[1360px] grid-cols-1 items-center gap-14 px-5 pb-24 pt-14 sm:px-10 sm:pt-20 lg:grid-cols-2 lg:px-14 lg:pb-28">
        <Squiggle className="pointer-events-none absolute right-[46%] top-10 hidden h-6 w-14 text-[var(--brand-lavender-strong)] lg:block" />
        <motion.div {...heroReveal}>
          <span className="chip chip-primary !px-3.5 !py-1.5 !text-xs">
            <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />
            Faculty self-appraisal, automated
          </span>
          <h1 className="mt-6 text-[44px] font-extrabold leading-[1.04] tracking-tight text-[var(--brand-ink)] sm:text-6xl lg:text-[68px]">
            Less paperwork.<br />
            More impact.<br />
            <span className="relative inline-block">
              Finally visible.
              <Underline className="absolute -bottom-2 left-0 h-3 w-full text-[var(--brand-primary)]" />
            </span>
          </h1>
          <p className="mt-7 max-w-md text-lg font-medium leading-relaxed text-[var(--brand-muted)]">
            Your academic work, remembered automatically. Your appraisal, evidence, and reports — generated, not typed.
          </p>
          <div className="mt-9 flex flex-wrap items-center gap-3">
            <Link to="/register" className="btn btn-primary btn-lg">
              Get started free <ArrowRight className="h-4 w-4" aria-hidden="true" />
            </Link>
            <Link to="/login" className="btn btn-secondary btn-lg">Log in</Link>
          </div>
          <div className="mt-7 flex flex-wrap items-center gap-2">
            <span className="text-xs font-bold text-[var(--brand-subtle)]">Try:</span>
            {tryPills.map((pill) => (
              <Link
                key={pill}
                to="/login"
                className="rounded-[var(--radius-pill)] border border-[var(--brand-border)] bg-[var(--brand-surface)] px-3 py-1.5 text-xs font-bold text-[var(--brand-muted)] transition hover:border-[var(--brand-lavender-strong)] hover:bg-[var(--brand-primary-softer)] hover:text-[var(--brand-primary-hover)]"
              >
                {pill}
              </Link>
            ))}
          </div>
        </motion.div>

        {/* Hero visual */}
        <motion.div {...heroRevealDelayed(0.15)} className="relative mx-auto flex w-full max-w-[520px] items-center justify-center py-8">
          <div
            aria-hidden="true"
            className="absolute inset-0 -z-10 animate-pulse-subtle"
            style={{ background: 'radial-gradient(ellipse 62% 58% at 50% 46%, var(--brand-lavender) 0%, var(--brand-primary-softer) 52%, transparent 76%)' }}
          />
          <Sparkle className="pointer-events-none absolute -top-1 right-8 h-8 w-8 text-[var(--brand-butter-strong)]" />
          <LoopArrow className="pointer-events-none absolute bottom-4 right-2 hidden h-10 w-10 text-[var(--brand-lavender-strong)] sm:block" />
          <div className="relative h-72 w-72 overflow-hidden rounded-full border-4 border-[var(--brand-surface)] shadow-[var(--shadow-raised)] sm:h-96 sm:w-96">
            <img src="/faculty-portrait.png" alt="A faculty member using Sanchaya" className="h-full w-full object-cover object-top" />
          </div>
          {heroCards.map((card, index) => {
            const Icon = card.icon;
            return (
              <div
                key={card.title}
                className={`app-surface absolute ${card.className} ${index !== 1 ? 'animate-float' : ''} p-3.5 sm:p-4`}
                style={index === 2 ? { animationDelay: '1.2s' } : undefined}
              >
                <div className="flex items-center gap-2.5">
                  <span className={`icon-chip !h-8 !w-8 ${card.tone}`}><Icon className="h-4 w-4" aria-hidden="true" /></span>
                  <div>
                    <p className="text-[13px] font-bold leading-tight text-[var(--brand-ink)]">{card.title}</p>
                    <span className={`chip ${card.tone} mt-1 !border-0 !px-2 !py-0 !text-[11px]`}>{card.state}</span>
                  </div>
                </div>
              </div>
            );
          })}
        </motion.div>
      </section>

      {/* Section 1 — key flows */}
      <section id="features" className="mx-auto max-w-[1360px] px-5 pb-24 sm:px-10 lg:px-14">
        <div className="max-w-2xl">
          <h2 className="text-3xl font-extrabold tracking-tight text-[var(--brand-ink)] sm:text-4xl">Your academic year, automatically organized.</h2>
          <p className="mt-3 text-base font-medium text-[var(--brand-muted)]">Three quiet flows replace a week of reconstruction every appraisal season.</p>
        </div>
        <div className="mt-10 grid grid-cols-1 gap-5 md:grid-cols-3">
          {flows.map((flow) => {
            const Icon = flow.icon;
            return (
              <motion.div key={flow.title} {...cardEnterLazy} className={`rounded-[var(--radius-panel)] border p-7 ${toneSurface(flow.tone)}`}>
                <span className={`icon-chip chip-${flow.tone} !h-11 !w-11`}><Icon className="h-5 w-5" aria-hidden="true" /></span>
                <h3 className="mt-5 text-xl font-extrabold text-[var(--brand-ink)]">{flow.title}</h3>
                <p className="mt-2 text-[15px] font-medium leading-relaxed text-[var(--brand-muted)]">{flow.text}</p>
              </motion.div>
            );
          })}
        </div>
      </section>

      {/* Section 2 — automations */}
      <section id="faculty" className="mx-auto max-w-[1360px] px-5 pb-24 sm:px-10 lg:px-14">
        <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-end">
          <div className="max-w-2xl">
            <h2 className="text-3xl font-extrabold tracking-tight text-[var(--brand-ink)] sm:text-4xl">Automation that does the paperwork.</h2>
            <p className="mt-3 text-base font-medium text-[var(--brand-muted)]">The system proposes. You confirm. Nothing enters your record without you.</p>
          </div>
        </div>
        <div className="mt-10 grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-4">
          {automations.map((item) => {
            const Icon = item.icon;
            return (
              <div key={item.title} className={`flex flex-col rounded-[var(--radius-panel)] border p-6 ${toneSurface(item.tone)}`}>
                <div className="flex items-start justify-between">
                  <span className={`icon-chip chip-${item.tone}`}><Icon className="h-5 w-5" aria-hidden="true" /></span>
                  {!item.available && <span className="chip chip-surface !text-[11px]">Coming soon</span>}
                </div>
                <h3 className="mt-4 text-lg font-extrabold text-[var(--brand-ink)]">{item.title}</h3>
                <p className="mt-1.5 flex-1 text-sm font-medium leading-relaxed text-[var(--brand-muted)]">{item.text}</p>
                {item.available ? (
                  <Link to="/login" className="mt-5 inline-flex items-center gap-1.5 text-sm font-bold text-[var(--brand-primary-hover)] hover:underline">
                    Explore <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
                  </Link>
                ) : (
                  <span className="mt-5 text-sm font-semibold text-[var(--brand-subtle)]">In active development</span>
                )}
              </div>
            );
          })}
        </div>
      </section>

      {/* Section 3 — faculty experience */}
      <section className="mx-auto max-w-[1360px] px-5 pb-24 sm:px-10 lg:px-14">
        <div className="rounded-[var(--radius-panel)] border border-[var(--brand-border-soft)] bg-[var(--brand-surface)] p-8 shadow-[var(--shadow-soft)] sm:p-12">
          <div className="max-w-2xl">
            <h2 className="text-3xl font-extrabold tracking-tight text-[var(--brand-ink)]">Capture. Organize. Submit.</h2>
            <p className="mt-3 text-base font-medium text-[var(--brand-muted)]">The whole faculty loop, without a single blank annual form.</p>
          </div>
          <div className="mt-9 grid grid-cols-1 gap-6 md:grid-cols-3">
            {facultySteps.map((step, index) => {
              const Icon = step.icon;
              return (
                <div key={step.title} className="relative">
                  <div className="flex items-center gap-3">
                    <span className="icon-chip bg-[var(--brand-primary-soft)] text-[var(--brand-primary-hover)]"><Icon className="h-5 w-5" aria-hidden="true" /></span>
                    <span className="text-xs font-extrabold uppercase tracking-widest text-[var(--brand-subtle)]">Step {index + 1}</span>
                  </div>
                  <h3 className="mt-4 text-lg font-extrabold text-[var(--brand-ink)]">{step.title}</h3>
                  <p className="mt-1.5 text-sm font-medium text-[var(--brand-muted)]">{step.text}</p>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* Section 4 — admins */}
      <section id="admins" className="mx-auto max-w-[1360px] px-5 pb-24 sm:px-10 lg:px-14">
        <div className="grid grid-cols-1 items-center gap-10 lg:grid-cols-2">
          <div>
            <h2 className="text-3xl font-extrabold tracking-tight text-[var(--brand-ink)] sm:text-4xl">For administrators: review, don't chase.</h2>
            <p className="mt-3 max-w-lg text-base font-medium text-[var(--brand-muted)]">
              A live institutional console replaces forty email threads and a personal tracking spreadsheet.
            </p>
            <p className="mt-5 text-sm font-semibold text-[var(--brand-subtle)]">Administrators are invited by their institution.</p>
          </div>
          <div className="space-y-4">
            {adminPoints.map((point) => {
              const Icon = point.icon;
              return (
                <div key={point.title} className="app-surface flex items-start gap-4 p-5">
                  <span className="icon-chip bg-[var(--brand-sky)] text-[var(--brand-sky-ink)]"><Icon className="h-5 w-5" aria-hidden="true" /></span>
                  <div>
                    <h3 className="text-base font-extrabold text-[var(--brand-ink)]">{point.title}</h3>
                    <p className="mt-1 text-sm font-medium text-[var(--brand-muted)]">{point.text}</p>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* Final CTA + integrations */}
      <section id="about" className="mx-auto max-w-[1360px] px-5 pb-24 sm:px-10 lg:px-14">
        <div className="relative overflow-hidden rounded-[28px] border border-[var(--brand-lavender-strong)] bg-[var(--brand-lavender)] p-10 text-center sm:p-16">
          <Sparkle className="pointer-events-none absolute left-10 top-8 h-7 w-7 text-[var(--brand-primary)]" />
          <Squiggle className="pointer-events-none absolute bottom-8 right-10 h-6 w-14 text-[var(--brand-lavender-strong)]" />
          <h2 className="mx-auto max-w-2xl text-3xl font-extrabold tracking-tight text-[var(--brand-ink)] sm:text-4xl">
            Make every effort count.
          </h2>
          <p className="mx-auto mt-3 max-w-xl text-base font-medium text-[var(--brand-muted)]">
            Keep your record alive all year, and let appraisal season take care of itself.
          </p>
          <Link to="/register" className="btn btn-primary btn-lg mt-8">
            Get started free <ArrowRight className="h-4 w-4" aria-hidden="true" />
          </Link>
          <div className="mt-10 border-t border-[var(--brand-lavender-strong)] pt-6">
            <p className="text-xs font-bold uppercase tracking-wider text-[var(--brand-muted)]">Publication sources we sync</p>
            <div className="mt-3 flex flex-wrap items-center justify-center gap-2.5">
              <span className="chip chip-surface !px-3.5 !py-1.5"><SiOrcid className="h-3.5 w-3.5" style={{ color: '#A6CE39' }} aria-hidden="true" /> ORCID</span>
              <span className="chip chip-surface !px-3.5 !py-1.5">OpenAlex</span>
              <span className="chip chip-surface !px-3.5 !py-1.5">Crossref</span>
            </div>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-[var(--brand-border-soft)]">
        <div className="mx-auto flex max-w-[1360px] flex-col items-center justify-between gap-4 px-5 py-8 sm:flex-row sm:px-10 lg:px-14">
          <Logo compact />
          <p className="text-center text-xs font-medium text-[var(--brand-subtle)] sm:text-right">
            Your data is yours; sources are read-only and revocable.<br className="sm:hidden" /> Built for faculty, shaped for institutions.
          </p>
        </div>
      </footer>
    </div>
  );
}
