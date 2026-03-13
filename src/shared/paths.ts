export const DAILY_DIR = 'daily';
export const DAILY_PAYLOAD_FILE = `${DAILY_DIR}/today.json`;
export const DAILY_HISTORY_FILE = `${DAILY_DIR}/history.json`;

export const PUBLIC_DAILY_PAYLOAD_REPO_FILE = `public/${DAILY_PAYLOAD_FILE}`;
export const PUBLIC_DAILY_HISTORY_REPO_FILE = `public/${DAILY_HISTORY_FILE}`;

export const GENERATED_DIR = 'src/generated';
export const DAILY_POOL_MANIFEST_REPO_FILE = `${GENERATED_DIR}/daily_pool_manifest.json`;
export const DAILY_OVERRIDES_REPO_FILE = `${GENERATED_DIR}/daily_overrides.bin.gz`;
export const INFINITE_OVERRIDES_REPO_FILE = `${GENERATED_DIR}/infinite_overrides.bin.gz`;
export const INFINITE_OVERRIDES_MODULE_FILE = './generated/infinite_overrides.bin.gz';

export const BUILD_IDENTITY_IGNORED_REPO_FILES = Object.freeze([
  PUBLIC_DAILY_PAYLOAD_REPO_FILE,
  PUBLIC_DAILY_HISTORY_REPO_FILE,
]) as readonly string[];
