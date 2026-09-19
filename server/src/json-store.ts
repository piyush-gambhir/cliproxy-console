import fs from 'node:fs/promises';
import path from 'node:path';

/** Read a JSON file, returning `fallback` when it does not exist. Corrupt files throw. */
export async function readJsonFile<T>(file: string, fallback: T): Promise<T> {
  let raw: string;
  try {
    raw = await fs.readFile(file, 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return fallback;
    throw err;
  }
  if (raw.trim() === '') return fallback;
  return JSON.parse(raw) as T;
}

/** Write JSON atomically: temp file in the same directory, then rename. */
export async function writeJsonFile(file: string, value: unknown): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp-${process.pid}-${Date.now()}`;
  await fs.writeFile(tmp, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  await fs.rename(tmp, file);
}
