import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Dev convenience only: proxy /api (REST + WS) to the local meety-api.
// Production is same-origin — meety-api serves dist/ directly (D1, no CORS).
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:8000',
        ws: true,
      },
    },
  },
})
