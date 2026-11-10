/**
 * Shared level-file IO for the Bridge server, the CLI and the MCP server.
 * One place for the file path, the bridge address, document validation and atomic writes.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { normalizeLevelDocument } from '../src/core/document';
import { createTacticalCourtyardLevel } from '../src/core/presets';
import { LevelDocument } from '../src/core/types';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/** `LEVELFORGE_LEVEL_FILE` points the tools at another level file (used for tests and side projects). */
export const LEVEL_FILE_PATH = process.env.LEVELFORGE_LEVEL_FILE
  ? path.resolve(process.env.LEVELFORGE_LEVEL_FILE)
  : path.resolve(__dirname, '../levels/current.level.json');
export const BRIDGE_PORT = Number(process.env.LEVELFORGE_PORT || 4399);
export const BRIDGE_URL = `http://127.0.0.1:${BRIDGE_PORT}`;

export { normalizeLevelDocument };

export function serializeLevel(doc: LevelDocument): string {
  return JSON.stringify(doc, null, 2);
}

/**
 * Write via a temp file + rename so a watcher (or another tool reading at the same moment)
 * never observes a half-written JSON file. Returns the exact text written.
 */
export function writeLevelFile(doc: LevelDocument): string {
  const dir = path.dirname(LEVEL_FILE_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const text = serializeLevel(doc);
  const tmpPath = `${LEVEL_FILE_PATH}.${process.pid}.tmp`;
  fs.writeFileSync(tmpPath, text, 'utf-8');
  try {
    fs.renameSync(tmpPath, LEVEL_FILE_PATH);
  } catch {
    // Some Windows setups refuse to rename over a file that is open elsewhere: fall back to a direct write.
    fs.writeFileSync(LEVEL_FILE_PATH, text, 'utf-8');
    fs.rmSync(tmpPath, { force: true });
  }
  return text;
}

/**
 * Load the level file, creating the default level when it does not exist.
 * A file that exists but cannot be parsed is an error: it is never silently replaced,
 * because it may hold work that only needs a small manual fix.
 */
export function loadLevelFile(): LevelDocument {
  if (!fs.existsSync(LEVEL_FILE_PATH)) {
    const initial = normalizeLevelDocument(createTacticalCourtyardLevel())!;
    writeLevelFile(initial);
    return initial;
  }
  const raw = fs.readFileSync(LEVEL_FILE_PATH, 'utf-8');
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error(`${LEVEL_FILE_PATH} is not valid JSON (${(err as Error).message}). Fix or delete the file.`);
  }
  const doc = normalizeLevelDocument(parsed);
  if (!doc) {
    throw new Error(`${LEVEL_FILE_PATH} is not a LevelDocument (missing "blocks" array). Fix or delete the file.`);
  }
  return doc;
}

/**
 * Save a level produced by the CLI / MCP server. A running Bridge is the single writer
 * (it writes the file and broadcasts to the web editor in one step); only when no Bridge
 * answers do we write the file ourselves.
 */
export async function saveLevelViaBridgeOrFile(doc: LevelDocument, message: string): Promise<'bridge' | 'file'> {
  try {
    const res = await fetch(`${BRIDGE_URL}/api/level`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ doc, message }),
      signal: AbortSignal.timeout(3000),
    });
    if (res.ok) return 'bridge';
  } catch {
    // Bridge not running: fall through to a direct file write
  }
  writeLevelFile(doc);
  return 'file';
}
