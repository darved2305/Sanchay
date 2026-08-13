import React from 'react';

export default class AppErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    // Keep the failure visible to the user while preserving the browser
    // console details needed for deployment diagnostics.
    console.error('frontend_render_error', error, info);
  }

  render() {
    if (this.state.error) {
      return (
        <main className="flex min-h-screen items-center justify-center p-6">
          <section className="app-surface max-w-lg p-8 text-center">
            <h1 className="text-2xl font-extrabold text-[var(--brand-ink)]">Something went wrong</h1>
            <p className="mt-3 text-sm font-medium text-[var(--brand-muted)]">
              The application could not render this page. Reload to retry with your saved server session.
            </p>
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="btn btn-primary mt-6"
            >
              Reload application
            </button>
          </section>
        </main>
      );
    }
    return this.props.children;
  }
}
