import {
  AICommandAction,
  AuditIssue,
  BlockRole,
  BlockType,
  CrossSectionSliceItem,
  FlowPathType,
  JumpEvaluation,
  LevelAuditSummary,
  LevelBlock,
  LevelDocument,
  LevelPOI,
  MetricsProfile,
  PacingBeatPoint,
  POICategory,
  SightlineLink,
  Vec2,
  Vec3,
} from './types';

export const ROLE_META: Record<
  BlockRole,
  { label: string; color: string; fillAlpha: number; solid: boolean; walkable: boolean }
> = {
  walkable: { label: '可行走地面 (Walkable)', color: '#4b5563', fillAlpha: 0.75, solid: true, walkable: true },
  one_way_platform: { label: '单向穿透跳台 (One-Way)', color: '#14b8a6', fillAlpha: 0.78, solid: true, walkable: true },
  wall: { label: '阻挡墙体 (Wall)', color: '#64748b', fillAlpha: 0.9, solid: true, walkable: false },
  cover_low: { label: '半身掩体 (Low Cover)', color: '#d97706', fillAlpha: 0.85, solid: true, walkable: false },
  cover_full: { label: '全身掩体 (Full Cover)', color: '#ea580c', fillAlpha: 0.9, solid: true, walkable: false },
  climbable: { label: '攀爬结构 (Climbable)', color: '#10b981', fillAlpha: 0.85, solid: true, walkable: true },
  hazard: { label: '危险区/死坑 (Hazard)', color: '#ef4444', fillAlpha: 0.65, solid: false, walkable: false },
  trigger_combat: { label: '战斗触发区 (Combat Zone)', color: '#a855f7', fillAlpha: 0.28, solid: false, walkable: false },
  trigger_puzzle: { label: '机关/解谜区 (Puzzle Zone)', color: '#06b6d4', fillAlpha: 0.28, solid: false, walkable: false },
  water: { label: '水体/减速区 (Water)', color: '#3b82f6', fillAlpha: 0.45, solid: false, walkable: true },
  objective: { label: '核心目标物 (Objective)', color: '#eab308', fillAlpha: 0.9, solid: true, walkable: false },
};

export const DESIGN_TAG_PRESETS: { tag: string; icon: string; color: string; defaultNote: string }[] = [
  { tag: '视线阻断 (LOS Blocker)', icon: '🙈', color: '#f97316', defaultNote: '故意打断远端火力或视线，强迫玩家变更站位或推进路线。' },
  { tag: '视觉引导地标 (Landmark)', icon: '🗼', color: '#38bdf8', defaultNote: '高耸或高亮视觉锚点 (Weenie)，在玩家进入房间第一时间吸引视线并指明大方向。' },
  { tag: '安全喘息区 (Safe Breather)', icon: '🛡️', color: '#22c55e', defaultNote: '战前观察或战后恢复的安全掩体盲区，让玩家整备并观察下一波敌情。' },
  { tag: '交叉火力区 (Killzone)', icon: '⚔️', color: '#ef4444', defaultNote: '高风险交火核心区，受多方向敌人视野覆盖，不可久留，鼓励快速机动通过。' },
  { tag: '侧翼包抄道 (Flank Route)', icon: '↪️', color: '#06b6d4', defaultNote: '供潜行或高机动玩家绕后突袭敌方高台/重火力的次级战术通道。' },
  { tag: '跳跃能力校验 (Jump Gate)', icon: '⤴️', color: '#eab308', defaultNote: '校验玩家助跑跳/二段跳能力的平台间距，构成探索权限锁或操作挑战。' },
  { tag: '单向回环捷径 (Shortcut)', icon: '🔓', color: '#fb7185', defaultNote: '魂系/银河城经典单向门或升降梯，只能从终点侧打开以连通初始篝火/存档点。' },
  { tag: '风险收益奖励 (Risk-Reward)', icon: '💎', color: '#a855f7', defaultNote: '偏离主线的危险平台或守卫重地，通过高难度挑战奖励稀有补给或宝箱。' },
  { tag: '机关解谜核心 (Mechanism)', icon: '⚙️', color: '#14b8a6', defaultNote: '触发式机关/钥匙开关，交互后改变场景拓扑（如升起断桥、开启锁闭大门）。' },
];

export const POI_META: Record<POICategory, { label: string; icon: string; color: string }> = {
  spawn_player: { label: '玩家出生点 (Spawn)', icon: 'P', color: '#22c55e' },
  spawn_enemy: { label: '敌人巡逻/刷新点 (Enemy)', icon: 'E', color: '#ef4444' },
  sniper_nest: { label: '狙击/高台观察点 (Sniper)', icon: 'S', color: '#f97316' },
  boss: { label: 'Boss 战核心 (Boss)', icon: 'B', color: '#dc2626' },
  objective: { label: '任务目标点 (Objective)', icon: '★', color: '#eab308' },
  checkpoint: { label: '存档检查点 (Checkpoint)', icon: 'C', color: '#38bdf8' },
  loot: { label: '宝箱/补给点 (Loot)', icon: 'L', color: '#a855f7' },
  key: { label: '钥匙/机关开关 (Key/Switch)', icon: 'K', color: '#facc15' },
  locked_door: { label: '单向门/锁闭门 (Gate)', icon: 'D', color: '#fb7185' },
  vantage_point: { label: '视觉引导点/Vista (Vantage)', icon: 'V', color: '#2dd4bf' },
  note: { label: '设计批注 (Design Note)', icon: 'i', color: '#94a3b8' },
};

export const FLOW_META: Record<FlowPathType, { label: string; color: string; dash: number[] }> = {
  main: { label: '主线动线 (Golden Path)', color: '#facc15', dash: [] },
  flank: { label: '侧翼包抄线 (Flank Route)', color: '#38bdf8', dash: [8, 5] },
  secret: { label: '隐藏/捷径路线 (Secret)', color: '#c084fc', dash: [4, 4] },
  patrol: { label: 'AI 巡逻路线 (Patrol)', color: '#f87171', dash: [6, 4] },
  sightline: { label: '关键视线轴 (Sightline)', color: '#4ade80', dash: [2, 4] },
};

const DEG2RAD = Math.PI / 180;
const RAD2DEG = 180 / Math.PI;

export function localToWorldPoint(local: Vec3, pos: Vec3, rotDeg: Vec3): Vec3 {
  // 绝大多数白盒体块没有旋转：直接平移，省掉 6 次三角函数
  if (rotDeg[0] === 0 && rotDeg[1] === 0 && rotDeg[2] === 0) {
    return [local[0] + pos[0], local[1] + pos[1], local[2] + pos[2]];
  }
  const [rx, ry, rz] = [rotDeg[0] * DEG2RAD, rotDeg[1] * DEG2RAD, rotDeg[2] * DEG2RAD];
  const [x, y, z] = local;
  const cx = Math.cos(rx), sx = Math.sin(rx);
  const cy = Math.cos(ry), sy = Math.sin(ry);
  const cz = Math.cos(rz), sz = Math.sin(rz);

  const x1 = x * cz - y * sz;
  const y1 = x * sz + y * cz;
  const z1 = z;

  const x2 = x1 * cy + z1 * sy;
  const y2 = y1;
  const z2 = -x1 * sy + z1 * cy;

  const x3 = x2;
  const y3 = y2 * cx - z2 * sx;
  const z3 = y2 * sx + z2 * cx;

  return [x3 + pos[0], y3 + pos[1], z3 + pos[2]];
}

export function worldToLocalPoint(world: Vec3, pos: Vec3, rotDeg: Vec3): Vec3 {
  if (rotDeg[0] === 0 && rotDeg[1] === 0 && rotDeg[2] === 0) {
    return [world[0] - pos[0], world[1] - pos[1], world[2] - pos[2]];
  }
  const [rx, ry, rz] = [-rotDeg[0] * DEG2RAD, -rotDeg[1] * DEG2RAD, -rotDeg[2] * DEG2RAD];
  const dx = world[0] - pos[0];
  const dy = world[1] - pos[1];
  const dz = world[2] - pos[2];

  const cx = Math.cos(rx), sx = Math.sin(rx);
  const cy = Math.cos(ry), sy = Math.sin(ry);
  const cz = Math.cos(rz), sz = Math.sin(rz);

  const x1 = dx;
  const y1 = dy * cx - dz * sx;
  const z1 = dy * sx + dz * cx;

  const x2 = x1 * cy + z1 * sy;
  const y2 = y1;
  const z2 = -x1 * sy + z1 * cy;

  const x3 = x2 * cz - y2 * sz;
  const y3 = x2 * sz + y2 * cz;
  const z3 = z2;

  return [x3, y3, z3];
}

export interface Triangle3D {
  a: Vec3;
  b: Vec3;
  c: Vec3;
}

function makeBoxTrianglesLocal(min: Vec3, max: Vec3): Triangle3D[] {
  const [x0, y0, z0] = min;
  const [x1, y1, z1] = max;
  const v: Vec3[] = [
    [x0, y0, z0],
    [x1, y0, z0],
    [x1, y1, z0],
    [x0, y1, z0],
    [x0, y0, z1],
    [x1, y0, z1],
    [x1, y1, z1],
    [x0, y1, z1],
  ];
  const idx: [number, number, number][] = [
    [0, 2, 1], [0, 3, 2],
    [4, 5, 6], [4, 6, 7],
    [0, 4, 7], [0, 7, 3],
    [1, 2, 6], [1, 6, 5],
    [3, 7, 6], [3, 6, 2],
    [0, 1, 5], [0, 5, 4],
  ];
  return idx.map(([i, j, k]) => ({ a: v[i], b: v[j], c: v[k] }));
}

/* --------------------------------------------------------------------------
 * 几何缓存层
 * 射线检测 / 视野多边形 / 断面切片会对同一个体块反复求世界空间三角面和 AABB。
 * 按体块对象缓存结果，并在每次读取时核对几何字段（体块可能被原地修改），
 * 字段没变就直接复用。返回的数组是共享的，调用方只读、不得修改。
 * ------------------------------------------------------------------------ */
interface BlockGeomEntry {
  type: BlockType;
  steps: number | undefined;
  px: number; py: number; pz: number;
  sx: number; sy: number; sz: number;
  rx: number; ry: number; rz: number;
  tris: Triangle3D[] | null;
  aabb: { min: Vec3; max: Vec3 } | null;
}

const blockGeomCache = new WeakMap<LevelBlock, BlockGeomEntry>();

function getBlockGeomEntry(block: LevelBlock): BlockGeomEntry {
  const p = block.position;
  const s = block.size;
  const r = block.rotation;
  const e = blockGeomCache.get(block);
  if (
    e &&
    e.type === block.type && e.steps === block.steps &&
    e.px === p[0] && e.py === p[1] && e.pz === p[2] &&
    e.sx === s[0] && e.sy === s[1] && e.sz === s[2] &&
    e.rx === r[0] && e.ry === r[1] && e.rz === r[2]
  ) {
    return e;
  }
  const fresh: BlockGeomEntry = {
    type: block.type,
    steps: block.steps,
    px: p[0], py: p[1], pz: p[2],
    sx: s[0], sy: s[1], sz: s[2],
    rx: r[0], ry: r[1], rz: r[2],
    tris: null,
    aabb: null,
  };
  blockGeomCache.set(block, fresh);
  return fresh;
}

const BLOCK_TYPE_CODE: Record<string, number> = { box: 1, ramp: 2, stairs: 3, cylinder: 4, arch: 5 };

/**
 * 对所有会影响碰撞 / 遮挡 / 寻路的体块字段求一个签名，用作分析结果缓存的失效依据。
 * 两路独立的 32 位滚动哈希拼接，碰撞概率可以忽略。
 */
