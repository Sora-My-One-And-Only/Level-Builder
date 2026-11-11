import { applyAICommand, auditLevel, computeCrossSection, evaluateJumpLink, raycastLevel3D } from './geometry-analysis';
import { normalizeLevelDocument } from './document';
import { createTacticalCourtyardLevel } from './presets';
import {
  ActiveTool,
  AICommandAction,
  BlockRole,
  GameDimensionMode,
  LevelBlock,
  LevelDocument,
  LevelPOI,
  POICategory,
  Vec2,
  Vec3,
  ViewportLayout,
} from './types';

export type SelectionTarget =
  | { kind: 'block'; id: string }
  | { kind: 'poi'; id: string }
  | { kind: 'path'; id: string }
  | { kind: 'jump'; id: string }
  | { kind: 'sightline'; id: string }
  | null;

export interface EditorCreationDefaults {
  role: BlockRole;
  floor: number;
  baseY: number;
  height: number;
  customColor?: string;
  poiCategory: POICategory;
  pathType: 'main' | 'flank' | 'secret' | 'patrol';
}

export interface OverlayOptions {
  showGrid: boolean;
  showVisionCones: boolean;
  showFlowPaths: boolean;
  showJumpArcs: boolean;
  showScaleHuman: boolean;
  showDimensions: boolean;
  showDesignNotes: boolean;
  elevationHeatmap: boolean;
  floorFilter: 'all' | number;
}

type Listener = () => void;

const DOC_STORAGE_KEY = 'levelforge_doc_v1';
const PERSIST_INTERVAL_MS = 250;
const SERVER_PUSH_INTERVAL_MS = 60;
const RECONNECT_MIN_MS = 3000;
const RECONNECT_MAX_MS = 60000;

export class LevelStore {
  public doc: LevelDocument;
  public history: LevelDocument[] = [];
  public future: LevelDocument[] = [];

  public selection: SelectionTarget = null;
  public hoveredBlockId: string | null = null;
  public activeTool: ActiveTool = 'select';
  public transformMode: 'translate' | 'rotate' | 'scale' = 'translate';
  public layout: ViewportLayout = 'split_3d_2d';
  public isPlaytesting = false;
  public isSimulatingEnemies = false;
  private frameListeners = new Set<() => void>();

  public creationDefaults: EditorCreationDefaults = {
    role: 'wall',
    floor: 0,
    baseY: 0,
    height: 3.0,
    poiCategory: 'spawn_enemy',
    pathType: 'main',
  };

  public overlays: OverlayOptions = {
    showGrid: true,
    showVisionCones: true,
    showFlowPaths: true,
    showJumpArcs: true,
    showScaleHuman: true,
    showDimensions: true,
    showDesignNotes: true,
    elevationHeatmap: false,
    floorFilter: 'all',
  };

  /** Whether the floating Object Design Note HUD card is expanded when an object is selected */
  public showFloatingNoteCard = true;
  private dimensionChangeListeners = new Set<(mode: GameDimensionMode) => void>();

  /** Ruler or interactive sightline check in viewport */
  public activeRuler: { start: Vec3; end: Vec3 } | null = null;
  /** Playtest player world position & yaw for live mini-map tracking in 2D */
  public playtestPose: { position: Vec3; yaw: number; trail: Vec3[] } | null = null;

  /** Bridge connection status */
  public bridgeConnected = false;
  public lastAILog = 'AI Bridge 就绪 (支持 Claude Code / Codex CLI & MCP 实时调用)';

  private listeners = new Set<Listener>();
  private viewportOnlyListeners = new Set<Listener>();
  private ws: WebSocket | null = null;
  private suppressServerSync = false;
  /** 本地有尚未送达 Bridge 的修改（离线期间编辑）；重连时以本地为准推送，而不是被服务端旧文档覆盖 */
  private hasUnsyncedLocalEdits = false;
  private persistTimer: number | undefined;
  private serverPushTimer: number | undefined;
  private reconnectDelayMs = RECONNECT_MIN_MS;

