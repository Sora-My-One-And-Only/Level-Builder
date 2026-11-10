import chokidar from 'chokidar';
import cors from 'cors';
import express from 'express';
import fs from 'fs';
import http from 'http';
import { WebSocket, WebSocketServer } from 'ws';
import {
  applyAICommand,
  auditLevel,
  computeCrossSection,
  evaluateJumpLink,
  raycastLevel3D,
} from '../src/core/geometry-analysis';
import { createTacticalCourtyardLevel } from '../src/core/presets';
import { AICommandAction, LevelDocument, Vec3 } from '../src/core/types';
import {
  BRIDGE_PORT,
  LEVEL_FILE_PATH,
  loadLevelFile,
  normalizeLevelDocument,
  serializeLevel,
  writeLevelFile,
} from './level-io';

/** Web-editor drags stream a full document per mouse move; coalesce those into one disk write. */
const CLIENT_UPDATE_WRITE_DELAY_MS = 200;

/**
 * The Bridge can read and overwrite the level file, so only pages served from this machine or the
 * local network may talk to it. Requests without an Origin header (CLI, MCP, curl) are not browsers
 * and are allowed. Without this check any website open in the user's browser could reach
 * http://127.0.0.1:4399 and rewrite the level.
 */
function isAllowedOrigin(origin: string | undefined): boolean {
  if (!origin) return true;
  try {
    const { hostname } = new URL(origin);
    return (
      hostname === 'localhost' ||
      hostname === '127.0.0.1' ||
      hostname === '[::1]' ||
      hostname.endsWith('.localhost') ||
      hostname.startsWith('192.168.') ||
      hostname.startsWith('10.') ||
      /^172\.(1[6-9]|2\d|3[01])\./.test(hostname)
    );
  } catch {
    return false;
  }
}

function loadInitialLevel(): LevelDocument {
  try {
    return loadLevelFile();
  } catch (err) {
    // Keep the unreadable file (it may only need a small manual fix) and carry on with the default level.
    const backupPath = `${LEVEL_FILE_PATH}.corrupt-${Date.now()}`;
    try {
      fs.copyFileSync(LEVEL_FILE_PATH, backupPath);
    } catch {
      // nothing to back up
    }
    console.error(`[LevelForge Bridge] ${(err as Error).message}`);
    console.error(`[LevelForge Bridge] Original kept at ${backupPath}; starting from the default level.`);
    const fallback = normalizeLevelDocument(createTacticalCourtyardLevel())!;
    writeLevelFile(fallback);
    return fallback;
  }
}

let currentDoc: LevelDocument = loadInitialLevel();
/** Exact text of our last write: lets the file watcher tell our own writes from external edits. */
let lastWrittenText = serializeLevel(currentDoc);
let pendingWriteTimer: NodeJS.Timeout | null = null;

function flushPendingWrite(): void {
  if (!pendingWriteTimer) return;
  clearTimeout(pendingWriteTimer);
  pendingWriteTimer = null;
  lastWrittenText = writeLevelFile(currentDoc);
}

function saveLevelNow(doc: LevelDocument): void {
  if (pendingWriteTimer) {
    clearTimeout(pendingWriteTimer);
    pendingWriteTimer = null;
  }
  currentDoc = doc;
  lastWrittenText = writeLevelFile(doc);
}

function saveLevelDeferred(doc: LevelDocument): void {
  currentDoc = doc;
  if (pendingWriteTimer) return;
  pendingWriteTimer = setTimeout(() => {
    pendingWriteTimer = null;
    lastWrittenText = writeLevelFile(currentDoc);
  }, CLIENT_UPDATE_WRITE_DELAY_MS);
}

const app = express();
app.use(cors({ origin: (origin, cb) => cb(null, isAllowedOrigin(origin)) }));
app.use((req, res, next) => {
  if (!isAllowedOrigin(req.headers.origin)) {
    res.status(403).json({ error: 'Origin not allowed' });
    return;
  }
  next();
});
app.use(express.json({ limit: '10mb' }));

const server = http.createServer(app);
const wss = new WebSocketServer({
  server,
  path: '/ws',
  verifyClient: (info: { origin?: string }) => isAllowedOrigin(info.origin),
});

function broadcastLevel(message?: string, excludeWs?: WebSocket): void {
  const payload = JSON.stringify({
    type: 'level_updated',
    doc: currentDoc,
    message,
  });
  for (const client of wss.clients) {
    if (client !== excludeWs && client.readyState === WebSocket.OPEN) {
      client.send(payload);
    }
  }
}

wss.on('connection', (ws) => {
  ws.on('message', (raw) => {
    try {
      const msg = JSON.parse(String(raw));
      if (msg.type !== 'client_update') return;
      const doc = normalizeLevelDocument(msg.doc);
      if (!doc) return;
      saveLevelDeferred(doc);
      broadcastLevel('Web 视口编辑同步', ws);
    } catch {
      // ignore invalid message
    }
  });
});