export function computeBlocksSignature(blocks: LevelBlock[]): string {
  let h1 = 0x811c9dc5 | 0;
  let h2 = 0x1b873593 | 0;
  const mix = (v: number) => {
    const n = Math.round(v * 1000) | 0;
    h1 = Math.imul(h1 ^ n, 0x01000193);
    h2 = (Math.imul(h2, 31) + n) | 0;
  };
  const mixStr = (str: string) => {
    for (let i = 0; i < str.length; i++) mix(str.charCodeAt(i) / 1000);
  };
  for (const b of blocks) {
    mix(BLOCK_TYPE_CODE[b.type] ?? 0);
    mixStr(b.role);
    mix(b.hidden ? 1 : 0);
    mix(b.steps ?? 0);
    mix(b.position[0]); mix(b.position[1]); mix(b.position[2]);
    mix(b.size[0]); mix(b.size[1]); mix(b.size[2]);
    mix(b.rotation[0]); mix(b.rotation[1]); mix(b.rotation[2]);
  }
  return `${blocks.length}:${h1 >>> 0}:${h2 >>> 0}`;
}

/** 小型 LRU：缓存昂贵的分析结果（视野多边形 / A* 路径） */
class AnalysisCache<T> {
  private map = new Map<string, T>();
  constructor(private readonly capacity: number) {}

  get(key: string): T | undefined {
    const hit = this.map.get(key);
    if (hit !== undefined) {
      this.map.delete(key);
      this.map.set(key, hit);
    }
    return hit;
  }

  set(key: string, value: T): void {
    this.map.set(key, value);
    if (this.map.size > this.capacity) {
      this.map.delete(this.map.keys().next().value as string);
    }
  }
}

export function getBlockTrianglesWorld(block: LevelBlock): Triangle3D[] {
  const entry = getBlockGeomEntry(block);
  if (!entry.tris) entry.tris = buildBlockTrianglesWorld(block);
  return entry.tris;
}

function buildBlockTrianglesWorld(block: LevelBlock): Triangle3D[] {
  const [w, h, d] = block.size;
  const hx = w / 2;
  const hy = h / 2;
  const hz = d / 2;
  let localTris: Triangle3D[] = [];

  if (block.type === 'box') {
    localTris = makeBoxTrianglesLocal([-hx, -hy, -hz], [hx, hy, hz]);
  } else if (block.type === 'ramp') {
    const v0: Vec3 = [-hx, -hy, -hz];
    const v1: Vec3 = [hx, -hy, -hz];
    const v2: Vec3 = [hx, hy, -hz];
    const v3: Vec3 = [-hx, hy, -hz];
    const v4: Vec3 = [-hx, -hy, hz];
    const v5: Vec3 = [hx, -hy, hz];
    localTris = [
      { a: v0, b: v2, c: v1 },
      { a: v0, b: v3, c: v2 },
      { a: v0, b: v1, c: v5 },
      { a: v0, b: v5, c: v4 },
      { a: v3, b: v4, c: v5 },
      { a: v3, b: v5, c: v2 },
      { a: v0, b: v4, c: v3 },
      { a: v1, b: v2, c: v5 },
    ];
  } else if (block.type === 'stairs') {
    const steps = Math.max(2, Math.min(24, block.steps || Math.round(h / 0.25) || 8));
    const stepH = h / steps;
    const stepD = d / steps;
    for (let i = 0; i < steps; i++) {
      const zMax = hz - i * stepD;
      const zMin = hz - (i + 1) * stepD;
      const yMax = -hy + (i + 1) * stepH;
      localTris.push(...makeBoxTrianglesLocal([-hx, -hy, zMin], [hx, yMax, zMax]));
    }
  } else if (block.type === 'arch') {
    const pillarW = Math.max(0.2, w * 0.22);
    const lintelH = Math.max(0.2, h * 0.25);
    localTris.push(...makeBoxTrianglesLocal([-hx, -hy, -hz], [-hx + pillarW, hy - lintelH, hz]));
    localTris.push(...makeBoxTrianglesLocal([hx - pillarW, -hy, -hz], [hx, hy - lintelH, hz]));
    localTris.push(...makeBoxTrianglesLocal([-hx, hy - lintelH, -hz], [hx, hy, hz]));
  } else if (block.type === 'cylinder') {
    const segs = 12;
    for (let i = 0; i < segs; i++) {
      const a0 = (i / segs) * Math.PI * 2;
      const a1 = ((i + 1) / segs) * Math.PI * 2;
      const x0 = Math.cos(a0) * hx, z0 = Math.sin(a0) * hz;
      const x1 = Math.cos(a1) * hx, z1 = Math.sin(a1) * hz;
      const b0: Vec3 = [x0, -hy, z0];
      const b1: Vec3 = [x1, -hy, z1];
      const t0: Vec3 = [x0, hy, z0];
      const t1: Vec3 = [x1, hy, z1];
      localTris.push(
        { a: b0, b: b1, c: t1 },
        { a: b0, b: t1, c: t0 },
        { a: [0, hy, 0], b: t0, c: t1 },
        { a: [0, -hy, 0], b: b1, c: b0 }
      );
    }
  }

  return localTris.map((t) => ({
    a: localToWorldPoint(t.a, block.position, block.rotation),
    b: localToWorldPoint(t.b, block.position, block.rotation),
    c: localToWorldPoint(t.c, block.position, block.rotation),
  }));
}

export function getBlockTopFootprint(block: LevelBlock): Vec2[] {
  const [w, , d] = block.size;
  const hx = w / 2;
  const hz = d / 2;
  const cornersLocal: Vec3[] = [
    [-hx, 0, -hz],
    [hx, 0, -hz],
    [hx, 0, hz],
    [-hx, 0, hz],
  ];
  return cornersLocal.map((c) => {
    const world = localToWorldPoint(c, block.position, block.rotation);
    return [world[0], world[2]];
  });
}

export function getBlockWorldAABB(block: LevelBlock): { min: Vec3; max: Vec3 } {
  const entry = getBlockGeomEntry(block);
  if (!entry.aabb) entry.aabb = buildBlockWorldAABB(block);
  return entry.aabb;
}

function buildBlockWorldAABB(block: LevelBlock): { min: Vec3; max: Vec3 } {
  const [w, h, d] = block.size;
  const hx = w / 2, hy = h / 2, hz = d / 2;
  const corners: Vec3[] = [
    [-hx, -hy, -hz], [hx, -hy, -hz], [hx, hy, -hz], [-hx, hy, -hz],
    [-hx, -hy, hz], [hx, -hy, hz], [hx, hy, hz], [-hx, hy, hz],
  ];
  const min: Vec3 = [Infinity, Infinity, Infinity];
  const max: Vec3 = [-Infinity, -Infinity, -Infinity];
  for (const c of corners) {
    const p = localToWorldPoint(c, block.position, block.rotation);
    if (p[0] < min[0]) min[0] = p[0];
    if (p[1] < min[1]) min[1] = p[1];
    if (p[2] < min[2]) min[2] = p[2];
    if (p[0] > max[0]) max[0] = p[0];
    if (p[1] > max[1]) max[1] = p[1];
    if (p[2] > max[2]) max[2] = p[2];
  }
  return { min, max };
}

function convexHull2D(pts: Vec2[]): Vec2[] {
  if (pts.length <= 2) return pts;
  const unique: Vec2[] = [];
  for (const p of pts) {
    if (!unique.some((q) => Math.hypot(q[0] - p[0], q[1] - p[1]) < 1e-3)) {
      unique.push(p);
    }
  }
  if (unique.length <= 2) return unique;
  unique.sort((a, b) => (a[0] !== b[0] ? a[0] - b[0] : a[1] - b[1]));
  const cross = (o: Vec2, a: Vec2, b: Vec2) =>
    (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower: Vec2[] = [];
  for (const p of unique) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) {
      lower.pop();
    }
    lower.push(p);
  }
  const upper: Vec2[] = [];
  for (let i = unique.length - 1; i >= 0; i--) {
    const p = unique[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) {
      upper.pop();
    }
    upper.push(p);
  }
  lower.pop();
  upper.pop();
  return lower.concat(upper);
}

function sliceTrianglesWithVerticalPlane(
  tris: Triangle3D[],
  start: Vec2,
  tx: number,
  tz: number,
  nx: number,
  nz: number,
  sectionLen: number
): Vec2[] {
  const rawPts: Vec2[] = [];
  const signedDist = (p: Vec3) => (p[0] - start[0]) * nx + (p[2] - start[1]) * nz;
  const projectU = (p: Vec3) => (p[0] - start[0]) * tx + (p[2] - start[1]) * tz;

  const checkEdge = (p1: Vec3, p2: Vec3, d1: number, d2: number) => {
    if (Math.abs(d1) < 1e-5 && Math.abs(d2) < 1e-5) {
      rawPts.push([projectU(p1), p1[1]], [projectU(p2), p2[1]]);
      return;
    }
    if ((d1 <= 0 && d2 >= 0) || (d1 >= 0 && d2 <= 0)) {
      const denom = d1 - d2;
      const t = Math.abs(denom) < 1e-8 ? 0 : d1 / denom;
      const ix = p1[0] + t * (p2[0] - p1[0]);
      const iy = p1[1] + t * (p2[1] - p1[1]);
      const iz = p1[2] + t * (p2[2] - p1[2]);
      const u = (ix - start[0]) * tx + (iz - start[1]) * tz;
      if (u >= -0.05 && u <= sectionLen + 0.05) {
        rawPts.push([Math.max(0, Math.min(sectionLen, u)), iy]);
      }
    }
  };

  for (const tri of tris) {
    const dA = signedDist(tri.a);
    const dB = signedDist(tri.b);
    const dC = signedDist(tri.c);
    checkEdge(tri.a, tri.b, dA, dB);
    checkEdge(tri.b, tri.c, dB, dC);
    checkEdge(tri.c, tri.a, dC, dA);
  }

  return convexHull2D(rawPts);
}

export function computeCrossSection(doc: LevelDocument): {
  sectionLength: number;
  items: CrossSectionSliceItem[];
} {
  const { start, end, slabDepth, flipNormal } = doc.sectionPlane;
  const dx = end[0] - start[0];
  const dz = end[1] - start[1];
  const sectionLength = Math.max(0.1, Math.hypot(dx, dz));
  const tx = dx / sectionLength;
  const tz = dz / sectionLength;
  const sign = flipNormal ? -1 : 1;
  const nx = -tz * sign;
  const nz = tx * sign;

  const items: CrossSectionSliceItem[] = [];

  for (const block of doc.blocks) {
    if (block.hidden) continue;

    const allTris = getBlockTrianglesWorld(block);
    const cutPolygons: Vec2[][] = [];

    if (block.type === 'stairs' || block.type === 'arch') {
      for (let i = 0; i < allTris.length; i += 12) {
        const subTris = allTris.slice(i, i + 12);
        const poly = sliceTrianglesWithVerticalPlane(subTris, start, tx, tz, nx, nz, sectionLength);
        if (poly.length >= 3) {
          cutPolygons.push(poly);
        }
      }
    } else {
      const poly = sliceTrianglesWithVerticalPlane(allTris, start, tx, tz, nx, nz, sectionLength);
      if (poly.length >= 3) {
        cutPolygons.push(poly);
      }
    }

    const slabProjections: [number, number, number, number][] = [];
    const corners = getBlockTopFootprint(block);
    const aabb = getBlockWorldAABB(block);
    let uMin = Infinity, uMax = -Infinity;
    let dMin = Infinity, dMax = -Infinity;
    for (const [cx, cz] of corners) {
      const u = (cx - start[0]) * tx + (cz - start[1]) * tz;
      const d = (cx - start[0]) * nx + (cz - start[1]) * nz;
      if (u < uMin) uMin = u;
      if (u > uMax) uMax = u;
      if (d < dMin) dMin = d;
      if (d > dMax) dMax = d;
    }

    const overlapsU = uMax >= 0 && uMin <= sectionLength;
    const inSlab = dMax > 0.02 && dMin <= slabDepth;
    if (overlapsU && inSlab) {
      slabProjections.push([
        Math.max(0, uMin),
        aabb.min[1],
        Math.min(sectionLength, uMax),
        aabb.max[1],
      ]);
    }

    if (cutPolygons.length > 0 || slabProjections.length > 0) {
      let slopeAngle: number | undefined;
      let warning: string | undefined;
      if (block.type === 'ramp' || block.type === 'stairs') {
        slopeAngle = Number((Math.atan2(block.size[1], block.size[2]) * RAD2DEG).toFixed(1));
        if (slopeAngle > doc.metricsProfile.maxSlopeAngle) {
          warning = `坡度 ${slopeAngle}° 超过最大爬坡角 ${doc.metricsProfile.maxSlopeAngle}°`;
        }
      }
      items.push({
        block,
        cutPolygons,
        slabProjections,
        slopeAngle,
        warning,
      });
    }
  }

  return { sectionLength, items };
}

