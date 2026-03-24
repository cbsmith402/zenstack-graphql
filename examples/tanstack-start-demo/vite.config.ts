import { defineConfig } from 'vite';
import { tanstackStart } from '@tanstack/react-start/plugin/vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
    server: {
        port: 4003,
    },
    plugins: [
        tanstackStart(),
        react(),
    ],
});
