import react from '@vitejs/plugin-react';
import {defineConfig} from 'vite';

export default defineConfig({
    plugins: [react()],
    server: {
        port: 5173,
    },
    define: {
        'global': 'globalThis',
    },
    optimizeDeps: {
        exclude: [
            '@aws-sdk/client-s3',
            '@aws-sdk/credential-provider-cognito-identity',
        ],
        esbuildOptions: {
            target: 'esnext',
        },
    },
    build: {
        target: 'esnext',
    },
});
