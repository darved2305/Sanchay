import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
export default defineConfig({
  // Vite defaults to loading .env from this directory, but the project keeps a
  // single .env at the repo root -- which is also where the backend's Settings
  // looks. Without this the VITE_* vars silently resolve to undefined and the
  // app renders "Configuration required" instead of a login form.
  envDir: '..',
  plugins: [react(), tailwindcss()],
})

