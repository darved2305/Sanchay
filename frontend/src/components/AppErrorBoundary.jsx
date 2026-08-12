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
        <main className="flex min-h-screen items-center justify-center bg-[#FAF9F7] p-6">
          <section className="max-w-lg rounded-3xl border border-red-200 bg-white p-8 text-center shadow-xl">
            <h1 className="text-2xl font-extrabold text-slate-900">Something went wrong</h1>
            <p className="mt-3 text-sm font-medium text-slate-600">
              The application could not render this page. Reload to retry with your saved server session.
            </p>
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="mt-6 rounded-xl bg-[#FD6F3B] px-5 py-2.5 text-sm font-bold text-white hover:bg-[#E05320]"
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
