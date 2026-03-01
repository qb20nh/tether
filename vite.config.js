import { defineConfig, loadEnv } from 'vite';

export default defineConfig(({ mode }) => {
    const env = loadEnv(mode, process.cwd(), '');
    const isNativeBuild = (process.env.NATIVE_BUILD ?? env.NATIVE_BUILD) === '1';
    const configuredDailyUrl = (process.env.VITE_DAILY_URL ?? env.VITE_DAILY_URL ?? '').trim();
    const shouldExternalizeDaily = isNativeBuild && configuredDailyUrl.length > 0;

    return {
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
            rollupOptions: {
                // Only externalize daily files when native build has an explicit remote daily URL.
                // If none is configured, keep bundled daily files so native builds still function.
                external: shouldExternalizeDaily ? ['/daily/*'] : []
            }
        }
    };
});