/** Two-sided Möller–Trumbore ray-triangle intersection */
function intersectRayTriangle(
  origin: Vec3,
  dir: Vec3,
  minDist: number,
  maxDist: number,
  tri: Triangle3D
): number | null {
  const EPS = 1e-6;
  const edge1: Vec3 = [tri.b[0] - tri.a[0], tri.b[1] - tri.a[1], tri.b[2] - tri.a[2]];
  const edge2: Vec3 = [tri.c[0] - tri.a[0], tri.c[1] - tri.a[1], tri.c[2] - tri.a[2]];
  const h: Vec3 = [
    dir[1] * edge2[2] - dir[2] * edge2[1],
    dir[2] * edge2[0] - dir[0] * edge2[2],
    dir[0] * edge2[1] - dir[1] * edge2[0],
  ];
  const a = edge1[0] * h[0] + edge1[1] * h[1] + edge1[2] * h[2];
  if (a > -EPS && a < EPS) return null;
  const f = 1.0 / a;
  const s: Vec3 = [origin[0] - tri.a[0], origin[1] - tri.a[1], origin[2] - tri.a[2]];
  const u = f * (s[0] * h[0] + s[1] * h[1] + s[2] * h[2]);
  if (u < 0.0 || u > 1.0) return null;
  const q: Vec3 = [
    s[1] * edge1[2] - s[2] * edge1[1],
    s[2] * edge1[0] - s[0] * edge1[2],
    s[0] * edge1[1] - s[1] * edge1[0],
  ];
  const v = f * (dir[0] * q[0] + dir[1] * q[1] + dir[2] * q[2]);
  if (v < 0.0 || u + v > 1.0) return null;
  const t = f * (edge2[0] * q[0] + edge2[1] * q[1] + edge2[2] * q[2]);
  if (t > minDist && t < maxDist) {
    return t;
  }
  return null;
}

/**
 * Cast a 3D Line-of-Sight ray from `origin` to `target` against all solid blocks
 * (INCLUDING walkable floors, ceilings, ramps, stairs, walls, and cover!).
 */
export function raycastLevel3D(
  origin: Vec3,
  target: Vec3,
  blocks: LevelBlock[],
  ignoreBlockIds: string[] = []
): {
  blocked: boolean;
  distance: number;
  hitDistance?: number;
  hitPoint?: Vec3;
  hitBlockId?: string;
  hitBlockName?: string;
} {
  const dx = target[0] - origin[0];
  const dy = target[1] - origin[1];
  const dz = target[2] - origin[2];
  const totalDist = Math.hypot(dx, dy, dz);
  if (totalDist < 1e-4) {
    return { blocked: false, distance: 0 };
  }
  const dir: Vec3 = [dx / totalDist, dy / totalDist, dz / totalDist];

  let closestT = totalDist - 0.04;
  let hitBlock: LevelBlock | null = null;

  for (const block of blocks) {
    if (block.hidden || !ROLE_META[block.role]?.solid || ignoreBlockIds.includes(block.id)) {
      continue;
    }
    const aabb = getBlockWorldAABB(block);
    const minX = Math.min(origin[0], target[0]) - 0.1;
    const maxX = Math.max(origin[0], target[0]) + 0.1;
    const minY = Math.min(origin[1], target[1]) - 0.1;
    const maxY = Math.max(origin[1], target[1]) + 0.1;
    const minZ = Math.min(origin[2], target[2]) - 0.1;
    const maxZ = Math.max(origin[2], target[2]) + 0.1;
    if (
      aabb.max[0] < minX || aabb.min[0] > maxX ||
      aabb.max[1] < minY || aabb.min[1] > maxY ||
      aabb.max[2] < minZ || aabb.min[2] > maxZ
    ) {
      continue;
    }

    const tris = getBlockTrianglesWorld(block);
    for (const tri of tris) {
      const t = intersectRayTriangle(origin, dir, 0.04, closestT, tri);
      if (t !== null && t < closestT) {
        closestT = t;
        hitBlock = block;
      }
    }
  }

  if (hitBlock) {
    return {
      blocked: true,
      distance: Number(totalDist.toFixed(2)),
      hitDistance: Number(closestT.toFixed(2)),
      hitPoint: [
        Number((origin[0] + dir[0] * closestT).toFixed(2)),
        Number((origin[1] + dir[1] * closestT).toFixed(2)),
        Number((origin[2] + dir[2] * closestT).toFixed(2)),
      ],
      hitBlockId: hitBlock.id,
      hitBlockName: hitBlock.name,
    };
  }

  return {
    blocked: false,
    distance: Number(totalDist.toFixed(2)),
  };
}

/**
 * Resolve dynamic 3D world coordinates for a SightlineLink attached to POIs or Blocks!
 * Moving an attached Block or POI automatically moves the SightlineLink endpoints!
 */
export function resolveSightlineEndpoints(
  link: SightlineLink,
  doc: LevelDocument
): { from: Vec3; to: Vec3; fromLabel: string; toLabel: string } {
  let from: Vec3 = [...link.fromPos];
  let to: Vec3 = [...link.toPos];
  let fromLabel = '自定义起点';
  let toLabel = '自定义终点';

  if (link.fromId) {
    const poi = doc.pois.find((p) => p.id === link.fromId);
    if (poi) {
      from = [poi.position[0], Number((poi.position[1] + (link.fromHeightOffset ?? poi.eyeHeight)).toFixed(2)), poi.position[2]];
      fromLabel = poi.name;
    } else {
      const blk = doc.blocks.find((b) => b.id === link.fromId);
      if (blk) {
        const baseOrTopY = ROLE_META[blk.role]?.walkable
          ? blk.position[1] + blk.size[1] / 2 + (link.fromHeightOffset ?? doc.metricsProfile.eyeHeight)
          : blk.position[1] + blk.size[1] / 2 + 0.15;
        from = [blk.position[0], Number(baseOrTopY.toFixed(2)), blk.position[2]];
        fromLabel = blk.name;
      }
    }
  }

  if (link.toId) {
    const poi = doc.pois.find((p) => p.id === link.toId);
    if (poi) {
      to = [poi.position[0], Number((poi.position[1] + (link.toHeightOffset ?? doc.metricsProfile.crouchHeight)).toFixed(2)), poi.position[2]];
      toLabel = poi.name;
    } else {
      const blk = doc.blocks.find((b) => b.id === link.toId);
      if (blk) {
        const baseOrTopY = ROLE_META[blk.role]?.walkable
          ? blk.position[1] + blk.size[1] / 2 + (link.toHeightOffset ?? doc.metricsProfile.crouchHeight)
          : blk.position[1] + blk.size[1] / 2 + 0.15;
        to = [blk.position[0], Number(baseOrTopY.toFixed(2)), blk.position[2]];
        toLabel = blk.name;
      }
    }
  }

  return { from, to, fromLabel, toLabel };
}

/**
 * Sample the walkable floor elevation at (wx, wz).
 * If multiple floors overlap (e.g. 2F balcony over 1F ground), returns the floor closest to `preferY`
 * or the highest walkable surface at `(wx, wz)`.
 */
export function sampleWalkableElevationAt(
  wx: number,
  wz: number,
  blocks: LevelBlock[],
  preferY?: number
): { groundY: number; blockId: string | null } {
  let bestY = 0;
  let bestId: string | null = null;
  let bestDiff = Infinity;

  for (const b of blocks) {
    if (b.hidden || (!ROLE_META[b.role]?.walkable && b.type !== 'ramp' && b.type !== 'stairs')) {
      continue;
    }
    // 先用缓存的世界 AABB 粗筛（它包住旋转后的体块），绝大多数体块在这里就被排除
    const aabb = getBlockWorldAABB(b);
    if (wx < aabb.min[0] - 0.05 || wx > aabb.max[0] + 0.05 || wz < aabb.min[2] - 0.05 || wz > aabb.max[2] + 0.05) {
      continue;
    }
    const local = worldToLocalPoint([wx, b.position[1], wz], b.position, b.rotation);
    const hx = b.size[0] / 2 + 0.05;
    const hz = b.size[2] / 2 + 0.05;
    if (Math.abs(local[0]) <= hx && Math.abs(local[2]) <= hz) {
      let surfY = b.position[1] + b.size[1] / 2;
      if (b.type === 'ramp' || b.type === 'stairs') {
        const t = Math.max(0, Math.min(1, (b.size[2] / 2 - local[2]) / Math.max(0.1, b.size[2])));
        surfY = b.position[1] - b.size[1] / 2 + t * b.size[1];
      }
      if (preferY !== undefined) {
        const diff = Math.abs(surfY - preferY);
        if (diff < bestDiff) {
          bestDiff = diff;
          bestY = surfY;
          bestId = b.id;
        }
      } else if (bestId === null || surfY > bestY) {
        bestY = surfY;
        bestId = b.id;
      }
    }
  }

  return { groundY: Math.round(bestY * 100) / 100, blockId: bestId };
}

/**
 * True 3D Elevation & Floor-Occlusion-Aware Visibility Polygon!
 * Casts rays across `poi.fov` and checks BOTH horizontal obstacle intersections AND
 * 3D slanted rays to the ground surface at each distance step so walkable floor ledges (2F balcony)
 * and elevated platforms properly occlude sightlines!
 */
const visibilityCache = new AnalysisCache<Vec3[]>(96);

export function computeVisibilityPolygon(
  poi: LevelPOI,
  blocks: LevelBlock[],
  rayCount = 56
): Vec3[] {
  // 视野多边形只取决于观察点参数与场景几何；3D / 俯视视口以及平移缩放重绘都会命中缓存
  const key = [
    poi.position[0], poi.position[1], poi.position[2],
    poi.yaw, poi.fov, poi.visionRange, poi.eyeHeight,
    rayCount, computeBlocksSignature(blocks),
  ].join('|');
  const cached = visibilityCache.get(key);
  if (cached) return cached.slice();
  const result = computeVisibilityPolygonUncached(poi, blocks, rayCount);
  visibilityCache.set(key, result);
  return result.slice();
}

