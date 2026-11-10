import {
  applyAICommand,
  auditLevel,
  computeCrossSection,
  evaluateJumpLink,
  raycastLevel3D,
} from '../src/core/geometry-analysis';
import { createEmptyLevel, createStarterLevel, createTacticalCourtyardLevel, createVerticalRuinsLevel } from '../src/core/presets';
import { AICommandAction, BlockRole, BlockType, LevelDocument, POICategory, Vec2, Vec3 } from '../src/core/types';
import { loadLevelFile, saveLevelViaBridgeOrFile } from './level-io';

async function saveAndSync(doc: LevelDocument, message: string): Promise<void> {
  // A running Bridge writes the file and broadcasts to the web editor; otherwise the file is written directly
  await saveLevelViaBridgeOrFile(doc, message);
}

function parseVec3(str: string | undefined, fallback: Vec3 = [0, 0, 0]): Vec3 {
  if (!str) return fallback;
  const parts = str.split(',').map((s) => Number(s.trim()));
  return [parts[0] || 0, parts[1] || 0, parts[2] || 0];
}

function parseVec2(str: string | undefined, fallback: Vec2 = [0, 0]): Vec2 {
  if (!str) return fallback;
  const parts = str.split(',').map((s) => Number(s.trim()));
  return [parts[0] || 0, parts[1] || 0];
}

function getFlag(args: string[], flag: string): string | undefined {
  const idx = args.indexOf(flag);
  if (idx !== -1 && idx + 1 < args.length) {
    return args[idx + 1];
  }
  return undefined;
}

