const env = import.meta.env || {};

function firstConfigured(...values) {
  return values.find((value) => typeof value === 'string' && value.trim().length > 0)?.trim() || '';
}

export class RuntimeConfigError extends Error {
  constructor(missing) {
    super(`Sanchaya is not configured. Missing environment variable${missing.length > 1 ? 's' : ''}: ${missing.join(', ')}.`);
    this.name = 'RuntimeConfigError';
    this.missing = missing;
  }
}

export function getRuntimeConfig() {
  const supabaseUrl = firstConfigured(
    env.VITE_SUPABASE_URL,
    env.NEXT_PUBLIC_SUPABASE_URL,
  );
  const supabaseAnonKey = firstConfigured(
    env.VITE_SUPABASE_ANON_KEY,
    env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  );
  const apiUrl = firstConfigured(
    env.VITE_API_URL,
    env.NEXT_PUBLIC_API_URL,
  );

  const missing = [];
  if (!supabaseUrl) missing.push('VITE_SUPABASE_URL');
  if (!supabaseAnonKey) missing.push('VITE_SUPABASE_ANON_KEY');
  if (!apiUrl) missing.push('VITE_API_URL');

  return {
    supabaseUrl,
    supabaseAnonKey,
    apiUrl: apiUrl.replace(/\/+$/, ''),
    missing,
    isConfigured: missing.length === 0,
  };
}

export function requireRuntimeConfig() {
  const config = getRuntimeConfig();
  if (!config.isConfigured) throw new RuntimeConfigError(config.missing);
  return config;
}

export function runtimeConfigMessage(error) {
  if (error instanceof RuntimeConfigError) return error.message;
  return error?.message || 'The service is temporarily unavailable. Please try again.';
}