// Watch `levels/current.level.json` so direct edits by Claude Code / Codex or CLI immediately push to browser
chokidar
  .watch(LEVEL_FILE_PATH, { ignoreInitial: true, awaitWriteFinish: { stabilityThreshold: 80, pollInterval: 20 } })
  .on('all', (event) => {
    if (event !== 'change' && event !== 'add') return;
    try {
      const raw = fs.readFileSync(LEVEL_FILE_PATH, 'utf-8');
      if (raw === lastWrittenText) return; // our own write
      const parsed = normalizeLevelDocument(JSON.parse(raw));
      if (!parsed) return;
      // An external edit wins over a not-yet-flushed web edit
      if (pendingWriteTimer) {
        clearTimeout(pendingWriteTimer);
        pendingWriteTimer = null;
      }
      currentDoc = parsed;
      lastWrittenText = raw;
      broadcastLevel('检测到 levels/current.level.json 外部 AI 修改，已自动热更新');
    } catch {
      // ignore partial file write
    }
  });

function isVec3(v: unknown): v is Vec3 {
  return Array.isArray(v) && v.length >= 3 && v.slice(0, 3).every((n) => typeof n === 'number' && Number.isFinite(n));
}

// REST API for Claude / Codex / Scripts
app.get('/api/level', (_req, res) => {
  const audit = auditLevel(currentDoc);
  const cross = computeCrossSection(currentDoc);
  res.json({
    doc: currentDoc,
    audit,
    crossSection: {
      sectionLength: cross.sectionLength,
      slicedBlockCount: cross.items.length,
      slicedBlocks: cross.items.map((i) => ({
        id: i.block.id,
        name: i.block.name,
        role: i.block.role,
        slopeAngle: i.slopeAngle,
        warning: i.warning,
      })),
    },
  });
});

app.put('/api/level', (req, res) => {
  const doc = normalizeLevelDocument(req.body?.doc);
  if (!doc) {
    res.status(400).json({ error: 'Invalid LevelDocument payload: expected { doc: { blocks: [...] } }' });
    return;
  }
  saveLevelNow(doc);
  broadcastLevel(typeof req.body.message === 'string' ? req.body.message : 'PUT /api/level 全量更新');
  res.json({ ok: true, audit: auditLevel(currentDoc) });
});

app.post('/api/command', (req, res) => {
  const body = req.body;
  const rawList: unknown = Array.isArray(body) ? body : Array.isArray(body?.command) ? body.command : body?.command ?? body;
  const commands = (Array.isArray(rawList) ? rawList : [rawList]).filter(
    (c): c is AICommandAction => Boolean(c) && typeof c === 'object' && typeof (c as { action?: unknown }).action === 'string'
  );
  if (commands.length === 0) {
    res.status(400).json({ error: 'Provide a command object (or array) with an "action" field' });
    return;
  }

  const messages: string[] = [];
  const affectedIds: string[] = [];
  let nextDoc = currentDoc;

  for (const cmd of commands) {
    const out = applyAICommand(nextDoc, cmd);
    nextDoc = out.doc;
    messages.push(out.message);
    affectedIds.push(...out.affectedIds);
  }

  saveLevelNow(nextDoc);
  broadcastLevel(messages.join(' | '));

  res.json({
    ok: true,
    messages,
    affectedIds,
    audit: auditLevel(currentDoc),
  });
});

app.post('/api/analyze-los', (req, res) => {
  const { from, to } = (req.body || {}) as { from?: unknown; to?: unknown };
  if (!isVec3(from) || !isVec3(to)) {
    res.status(400).json({ error: 'Provide from: [x,y,z] and to: [x,y,z]' });
    return;
  }
  res.json(raycastLevel3D(from, to, currentDoc.blocks));
});

app.post('/api/check-jump', (req, res) => {
  const { from, to } = (req.body || {}) as { from?: unknown; to?: unknown };
  if (!isVec3(from) || !isVec3(to)) {
    res.status(400).json({ error: 'Provide from: [x,y,z] and to: [x,y,z]' });
    return;
  }
  res.json(evaluateJumpLink(from, to, currentDoc.metricsProfile, currentDoc.blocks));
});

// Malformed JSON bodies and any unexpected handler error come back as JSON, not an HTML stack trace
app.use((err: Error & { status?: number }, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  res.status(err.status && err.status >= 400 ? err.status : 500).json({ error: err.message });
});

server.on('error', (err: NodeJS.ErrnoException) => {
  if (err.code === 'EADDRINUSE') {
    console.error(
      `[LevelForge Bridge] Port ${BRIDGE_PORT} is already in use — another Bridge is probably running. ` +
        `Stop it, or set LEVELFORGE_PORT to a different port.`
    );
  } else {
    console.error('[LevelForge Bridge]', err);
  }
  process.exit(1);
});

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    flushPendingWrite();
    process.exit(0);
  });
}

server.listen(BRIDGE_PORT, '127.0.0.1', () => {
  console.log(`[LevelForge Bridge] Listening on http://127.0.0.1:${BRIDGE_PORT}`);
  console.log(`[LevelForge Bridge] Watching file: ${LEVEL_FILE_PATH}`);
});