function computeVisibilityPolygonUncached(
  poi: LevelPOI,
  blocks: LevelBlock[],
  rayCount: number
): Vec3[] {
  const eyeY = poi.position[1] + (poi.eyeHeight ?? 1.65);
  const origin: Vec3 = [poi.position[0], eyeY, poi.position[2]];
  const halfFov = (poi.fov || 90) / 2;
  const maxRange = poi.visionRange || 20;
  const pts: Vec3[] = [origin];

  const solidBlocks = blocks.filter((b) => !b.hidden && ROLE_META[b.role]?.solid);
  const blockTrisMap = new Map<string, { aabb: { min: Vec3; max: Vec3 }; tris: Triangle3D[] }>();
  for (const b of solidBlocks) {
    blockTrisMap.set(b.id, {
      aabb: getBlockWorldAABB(b),
      tris: getBlockTrianglesWorld(b),
    });
  }

  const raycastFast = (from: Vec3, to: Vec3): boolean => {
    const dx = to[0] - from[0];
    const dy = to[1] - from[1];
    const dz = to[2] - from[2];
    const dist = Math.hypot(dx, dy, dz);
    if (dist < 0.1) return false;
    const dir: Vec3 = [dx / dist, dy / dist, dz / dist];
    const minX = Math.min(from[0], to[0]) - 0.05;
    const maxX = Math.max(from[0], to[0]) + 0.05;
    const minY = Math.min(from[1], to[1]) - 0.05;
    const maxY = Math.max(from[1], to[1]) + 0.05;
    const minZ = Math.min(from[2], to[2]) - 0.05;
    const maxZ = Math.max(from[2], to[2]) + 0.05;

    for (const b of solidBlocks) {
      const entry = blockTrisMap.get(b.id)!;
      const { aabb, tris } = entry;
      if (
        aabb.max[0] < minX || aabb.min[0] > maxX ||
        aabb.max[1] < minY || aabb.min[1] > maxY ||
        aabb.max[2] < minZ || aabb.min[2] > maxZ
      ) {
        continue;
      }
      for (const tri of tris) {
        if (intersectRayTriangle(from, dir, 0.06, dist - 0.08, tri) !== null) {
          return true; // blocked!
        }
      }
    }
    return false;
  };

  const radialSteps = 16;

  for (let i = 0; i <= rayCount; i++) {
    const angleDeg = poi.yaw - halfFov + (i / rayCount) * (poi.fov || 90);
    const rad = angleDeg * DEG2RAD;
    const dx = Math.sin(rad);
    const dz = -Math.cos(rad);

    // 1. Check horizontal ray at eyeY against walls/pillars spanning eyeY
    let wallT = maxRange;
    const horizDir: Vec3 = [dx, 0, dz];
    for (const b of solidBlocks) {
      const { aabb, tris } = blockTrisMap.get(b.id)!;
      if (aabb.max[1] < eyeY - 0.05 || aabb.min[1] > eyeY + 0.05) continue;
      for (const tri of tris) {
        const t = intersectRayTriangle(origin, horizDir, 0.05, wallT, tri);
        if (t !== null && t < wallT) {
          wallT = t;
        }
      }
    }

    // 2. March outward up to wallT and verify 3D slanted LOS to the walkable surface at (wx, wz)
    // This catches walkable floor ledges (2F balcony blocking view of 1F right below it)
    // and 1F enemies unable to see on top of 2F platforms!
    let lastVisibleDist = 0.5;
    let lastVisibleY = poi.position[1] + 0.15;

    for (let s = 1; s <= radialSteps; s++) {
      const d = (s / radialSteps) * wallT;
      const wx = origin[0] + dx * d;
      const wz = origin[2] + dz * d;
      const { groundY } = sampleWalkableElevationAt(wx, wz, blocks);
      // Target point at chest/head height (1.2m above that ground surface)
      const targetPt: Vec3 = [wx, groundY + 1.2, wz];
      const blockedByFloorOrCover = raycastFast(origin, targetPt);
      if (!blockedByFloorOrCover) {
        lastVisibleDist = d;
        lastVisibleY = groundY + 0.15;
      } else {
        // Stop expanding vision cone once occluded by a floor slab, cover, or ledge!
        break;
      }
    }

    pts.push([
      Number((origin[0] + dx * lastVisibleDist).toFixed(2)),
      Number(lastVisibleY.toFixed(2)),
      Number((origin[2] + dz * lastVisibleDist).toFixed(2)),
    ]);
  }

  return pts;
}

/**
 * 3D Elevation-Aware A* Auto-Pathfinding for Enemies & Navigation Check!
 * Finds a shortest walkable path from `start` to `goal` that:
 * - Walks on walkable blocks, ramps, and stairs
 * - Avoids walls, cover blocks, hazards, and unwalkable drops/cliffs
 * - Transitions between 1F and 2F via stairs and ramps!
 */
const pathCache = new AnalysisCache<Vec3[]>(160);

export function computeEnemyPathAStar(
  start: Vec3,
  goal: Vec3,
  doc: LevelDocument
): Vec3[] {
  const mp = doc.metricsProfile;
  const key = [
    start[0], start[1], start[2], goal[0], goal[1], goal[2],
    mp.playerRadius, mp.playerHeight, mp.maxStepHeight,
    computeBlocksSignature(doc.blocks),
  ].join('|');
  const cached = pathCache.get(key);
  if (cached) return cached.slice();
  const result = computeEnemyPathAStarUncached(start, goal, doc).map((p) => [p[0], p[1], p[2]] as Vec3);
  pathCache.set(key, result);
  return result.slice();
}

function computeEnemyPathAStarUncached(
  start: Vec3,
  goal: Vec3,
  doc: LevelDocument
): Vec3[] {
  const step = 1.0; // 1m NavGrid resolution
  const sx = Math.round(start[0] / step) * step;
  const sz = Math.round(start[2] / step) * step;
  const gx = Math.round(goal[0] / step) * step;
  const gz = Math.round(goal[2] / step) * step;

  if (Math.hypot(gx - sx, gz - sz) < step * 1.1) {
    return [start, goal];
  }

  // Precompute obstacle AABBs (walls, covers, hazards, objectives)
  const obstacles = doc.blocks
    .filter(
      (b) =>
        !b.hidden &&
        (b.role === 'wall' ||
          b.role === 'cover_low' ||
          b.role === 'cover_full' ||
          b.role === 'hazard' ||
          b.role === 'objective') &&
        b.type !== 'arch'
    )
    .map((b) => ({ block: b, aabb: getBlockWorldAABB(b) }));

  const isCellBlockedAt = (wx: number, wy: number, wz: number): boolean => {
    const r = doc.metricsProfile.playerRadius || 0.4;
    for (const { aabb } of obstacles) {
      if (
        wx + r > aabb.min[0] &&
        wx - r < aabb.max[0] &&
        wz + r > aabb.min[2] &&
        wz - r < aabb.max[2] &&
        wy + doc.metricsProfile.playerHeight > aabb.min[1] + 0.1 &&
        wy + 0.2 < aabb.max[1]
      ) {
        return true;
      }
    }
    return false;
  };

  // 网格步长 1m、搜索范围 ±36m：用整数键代替字符串键（每次扩展节点省两次 toFixed）
  const keyOf = (x: number, z: number) => (Math.round(x / step) + 4096) * 8192 + (Math.round(z / step) + 4096);
  interface Node {
    x: number;
    y: number;
    z: number;
    g: number;
    f: number;
    parent?: Node;
  }

  const startNode: Node = {
    x: sx,
    y: start[1],
    z: sz,
    g: 0,
    f: Math.hypot(gx - sx, gz - sz),
  };

  const open: Node[] = [startNode];
  const bestG = new Map<number, number>();
  bestG.set(keyOf(sx, sz), 0);

  const dirs: [number, number, number][] = [
    [step, 0, step],
    [-step, 0, step],
    [0, step, step],
    [0, -step, step],
    [step, step, Math.SQRT2 * step],
    [step, -step, Math.SQRT2 * step],
    [-step, step, Math.SQRT2 * step],
    [-step, -step, Math.SQRT2 * step],
  ];

  let closestNode: Node = startNode;
  let minGoalDist = Math.hypot(gx - sx, gz - sz);
  let iterations = 0;
  const maxIterations = 900;

  while (open.length > 0 && iterations < maxIterations) {
    iterations++;
    // Pop node with lowest f
    let bestIdx = 0;
    for (let i = 1; i < open.length; i++) {
      if (open[i].f < open[bestIdx].f) bestIdx = i;
    }
    const cur = open.splice(bestIdx, 1)[0];

    const distToGoal = Math.hypot(gx - cur.x, gz - cur.z) + Math.abs(goal[1] - cur.y) * 1.5;
    if (distToGoal < minGoalDist) {
      minGoalDist = distToGoal;
      closestNode = cur;
    }

    if (Math.hypot(gx - cur.x, gz - cur.z) <= step * 1.1 && Math.abs(goal[1] - cur.y) <= 1.5) {
      closestNode = cur;
      break;
    }

    for (const [dx, dz, cost] of dirs) {
      const nx = cur.x + dx;
      const nz = cur.z + dz;
      if (Math.abs(nx) > 36 || Math.abs(nz) > 36) continue;

      const { groundY, blockId } = sampleWalkableElevationAt(nx, nz, doc.blocks, cur.y);
      if (!blockId) continue;

      // Max step / slope transition per 1m cell: maxStepHeight + ramp rise (~0.95m per 1m)
      const dy = Math.abs(groundY - cur.y);
      if (dy > doc.metricsProfile.maxStepHeight + 0.85) continue;

      if (isCellBlockedAt(nx, groundY, nz)) continue;

      const k = keyOf(nx, nz);
      const ng = cur.g + cost + dy * 1.2;
      if (bestG.has(k) && bestG.get(k)! <= ng) continue;
      bestG.set(k, ng);

      const h = Math.hypot(gx - nx, gz - nz) + Math.abs(goal[1] - groundY) * 1.5;
      open.push({
        x: nx,
        y: groundY,
        z: nz,
        g: ng,
        f: ng + h,
        parent: cur,
      });
    }
  }

  const rawPath: Vec3[] = [];
  let ptr: Node | undefined = closestNode;
  while (ptr) {
    rawPath.push([ptr.x, Number((ptr.y + 0.15).toFixed(2)), ptr.z]);
    ptr = ptr.parent;
  }
  rawPath.reverse();
  if (rawPath.length === 0) return [start, goal];
  rawPath[0] = [start[0], Number((start[1] + 0.15).toFixed(2)), start[2]];
  rawPath.push([goal[0], Number((goal[1] + 0.15).toFixed(2)), goal[2]]);
  return rawPath;
}

/**
 * Evaluate Enemy Detection (Visual LOS + FOV + Hearing Radius) and A* Chase Path to Target!
 */
