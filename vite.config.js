import path from 'node:path';
import { readFile, writeFile } from 'node:fs/promises';
import { defineConfig, loadEnv } from 'vite';
import { DAILY_PAYLOAD_FILE } from './src/shared/paths.js';

const BUILD_NUMBER_META_NAME = 'tether-build-number';
const BUILD_LABEL_META_NAME = 'tether-build-label';
const SW_BUILD_NUMBER_PLACEHOLDER = '__TETHER_BUILD_NUMBER__';
const SW_BUILD_LABEL_PLACEHOLDER = '__TETHER_BUILD_LABEL__';
const SW_DAILY_PAYLOAD_PATH_PLACEHOLDER = '__TETHER_DAILY_PAYLOAD_PATH__';

const resolveBuildNumber = (env) => {
    const configuredRaw = (process.env.VITE_BUILD_NUMBER ?? env.VITE_BUILD_NUMBER ?? '').trim();
    if (configuredRaw.length > 0) {
        const parsed = Number.parseInt(configuredRaw, 10);
        if (!Number.isInteger(parsed) || parsed <= 0) {
            throw new Error(`Invalid VITE_BUILD_NUMBER: ${configuredRaw}`);
        }
        return parsed;
    }

    return Date.now();
};

const resolveDailyPayloadPathname = (env) => {
    const fallback = `/${DAILY_PAYLOAD_FILE}`.replace(/\/{2,}/g, '/');
    const configuredRaw = (process.env.VITE_DAILY_URL ?? env.VITE_DAILY_URL ?? '').trim();
    if (configuredRaw.length === 0) return fallback;
    try {
        const parsed = new URL(configuredRaw, 'http://localhost/');
        return parsed.pathname || fallback;
    } catch {
        return fallback;
    }
};

const buildVersionPlugin = ({ buildNumber, buildLabel, dailyPayloadPathname }) => ({
    name: 'tether-build-version',
    transformIndexHtml: () => ({
        tags: [
            {
                tag: 'meta',
                attrs: {
                    name: BUILD_NUMBER_META_NAME,
                    content: String(buildNumber),
                },
                injectTo: 'head',
            },
            {
                tag: 'meta',
                attrs: {
                    name: BUILD_LABEL_META_NAME,
                    content: buildLabel,
                },
                injectTo: 'head',
            },
        ],
    }),
    generateBundle() {
        this.emitFile({
            type: 'asset',
            fileName: 'version.json',
            source: `${JSON.stringify({ buildNumber, buildLabel }, null, 2)}\n`,
        });
    },
    async writeBundle(outputOptions) {
        const outDir = outputOptions?.dir
            ? path.resolve(outputOptions.dir)
            : path.resolve(process.cwd(), 'dist');
        const serviceWorkerFile = path.join(outDir, 'sw.js');

        let source = null;
        try {
            source = await readFile(serviceWorkerFile, 'utf8');
        } catch (error) {
            if (error && typeof error === 'object' && error.code === 'ENOENT') return;
            throw error;
        }

        const replaced = source
            .replaceAll(SW_BUILD_NUMBER_PLACEHOLDER, String(buildNumber))
            .replaceAll(SW_BUILD_LABEL_PLACEHOLDER, buildLabel)
            .replaceAll(SW_DAILY_PAYLOAD_PATH_PLACEHOLDER, dailyPayloadPathname);
        await writeFile(serviceWorkerFile, replaced, 'utf8');
    },
});

export default defineConfig(({ mode }) => {
    const env = loadEnv(mode, process.cwd(), '');
    const buildNumber = resolveBuildNumber(env);
    const buildLabel = (process.env.VITE_BUILD_LABEL ?? env.VITE_BUILD_LABEL ?? '').trim()
        || new Date(buildNumber).toISOString();
    const dailyPayloadPathname = resolveDailyPayloadPathname(env);
    const isNativeBuild = (process.env.NATIVE_BUILD ?? env.NATIVE_BUILD) === '1';
    const configuredDailyUrl = (process.env.VITE_DAILY_URL ?? env.VITE_DAILY_URL ?? '').trim();
    const shouldExternalizeDaily = isNativeBuild && configuredDailyUrl.length > 0;

    return {
        plugins: [
            buildVersionPlugin({ buildNumber, buildLabel, dailyPayloadPathname }),
        ],
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
