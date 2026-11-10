import {
  computeEnemyPathAStar,
  computePlayerCameraRig,
  computeVisibilityPolygon,
  evaluateEnemyDetection,
  evaluateJumpLink,
  FLOW_META,
  getBlockTopFootprint,
  getBlockWorldAABB,
  POI_META,
  raycastLevel3D,
  resolveSightlineEndpoints,
  resolveTriggerLinks,
  ROLE_META,
  sampleWalkableElevationAt,
} from '../core/geometry-analysis';
import { LevelStore } from '../core/store';
import { getTheme } from '../core/theme';
import { BlockType, LevelBlock, LevelPOI, POICategory, SightlineLink, Vec2, Vec3 } from '../core/types';

type DragInteraction =
  | { type: 'pan'; startMouse: Vec2; startPan: Vec2 }
  | { type: 'move_block'; id: string; startWorld: Vec2; origPos: Vec3 }
  | {
      type: 'resize_block';
      id: string;
      handle: 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw';
      startWorld: Vec2;
      origPos: Vec3;
      origSize: Vec3;
    }
  | { type: 'move_poi'; id: string; startWorld: Vec2; origPos: Vec3 }
  | { type: 'rotate_poi'; id: string; centerWorld: Vec2 }
  | { type: 'move_waypoint'; poiId: string; wpIndex: number }
  | { type: 'section_handle'; which: 'start' | 'end' | 'both'; startWorld: Vec2; origStart: Vec2; origEnd: Vec2 }
  | { type: 'draw_block'; blockType: BlockType; startWorld: Vec2; curWorld: Vec2 }
  | { type: 'draw_jump'; startWorld: Vec3; curWorld: Vec3; fromId?: string }
  | { type: 'ruler'; startWorld: Vec3; curWorld: Vec3; fromId?: string; fromHeightOffset: number };

export class ViewportTop2D {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private store: LevelStore;

  /** Pixels per meter */
  public zoom = 18;
  /** Pan offset in screen pixels relative to canvas center */
  public pan: Vec2 = [0, 0];

  private drag: DragInteraction | null = null;
  private mouseWorld: Vec2 = [0, 0];
  private spacePressed = false;
  public activePOICategory: POICategory = 'spawn_enemy';
  public activePathType: 'main' | 'flank' | 'secret' | 'patrol' = 'main';
  private buildingPathId: string | null = null;

  constructor(container: HTMLElement, store: LevelStore) {
    this.store = store;
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'viewport-canvas';
    container.appendChild(this.canvas);
    this.ctx = this.canvas.getContext('2d')!;

    this.bindEvents();
    const ro = new ResizeObserver(() => this.resize());
    ro.observe(container);
    this.resize();
    this.store.subscribeViewports(() => this.requestRender());
    this.store.onFrameSelected(() => this.frameSelected());
  }

  private renderQueued = false;

  /** store 通知触发的重绘合并到下一帧：同一帧内多次通知只画一次 */
  private requestRender(): void {
    if (this.renderQueued) return;
    this.renderQueued = true;
    requestAnimationFrame(() => {
      this.renderQueued = false;
      this.render();
    });
  }

  public resize(): void {
    const rect = this.canvas.parentElement?.getBoundingClientRect();
    if (!rect || rect.width === 0 || rect.height === 0) return;
    const dpr = window.devicePixelRatio || 1;
    this.canvas.width = Math.floor(rect.width * dpr);
    this.canvas.height = Math.floor(rect.height * dpr);
    this.canvas.style.width = `${rect.width}px`;
    this.canvas.style.height = `${rect.height}px`;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.render();
  }

  public resetCamera(): void {
    this.zoom = 18;
    this.pan = [0, 0];
    this.render();
  }

  public frameSelected(): void {
    const blk = this.store.getSelectedBlock();
    if (blk) {
      this.pan = [-blk.position[0] * this.zoom, -blk.position[2] * this.zoom];
      this.render();
      return;
    }
    const poi = this.store.getSelectedPOI();
    if (poi) {
      this.pan = [-poi.position[0] * this.zoom, -poi.position[2] * this.zoom];
      this.render();
    }
  }

  private worldToScreen(wx: number, wz: number): Vec2 {
    const cw = this.canvas.clientWidth;
    const ch = this.canvas.clientHeight;
    return [cw / 2 + this.pan[0] + wx * this.zoom, ch / 2 + this.pan[1] + wz * this.zoom];
  }

  private screenToWorld(sx: number, sy: number): Vec2 {
    const cw = this.canvas.clientWidth;
    const ch = this.canvas.clientHeight;
    return [(sx - cw / 2 - this.pan[0]) / this.zoom, (sy - ch / 2 - this.pan[1]) / this.zoom];
  }

  public getSurfaceElevationAt(wx: number, wz: number): number {
    const { groundY, blockId } = sampleWalkableElevationAt(wx, wz, this.store.doc.blocks);
    return blockId ? groundY : this.store.creationDefaults.baseY;
  }

  private isBlockVisibleOnCurrentFloor(b: LevelBlock): boolean {
    if (b.hidden) return false;
    if (this.store.overlays.floorFilter === 'all') return true;
    return b.floor === this.store.overlays.floorFilter;
  }

  private hitTestSectionHandle(sx: number, sy: number): 'start' | 'end' | 'both' | null {
    const { start, end } = this.store.doc.sectionPlane;
    const pStart = this.worldToScreen(start[0], start[1]);
    const pEnd = this.worldToScreen(end[0], end[1]);
    if (Math.hypot(sx - pStart[0], sy - pStart[1]) <= 11) return 'start';
    if (Math.hypot(sx - pEnd[0], sy - pEnd[1]) <= 11) return 'end';

    if (this.store.activeTool === 'edit_section') {
      const l2 = Math.hypot(pEnd[0] - pStart[0], pEnd[1] - pStart[1]) ** 2;
      if (l2 > 1) {
        const t = Math.max(
          0,
          Math.min(1, ((sx - pStart[0]) * (pEnd[0] - pStart[0]) + (sy - pStart[1]) * (pEnd[1] - pStart[1])) / l2)
        );
        const projX = pStart[0] + t * (pEnd[0] - pStart[0]);
        const projY = pStart[1] + t * (pEnd[1] - pStart[1]);
        if (Math.hypot(sx - projX, sy - projY) <= 9) return 'both';
      }
    }
    return null;
  }

  private hitTestEnemyWaypoint(sx: number, sy: number): { poiId: string; wpIndex: number } | null {
    for (const poi of this.store.doc.pois) {
      const wps = poi.enemyConfig?.waypoints;
      if (!wps) continue;
      for (let i = 0; i < wps.length; i++) {
        const [wx, wy] = this.worldToScreen(wps[i][0], wps[i][2]);
        if (Math.hypot(sx - wx, sy - wy) <= 9) {
          return { poiId: poi.id, wpIndex: i };
        }
      }
    }
    return null;
  }

  private hitTestPOI(sx: number, sy: number): { poi: LevelPOI; mode: 'move' | 'rotate' } | null {
    for (let i = this.store.doc.pois.length - 1; i >= 0; i--) {
      const poi = this.store.doc.pois[i];
      const [px, py] = this.worldToScreen(poi.position[0], poi.position[2]);
      if (this.store.selection?.kind === 'poi' && this.store.selection.id === poi.id) {
        const rad = (poi.yaw * Math.PI) / 180;
        const hx = px + Math.sin(rad) * 26;
        const hy = py - Math.cos(rad) * 26;
        if (Math.hypot(sx - hx, sy - hy) <= 9) {
          return { poi, mode: 'rotate' };
        }
      }
      if (Math.hypot(sx - px, sy - py) <= 11) {
        return { poi, mode: 'move' };
      }
    }
    return null;
  }