export function evaluateEnemyDetection(
  enemy: LevelPOI,
  targetPos: Vec3,
  doc: LevelDocument
): {
  status: 'detected_visual' | 'detected_hearing' | 'occluded' | 'out_of_range';
  statusLabel: string;
  distance: number;
  inFov: boolean;
  losBlocked: boolean;
  blockerName?: string;
  chasePath: Vec3[];
  chaseDistance: number;
  chaseTimeSec: number;
} {
  const eyeOrigin: Vec3 = [
    enemy.position[0],
    Number((enemy.position[1] + (enemy.eyeHeight ?? 1.65)).toFixed(2)),
    enemy.position[2],
  ];
  const targetChest: Vec3 = [
    targetPos[0],
    Number((targetPos[1] + doc.metricsProfile.crouchHeight).toFixed(2)),
    targetPos[2],
  ];

  const dx = targetPos[0] - enemy.position[0];
  const dy = targetPos[1] - enemy.position[1];
  const dz = targetPos[2] - enemy.position[2];
  const dist3D = Number(Math.hypot(dx, dy, dz).toFixed(2));

  // Angle from enemy forward vector (yaw: 0 = -Z, 90 = +X)
  let angleToTarget = (Math.atan2(dx, -dz) * RAD2DEG + 360) % 360;
  let angleDiff = Math.abs(angleToTarget - ((enemy.yaw % 360 + 360) % 360));
  if (angleDiff > 180) angleDiff = 360 - angleDiff;
  const inFov = angleDiff <= (enemy.fov || 90) / 2;

  const los = raycastLevel3D(eyeOrigin, targetChest, doc.blocks);
  const hearingRange = enemy.enemyConfig?.hearingRange ?? 7.0;
  const chaseSpeed = enemy.enemyConfig?.chaseSpeed ?? 6.0;

  // Compute A* path from enemy to target
  const chasePath =
    enemy.enemyConfig?.autoPathfind !== false
      ? computeEnemyPathAStar(enemy.position, targetPos, doc)
      : [enemy.position, targetPos];
  let chaseDistance = 0;
  for (let i = 1; i < chasePath.length; i++) {
    chaseDistance += Math.hypot(
      chasePath[i][0] - chasePath[i - 1][0],
      chasePath[i][1] - chasePath[i - 1][1],
      chasePath[i][2] - chasePath[i - 1][2]
    );
  }
  chaseDistance = Number(chaseDistance.toFixed(1));
  const chaseTimeSec = Number((chaseDistance / Math.max(0.5, chaseSpeed)).toFixed(1));

  if (dist3D <= (enemy.visionRange || 20) && inFov && !los.blocked) {
    return {
      status: 'detected_visual',
      statusLabel: '👁️ 视野发现目标! (Visual Aggro)',
      distance: dist3D,
      inFov,
      losBlocked: false,
      chasePath,
      chaseDistance,
      chaseTimeSec,
    };
  }

  if (dist3D <= hearingRange && Math.abs(dy) <= 3.5) {
    return {
      status: 'detected_hearing',
      statusLabel: '🔊 听觉感知触发! (Hearing Alert)',
      distance: dist3D,
      inFov,
      losBlocked: los.blocked,
      blockerName: los.hitBlockName,
      chasePath,
      chaseDistance,
      chaseTimeSec,
    };
  }

  if (dist3D <= (enemy.visionRange || 20) && inFov && los.blocked) {
    return {
      status: 'occluded',
      statusLabel: `🧱 视野内但被 [${los.hitBlockName}] 遮挡`,
      distance: dist3D,
      inFov,
      losBlocked: true,
      blockerName: los.hitBlockName,
      chasePath,
      chaseDistance,
      chaseTimeSec,
    };
  }

  return {
    status: 'out_of_range',
    statusLabel: '🟢 未发觉 (Safe / Out of Cone)',
    distance: dist3D,
    inFov,
    losBlocked: los.blocked,
    blockerName: los.hitBlockName,
    chasePath,
    chaseDistance,
    chaseTimeSec,
  };
}

export function evaluateJumpLink(
  from: Vec3,
  to: Vec3,
  metrics: MetricsProfile,
  blocks: LevelBlock[]
): JumpEvaluation {
  const dx = to[0] - from[0];
  const dz = to[2] - from[2];
  const horizontalDist = Number(Math.hypot(dx, dz).toFixed(2));
  const verticalDelta = Number((to[1] - from[1]).toFixed(2));

  const dirX = horizontalDist > 1e-4 ? dx / horizontalDist : 0;
  const dirZ = horizontalDist > 1e-4 ? dz / horizontalDist : -1;

  const speedScale = Math.max(0.15, metrics.runSpeed / 7.0);
  const walkRatio = Math.max(0.15, metrics.walkSpeed / Math.max(0.5, metrics.runSpeed));
  const gravityScale = Math.sqrt(18.0 / Math.max(2.0, metrics.gravity));
  const heightFlightScale = Math.sqrt(Math.max(0.15, metrics.jumpHeight / 1.6));

  const flatMaxSingle = metrics.jumpDistance * speedScale * gravityScale * heightFlightScale;

  let effectiveMaxDistSingle = 0;
  if (verticalDelta <= metrics.jumpHeight) {
    const ratio = 1 - verticalDelta / Math.max(0.1, metrics.jumpHeight);
    const timeFactor = (1 + Math.sqrt(Math.max(0, ratio))) / 2;
    effectiveMaxDistSingle = Number((flatMaxSingle * timeFactor).toFixed(2));
  }

  const doubleHeightScale = Math.sqrt(Math.max(0.15, metrics.doubleJumpHeight / 2.8));
  const flatMaxDouble = metrics.doubleJumpDistance * speedScale * gravityScale * doubleHeightScale;
  let effectiveMaxDistDouble = 0;
  if (verticalDelta <= metrics.doubleJumpHeight) {
    const ratio = 1 - verticalDelta / Math.max(0.1, metrics.doubleJumpHeight);
    const timeFactor = (1 + Math.sqrt(Math.max(0, ratio))) / 2;
    effectiveMaxDistDouble = Number((flatMaxDouble * timeFactor).toFixed(2));
  }

  const reachDist = Math.max(0.5, effectiveMaxDistSingle > 0 ? effectiveMaxDistSingle : flatMaxSingle * 0.5);
  const maxReachPoint: Vec3 = [
    Number((from[0] + dirX * reachDist).toFixed(2)),
    to[1],
    Number((from[2] + dirZ * reachDist).toFixed(2)),
  ];

  const capabilityArcPoints: Vec3[] = [];
  const capApexY = from[1] + metrics.jumpHeight;
  const capMidY = 0.5 * (from[1] + to[1]);
  const capBoost = Math.max(0.3, capApexY - capMidY);
  const samples = 24;
  for (let i = 0; i <= samples; i++) {
    const t = i / samples;
    const x = from[0] + dirX * reachDist * t;
    const z = from[2] + dirZ * reachDist * t;
    const y = (1 - t) * from[1] + t * to[1] + 4 * t * (1 - t) * capBoost;
    capabilityArcPoints.push([Number(x.toFixed(2)), Number(y.toFixed(2)), Number(z.toFixed(2))]);
  }

  const apexY = Math.max(from[1], to[1]) + metrics.jumpHeight;
  const requiredApexY = Number((apexY - from[1]).toFixed(2));
  const arcPoints: Vec3[] = [];
  const midLinearY = 0.5 * (from[1] + to[1]);
  const hBoost = Math.max(0.4, apexY - midLinearY);

  let blockedPoint: Vec3 | undefined;

  for (let i = 0; i <= samples; i++) {
    const t = i / samples;
    const x = from[0] + dx * t;
    const z = from[2] + dz * t;
    const y = (1 - t) * from[1] + t * to[1] + 4 * t * (1 - t) * hBoost;
    const pt: Vec3 = [Number(x.toFixed(2)), Number(y.toFixed(2)), Number(z.toFixed(2))];
    arcPoints.push(pt);

    if (i > 1 && i < samples - 1 && !blockedPoint) {
      const prev = arcPoints[i - 1];
      const footRay = raycastLevel3D([prev[0], prev[1] + 0.25, prev[2]], [pt[0], pt[1] + 0.25, pt[2]], blocks);
      const headRay = raycastLevel3D(
        [prev[0], prev[1] + metrics.playerHeight * 0.85, prev[2]],
        [pt[0], pt[1] + metrics.playerHeight * 0.85, pt[2]],
        blocks
      );
      if (footRay.blocked || headRay.blocked) {
        blockedPoint = footRay.hitPoint || headRay.hitPoint || pt;
      }
    }
  }

  if (blockedPoint) {
    return {
      horizontalDist,
      verticalDelta,
      requiredApexY,
      effectiveMaxDistSingle,
      effectiveMaxDistDouble,
      maxReachPoint,
      capabilityArcPoints,
      arcPoints,
      status: 'blocked',
      statusLabel: '轨迹受阻 (Blocked)',
      reason: `跳跃弧线在中途 [${blockedPoint.join(', ')}] 处发生碰撞或净空不足`,
      blockedPoint,
    };
  }

  const safeWalkJumpDist = effectiveMaxDistSingle * Math.max(0.65, walkRatio);

  if (verticalDelta <= metrics.jumpHeight * 0.9 && horizontalDist <= safeWalkJumpDist) {
    return {
      horizontalDist,
      verticalDelta,
      requiredApexY,
      effectiveMaxDistSingle,
      effectiveMaxDistDouble,
      maxReachPoint,
      capabilityArcPoints,
      arcPoints,
      status: 'safe',
      statusLabel: '安全可达 (Safe Jump)',
      reason: `目标 ${horizontalDist}m ≤ 常规跳跃 ${safeWalkJumpDist.toFixed(1)}m (极限助跑 ${effectiveMaxDistSingle}m)`,
    };
  }

  if (verticalDelta <= metrics.jumpHeight && horizontalDist <= effectiveMaxDistSingle) {
    return {
      horizontalDist,
      verticalDelta,
      requiredApexY,
      effectiveMaxDistSingle,
      effectiveMaxDistDouble,
      maxReachPoint,
      capabilityArcPoints,
      arcPoints,
      status: 'stretch',
      statusLabel: '需助跑冲刺跳 (Sprint Jump)',
      reason: `目标 ${horizontalDist}m 处于助跑跳极限包络内 (当前最大可达 ${effectiveMaxDistSingle}m)`,
    };
  }

  if (verticalDelta <= metrics.doubleJumpHeight && horizontalDist <= effectiveMaxDistDouble) {
    return {
      horizontalDist,
      verticalDelta,
      requiredApexY,
      effectiveMaxDistSingle,
      effectiveMaxDistDouble,
      maxReachPoint,
      capabilityArcPoints,
      arcPoints,
      status: 'double_jump',
      statusLabel: '需二段跳/冲刺 (Double/Dash)',
      reason: `超出单跳极限 (${effectiveMaxDistSingle}m)，需二段跳可达 (二段极限 ${effectiveMaxDistDouble}m)`,
    };
  }

  return {
    horizontalDist,
    verticalDelta,
    requiredApexY,
    effectiveMaxDistSingle,
    effectiveMaxDistDouble,
    maxReachPoint,
    capabilityArcPoints,
    arcPoints,
    status: 'impossible',
    statusLabel: '不可达 (Out of Reach)',
    reason: `目标距离 ${horizontalDist}m / 高差 ${verticalDelta}m 超出当前角色最大跳跃能力 (单跳极限 ${effectiveMaxDistSingle}m)`,
  };
}

