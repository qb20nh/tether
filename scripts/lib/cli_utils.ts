import fs from 'node:fs';
import path from 'node:path';

interface RequiredArgValueResult {
  nextIndex: number;
  value: string;
}

const isErrnoException = (error: unknown): error is NodeJS.ErrnoException => (
  Boolean(error && typeof error === 'object' && 'code' in error)
);

export const readRequiredArgValue = (
  argv: readonly string[],
  index: number,
  arg: string,
): RequiredArgValueResult => {
  const nextIndex = index + 1;
  if (nextIndex >= argv.length) throw new Error(`Missing value for ${arg}`);
  return {
    nextIndex,
    value: argv[nextIndex],
  };
};

export const parsePositiveInt = (name: string, value: string | number): number => {
  const parsed = Number.parseInt(String(value), 10);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer, got ${value}`);
  }
  return parsed;
};

export const parseNonNegativeInt = (name: string, value: string | number): number => {
  const parsed = Number.parseInt(String(value), 10);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error(`${name} must be a non-negative integer, got ${value}`);
  }
  return parsed;
};

export const readJsonFile = <T>(filePath: string, fallback?: T): T => {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8')) as T;
  } catch (error) {
    if (fallback !== undefined && isErrnoException(error) && error.code === 'ENOENT') {
      return fallback;
    }
    throw error;
  }
};

export const writeJsonFile = (filePath: string, value: unknown): void => {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
};
