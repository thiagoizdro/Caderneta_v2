import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
    plugins: [
        react(),
        VitePWA({
            registerType: 'prompt',
            includeAssets: ['icons/apple-touch-icon.png'],
            manifest: {
                name: 'Caderneta — Controle Financeiro',
                short_name: 'Caderneta',
                description: 'Seu caderno de finanças: diárias, salário, contas, cartões, metas e previsões. Funciona offline.',
                lang: 'pt-BR',
                start_url: '/',
                scope: '/',
                display: 'standalone',
                background_color: '#E7E1D2',
                theme_color: '#233A2E',
                icons: [
                    { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
                    { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
                    { src: 'icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
                ],
                shortcuts: [
                    { name: 'Novo lançamento', url: '/#/lancamentos?novo=1' },
                    { name: 'Calendário', url: '/#/calendario' },
                ],
            },
            workbox: {
                globPatterns: ['**/*.{js,css,html,png,svg,woff2}'],
                navigateFallbackDenylist: [/^\/api\//],
                runtimeCaching: [
                    {
                        urlPattern: ({ url }) => url.origin === 'https://fonts.googleapis.com' || url.origin === 'https://fonts.gstatic.com',
                        handler: 'StaleWhileRevalidate',
                        options: { cacheName: 'google-fonts', expiration: { maxEntries: 20 } },
                    },
                ],
            },
        }),
    ],
    server: {
        port: 5173,
        proxy: { '/api': 'http://localhost:3001' },
    },
    build: {
        chunkSizeWarningLimit: 900,
    },
});