export function auditLevel(doc: LevelDocument): LevelAuditSummary {
  let totalWalkableArea = 0;
  let totalCoverLength = 0;
  let minY = Infinity;
  let maxY = -Infinity;
  const floorBreakdown: Record<number, number> = {};
  const issues: AuditIssue[] = [];

  for (const b of doc.blocks) {
    if (b.hidden) continue;
    const aabb = getBlockWorldAABB(b);
    if (aabb.min[1] < minY) minY = aabb.min[1];
    if (aabb.max[1] > maxY) maxY = aabb.max[1];

    if (b.role === 'walkable' || b.type === 'ramp' || b.type === 'stairs') {
      const area = b.size[0] * b.size[2];
      totalWalkableArea += area;
      floorBreakdown[b.floor] = Number(((floorBreakdown[b.floor] || 0) + area).toFixed(1));
    }

    if (b.role === 'cover_low' || b.role === 'cover_full') {
      totalCoverLength += Math.max(b.size[0], b.size[2]);
      const h = b.size[1];
      if (b.role === 'cover_low' && (h < doc.metricsProfile.lowCoverHeight - 0.25 || h > doc.metricsProfile.lowCoverHeight + 0.35)) {
        issues.push({
          severity: 'warning',
          category: 'cover',
          title: `半身掩体高度偏离标准 (${b.name})`,
          detail: `当前高度 ${h.toFixed(2)}m，建议半身掩体高度约为 ${doc.metricsProfile.lowCoverHeight}m`,
          relatedIds: [b.id],
        });
      }
      if (b.role === 'cover_full' && h < doc.metricsProfile.fullCoverHeight - 0.15) {
        issues.push({
          severity: 'warning',
          category: 'cover',
          title: `全身掩体高度不足 (${b.name})`,
          detail: `当前高度 ${h.toFixed(2)}m 低于全身掩体标准 ${doc.metricsProfile.fullCoverHeight}m，站立角色头部可能暴露`,
          relatedIds: [b.id],
        });
      }
    }

    if (b.type === 'ramp' || b.type === 'stairs') {
      const angle = Math.atan2(b.size[1], b.size[2]) * RAD2DEG;
      if (angle > doc.metricsProfile.maxSlopeAngle) {
        issues.push({
          severity: 'error',
          category: 'metrics',
          title: `斜坡/楼梯角度过陡 (${b.name})`,
          detail: `坡度 ${angle.toFixed(1)}° 超过角色最大爬坡角 ${doc.metricsProfile.maxSlopeAngle}°，角色将无法正常走上`,
          relatedIds: [b.id],
        });
      }
    }
  }

  let mainPathDistance = 0;
  for (const path of doc.paths) {
    let dist = 0;
    for (let i = 1; i < path.points.length; i++) {
      const p0 = path.points[i - 1];
      const p1 = path.points[i];
      dist += Math.hypot(p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]);
    }
    if (path.type === 'main') {
      mainPathDistance += dist;
    }
  }

  for (const j of doc.jumps) {
    const evalRes = evaluateJumpLink(j.from, j.to, doc.metricsProfile, doc.blocks);
    if (evalRes.status === 'impossible' || evalRes.status === 'blocked') {
      issues.push({
        severity: 'error',
        category: 'metrics',
        title: `跳跃点不可达 (${j.name})`,
        detail: evalRes.reason,
        relatedIds: [j.id],
      });
    } else if (evalRes.status === 'stretch') {
      issues.push({
        severity: 'info',
        category: 'metrics',
        title: `极限跳跃校验 (${j.name})`,
        detail: evalRes.reason,
        relatedIds: [j.id],
      });
    }
  }

  const coverToAreaRatio = totalWalkableArea > 0 ? Number(((totalCoverLength / totalWalkableArea) * 100).toFixed(1)) : 0;
  if (totalWalkableArea > 100 && totalCoverLength < 4) {
    issues.push({
      severity: 'info',
      category: 'cover',
      title: '开阔区域掩体密度较低',
      detail: `可行走面积 ${totalWalkableArea.toFixed(0)}㎡，但掩体总长仅 ${totalCoverLength.toFixed(1)}m`,
      relatedIds: [],
    });
  }

  const estimatedWalkTimeSec = Number((mainPathDistance / Math.max(0.5, doc.metricsProfile.walkSpeed)).toFixed(1));
  const estimatedRunTimeSec = Number((mainPathDistance / Math.max(0.5, doc.metricsProfile.runSpeed)).toFixed(1));

  // Compute Pacing & Tension Curve along the Main Path (or level X/Z axis if no path)
  const { beats: pacingBeats, verdict: pacingVerdict } = computeLevelPacing(doc);

  return {
    totalWalkableArea: Number(totalWalkableArea.toFixed(1)),
    totalCoverLength: Number(totalCoverLength.toFixed(1)),
    coverToAreaRatio,
    mainPathDistance: Number(mainPathDistance.toFixed(1)),
    estimatedWalkTimeSec,
    estimatedRunTimeSec,
    elevationSpan: [
      minY === Infinity ? 0 : Number(minY.toFixed(2)),
      maxY === -Infinity ? 0 : Number(maxY.toFixed(2)),
    ],
    floorBreakdown,
    pacingBeats,
    pacingVerdict,
    issues,
  };
}

export function computeLevelPacing(doc: LevelDocument): {
  beats: PacingBeatPoint[];
  verdict: string;
} {
  const mainPath = doc.paths.find((p) => p.type === 'main') || doc.paths[0];
  const samplePts: Vec3[] = [];
  const N = 12;

  if (mainPath && mainPath.points.length >= 2) {
    // Resample N points along mainPath
    const segs: { p0: Vec3; p1: Vec3; len: number }[] = [];
    let totalLen = 0;
    for (let i = 1; i < mainPath.points.length; i++) {
      const p0 = mainPath.points[i - 1];
      const p1 = mainPath.points[i];
      const len = Math.hypot(p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]);
      segs.push({ p0, p1, len });
      totalLen += len;
    }
    for (let k = 0; k < N; k++) {
      const targetD = (k / (N - 1)) * Math.max(0.1, totalLen);
      let acc = 0;
      let found: Vec3 = mainPath.points[mainPath.points.length - 1];
      for (const s of segs) {
        if (acc + s.len >= targetD) {
          const t = s.len > 0.01 ? (targetD - acc) / s.len : 0;
          found = [
            s.p0[0] + (s.p1[0] - s.p0[0]) * t,
            s.p0[1] + (s.p1[1] - s.p0[1]) * t,
            s.p0[2] + (s.p1[2] - s.p0[2]) * t,
          ];
          break;
        }
        acc += s.len;
      }
      samplePts.push(found);
    }
  } else {
    // Fallback: sample from Player Spawn towards Objective or across X span
    const spawn = doc.pois.find((p) => p.category === 'spawn_player');
    const obj = doc.pois.find((p) => p.category === 'objective' || p.category === 'boss');
    const pStart: Vec3 = spawn ? spawn.position : [-12, 0, 0];
    const pEnd: Vec3 = obj ? obj.position : [12, 0, 0];
    for (let k = 0; k < N; k++) {
      const t = k / (N - 1);
      samplePts.push([
        pStart[0] + (pEnd[0] - pStart[0]) * t,
        pStart[1] + (pEnd[1] - pStart[1]) * t,
        pStart[2] + (pEnd[2] - pStart[2]) * t,
      ]);
    }
  }

  const beats: PacingBeatPoint[] = [];
  let accDist = 0;
  for (let i = 0; i < samplePts.length; i++) {
    const pt = samplePts[i];
    if (i > 0) {
      accDist += Math.hypot(
        pt[0] - samplePts[i - 1][0],
        pt[1] - samplePts[i - 1][1],
        pt[2] - samplePts[i - 1][2]
      );
    }

    let tension = 10;
    let safety = 20;

    // Evaluate enemy threat & LOS at pt
    for (const poi of doc.pois) {
      const d = Math.hypot(poi.position[0] - pt[0], poi.position[1] - pt[1], poi.position[2] - pt[2]);
      if (poi.category === 'spawn_enemy' || poi.category === 'sniper_nest' || poi.category === 'boss') {
        const weight = poi.category === 'boss' ? 55 : poi.category === 'sniper_nest' ? 38 : 30;
        if (d < (poi.visionRange || 20)) {
          const los = raycastLevel3D(
            [poi.position[0], poi.position[1] + (poi.eyeHeight || 1.6), poi.position[2]],
            [pt[0], pt[1] + 1.2, pt[2]],
            doc.blocks
          );
          tension += !los.blocked ? weight * (1 - d / ((poi.visionRange || 20) * 1.4)) : weight * 0.25;
        }
      } else if (poi.category === 'checkpoint' || poi.category === 'spawn_player' || poi.category === 'loot') {
        if (d < 7) {
          safety += 35 * (1 - d / 7);
          tension -= 12;
        }
      }
    }

    // Evaluate nearby blocks (hazards, combat triggers, cover)
    for (const b of doc.blocks) {
      if (b.hidden) continue;
      const d = Math.hypot(b.position[0] - pt[0], b.position[2] - pt[2]);
      if (b.role === 'hazard' && d < Math.max(b.size[0], b.size[2]) * 0.75 + 2.5) {
        tension += 24;
      }
      if (b.role === 'trigger_combat' && d < Math.max(b.size[0], b.size[2]) * 0.65) {
        tension += 22;
      }
      if ((b.role === 'cover_low' || b.role === 'cover_full') && d < 5.0) {
        safety += 18;
      }
    }

    tension = Math.round(Math.max(5, Math.min(100, tension)));
    safety = Math.round(Math.max(5, Math.min(100, safety)));

    let beatLabel = '探索推进';
    if (i === 0) beatLabel = '安全起步 (Intro)';
    else if (tension >= 72) beatLabel = '高潮交火 (Climax)';
    else if (tension >= 45) beatLabel = '战术遭遇 (Combat)';
    else if (safety >= 55 && tension < 38) beatLabel = '喘息整备 (Breather)';

    beats.push({
      progressPct: Math.round((i / (samplePts.length - 1)) * 100),
      distanceM: Number(accDist.toFixed(1)),
      tension,
      safety,
      elevation: Number(pt[1].toFixed(1)),
      beatLabel,
    });
  }

  const maxT = Math.max(...beats.map((b) => b.tension));
  const minT = Math.min(...beats.map((b) => b.tension));
  let verdict = '✓ 心流节奏均衡：具备清晰的「安全起步 → 遭遇波峰 → 掩体喘息 → 终局高潮」起伏曲线。';
  if (maxT - minT < 20) {
    verdict = '⚠️ 节奏曲线过于平缓：建议增加一处高威胁交火点/Boss或险峻跳跃段以制造心流波峰。';
  } else if (minT > 55) {
    verdict = '⚠️ 全程高压缺乏喘息区：建议在中途布置全身掩体盲区或存档补给点 (Checkpoint/Loot)。';
  }

  return { beats, verdict };
}

export interface TriggerLinkVisual {
  fromId: string;
  toId: string;
  fromName: string;
  toName: string;
  fromPos: Vec3;
  toPos: Vec3;
}

export function resolveTriggerLinks(doc: LevelDocument): TriggerLinkVisual[] {
  const links: TriggerLinkVisual[] = [];
  const findObj = (id: string): { name: string; pos: Vec3 } | null => {
    const p = doc.pois.find((x) => x.id === id);
    if (p) return { name: p.name, pos: [p.position[0], p.position[1] + 1.0, p.position[2]] };
    const b = doc.blocks.find((x) => x.id === id);
    if (b) return { name: b.name, pos: [...b.position] };
    return null;
  };

  for (const p of doc.pois) {
    if (p.linkedId) {
      const target = findObj(p.linkedId);
      if (target) {
        links.push({
          fromId: p.id,
          toId: p.linkedId,
          fromName: p.name,
          toName: target.name,
          fromPos: [p.position[0], p.position[1] + 1.0, p.position[2]],
          toPos: target.pos,
        });
      }
    }
  }
  for (const b of doc.blocks) {
    if (b.linkedId) {
      const target = findObj(b.linkedId);
      if (target) {
        links.push({
          fromId: b.id,
          toId: b.linkedId,
          fromName: b.name,
          toName: target.name,
          fromPos: [...b.position],
          toPos: target.pos,
        });
      }
    }
  }
  return links;
}