  constructor() {
    let restored: LevelDocument | null = null;
    try {
      const saved = localStorage.getItem(DOC_STORAGE_KEY);
      const parsed = saved ? normalizeLevelDocument(JSON.parse(saved)) : null;
      if (parsed) restored = parsed;
    } catch {
      // 存档损坏或 localStorage 不可用时退回默认关卡
    }
    this.doc = restored ?? normalizeLevelDocument(createTacticalCourtyardLevel())!;

    if (typeof window !== 'undefined') {
      // 持久化是节流写入的，页面隐藏 / 关闭前补写一次，避免丢掉最后几百毫秒的修改
      window.addEventListener('pagehide', () => this.flushPersist());
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'hidden') this.flushPersist();
      });
    }
    this.connectBridge();
    this.exposeGlobalAIAPI();
  }

  /** 节流写入 localStorage：拖拽 / 试玩时每帧都会通知，不必每次都序列化整份文档 */
  private schedulePersist(): void {
    if (this.persistTimer !== undefined) return;
    this.persistTimer = window.setTimeout(() => this.flushPersist(), PERSIST_INTERVAL_MS);
  }

  private flushPersist(): void {
    if (this.persistTimer !== undefined) {
      window.clearTimeout(this.persistTimer);
      this.persistTimer = undefined;
    }
    try {
      localStorage.setItem(DOC_STORAGE_KEY, JSON.stringify(this.doc));
    } catch {
      // ignore storage quota errors
    }
  }

  public onFrameSelected(fn: () => void): () => void {
    this.frameListeners.add(fn);
    return () => this.frameListeners.delete(fn);
  }

  public requestFrameSelected(): void {
    for (const fn of this.frameListeners) {
      fn();
    }
  }

  public onDimensionModeChanged(fn: (mode: GameDimensionMode) => void): () => void {
    this.dimensionChangeListeners.add(fn);
    return () => this.dimensionChangeListeners.delete(fn);
  }

  public getDimensionMode(): GameDimensionMode {
    return this.doc.metadata.dimensionMode || '3d';
  }

  public setDimensionMode(mode: GameDimensionMode): void {
    this.pushUndoSnapshot();
    this.doc.metadata.dimensionMode = mode;
    if (mode === '2d_side') {
      this.doc.sectionPlane = {
        start: [-16, 0],
        end: [16, 0],
        slabDepth: 8,
        clip3D: false,
        flipNormal: false,
      };
      this.doc.metricsProfile.cameraMode = 'side_2d';
      this.doc.metricsProfile.cameraDistance = 14.0;
      this.doc.metricsProfile.cameraPitch = 0;
      this.lastAILog = '已切换至 [2D 横版卷轴设计模式]：断面视口可全交互编辑 X/Y 平台，按 Tab 支持 A/D+Space 2D 横版跳跃试玩！';
    } else if (mode === '2d_topdown') {
      this.doc.metricsProfile.cameraMode = 'topdown';
      this.doc.metricsProfile.cameraDistance = 13.5;
      this.doc.metricsProfile.cameraPitch = -58;
      this.lastAILog = '已切换至 [2D 俯视角地牢设计模式]：俯视蓝图为主画布，按 Tab 支持 WASD 2D 俯视八向移动试玩！';
    } else {
      if (this.doc.metricsProfile.cameraMode === 'side_2d') {
        this.doc.metricsProfile.cameraMode = 'tps';
        this.doc.metricsProfile.cameraDistance = 3.2;
        this.doc.metricsProfile.cameraPitch = -10;
      }
      this.lastAILog = '已切换至 [3D 立体空间设计模式]：三视口全联动 + Unity 漫游体验';
    }
    for (const fn of this.dimensionChangeListeners) {
      fn(mode);
    }
    this.notify(true);
  }

  public subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /** Subscribe for viewport canvas/3D redraws (fires even during live slider drags without rebuilding DOM inputs) */
  public subscribeViewports(fn: Listener): () => void {
    this.viewportOnlyListeners.add(fn);
    return () => this.viewportOnlyListeners.delete(fn);
  }

  public notifyViewportsOnly(syncToServer = true): void {
    this.schedulePersist();
    if (syncToServer && !this.suppressServerSync) {
      this.queueServerPush();
    }
    for (const fn of this.viewportOnlyListeners) {
      fn();
    }
  }

  public notify(syncToServer = false): void {
    this.schedulePersist();
    if (syncToServer && !this.suppressServerSync) {
      this.queueServerPush();
    }
    for (const fn of this.viewportOnlyListeners) {
      fn();
    }
    for (const fn of this.listeners) {
      fn();
    }
  }

  public pushUndoSnapshot(): void {
    this.history.push(structuredClone(this.doc));
    if (this.history.length > 50) {
      this.history.shift();
    }
    this.future = [];
  }

  public undo(): void {
    const prev = this.history.pop();
    if (!prev) return;
    this.future.push(structuredClone(this.doc));
    this.doc = prev;
    this.lastAILog = `↶ 已撤销（还可撤销 ${this.history.length} 步）`;
    this.notify(true);
  }

  public redo(): void {
    const next = this.future.pop();
    if (!next) return;
    this.history.push(structuredClone(this.doc));
    this.doc = next;
    this.lastAILog = `↷ 已重做（还可重做 ${this.future.length} 步）`;
    this.notify(true);
  }

  public setDocument(newDoc: LevelDocument, recordUndo = true, syncToServer = true): void {
    if (recordUndo) {
      this.pushUndoSnapshot();
    }
    this.doc = normalizeLevelDocument(structuredClone(newDoc)) ?? this.doc;
    this.selection = null;
    this.activeRuler = null;
    this.lastAILog = `已切换场景: ${this.doc.metadata.name}`;
    const dim = this.doc.metadata.dimensionMode || '3d';
    for (const fn of this.dimensionChangeListeners) {
      fn(dim);
    }
    this.notify(syncToServer);
  }

  public dispatchAICommand(cmd: AICommandAction, recordUndo = true): {
    message: string;
    affectedIds: string[];
  } {
    if (recordUndo) {
      this.pushUndoSnapshot();
    }
    const res = applyAICommand(this.doc, cmd);
    this.doc = res.doc;
    if (res.affectedIds.length > 0 && cmd.action.startsWith('add_')) {
      if (cmd.action === 'add_block') this.selection = { kind: 'block', id: res.affectedIds[0] };
      if (cmd.action === 'add_poi') this.selection = { kind: 'poi', id: res.affectedIds[0] };
      if (cmd.action === 'add_path') this.selection = { kind: 'path', id: res.affectedIds[0] };
      if (cmd.action === 'add_jump') this.selection = { kind: 'jump', id: res.affectedIds[0] };
      if (cmd.action === 'add_sightline') this.selection = { kind: 'sightline', id: res.affectedIds[0] };
    }
    this.lastAILog = res.message;
    this.notify(true);
    return { message: res.message, affectedIds: res.affectedIds };
  }

  public updateBlockLive(id: string, patch: Partial<LevelBlock>, sync = true): void {
    const idx = this.doc.blocks.findIndex((b) => b.id === id);
    if (idx === -1) return;
    this.doc.blocks[idx] = { ...this.doc.blocks[idx], ...patch, id };
    this.doc.metadata.updatedAt = new Date().toISOString();
    this.notify(sync);
  }

  public updatePOILive(id: string, patch: Partial<LevelPOI>, sync = true): void {
    const idx = this.doc.pois.findIndex((p) => p.id === id);
    if (idx === -1) return;
    this.doc.pois[idx] = { ...this.doc.pois[idx], ...patch, id };
    this.doc.metadata.updatedAt = new Date().toISOString();
    this.notify(sync);
  }

  public updateSectionEndpointsLive(start: Vec2, end: Vec2, sync = true): void {
    this.doc.sectionPlane.start = [Number(start[0].toFixed(2)), Number(start[1].toFixed(2))];
    this.doc.sectionPlane.end = [Number(end[0].toFixed(2)), Number(end[1].toFixed(2))];
    this.notify(sync);
  }

  public setSelection(sel: SelectionTarget): void {
    this.selection = sel;
    this.notify(false);
  }

  public getSelectedBlock(): LevelBlock | null {
    if (this.selection?.kind !== 'block') return null;
    return this.doc.blocks.find((b) => b.id === this.selection!.id) || null;
  }

  public getSelectedPOI(): LevelPOI | null {
    if (this.selection?.kind !== 'poi') return null;
    return this.doc.pois.find((p) => p.id === this.selection!.id) || null;
  }

  public appendEnemyWaypoint(pt: Vec3): void {
    let poi = this.getSelectedPOI();
    if (!poi) {
      // Find first enemy/sniper/boss POI
      poi =
        this.doc.pois.find(
          (p) => p.category === 'spawn_enemy' || p.category === 'sniper_nest' || p.category === 'boss'
        ) || null;
    }
    if (!poi) return;
    this.pushUndoSnapshot();
    if (!poi.enemyConfig) {
      poi.enemyConfig = {
        patrolMode: 'loop',
        waypoints: [],
        autoPathfind: true,
        patrolSpeed: 2.8,
        chaseSpeed: 5.8,
        hearingRange: 7.0,
      };
    }
    poi.enemyConfig.waypoints.push([
      Number(pt[0].toFixed(2)),
      Number(pt[1].toFixed(2)),
      Number(pt[2].toFixed(2)),
    ]);
    this.selection = { kind: 'poi', id: poi.id };
    this.lastAILog = `已为 [${poi.name}] 添加巡逻点 #${poi.enemyConfig.waypoints.length}: (${pt.join(', ')})`;
    this.notify(true);
  }

  public deleteSelected(): void {
    if (!this.selection) return;
    const { kind, id } = this.selection;
    // 先清空选中再派发，派发本身会通知一次，不必再额外通知
    this.selection = null;
    if (kind === 'block') this.dispatchAICommand({ action: 'delete_block', id });
    else if (kind === 'poi') this.dispatchAICommand({ action: 'delete_poi', id });
    else if (kind === 'path') this.dispatchAICommand({ action: 'delete_path', id });
    else if (kind === 'jump') this.dispatchAICommand({ action: 'delete_jump', id });
    else if (kind === 'sightline') this.dispatchAICommand({ action: 'delete_sightline', id });
  }

  public duplicateSelectedBlock(): void {
    const blk = this.getSelectedBlock();
    if (!blk) return;
    const clone = structuredClone(blk);
    delete (clone as Partial<LevelBlock>).id;
    clone.name = `${blk.name}_副本`;
    clone.position = [blk.position[0] + 1.0, blk.position[1], blk.position[2] + 1.0];
    this.dispatchAICommand({ action: 'add_block', block: clone });
  }

  public snapValue(val: number): number {
    const g = this.doc.metadata.gridSize || 0.5;
    return Math.round(val / g) * g;
  }

  public isOnlineStaticHost(): boolean {
    if (typeof window === 'undefined') return false;
    const h = window.location.hostname;
    const isLocal =
      h === 'localhost' ||
      h === '127.0.0.1' ||
      h === '[::1]' ||
      h.endsWith('.localhost') ||
      h.startsWith('192.168.') ||
      h.startsWith('10.') ||
      /^172\.(1[6-9]|2\d|3[01])\./.test(h);
    return !isLocal;
  }

  private connectBridge(): void {
    if (typeof window === 'undefined') return;
    if (this.isOnlineStaticHost()) {
      this.bridgeConnected = false;
      this.lastAILog = '🌐 在线网页版已就绪 (支持完整 3D/2D 编辑、实机漫游与引擎导出，数据自动保存在浏览器)';
      return;
    }
    const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${proto}//${window.location.host}/ws`;

    const scheduleReconnect = () => {
      // 指数退避：Bridge 没启动时不再每 5 秒刷一条连接失败
      window.setTimeout(connect, this.reconnectDelayMs);
      this.reconnectDelayMs = Math.min(RECONNECT_MAX_MS, this.reconnectDelayMs * 2);
    };

    const adoptServerDoc = (raw: unknown, message?: string): boolean => {
      const doc = normalizeLevelDocument(raw);
      if (!doc) return false;
      const prevDim = this.getDimensionMode();
      // 服务端文档即将覆盖本地，取消还没发出去的本地推送
      window.clearTimeout(this.serverPushTimer);
      this.serverPushTimer = undefined;
      this.hasUnsyncedLocalEdits = false;
      this.suppressServerSync = true;
      try {
        this.doc = doc;
        if (this.selection) {
          const { kind, id } = this.selection;
          const stillExists =
            (kind === 'block' && doc.blocks.some((b) => b.id === id)) ||
            (kind === 'poi' && doc.pois.some((p) => p.id === id)) ||
            (kind === 'path' && doc.paths.some((p) => p.id === id)) ||
            (kind === 'jump' && doc.jumps.some((j) => j.id === id)) ||
            (kind === 'sightline' && (doc.sightlines || []).some((s) => s.id === id));
          if (!stillExists) this.selection = null;
        }
        const nextDim = this.getDimensionMode();
        if (nextDim !== prevDim) {
          for (const fn of this.dimensionChangeListeners) fn(nextDim);
        }
        if (message) this.lastAILog = `[AI/Server] ${message}`;
        this.notify(false);
      } finally {
        this.suppressServerSync = false;
      }
      return true;
    };

    const connect = () => {
      let ws: WebSocket;
      try {
        ws = new WebSocket(wsUrl);
      } catch {
        scheduleReconnect();
        return;
      }
      this.ws = ws;

      ws.onopen = () => {
        this.bridgeConnected = true;
        this.reconnectDelayMs = RECONNECT_MIN_MS;
        this.notify(false);
        if (this.hasUnsyncedLocalEdits) {
          this.pushToServer();
          return;
        }
        fetch('/api/level')
          .then((r) => (r.ok ? r.json() : null))
          .then((data) => {
            if (this.hasUnsyncedLocalEdits) return;
            if (data && data.doc && Array.isArray(data.doc.blocks)) {
              if (data.doc.blocks.length === 0 && this.doc.blocks.length > 0) {
                // 服务端是空画布而浏览器已有本地关卡时，将本地关卡同步至服务端以保持一致
                this.pushToServer();
              } else {
                adoptServerDoc(data.doc);
              }
            }
          })
          .catch(() => {});
      };

      ws.onmessage = (ev) => {
        try {
          const msg = JSON.parse(ev.data);
          if (msg.type === 'level_updated' && msg.doc) {
            adoptServerDoc(msg.doc, msg.message);
          }
        } catch {
          // ignore malformed message
        }
      };

      ws.onclose = () => {
        if (this.ws === ws) this.ws = null;
        const wasConnected = this.bridgeConnected;
        this.bridgeConnected = false;
        if (wasConnected) this.notify(false);
        scheduleReconnect();
      };

      ws.onerror = () => {
        ws.close();
      };
    };

    connect();
  }

  /** 把高频的同步请求（拖拽时每次鼠标移动一次）合并成最多每 60ms 推送一次整份文档 */
  private queueServerPush(): void {
    if (this.isOnlineStaticHost()) return;
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      this.hasUnsyncedLocalEdits = true;
      return;
    }
    if (this.serverPushTimer !== undefined) return;
    this.serverPushTimer = window.setTimeout(() => {
      this.serverPushTimer = undefined;
      this.pushToServer();
    }, SERVER_PUSH_INTERVAL_MS);
  }

  private pushToServer(): void {
    if (this.isOnlineStaticHost()) return;
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(
        JSON.stringify({
          type: 'client_update',
          doc: this.doc,
        })
      );
      this.hasUnsyncedLocalEdits = false;
    } else {
      this.hasUnsyncedLocalEdits = true;
    }
  }

  private exposeGlobalAIAPI(): void {
    if (typeof window === 'undefined') return;
    (window as unknown as Record<string, unknown>).LevelForgeAI = {
      getDocument: () => structuredClone(this.doc),
      setDocument: (doc: LevelDocument) => this.setDocument(doc, true, true),
      execute: (cmd: AICommandAction | AICommandAction[]) => {
        if (Array.isArray(cmd)) {
          this.pushUndoSnapshot();
          const msgs: string[] = [];
          const ids: string[] = [];
          for (const single of cmd) {
            const res = applyAICommand(this.doc, single);
            this.doc = res.doc;
            msgs.push(res.message);
            ids.push(...res.affectedIds);
          }
          this.lastAILog = msgs.join(' | ');
          this.notify(true);
          return { messages: msgs, affectedIds: ids, audit: auditLevel(this.doc) };
        }
        const res = this.dispatchAICommand(cmd, true);
        return { ...res, audit: auditLevel(this.doc) };
      },
      audit: () => auditLevel(this.doc),
      computeCrossSection: () => computeCrossSection(this.doc),
      raycastLOS: (from: Vec3, to: Vec3) => raycastLevel3D(from, to, this.doc.blocks),
      evaluateJump: (from: Vec3, to: Vec3) => evaluateJumpLink(from, to, this.doc.metricsProfile, this.doc.blocks),
      help: () => ({
        description: 'LevelForge Browser & AI Agent Bridge API',
        exampleCommands: [
          { action: 'add_block', block: { name: '高台', type: 'box', role: 'walkable', position: [0, 2, -6], size: [8, 4, 6], floor: 1 } },
          { action: 'generate_room', center: [0, 0, 0], size: [16, 4, 16], doorways: ['north', 'south'] },
          { action: 'scatter_cover', boundsMin: [-6, 0, -6], boundsMax: [6, 0, 6], count: 5 },
          { action: 'set_section', section: { start: [-15, 0], end: [15, 0], slabDepth: 8 } },
        ],
      }),
    };
  }
}
