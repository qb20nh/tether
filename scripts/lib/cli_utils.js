import fs from 'node:fs';
import path from 'node:path';

export const readRequiredArgValue = (argv, index, arg) => {
  const nextIndex = index + 1;
  if (nextIndex >= argv.length) throw new Error(`Missing value for ${arg}`);
  return {
    nextIndex,
    value: argv[nextIndex],
  };
};

export const parsePositiveInt = (name, value) => {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer, got ${value}`);
  }
  return parsed;
};

export const parseNonNegativeInt = (name, value) => {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error(`${name} must be a non-negative integer, got ${value}`);
  }
  return parsed;
};

export const readJsonFile = (filePath, fallback = undefined) => {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (error) {
    if (fallback !== undefined && error && typeof error === 'object' && error.code === 'ENOENT') {
      return fallback;
    }
    throw error;
  }
};

export const writeJsonFile = (filePath, value) => {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
};