function uid(prefix: string): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 8)}`;
}

interface AICommandResult {
  doc: LevelDocument;
  message: string;
  affectedIds: string[];
}

function sanitizeVec3(v: unknown, fallback: Vec3, minEach?: number): Vec3 {
  const src = Array.isArray(v) ? v : fallback;
  const out: Vec3 = [fallback[0], fallback[1], fallback[2]];
  for (let i = 0; i < 3; i++) {
    const n = Number(src[i]);
    if (Number.isFinite(n)) out[i] = minEach !== undefined ? Math.max(minEach, Math.abs(n)) : n;
  }
  return out;
}

/**
 * 执行一条 AI / CLI / MCP 指令。指令来自外部（JSON 文本、网络请求），因此这里保证
 * 永不抛异常：格式不对、动作未知或缺少必填字段时，原样返回文档并给出可读的错误信息。
 */
export function applyAICommand(doc: LevelDocument, cmd: AICommandAction): AICommandResult {
  const action = (cmd as { action?: unknown } | null | undefined)?.action;
  if (typeof action !== 'string') {
    return { doc, message: 'Invalid command: expected an object with an "action" field', affectedIds: [] };
  }
  try {
    const res = applyAICommandUnchecked(doc, cmd) as AICommandResult | undefined;
    return res ?? { doc, message: `Unknown action "${action}"`, affectedIds: [] };
  } catch (err) {
    return { doc, message: `Command "${action}" failed: ${(err as Error).message}`, affectedIds: [] };
  }
}

function applyAICommandUnchecked(doc: LevelDocument, cmd: AICommandAction): AICommandResult {
  const next: LevelDocument = structuredClone(doc);
  if (!next.sightlines) next.sightlines = [];
  next.metadata.updatedAt = new Date().toISOString();
  const affectedIds: string[] = [];

  switch (cmd.action) {
    case 'add_block': {
      // 外部指定的 id 若已存在则换一个，避免出现两个同 id 的体块
      const id = cmd.block.id && !next.blocks.some((b) => b.id === cmd.block.id) ? cmd.block.id : uid('blk');
      const newBlock: LevelBlock = {
        id,
        name: cmd.block.name || `白盒_${next.blocks.length + 1}`,
        type: cmd.block.type || 'box',
        role: cmd.block.role || 'walkable',
        position: sanitizeVec3(cmd.block.position, [0, 0.5, 0]),
        size: sanitizeVec3(cmd.block.size, [4, 1, 4], 0.05),
        rotation: sanitizeVec3(cmd.block.rotation, [0, 0, 0]),
        floor: Number.isFinite(Number(cmd.block.floor)) ? Number(cmd.block.floor) : 0,
        color: cmd.block.color,
        steps: cmd.block.steps,
        designTag: cmd.block.designTag,
        notes: cmd.block.notes,
        mechanicsTip: cmd.block.mechanicsTip,
        linkedId: cmd.block.linkedId,
      };
      next.blocks.push(newBlock);
      affectedIds.push(id);
      return { doc: next, message: `Added block "${newBlock.name}" (${id})`, affectedIds };
    }

    case 'update_block': {
      const idx = next.blocks.findIndex((b) => b.id === cmd.id);
      if (idx === -1) {
        return { doc: next, message: `Block "${cmd.id}" not found`, affectedIds: [] };
      }
      const prevBlock = next.blocks[idx];
      const merged: LevelBlock = { ...prevBlock, ...cmd.patch, id: cmd.id };
      merged.position = sanitizeVec3(merged.position, prevBlock.position);
      merged.size = sanitizeVec3(merged.size, prevBlock.size, 0.05);
      merged.rotation = sanitizeVec3(merged.rotation, prevBlock.rotation);
      next.blocks[idx] = merged;
      affectedIds.push(cmd.id);
      return { doc: next, message: `Updated block "${next.blocks[idx].name}" (${cmd.id})`, affectedIds };
    }

    case 'delete_block': {
      const before = next.blocks.length;
      const removedName = next.blocks.find((b) => b.id === cmd.id)?.name;
      next.blocks = next.blocks.filter((b) => b.id !== cmd.id);
      return {
        doc: next,
        message: next.blocks.length < before ? `Deleted block "${removedName}" (${cmd.id})` : `Block ${cmd.id} not found`,
        affectedIds: [cmd.id],
      };
    }

    case 'add_poi': {
      const id = cmd.poi.id || uid('poi');
      const cat = cmd.poi.category || 'objective';
      const isEnemy = cat === 'spawn_enemy' || cat === 'boss' || cat === 'sniper_nest';
      const newPoi: LevelPOI = {
        id,
        name: cmd.poi.name || `标记点_${next.pois.length + 1}`,
        category: cat,
        position: cmd.poi.position || [0, 0, 0],
        yaw: cmd.poi.yaw ?? 0,
        showVision: cmd.poi.showVision ?? isEnemy,
        fov: cmd.poi.fov ?? 90,
        visionRange: cmd.poi.visionRange ?? 20,
        eyeHeight: cmd.poi.eyeHeight ?? next.metricsProfile.eyeHeight,
        enemyConfig:
          cmd.poi.enemyConfig ||
          (isEnemy
            ? {
                patrolMode: 'loop',
                waypoints: [],
                autoPathfind: true,
                patrolSpeed: 2.8,
                chaseSpeed: 5.8,
                hearingRange: 7.0,
              }
            : undefined),
        linkedId: cmd.poi.linkedId,
        designTag: cmd.poi.designTag,
        notes: cmd.poi.notes,
        mechanicsTip: cmd.poi.mechanicsTip,
      };
      next.pois.push(newPoi);
      affectedIds.push(id);
      return { doc: next, message: `Added POI "${newPoi.name}" (${id})`, affectedIds };
    }

    case 'update_poi': {
      const idx = next.pois.findIndex((p) => p.id === cmd.id);
      if (idx === -1) return { doc: next, message: `POI "${cmd.id}" not found`, affectedIds: [] };
      next.pois[idx] = { ...next.pois[idx], ...cmd.patch, id: cmd.id };
      affectedIds.push(cmd.id);
      return { doc: next, message: `Updated POI "${next.pois[idx].name}" (${cmd.id})`, affectedIds };
    }

    case 'delete_poi': {
      const removedPoiName = next.pois.find((p) => p.id === cmd.id)?.name;
      next.pois = next.pois.filter((p) => p.id !== cmd.id);
      return {
        doc: next,
        message: removedPoiName !== undefined ? `Deleted POI "${removedPoiName}" (${cmd.id})` : `POI ${cmd.id} not found`,
        affectedIds: [cmd.id],
      };
    }

    case 'add_path': {
      const id = cmd.path.id || uid('path');
      next.paths.push({
        id,
        name: cmd.path.name || `动线_${next.paths.length + 1}`,
        type: cmd.path.type || 'main',
        points: cmd.path.points || [
          [0, 0.2, 10],
          [0, 0.2, -10],
        ],
        oneWay: cmd.path.oneWay ?? false,
      });
      affectedIds.push(id);
      return { doc: next, message: `Added FlowPath (${id})`, affectedIds };
    }

    case 'delete_path': {
      next.paths = next.paths.filter((p) => p.id !== cmd.id);
      return { doc: next, message: `Deleted FlowPath ${cmd.id}`, affectedIds: [cmd.id] };
    }

    case 'add_jump': {
      const id = cmd.jump.id || uid('jmp');
      next.jumps.push({
        id,
        name: cmd.jump.name || `跳跃检测_${next.jumps.length + 1}`,
        from: cmd.jump.from || [0, 0, 0],
        to: cmd.jump.to || [0, 1.2, -4],
        fromId: cmd.jump.fromId,
        toId: cmd.jump.toId,
        mode: cmd.jump.mode || 'normal',
      });
      affectedIds.push(id);
      return { doc: next, message: `Added JumpLink (${id})`, affectedIds };
    }

    case 'delete_jump': {
      next.jumps = next.jumps.filter((j) => j.id !== cmd.id);
      return { doc: next, message: `Deleted JumpLink ${cmd.id}`, affectedIds: [cmd.id] };
    }

    case 'add_sightline': {
      const id = cmd.sightline.id || uid('los');
      next.sightlines.push({
        id,
        name: cmd.sightline.name || `视线检测尺_${next.sightlines.length + 1}`,
        fromId: cmd.sightline.fromId,
        toId: cmd.sightline.toId,
        fromPos: cmd.sightline.fromPos || [0, 1.65, 0],
        toPos: cmd.sightline.toPos || [0, 1.2, -8],
        fromHeightOffset: cmd.sightline.fromHeightOffset ?? next.metricsProfile.eyeHeight,
        toHeightOffset: cmd.sightline.toHeightOffset ?? next.metricsProfile.crouchHeight,
      });
      affectedIds.push(id);
      return { doc: next, message: `Added Sightline Ruler (${id})`, affectedIds };
    }

    case 'delete_sightline': {
      next.sightlines = next.sightlines.filter((s) => s.id !== cmd.id);
      return { doc: next, message: `Deleted Sightline Ruler ${cmd.id}`, affectedIds: [cmd.id] };
    }

    case 'set_section': {
      next.sectionPlane = { ...next.sectionPlane, ...cmd.section };
      return { doc: next, message: `Updated cross-section plane A-A'`, affectedIds: [] };
    }

    case 'update_metrics': {
      next.metricsProfile = { ...next.metricsProfile, ...cmd.metrics };
      return { doc: next, message: `Updated character metrics profile`, affectedIds: [] };
    }

    case 'generate_room': {
      const [cx, cy, cz] = cmd.center;
      const [w, h, d] = cmd.size;
      const wt = cmd.wallThickness ?? 0.5;
      const floorIdx = cmd.floor ?? 0;
      const baseName = cmd.name || '房间';
      const doors = new Set(cmd.doorways || ['south']);

      const floorId = uid('room_flr');
      next.blocks.push({
        id: floorId,
        name: `${baseName}_地面`,
        type: 'box',
        role: 'walkable',
        position: [cx, cy - 0.25, cz],
        size: [w, 0.5, d],
        rotation: [0, 0, 0],
        floor: floorIdx,
      });
      affectedIds.push(floorId);

      const addWall = (suffix: string, pos: Vec3, sz: Vec3, type: 'box' | 'arch' = 'box') => {
        const wid = uid('room_wal');
        next.blocks.push({
          id: wid,
          name: `${baseName}_${suffix}`,
          type,
          role: 'wall',
          position: pos,
          size: sz,
          rotation: [0, 0, 0],
          floor: floorIdx,
        });
        affectedIds.push(wid);
      };

      addWall('北墙', [cx, cy + h / 2, cz - d / 2 + wt / 2], [w, h, wt], doors.has('north') ? 'arch' : 'box');
      addWall('南墙', [cx, cy + h / 2, cz + d / 2 - wt / 2], [w, h, wt], doors.has('south') ? 'arch' : 'box');
      addWall('西墙', [cx - w / 2 + wt / 2, cy + h / 2, cz], [wt, h, d - wt * 2], doors.has('west') ? 'arch' : 'box');
      addWall('东墙', [cx + w / 2 - wt / 2, cy + h / 2, cz], [wt, h, d - wt * 2], doors.has('east') ? 'arch' : 'box');

      return { doc: next, message: `Generated room "${baseName}" with ${affectedIds.length} blocks`, affectedIds };
    }

    case 'scatter_cover': {
      const [minX, minY, minZ] = cmd.boundsMin;
      const [maxX, , maxZ] = cmd.boundsMax;
      const count = Math.max(1, Math.min(20, cmd.count || 4));
      const floorIdx = cmd.floor ?? 0;
      for (let i = 0; i < count; i++) {
        const t = (i + 0.5) / count;
        const x = Number((minX + (maxX - minX) * ((i % 2 === 0 ? 0.3 : 0.7) + Math.sin(i * 2.1) * 0.15)).toFixed(1));
        const z = Number((minZ + (maxZ - minZ) * t).toFixed(1));
        const isFull = i % 3 === 1;
        const h = isFull ? next.metricsProfile.fullCoverHeight : next.metricsProfile.lowCoverHeight;
        const id = uid('cov');
        next.blocks.push({
          id,
          name: `${isFull ? '全身掩体' : '半身掩体'}_${i + 1}`,
          type: 'box',
          role: isFull ? 'cover_full' : 'cover_low',
          position: [x, minY + h / 2, z],
          size: [i % 2 === 0 ? 2.5 : 1.5, h, i % 2 === 0 ? 0.8 : 1.5],
          rotation: [0, 0, 0],
          floor: floorIdx,
        });
        affectedIds.push(id);
      }
      return { doc: next, message: `Generated ${affectedIds.length} tactical cover blocks`, affectedIds };
    }

    case 'mirror_blocks': {
      const targets = cmd.blockIds?.length
        ? next.blocks.filter((b) => cmd.blockIds!.includes(b.id))
        : next.blocks.filter((b) => b.role !== 'walkable' || b.position[cmd.axis === 'x' ? 0 : 2] !== 0);
      for (const b of targets) {
        const id = uid('mir');
        const pos: Vec3 = [...b.position];
        const rot: Vec3 = [...b.rotation];
        if (cmd.axis === 'x') {
          pos[0] = -pos[0];
          rot[1] = -rot[1];
        } else {
          pos[2] = -pos[2];
          rot[1] = (180 - rot[1]) % 360;
        }
        next.blocks.push({
          ...structuredClone(b),
          id,
          name: `${b.name}_镜像`,
          position: pos,
          rotation: rot,
        });
        affectedIds.push(id);
      }
      return { doc: next, message: `Mirrored ${affectedIds.length} blocks across ${cmd.axis.toUpperCase()} axis`, affectedIds };
    }

    case 'clear_all': {
      next.blocks = [];
      next.paths = [];
      next.pois = [];
      next.jumps = [];
      next.sightlines = [];
      return { doc: next, message: 'Cleared all objects in scene', affectedIds: [] };
    }
  }
}