async function main() {
  const args = process.argv.slice(2);
  const sub = args[0] || 'help';
  if (sub === 'help' || sub === '--help' || sub === '-h') {
    printHelp();
    return;
  }
  const doc = loadLevelFile();

  if (sub === 'status' || sub === 'audit') {
    const audit = auditLevel(doc);
    const cross = computeCrossSection(doc);
    console.log(
      JSON.stringify(
        {
          levelName: doc.metadata.name,
          blockCount: doc.blocks.length,
          poiCount: doc.pois.length,
          pathCount: doc.paths.length,
          jumpCount: doc.jumps.length,
          metricsProfile: doc.metricsProfile,
          sectionPlane: doc.sectionPlane,
          crossSectionSlicedBlocks: cross.items.length,
          audit,
          blocks: doc.blocks.map((b) => ({
            id: b.id,
            name: b.name,
            type: b.type,
            role: b.role,
            floor: b.floor,
            position: b.position,
            size: b.size,
            rotation: b.rotation,
          })),
        },
        null,
        2
      )
    );
    return;
  }

  if (sub === 'add-block') {
    const cmd: AICommandAction = {
      action: 'add_block',
      block: {
        id: getFlag(args, '--id'),
        name: getFlag(args, '--name') || 'AI_Block',
        type: (getFlag(args, '--type') as BlockType) || 'box',
        role: (getFlag(args, '--role') as BlockRole) || 'walkable',
        position: parseVec3(getFlag(args, '--pos'), [0, 0.5, 0]),
        size: parseVec3(getFlag(args, '--size'), [4, 1, 4]),
        rotation: parseVec3(getFlag(args, '--rot'), [0, 0, 0]),
        floor: Number(getFlag(args, '--floor') ?? 0),
        notes: getFlag(args, '--notes'),
        color: getFlag(args, '--color'),
      },
    };
    const res = applyAICommand(doc, cmd);
    await saveAndSync(res.doc, `[CLI] ${res.message}`);
    console.log(JSON.stringify({ ok: true, message: res.message, affectedIds: res.affectedIds }, null, 2));
    return;
  }

  if (sub === 'update-block') {
    const id = getFlag(args, '--id');
    if (!id) {
      console.error('Error: --id <block_id> is required');
      process.exit(1);
    }
    const patch: Record<string, unknown> = {};
    if (getFlag(args, '--name')) patch.name = getFlag(args, '--name');
    if (getFlag(args, '--type')) patch.type = getFlag(args, '--type');
    if (getFlag(args, '--role')) patch.role = getFlag(args, '--role');
    if (getFlag(args, '--pos')) patch.position = parseVec3(getFlag(args, '--pos'));
    if (getFlag(args, '--size')) patch.size = parseVec3(getFlag(args, '--size'));
    if (getFlag(args, '--rot')) patch.rotation = parseVec3(getFlag(args, '--rot'));
    if (getFlag(args, '--floor')) patch.floor = Number(getFlag(args, '--floor'));
    if (getFlag(args, '--notes') !== undefined) patch.notes = getFlag(args, '--notes');
    if (getFlag(args, '--color')) patch.color = getFlag(args, '--color');
    const res = applyAICommand(doc, { action: 'update_block', id, patch });
    await saveAndSync(res.doc, `[CLI] ${res.message}`);
    console.log(JSON.stringify({ ok: true, message: res.message, affectedIds: res.affectedIds }, null, 2));
    return;
  }

  if (sub === 'delete-block') {
    const id = getFlag(args, '--id') || args[1];
    if (!id) {
      console.error('Error: --id <block_id> is required');
      process.exit(1);
    }
    const res = applyAICommand(doc, { action: 'delete_block', id });
    await saveAndSync(res.doc, `[CLI] ${res.message}`);
    console.log(JSON.stringify({ ok: true, message: res.message }, null, 2));
    return;
  }

  if (sub === 'add-poi') {
    const res = applyAICommand(doc, {
      action: 'add_poi',
      poi: {
        name: getFlag(args, '--name') || 'AI_POI',
        category: (getFlag(args, '--category') as POICategory) || 'sniper_nest',
        position: parseVec3(getFlag(args, '--pos'), [0, 0, 0]),
        yaw: Number(getFlag(args, '--yaw') ?? 0),
        fov: Number(getFlag(args, '--fov') ?? 90),
        visionRange: Number(getFlag(args, '--range') ?? 20),
        showVision: getFlag(args, '--vision') !== 'false',
      },
    });
    await saveAndSync(res.doc, `[CLI] ${res.message}`);
    console.log(JSON.stringify({ ok: true, message: res.message, affectedIds: res.affectedIds }, null, 2));
    return;
  }

  if (sub === 'generate-room') {
    const doorsRaw = getFlag(args, '--doors') || 'south';
    const doorways = doorsRaw.split(',').map((s) => s.trim() as 'north' | 'south' | 'east' | 'west');
    const res = applyAICommand(doc, {
      action: 'generate_room',
      name: getFlag(args, '--name') || 'AI房间',
      center: parseVec3(getFlag(args, '--center'), [0, 0, 0]),
      size: parseVec3(getFlag(args, '--size'), [12, 4, 12]),
      floor: Number(getFlag(args, '--floor') ?? 0),
      doorways,
    });
    await saveAndSync(res.doc, `[CLI] ${res.message}`);
    console.log(JSON.stringify({ ok: true, message: res.message, affectedIds: res.affectedIds }, null, 2));
    return;
  }

  if (sub === 'set-section') {
    const start = parseVec2(getFlag(args, '--start'), doc.sectionPlane.start);
    const end = parseVec2(getFlag(args, '--end'), doc.sectionPlane.end);
    const slabDepth = Number(getFlag(args, '--slab') ?? doc.sectionPlane.slabDepth);
    const res = applyAICommand(doc, {
      action: 'set_section',
      section: { start, end, slabDepth },
    });
    await saveAndSync(res.doc, `[CLI] ${res.message}`);
    const cross = computeCrossSection(res.doc);
    console.log(
      JSON.stringify(
        {
          ok: true,
          sectionPlane: res.doc.sectionPlane,
          sectionLength: cross.sectionLength,
          slicedBlocks: cross.items.map((i) => ({
            id: i.block.id,
            name: i.block.name,
            role: i.block.role,
            slopeAngle: i.slopeAngle,
            warning: i.warning,
          })),
        },
        null,
        2
      )
    );
    return;
  }

  if (sub === 'check-jump') {
    const from = parseVec3(getFlag(args, '--from'), [0, 0, 0]);
    const to = parseVec3(getFlag(args, '--to'), [0, 1, -4]);
    const result = evaluateJumpLink(from, to, doc.metricsProfile, doc.blocks);
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  if (sub === 'analyze-los') {
    const from = parseVec3(getFlag(args, '--from'), [0, 1.65, 0]);
    const to = parseVec3(getFlag(args, '--to'), [0, 1.65, -10]);
    const result = raycastLevel3D(from, to, doc.blocks);
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  if (sub === 'exec-json') {
    const raw = getFlag(args, '--json') || args[1];
    if (!raw) {
      console.error('Error: Provide JSON command via --json \'{"action":"..."}\'');
      process.exit(1);
    }
    let parsed: AICommandAction | AICommandAction[];
    try {
      parsed = JSON.parse(raw) as AICommandAction | AICommandAction[];
    } catch (err) {
      console.error(`Error: --json is not valid JSON (${(err as Error).message})`);
      process.exit(1);
    }
    const list = Array.isArray(parsed) ? parsed : [parsed];
    let cur = doc;
    const messages: string[] = [];
    const affectedIds: string[] = [];
    for (const cmd of list) {
      const out = applyAICommand(cur, cmd);
      cur = out.doc;
      messages.push(out.message);
      affectedIds.push(...out.affectedIds);
    }
    await saveAndSync(cur, `[CLI Batch] ${messages.join('; ')}`);
    console.log(JSON.stringify({ ok: true, messages, affectedIds, audit: auditLevel(cur) }, null, 2));
    return;
  }

  if (sub === 'load-preset') {
    const name = getFlag(args, '--template') || args[1] || 'courtyard';
    const next =
      name === 'ruins'
        ? createVerticalRuinsLevel()
        : name === 'starter'
        ? createStarterLevel()
        : name === 'empty'
        ? createEmptyLevel()
        : createTacticalCourtyardLevel();
    await saveAndSync(next, `[CLI] Loaded preset ${name}`);
    console.log(JSON.stringify({ ok: true, loaded: next.metadata.name }, null, 2));
    return;
  }

  console.error(`Unknown command "${sub}".`);
  printHelp();
  process.exitCode = 1;
}

function printHelp(): void {
  console.log(`
LevelForge AI & Designer CLI (Supports Claude Code & OpenAI Codex)
==================================================================
Usage:
  npm run ai -- status
  npm run ai -- add-block --name "二层高台" --type box --role walkable --pos 0,2,-8 --size 10,4,6 --floor 1
  npm run ai -- update-block --id <id> --pos 0,3,-8 --size 12,4,6
  npm run ai -- delete-block --id <id>
  npm run ai -- generate-room --name "Boss房" --center 0,0,-20 --size 16,5,16 --doors south,north
  npm run ai -- add-poi --name "北侧狙击点" --category sniper_nest --pos 0,3,-8 --yaw 180 --fov 80 --range 25
  npm run ai -- set-section --start -15,0 --end 15,0 --slab 10
  npm run ai -- check-jump --from -8,3,-2 --to -4.5,3,-2
  npm run ai -- analyze-los --from 2.5,4.6,-7.8 --to 0,1.6,8
  npm run ai -- exec-json --json '{"action":"scatter_cover","boundsMin":[-6,0,-6],"boundsMax":[6,0,6],"count":5}'
  npm run ai -- load-preset --template courtyard|ruins|starter
`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