  private hitTestSelectedBlockHandles(
    sx: number,
    sy: number
  ): 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw' | null {
    const blk = this.store.getSelectedBlock();
    if (!blk || blk.locked || Math.abs(blk.rotation[1] % 180) > 1) return null;
    const [cx, , cz] = blk.position;
    const [w, , d] = blk.size;
    const [x0, z0] = this.worldToScreen(cx - w / 2, cz - d / 2);
    const [x1, z1] = this.worldToScreen(cx + w / 2, cz + d / 2);
    const mx = (x0 + x1) / 2;
    const mz = (z0 + z1) / 2;
    const handles: { key: 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw'; x: number; y: number }[] = [
      { key: 'nw', x: x0, y: z0 },
      { key: 'ne', x: x1, y: z0 },
      { key: 'se', x: x1, y: z1 },
      { key: 'sw', x: x0, y: z1 },
      { key: 'n', x: mx, y: z0 },
      { key: 's', x: mx, y: z1 },
      { key: 'w', x: x0, y: mz },
      { key: 'e', x: x1, y: mz },
    ];
    for (const h of handles) {
      if (Math.hypot(sx - h.x, sy - h.y) <= 8) return h.key;
    }
    return null;
  }

  private pointInPolygon2D(pt: Vec2, poly: Vec2[]): boolean {
    let inside = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const xi = poly[i][0], yi = poly[i][1];
      const xj = poly[j][0], yj = poly[j][1];
      const intersect = yi > pt[1] !== yj > pt[1] && pt[0] < ((xj - xi) * (pt[1] - yi)) / (yj - yi + 1e-9) + xi;
      if (intersect) inside = !inside;
    }
    return inside;
  }

  private hitTestBlock(wx: number, wz: number): LevelBlock | null {
    const candidates = this.store.doc.blocks
      .filter((b) => this.isBlockVisibleOnCurrentFloor(b))
      .slice()
      .sort((a, b) => {
        const topA = a.position[1] + a.size[1] / 2;
        const topB = b.position[1] + b.size[1] / 2;
        if (Math.abs(topB - topA) > 0.05) return topB - topA;
        return a.size[0] * a.size[2] - b.size[0] * b.size[2];
      });

    for (const b of candidates) {
      const poly = getBlockTopFootprint(b);
      if (this.pointInPolygon2D([wx, wz], poly)) {
        return b;
      }
    }
    return null;
  }

  /** Find an object (POI or non-ground Block, or ground Block) at screen/world position for Sightline / Jump binding */
  private findSnapObjectAt(sx: number, sy: number, wx: number, wz: number): {
    id?: string;
    pos: Vec3;
    heightOffset: number;
  } {
    const poiHit = this.hitTestPOI(sx, sy);
    if (poiHit) {
      const p = poiHit.poi;
      return {
        id: p.id,
        pos: [p.position[0], Number((p.position[1] + p.eyeHeight).toFixed(2)), p.position[2]],
        heightOffset: p.eyeHeight,
      };
    }
    const blkHit = this.hitTestBlock(wx, wz);
    if (blkHit) {
      const isWalkable = ROLE_META[blkHit.role]?.walkable;
      const hOffset = isWalkable ? this.store.doc.metricsProfile.eyeHeight : 0.15;
      const topY = blkHit.position[1] + blkHit.size[1] / 2 + hOffset;
      return {
        id: isWalkable ? undefined : blkHit.id,
        pos: [
          isWalkable ? Number(wx.toFixed(2)) : blkHit.position[0],
          Number(topY.toFixed(2)),
          isWalkable ? Number(wz.toFixed(2)) : blkHit.position[2],
        ],
        heightOffset: hOffset,
      };
    }
    const surfY = this.getSurfaceElevationAt(wx, wz);
    const eyeH = this.store.doc.metricsProfile.eyeHeight;
    return {
      pos: [Number(wx.toFixed(2)), Number((surfY + eyeH).toFixed(2)), Number(wz.toFixed(2))],
      heightOffset: eyeH,
    };
  }

  private bindEvents(): void {
    window.addEventListener('keydown', (e) => {
      if (e.code === 'Space' && document.activeElement?.tagName !== 'INPUT') {
        this.spacePressed = true;
      }
      if (e.key === 'Escape' && this.buildingPathId) {
        this.buildingPathId = null;
        this.render();
      }
    });
    window.addEventListener('keyup', (e) => {
      if (e.code === 'Space') {
        this.spacePressed = false;
      }
    });

    this.canvas.addEventListener('contextmenu', (e) => e.preventDefault());

    this.canvas.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        const rect = this.canvas.getBoundingClientRect();
        const sx = e.clientX - rect.left;
        const sy = e.clientY - rect.top;
        const before = this.screenToWorld(sx, sy);
        const factor = e.deltaY < 0 ? 1.12 : 0.89;
        this.zoom = Math.max(4, Math.min(85, this.zoom * factor));
        const after = this.screenToScreenDeltaForZoom(before, sx, sy);
        this.pan = after;
        this.render();
      },
      { passive: false }
    );

    this.canvas.addEventListener('mousedown', (e) => {
      const rect = this.canvas.getBoundingClientRect();
      const sx = e.clientX - rect.left;
      const sy = e.clientY - rect.top;
      const world = this.screenToWorld(sx, sy);
      this.mouseWorld = world;

      if (e.button === 1 || e.button === 2 || (e.button === 0 && (this.spacePressed || e.altKey))) {
        if (e.button === 2 && this.buildingPathId) {
          this.buildingPathId = null;
          this.render();
          return;
        }
        this.drag = { type: 'pan', startMouse: [sx, sy], startPan: [...this.pan] };
        return;
      }

      if (e.button !== 0) return;

      const secHit = this.hitTestSectionHandle(sx, sy);
      if (secHit) {
        this.store.pushUndoSnapshot();
        this.drag = {
          type: 'section_handle',
          which: secHit,
          startWorld: world,
          origStart: [...this.store.doc.sectionPlane.start],
          origEnd: [...this.store.doc.sectionPlane.end],
        };
        return;
      }

      const tool = this.store.activeTool;

      if (tool === 'add_enemy_waypoint') {
        const wx = this.store.snapValue(world[0]);
        const wz = this.store.snapValue(world[1]);
        const wy = this.getSurfaceElevationAt(wx, wz);
        this.store.appendEnemyWaypoint([wx, wy, wz]);
        return;
      }

      if (tool === 'edit_section') {
        this.store.pushUndoSnapshot();
        const snapped: Vec2 = [this.store.snapValue(world[0]), this.store.snapValue(world[1])];
        this.store.updateSectionEndpointsLive(snapped, [snapped[0] + 4, snapped[1]], false);
        this.drag = {
          type: 'section_handle',
          which: 'end',
          startWorld: snapped,
          origStart: snapped,
          origEnd: snapped,
        };
        return;
      }

      if (
        tool === 'draw_box' ||
        tool === 'draw_ramp' ||
        tool === 'draw_stairs' ||
        tool === 'draw_cylinder' ||
        tool === 'draw_arch'
      ) {
        const mapType: Record<string, BlockType> = {
          draw_box: 'box',
          draw_ramp: 'ramp',
          draw_stairs: 'stairs',
          draw_cylinder: 'cylinder',
          draw_arch: 'arch',
        };
        const snapped: Vec2 = [this.store.snapValue(world[0]), this.store.snapValue(world[1])];
        this.drag = {
          type: 'draw_block',
          blockType: mapType[tool],
          startWorld: snapped,
          curWorld: snapped,
        };
        return;
      }

      if (tool === 'place_poi') {
        const wx = this.store.snapValue(world[0]);
        const wz = this.store.snapValue(world[1]);
        const wy = this.getSurfaceElevationAt(wx, wz);
        const meta = POI_META[this.activePOICategory];
        this.store.dispatchAICommand({
          action: 'add_poi',
          poi: {
            name: meta.label.split(' ')[0],
            category: this.activePOICategory,
            position: [wx, wy, wz],
            yaw: 0,
            showVision:
              this.activePOICategory === 'sniper_nest' ||
              this.activePOICategory === 'spawn_enemy' ||
              this.activePOICategory === 'boss',
            fov: 85,
            visionRange: 20,
            eyeHeight: this.store.doc.metricsProfile.eyeHeight,
          },
        });
        return;
      }

      if (tool === 'draw_path') {
        const wx = this.store.snapValue(world[0]);
        const wz = this.store.snapValue(world[1]);
        const wy = Number((this.getSurfaceElevationAt(wx, wz) + 0.2).toFixed(2));
        if (!this.buildingPathId) {
          const res = this.store.dispatchAICommand({
            action: 'add_path',
            path: {
              name: `${FLOW_META[this.activePathType].label.split(' ')[0]}`,
              type: this.activePathType,
              points: [
                [wx, wy, wz],
                [wx + 1, wy, wz],
              ],
            },
          });
          this.buildingPathId = res.affectedIds[0] || null;
        } else {
          const p = this.store.doc.paths.find((x) => x.id === this.buildingPathId);
          if (p) {
            p.points[p.points.length - 1] = [wx, wy, wz];
            p.points.push([wx, wy, wz]);
            this.store.notify(true);
          }
        }
        return;
      }

      if (tool === 'measure_jump') {
        const wx = this.store.snapValue(world[0]);
        const wz = this.store.snapValue(world[1]);
        const wy = this.getSurfaceElevationAt(wx, wz);
        const blkHit = this.hitTestBlock(wx, wz);
        this.drag = {
          type: 'draw_jump',
          startWorld: [wx, wy, wz],
          curWorld: [wx, wy, wz],
          fromId: blkHit?.id,
        };
        return;
      }

      if (tool === 'measure_ruler') {
        const snapObj = this.findSnapObjectAt(sx, sy, world[0], world[1]);
        this.drag = {
          type: 'ruler',
          startWorld: snapObj.pos,
          curWorld: snapObj.pos,
          fromId: snapObj.id,
          fromHeightOffset: snapObj.heightOffset,
        };
        this.store.activeRuler = { start: snapObj.pos, end: snapObj.pos };
        this.store.notifyViewportsOnly(false);
        return;
      }

      // Check Enemy Patrol Waypoint hit first so user can drag patrol points directly!
      const wpHit = this.hitTestEnemyWaypoint(sx, sy);
      if (wpHit) {
        this.store.setSelection({ kind: 'poi', id: wpHit.poiId });
        this.store.pushUndoSnapshot();
        this.drag = {
          type: 'move_waypoint',
          poiId: wpHit.poiId,
          wpIndex: wpHit.wpIndex,
        };
        return;
      }

      const resizeHandle = this.hitTestSelectedBlockHandles(sx, sy);
      if (resizeHandle) {
        const blk = this.store.getSelectedBlock()!;
        this.store.pushUndoSnapshot();
        this.drag = {
          type: 'resize_block',
          id: blk.id,
          handle: resizeHandle,
          startWorld: world,
          origPos: [...blk.position],
          origSize: [...blk.size],
        };
        return;
      }

      const poiHit = this.hitTestPOI(sx, sy);
      if (poiHit) {
        this.store.setSelection({ kind: 'poi', id: poiHit.poi.id });
        this.store.pushUndoSnapshot();
        if (poiHit.mode === 'rotate') {
          this.drag = {
            type: 'rotate_poi',
            id: poiHit.poi.id,
            centerWorld: [poiHit.poi.position[0], poiHit.poi.position[2]],
          };
        } else {
          this.drag = {
            type: 'move_poi',
            id: poiHit.poi.id,
            startWorld: world,
            origPos: [...poiHit.poi.position],
          };
        }
        return;
      }

      const blkHit = this.hitTestBlock(world[0], world[1]);
      if (blkHit) {
        this.store.setSelection({ kind: 'block', id: blkHit.id });
        if (!blkHit.locked) {
          this.store.pushUndoSnapshot();
          this.drag = {
            type: 'move_block',
            id: blkHit.id,
            startWorld: world,
            origPos: [...blkHit.position],
          };
        }
        return;
      }

      this.store.setSelection(null);
    });

    window.addEventListener('mousemove', (e) => {
      const rect = this.canvas.getBoundingClientRect();
      const sx = e.clientX - rect.left;
      const sy = e.clientY - rect.top;
      const world = this.screenToWorld(sx, sy);
      this.mouseWorld = world;

      if (this.buildingPathId && this.store.activeTool === 'draw_path') {
        const p = this.store.doc.paths.find((x) => x.id === this.buildingPathId);
        if (p && p.points.length >= 2) {
          const wx = this.store.snapValue(world[0]);
          const wz = this.store.snapValue(world[1]);
          const wy = Number((this.getSurfaceElevationAt(wx, wz) + 0.2).toFixed(2));
          p.points[p.points.length - 1] = [wx, wy, wz];
          this.render();
        }
      }

      if (!this.drag) return;

      if (this.drag.type === 'pan') {
        this.pan = [
          this.drag.startPan[0] + (sx - this.drag.startMouse[0]),
          this.drag.startPan[1] + (sy - this.drag.startMouse[1]),
        ];
        this.render();
        return;
      }

      if (this.drag.type === 'move_waypoint') {
        const wx = this.store.snapValue(world[0]);
        const wz = this.store.snapValue(world[1]);
        const wy = this.getSurfaceElevationAt(wx, wz);
        const poi = this.store.doc.pois.find((p) => p.id === (this.drag as { poiId: string }).poiId);
        if (poi?.enemyConfig?.waypoints) {
          poi.enemyConfig.waypoints[(this.drag as { wpIndex: number }).wpIndex] = [wx, wy, wz];
          this.store.notifyViewportsOnly(false);
        }
        return;
      }

      if (this.drag.type === 'section_handle') {
        const dx = this.store.snapValue(world[0] - this.drag.startWorld[0]);
        const dz = this.store.snapValue(world[1] - this.drag.startWorld[1]);
        if (this.drag.which === 'start') {
          this.store.updateSectionEndpointsLive(
            [this.drag.origStart[0] + dx, this.drag.origStart[1] + dz],
            this.drag.origEnd,
            false
          );
        } else if (this.drag.which === 'end') {
          this.store.updateSectionEndpointsLive(
            this.drag.origStart,
            [this.drag.origEnd[0] + dx, this.drag.origEnd[1] + dz],
            false
          );
        } else {
          this.store.updateSectionEndpointsLive(
            [this.drag.origStart[0] + dx, this.drag.origStart[1] + dz],
            [this.drag.origEnd[0] + dx, this.drag.origEnd[1] + dz],
            false
          );
        }
        return;
      }

      if (this.drag.type === 'move_block') {
        const dx = this.store.snapValue(world[0] - this.drag.startWorld[0]);
        const dz = this.store.snapValue(world[1] - this.drag.startWorld[1]);
        this.store.updateBlockLive(
          this.drag.id,
          {
            position: [
              Number((this.drag.origPos[0] + dx).toFixed(2)),
              this.drag.origPos[1],
              Number((this.drag.origPos[2] + dz).toFixed(2)),
            ],
          },
          false
        );
        return;
      }

      if (this.drag.type === 'resize_block') {
        const dx = this.store.snapValue(world[0] - this.drag.startWorld[0]);
        const dz = this.store.snapValue(world[1] - this.drag.startWorld[1]);
        const h = this.drag.handle;
        let minX = this.drag.origPos[0] - this.drag.origSize[0] / 2;
        let maxX = this.drag.origPos[0] + this.drag.origSize[0] / 2;
        let minZ = this.drag.origPos[2] - this.drag.origSize[2] / 2;
        let maxZ = this.drag.origPos[2] + this.drag.origSize[2] / 2;

        if (h.includes('w')) minX = Math.min(maxX - 0.5, minX + dx);
        if (h.includes('e')) maxX = Math.max(minX + 0.5, maxX + dx);
        if (h.includes('n')) minZ = Math.min(maxZ - 0.5, minZ + dz);
        if (h.includes('s')) maxZ = Math.max(minZ + 0.5, maxZ + dz);

        this.store.updateBlockLive(
          this.drag.id,
          {
            position: [Number(((minX + maxX) / 2).toFixed(2)), this.drag.origPos[1], Number(((minZ + maxZ) / 2).toFixed(2))],
            size: [Number((maxX - minX).toFixed(2)), this.drag.origSize[1], Number((maxZ - minZ).toFixed(2))],
          },
          false
        );
        return;
      }

      if (this.drag.type === 'move_poi') {
        const wx = this.store.snapValue(world[0]);
        const wz = this.store.snapValue(world[1]);
        const wy = this.getSurfaceElevationAt(wx, wz);
        this.store.updatePOILive(this.drag.id, { position: [wx, wy, wz] }, false);
        return;
      }

      if (this.drag.type === 'rotate_poi') {
        const dx = world[0] - this.drag.centerWorld[0];
        const dz = world[1] - this.drag.centerWorld[1];
        let deg = Math.round((Math.atan2(dx, -dz) * 180) / Math.PI);
        if (deg < 0) deg += 360;
        const snapAngle = e.shiftKey ? 1 : 5;
        deg = Math.round(deg / snapAngle) * snapAngle;
        this.store.updatePOILive(this.drag.id, { yaw: deg }, false);
        return;
      }

      if (this.drag.type === 'draw_block') {
        this.drag.curWorld = [this.store.snapValue(world[0]), this.store.snapValue(world[1])];
        this.render();
        return;
      }

      if (this.drag.type === 'draw_jump') {
        const wx = this.store.snapValue(world[0]);
        const wz = this.store.snapValue(world[1]);
        const wy = this.getSurfaceElevationAt(wx, wz);
        this.drag.curWorld = [wx, wy, wz];
        this.render();
        return;
      }

      if (this.drag.type === 'ruler') {
        const snapObj = this.findSnapObjectAt(sx, sy, world[0], world[1]);
        this.drag.curWorld = snapObj.pos;
        this.store.activeRuler = { start: this.drag.startWorld, end: snapObj.pos };
        this.store.notifyViewportsOnly(false);
        return;
      }
    });

    window.addEventListener('mouseup', (e) => {
      if (!this.drag) return;
      const d = this.drag;
      this.drag = null;

      if (
        d.type === 'move_block' ||
        d.type === 'resize_block' ||
        d.type === 'move_poi' ||
        d.type === 'rotate_poi' ||
        d.type === 'move_waypoint' ||
        d.type === 'section_handle'
      ) {
        this.store.notify(true);
        return;
      }

      if (d.type === 'draw_block') {
        const w = Math.max(this.store.doc.metadata.gridSize || 0.5, Math.abs(d.curWorld[0] - d.startWorld[0]));
        const depth = Math.max(this.store.doc.metadata.gridSize || 0.5, Math.abs(d.curWorld[1] - d.startWorld[1]));
        const cx = Number(((d.startWorld[0] + d.curWorld[0]) / 2).toFixed(2));
        const cz = Number(((d.startWorld[1] + d.curWorld[1]) / 2).toFixed(2));
        const { role, floor, baseY, height } = this.store.creationDefaults;
        const h =
          role === 'walkable'
            ? 0.5
            : role === 'cover_low'
            ? this.store.doc.metricsProfile.lowCoverHeight
            : role === 'cover_full'
            ? this.store.doc.metricsProfile.fullCoverHeight
            : height;
        const cy = role === 'walkable' ? Number((baseY - h / 2).toFixed(2)) : Number((baseY + h / 2).toFixed(2));

        this.store.dispatchAICommand({
          action: 'add_block',
          block: {
            name: `${ROLE_META[role].label.split(' ')[0]}_${this.store.doc.blocks.length + 1}`,
            type: d.blockType,
            role,
            position: [cx, cy, cz],
            size: [Number(w.toFixed(2)), Number(h.toFixed(2)), Number(depth.toFixed(2))],
            rotation: [0, 0, 0],
            floor,
            color: this.store.creationDefaults.customColor,
          },
        });
        this.render();
      }

      if (d.type === 'draw_jump') {
        const dist = Math.hypot(d.curWorld[0] - d.startWorld[0], d.curWorld[2] - d.startWorld[2]);
        if (dist >= 0.5) {
          const blkEnd = this.hitTestBlock(d.curWorld[0], d.curWorld[2]);
          this.store.dispatchAICommand({
            action: 'add_jump',
            jump: {
              name: `跳跃标尺_${this.store.doc.jumps.length + 1}`,
              from: d.startWorld,
              to: d.curWorld,
              fromId: d.fromId,
              toId: blkEnd?.id,
            },
          });
        }
        this.render();
      }

      if (d.type === 'ruler') {
        const rect = this.canvas.getBoundingClientRect();
        const sx = e.clientX - rect.left;
        const sy = e.clientY - rect.top;
        const world = this.screenToWorld(sx, sy);
        const snapEnd = this.findSnapObjectAt(sx, sy, world[0], world[1]);
        const dist = Math.hypot(snapEnd.pos[0] - d.startWorld[0], snapEnd.pos[2] - d.startWorld[2]);
        this.store.activeRuler = null;
        if (dist >= 0.5) {
          this.store.dispatchAICommand({
            action: 'add_sightline',
            sightline: {
              name: `视线尺_${(this.store.doc.sightlines?.length || 0) + 1}`,
              fromId: d.fromId,
              toId: snapEnd.id,
              fromPos: d.startWorld,
              toPos: snapEnd.pos,
              fromHeightOffset: d.fromHeightOffset,
              toHeightOffset: snapEnd.heightOffset,
            },
          });
        } else {
          this.store.notifyViewportsOnly(false);
        }
      }
    });
  }

  private screenToScreenDeltaForZoom(worldPt: Vec2, sx: number, sy: number): Vec2 {
    const cw = this.canvas.clientWidth;
    const ch = this.canvas.clientHeight;
    return [sx - cw / 2 - worldPt[0] * this.zoom, sy - ch / 2 - worldPt[1] * this.zoom];
  }

  private elevationToHeatColor(topY: number): string {
    const t = Math.max(0, Math.min(1, (topY + 1) / 8));
    const hue = Math.round(210 - t * 185);
    return `hsl(${hue}, 70%, 42%)`;
  }

  public render(): void {
    const cw = this.canvas.clientWidth;
    const ch = this.canvas.clientHeight;
    if (cw === 0 || ch === 0) return;
    const ctx = this.ctx;

    ctx.fillStyle = getTheme().vp2dBg || '#0f172a';
    ctx.fillRect(0, 0, cw, ch);

    if (this.store.overlays.showGrid) {
      this.drawGrid(ctx, cw, ch);
    }

    const blocks = this.store.doc.blocks
      .filter((b) => this.isBlockVisibleOnCurrentFloor(b))
      .slice()
      .sort((a, b) => a.position[1] - a.size[1] / 2 - (b.position[1] - b.size[1] / 2));

    for (const b of blocks) {
      this.drawBlock2D(ctx, b);
    }

    if (this.store.overlays.showVisionCones) {
      for (const poi of this.store.doc.pois) {
        if (poi.category === 'spawn_player') {
          this.drawPlayerCameraAndVision2D(ctx, poi);
        } else if (poi.showVision) {
          this.drawVisionCone2D(ctx, poi);
        }
      }
    }

    // Draw Enemy Hearing Circles, Patrol Waypoints, A* Patrol Routes & A* Target Chase Routes!
    for (const poi of this.store.doc.pois) {
      if (poi.enemyConfig) {
        this.drawEnemyPatrolAndAggro2D(ctx, poi);
      }
    }

    if (this.store.overlays.showFlowPaths) {
      for (const path of this.store.doc.paths) {
        this.drawFlowPath2D(ctx, path);
      }
    }

    if (this.store.overlays.showJumpArcs) {
      for (const jmp of this.store.doc.jumps) {
        this.drawJumpLink2D(ctx, jmp.from, jmp.to, jmp.name, this.store.selection?.id === jmp.id);
      }
      if (this.drag?.type === 'draw_jump') {
        this.drawJumpLink2D(ctx, this.drag.startWorld, this.drag.curWorld, 'Preview Jump', true);
      }
    }

    // Persistent Object-Connected Sightline Rulers
    if (this.store.doc.sightlines) {
      for (const sl of this.store.doc.sightlines) {
        const resolved = resolveSightlineEndpoints(sl, this.store.doc);
        this.drawSightlineRuler2D(
          ctx,
          resolved.from,
          resolved.to,
          `${resolved.fromLabel} → ${resolved.toLabel}`,
          this.store.selection?.kind === 'sightline' && this.store.selection.id === sl.id
        );
      }
    }

    if (this.store.activeRuler) {
      this.drawSightlineRuler2D(ctx, this.store.activeRuler.start, this.store.activeRuler.end, '实时视线检测', true);
    }

    // Draw Key/Switch -> Door/Mechanism Dependency Links
    this.drawTriggerLinks2D(ctx);

    for (const poi of this.store.doc.pois) {
      this.drawPOI2D(ctx, poi);
    }

    if (this.store.playtestPose) {
      this.drawPlaytestAvatar2D(ctx);
    }

    if (this.drag?.type === 'draw_block') {
      this.drawPreviewBlock2D(ctx, this.drag.startWorld, this.drag.curWorld);
    }

    this.drawSectionCutLine2D(ctx);
    this.drawBlueprintHUD(ctx, cw, ch);
  }

  private drawEnemyPatrolAndAggro2D(ctx: CanvasRenderingContext2D, poi: LevelPOI): void {
    const cfg = poi.enemyConfig;
    if (!cfg) return;
    const [px, py] = this.worldToScreen(poi.position[0], poi.position[2]);

    ctx.save();
    // 1. Hearing Range Circle
    if (cfg.hearingRange > 0 && this.store.overlays.showVisionCones) {
      ctx.strokeStyle = 'rgba(56, 189, 248, 0.45)';
      ctx.fillStyle = 'rgba(56, 189, 248, 0.05)';
      ctx.lineWidth = 1.2;
      ctx.setLineDash([3, 4]);
      ctx.beginPath();
      ctx.arc(px, py, cfg.hearingRange * this.zoom, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // 2. Patrol Waypoints & A* Pathfinding Route
    if (cfg.waypoints && cfg.waypoints.length > 0) {
      const chain: Vec3[] = [poi.position, ...cfg.waypoints];
      if (cfg.patrolMode === 'loop' && cfg.waypoints.length >= 2) {
        chain.push(poi.position);
      }

      ctx.strokeStyle = '#fb923c';
      ctx.lineWidth = 2;
      ctx.setLineDash([6, 4]);
      ctx.beginPath();
      for (let i = 0; i < chain.length - 1; i++) {
        const segPts = cfg.autoPathfind
          ? computeEnemyPathAStar(chain[i], chain[i + 1], this.store.doc)
          : [chain[i], chain[i + 1]];
        for (let k = 0; k < segPts.length; k++) {
          const [sx, sy] = this.worldToScreen(segPts[k][0], segPts[k][2]);
          if (i === 0 && k === 0) ctx.moveTo(sx, sy);
          else ctx.lineTo(sx, sy);
        }
      }
      ctx.stroke();
      ctx.setLineDash([]);

      // Draw draggable waypoint nodes W1, W2...
      for (let i = 0; i < cfg.waypoints.length; i++) {
        const [wx, wy] = this.worldToScreen(cfg.waypoints[i][0], cfg.waypoints[i][2]);
        ctx.fillStyle = '#fb923c';
        ctx.beginPath();
        ctx.arc(wx, wy, 6.5, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = '#0f172a';
        ctx.lineWidth = 1.5;
        ctx.stroke();

        ctx.fillStyle = '#0f172a';
        ctx.font = 'bold 8px Inter, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(`W${i + 1}`, wx, wy);
      }
    }

    // 3. Target Detection & A* Chase Route (when selected or during simulation/playtest)
    const isSelected = this.store.selection?.kind === 'poi' && this.store.selection.id === poi.id;
    if (isSelected || this.store.isSimulatingEnemies || this.store.isPlaytesting) {
      const targetPoi =
        this.store.doc.pois.find((p) => p.id === cfg.targetId) ||
        this.store.doc.pois.find((p) => p.category === 'spawn_player');
      const targetPos: Vec3 | null = this.store.playtestPose
        ? this.store.playtestPose.position
        : targetPoi
        ? targetPoi.position
        : null;

      if (targetPos) {
        const det = evaluateEnemyDetection(poi, targetPos, this.store.doc);
        const isAlert = det.status === 'detected_visual' || det.status === 'detected_hearing';
        if (isSelected || isAlert) {
          ctx.strokeStyle = isAlert ? '#ef4444' : 'rgba(248, 113, 113, 0.45)';
          ctx.lineWidth = isAlert ? 2.6 : 1.6;
          ctx.setLineDash([4, 3]);
          ctx.beginPath();
          for (let i = 0; i < det.chasePath.length; i++) {
            const [cx, cy] = this.worldToScreen(det.chasePath[i][0], det.chasePath[i][2]);
            if (i === 0) ctx.moveTo(cx, cy);
            else ctx.lineTo(cx, cy);
          }
          ctx.stroke();
          ctx.setLineDash([]);

          // Status badge above enemy
          ctx.font = 'bold 10px Inter, sans-serif';
          const tag = `${det.statusLabel} · 寻路 ${det.chaseDistance}m (${det.chaseTimeSec}s)`;
          const tw = ctx.measureText(tag).width + 10;
          ctx.fillStyle = 'rgba(15, 23, 42, 0.9)';
          ctx.fillRect(px - tw / 2, py - 28, tw, 16);
          ctx.fillStyle = isAlert ? '#fca5a5' : '#cbd5e1';
          ctx.textAlign = 'center';
          ctx.fillText(tag, px, py - 17);
        }
      }
    }
    ctx.restore();
  }

  private drawGrid(ctx: CanvasRenderingContext2D, cw: number, ch: number): void {
    const [minWx, minWz] = this.screenToWorld(0, 0);
    const [maxWx, maxWz] = this.screenToWorld(cw, ch);

    const step = this.zoom >= 10 ? 1 : 5;
    const startX = Math.floor(minWx / step) * step;
    const endX = Math.ceil(maxWx / step) * step;
    const startZ = Math.floor(minWz / step) * step;
    const endZ = Math.ceil(maxWz / step) * step;

    ctx.lineWidth = 1;
    for (let x = startX; x <= endX; x += step) {
      const [sx] = this.worldToScreen(x, 0);
      ctx.strokeStyle = x === 0 ? 'rgba(56, 189, 248, 0.45)' : x % 5 === 0 ? 'rgba(148, 163, 184, 0.16)' : 'rgba(148, 163, 184, 0.06)';
      ctx.beginPath();
      ctx.moveTo(sx, 0);
      ctx.lineTo(sx, ch);
      ctx.stroke();
    }

    for (let z = startZ; z <= endZ; z += step) {
      const [, sy] = this.worldToScreen(0, z);
      ctx.strokeStyle = z === 0 ? 'rgba(56, 189, 248, 0.45)' : z % 5 === 0 ? 'rgba(148, 163, 184, 0.16)' : 'rgba(148, 163, 184, 0.06)';
      ctx.beginPath();
      ctx.moveTo(0, sy);
      ctx.lineTo(cw, sy);
      ctx.stroke();
    }
  }

  private drawBlock2D(ctx: CanvasRenderingContext2D, b: LevelBlock): void {
    const meta = ROLE_META[b.role] || ROLE_META.walkable;
    const isSelected = this.store.selection?.kind === 'block' && this.store.selection.id === b.id;
    const topY = Number((b.position[1] + b.size[1] / 2).toFixed(2));
    const fillColor = this.store.overlays.elevationHeatmap
      ? this.elevationToHeatColor(topY)
      : b.color || meta.color;

    ctx.save();
    const [cx, cy] = this.worldToScreen(b.position[0], b.position[2]);
    ctx.translate(cx, cy);
    ctx.rotate((-b.rotation[1] * Math.PI) / 180);

    const pw = b.size[0] * this.zoom;
    const pd = b.size[2] * this.zoom;

    ctx.globalAlpha = meta.fillAlpha;
    ctx.fillStyle = fillColor;

    if (b.type === 'cylinder') {
      ctx.beginPath();
      ctx.ellipse(0, 0, pw / 2, pd / 2, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.lineWidth = isSelected ? 2.5 : 1.2;
      ctx.strokeStyle = isSelected ? '#38bdf8' : 'rgba(226, 232, 240, 0.65)';
      ctx.stroke();
    } else {
      ctx.fillRect(-pw / 2, -pd / 2, pw, pd);
      ctx.globalAlpha = 1;
      ctx.lineWidth = isSelected ? 2.5 : 1.2;
      ctx.strokeStyle = isSelected ? '#38bdf8' : 'rgba(226, 232, 240, 0.65)';
      if (b.role.startsWith('trigger_')) {
        ctx.setLineDash([6, 4]);
      }
      ctx.strokeRect(-pw / 2, -pd / 2, pw, pd);
      ctx.setLineDash([]);
    }

    if (b.type === 'stairs') {
      const steps = Math.max(3, Math.min(16, b.steps || 8));
      ctx.strokeStyle = 'rgba(255,255,255,0.35)';
      ctx.lineWidth = 1;
      for (let i = 1; i < steps; i++) {
        const z = -pd / 2 + (i / steps) * pd;
        ctx.beginPath();
        ctx.moveTo(-pw / 2, z);
        ctx.lineTo(pw / 2, z);
        ctx.stroke();
      }
      this.drawLocalUpArrow(ctx, pd * 0.35, -pd * 0.35);
    } else if (b.type === 'ramp') {
      this.drawLocalUpArrow(ctx, pd * 0.35, -pd * 0.35);
    } else if (b.type === 'arch') {
      const pillarW = pw * 0.22;
      ctx.strokeStyle = 'rgba(255,255,255,0.5)';
      ctx.setLineDash([3, 3]);
      ctx.strokeRect(-pw / 2 + pillarW, -pd / 2, pw - pillarW * 2, pd);
      ctx.setLineDash([]);
    }

    if (this.store.overlays.showDimensions && pw > 38 && pd > 22) {
      ctx.fillStyle = '#f8fafc';
      ctx.font = '600 10px Inter, system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(b.name, 0, -2);

      ctx.fillStyle = 'rgba(226, 232, 240, 0.8)';
      ctx.font = '10px JetBrains Mono, monospace';
      const elevStr = `${topY >= 0 ? '+' : ''}${topY}m (${b.size[0]}×${b.size[2]}m)`;
      ctx.fillText(elevStr, 0, 11);
    }

    // Draw 📝 Design Note & Tag Badge on Block if present
    if (this.store.overlays.showDesignNotes && (b.notes || b.designTag) && pw > 24 && pd > 16) {
      const badgeTxt = b.designTag ? `📝 ${b.designTag.split(' ')[0]}` : '📝 备注';
      ctx.font = '600 9px Inter, sans-serif';
      const bw = Math.min(pw - 4, ctx.measureText(badgeTxt).width + 10);
      ctx.fillStyle = isSelected ? 'rgba(56, 189, 248, 0.92)' : 'rgba(15, 23, 42, 0.86)';
      ctx.fillRect(-bw / 2, -pd / 2 + 3, bw, 14);
      ctx.strokeStyle = isSelected ? '#ffffff' : '#facc15';
      ctx.lineWidth = 1;
      ctx.strokeRect(-bw / 2, -pd / 2 + 3, bw, 14);
      ctx.fillStyle = isSelected ? '#0f172a' : '#fef08a';
      ctx.textAlign = 'center';
      ctx.fillText(badgeTxt, 0, -pd / 2 + 13);
    }

    ctx.restore();

    if (isSelected && !b.locked && Math.abs(b.rotation[1] % 180) <= 1) {
      const [x0, z0] = this.worldToScreen(b.position[0] - b.size[0] / 2, b.position[2] - b.size[2] / 2);
      const [x1, z1] = this.worldToScreen(b.position[0] + b.size[0] / 2, b.position[2] + b.size[2] / 2);
      const mx = (x0 + x1) / 2;
      const mz = (z0 + z1) / 2;
      const pts: Vec2[] = [
        [x0, z0], [x1, z0], [x1, z1], [x0, z1],
        [mx, z0], [mx, z1], [x0, mz], [x1, mz],
      ];
      ctx.fillStyle = '#38bdf8';
      ctx.strokeStyle = '#0f172a';
      ctx.lineWidth = 1.5;
      for (const [hx, hy] of pts) {
        ctx.fillRect(hx - 4, hy - 4, 8, 8);
        ctx.strokeRect(hx - 4, hy - 4, 8, 8);
      }
    }
  }

  private drawLocalUpArrow(ctx: CanvasRenderingContext2D, fromY: number, toY: number): void {
    ctx.strokeStyle = '#facc15';
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.moveTo(0, fromY);
    ctx.lineTo(0, toY);
    ctx.lineTo(-5, toY + 7);
    ctx.moveTo(0, toY);
    ctx.lineTo(5, toY + 7);
    ctx.stroke();
  }

  private drawVisionCone2D(ctx: CanvasRenderingContext2D, poi: LevelPOI): void {
    const poly3D = computeVisibilityPolygon(poi, this.store.doc.blocks, 56);
    if (poly3D.length < 3) return;
    const meta = POI_META[poi.category] || POI_META.sniper_nest;

    ctx.save();
    ctx.beginPath();
    for (let i = 0; i < poly3D.length; i++) {
      const [sx, sy] = this.worldToScreen(poly3D[i][0], poly3D[i][2]);
      if (i === 0) ctx.moveTo(sx, sy);
      else ctx.lineTo(sx, sy);
    }
    ctx.closePath();

    ctx.fillStyle = meta.color;
    ctx.globalAlpha = 0.11;
    ctx.fill();

    ctx.globalAlpha = 0.55;
    ctx.strokeStyle = meta.color;
    ctx.lineWidth = 1.3;
    ctx.setLineDash([4, 3]);
    ctx.stroke();
    ctx.restore();
  }

  private drawPlayerCameraAndVision2D(ctx: CanvasRenderingContext2D, poi: LevelPOI): void {
    const m = this.store.doc.metricsProfile;
    const [px, py] = this.worldToScreen(poi.position[0], poi.position[2]);

    // 1. Player 3D Floor-Aware Vision Cone + 360° Peripheral Awareness Ring
    if (m.showPlayerVision ?? true) {
      const effectivePoi: LevelPOI = {
        ...poi,
        fov: m.playerVisionFov ?? poi.fov ?? 95,
        visionRange: m.playerVisionRange ?? poi.visionRange ?? 26,
        eyeHeight: m.eyeHeight ?? poi.eyeHeight ?? 1.65,
      };
      this.drawVisionCone2D(ctx, effectivePoi);

      const periph = m.playerPeripheralRange ?? 5.0;
      if (periph > 0) {
        ctx.save();
        ctx.strokeStyle = 'rgba(34, 197, 94, 0.55)';
        ctx.fillStyle = 'rgba(34, 197, 94, 0.06)';
        ctx.lineWidth = 1.2;
        ctx.setLineDash([3, 3]);
        ctx.beginPath();
        ctx.arc(px, py, periph * this.zoom, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        ctx.restore();
      }
    }

    // 2. Player Camera SpringArm Boom & 16:9 Frustum Footprint
    if (m.showPlayerCameraFrustum ?? true) {
      const rig = computePlayerCameraRig(poi.position, poi.yaw, m, this.store.doc.blocks);
      const [pivX, pivY] = this.worldToScreen(rig.pivotPos[0], rig.pivotPos[2]);
      const [camX, camY] = this.worldToScreen(rig.actualCamPos[0], rig.actualCamPos[2]);
      const [f0x, f0y] = this.worldToScreen(rig.frustumFar[0][0], rig.frustumFar[0][2]);
      const [f1x, f1y] = this.worldToScreen(rig.frustumFar[1][0], rig.frustumFar[1][2]);

      ctx.save();
      // Frustum horizontal wedge
      ctx.strokeStyle = 'rgba(56, 189, 248, 0.75)';
      ctx.fillStyle = 'rgba(56, 189, 248, 0.07)';
      ctx.lineWidth = 1.4;
      ctx.setLineDash([5, 3]);
      ctx.beginPath();
      ctx.moveTo(camX, camY);
      ctx.lineTo(f0x, f0y);
      ctx.lineTo(f1x, f1y);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.setLineDash([]);

      // SpringArm line from Pivot to Camera
      if (rig.idealDistance > 0.05) {
        ctx.strokeStyle = rig.springArmClipped ? '#f59e0b' : '#38bdf8';
        ctx.lineWidth = 2.2;
        ctx.beginPath();
        ctx.moveTo(pivX, pivY);
        ctx.lineTo(camX, camY);
        ctx.stroke();
      }

      // Camera Icon Badge
      ctx.fillStyle = rig.springArmClipped ? '#f59e0b' : '#0ea5e9';
      ctx.strokeStyle = '#0f172a';
      ctx.lineWidth = 1.5;
      ctx.fillRect(camX - 5, camY - 4, 10, 8);
      ctx.strokeRect(camX - 5, camY - 4, 10, 8);

      ctx.fillStyle = '#e0f2fe';
      ctx.font = 'bold 9px JetBrains Mono, monospace';
      ctx.textAlign = 'center';
      ctx.fillText(
        `🎥 ${rig.mode.toUpperCase()} FOV:${rig.cameraFov}°${rig.springArmClipped ? ' [防穿墙]' : ''}`,
        camX,
        camY + 14
      );
      ctx.restore();
    }
  }

  private drawFlowPath2D(ctx: CanvasRenderingContext2D, path: { id: string; name: string; type: keyof typeof FLOW_META; points: Vec3[] }): void {
    if (path.points.length < 2) return;
    const meta = FLOW_META[path.type] || FLOW_META.main;
    const isSel = this.store.selection?.kind === 'path' && this.store.selection.id === path.id;

    ctx.save();
    ctx.strokeStyle = meta.color;
    ctx.lineWidth = isSel ? 3.5 : 2.2;
    ctx.setLineDash(meta.dash);
    ctx.beginPath();
    let totalLen = 0;
    for (let i = 0; i < path.points.length; i++) {
      const [sx, sy] = this.worldToScreen(path.points[i][0], path.points[i][2]);
      if (i === 0) ctx.moveTo(sx, sy);
      else {
        ctx.lineTo(sx, sy);
        const p0 = path.points[i - 1];
        const p1 = path.points[i];
        totalLen += Math.hypot(p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]);
      }
    }
    ctx.stroke();
    ctx.setLineDash([]);

    for (let i = 0; i < path.points.length; i++) {
      const [sx, sy] = this.worldToScreen(path.points[i][0], path.points[i][2]);
      ctx.fillStyle = meta.color;
      ctx.beginPath();
      ctx.arc(sx, sy, 3.5, 0, Math.PI * 2);
      ctx.fill();

      if (i > 0) {
        const [px, py] = this.worldToScreen(path.points[i - 1][0], path.points[i - 1][2]);
        const mx = (px + sx) / 2;
        const my = (py + sy) / 2;
        const ang = Math.atan2(sy - py, sx - px);
        ctx.save();
        ctx.translate(mx, my);
        ctx.rotate(ang);
        ctx.beginPath();
        ctx.moveTo(-5, -4);
        ctx.lineTo(3, 0);
        ctx.lineTo(-5, 4);
        ctx.stroke();
        ctx.restore();
      }
    }

    const midIdx = Math.floor(path.points.length / 2);
    const [lx, ly] = this.worldToScreen(path.points[midIdx][0], path.points[midIdx][2]);
    const runSec = (totalLen / Math.max(0.5, this.store.doc.metricsProfile.runSpeed)).toFixed(1);
    ctx.fillStyle = 'rgba(15, 23, 42, 0.85)';
    const tag = `${path.name}: ${totalLen.toFixed(1)}m (~${runSec}s)`;
    ctx.font = '600 10px Inter, sans-serif';
    const tw = ctx.measureText(tag).width + 10;
    ctx.fillRect(lx - tw / 2, ly - 20, tw, 16);
    ctx.fillStyle = meta.color;
    ctx.textAlign = 'center';
    ctx.fillText(tag, lx, ly - 9);
    ctx.restore();
  }

  private drawJumpLink2D(ctx: CanvasRenderingContext2D, from: Vec3, to: Vec3, _label: string, selected: boolean): void {
    const evalRes = evaluateJumpLink(from, to, this.store.doc.metricsProfile, this.store.doc.blocks);
    const colorMap: Record<string, string> = {
      safe: '#22c55e',
      stretch: '#f59e0b',
      double_jump: '#38bdf8',
      blocked: '#ef4444',
      impossible: '#ef4444',
    };
    const col = colorMap[evalRes.status] || '#22c55e';
    const [x0, y0] = this.worldToScreen(from[0], from[2]);
    const [x1, y1] = this.worldToScreen(to[0], to[2]);
    const [rx, ry] = this.worldToScreen(evalRes.maxReachPoint[0], evalRes.maxReachPoint[2]);

    ctx.save();
    ctx.strokeStyle = 'rgba(226, 232, 240, 0.45)';
    ctx.lineWidth = 1.5;
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.lineTo(x1, y1);
    ctx.stroke();

    ctx.strokeStyle = col;
    ctx.lineWidth = selected ? 3.5 : 2.8;
    ctx.setLineDash([]);
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.lineTo(rx, ry);
    ctx.stroke();

    ctx.fillStyle = '#f8fafc';
    ctx.beginPath();
    ctx.arc(x0, y0, 4.5, 0, Math.PI * 2);
    ctx.fill();

    ctx.strokeStyle = '#f8fafc';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(x1, y1, 5, 0, Math.PI * 2);
    ctx.stroke();

    ctx.fillStyle = col;
    ctx.beginPath();
    ctx.arc(rx, ry, 6, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#0f172a';
    ctx.lineWidth = 1.5;
    ctx.stroke();

    const mx = (x0 + rx) / 2;
    const my = (y0 + ry) / 2;
    const showVerbose = selected || this.zoom >= 26;
    const shortStatus = evalRes.statusLabel.split(' ')[0];
    const txt = showVerbose
      ? `⤴ 目标${evalRes.horizontalDist}m / 可达${evalRes.effectiveMaxDistSingle}m · ${shortStatus}`
      : `⤴ ${evalRes.horizontalDist}m · ${shortStatus}`;
    ctx.font = '600 9.5px Inter, sans-serif';
    const tw = ctx.measureText(txt).width + 10;
    ctx.fillStyle = 'rgba(15, 23, 42, 0.9)';
    ctx.fillRect(mx - tw / 2, my - 20, tw, 16);
    ctx.strokeStyle = col;
    ctx.lineWidth = selected ? 1.5 : 1;
    ctx.strokeRect(mx - tw / 2, my - 20, tw, 16);
    ctx.fillStyle = col;
    ctx.textAlign = 'center';
    ctx.fillText(txt, mx, my - 9);
    ctx.restore();
  }

  private drawPOI2D(ctx: CanvasRenderingContext2D, poi: LevelPOI): void {
    const meta = POI_META[poi.category] || POI_META.objective;
    const isSel = this.store.selection?.kind === 'poi' && this.store.selection.id === poi.id;
    const [sx, sy] = this.worldToScreen(poi.position[0], poi.position[2]);

    ctx.save();
    const rad = (poi.yaw * Math.PI) / 180;
    const dx = Math.sin(rad);
    const dy = -Math.cos(rad);
    ctx.strokeStyle = meta.color;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(sx, sy);
    ctx.lineTo(sx + dx * 18, sy + dy * 18);
    ctx.stroke();

    if (isSel) {
      ctx.fillStyle = '#f8fafc';
      ctx.beginPath();
      ctx.arc(sx + dx * 26, sy + dy * 26, 4.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }

    ctx.fillStyle = meta.color;
    ctx.beginPath();
    ctx.arc(sx, sy, isSel ? 10 : 8, 0, Math.PI * 2);
    ctx.fill();
    ctx.lineWidth = isSel ? 2.5 : 1.5;
    ctx.strokeStyle = isSel ? '#ffffff' : '#0f172a';
    ctx.stroke();

    ctx.fillStyle = '#0f172a';
    ctx.font = 'bold 10px Inter, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(meta.icon, sx, sy + 0.5);

    ctx.fillStyle = '#f8fafc';
    ctx.font = '600 10px Inter, sans-serif';
    ctx.textBaseline = 'top';
    ctx.fillText(poi.name, sx, sy + 11);

    if (this.store.overlays.showDesignNotes && (poi.notes || poi.designTag)) {
      ctx.fillStyle = '#facc15';
      ctx.font = 'bold 9px Inter, sans-serif';
      ctx.fillText('📝', sx + 11, sy - 11);
    }
    ctx.restore();
  }

  private drawTriggerLinks2D(ctx: CanvasRenderingContext2D): void {
    const links = resolveTriggerLinks(this.store.doc);
    if (links.length === 0) return;

    ctx.save();
    for (const lnk of links) {
      const [x0, y0] = this.worldToScreen(lnk.fromPos[0], lnk.fromPos[2]);
      const [x1, y1] = this.worldToScreen(lnk.toPos[0], lnk.toPos[2]);
      ctx.strokeStyle = '#e879f9';
      ctx.lineWidth = 2;
      ctx.setLineDash([6, 4]);
      ctx.beginPath();
      ctx.moveTo(x0, y0);
      ctx.lineTo(x1, y1);
      ctx.stroke();
      ctx.setLineDash([]);

      const mx = (x0 + x1) / 2;
      const my = (y0 + y1) / 2;
      const selId = this.store.selection?.id;
      const isRelated = selId === lnk.fromId || selId === lnk.toId || this.zoom >= 26;
      const lbl = isRelated ? `🔑 联动: ${lnk.fromName} ➔ ${lnk.toName}` : `🔑 联动`;
      ctx.font = '600 9px Inter, sans-serif';
      const tw = ctx.measureText(lbl).width + 10;
      ctx.fillStyle = 'rgba(46, 16, 101, 0.88)';
      ctx.fillRect(mx - tw / 2, my - 8, tw, 15);
      ctx.strokeStyle = '#e879f9';
      ctx.lineWidth = 1;
      ctx.strokeRect(mx - tw / 2, my - 8, tw, 15);
      ctx.fillStyle = '#f5d0fe';
      ctx.textAlign = 'center';
      ctx.fillText(lbl, mx, my + 2);
    }
    ctx.restore();
  }

  private drawPlaytestAvatar2D(ctx: CanvasRenderingContext2D): void {
    const pose = this.store.playtestPose;
    if (!pose) return;
    ctx.save();
    if (pose.trail.length > 1) {
      ctx.strokeStyle = 'rgba(34, 197, 94, 0.7)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      for (let i = 0; i < pose.trail.length; i++) {
        const [tx, ty] = this.worldToScreen(pose.trail[i][0], pose.trail[i][2]);
        if (i === 0) ctx.moveTo(tx, ty);
        else ctx.lineTo(tx, ty);
      }
      ctx.stroke();
    }
    const [px, py] = this.worldToScreen(pose.position[0], pose.position[2]);
    const radPx = Math.max(7, this.store.doc.metricsProfile.playerRadius * this.zoom);
    const yawRad = (pose.yaw * Math.PI) / 180;
    const fx = Math.sin(yawRad);
    const fy = -Math.cos(yawRad);

    // Physical collision capsule circle
    ctx.fillStyle = 'rgba(56, 189, 248, 0.2)';
    ctx.strokeStyle = '#38bdf8';
    ctx.lineWidth = 1.5;
    ctx.setLineDash([3, 2]);
    ctx.beginPath();
    ctx.arc(px, py, radPx, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.setLineDash([]);

    // Facing direction arrow
    ctx.strokeStyle = '#facc15';
    ctx.lineWidth = 2.2;
    ctx.beginPath();
    ctx.moveTo(px, py);
    ctx.lineTo(px + fx * (radPx + 10), py + fy * (radPx + 10));
    ctx.stroke();

    // Top-down character shoulders & head
    ctx.save();
    ctx.translate(px, py);
    ctx.rotate(yawRad);
    ctx.fillStyle = '#0ea5e9';
    ctx.strokeStyle = '#f8fafc';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.roundRect(-radPx * 0.85, -radPx * 0.42, radPx * 1.7, radPx * 0.84, 3);
    ctx.fill();
    ctx.stroke();

    // Head helmet + yellow visor
    ctx.fillStyle = '#38bdf8';
    ctx.beginPath();
    ctx.arc(0, 0, Math.max(4, radPx * 0.48), 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = '#facc15';
    ctx.fillRect(-radPx * 0.32, -radPx * 0.52, radPx * 0.64, Math.max(2, radPx * 0.24));
    ctx.restore();

    // Compact elevation tag
    ctx.fillStyle = '#fef08a';
    ctx.font = 'bold 9.5px JetBrains Mono, monospace';
    ctx.textAlign = 'center';
    ctx.fillText(`🧍 Y:${pose.position[1].toFixed(1)}m`, px, py - radPx - 6);
    ctx.restore();
  }

  private drawPreviewBlock2D(ctx: CanvasRenderingContext2D, start: Vec2, cur: Vec2): void {
    const [x0, y0] = this.worldToScreen(start[0], start[1]);
    const [x1, y1] = this.worldToScreen(cur[0], cur[1]);
    const minX = Math.min(x0, x1);
    const minY = Math.min(y0, y1);
    const pw = Math.abs(x1 - x0);
    const ph = Math.abs(y1 - y0);

    ctx.save();
    ctx.fillStyle = 'rgba(56, 189, 248, 0.22)';
    ctx.strokeStyle = '#38bdf8';
    ctx.lineWidth = 2;
    ctx.setLineDash([5, 3]);
    ctx.fillRect(minX, minY, pw, ph);
    ctx.strokeRect(minX, minY, pw, ph);

    const wMeters = Math.abs(cur[0] - start[0]).toFixed(1);
    const dMeters = Math.abs(cur[1] - start[1]).toFixed(1);
    ctx.fillStyle = '#38bdf8';
    ctx.font = 'bold 11px JetBrains Mono, monospace';
    ctx.textAlign = 'center';
    ctx.fillText(`${wMeters}m × ${dMeters}m`, minX + pw / 2, minY + ph / 2 + 4);
    ctx.restore();
  }

  private drawSightlineRuler2D(
    ctx: CanvasRenderingContext2D,
    start: Vec3,
    end: Vec3,
    titlePrefix: string,
    selected: boolean
  ): void {
    const [x0, y0] = this.worldToScreen(start[0], start[2]);
    const [x1, y1] = this.worldToScreen(end[0], end[2]);
    const los = raycastLevel3D(start, end, this.store.doc.blocks);

    ctx.save();
    if (los.blocked && los.hitPoint) {
      const [hx, hy] = this.worldToScreen(los.hitPoint[0], los.hitPoint[2]);
      // Clear part in green
      ctx.strokeStyle = '#4ade80';
      ctx.lineWidth = selected ? 3 : 2.2;
      ctx.beginPath();
      ctx.moveTo(x0, y0);
      ctx.lineTo(hx, hy);
      ctx.stroke();

      // Occluded part behind obstacle in red dashed
      ctx.strokeStyle = '#ef4444';
      ctx.lineWidth = selected ? 2.5 : 2;
      ctx.setLineDash([5, 4]);
      ctx.beginPath();
      ctx.moveTo(hx, hy);
      ctx.lineTo(x1, y1);
      ctx.stroke();
      ctx.setLineDash([]);

      ctx.fillStyle = '#ef4444';
      ctx.beginPath();
      ctx.arc(hx, hy, 5.5, 0, Math.PI * 2);
      ctx.fill();
    } else {
      ctx.strokeStyle = '#4ade80';
      ctx.lineWidth = selected ? 3 : 2.2;
      ctx.beginPath();
      ctx.moveTo(x0, y0);
      ctx.lineTo(x1, y1);
      ctx.stroke();
    }

    ctx.fillStyle = '#f8fafc';
    ctx.beginPath();
    ctx.arc(x0, y0, 4, 0, Math.PI * 2);
    ctx.arc(x1, y1, 4, 0, Math.PI * 2);
    ctx.fill();

    const mx = (x0 + x1) / 2;
    const my = (y0 + y1) / 2;
    const label = los.blocked
      ? `📏 [${titlePrefix}] ${los.distance}m | 被 [${los.hitBlockName}] 遮挡 (@${los.hitDistance}m)`
      : `📏 [${titlePrefix}] ${los.distance}m | 3D视线畅通 (Clear LOS)`;
    ctx.font = '600 10px Inter, sans-serif';
    const tw = ctx.measureText(label).width + 12;
    ctx.fillStyle = 'rgba(15, 23, 42, 0.92)';
    ctx.fillRect(mx - tw / 2, my - 18, tw, 17);
    ctx.strokeStyle = los.blocked ? '#ef4444' : '#4ade80';
    ctx.lineWidth = 1;
    ctx.strokeRect(mx - tw / 2, my - 18, tw, 17);
    ctx.fillStyle = los.blocked ? '#fca5a5' : '#86efac';
    ctx.textAlign = 'center';
    ctx.fillText(label, mx, my - 6);
    ctx.restore();
  }

  private drawSectionCutLine2D(ctx: CanvasRenderingContext2D): void {
    const { start, end, slabDepth, flipNormal } = this.store.doc.sectionPlane;
    const [x0, y0] = this.worldToScreen(start[0], start[1]);
    const [x1, y1] = this.worldToScreen(end[0], end[1]);
    const dx = x1 - x0;
    const dy = y1 - y0;
    const len = Math.hypot(dx, dy);
    if (len < 2) return;

    const tx = dx / len;
    const ty = dy / len;
    const sign = flipNormal ? -1 : 1;
    const nx = -ty * sign;
    const ny = tx * sign;
    const slabPx = slabDepth * this.zoom;

    ctx.save();
    ctx.fillStyle = 'rgba(244, 63, 94, 0.07)';
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.lineTo(x1, y1);
    ctx.lineTo(x1 + nx * slabPx, y1 + ny * slabPx);
    ctx.lineTo(x0 + nx * slabPx, y0 + ny * slabPx);
    ctx.closePath();
    ctx.fill();

    ctx.strokeStyle = '#fb7185';
    ctx.lineWidth = 2.2;
    ctx.setLineDash([10, 5, 2, 5]);
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.lineTo(x1, y1);
    ctx.stroke();
    ctx.setLineDash([]);

    const drawTick = (px: number, py: number, tag: string) => {
      ctx.strokeStyle = '#f43f5e';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(px, py);
      ctx.lineTo(px + nx * 18, py + ny * 18);
      ctx.stroke();

      ctx.fillStyle = '#f43f5e';
      ctx.beginPath();
      ctx.arc(px, py, 8, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 10px Inter, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(tag, px, py);
    };

    drawTick(x0, y0, 'A');
    drawTick(x1, y1, "A'");
    ctx.restore();
  }

  private drawBlueprintHUD(ctx: CanvasRenderingContext2D, _cw: number, ch: number): void {
    const barMeters = 5;
    const barPx = barMeters * this.zoom;
    ctx.save();
    ctx.fillStyle = 'rgba(15, 23, 42, 0.78)';
    ctx.fillRect(10, ch - 32, Math.max(95, barPx + 145), 22);
    ctx.strokeStyle = '#94a3b8';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(18, ch - 22);
    ctx.lineTo(18, ch - 16);
    ctx.lineTo(18 + barPx, ch - 16);
    ctx.lineTo(18 + barPx, ch - 22);
    ctx.stroke();
    ctx.fillStyle = '#e2e8f0';
    ctx.font = '10px JetBrains Mono, monospace';
    ctx.fillText(`${barMeters}m | XZ: (${this.mouseWorld[0].toFixed(1)}, ${this.mouseWorld[1].toFixed(1)})`, 24 + barPx, ch - 17);
    ctx.restore();
  }
}