export interface PlayerCameraRigResult {
  mode: 'fps' | 'tps' | 'topdown' | 'side_2d';
  pivotPos: Vec3;
  idealCamPos: Vec3;
  actualCamPos: Vec3;
  lookDir: Vec3;
  upDir: Vec3;
  rightDir: Vec3;
  lookTarget: Vec3;
  cameraFov: number;
  pitchDeg: number;
  idealDistance: number;
  effectiveDistance: number;
  springArmClipped: boolean;
  clippedByBlockName?: string;
  frustumNear: [Vec3, Vec3, Vec3, Vec3];
  frustumFar: [Vec3, Vec3, Vec3, Vec3];
}

/**
 * Computes the 3D Player Camera Rig (FPS / TPS Over-Shoulder SpringArm / Top-Down / 2D Side-Scroller),
 * including 3D SpringArm obstacle anti-clipping collision and 16:9 Camera Frustum vertices.
 */
export function computePlayerCameraRig(
  playerPos: Vec3,
  playerYawDeg: number,
  metrics: MetricsProfile,
  blocks: LevelBlock[],
  overridePitchDeg?: number
): PlayerCameraRigResult {
  const mode = metrics.cameraMode ?? 'tps';
  const cameraFov = Math.max(30, Math.min(125, metrics.cameraFov ?? 70));

  if (mode === 'side_2d') {
    const dist = Math.max(4, metrics.cameraDistance ?? 14.0);
    const offsetY = metrics.cameraOffsetY ?? metrics.eyeHeight ?? 1.5;
    const pivotPos: Vec3 = [Number(playerPos[0].toFixed(2)), Number((playerPos[1] + offsetY).toFixed(2)), Number(playerPos[2].toFixed(2))];
    const actualCamPos: Vec3 = [pivotPos[0], pivotPos[1], Number((pivotPos[2] + dist).toFixed(2))];
    const lookDir: Vec3 = [0, 0, -1];
    const rightDir: Vec3 = [1, 0, 0];
    const upDir: Vec3 = [0, 1, 0];
    const aspect = 16 / 9;
    const halfTan = Math.tan(((cameraFov * 0.5) * Math.PI) / 180);
    const buildSideQuad = (d: number): [Vec3, Vec3, Vec3, Vec3] => {
      const h = d * halfTan;
      const w = h * aspect;
      const cz = actualCamPos[2] - d;
      return [
        [Number((actualCamPos[0] - w).toFixed(2)), Number((actualCamPos[1] + h).toFixed(2)), Number(cz.toFixed(2))],
        [Number((actualCamPos[0] + w).toFixed(2)), Number((actualCamPos[1] + h).toFixed(2)), Number(cz.toFixed(2))],
        [Number((actualCamPos[0] + w).toFixed(2)), Number((actualCamPos[1] - h).toFixed(2)), Number(cz.toFixed(2))],
        [Number((actualCamPos[0] - w).toFixed(2)), Number((actualCamPos[1] - h).toFixed(2)), Number(cz.toFixed(2))],
      ];
    };
    return {
      mode,
      pivotPos,
      idealCamPos: actualCamPos,
      actualCamPos,
      lookDir,
      upDir,
      rightDir,
      lookTarget: pivotPos,
      cameraFov,
      pitchDeg: 0,
      idealDistance: dist,
      effectiveDistance: dist,
      springArmClipped: false,
      frustumNear: buildSideQuad(0.8),
      frustumFar: buildSideQuad(dist),
    };
  }

  const idealDistance = mode === 'fps' ? 0 : Math.max(0, metrics.cameraDistance ?? (mode === 'topdown' ? 11.0 : 3.2));
  const offsetY = metrics.cameraOffsetY ?? metrics.eyeHeight ?? 1.65;
  const shoulder = mode === 'fps' || mode === 'topdown' ? 0 : (metrics.cameraShoulderOffset ?? 0.45);
  const pitchDeg =
    overridePitchDeg !== undefined
      ? overridePitchDeg
      : metrics.cameraPitch ?? (mode === 'topdown' ? -48 : mode === 'tps' ? -10 : 0);

  const yawRad = (playerYawDeg * Math.PI) / 180;
  const pitchRad = (pitchDeg * Math.PI) / 180;

  const fwdHorizX = Math.sin(yawRad);
  const fwdHorizZ = -Math.cos(yawRad);
  const rightX = Math.cos(yawRad);
  const rightZ = Math.sin(yawRad);

  const cosP = Math.cos(pitchRad);
  const sinP = Math.sin(pitchRad);

  const lookDir: Vec3 = [fwdHorizX * cosP, sinP, fwdHorizZ * cosP];
  const rightDir: Vec3 = [rightX, 0, rightZ];
  const upDir: Vec3 = [-fwdHorizX * sinP, cosP, -fwdHorizZ * sinP];

  const pivotPos: Vec3 = [
    Number((playerPos[0] + rightX * shoulder).toFixed(2)),
    Number((playerPos[1] + offsetY).toFixed(2)),
    Number((playerPos[2] + rightZ * shoulder).toFixed(2)),
  ];

  const idealCamPos: Vec3 = [
    Number((pivotPos[0] - lookDir[0] * idealDistance).toFixed(2)),
    Number((pivotPos[1] - lookDir[1] * idealDistance).toFixed(2)),
    Number((pivotPos[2] - lookDir[2] * idealDistance).toFixed(2)),
  ];

  let actualCamPos: Vec3 = [...idealCamPos];
  let effectiveDistance = idealDistance;
  let springArmClipped = false;
  let clippedByBlockName: string | undefined;

  if (idealDistance > 0.08 && (metrics.cameraCollision ?? true)) {
    const hit = raycastLevel3D(pivotPos, idealCamPos, blocks);
    if (hit.blocked && hit.hitDistance !== undefined) {
      effectiveDistance = Number(Math.max(0.2, hit.hitDistance - 0.18).toFixed(2));
      actualCamPos = [
        Number((pivotPos[0] - lookDir[0] * effectiveDistance).toFixed(2)),
        Number((pivotPos[1] - lookDir[1] * effectiveDistance).toFixed(2)),
        Number((pivotPos[2] - lookDir[2] * effectiveDistance).toFixed(2)),
      ];
      springArmClipped = true;
      clippedByBlockName = hit.hitBlockName;
    }
  }

  const focusDist = Math.max(8, metrics.playerVisionRange ?? 24);
  const lookTarget: Vec3 = [
    Number((actualCamPos[0] + lookDir[0] * focusDist).toFixed(2)),
    Number((actualCamPos[1] + lookDir[1] * focusDist).toFixed(2)),
    Number((actualCamPos[2] + lookDir[2] * focusDist).toFixed(2)),
  ];

  const aspect = 16 / 9;
  const halfTan = Math.tan(((cameraFov * 0.5) * Math.PI) / 180);
  const nearD = 0.45;
  const farD = Math.min(16, Math.max(4, (metrics.playerVisionRange ?? 24) * 0.55));

  const buildQuad = (d: number): [Vec3, Vec3, Vec3, Vec3] => {
    const h = d * halfTan;
    const w = h * aspect;
    const cx = actualCamPos[0] + lookDir[0] * d;
    const cy = actualCamPos[1] + lookDir[1] * d;
    const cz = actualCamPos[2] + lookDir[2] * d;
    const pt = (sx: number, sy: number): Vec3 => [
      Number((cx + rightDir[0] * w * sx + upDir[0] * h * sy).toFixed(2)),
      Number((cy + rightDir[1] * w * sx + upDir[1] * h * sy).toFixed(2)),
      Number((cz + rightDir[2] * w * sx + upDir[2] * h * sy).toFixed(2)),
    ];
    return [pt(-1, 1), pt(1, 1), pt(1, -1), pt(-1, -1)];
  };

  return {
    mode,
    pivotPos,
    idealCamPos,
    actualCamPos,
    lookDir,
    upDir,
    rightDir,
    lookTarget,
    cameraFov,
    pitchDeg,
    idealDistance,
    effectiveDistance,
    springArmClipped,
    clippedByBlockName,
    frustumNear: buildQuad(nearD),
    frustumFar: buildQuad(farD),
  };
}

/**
 * Evaluates which Enemy / Objective POIs are currently visible to the Player's Vision & Camera
 */
export function evaluatePlayerVisionTargets(
  playerPoi: LevelPOI,
  doc: LevelDocument
): {
  id: string;
  name: string;
  category: string;
  distance: number;
  inVisionCone: boolean;
  inPeripheral: boolean;
  losClear: boolean;
  blockerName?: string;
  status: 'visible' | 'peripheral' | 'occluded' | 'out_of_fov';
  statusLabel: string;
}[] {
  const m = doc.metricsProfile;
  const visionFov = m.playerVisionFov ?? playerPoi.fov ?? 95;
  const visionRange = m.playerVisionRange ?? playerPoi.visionRange ?? 26;
  const periphRange = m.playerPeripheralRange ?? 5.0;
  const eyeY = playerPoi.position[1] + (m.eyeHeight ?? playerPoi.eyeHeight ?? 1.65);
  const origin: Vec3 = [playerPoi.position[0], eyeY, playerPoi.position[2]];

  const yawRad = (playerPoi.yaw * Math.PI) / 180;
  const fwdX = Math.sin(yawRad);
  const fwdZ = -Math.cos(yawRad);

  const results: ReturnType<typeof evaluatePlayerVisionTargets> = [];

  for (const p of doc.pois) {
    if (p.id === playerPoi.id) continue;
    const targetEye: Vec3 = [p.position[0], p.position[1] + (p.eyeHeight || 1.5), p.position[2]];
    const dx = targetEye[0] - origin[0];
    const dz = targetEye[2] - origin[2];
    const dist = Number(Math.hypot(dx, targetEye[1] - origin[1], dz).toFixed(2));
    const horizDist = Math.max(1e-4, Math.hypot(dx, dz));
    const dot = (dx / horizDist) * fwdX + (dz / horizDist) * fwdZ;
    const angleDeg = (Math.acos(Math.max(-1, Math.min(1, dot))) * 180) / Math.PI;

    const inVisionCone = dist <= visionRange && angleDeg <= visionFov * 0.5;
    const inPeripheral = dist <= periphRange;
    const los = raycastLevel3D(origin, targetEye, doc.blocks);

    let status: 'visible' | 'peripheral' | 'occluded' | 'out_of_fov' = 'out_of_fov';
    let statusLabel = `视野角度/距离外 (${dist}m)`;

    if (inVisionCone && !los.blocked) {
      status = 'visible';
      statusLabel = `👁️ 玩家视野直接可见 (${dist}m)`;
    } else if (inPeripheral && !los.blocked) {
      status = 'peripheral';
      statusLabel = `👂 玩家近身余光/听觉感知 (${dist}m)`;
    } else if ((inVisionCone || inPeripheral) && los.blocked) {
      status = 'occluded';
      statusLabel = `🙈 被「${los.hitBlockName}」遮挡 (${dist}m)`;
    }

    results.push({
      id: p.id,
      name: p.name,
      category: p.category,
      distance: dist,
      inVisionCone,
      inPeripheral,
      losClear: !los.blocked,
      blockerName: los.hitBlockName,
      status,
      statusLabel,
    });
  }

  return results;
}
