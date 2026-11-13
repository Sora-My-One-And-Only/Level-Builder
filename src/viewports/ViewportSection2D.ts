import {
  computeCrossSection,
  computePlayerCameraRig,
  evaluateJumpLink,
  POI_META,
  raycastLevel3D,
  resolveSightlineEndpoints,
  resolveTriggerLinks,
  ROLE_META,
} from '../core/geometry-analysis';
import { LevelStore } from '../core/store';
import { getTheme } from '../core/theme';
import { BlockType, CrossSectionSliceItem, LevelPOI, Vec2, Vec3 } from '../core/types';

type SectionDrag =
  | { type: 'pan'; startMouse: Vec2; startPan: Vec2; moved?: boolean; button?: number }
  | { type: 'move_uv'; id: string; startU: number; startV: number; origPos: Vec3; moved?: boolean }
  | { type: 'resize_top'; id: string; startV: number; origY: number; origH: number; moved?: boolean }
  | { type: 'resize_width'; id: string; side: 'left' | 'right'; startU: number; origPos: Vec3; origW: number; moved?: boolean }
  | { type: 'move_poi_uv'; id: string; startU: number; startV: number; origPos: Vec3; moved?: boolean }
  | { type: 'draw_block_uv'; blockType: BlockType; startUV: Vec2; curUV: Vec2 }
  | { type: 'draw_jump_uv'; startUV: Vec2; curUV: Vec2 }
  | { type: 'ruler_uv'; startUV: Vec2; curUV: Vec2 };

export class ViewportSection2D {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private store: LevelStore;

  /** Pixels per meter */
  public zoom = 22;
  /** Screen pan offset */
  public pan: Vec2 = [0, 35];

