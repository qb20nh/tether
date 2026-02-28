import { defineConfig } from 'vite';

export default defineConfig({
    // Base configuration suitable for most native wrappers
    base: './', // Use relative paths for assets so they work in Capacitor/Tauri
    build: {
        minify: 'terser',
        terserOptions: {
            compress: {
                drop_console: true, // Remove console output in production
            },
        },
        // Prevent Vite from trying to inline large assets which might break some wrappers
        assetsInlineLimit: 0,
    }
});
