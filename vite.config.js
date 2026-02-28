import { defineConfig } from 'vite';

export default defineConfig(({ mode }) => {
    // Determine if this is a native build (Capacitor/Tauri) which requires absolute URLs
    // for resources that change daily, since native apps shouldn't ship with static day-old state.
    const isNativeBuild = process.env.NATIVE_BUILD === '1';
    // Fallback to the production GitHub pages URL if NATIVE_BUILD is true
    const dailyUrl = isNativeBuild ? 'https://qb20nh.github.io/tether/daily/today.json' : './daily/today.json';

    return {
        // Base configuration suitable for most native wrappers
        base: './', // Use relative paths for assets so they work in Capacitor/Tauri
        define: {
            'import.meta.env.VITE_DAILY_URL': JSON.stringify(dailyUrl),
        },
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
                // For native builds, we don't want to copy the daily files to dist
                // because we're fetching from network.
                external: isNativeBuild ? ['/daily/*'] : []
            }
        }
    };
});
