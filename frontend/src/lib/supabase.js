import { createClient } from '@supabase/supabase-js';
import { requireRuntimeConfig } from './config';

let client;

export function getSupabaseClient() {
  if (client) return client;

  const { supabaseUrl, supabaseAnonKey } = requireRuntimeConfig();
  client = createClient(supabaseUrl, supabaseAnonKey, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
    },
  });
  return client;
}

export async function signInWithPassword(email, password) {
  const { data, error } = await getSupabaseClient().auth.signInWithPassword({ email, password });
  if (error) throw error;
  return data;
}

export async function signUpFaculty({ email, password, fullName, institution, department, employeeCode }) {
  const { data, error } = await getSupabaseClient().auth.signUp({
    email,
    password,
    options: {
      data: {
        full_name: fullName,
        role: 'faculty',
        institution,
        department,
        employee_code: employeeCode || null,
      },
    },
  });
  if (error) throw error;
  return data;
}

export async function signOut() {
  const { error } = await getSupabaseClient().auth.signOut();
  if (error) throw error;
}

export async function sendPasswordReset(email, redirectTo = window.location.origin + '/login') {
  const { error } = await getSupabaseClient().auth.resetPasswordForEmail(email, { redirectTo });
  if (error) throw error;
}

export async function getSession() {
  const { data, error } = await getSupabaseClient().auth.getSession();
  if (error) throw error;
  return data.session;
}

export function onAuthStateChange(callback) {
  const { data } = getSupabaseClient().auth.onAuthStateChange(callback);
  return () => data.subscription.unsubscribe();
}