  private drag: SectionDrag | null = null;
  private mouseUV: Vec2 = [0, 0];
  private hatchPatternCache = new Map<string, CanvasPattern>();
  public onContextMenu?: (ev: {
    clientX: number;
    clientY: number;
    target: { kind: 'block' | 'poi'; id: string } | null;
    worldPt?: Vec3;
  }) => void;

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
    this.zoom = 22;
    this.pan = [0, 35];
    this.render();
  }

  public frameSelected(): void {
    const sel = this.store.selection;
    if (!sel) {
      this.resetCamera();
      return;
    }
    const { sectionLength } = computeCrossSection(this.store.doc);
    const { start, end } = this.store.doc.sectionPlane;
    const tx = (end[0] - start[0]) / Math.max(0.1, sectionLength);
    const tz = (end[1] - start[1]) / Math.max(0.1, sectionLength);
    let targetPos: Vec3 | null = null;
    if (sel.kind === 'block') {
      const b = this.store.doc.blocks.find((x) => x.id === sel.id);
      if (b) targetPos = b.position;
    } else if (sel.kind === 'poi') {
      const p = this.store.doc.pois.find((x) => x.id === sel.id);
      if (p) targetPos = p.position;
    }
    if (!targetPos) return;
    const u = (targetPos[0] - start[0]) * tx + (targetPos[2] - start[1]) * tz;
    const v = targetPos[1];
    const centerU = sectionLength / 2;
    this.zoom = Math.max(this.zoom, 24);
    this.pan = [-(u - centerU) * this.zoom, v * this.zoom];
    this.render();
  }

  /** Section coordinate u in [0, L], v = world Y (up is positive) */
  private uvToScreen(u: number, v: number, sectionLen: number): Vec2 {
    const cw = this.canvas.clientWidth;
    const ch = this.canvas.clientHeight;
    const centerU = sectionLen / 2;
    return [
      cw / 2 + this.pan[0] + (u - centerU) * this.zoom,
      ch / 2 + this.pan[1] - v * this.zoom,
    ];
  }

  private screenToUV(sx: number, sy: number, sectionLen: number): Vec2 {
    const cw = this.canvas.clientWidth;
    const ch = this.canvas.clientHeight;
    const centerU = sectionLen / 2;
    return [
      (sx - cw / 2 - this.pan[0]) / this.zoom + centerU,
      -(sy - ch / 2 - this.pan[1]) / this.zoom,
    ];
  }

  private getHatchPattern(color: string): CanvasPattern | null {
    if (this.hatchPatternCache.has(color)) {
      return this.hatchPatternCache.get(color)!;
    }
    const off = document.createElement('canvas');
    off.width = 12;
    off.height = 12;
    const octx = off.getContext('2d');
    if (!octx) return null;

    octx.fillStyle = color;
    octx.globalAlpha = 0.28;
    octx.fillRect(0, 0, 12, 12);

    octx.globalAlpha = 0.7;
    octx.strokeStyle = color;
    octx.lineWidth = 1.4;
    octx.beginPath();
    octx.moveTo(0, 12);
    octx.lineTo(12, 0);
    octx.moveTo(-6, 6);
    octx.lineTo(6, -6);
    octx.moveTo(6, 18);
    octx.lineTo(18, 6);
    octx.stroke();

    const pat = this.ctx.createPattern(off, 'repeat');
    if (pat) this.hatchPatternCache.set(color, pat);
    return pat;
  }

  private pointInPoly(pt: Vec2, poly: Vec2[]): boolean {
    let inside = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const xi = poly[i][0], yi = poly[i][1];
      const xj = poly[j][0], yj = poly[j][1];
      const intersect = yi > pt[1] !== yj > pt[1] && pt[0] < ((xj - xi) * (pt[1] - yi)) / (yj - yi + 1e-9) + xi;
      if (intersect) inside = !inside;
    }
    return inside;
  }

  private bindEvents(): void {
    this.canvas.addEventListener('contextmenu', (e) => e.preventDefault());

    this.canvas.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        const factor = e.deltaY < 0 ? 1.12 : 0.89;
        this.zoom = Math.max(6, Math.min(80, this.zoom * factor));
        this.render();
      },
      { passive: false }
    );

    this.canvas.addEventListener('mousedown', (e) => {
      const rect = this.canvas.getBoundingClientRect();
      const sx = e.clientX - rect.left;
      const sy = e.clientY - rect.top;
      const { sectionLength, items } = computeCrossSection(this.store.doc);
      const uv = this.screenToUV(sx, sy, sectionLength);
      this.mouseUV = uv;

      if (e.button === 1 || e.button === 2) {
        this.drag = { type: 'pan', startMouse: [sx, sy], startPan: [...this.pan], moved: false, button: e.button };
        return;
      }

      if (e.button !== 0) return;

      const { start, end } = this.store.doc.sectionPlane;
      const tx = (end[0] - start[0]) / Math.max(0.1, sectionLength);
      const tz = (end[1] - start[1]) / Math.max(0.1, sectionLength);
      const uvToWorld3D = (u: number, v: number): Vec3 => [
        Number((start[0] + u * tx).toFixed(2)),
        Number(v.toFixed(2)),
        Number((start[1] + u * tz).toFixed(2)),
      ];

      const tool = this.store.activeTool;

      // 1. Creation Tools directly inside 2D Section / 2D Side-Scroller View!
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
        const snappedUV: Vec2 = [this.store.snapValue(uv[0]), this.store.snapValue(uv[1])];
        this.drag = {
          type: 'draw_block_uv',
          blockType: mapType[tool],
          startUV: snappedUV,
          curUV: snappedUV,
        };
        return;
      }

      if (tool === 'place_poi') {
        const pt = uvToWorld3D(this.store.snapValue(uv[0]), this.store.snapValue(uv[1]));
        const cat = this.store.creationDefaults.poiCategory || 'spawn_enemy';
        const meta = POI_META[cat] || POI_META.spawn_enemy;
        this.store.dispatchAICommand({
          action: 'add_poi',
          poi: {
            name: `${meta.label.split(' ')[0]}_${this.store.doc.pois.length + 1}`,
            category: cat,
            position: pt,
            yaw: 90,
            showVision:
              this.store.getDimensionMode() !== '2d_side' &&
              (cat === 'sniper_nest' || cat === 'spawn_enemy' || cat === 'boss'),
            fov: 90,
            visionRange: 16,
            eyeHeight: this.store.doc.metricsProfile.eyeHeight,
          },
        });
        return;
      }

      if (tool === 'measure_jump') {
        const snappedUV: Vec2 = [this.store.snapValue(uv[0]), this.store.snapValue(uv[1])];
        this.drag = {
          type: 'draw_jump_uv',
          startUV: snappedUV,
          curUV: snappedUV,
        };
        return;
      }

      if (tool === 'measure_ruler') {
        const snappedUV: Vec2 = [this.store.snapValue(uv[0]), this.store.snapValue(uv[1])];
        const pt3D = uvToWorld3D(snappedUV[0], snappedUV[1]);
        this.store.activeRuler = { start: pt3D, end: pt3D };
        this.drag = {
          type: 'ruler_uv',
          startUV: snappedUV,
          curUV: snappedUV,
        };
        this.render();
        return;
      }

      // 2. Hit test POIs in Section / 2D Side View
      let hitPoi: LevelPOI | null = null;
      for (let i = this.store.doc.pois.length - 1; i >= 0; i--) {
        const p = this.store.doc.pois[i];
        const pu = (p.position[0] - start[0]) * tx + (p.position[2] - start[1]) * tz;
        const [psx, psy] = this.uvToScreen(pu, p.position[1] + p.eyeHeight * 0.6, sectionLength);
        if (Math.hypot(sx - psx, sy - psy) <= 13) {
          hitPoi = p;
          break;
        }
      }

      if (hitPoi) {
        this.store.setSelection({ kind: 'poi', id: hitPoi.id });
        this.drag = {
          type: 'move_poi_uv',
          id: hitPoi.id,
          startU: uv[0],
          startV: uv[1],
          origPos: [...hitPoi.position],
          moved: false,
        };
        return;
      }

      // 3. Hit test cut polygons first, then slab projections
      let hitItem: CrossSectionSliceItem | null = null;
      for (let i = items.length - 1; i >= 0; i--) {
        const it = items[i];
        if (it.cutPolygons.some((poly) => this.pointInPoly(uv, poly))) {
          hitItem = it;
          break;
        }
      }
      if (!hitItem) {
        for (let i = items.length - 1; i >= 0; i--) {
          const it = items[i];
          if (
            it.slabProjections.some(
              ([u0, y0, u1, y1]) => uv[0] >= u0 && uv[0] <= u1 && uv[1] >= y0 && uv[1] <= y1
            )
          ) {
            hitItem = it;
            break;
          }
        }
      }

      if (hitItem) {
        const blk = hitItem.block;
        this.store.setSelection({ kind: 'block', id: blk.id });
        if (!blk.locked) {
          const topY = blk.position[1] + blk.size[1] / 2;
          const centerU = (blk.position[0] - start[0]) * tx + (blk.position[2] - start[1]) * tz;
          const leftU = centerU - blk.size[0] / 2;
          const rightU = centerU + blk.size[0] / 2;

          // Edge handles: Top height resize, Left/Right width resize, or X+Y (UV) move
          if (Math.abs(uv[1] - topY) * this.zoom <= 9) {
            this.drag = {
              type: 'resize_top',
              id: blk.id,
              startV: uv[1],
              origY: blk.position[1],
              origH: blk.size[1],
              moved: false,
            };
          } else if (Math.abs(uv[0] - rightU) * this.zoom <= 9) {
            this.drag = {
              type: 'resize_width',
              id: blk.id,
              side: 'right',
              startU: uv[0],
              origPos: [...blk.position],
              origW: blk.size[0],
              moved: false,
            };
          } else if (Math.abs(uv[0] - leftU) * this.zoom <= 9) {
            this.drag = {
              type: 'resize_width',
              id: blk.id,
              side: 'left',
              startU: uv[0],
              origPos: [...blk.position],
              origW: blk.size[0],
              moved: false,
            };
          } else {
            this.drag = {
              type: 'move_uv',
              id: blk.id,
              startU: uv[0],
              startV: uv[1],
              origPos: [...blk.position],
              moved: false,
            };
          }
        }
        return;
      }

      // Otherwise pan with left-drag on empty space
      this.drag = { type: 'pan', startMouse: [sx, sy], startPan: [...this.pan] };
    });

    window.addEventListener('mousemove', (e) => {
      const rect = this.canvas.getBoundingClientRect();
      const sx = e.clientX - rect.left;
      const sy = e.clientY - rect.top;
      const { sectionLength } = computeCrossSection(this.store.doc);
      const uv = this.screenToUV(sx, sy, sectionLength);
      this.mouseUV = uv;

      if (!this.drag) {
        this.render();
        return;
      }

      const { start, end } = this.store.doc.sectionPlane;
      const tx = (end[0] - start[0]) / Math.max(0.1, sectionLength);
      const tz = (end[1] - start[1]) / Math.max(0.1, sectionLength);

      if (this.drag.type === 'pan') {
        const dx = sx - this.drag.startMouse[0];
        const dy = sy - this.drag.startMouse[1];
        if (!this.drag.moved && Math.hypot(dx, dy) < 4) return;
        this.drag.moved = true;
        this.pan = [this.drag.startPan[0] + dx, this.drag.startPan[1] + dy];
        this.render();
        return;
      }

      if (this.drag.type === 'draw_block_uv' || this.drag.type === 'draw_jump_uv') {
        this.drag.curUV = [this.store.snapValue(uv[0]), this.store.snapValue(uv[1])];
        this.render();
        return;
      }

      if (this.drag.type === 'ruler_uv') {
        this.drag.curUV = [this.store.snapValue(uv[0]), this.store.snapValue(uv[1])];
        const uvToWorld3D = (u: number, v: number): Vec3 => [
          Number((start[0] + u * tx).toFixed(2)),
          Number(v.toFixed(2)),
          Number((start[1] + u * tz).toFixed(2)),
        ];
        this.store.activeRuler = {
          start: uvToWorld3D(this.drag.startUV[0], this.drag.startUV[1]),
          end: uvToWorld3D(this.drag.curUV[0], this.drag.curUV[1]),
        };
        this.store.notifyViewportsOnly(false);
        return;
      }

      if (this.drag.type === 'move_poi_uv') {
        const dragId = this.drag.id;
        const du = this.store.snapValue(uv[0] - this.drag.startU);
        const dv = Math.round((uv[1] - this.drag.startV) / 0.25) * 0.25;
        if (Math.abs(du) < 1e-4 && Math.abs(dv) < 1e-4 && !this.drag.moved) return;
        if (!this.drag.moved) {
          this.store.pushUndoSnapshot();
          this.drag.moved = true;
        }
        this.store.updatePOILive(
          dragId,
          {
            position: [
              Number((this.drag.origPos[0] + du * tx).toFixed(2)),
              Number((this.drag.origPos[1] + dv).toFixed(2)),
              Number((this.drag.origPos[2] + du * tz).toFixed(2)),
            ],
          },
          false
        );
        return;
      }

      if (this.drag.type === 'move_uv') {
        const dragId = this.drag.id;
        const du = this.store.snapValue(uv[0] - this.drag.startU);
        const dv = Math.round((uv[1] - this.drag.startV) / 0.25) * 0.25;
        if (Math.abs(du) < 1e-4 && Math.abs(dv) < 1e-4 && !this.drag.moved) return;
        const blk = this.store.doc.blocks.find((b) => b.id === dragId);
        if (blk) {
          if (!this.drag.moved) {
            this.store.pushUndoSnapshot();
            this.drag.moved = true;
          }
          this.store.updateBlockLive(
            blk.id,
            {
              position: [
                Number((this.drag.origPos[0] + du * tx).toFixed(2)),
                Number((this.drag.origPos[1] + dv).toFixed(2)),
                Number((this.drag.origPos[2] + du * tz).toFixed(2)),
              ],
            },
            false
          );
        }
        return;
      }

      if (this.drag.type === 'resize_width') {
        const dragId = this.drag.id;
        const du = this.store.snapValue(uv[0] - this.drag.startU);
        if (Math.abs(du) < 1e-4 && !this.drag.moved) return;
        const blk = this.store.doc.blocks.find((b) => b.id === dragId);
        if (blk) {
          if (!this.drag.moved) {
            this.store.pushUndoSnapshot();
            this.drag.moved = true;
          }
          const sign = this.drag.side === 'right' ? 1 : -1;
          const newW = Math.max(0.5, Number((this.drag.origW + du * sign).toFixed(2)));
          const deltaW = newW - this.drag.origW;
          const shiftU = (deltaW / 2) * sign;
          this.store.updateBlockLive(
            blk.id,
            {
              position: [
                Number((this.drag.origPos[0] + shiftU * tx).toFixed(2)),
                this.drag.origPos[1],
                Number((this.drag.origPos[2] + shiftU * tz).toFixed(2)),
              ],
              size: [newW, blk.size[1], blk.size[2]],
            },
            false
          );
        }
        return;
      }

      if (this.drag.type === 'resize_top') {
        const dragId = this.drag.id;
        const dy = Math.round((uv[1] - this.drag.startV) / 0.1) * 0.1;
        if (Math.abs(dy) < 1e-4 && !this.drag.moved) return;
        const blk = this.store.doc.blocks.find((b) => b.id === dragId);
        if (blk) {
          if (!this.drag.moved) {
            this.store.pushUndoSnapshot();
            this.drag.moved = true;
          }
          const bottomY = this.drag.origY - this.drag.origH / 2;
          const newH = Math.max(0.2, Number((this.drag.origH + dy).toFixed(2)));
          const newY = Number((bottomY + newH / 2).toFixed(2));
          this.store.updateBlockLive(
            blk.id,
            {
              position: [blk.position[0], newY, blk.position[2]],
              size: [blk.size[0], newH, blk.size[2]],
            },
            false
          );
        }
      }
    });

    window.addEventListener('mouseup', (e) => {
      if (!this.drag) return;
      const d = this.drag;
      this.drag = null;

      const { sectionLength, items } = computeCrossSection(this.store.doc);
      const { start, end } = this.store.doc.sectionPlane;
      const tx = (end[0] - start[0]) / Math.max(0.1, sectionLength);
      const tz = (end[1] - start[1]) / Math.max(0.1, sectionLength);
      const uvToWorld3D = (u: number, v: number): Vec3 => [
        Number((start[0] + u * tx).toFixed(2)),
        Number(v.toFixed(2)),
        Number((start[1] + u * tz).toFixed(2)),
      ];

      if (d.type === 'pan') {
        if (d.button === 2 && !d.moved) {
          const rect = this.canvas.getBoundingClientRect();
          if (
            e.clientX >= rect.left &&
            e.clientX <= rect.right &&
            e.clientY >= rect.top &&
            e.clientY <= rect.bottom
          ) {
            const sx = e.clientX - rect.left;
            const sy = e.clientY - rect.top;
            const uv = this.screenToUV(sx, sy, sectionLength);
            const pt3D = uvToWorld3D(this.store.snapValue(uv[0]), this.store.snapValue(uv[1]));

            for (let i = this.store.doc.pois.length - 1; i >= 0; i--) {
              const p = this.store.doc.pois[i];
              const pu = (p.position[0] - start[0]) * tx + (p.position[2] - start[1]) * tz;
              const [psx, psy] = this.uvToScreen(pu, p.position[1] + p.eyeHeight * 0.6, sectionLength);
              if (Math.hypot(sx - psx, sy - psy) <= 13) {
                this.store.setSelection({ kind: 'poi', id: p.id });
                this.onContextMenu?.({
                  clientX: e.clientX,
                  clientY: e.clientY,
                  target: { kind: 'poi', id: p.id },
                  worldPt: pt3D,
                });
                return;
              }
            }

            let hitItem: CrossSectionSliceItem | null = null;
            for (let i = items.length - 1; i >= 0; i--) {
              const it = items[i];
              if (it.cutPolygons.some((poly) => this.pointInPoly(uv, poly))) {
                hitItem = it;
                break;
              }
            }
            if (!hitItem) {
              for (let i = items.length - 1; i >= 0; i--) {
                const it = items[i];
                if (
                  it.slabProjections.some(
                    ([u0, y0, u1, y1]) => uv[0] >= u0 && uv[0] <= u1 && uv[1] >= y0 && uv[1] <= y1
                  )
                ) {
                  hitItem = it;
                  break;
                }
              }
            }
            if (hitItem) {
              this.store.setSelection({ kind: 'block', id: hitItem.block.id });
              this.onContextMenu?.({
                clientX: e.clientX,
                clientY: e.clientY,
                target: { kind: 'block', id: hitItem.block.id },
                worldPt: pt3D,
              });
              return;
            }

            this.onContextMenu?.({
              clientX: e.clientX,
              clientY: e.clientY,
              target: null,
              worldPt: pt3D,
            });
          }
        }
        return;
      }

      if (d.type === 'draw_block_uv') {
        const w = Math.max(1.0, Math.abs(d.curUV[0] - d.startUV[0]) || 3.0);
        const h = Math.max(0.4, Math.abs(d.curUV[1] - d.startUV[1]) || 0.8);
        const midU = (d.startUV[0] + d.curUV[0]) / 2;
        const midV = (d.startUV[1] + d.curUV[1]) / 2;
        const center3D = uvToWorld3D(midU, midV);
        const depth = this.store.getDimensionMode() === '2d_side' ? 2.5 : 4.0;
        const role = this.store.creationDefaults.role;
        this.store.dispatchAICommand({
          action: 'add_block',
          block: {
            name: `${ROLE_META[role].label.split(' ')[0]}_${this.store.doc.blocks.length + 1}`,
            type: d.blockType,
            role,
            position: center3D,
            size: [Number(w.toFixed(2)), Number(h.toFixed(2)), depth],
            rotation: [0, 0, 0],
            floor: this.store.creationDefaults.floor,
            color: this.store.creationDefaults.customColor,
          },
        });
        return;
      }

      if (d.type === 'draw_jump_uv') {
        const dist = Math.hypot(d.curUV[0] - d.startUV[0], d.curUV[1] - d.startUV[1]);
        if (dist >= 0.5) {
          this.store.dispatchAICommand({
            action: 'add_jump',
            jump: {
              name: `跳跃标尺_${this.store.doc.jumps.length + 1}`,
              from: uvToWorld3D(d.startUV[0], d.startUV[1]),
              to: uvToWorld3D(d.curUV[0], d.curUV[1]),
            },
          });
        }
        return;
      }

      if (d.type === 'ruler_uv') {
        const dist = Math.hypot(d.curUV[0] - d.startUV[0], d.curUV[1] - d.startUV[1]);
        this.store.activeRuler = null;
        if (dist >= 0.5) {
          this.store.dispatchAICommand({
            action: 'add_sightline',
            sightline: {
              name: `视线尺_${(this.store.doc.sightlines?.length || 0) + 1}`,
              fromPos: uvToWorld3D(d.startUV[0], d.startUV[1]),
              toPos: uvToWorld3D(d.curUV[0], d.curUV[1]),
              fromHeightOffset: 0,
              toHeightOffset: 0,
            },
          });
        } else {
          this.store.notifyViewportsOnly(false);
        }
        return;
      }

      if (
        d.type === 'move_uv' ||
        d.type === 'resize_top' ||
        d.type === 'resize_width' ||
        d.type === 'move_poi_uv'
      ) {
        if (d.moved) {
          this.store.notify(true);
        }
      }
    });
  }

  private placedLabelBoxes: { x0: number; y0: number; x1: number; y1: number }[] = [];

  private tryPlaceLabel(cx: number, cy: number, w: number, h: number, force = false): boolean {
    const pad = 3;
    const box = { x0: cx - w / 2 - pad, y0: cy - h / 2 - pad, x1: cx + w / 2 + pad, y1: cy + h / 2 + pad };
    if (!force) {
      for (const b of this.placedLabelBoxes) {
        if (box.x0 < b.x1 && box.x1 > b.x0 && box.y0 < b.y1 && box.y1 > b.y0) {
          return false;
        }
      }
    }
    this.placedLabelBoxes.push(box);
    return true;
  }

  public render(): void {
    const cw = this.canvas.clientWidth;
    const ch = this.canvas.clientHeight;
    if (cw === 0 || ch === 0) return;
    const ctx = this.ctx;
    this.placedLabelBoxes = [];

    ctx.fillStyle = getTheme().vp2dBg || '#090d16';
    ctx.fillRect(0, 0, cw, ch);

    const { sectionLength, items } = computeCrossSection(this.store.doc);

    // 1. Elevation Grid & Section Bounds (0 .. sectionLength)
    this.drawSectionGrid(ctx, cw, ch, sectionLength);

    // 2. Background Slab Projections (Faded Elevation Silhouettes)
    for (const item of items) {
      if (item.cutPolygons.length === 0 && item.slabProjections.length > 0) {
        this.drawSlabProjection(ctx, item, sectionLength);
      }
    }

    // 3. Primary Cut Polygons with Architectural Hatching
    for (const item of items) {
      if (item.cutPolygons.length > 0) {
        this.drawCutPolygons(ctx, item, sectionLength);
      }
    }

    // 4. Project Jump Arcs & POIs near the Section Line
    this.drawProjectedJumpArcsAndPOIs(ctx, sectionLength);

    // 5. Character Scale Capsule & Jump Envelope Reference at Mouse or Selected Block
    if (this.store.overlays.showScaleHuman) {
      this.drawCharacterScaleReference(ctx, sectionLength, items);
    }

    // 5.5 Draw Playtest Avatar & Preview Box/Jump when drawing in 2D Section / Side-Scroller View
    this.drawSectionPreviewAndPlaytest(ctx, sectionLength);

    // 6. Section Header Legend
    this.drawSectionHUD(ctx, cw, ch, sectionLength, items.length);
  }

  private drawSectionGrid(
    ctx: CanvasRenderingContext2D,
    cw: number,
    ch: number,
    sectionLen: number
  ): void {
    // Draw vertical boundaries for A (u=0) and A' (u=sectionLen)
    const [ax] = this.uvToScreen(0, 0, sectionLen);
    const [apx] = this.uvToScreen(sectionLen, 0, sectionLen);

    ctx.save();
    ctx.fillStyle = 'rgba(30, 41, 59, 0.25)';
    ctx.fillRect(ax, 0, apx - ax, ch);

    // Horizontal elevation lines (-4m to +12m)
    for (let y = -4; y <= 14; y += 1) {
      const [, sy] = this.uvToScreen(0, y, sectionLen);
      if (sy < 0 || sy > ch) continue;
      const isGround = y === 0;
      const isFloorDatum = y % 3 === 0;
      ctx.strokeStyle = isGround
        ? 'rgba(56, 189, 248, 0.65)'
        : isFloorDatum
        ? 'rgba(148, 163, 184, 0.25)'
        : 'rgba(148, 163, 184, 0.08)';
      ctx.lineWidth = isGround ? 1.6 : 1;
      ctx.beginPath();
      ctx.moveTo(0, sy);
      ctx.lineTo(cw, sy);
      ctx.stroke();

      if (isGround || isFloorDatum) {
        ctx.fillStyle = isGround ? '#38bdf8' : '#64748b';
        ctx.font = '10px JetBrains Mono, monospace';
        ctx.fillText(`${y >= 0 ? '+' : ''}${y}.0m`, 8, sy - 4);
      }
    }

    // Vertical distance ticks along section line
    for (let u = 0; u <= sectionLen; u += 2) {
      const [sx] = this.uvToScreen(u, 0, sectionLen);
      ctx.strokeStyle = u === 0 || u >= sectionLen - 0.1 ? 'rgba(244, 63, 94, 0.5)' : 'rgba(148, 163, 184, 0.07)';
      ctx.beginPath();
      ctx.moveTo(sx, 0);
      ctx.lineTo(sx, ch);
      ctx.stroke();
    }

    // Labels for A and A'
    ctx.fillStyle = '#fb7185';
    ctx.font = 'bold 10.5px Inter, sans-serif';
    ctx.fillText('A (0m)', ax + 6, 20);
    ctx.fillText(`A' (${sectionLen.toFixed(1)}m)`, Math.max(ax + 70, apx - 85), 20);
    ctx.restore();
  }

  private elevationToHeatColor(topY: number): string {
    const t = Math.max(0, Math.min(1, (topY + 1) / 8));
    const hue = Math.round(210 - t * 185);
    return `hsl(${hue}, 70%, 42%)`;
  }

  private drawSlabProjection(
    ctx: CanvasRenderingContext2D,
    item: CrossSectionSliceItem,
    sectionLen: number
  ): void {
    const meta = ROLE_META[item.block.role] || ROLE_META.walkable;
    const isSel = this.store.selection?.kind === 'block' && this.store.selection.id === item.block.id;
    const topY = Number((item.block.position[1] + item.block.size[1] / 2).toFixed(2));
    const baseCol = this.store.overlays.elevationHeatmap
      ? this.elevationToHeatColor(topY)
      : item.block.color || meta.color;

    ctx.save();
    for (const [u0, y0, u1, y1] of item.slabProjections) {
      const [sx0, sy0] = this.uvToScreen(u0, y1, sectionLen);
      const [sx1, sy1] = this.uvToScreen(u1, y0, sectionLen);
      const w = sx1 - sx0;
      const h = sy1 - sy0;

      ctx.fillStyle = baseCol;
      ctx.globalAlpha = 0.12;
      ctx.fillRect(sx0, sy0, w, h);

      ctx.globalAlpha = isSel ? 0.9 : 0.35;
      ctx.strokeStyle = isSel ? '#38bdf8' : baseCol;
      ctx.lineWidth = isSel ? 2 : 1;
      ctx.setLineDash([4, 4]);
      ctx.strokeRect(sx0, sy0, w, h);
      ctx.setLineDash([]);

      if (isSel && this.store.overlays.showDimensions) {
        ctx.globalAlpha = 0.9;
        ctx.fillStyle = '#cbd5e1';
        ctx.font = '9px Inter, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(item.block.name, sx0 + w / 2, sy0 + h / 2 + 3);
      }
    }
    ctx.restore();
  }

  private drawCutPolygons(
    ctx: CanvasRenderingContext2D,
    item: CrossSectionSliceItem,
    sectionLen: number
  ): void {
    const meta = ROLE_META[item.block.role] || ROLE_META.walkable;
    const topY = Number((item.block.position[1] + item.block.size[1] / 2).toFixed(2));
    const col = this.store.overlays.elevationHeatmap
      ? this.elevationToHeatColor(topY)
      : item.block.color || meta.color;
    const isSel = this.store.selection?.kind === 'block' && this.store.selection.id === item.block.id;
    const hatch = this.getHatchPattern(col);

    ctx.save();
    let minSx = Infinity, maxSx = -Infinity, minSy = Infinity, maxSy = -Infinity;

    for (const poly of item.cutPolygons) {
      if (poly.length < 3) continue;
      ctx.beginPath();
      for (let i = 0; i < poly.length; i++) {
        const [sx, sy] = this.uvToScreen(poly[i][0], poly[i][1], sectionLen);
        if (sx < minSx) minSx = sx;
        if (sx > maxSx) maxSx = sx;
        if (sy < minSy) minSy = sy;
        if (sy > maxSy) maxSy = sy;
        if (i === 0) ctx.moveTo(sx, sy);
        else ctx.lineTo(sx, sy);
      }
      ctx.closePath();

      ctx.fillStyle = hatch || col;
      ctx.fill();

      ctx.lineWidth = isSel ? 2.6 : 1.8;
      ctx.strokeStyle = isSel ? '#38bdf8' : item.warning ? '#ef4444' : '#f8fafc';
      ctx.stroke();
    }

    // Draw top elevation & slope callout on cut geometry (with collision avoidance so labels never pile up)
    const spanPx = maxSx - minSx;
    const isTrigger = item.block.role.startsWith('trigger_');
    if (this.store.overlays.showDimensions && (isSel || (!isTrigger && spanPx > 52))) {
      const cx = (minSx + maxSx) / 2;
      ctx.font = '600 9.5px Inter, sans-serif';
      const label = item.slopeAngle !== undefined
        ? `${item.block.name} (${item.slopeAngle}°)`
        : isSel || spanPx > 82
        ? `${item.block.name} (${topY >= 0 ? '+' : ''}${topY}m)`
        : item.block.name;
      const lw = ctx.measureText(label).width + 8;
      const labelY = minSy - 6;
      if (this.tryPlaceLabel(cx, labelY, lw, 14, isSel)) {
        ctx.fillStyle = isSel ? '#38bdf8' : '#e2e8f0';
        ctx.textAlign = 'center';
        ctx.fillText(label, cx, labelY);
      }

      if (item.warning) {
        ctx.fillStyle = '#fca5a5';
        ctx.font = 'bold 9.5px Inter, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(`⚠ ${item.warning}`, cx, minSy - 18);
      }

      if (item.block.role === 'one_way_platform' && (isSel || spanPx > 60)) {
        ctx.fillStyle = '#5eead4';
        ctx.font = 'bold 8.5px Inter, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('▲ 单向跳台', cx, minSy + 11);
      }
    }

    // Draw Left/Right/Top resize handles on selected block in Section/2D Side View
    if (isSel && !item.block.locked && maxSx > minSx) {
      const midX = (minSx + maxSx) / 2;
      const midY = (minSy + maxSy) / 2;
      ctx.fillStyle = '#38bdf8';
      ctx.strokeStyle = '#0f172a';
      ctx.lineWidth = 1.5;
      for (const [hx, hy] of [
        [midX, minSy],
        [minSx, midY],
        [maxSx, midY],
      ]) {
        ctx.fillRect(hx - 4, hy - 4, 8, 8);
        ctx.strokeRect(hx - 4, hy - 4, 8, 8);
      }
    }

    ctx.restore();
  }

  private drawProjectedJumpArcsAndPOIs(ctx: CanvasRenderingContext2D, sectionLen: number): void {
    const { start, end, slabDepth, flipNormal } = this.store.doc.sectionPlane;
    const dx = end[0] - start[0];
    const dz = end[1] - start[1];
    const tx = dx / sectionLen;
    const tz = dz / sectionLen;
    const sign = flipNormal ? -1 : 1;
    const nx = -tz * sign;
    const nz = tx * sign;

    const project = (wx: number, wz: number): { u: number; dist: number } => ({
      u: (wx - start[0]) * tx + (wz - start[1]) * tz,
      dist: (wx - start[0]) * nx + (wz - start[1]) * nz,
    });

    // Project JumpLinks within slab band
    if (this.store.overlays.showJumpArcs) {
      for (const jmp of this.store.doc.jumps) {
        const pFrom = project(jmp.from[0], jmp.from[2]);
        const pTo = project(jmp.to[0], jmp.to[2]);
        if (Math.abs(pFrom.dist) <= slabDepth && Math.abs(pTo.dist) <= slabDepth) {
          const evalRes = evaluateJumpLink(jmp.from, jmp.to, this.store.doc.metricsProfile, this.store.doc.blocks);
          const col =
            evalRes.status === 'safe'
              ? '#22c55e'
              : evalRes.status === 'stretch'
              ? '#f59e0b'
              : evalRes.status === 'double_jump'
              ? '#38bdf8'
              : '#ef4444';

          ctx.save();
          // 1. Target curve (dashed)
          ctx.strokeStyle = 'rgba(226, 232, 240, 0.45)';
          ctx.lineWidth = 1.5;
          ctx.setLineDash([4, 4]);
          ctx.beginPath();
          for (let i = 0; i < evalRes.arcPoints.length; i++) {
            const pt = evalRes.arcPoints[i];
            const pu = project(pt[0], pt[2]).u;
            const [sx, sy] = this.uvToScreen(pu, pt[1], sectionLen);
            if (i === 0) ctx.moveTo(sx, sy);
            else ctx.lineTo(sx, sy);
          }
          ctx.stroke();

          // 2. Dynamic Capability Parabola (solid, stretches & rises live with speed/jumpHeight/jumpDistance!)
          ctx.strokeStyle = col;
          ctx.lineWidth = 2.6;
          ctx.setLineDash([]);
          ctx.beginPath();
          for (let i = 0; i < evalRes.capabilityArcPoints.length; i++) {
            const pt = evalRes.capabilityArcPoints[i];
            const pu = project(pt[0], pt[2]).u;
            const [sx, sy] = this.uvToScreen(pu, pt[1], sectionLen);
            if (i === 0) ctx.moveTo(sx, sy);
            else ctx.lineTo(sx, sy);
          }
          ctx.stroke();
          ctx.restore();
        }
      }
    }

    // Project POIs near section plane
    for (const poi of this.store.doc.pois) {
      const pr = project(poi.position[0], poi.position[2]);
      if (pr.u >= 0 && pr.u <= sectionLen && pr.dist >= -3 && pr.dist <= slabDepth) {
        const meta = POI_META[poi.category] || POI_META.objective;
        const [sx, sy] = this.uvToScreen(pr.u, poi.position[1], sectionLen);
        const [, eyeSy] = this.uvToScreen(pr.u, poi.position[1] + poi.eyeHeight, sectionLen);

        ctx.save();
        // Draw standing stick/capsule for POI
        ctx.strokeStyle = meta.color;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(sx, sy);
        ctx.lineTo(sx, eyeSy);
        ctx.stroke();

        ctx.fillStyle = meta.color;
        ctx.beginPath();
        ctx.arc(sx, eyeSy, 5, 0, Math.PI * 2);
        ctx.fill();
        const isPoiSel = this.store.selection?.kind === 'poi' && this.store.selection.id === poi.id;
        ctx.font = '600 9px Inter, sans-serif';
        const poiLw = ctx.measureText(poi.name).width + 6;
        if (this.tryPlaceLabel(sx, eyeSy - 10, poiLw, 12, isPoiSel)) {
          ctx.textAlign = 'center';
          ctx.fillText(poi.name, sx, eyeSy - 8);
        }

        // If Player Spawn, project Vertical Camera Pitch + Vertical FOV Frustum Cone onto Section View!
        if (poi.category === 'spawn_player' && (this.store.doc.metricsProfile.showPlayerCameraFrustum ?? true)) {
          const mp = this.store.doc.metricsProfile;
          const rig = computePlayerCameraRig(poi.position, poi.yaw, mp, this.store.doc.blocks);
          const pCam = project(rig.actualCamPos[0], rig.actualCamPos[2]);
          const [camSx, camSy] = this.uvToScreen(pCam.u, rig.actualCamPos[1], sectionLen);
          const pLook = project(rig.lookTarget[0], rig.lookTarget[2]);
          const [lookSx, lookSy] = this.uvToScreen(pLook.u, rig.lookTarget[1], sectionLen);
          const pTop = project(rig.frustumFar[0][0], rig.frustumFar[0][2]);
          const [topSx, topSy] = this.uvToScreen(pTop.u, rig.frustumFar[0][1], sectionLen);
          const pBot = project(rig.frustumFar[3][0], rig.frustumFar[3][2]);
          const [botSx, botSy] = this.uvToScreen(pBot.u, rig.frustumFar[3][1], sectionLen);

          // SpringArm boom in section view
          ctx.strokeStyle = rig.springArmClipped ? '#f59e0b' : '#38bdf8';
          ctx.lineWidth = 1.8;
          ctx.beginPath();
          ctx.moveTo(sx, eyeSy);
          ctx.lineTo(camSx, camSy);
          ctx.stroke();

          // Vertical FOV wedge in section view
          ctx.fillStyle = 'rgba(56, 189, 248, 0.1)';
          ctx.strokeStyle = 'rgba(56, 189, 248, 0.7)';
          ctx.lineWidth = 1.2;
          ctx.setLineDash([4, 3]);
          ctx.beginPath();
          ctx.moveTo(camSx, camSy);
          ctx.lineTo(topSx, topSy);
          ctx.lineTo(botSx, botSy);
          ctx.closePath();
          ctx.fill();
          ctx.stroke();

          // Center optical axis ray
          ctx.strokeStyle = '#38bdf8';
          ctx.beginPath();
          ctx.moveTo(camSx, camSy);
          ctx.lineTo(lookSx, lookSy);
          ctx.stroke();
          ctx.setLineDash([]);

          ctx.fillStyle = '#38bdf8';
          ctx.fillRect(camSx - 4, camSy - 3, 8, 6);
          if ((this.store.selection?.kind === 'poi' && this.store.selection.id === poi.id) || this.zoom >= 26) {
            ctx.fillText(`🎥 ${rig.pitchDeg}° / ${rig.cameraFov}°`, camSx, camSy - 7);
          }
        }
        ctx.restore();
      }
    }

    // Project Object-Connected Sightline Rulers onto Cross-Section!
    const sightlinesToDraw = [
      ...(this.store.doc.sightlines || []).map((s) => resolveSightlineEndpoints(s, this.store.doc)),
      ...(this.store.activeRuler
        ? [{ from: this.store.activeRuler.start, to: this.store.activeRuler.end, fromLabel: 'Ruler', toLabel: 'Target' }]
        : []),
    ];

    for (const sl of sightlinesToDraw) {
      const pFrom = project(sl.from[0], sl.from[2]);
      const pTo = project(sl.to[0], sl.to[2]);
      const los = raycastLevel3D(sl.from, sl.to, this.store.doc.blocks);
      const [sx0, sy0] = this.uvToScreen(pFrom.u, sl.from[1], sectionLen);
      const [sx1, sy1] = this.uvToScreen(pTo.u, sl.to[1], sectionLen);

      ctx.save();
      if (los.blocked && los.hitPoint) {
        const pHit = project(los.hitPoint[0], los.hitPoint[2]);
        const [hx, hy] = this.uvToScreen(pHit.u, los.hitPoint[1], sectionLen);
        ctx.strokeStyle = '#4ade80';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(sx0, sy0);
        ctx.lineTo(hx, hy);
        ctx.stroke();

        ctx.strokeStyle = '#ef4444';
        ctx.setLineDash([4, 3]);
        ctx.beginPath();
        ctx.moveTo(hx, hy);
        ctx.lineTo(sx1, sy1);
        ctx.stroke();
        ctx.setLineDash([]);

        ctx.fillStyle = '#ef4444';
        ctx.beginPath();
        ctx.arc(hx, hy, 4.5, 0, Math.PI * 2);
        ctx.fill();
      } else {
        ctx.strokeStyle = '#4ade80';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(sx0, sy0);
        ctx.lineTo(sx1, sy1);
        ctx.stroke();
      }
      ctx.restore();
    }

    // Project Key/Switch -> Door/Mechanism Trigger Links onto Section / 2D Side View!
    const links = resolveTriggerLinks(this.store.doc);
    for (const lnk of links) {
      const p0 = project(lnk.fromPos[0], lnk.fromPos[2]);
      const p1 = project(lnk.toPos[0], lnk.toPos[2]);
      const [sx0, sy0] = this.uvToScreen(p0.u, lnk.fromPos[1], sectionLen);
      const [sx1, sy1] = this.uvToScreen(p1.u, lnk.toPos[1], sectionLen);
      ctx.save();
      ctx.strokeStyle = '#e879f9';
      ctx.lineWidth = 1.8;
      ctx.setLineDash([5, 4]);
      ctx.beginPath();
      ctx.moveTo(sx0, sy0);
      ctx.lineTo(sx1, sy1);
      ctx.stroke();
      ctx.setLineDash([]);
      const selId = this.store.selection?.id;
      const showDetail = selId === lnk.fromId || selId === lnk.toId || this.zoom >= 26;
      ctx.fillStyle = '#f5d0fe';
      ctx.font = '600 9px Inter, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(showDetail ? `🔑 ${lnk.fromName} ➔ ${lnk.toName}` : '🔑 联动', (sx0 + sx1) / 2, (sy0 + sy1) / 2 - 4);
      ctx.restore();
    }
  }

  private drawSectionPreviewAndPlaytest(ctx: CanvasRenderingContext2D, sectionLen: number): void {
    const { start, end } = this.store.doc.sectionPlane;
    const tx = (end[0] - start[0]) / Math.max(0.1, sectionLen);
    const tz = (end[1] - start[1]) / Math.max(0.1, sectionLen);

    if (this.drag?.type === 'draw_block_uv') {
      const [x0, y0] = this.uvToScreen(this.drag.startUV[0], this.drag.startUV[1], sectionLen);
      const [x1, y1] = this.uvToScreen(this.drag.curUV[0], this.drag.curUV[1], sectionLen);
      const minX = Math.min(x0, x1);
      const minY = Math.min(y0, y1);
      const pw = Math.abs(x1 - x0);
      const ph = Math.abs(y1 - y0);
      ctx.save();
      ctx.fillStyle = 'rgba(56, 189, 248, 0.24)';
      ctx.strokeStyle = '#38bdf8';
      ctx.lineWidth = 2;
      ctx.setLineDash([5, 3]);
      ctx.fillRect(minX, minY, pw, ph);
      ctx.strokeRect(minX, minY, pw, ph);
      ctx.restore();
    } else if (this.drag?.type === 'draw_jump_uv') {
      const [x0, y0] = this.uvToScreen(this.drag.startUV[0], this.drag.startUV[1], sectionLen);
      const [x1, y1] = this.uvToScreen(this.drag.curUV[0], this.drag.curUV[1], sectionLen);
      ctx.save();
      ctx.strokeStyle = '#22c55e';
      ctx.lineWidth = 2.2;
      ctx.setLineDash([4, 3]);
      ctx.beginPath();
      ctx.moveTo(x0, y0);
      ctx.lineTo(x1, y1);
      ctx.stroke();
      ctx.restore();
    }

    if (this.store.playtestPose) {
      const pose = this.store.playtestPose;
      const pu = (pose.position[0] - start[0]) * tx + (pose.position[2] - start[1]) * tz;
      const m = this.store.doc.metricsProfile;
      const [sx, footSy] = this.uvToScreen(pu, pose.position[1], sectionLen);
      const [, headSy] = this.uvToScreen(pu, pose.position[1] + m.playerHeight, sectionLen);
      const radPx = Math.max(6, m.playerRadius * this.zoom);
      const totalH = Math.max(16, footSy - headSy);
      const yawRad = (pose.yaw * Math.PI) / 180;
      const dirSign = Math.sin(yawRad) * tx - Math.cos(yawRad) * tz >= 0 ? 1 : -1;

      ctx.save();
      // 1. Collision capsule bounding outline (dashed cyan)
      ctx.strokeStyle = 'rgba(56, 189, 248, 0.75)';
      ctx.lineWidth = 1.3;
      ctx.setLineDash([3, 2]);
      ctx.beginPath();
      ctx.roundRect(sx - radPx, headSy, radPx * 2, totalH, radPx);
      ctx.stroke();
      ctx.setLineDash([]);

      // 2. Ground contact ring
      ctx.fillStyle = 'rgba(250, 204, 21, 0.35)';
      ctx.strokeStyle = '#facc15';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.ellipse(sx, footSy, radPx * 1.15, Math.max(2.5, radPx * 0.32), 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();

      // 3. Articulated Side-View Character Silhouette (Legs, Torso, Backpack, Head, Visor)
      const headR = Math.max(4, totalH * 0.14);
      const headCy = headSy + headR + 1;
      const torsoTop = headCy + headR * 0.85;
      const torsoBot = headSy + totalH * 0.66;
      const torsoW = Math.max(7, radPx * 1.35);

      // Legs
      ctx.strokeStyle = '#0284c7';
      ctx.lineWidth = Math.max(2.5, radPx * 0.45);
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(sx - torsoW * 0.22, torsoBot);
      ctx.lineTo(sx - torsoW * 0.28, footSy - 1);
      ctx.moveTo(sx + torsoW * 0.22, torsoBot);
      ctx.lineTo(sx + torsoW * 0.28, footSy - 1);
      ctx.stroke();

      // Backpack (on back side)
      ctx.fillStyle = '#0369a1';
      ctx.fillRect(
        sx - dirSign * (torsoW * 0.5 + 3),
        torsoTop + 2,
        3.5,
        Math.max(5, (torsoBot - torsoTop) * 0.7)
      );

      // Torso armor
      ctx.fillStyle = '#0ea5e9';
      ctx.strokeStyle = '#f8fafc';
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.roundRect(sx - torsoW / 2, torsoTop, torsoW, Math.max(6, torsoBot - torsoTop), 3);
      ctx.fill();
      ctx.stroke();

      // Head helmet
      ctx.fillStyle = '#38bdf8';
      ctx.beginPath();
      ctx.arc(sx, headCy, headR, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();

      // Glowing yellow visor showing facing direction
      ctx.fillStyle = '#facc15';
      ctx.fillRect(
        dirSign > 0 ? sx : sx - headR * 0.95,
        headCy - headR * 0.35,
        headR * 0.95,
        Math.max(2.5, headR * 0.55)
      );

      // Compact label above character
      ctx.fillStyle = '#fef08a';
      ctx.font = 'bold 10px Inter, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(`🧍 试玩角色 (${pose.position[1].toFixed(1)}m)`, sx, headSy - 6);
      ctx.restore();
    }
  }

  private drawCharacterScaleReference(
    ctx: CanvasRenderingContext2D,
    sectionLen: number,
    items: CrossSectionSliceItem[]
  ): void {
    const m = this.store.doc.metricsProfile;
    // Place the scale human on top of the highest cut polygon under the mouse U, or at u = sectionLen * 0.25
    const targetU =
      this.mouseUV[0] >= 0 && this.mouseUV[0] <= sectionLen ? this.mouseUV[0] : sectionLen * 0.25;
    let groundY = 0;

    for (const it of items) {
      for (const poly of it.cutPolygons) {
        for (const [u, v] of poly) {
          if (Math.abs(u - targetU) < 1.5 && v > groundY && ROLE_META[it.block.role]?.walkable) {
            groundY = v;
          }
        }
      }
    }

    const [sx, footSy] = this.uvToScreen(targetU, groundY, sectionLen);
    const [, headSy] = this.uvToScreen(targetU, groundY + m.playerHeight, sectionLen);
    const [, crouchSy] = this.uvToScreen(targetU, groundY + m.crouchHeight, sectionLen);
    const [, lowCovSy] = this.uvToScreen(targetU, groundY + m.lowCoverHeight, sectionLen);
    const radPx = Math.max(4, m.playerRadius * this.zoom);

    ctx.save();
    // Draw Player Capsule
    ctx.fillStyle = 'rgba(56, 189, 248, 0.25)';
    ctx.strokeStyle = '#38bdf8';
    ctx.lineWidth = 1.6;
    const capH = Math.max(8, footSy - headSy);
    ctx.beginPath();
    ctx.roundRect(sx - radPx, headSy, radPx * 2, capH, radPx);
    ctx.fill();
    ctx.stroke();

    // Crouch & Low Cover guide ticks
    ctx.strokeStyle = 'rgba(250, 204, 21, 0.75)';
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 2]);
    ctx.beginPath();
    ctx.moveTo(sx - radPx - 8, crouchSy);
    ctx.lineTo(sx + radPx + 14, crouchSy);
    ctx.moveTo(sx - radPx - 8, lowCovSy);
    ctx.lineTo(sx + radPx + 14, lowCovSy);
    ctx.stroke();

    // Draw max single-jump envelope curve to the right (coupled with runSpeed, jumpDistance, jumpHeight, gravity)
    const dynSpan =
      m.jumpDistance *
      Math.max(0.15, m.runSpeed / 7.0) *
      Math.sqrt(18.0 / Math.max(2.0, m.gravity)) *
      Math.sqrt(Math.max(0.15, m.jumpHeight / 1.6));
    ctx.strokeStyle = 'rgba(34, 197, 94, 0.75)';
    ctx.lineWidth = 1.8;
    ctx.beginPath();
    const steps = 16;
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const du = t * dynSpan;
      const dy = 4 * t * (1 - t) * m.jumpHeight;
      const [jx, jy] = this.uvToScreen(targetU + du, groundY + dy, sectionLen);
      if (i === 0) ctx.moveTo(jx, jy);
      else ctx.lineTo(jx, jy);
    }
    ctx.stroke();
    ctx.setLineDash([]);

    ctx.fillStyle = '#38bdf8';
    ctx.font = '9px JetBrains Mono, monospace';
    ctx.fillText(`${m.playerHeight}m · 跃${m.jumpHeight}m×${dynSpan.toFixed(1)}m`, sx + radPx + 6, headSy + 8);
    ctx.restore();
  }

  private drawSectionHUD(
    ctx: CanvasRenderingContext2D,
    cw: number,
    ch: number,
    sectionLen: number,
    sliceCount: number
  ): void {
    ctx.save();
    ctx.fillStyle = 'rgba(15, 23, 42, 0.82)';
    ctx.fillRect(10, ch - 30, Math.min(cw - 20, 255), 22);
    ctx.fillStyle = '#cbd5e1';
    ctx.font = '10px JetBrains Mono, monospace';
    ctx.fillText(
      `A-A' ${sectionLen.toFixed(1)}m · 剖切 ${sliceCount} · Y=${this.mouseUV[1].toFixed(1)}m`,
      16,
      ch - 15
    );
    ctx.restore();
  }
}
