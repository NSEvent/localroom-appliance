import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Dev convenience only: proxy REST + WebSockets to the LocalRoom appliance.
// Production is same-origin—LocalRoom serves the committed dist directly.
export default defineConfig({
  base: '/console/',
  plugins: [react()],
  server: {
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:4173',
        ws: true,
      },
    },
  },
})
