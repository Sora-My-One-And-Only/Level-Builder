import readline from 'readline';
import {
  applyAICommand,
  auditLevel,
  computeCrossSection,
  evaluateJumpLink,
  raycastLevel3D,
} from '../src/core/geometry-analysis';
import { AICommandAction, Vec3 } from '../src/core/types';
import { loadLevelFile, saveLevelViaBridgeOrFile } from './level-io';

const loadLevel = loadLevelFile;
const saveLevel = saveLevelViaBridgeOrFile;

function isVec3(v: unknown): v is Vec3 {
  return Array.isArray(v) && v.length >= 3 && v.slice(0, 3).every((n) => typeof n === 'number' && Number.isFinite(n));
}

/** A tool-level failure: reported inside the tool result so the calling model can read and correct it */
function toolError(id: number | string | null, message: string): void {
  sendResponse(id, { content: [{ type: 'text', text: message }], isError: true });
}

const TOOLS = [
  {
    name: 'get_level_summary',
    description:
      'Get the current LevelForge greybox level document, block list, character metrics, cross-section slice summary, and automated level design audit report.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'execute_level_command',
    description:
      'Execute one or more LevelForge commands (add_block, update_block, delete_block, add_poi, generate_room, scatter_cover, mirror_blocks, set_section, update_metrics) and immediately sync to the 2D/3D web editor.',
    inputSchema: {
      type: 'object',
      properties: {
        commands: {
          type: 'array',
          description: 'Array of AICommandAction objects to execute sequentially',
          items: { type: 'object' },
        },
      },
      required: ['commands'],
    },
  },
  {
    name: 'check_jump_reachability',
    description:
      'Evaluate whether a player jump from 3D point A to 3D point B is safe, stretch, requires double-jump, blocked by geometry, or impossible under the current character metrics.',
    inputSchema: {
      type: 'object',
      properties: {
        from: { type: 'array', items: { type: 'number' }, description: '[x, y, z] takeoff coordinates in meters' },
        to: { type: 'array', items: { type: 'number' }, description: '[x, y, z] landing coordinates in meters' },
      },
      required: ['from', 'to'],
    },
  },
  {
    name: 'analyze_sightline',
    description:
      'Perform a 3D Line-of-Sight (LOS) raycast between two 3D points (e.g. sniper nest to cover position) to check if sightline is clear or blocked by any greybox geometry.',
    inputSchema: {
      type: 'object',
      properties: {
        from: { type: 'array', items: { type: 'number' }, description: '[x, y, z] observer eye coordinates' },
        to: { type: 'array', items: { type: 'number' }, description: '[x, y, z] target coordinates' },
      },
      required: ['from', 'to'],
    },
  },
];

function sendResponse(id: number | string | null, result: unknown): void {
  process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id, result }) + '\n');
}

function sendError(id: number | string | null, code: number, message: string): void {
  process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id, error: { code, message } }) + '\n');
}

const rl = readline.createInterface({ input: process.stdin, terminal: false });

rl.on('line', async (line) => {
  if (!line.trim()) return;
  let req: { id?: number | string | null; method?: string; params?: { name?: string; arguments?: Record<string, unknown> } };
  try {
    req = JSON.parse(line);
  } catch (err) {
    sendError(null, -32700, `Parse error: ${(err as Error).message}`);
    return;
  }
  const { method, params } = req;
  const id = req.id ?? null;
  const isNotification = req.id === undefined;
  try {

    if (method === 'initialize') {
      sendResponse(id, {
        protocolVersion: '2024-11-05',
        capabilities: { tools: {} },
        serverInfo: { name: 'levelforge-mcp', version: '1.0.0' },
      });
      return;
    }

    if (isNotification) {
      // Notifications (notifications/initialized, cancelled, ...) never get a response
      return;
    }

    if (method === 'ping') {
      sendResponse(id, {});
      return;
    }

    if (method === 'tools/list') {
      sendResponse(id, { tools: TOOLS });
      return;
    }

    if (method === 'tools/call') {
      const toolName = params?.name;
      const args = params?.arguments || {};
      const doc = loadLevel();

      if (toolName === 'get_level_summary') {
        const audit = auditLevel(doc);
        const cross = computeCrossSection(doc);
        sendResponse(id, {
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                {
                  metadata: doc.metadata,
                  metricsProfile: doc.metricsProfile,
                  sectionPlane: doc.sectionPlane,
                  crossSectionSummary: {
                    sectionLength: cross.sectionLength,
                    slicedBlocks: cross.items.map((i) => ({
                      id: i.block.id,
                      name: i.block.name,
                      role: i.block.role,
                      slopeAngle: i.slopeAngle,
                      warning: i.warning,
                    })),
                  },
                  audit,
                  blocks: doc.blocks,
                  pois: doc.pois,
                  paths: doc.paths,
                  jumps: doc.jumps,
                },
                null,
                2
              ),
            },
          ],
        });
        return;
      }

      if (toolName === 'execute_level_command') {
        const rawCommands = Array.isArray(args.commands) ? args.commands : [args.commands];
        const commands = rawCommands.filter(
          (c): c is AICommandAction => Boolean(c) && typeof c === 'object' && typeof (c as { action?: unknown }).action === 'string'
        );
        if (commands.length === 0) {
          toolError(id, 'Provide "commands": an array of objects, each with an "action" field.');
          return;
        }
        let nextDoc = doc;
        const messages: string[] = [];
        const affectedIds: string[] = [];
        for (const cmd of commands) {
          const res = applyAICommand(nextDoc, cmd);
          nextDoc = res.doc;
          messages.push(res.message);
          affectedIds.push(...res.affectedIds);
        }
        await saveLevel(nextDoc, `[MCP] ${messages.join(' | ')}`);
        sendResponse(id, {
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                {
                  ok: true,
                  messages,
                  affectedIds,
                  audit: auditLevel(nextDoc),
                },
                null,
                2
              ),
            },
          ],
        });
        return;
      }

      if (toolName === 'check_jump_reachability') {
        if (!isVec3(args.from) || !isVec3(args.to)) {
          toolError(id, 'Provide "from" and "to" as [x, y, z] number arrays.');
          return;
        }
        const res = evaluateJumpLink(args.from, args.to, doc.metricsProfile, doc.blocks);
        sendResponse(id, {
          content: [{ type: 'text', text: JSON.stringify(res, null, 2) }],
        });
        return;
      }

      if (toolName === 'analyze_sightline') {
        if (!isVec3(args.from) || !isVec3(args.to)) {
          toolError(id, 'Provide "from" and "to" as [x, y, z] number arrays.');
          return;
        }
        const res = raycastLevel3D(args.from, args.to, doc.blocks);
        sendResponse(id, {
          content: [{ type: 'text', text: JSON.stringify(res, null, 2) }],
        });
        return;
      }

      sendError(id, -32601, `Unknown tool: ${toolName}`);
      return;
    }

    sendError(id, -32601, `Method not found: ${method}`);
  } catch (err) {
    // Answer with the request's own id so the client is never left waiting on a call that failed here
    if (isNotification) return;
    if (method === 'tools/call') toolError(id, `Tool failed: ${(err as Error).message}`);
    else sendError(id, -32603, (err as Error).message);
  }
});
