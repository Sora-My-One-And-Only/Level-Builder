import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js';
import {
  computeBlocksSignature,
  computeEnemyPathAStar,
  computePlayerCameraRig,
  computeVisibilityPolygon,
  evaluateEnemyDetection,
  evaluateJumpLink,
  FLOW_META,
  getBlockWorldAABB,
  POI_META,
  raycastLevel3D,
  resolveSightlineEndpoints,
  resolveTriggerLinks,
  ROLE_META,
} from '../core/geometry-analysis';
import { LevelStore } from '../core/store';
import { getTheme } from '../core/theme';
import { BlockType, LevelBlock, LevelPOI, Vec3 } from '../core/types';

export class Viewport3D {
  private container: HTMLElement;
  public renderer: THREE.WebGLRenderer;
  public scene: THREE.Scene;
  public camera: THREE.PerspectiveCamera;
  public playerPipCamera: THREE.PerspectiveCamera;
  public showPlayerPiP = true;
  private pipBadgeEl!: HTMLDivElement;
  public orbit: OrbitControls;
  public transformControl: TransformControls;

  private store: LevelStore;
  private blockGroup = new THREE.Group();
  private overlayGroup = new THREE.Group();
  private meshMap = new Map<string, THREE.Object3D>();
  private poiMap = new Map<string, THREE.Object3D>();
  private raycaster = new THREE.Raycaster();
  private gridTexture: THREE.CanvasTexture;
  private scaleCapsuleMesh: THREE.Group;
  private sectionPlaneHelper: THREE.Mesh;
  private previewMesh: THREE.Group;
  private clippingPlane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);

  private isDraggingTransform = false;
  private pointerDownPos = { x: 0, y: 0 };

  // 场景重建调度：store 通知只打脏标记，真正的重建合并到下一帧，并按内容签名跳过没变的部分
  private sceneDirty = false;
  private blockMeshKeys = new Map<string, string>();
  /** 刚创建的体块做一次短促的"弹出"入场，提示新对象出现在哪里 */
  private blockPopIns = new Map<THREE.Object3D, number>();
  private hasSyncedBlocksOnce = false;
  private overlayRenderKey = '';
  private lastPipBadgeKey = '';

  // Unity RMB Flythrough Camera state
  public isRMBFlying = false;
  private flyYaw = 0;
  private flyPitch = -0.45;
  private pressedKeys = new Set<string>();

  // 3D Creation drag state
  private draw3DState: {
    mode: 'block' | 'jump' | 'ruler';
    blockType?: BlockType;
    startPt: Vec3;
    curPt: Vec3;
    fromId?: string;
    fromHeightOffset?: number;
  } | null = null;

  // Playtest state
  private playVelocityY = 0;
  private playGrounded = true;
  private playJumpsRemaining = 2;
  private playYaw = 0;
  private playPitch = -0.18;
  private playCrouching = false;
  public playtestViewMode: 'tps' | 'iso' | 'fps' = 'tps';
  private walkAnimPhase = 0;
  private dropShadowGroup: THREE.Group;
  private playtestHudEl!: HTMLDivElement;
  private viewCubeCanvas!: HTMLCanvasElement;
  private viewCubeCtx!: CanvasRenderingContext2D;
  private hoveredCubeFace: string | null = null;
  private viewCubeFaces2D: Array<{
    id: string;
    poly: Array<[number, number]>;
    normal: Vec3;
  }> = [];
  private lastFrameTime = performance.now();
  private enemySimTime = 0;

  constructor(container: HTMLElement, store: LevelStore) {
    this.container = container;
    this.store = store;

    this.renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.localClippingEnabled = true;
    container.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color('#0b111e');
    this.scene.fog = new THREE.FogExp2('#0b111e', 0.008);

    this.camera = new THREE.PerspectiveCamera(55, 1, 0.1, 500);
    this.camera.position.set(18, 16, 24);
    this.playerPipCamera = new THREE.PerspectiveCamera(70, 16 / 9, 0.1, 300);

    this.orbit = new OrbitControls(this.camera, this.renderer.domElement);
    this.orbit.enableDamping = true;
    this.orbit.dampingFactor = 0.08;
    this.orbit.target.set(0, 1, 0);
    // Unity-like mouse mapping: Middle = Pan, Left (with Alt or default orbit) = Rotate, Wheel = Dolly
    this.orbit.mouseButtons = {
      LEFT: THREE.MOUSE.ROTATE,
      MIDDLE: THREE.MOUSE.PAN,
      RIGHT: THREE.MOUSE.PAN,
    };

    this.transformControl = new TransformControls(this.camera, this.renderer.domElement);
    this.transformControl.setSpace('local');
    this.scene.add(this.transformControl.getHelper());

    this.gridTexture = this.createMetricCheckerTexture();

    this.setupLightsAndEnvironment();
    this.scene.add(this.blockGroup);
    this.scene.add(this.overlayGroup);

    this.scaleCapsuleMesh = this.createScaleHumanCapsule();
    this.scene.add(this.scaleCapsuleMesh);

    this.dropShadowGroup = this.createDropShadowGroup();
    this.dropShadowGroup.visible = false;
    this.scene.add(this.dropShadowGroup);

    this.previewMesh = this.create3DPreviewBox();
    this.previewMesh.visible = false;
    this.scene.add(this.previewMesh);

    const planeGeo = new THREE.PlaneGeometry(1, 12);
    const planeMat = new THREE.MeshBasicMaterial({
      color: 0xf43f5e,
      transparent: true,
      opacity: 0.14,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    this.sectionPlaneHelper = new THREE.Mesh(planeGeo, planeMat);
    this.scene.add(this.sectionPlaneHelper);

    this.createUnitySceneGizmoOverlay();
    this.bindEvents();

    const ro = new ResizeObserver(() => this.resize());
    ro.observe(container);
    this.resize();

    this.store.subscribeViewports(() => {
      if (!this.isDraggingTransform) {
        this.sceneDirty = true;
      }
    });

    this.store.onFrameSelected(() => this.frameSelected());
    this.store.onDimensionModeChanged((mode) => {
      if (mode === '2d_side') {
        this.tweenCameraTo(new THREE.Vector3(0, 4, 26), new THREE.Vector3(0, 3, 0), 520);
      } else if (mode === '2d_topdown') {
        this.tweenCameraTo(new THREE.Vector3(0, 32, 3), new THREE.Vector3(0, 0, 0), 520);
      } else {
        this.tweenCameraTo(new THREE.Vector3(18, 16, 24), new THREE.Vector3(0, 1, 0), 520);
      }
    });

    this.rebuildSceneFromStore();
    this.animate();
  }

  /** Interactive 3D Orientation ViewCube (Top/Bottom/Left/Right/Front/Back + XYZ Axes) */
  private createUnitySceneGizmoOverlay(): void {
    const widget = document.createElement('div');
    widget.className = 'viewcube-widget';
    widget.innerHTML = `
      <div class="viewcube-canvas-wrap" title="点击方块各个面快速切换镜头视角 (上/下/左/右/前/后) · 按住拖拽可环绕旋转">
        <canvas class="viewcube-canvas" width="208" height="208"></canvas>
      </div>
      <div class="viewcube-subbar">
        <button class="viewcube-mini-btn" data-vc-act="iso" title="重置为 45° 透视等轴视角">🧊 透视</button>
        <button class="viewcube-mini-btn" data-vc-act="focus" title="聚焦选中物体 (快捷键 F)">🎯 聚焦</button>
      </div>
    `;
    this.container.appendChild(widget);

    this.viewCubeCanvas = widget.querySelector('canvas')!;
    this.viewCubeCtx = this.viewCubeCanvas.getContext('2d')!;
    const dpr = 2;
    this.viewCubeCtx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const pointInPoly2D = (px: number, py: number, poly: Array<[number, number]>): boolean => {
      let inside = false;
      for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
        const [xi, yi] = poly[i];
        const [xj, yj] = poly[j];
        const intersect = yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi + 1e-9) + xi;
        if (intersect) inside = !inside;
      }
      return inside;
    };

    const getHitFace = (e: MouseEvent) => {
      const rect = this.viewCubeCanvas.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      for (let i = this.viewCubeFaces2D.length - 1; i >= 0; i--) {
        if (pointInPoly2D(mx, my, this.viewCubeFaces2D[i].poly)) {
          return this.viewCubeFaces2D[i];
        }
      }
      return null;
    };

    let vcDragStart: { x: number; y: number; moved: boolean } | null = null;

    this.viewCubeCanvas.addEventListener('mousemove', (e) => {
      if (vcDragStart) {
        const dx = e.clientX - vcDragStart.x;
        const dy = e.clientY - vcDragStart.y;
        if (Math.hypot(dx, dy) > 3) vcDragStart.moved = true;
        if (vcDragStart.moved) {
          vcDragStart.x = e.clientX;
          vcDragStart.y = e.clientY;
          const offset = this.camera.position.clone().sub(this.orbit.target);
          const sph = new THREE.Spherical().setFromVector3(offset);
          sph.theta -= dx * 0.015;
          sph.phi = Math.max(0.05, Math.min(Math.PI - 0.05, sph.phi - dy * 0.015));
          offset.setFromSpherical(sph);
          this.camera.position.copy(this.orbit.target).add(offset);
          this.orbit.update();
        }
        return;
      }
      const hit = getHitFace(e);
      this.hoveredCubeFace = hit ? hit.id : null;
    });

    this.viewCubeCanvas.addEventListener('mouseleave', () => {
      this.hoveredCubeFace = null;
    });

    this.viewCubeCanvas.addEventListener('mousedown', (e) => {
      e.stopPropagation();
      vcDragStart = { x: e.clientX, y: e.clientY, moved: false };
      const upHandler = (upEv: MouseEvent) => {
        window.removeEventListener('mouseup', upHandler);
        const wasMoved = vcDragStart?.moved;
        vcDragStart = null;
        if (!wasMoved) {
          const hit = getHitFace(upEv);
          if (hit) {
            const target = this.orbit.target.clone();
            const dist = Math.max(18, this.camera.position.distanceTo(target));
            const [nx, ny, nz] = hit.normal;
            // Slight offset on X/Z when looking straight along Y to avoid gimbal lock in OrbitControls
            const epsZ = Math.abs(ny) > 0.9 ? 0.01 : 0;
            this.tweenCameraTo(
              new THREE.Vector3(target.x + nx * dist, target.y + ny * dist, target.z + nz * dist + epsZ),
              target
            );
          }
        }
      };
      window.addEventListener('mouseup', upHandler);
    });

    widget.querySelectorAll<HTMLButtonElement>('[data-vc-act]').forEach((btn) => {
      btn.onclick = (e) => {
        e.stopPropagation();
        const act = btn.dataset.vcAct;
        if (act === 'iso') {
          const target = this.orbit.target.clone();
          this.tweenCameraTo(new THREE.Vector3(target.x + 18, target.y + 16, target.z + 24), target);
        } else if (act === 'focus') {
          this.frameSelected();
        }
      };
    });

    // Picture-in-Picture Player Camera Preview Overlay Badge
    this.pipBadgeEl = document.createElement('div');
    this.pipBadgeEl.className = 'pip-camera-overlay';
    this.pipBadgeEl.title = '点击选中玩家出生点并调整摄像机/视野参数';
    this.pipBadgeEl.onclick = (e) => {
      e.stopPropagation();
      const sp = this.store.doc.pois.find((p) => p.category === 'spawn_player');
      if (sp) this.store.setSelection({ kind: 'poi', id: sp.id });
    };
    this.container.appendChild(this.pipBadgeEl);

    // Live Playtest HUD Bar
    this.playtestHudEl = document.createElement('div');
    this.playtestHudEl.className = 'playtest-hud-bar';
    this.container.appendChild(this.playtestHudEl);
  }

  private renderViewCube(): void {
    if (!this.viewCubeCtx) return;
    const ctx = this.viewCubeCtx;
    const cw = 104;
    const ch = 104;
    const cx = cw / 2;
    const cy = ch / 2;
    ctx.clearRect(0, 0, cw, ch);

    const invQ = this.camera.quaternion.clone().invert();
    const s = 22; // half-size of cube

    const toCamSpace = (x: number, y: number, z: number): [number, number, number] => {
      const v = new THREE.Vector3(x, y, z).applyQuaternion(invQ);
      return [v.x, v.y, v.z];
    };

    const project = (vx: number, vy: number, vz: number): [number, number] => {
      const pScale = 145 / Math.max(60, 145 - vz);
      return [cx + vx * pScale, cy - vy * pScale];
    };

    const faces: Array<{
      id: string;
      label: string;
      normal: Vec3;
      color: string;
      verts: Array<Vec3>;
    }> = [
      {
        id: 'top',
        label: '上 TOP',
        normal: [0, 1, 0],
        color: '#22c55e',
        verts: [
          [-s, s, -s],
          [-s, s, s],
          [s, s, s],
          [s, s, -s],
        ],
      },
      {
        id: 'bottom',
        label: '下 BTM',
        normal: [0, -1, 0],
        color: '#15803d',
        verts: [
          [-s, -s, s],
          [-s, -s, -s],
          [s, -s, -s],
          [s, -s, s],
        ],
      },
      {
        id: 'right',
        label: '右 +X',
        normal: [1, 0, 0],
        color: '#ef4444',
        verts: [
          [s, s, s],
          [s, -s, s],
          [s, -s, -s],
          [s, s, -s],
        ],
      },
      {
        id: 'left',
        label: '左 -X',
        normal: [-1, 0, 0],
        color: '#b91c1c',
        verts: [
          [-s, s, -s],
          [-s, -s, -s],
          [-s, -s, s],
          [-s, s, s],
        ],
      },
      {
        id: 'front',
        label: '前 +Z',
        normal: [0, 0, 1],
        color: '#38bdf8',
        verts: [
          [-s, s, s],
          [-s, -s, s],
          [s, -s, s],
          [s, s, s],
        ],
      },
      {
        id: 'back',
        label: '后 -Z',
        normal: [0, 0, -1],
        color: '#0369a1',
        verts: [
          [s, s, -s],
          [s, -s, -s],
          [-s, -s, -s],
          [-s, s, -s],
        ],
      },
    ];

    // Draw compass ring around the cube base
    ctx.save();
    ctx.strokeStyle = 'rgba(148, 163, 184, 0.32)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(cx, cy, 46, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();

    // Draw XYZ axis lines from origin (-s,-s,-s)
    const axes: Array<{ dir: Vec3; col: string; tag: string }> = [
      { dir: [1, 0, 0], col: '#ef4444', tag: 'X' },
      { dir: [0, 1, 0], col: '#22c55e', tag: 'Y' },
      { dir: [0, 0, 1], col: '#38bdf8', tag: 'Z' },
    ];
    for (const ax of axes) {
      const [ox, oy, oz] = toCamSpace(0, 0, 0);
      const [ex, ey, ez] = toCamSpace(ax.dir[0] * 40, ax.dir[1] * 40, ax.dir[2] * 40);
      const [sx0, sy0] = project(ox, oy, oz);
      const [sx1, sy1] = project(ex, ey, ez);
      ctx.save();
      ctx.strokeStyle = ax.col;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(sx0, sy0);
      ctx.lineTo(sx1, sy1);
      ctx.stroke();

      ctx.fillStyle = ax.col;
      ctx.beginPath();
      ctx.arc(sx1, sy1, 6.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#090d16';
      ctx.font = 'bold 8.5px Inter, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(ax.tag, sx1, sy1 + 0.5);
      ctx.restore();
    }

    const projectedFaces = faces
      .map((f) => {
        const camVerts = f.verts.map((v) => toCamSpace(v[0], v[1], v[2]));
        const camNorm = toCamSpace(f.normal[0], f.normal[1], f.normal[2]);
        const avgZ = camVerts.reduce((acc, v) => acc + v[2], 0) / 4;
        const poly = camVerts.map((v) => project(v[0], v[1], v[2]));
        return {
          ...f,
          camNorm,
          avgZ,
          poly,
        };
      })
      .filter((f) => f.camNorm[2] > 0.02)
      .sort((a, b) => a.avgZ - b.avgZ);

    this.viewCubeFaces2D = [];

    for (const pf of projectedFaces) {
      this.viewCubeFaces2D.push({
        id: pf.id,
        poly: pf.poly,
        normal: pf.normal,
      });

      const isHover = this.hoveredCubeFace === pf.id;
      ctx.save();
      ctx.beginPath();
      pf.poly.forEach(([px, py], idx) => {
        if (idx === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      });
      ctx.closePath();

      ctx.fillStyle = isHover ? '#facc15' : pf.color;
      ctx.globalAlpha = isHover ? 0.92 : 0.65 + Math.max(0, pf.camNorm[2]) * 0.25;
      ctx.fill();

      ctx.globalAlpha = 1;
      ctx.strokeStyle = isHover ? '#ffffff' : 'rgba(248, 250, 252, 0.85)';
      ctx.lineWidth = isHover ? 2.2 : 1.3;
      ctx.stroke();

      // Face center label
      const fcx = pf.poly.reduce((acc, p) => acc + p[0], 0) / 4;
      const fcy = pf.poly.reduce((acc, p) => acc + p[1], 0) / 4;
      if (pf.camNorm[2] > 0.22) {
        ctx.fillStyle = isHover ? '#090d16' : '#ffffff';
        ctx.font = 'bold 9.5px Inter, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(pf.label, fcx, fcy);
      }
      ctx.restore();
    }
  }

  public frameSelected(): void {
    if (this.store.isPlaytesting) return;
    const blk = this.store.getSelectedBlock();
    if (blk) {
      const [x, y, z] = blk.position;
      const dist = Math.max(6, Math.max(blk.size[0], blk.size[1], blk.size[2]) * 1.9);
      const offsetDir = this.camera.position.clone().sub(this.orbit.target).normalize();
      if (offsetDir.lengthSq() < 0.01) offsetDir.set(0.6, 0.5, 0.6).normalize();
      const newTarget = new THREE.Vector3(x, y, z);
      this.tweenCameraTo(newTarget.clone().addScaledVector(offsetDir, dist), newTarget);
      return;
    }
    const poi = this.store.getSelectedPOI();
    if (poi) {
      const [x, y, z] = poi.position;
      const offsetDir = this.camera.position.clone().sub(this.orbit.target).normalize();
      const newTarget = new THREE.Vector3(x, y + 1, z);
      this.tweenCameraTo(newTarget.clone().addScaledVector(offsetDir, 10), newTarget);
    }
  }

  private cameraTweenId = 0;

  /**
   * 平滑镜头过渡：围绕目标点做球面插值（半径/俯仰/方位角），避免镜头穿过目标点。
   * 用户在过渡中手动操作镜头（鼠标按下 / 滚轮）时会立即中断过渡。
   */
  public tweenCameraTo(endPos: THREE.Vector3, endTarget: THREE.Vector3, duration = 420): void {
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    const id = ++this.cameraTweenId;
    if (reduce || duration <= 0) {
      this.orbit.target.copy(endTarget);
      this.camera.position.copy(endPos);
      this.orbit.update();
      return;
    }
    const startTarget = this.orbit.target.clone();
    const startSph = new THREE.Spherical().setFromVector3(this.camera.position.clone().sub(startTarget));
    const endSph = new THREE.Spherical().setFromVector3(endPos.clone().sub(endTarget));
    let dTheta = endSph.theta - startSph.theta;
    while (dTheta > Math.PI) dTheta -= Math.PI * 2;
    while (dTheta < -Math.PI) dTheta += Math.PI * 2;
    const t0 = performance.now();
    const dom = this.renderer.domElement;
    const cancel = () => {
      if (id === this.cameraTweenId) this.cameraTweenId++;
    };
    dom.addEventListener('pointerdown', cancel, { once: true });
    dom.addEventListener('wheel', cancel, { once: true, passive: true });
    const cleanup = () => {
      dom.removeEventListener('pointerdown', cancel);
      dom.removeEventListener('wheel', cancel);
    };
    const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3);
    const step = (now: number) => {
      if (id !== this.cameraTweenId) {
        cleanup();
        return;
      }
      const raw = Math.min(1, (now - t0) / duration);
      const k = easeOutCubic(raw);
      const sph = new THREE.Spherical(
        startSph.radius + (endSph.radius - startSph.radius) * k,
        startSph.phi + (endSph.phi - startSph.phi) * k,
        startSph.theta + dTheta * k
      );
      const tgt = startTarget.clone().lerp(endTarget, k);
      this.orbit.target.copy(tgt);
      this.camera.position.copy(tgt).add(new THREE.Vector3().setFromSpherical(sph));
      this.orbit.update();
      if (raw < 1) requestAnimationFrame(step);
      else cleanup();
    };
    requestAnimationFrame(step);
  }

  private create3DPreviewBox(): THREE.Group {
    const g = new THREE.Group();
    const geo = new THREE.BoxGeometry(1, 1, 1);
    const mat = new THREE.MeshBasicMaterial({
      color: 0x38bdf8,
      transparent: true,
      opacity: 0.32,
      depthWrite: false,
    });
    const mesh = new THREE.Mesh(geo, mat);
    g.add(mesh);

    const edges = new THREE.LineSegments(
      new THREE.EdgesGeometry(geo),
      new THREE.LineBasicMaterial({ color: 0x38bdf8 })
    );
    g.add(edges);
    return g;
  }

  private createMetricCheckerTexture(): THREE.CanvasTexture {
    const size = 1024; // 1024x1024 px for a 2m x 2m world tile (512 px = 1.0m)
    const half = size / 2; // 512 px = 1.0m
    const quarter = size / 4; // 256 px = 0.5m
    const eighth = size / 8; // 128 px = 0.25m

    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d')!;

    // 1. Base 2x2 meter checkerboard (neutral high-value luminance so material color tints cleanly)
    for (let row = 0; row < 2; row++) {
      for (let col = 0; col < 2; col++) {
        const isLight = (row + col) % 2 === 0;
        const x0 = col * half;
        const y0 = row * half;

        ctx.fillStyle = isLight ? '#dce4ee' : '#b8c4d4';
        ctx.fillRect(x0, y0, half, half);

        // Subtle inner bevel highlight
        ctx.strokeStyle = isLight ? 'rgba(255, 255, 255, 0.45)' : 'rgba(255, 255, 255, 0.28)';
        ctx.lineWidth = 2;
        ctx.strokeRect(x0 + 2, y0 + 2, half - 4, half - 4);

        // 2. 0.25m (25cm) fine subdivision grid inside this 1m x 1m cell
        ctx.strokeStyle = isLight ? 'rgba(15, 23, 42, 0.13)' : 'rgba(15, 23, 42, 0.18)';
        ctx.lineWidth = 1.5;
        for (let sub = 1; sub < 4; sub++) {
          if (sub === 2) continue; // 0.5m drawn separately
          const sx = x0 + sub * eighth;
          const sy = y0 + sub * eighth;
          ctx.beginPath();
          ctx.moveTo(sx, y0);
          ctx.lineTo(sx, y0 + half);
          ctx.moveTo(x0, sy);
          ctx.lineTo(x0 + half, sy);
          ctx.stroke();
        }

        // 3. 0.5m (50cm) half-meter dashed/solid sub-grid line
        const midX = x0 + quarter;
        const midY = y0 + quarter;
        ctx.strokeStyle = 'rgba(15, 23, 42, 0.34)';
        ctx.lineWidth = 2;
        ctx.setLineDash([10, 6]);
        ctx.beginPath();
        ctx.moveTo(midX, y0);
        ctx.lineTo(midX, y0 + half);
        ctx.moveTo(x0, midY);
        ctx.lineTo(x0 + half, midY);
        ctx.stroke();
        ctx.setLineDash([]);

        // 4. Subtle 45-degree prototype diagonal reference lines near corners
        ctx.strokeStyle = 'rgba(15, 23, 42, 0.10)';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(x0, y0 + half);
        ctx.lineTo(x0 + half, y0);
        ctx.stroke();

        // 5. Center 0.5m target reticle (circle + crosshair)
        ctx.strokeStyle = 'rgba(15, 23, 42, 0.38)';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(midX, midY, 18, 0, Math.PI * 2);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(midX - 28, midY);
        ctx.lineTo(midX + 28, midY);
        ctx.moveTo(midX, midY - 28);
        ctx.lineTo(midX, midY + 28);
        ctx.stroke();

        // 6. Graduated 10cm (0.1m) ruler ticks along bottom & left edges of each 1m cell
        ctx.strokeStyle = 'rgba(15, 23, 42, 0.55)';
        ctx.lineWidth = 2;
        for (let t = 1; t < 10; t++) {
          const offsetPx = (t / 10) * half;
          const tickLen = t === 5 ? 16 : t % 2 === 0 ? 11 : 7;
          ctx.beginPath();
          // Bottom edge ticks (pointing up)
          ctx.moveTo(x0 + offsetPx, y0 + half);
          ctx.lineTo(x0 + offsetPx, y0 + half - tickLen);
          // Left edge ticks (pointing right)
          ctx.moveTo(x0, y0 + half - offsetPx);
          ctx.lineTo(x0 + tickLen, y0 + half - offsetPx);
          // Top edge ticks (pointing down)
          ctx.moveTo(x0 + offsetPx, y0);
          ctx.lineTo(x0 + offsetPx, y0 + Math.round(tickLen * 0.7));
          // Right edge ticks (pointing left)
          ctx.moveTo(x0 + half, y0 + half - offsetPx);
          ctx.lineTo(x0 + half - Math.round(tickLen * 0.7), y0 + half - offsetPx);
          ctx.stroke();
        }

        // 7. Major 1.0m cell border & corner L-brackets
        ctx.strokeStyle = 'rgba(15, 23, 42, 0.68)';
        ctx.lineWidth = 4;
        ctx.strokeRect(x0, y0, half, half);

        // Corner high-contrast L-markers
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.75)';
        ctx.lineWidth = 3;
        const bLen = 22;
        const pad = 6;
        ctx.beginPath();
        // Top-left
        ctx.moveTo(x0 + pad, y0 + pad + bLen);
        ctx.lineTo(x0 + pad, y0 + pad);
        ctx.lineTo(x0 + pad + bLen, y0 + pad);
        // Top-right
        ctx.moveTo(x0 + half - pad - bLen, y0 + pad);
        ctx.lineTo(x0 + half - pad, y0 + pad);
        ctx.lineTo(x0 + half - pad, y0 + pad + bLen);
        // Bottom-left
        ctx.moveTo(x0 + pad, y0 + half - pad - bLen);
        ctx.lineTo(x0 + pad, y0 + half - pad);
        ctx.lineTo(x0 + pad + bLen, y0 + half - pad);
        // Bottom-right
        ctx.moveTo(x0 + half - pad - bLen, y0 + half - pad);
        ctx.lineTo(x0 + half - pad, y0 + half - pad);
        ctx.lineTo(x0 + half - pad, y0 + half - pad - bLen);
        ctx.stroke();

        // 8. Prototype Dimension Labels ("1m × 1m", "0.5m", "0.25m", "100cm")
        // Top-left badge: "1m × 1m"
        ctx.fillStyle = 'rgba(15, 23, 42, 0.72)';
        ctx.beginPath();
        ctx.roundRect(x0 + 16, y0 + 16, 112, 32, 5);
        ctx.fill();
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.45)';
        ctx.lineWidth = 1.5;
        ctx.stroke();

        ctx.fillStyle = '#f8fafc';
        ctx.font = 'bold 20px "JetBrains Mono", Consolas, monospace';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('1m × 1m', x0 + 72, y0 + 33);

        // Top-right scale tag: "GRID 1.0m"
        ctx.fillStyle = 'rgba(15, 23, 42, 0.62)';
        ctx.font = 'bold 15px "JetBrains Mono", Consolas, monospace';
        ctx.textAlign = 'right';
        ctx.fillText('1.0m', x0 + half - 18, y0 + 28);

        // Midpoint 0.5m labels (horizontal & vertical)
        ctx.fillStyle = 'rgba(15, 23, 42, 0.65)';
        ctx.font = 'bold 15px "JetBrains Mono", Consolas, monospace';
        ctx.textAlign = 'left';
        ctx.fillText('0.5m', midX + 6, y0 + 24);
        ctx.fillText('0.5m', x0 + 16, midY - 10);

        // Quarter 0.25m micro-label
        ctx.fillStyle = 'rgba(15, 23, 42, 0.48)';
        ctx.font = '600 13px "JetBrains Mono", Consolas, monospace';
        ctx.fillText('0.25m', x0 + eighth + 5, y0 + half - 22);

        // Bottom-right metric tag: "100 cm"
        ctx.fillStyle = 'rgba(15, 23, 42, 0.62)';
        ctx.font = 'bold 14px "JetBrains Mono", Consolas, monospace';
        ctx.textAlign = 'right';
        ctx.fillText('100cm', x0 + half - 18, y0 + half - 20);
      }
    }

    const tex = new THREE.CanvasTexture(canvas);
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    tex.anisotropy = Math.min(8, this.renderer.capabilities.getMaxAnisotropy() || 4);
    tex.needsUpdate = true;
    return tex;
  }

  /**
   * Computes world-scale metric triplanar UVs on a BufferGeometry so that every
   * 1m x 1m square in 3D space maps to exactly half a 2m x 2m prototype texture tile
   * without stretching on any face (boxes, walls, ramps, stairs, arches, cylinders).
   */
  private applyMetricTriplanarUVs(
    geo: THREE.BufferGeometry,
    partOffset: Vec3,
    blockBottomY: number,
    cylRadius = 0
  ): THREE.BufferGeometry {
    const target = geo.index ? geo.toNonIndexed() : geo;
    target.computeVertexNormals();

    const posAttr = target.getAttribute('position') as THREE.BufferAttribute;
    const normAttr = target.getAttribute('normal') as THREE.BufferAttribute;
    const count = posAttr.count;
    const uvs = new Float32Array(count * 2);
    // Offset by an even multiple of 2m so negative coordinates never flip fractional UV phase
    const phaseShift = 1000;

    for (let i = 0; i < count; i++) {
      const px = posAttr.getX(i) + partOffset[0];
      const py = posAttr.getY(i) + partOffset[1] - blockBottomY; // 0m at bottom of block, +Y upward
      const pz = posAttr.getZ(i) + partOffset[2];

      const nx = normAttr.getX(i);
      const ny = normAttr.getY(i);
      const nz = normAttr.getZ(i);
      const anx = Math.abs(nx);
      const any = Math.abs(ny);
      const anz = Math.abs(nz);

      let u = 0;
      let v = 0;

      if (cylRadius > 0 && any < 0.8) {
        // Cylindrical side wall: map circumferential arc length in meters
        const angle = Math.atan2(px, pz); // -PI..PI
        const arcMeters = angle * cylRadius;
        u = (arcMeters + phaseShift) / 2;
        v = (py + phaseShift) / 2;
      } else if (any >= anx && any >= anz) {
        // Horizontal or sloped top/bottom face (1 UV unit = 2 meters)
        u = (px + phaseShift) / 2;
        if (any < 0.98 && anz > 0.05) {
          // Sloped ramp surface: measure true distance along the slope
          const slopeSign = nz >= 0 ? -1 : 1;
          const runAndRise = Math.hypot(pz, py) * (pz * slopeSign >= 0 ? 1 : -1);
          v = (runAndRise + phaseShift) / 2;
        } else {
          v = (-pz + phaseShift) / 2;
        }
      } else if (anz >= anx) {
        // Front (+Z) or Back (-Z) vertical face: u = horizontal X, v = height Y from block bottom
        const horizX = nz >= 0 ? px : -px;
        u = (horizX + phaseShift) / 2;
        v = (py + phaseShift) / 2;
      } else {
        // Right (+X) or Left (-X) vertical face: u = horizontal Z, v = height Y from block bottom
        const horizZ = nx >= 0 ? -pz : pz;
        u = (horizZ + phaseShift) / 2;
        v = (py + phaseShift) / 2;
      }

      uvs[i * 2] = u;
      uvs[i * 2 + 1] = v;
    }

    target.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
    return target;
  }

  private setupLightsAndEnvironment(): void {
    const hemi = new THREE.HemisphereLight(0xe2e8f0, 0x1e293b, 0.85);
    this.scene.add(hemi);

    const dir = new THREE.DirectionalLight(0xffffff, 1.15);
    dir.position.set(22, 38, 26);
    dir.castShadow = true;
    dir.shadow.mapSize.set(2048, 2048);
    dir.shadow.camera.near = 1;
    dir.shadow.camera.far = 120;
    const d = 32;
    dir.shadow.camera.left = -d;
    dir.shadow.camera.right = d;
    dir.shadow.camera.top = d;
    dir.shadow.camera.bottom = -d;
    dir.shadow.bias = -0.0005;
    this.scene.add(dir);

    const grid = new THREE.GridHelper(80, 80, 0x38bdf8, 0x1e293b);
    grid.position.y = -0.01;
    this.scene.add(grid);
  }

  private createScaleHumanCapsule(): THREE.Group {
    const g = new THREE.Group();

    const suitMat = new THREE.MeshStandardMaterial({
      color: 0x0ea5e9,
      roughness: 0.35,
      metalness: 0.15,
    });
    const accentMat = new THREE.MeshStandardMaterial({
      color: 0xf8fafc,
      roughness: 0.4,
      metalness: 0.1,
    });
    const darkMat = new THREE.MeshStandardMaterial({
      color: 0x1e293b,
      roughness: 0.5,
      metalness: 0.2,
    });
    const visorMat = new THREE.MeshBasicMaterial({ color: 0xfacc15 });

    // 1. Torso & Tactical Backpack
    const torso = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.58, 0.24), suitMat);
    torso.position.set(0, 1.04, 0);
    torso.castShadow = true;
    g.add(torso);

    const chestStripe = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.14, 0.25), accentMat);
    chestStripe.position.set(0, 1.15, 0);
    g.add(chestStripe);

    const backpack = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.42, 0.16), darkMat);
    backpack.position.set(0, 1.06, 0.18);
    backpack.castShadow = true;
    g.add(backpack);

    // 2. Head & Glowing Tactical Visor (-Z is forward)
    const headGroup = new THREE.Group();
    headGroup.position.set(0, 1.54, 0);
    const helmet = new THREE.Mesh(new THREE.SphereGeometry(0.21, 16, 16), accentMat);
    helmet.castShadow = true;
    headGroup.add(helmet);

    const visor = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.11, 0.14), visorMat);
    visor.position.set(0, 0.02, -0.16);
    headGroup.add(visor);
    g.add(headGroup);

    // 3. Articulated Left & Right Arms
    const leftArmPivot = new THREE.Group();
    leftArmPivot.position.set(-0.29, 1.28, 0);
    const leftArm = new THREE.Mesh(new THREE.CapsuleGeometry(0.075, 0.36, 6, 10), suitMat);
    leftArm.position.set(0, -0.22, 0);
    leftArm.castShadow = true;
    leftArmPivot.add(leftArm);
    g.add(leftArmPivot);

    const rightArmPivot = new THREE.Group();
    rightArmPivot.position.set(0.29, 1.28, 0);
    const rightArm = new THREE.Mesh(new THREE.CapsuleGeometry(0.075, 0.36, 6, 10), suitMat);
    rightArm.position.set(0, -0.22, 0);
    rightArm.castShadow = true;
    rightArmPivot.add(rightArm);
    g.add(rightArmPivot);

    // 4. Articulated Left & Right Legs
    const leftLegPivot = new THREE.Group();
    leftLegPivot.position.set(-0.12, 0.72, 0);
    const leftLeg = new THREE.Mesh(new THREE.CapsuleGeometry(0.09, 0.46, 6, 10), darkMat);
    leftLeg.position.set(0, -0.34, 0);
    leftLeg.castShadow = true;
    leftLegPivot.add(leftLeg);
    g.add(leftLegPivot);

    const rightLegPivot = new THREE.Group();
    rightLegPivot.position.set(0.12, 0.72, 0);
    const rightLeg = new THREE.Mesh(new THREE.CapsuleGeometry(0.09, 0.46, 6, 10), darkMat);
    rightLeg.position.set(0, -0.34, 0);
    rightLeg.castShadow = true;
    rightLegPivot.add(rightLeg);
    g.add(rightLegPivot);

    // 5. Physics Collision Boundary Cylinder Wireframe + Foot Ground Ring + Direction Arrow
    const cylGeo = new THREE.CylinderGeometry(0.4, 0.4, 1.8, 16, 1, true);
    const cylEdges = new THREE.LineSegments(
      new THREE.EdgesGeometry(cylGeo),
      new THREE.LineBasicMaterial({ color: 0x38bdf8, transparent: true, opacity: 0.35 })
    );
    cylEdges.position.y = 0.9;
    g.add(cylEdges);

    const footRingGeo = new THREE.RingGeometry(0.34, 0.44, 24);
    footRingGeo.rotateX(-Math.PI / 2);
    const footRing = new THREE.Mesh(
      footRingGeo,
      new THREE.MeshBasicMaterial({ color: 0x22c55e, side: THREE.DoubleSide })
    );
    footRing.position.y = 0.02;
    g.add(footRing);

    const dirConeGeo = new THREE.ConeGeometry(0.14, 0.32, 12);
    dirConeGeo.rotateX(-Math.PI / 2);
    const dirCone = new THREE.Mesh(dirConeGeo, visorMat);
    dirCone.position.set(0, 0.06, -0.55);
    g.add(dirCone);

    g.userData = {
      leftArmPivot,
      rightArmPivot,
      leftLegPivot,
      rightLegPivot,
      footRing,
    };

    return g;
  }

  private createDropShadowGroup(): THREE.Group {
    const g = new THREE.Group();
    const ringGeo = new THREE.RingGeometry(0.22, 0.42, 24);
    ringGeo.rotateX(-Math.PI / 2);
    const ring = new THREE.Mesh(
      ringGeo,
      new THREE.MeshBasicMaterial({
        color: 0xfacc15,
        side: THREE.DoubleSide,
        transparent: true,
        opacity: 0.85,
        depthWrite: false,
      })
    );
    g.add(ring);

    const lineGeo = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(0, 0, 0),
      new THREE.Vector3(0, 1, 0),
    ]);
    const vLine = new THREE.Line(
      lineGeo,
      new THREE.LineBasicMaterial({ color: 0xfacc15, transparent: true, opacity: 0.55 })
    );
    g.add(vLine);
    g.userData = { vLine };
    return g;
  }

  public resize(): void {
    const rect = this.container.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;
    this.camera.aspect = rect.width / rect.height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(rect.width, rect.height);
  }

  public resetCamera(): void {
    if (this.store.isPlaytesting) this.stopPlaytest();
    this.camera.position.set(18, 16, 24);
    this.orbit.target.set(0, 1, 0);
    this.orbit.update();
  }

  private isDrawBlockTool(tool: string): BlockType | null {
    const map: Record<string, BlockType> = {
      draw_box: 'box',
      draw_ramp: 'ramp',
      draw_stairs: 'stairs',
      draw_arch: 'arch',
      draw_cylinder: 'cylinder',
    };
    return map[tool] || null;
  }

  private hitTest3DObjectAndPoint(
    clientX: number,
    clientY: number,
    snap = true,
    forSightline = false
  ): { pt: Vec3; objectId?: string; heightOffset: number } | null {
    const rect = this.renderer.domElement.getBoundingClientRect();
    const mouse = new THREE.Vector2(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1
    );
    this.raycaster.setFromCamera(mouse, this.camera);

    // 1. Check POIs
    const poiHits = this.raycaster.intersectObjects(Array.from(this.poiMap.values()), true);
    if (poiHits.length > 0) {
      let cur: THREE.Object3D | null = poiHits[0].object;
      while (cur && !cur.userData?.poiId) cur = cur.parent;
      if (cur?.userData?.poiId) {
        const poi = this.store.doc.pois.find((p) => p.id === cur!.userData.poiId);
        if (poi) {
          return {
            pt: [
              poi.position[0],
              Number((poi.position[1] + (forSightline ? poi.eyeHeight : 0)).toFixed(2)),
              poi.position[2],
            ],
            objectId: poi.id,
            heightOffset: poi.eyeHeight,
          };
        }
      }
    }

    // 2. Check Blocks
    const blkHits = this.raycaster.intersectObjects(Array.from(this.meshMap.values()), true);
    if (blkHits.length > 0) {
      let cur: THREE.Object3D | null = blkHits[0].object;
      while (cur && !cur.userData?.blockId) cur = cur.parent;
      const p = blkHits[0].point;
      if (forSightline && cur?.userData?.blockId) {
        const blk = this.store.doc.blocks.find((b) => b.id === cur!.userData.blockId);
        if (blk && !ROLE_META[blk.role]?.walkable) {
          return {
            pt: [blk.position[0], Number((blk.position[1] + blk.size[1] / 2 + 0.15).toFixed(2)), blk.position[2]],
            objectId: blk.id,
            heightOffset: 0.15,
          };
        }
      }
      return {
        pt: [
          snap ? this.store.snapValue(p.x) : Number(p.x.toFixed(2)),
          Number(p.y.toFixed(2)),
          snap ? this.store.snapValue(p.z) : Number(p.z.toFixed(2)),
        ],
        objectId: cur?.userData?.blockId,
        heightOffset: this.store.doc.metricsProfile.eyeHeight,
      };
    }

    // 3. Fallback horizontal ground plane at baseY
    const baseY = this.store.creationDefaults.baseY;
    const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -baseY);
    const target = new THREE.Vector3();
    if (this.raycaster.ray.intersectPlane(plane, target)) {
      return {
        pt: [
          snap ? this.store.snapValue(target.x) : Number(target.x.toFixed(2)),
          baseY,
          snap ? this.store.snapValue(target.z) : Number(target.z.toFixed(2)),
        ],
        heightOffset: this.store.doc.metricsProfile.eyeHeight,
      };
    }
    return null;
  }

  private updatePreviewMesh(startPt: Vec3, curPt: Vec3): void {
    const g = this.store.doc.metadata.gridSize || 0.5;
    const w = Math.max(g, Math.abs(curPt[0] - startPt[0]) || 3.0);
    const d = Math.max(g, Math.abs(curPt[2] - startPt[2]) || 3.0);
    const { role, height } = this.store.creationDefaults;
    const h =
      role === 'walkable'
        ? 0.5
        : role === 'cover_low'
        ? this.store.doc.metricsProfile.lowCoverHeight
        : role === 'cover_full'
        ? this.store.doc.metricsProfile.fullCoverHeight
        : height;
    const cx = Math.abs(curPt[0] - startPt[0]) < 0.1 ? startPt[0] : (startPt[0] + curPt[0]) / 2;
    const cz = Math.abs(curPt[2] - startPt[2]) < 0.1 ? startPt[2] : (startPt[2] + curPt[2]) / 2;
    const cy = role === 'walkable' ? startPt[1] - h / 2 : startPt[1] + h / 2;

    this.previewMesh.visible = true;
    this.previewMesh.position.set(cx, cy, cz);
    this.previewMesh.scale.set(w, h, d);
  }

  private bindEvents(): void {
    this.renderer.domElement.addEventListener('contextmenu', (e) => e.preventDefault());

    this.transformControl.addEventListener('dragging-changed', (event) => {
      this.orbit.enabled = !event.value && !this.isRMBFlying;
      this.isDraggingTransform = Boolean(event.value);
      if (event.value) {
        this.store.pushUndoSnapshot();
      } else {
        this.store.notify(true);
        this.rebuildSceneFromStore(false);
      }
    });

    this.transformControl.addEventListener('objectChange', () => {
      const obj = this.transformControl.object;
      if (!obj) return;
      const sel = this.store.selection;
      if (!sel) return;

      if (sel.kind === 'block') {
        const blk = this.store.doc.blocks.find((b) => b.id === sel.id);
        if (!blk) return;
        const sizeChanged =
          Math.abs(obj.scale.x - 1) > 1e-4 ||
          Math.abs(obj.scale.y - 1) > 1e-4 ||
          Math.abs(obj.scale.z - 1) > 1e-4;
        const newPos: Vec3 = [
          Number(obj.position.x.toFixed(2)),
          Number(obj.position.y.toFixed(2)),
          Number(obj.position.z.toFixed(2)),
        ];
        const newRot: Vec3 = [
          Number(THREE.MathUtils.radToDeg(obj.rotation.x).toFixed(1)),
          Number(THREE.MathUtils.radToDeg(obj.rotation.y).toFixed(1)),
          Number(THREE.MathUtils.radToDeg(obj.rotation.z).toFixed(1)),
        ];
        const newSize: Vec3 = [
          Math.max(0.2, Number((blk.size[0] * obj.scale.x).toFixed(2))),
          Math.max(0.2, Number((blk.size[1] * obj.scale.y).toFixed(2))),
          Math.max(0.2, Number((blk.size[2] * obj.scale.z).toFixed(2))),
        ];
        obj.scale.set(1, 1, 1);
        this.store.updateBlockLive(
          blk.id,
          {
            position: newPos,
            rotation: newRot,
            size: newSize,
          },
          false
        );
        if (sizeChanged) {
          this.syncBlockMeshes(false);
          const rebuilt = this.meshMap.get(blk.id);
          if (rebuilt) this.transformControl.attach(rebuilt);
        }
        this.sceneDirty = true;
      } else if (sel.kind === 'poi') {
        const poi = this.store.doc.pois.find((p) => p.id === sel.id);
        if (!poi) return;
        this.store.updatePOILive(
          poi.id,
          {
            position: [
              Number(obj.position.x.toFixed(2)),
              Number(obj.position.y.toFixed(2)),
              Number(obj.position.z.toFixed(2)),
            ],
            yaw: Number(((-THREE.MathUtils.radToDeg(obj.rotation.y) % 360) + 360) % 360),
          },
          false
        );
        this.sceneDirty = true;
      }
    });

    this.renderer.domElement.addEventListener('pointerdown', (e) => {
      this.pointerDownPos = { x: e.clientX, y: e.clientY };
      if (this.store.isPlaytesting) {
        if (document.pointerLockElement !== this.renderer.domElement) {
          this.renderer.domElement.requestPointerLock?.();
        }
        return;
      }

      // Unity RMB Flythrough Mode!
      if (e.button === 2) {
        this.isRMBFlying = true;
        this.orbit.enabled = false;
        const euler = new THREE.Euler().setFromQuaternion(this.camera.quaternion, 'YXZ');
        this.flyYaw = euler.y;
        this.flyPitch = euler.x;
        return;
      }

      if (e.button !== 0 || this.isDraggingTransform || e.altKey) return;

      const blockType = this.isDrawBlockTool(this.store.activeTool);
      if (blockType) {
        const hit = this.hitTest3DObjectAndPoint(e.clientX, e.clientY, true);
        if (hit) {
          this.orbit.enabled = false;
          this.draw3DState = {
            mode: 'block',
            blockType,
            startPt: hit.pt,
            curPt: hit.pt,
          };
          this.updatePreviewMesh(hit.pt, hit.pt);
        }
        return;
      }

      if (this.store.activeTool === 'add_enemy_waypoint') {
        const hit = this.hitTest3DObjectAndPoint(e.clientX, e.clientY, true);
        if (hit) {
          this.store.appendEnemyWaypoint(hit.pt);
        }
        return;
      }

      if (this.store.activeTool === 'measure_jump') {
        const hit = this.hitTest3DObjectAndPoint(e.clientX, e.clientY, true);
        if (hit) {
          this.orbit.enabled = false;
          this.draw3DState = {
            mode: 'jump',
            startPt: hit.pt,
            curPt: hit.pt,
            fromId: hit.objectId,
          };
        }
        return;
      }

      if (this.store.activeTool === 'measure_ruler') {
        const hit = this.hitTest3DObjectAndPoint(e.clientX, e.clientY, false, true);
        if (hit) {
          this.orbit.enabled = false;
          const startEye: Vec3 = hit.objectId
            ? hit.pt
            : [hit.pt[0], Number((hit.pt[1] + hit.heightOffset).toFixed(2)), hit.pt[2]];
          this.draw3DState = {
            mode: 'ruler',
            startPt: startEye,
            curPt: startEye,
            fromId: hit.objectId,
            fromHeightOffset: hit.heightOffset,
          };
          this.store.activeRuler = { start: startEye, end: startEye };
          this.store.notifyViewportsOnly(false);
        }
        return;
      }

      if (this.store.activeTool === 'place_poi') {
        const hit = this.hitTest3DObjectAndPoint(e.clientX, e.clientY, true, false);
        if (hit) {
          const cat = this.store.creationDefaults.poiCategory || 'spawn_enemy';
          const meta = POI_META[cat] || POI_META.spawn_enemy;
          this.store.dispatchAICommand({
            action: 'add_poi',
            poi: {
              name: `${meta.label.split(' ')[0]}_${this.store.doc.pois.length + 1}`,
              category: cat,
              position: hit.pt,
              yaw: 0,
              showVision: cat === 'sniper_nest' || cat === 'spawn_enemy' || cat === 'boss',
              fov: 85,
              visionRange: 20,
              eyeHeight: this.store.doc.metricsProfile.eyeHeight,
            },
          });
        }
        return;
      }
    });

    this.renderer.domElement.addEventListener('pointermove', (e) => {
      if (this.store.isPlaytesting) return;

      if (this.isRMBFlying) {
        this.flyYaw -= e.movementX * 0.003;
        this.flyPitch = Math.max(-1.45, Math.min(1.45, this.flyPitch - e.movementY * 0.003));
        const euler = new THREE.Euler(this.flyPitch, this.flyYaw, 0, 'YXZ');
        this.camera.quaternion.setFromEuler(euler);
        const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(this.camera.quaternion);
        const targetDist = Math.max(4, this.camera.position.distanceTo(this.orbit.target));
        this.orbit.target.copy(this.camera.position).addScaledVector(forward, targetDist);
        return;
      }

      if (this.draw3DState) {
        const hit = this.hitTest3DObjectAndPoint(
          e.clientX,
          e.clientY,
          this.draw3DState.mode !== 'ruler',
          this.draw3DState.mode === 'ruler'
        );
        if (hit) {
          const endPt: Vec3 =
            this.draw3DState.mode === 'ruler' && !hit.objectId
              ? [hit.pt[0], Number((hit.pt[1] + this.store.doc.metricsProfile.crouchHeight).toFixed(2)), hit.pt[2]]
              : hit.pt;
          this.draw3DState.curPt = endPt;
          if (this.draw3DState.mode === 'block') {
            this.updatePreviewMesh(this.draw3DState.startPt, endPt);
          } else if (this.draw3DState.mode === 'jump') {
            this.sceneDirty = true;
            this.store.notifyViewportsOnly(false);
          } else if (this.draw3DState.mode === 'ruler') {
            this.store.activeRuler = { start: this.draw3DState.startPt, end: endPt };
            this.store.notifyViewportsOnly(false);
          }
        }
        return;
      }

      const blockType = this.isDrawBlockTool(this.store.activeTool);
      if (blockType) {
        const hit = this.hitTest3DObjectAndPoint(e.clientX, e.clientY, true);
        if (hit) {
          this.updatePreviewMesh(hit.pt, hit.pt);
        } else {
          this.previewMesh.visible = false;
        }
      } else {
        this.previewMesh.visible = false;
      }
    });

    window.addEventListener('pointerup', (e) => {
      if (this.isRMBFlying && e.button === 2) {
        this.isRMBFlying = false;
        if (!this.store.isPlaytesting && !this.isDraggingTransform) {
          this.orbit.enabled = true;
        }
        return;
      }

      if (this.store.isPlaytesting || e.button !== 0) return;

      if (this.draw3DState) {
        const st = this.draw3DState;
        this.draw3DState = null;
        this.orbit.enabled = true;
        this.previewMesh.visible = false;

        if (st.mode === 'block' && st.blockType) {
          const dragDist = Math.hypot(st.curPt[0] - st.startPt[0], st.curPt[2] - st.startPt[2]);
          const g = this.store.doc.metadata.gridSize || 0.5;
          const w = dragDist < 0.35 ? 3.0 : Math.max(g, Math.abs(st.curPt[0] - st.startPt[0]));
          const d = dragDist < 0.35 ? 3.0 : Math.max(g, Math.abs(st.curPt[2] - st.startPt[2]));
          const cx = dragDist < 0.35 ? st.startPt[0] : Number(((st.startPt[0] + st.curPt[0]) / 2).toFixed(2));
          const cz = dragDist < 0.35 ? st.startPt[2] : Number(((st.startPt[2] + st.curPt[2]) / 2).toFixed(2));
          const { role, floor, height } = this.store.creationDefaults;
          const h =
            role === 'walkable'
              ? 0.5
              : role === 'cover_low'
              ? this.store.doc.metricsProfile.lowCoverHeight
              : role === 'cover_full'
              ? this.store.doc.metricsProfile.fullCoverHeight
              : height;
          const cy =
            role === 'walkable'
              ? Number((st.startPt[1] - h / 2).toFixed(2))
              : Number((st.startPt[1] + h / 2).toFixed(2));

          this.store.dispatchAICommand({
            action: 'add_block',
            block: {
              name: `${ROLE_META[role].label.split(' ')[0]}_${this.store.doc.blocks.length + 1}`,
              type: st.blockType,
              role,
              position: [cx, cy, cz],
              size: [Number(w.toFixed(2)), Number(h.toFixed(2)), Number(d.toFixed(2))],
              rotation: [0, 0, 0],
              floor,
              color: this.store.creationDefaults.customColor,
            },
          });
        } else if (st.mode === 'jump') {
          const hitEnd = this.hitTest3DObjectAndPoint(e.clientX, e.clientY, true, false);
          const dist = Math.hypot(st.curPt[0] - st.startPt[0], st.curPt[2] - st.startPt[2]);
          if (dist >= 0.5) {
            this.store.dispatchAICommand({
              action: 'add_jump',
              jump: {
                name: `跳跃标尺_${this.store.doc.jumps.length + 1}`,
                from: st.startPt,
                to: st.curPt,
                fromId: st.fromId,
                toId: hitEnd?.objectId,
              },
            });
          } else {
            this.sceneDirty = true;
          }
        } else if (st.mode === 'ruler') {
          const hitEnd = this.hitTest3DObjectAndPoint(e.clientX, e.clientY, false, true);
          this.store.activeRuler = null;
          const dist = Math.hypot(st.curPt[0] - st.startPt[0], st.curPt[2] - st.startPt[2]);
          if (dist >= 0.5) {
            this.store.dispatchAICommand({
              action: 'add_sightline',
              sightline: {
                name: `视线尺_${(this.store.doc.sightlines?.length || 0) + 1}`,
                fromId: st.fromId,
                toId: hitEnd?.objectId,
                fromPos: st.startPt,
                toPos: st.curPt,
                fromHeightOffset: st.fromHeightOffset ?? this.store.doc.metricsProfile.eyeHeight,
                toHeightOffset: hitEnd?.heightOffset ?? this.store.doc.metricsProfile.crouchHeight,
              },
            });
          } else {
            this.store.notifyViewportsOnly(false);
          }
        }
        return;
      }
    });

    this.renderer.domElement.addEventListener('pointerup', (e) => {
      if (this.store.isPlaytesting || e.button !== 0 || this.draw3DState || this.store.activeTool !== 'select') return;
      const dist = Math.hypot(e.clientX - this.pointerDownPos.x, e.clientY - this.pointerDownPos.y);
      if (dist > 5 || this.isDraggingTransform) return;

      const rect = this.renderer.domElement.getBoundingClientRect();
      const mouse = new THREE.Vector2(
        ((e.clientX - rect.left) / rect.width) * 2 - 1,
        -((e.clientY - rect.top) / rect.height) * 2 + 1
      );
      this.raycaster.setFromCamera(mouse, this.camera);

      const poiObjects = Array.from(this.poiMap.values());
      const poiHits = this.raycaster.intersectObjects(poiObjects, true);
      if (poiHits.length > 0) {
        let cur: THREE.Object3D | null = poiHits[0].object;
        while (cur && !cur.userData?.poiId) cur = cur.parent;
        if (cur?.userData?.poiId) {
          this.store.setSelection({ kind: 'poi', id: cur.userData.poiId });
          return;
        }
      }

      const blkObjects = Array.from(this.meshMap.values());
      const blkHits = this.raycaster.intersectObjects(blkObjects, true);
      if (blkHits.length > 0) {
        let cur: THREE.Object3D | null = blkHits[0].object;
        while (cur && !cur.userData?.blockId) cur = cur.parent;
        if (cur?.userData?.blockId) {
          this.store.setSelection({ kind: 'block', id: cur.userData.blockId });
          return;
        }
      }

      this.store.setSelection(null);
    });

    window.addEventListener('keydown', (e) => {
      this.pressedKeys.add(e.code);
      if (e.code === 'KeyC' && this.store.isPlaytesting) {
        this.playCrouching = !this.playCrouching;
      }
      if (e.code === 'KeyV' && this.store.isPlaytesting) {
        const order: Array<'tps' | 'iso' | 'fps'> = ['tps', 'iso', 'fps'];
        this.playtestViewMode = order[(order.indexOf(this.playtestViewMode) + 1) % order.length];
        this.updatePlaytestHud();
      }
      if (e.code === 'Space' && this.store.isPlaytesting) {
        const m = this.store.doc.metricsProfile;
        if (this.playGrounded) {
          this.playVelocityY = Math.sqrt(2 * m.gravity * m.jumpHeight);
          this.playGrounded = false;
          this.playJumpsRemaining = m.doubleJumpHeight > 0 ? 1 : 0;
        } else if (this.playJumpsRemaining > 0 && m.doubleJumpHeight > 0) {
          this.playVelocityY = Math.sqrt(2 * m.gravity * m.doubleJumpHeight);
          this.playJumpsRemaining--;
        }
      }
      if (e.code === 'Escape' && this.store.isPlaytesting) {
        this.stopPlaytest();
      }
    });

    window.addEventListener('keyup', (e) => {
      this.pressedKeys.delete(e.code);
    });

    window.addEventListener('mousemove', (e) => {
      if (!this.store.isPlaytesting) return;
      if (document.pointerLockElement === this.renderer.domElement || e.buttons === 1 || e.buttons === 2) {
        this.playYaw -= e.movementX * 0.0028;
        this.playPitch = Math.max(-1.25, Math.min(1.15, this.playPitch - e.movementY * 0.0026));
      }
    });
  }

  /** Unity RMB + WASD/EQ Flythrough movement update */
  private updateRMBFlythrough(dt: number): void {
    const fast = this.pressedKeys.has('ShiftLeft') || this.pressedKeys.has('ShiftRight');
    const speed = (fast ? 26 : 11) * dt;

    const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(this.camera.quaternion);
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(this.camera.quaternion);
    const move = new THREE.Vector3();

    if (this.pressedKeys.has('KeyW')) move.addScaledVector(forward, speed);
    if (this.pressedKeys.has('KeyS')) move.addScaledVector(forward, -speed);
    if (this.pressedKeys.has('KeyD')) move.addScaledVector(right, speed);
    if (this.pressedKeys.has('KeyA')) move.addScaledVector(right, -speed);
    if (this.pressedKeys.has('KeyE')) move.y += speed;
    if (this.pressedKeys.has('KeyQ')) move.y -= speed;

    if (move.lengthSq() > 0) {
      this.camera.position.add(move);
      this.orbit.target.add(move);
    }
  }

  private getSafeSpawnPosition(): { pos: Vec3; yaw: number } {
    const spawn = this.store.doc.pois.find((p) => p.category === 'spawn_player');
    let sx = spawn ? spawn.position[0] : 0;
    let sy = spawn ? spawn.position[1] : 0.5;
    let sz = spawn ? spawn.position[2] : 0;
    const yaw = spawn?.yaw || 0;

    if (!spawn && this.store.doc.blocks.length > 0) {
      const walkBlk =
        this.store.doc.blocks.find((b) => b.role === 'walkable' && !b.hidden) || this.store.doc.blocks[0];
      sx = walkBlk.position[0];
      sz = walkBlk.position[2];
      sy = walkBlk.position[1] + walkBlk.size[1] / 2 + 0.05;
    }

    // Snap spawn Y onto the highest valid walkable surface at (sx, sz) so player never starts inside a block
    const floorY = this.findSurfaceSupportAt(sx, sz, sy + 1.2, 0, true, false);
    if (floorY > -90) {
      sy = floorY;
    }
    return { pos: [Number(sx.toFixed(2)), Number(sy.toFixed(2)), Number(sz.toFixed(2))], yaw };
  }

  public startPlaytest(): void {
    this.store.isPlaytesting = true;
    this.transformControl.detach();
    this.previewMesh.visible = false;
    this.orbit.enabled = false;

    const { pos: startPos, yaw } = this.getSafeSpawnPosition();
    this.playYaw = (-yaw * Math.PI) / 180;
    this.playPitch = -0.22;
    this.playVelocityY = 0;
    this.playGrounded = true;
    this.playCrouching = false;
    this.walkAnimPhase = 0;
    this.playJumpsRemaining = this.store.doc.metricsProfile.doubleJumpHeight > 0 ? 2 : 1;

    // Default to TPS in 3D playtest so the 3D character model is always clearly visible
    if (this.playtestViewMode === 'fps') {
      this.playtestViewMode = 'tps';
    }

    this.store.playtestPose = {
      position: startPos,
      yaw,
      trail: [startPos],
    };

    this.playtestHudEl.classList.add('active');
    this.updatePlaytestHud();
    this.store.notify(false);
  }

  public stopPlaytest(): void {
    if (!this.store.isPlaytesting) return;
    this.store.isPlaytesting = false;
    if (document.pointerLockElement === this.renderer.domElement) {
      document.exitPointerLock?.();
    }
    this.playtestHudEl.classList.remove('active');
    this.dropShadowGroup.visible = false;
    this.camera.fov = 55;
    this.camera.updateProjectionMatrix();
    this.orbit.enabled = true;
    this.camera.position.set(18, 16, 24);
    this.orbit.target.set(0, 1, 0);
    this.orbit.update();
    this.store.notify(false);
  }

  private updatePlaytestHud(): void {
    if (!this.playtestHudEl || !this.store.isPlaytesting) return;
    const pose = this.store.playtestPose;
    const posStr = pose ? `${pose.position[0].toFixed(1)}, ${pose.position[1].toFixed(1)}, ${pose.position[2].toFixed(1)}` : '0, 0, 0';
    const groundStr = this.playGrounded ? '🟢 着地' : '🚀 腾空';
    const crouchStr = this.playCrouching ? ' · 🧎下蹲中' : '';

    this.playtestHudEl.innerHTML = `
      <span style="font-weight:700;color:#34d399;">🎮 实机试玩</span>
      <span style="font-family:'JetBrains Mono',monospace;font-size:10px;color:#cbd5e1;">(${posStr}) ${groundStr}${crouchStr}</span>
      <div style="display:inline-flex;gap:3px;background:rgba(15,23,42,0.9);padding:2px;border-radius:5px;border:1px solid #334155;">
        <button class="chip-toggle ${this.playtestViewMode === 'tps' ? 'on' : ''}" data-pt-cam="tps" title="第三人称越肩跟随 (显示角色模型)">🧍 第三人称(V)</button>
        <button class="chip-toggle ${this.playtestViewMode === 'iso' ? 'on' : ''}" data-pt-cam="iso" title="高空斜向俯瞰跟拍 (最易观察跳跃落点)">🦅 俯瞰跟拍</button>
        <button class="chip-toggle ${this.playtestViewMode === 'fps' ? 'on' : ''}" data-pt-cam="fps" title="第一人称主视角">👁️ 第一人称</button>
      </div>
      <span style="font-size:10px;color:#94a3b8;">WASD移动 · Space跳跃 · 左键拖拽转镜头</span>
      <button class="chip-toggle" id="btn-hud-stop-play" style="border-color:#f87171;color:#fca5a5;">⏹ 退出(Esc)</button>
    `;

    this.playtestHudEl.querySelectorAll<HTMLButtonElement>('[data-pt-cam]').forEach((btn) => {
      btn.onclick = (e) => {
        e.stopPropagation();
        this.playtestViewMode = btn.dataset.ptCam as 'tps' | 'iso' | 'fps';
        this.updatePlaytestHud();
      };
    });

    const stopBtn = this.playtestHudEl.querySelector('#btn-hud-stop-play') as HTMLButtonElement | null;
    if (stopBtn) {
      stopBtn.onclick = (e) => {
        e.stopPropagation();
        this.stopPlaytest();
      };
    }
  }

  /** Transform world (wx, wz) into block's local (lx, lz) taking block Y-rotation into account */
  private worldToBlockLocalXZ(wx: number, wz: number, b: LevelBlock): [number, number] {
    const dx = wx - b.position[0];
    const dz = wz - b.position[2];
    const ry = (b.rotation[1] * Math.PI) / 180;
    const cosR = Math.cos(ry);
    const sinR = Math.sin(ry);
    return [dx * cosR - dz * sinR, dx * sinR + dz * cosR];
  }

  /** Transform block local (lx, lz) back to world (wx, wz) */
  private blockLocalToWorldXZ(lx: number, lz: number, b: LevelBlock): [number, number] {
    const ry = (b.rotation[1] * Math.PI) / 180;
    const cosR = Math.cos(ry);
    const sinR = Math.sin(ry);
    return [
      b.position[0] + lx * cosR + lz * sinR,
      b.position[2] - lx * sinR + lz * cosR,
    ];
  }

  /** Find highest valid floor/ramp/stairs surface height at (wx, wz) for a character at curY */
  private findSurfaceSupportAt(
    wx: number,
    wz: number,
    curY: number,
    vy: number,
    isGrounded: boolean,
    dropDownOneWay: boolean
  ): number {
    const m = this.store.doc.metricsProfile;
    const footR = m.playerRadius * 0.65;
    let bestSupportY = -100;

    for (const b of this.store.doc.blocks) {
      if (b.hidden || (!ROLE_META[b.role]?.solid && b.role !== 'one_way_platform')) continue;
      if (b.role === 'one_way_platform' && (vy > 0.08 || dropDownOneWay)) continue;

      const [w, h, d] = b.size;
      const hx = w / 2;
      const hy = h / 2;
      const hz = d / 2;
      const [lx, lz] = this.worldToBlockLocalXZ(wx, wz, b);

      if (b.type === 'cylinder') {
        const normR = Math.hypot(lx / (hx + footR), lz / (hz + footR));
        if (normR > 1.0) continue;
      } else {
        if (Math.abs(lx) > hx + footR || Math.abs(lz) > hz + footR) continue;
      }

      // If walking inside an Arch doorway opening, its roof is a ceiling, not a step-up floor
      if (b.type === 'arch') {
        const pillarW = Math.max(0.2, w * 0.22);
        const lintelH = Math.max(0.2, h * 0.25);
        const openingTop = b.position[1] + hy - lintelH;
        if (Math.abs(lx) < hx - pillarW && curY < openingTop - 0.1) {
          continue;
        }
      }

      let surfaceTop = b.position[1] + hy;
      if (b.type === 'ramp' || b.type === 'stairs') {
        const t = Math.max(0, Math.min(1, (hz - lz) / Math.max(0.1, d)));
        surfaceTop = b.position[1] - hy + t * h;
      }

      // Only snap/land on surfaces that are reachable from curY without upward teleporting through floors
      const maxAllowedTop = isGrounded ? curY + m.maxStepHeight + 0.1 : curY + 0.18;
      if (surfaceTop <= maxAllowedTop && surfaceTop > bestSupportY) {
        bestSupportY = surfaceTop;
      }
    }

    return bestSupportY;
  }

  /** Push 2D circle (lx, lz, r) out of local axis-aligned box [minX, maxX] x [minZ, maxZ] */
  private pushCircleOutOfBox2D(
    lx: number,
    lz: number,
    r: number,
    minX: number,
    maxX: number,
    minZ: number,
    maxZ: number
  ): [number, number] | null {
    const cx = Math.max(minX, Math.min(maxX, lx));
    const cz = Math.max(minZ, Math.min(maxZ, lz));
    const dx = lx - cx;
    const dz = lz - cz;
    const distSq = dx * dx + dz * dz;
    if (distSq >= r * r) return null;

    // Circle center is outside the box but within radius r of edge/corner
    if (distSq > 1e-6) {
      const dist = Math.sqrt(distSq);
      const push = r - dist;
      return [lx + (dx / dist) * push, lz + (dz / dist) * push];
    }

    // Circle center is inside the box: push out along minimum penetration axis
    const penLeft = lx - minX + r;
    const penRight = maxX - lx + r;
    const penBack = lz - minZ + r;
    const penFront = maxZ - lz + r;
    const minPen = Math.min(penLeft, penRight, penBack, penFront);
    if (minPen === penLeft) return [minX - r, lz];
    if (minPen === penRight) return [maxX + r, lz];
    if (minPen === penBack) return [lx, minZ - r];
    return [lx, maxZ + r];
  }

  private updatePlaytestPhysics(dt: number): void {
    const pose = this.store.playtestPose;
    if (!pose) return;
    const m = this.store.doc.metricsProfile;
    const dimMode = this.store.getDimensionMode();
    const is2DSide = dimMode === '2d_side' || m.cameraMode === 'side_2d';
    const is2DTopDown = dimMode === '2d_topdown' || m.cameraMode === 'topdown';

    const isSprinting = this.pressedKeys.has('ShiftLeft') || this.pressedKeys.has('ShiftRight');
    const speed = this.playCrouching ? m.crouchSpeed : isSprinting ? m.runSpeed : m.walkSpeed;
    const charH = this.playCrouching ? m.crouchHeight : m.playerHeight;
    const radius = m.playerRadius;

    let forward = 0;
    let strafe = 0;
    if (this.pressedKeys.has('KeyW') || this.pressedKeys.has('ArrowUp')) forward += 1;
    if (this.pressedKeys.has('KeyS') || this.pressedKeys.has('ArrowDown')) forward -= 1;
    if (this.pressedKeys.has('KeyD') || this.pressedKeys.has('ArrowRight')) strafe += 1;
    if (this.pressedKeys.has('KeyA') || this.pressedKeys.has('ArrowLeft')) strafe -= 1;

    let vx = 0;
    let vz = 0;
    let moveLen = 0;

    if (is2DSide) {
      moveLen = Math.abs(strafe);
      vx = strafe * speed;
      vz = 0;
      if (strafe > 0) this.playYaw = -Math.PI / 2;
      else if (strafe < 0) this.playYaw = Math.PI / 2;
    } else if (is2DTopDown || this.playtestViewMode === 'iso') {
      moveLen = Math.hypot(forward, strafe);
      if (moveLen > 0) {
        vx = (strafe / moveLen) * speed;
        vz = (-forward / moveLen) * speed;
        this.playYaw = -Math.atan2(vx, -vz);
      }
    } else {
      moveLen = Math.hypot(forward, strafe);
      if (moveLen > 0) {
        forward /= moveLen;
        strafe /= moveLen;
      }
      const sinY = Math.sin(this.playYaw);
      const cosY = Math.cos(this.playYaw);
      vx = (-sinY * forward + cosY * strafe) * speed;
      vz = (-cosY * forward - sinY * strafe) * speed;
    }

    const curY = pose.position[1];
    let nextX = pose.position[0] + vx * dt;
    let nextZ = is2DSide ? pose.position[2] : pose.position[2] + vz * dt;
    let nextY = curY;

    // 1. Horizontal Capsule-vs-OBB Collision with smooth wall-sliding (2 solver passes)
    const stepAllowance = this.playGrounded ? m.maxStepHeight + 0.05 : 0.05;
    const pBottom = curY + stepAllowance;
    const pTop = curY + charH - 0.04;

    for (let iter = 0; iter < 2; iter++) {
      for (const b of this.store.doc.blocks) {
        if (b.hidden || !ROLE_META[b.role]?.solid || b.role === 'one_way_platform') continue;
        const [w, h, d] = b.size;
        const hx = w / 2;
        const hy = h / 2;
        const hz = d / 2;
        const bMinY = b.position[1] - hy;
        const bMaxY = b.position[1] + hy;

        // Skip if no vertical overlap with the player's body above step height
        if (bMaxY <= pBottom || bMinY >= pTop) continue;

        const [lx, lz] = this.worldToBlockLocalXZ(nextX, nextZ, b);

        if (b.type === 'ramp' || b.type === 'stairs') {
          // For ramps/stairs, check slope height at the player's local Z
          const clampedLz = Math.max(-hz, Math.min(hz, lz));
          const t = Math.max(0, Math.min(1, (hz - clampedLz) / Math.max(0.1, d)));
          const slopeY = bMinY + t * h;
          // If the slope surface at this point is climbable, allow stepping onto it smoothly!
          if (slopeY <= curY + m.maxStepHeight + 0.22) continue;

          const pushed = this.pushCircleOutOfBox2D(lx, lz, radius, -hx, hx, -hz, hz);
          if (pushed) {
            [nextX, nextZ] = this.blockLocalToWorldXZ(pushed[0], pushed[1], b);
          }
        } else if (b.type === 'cylinder') {
          const dist = Math.hypot(lx / hx, lz / hz);
          const effR = hx + radius;
          const rawDist = Math.hypot(lx, lz);
          if (dist < 1 + radius / Math.max(0.2, hx) && rawDist < effR) {
            const nx = rawDist > 1e-4 ? lx / rawDist : 0;
            const nz = rawDist > 1e-4 ? lz / rawDist : 1;
            [nextX, nextZ] = this.blockLocalToWorldXZ(nx * effR, nz * effR, b);
          }
        } else if (b.type === 'arch') {
          const pillarW = Math.max(0.2, w * 0.22);
          const lintelH = Math.max(0.2, h * 0.25);
          // Left pillar
          let curL: [number, number] = [lx, lz];
          const p1 = this.pushCircleOutOfBox2D(curL[0], curL[1], radius, -hx, -hx + pillarW, -hz, hz);
          if (p1) curL = p1;
          // Right pillar
          const p2 = this.pushCircleOutOfBox2D(curL[0], curL[1], radius, hx - pillarW, hx, -hz, hz);
          if (p2) curL = p2;
          // Top lintel (only if player head reaches lintel height)
          if (pTop > bMaxY - lintelH) {
            const p3 = this.pushCircleOutOfBox2D(curL[0], curL[1], radius, -hx, hx, -hz, hz);
            if (p3) curL = p3;
          }
          if (curL[0] !== lx || curL[1] !== lz) {
            [nextX, nextZ] = this.blockLocalToWorldXZ(curL[0], curL[1], b);
          }
        } else {
          // Standard Box
          const pushed = this.pushCircleOutOfBox2D(lx, lz, radius, -hx, hx, -hz, hz);
          if (pushed) {
            [nextX, nextZ] = this.blockLocalToWorldXZ(pushed[0], pushed[1], b);
          }
        }
      }
    }

    // 2. Vertical Gravity, Ceiling Head-Bonk & Ground Support
    this.playVelocityY -= m.gravity * dt;
    nextY += this.playVelocityY * dt;

    // Ceiling collision when moving upward
    if (this.playVelocityY > 0) {
      for (const b of this.store.doc.blocks) {
        if (b.hidden || !ROLE_META[b.role]?.solid || b.role === 'one_way_platform') continue;
        const [w, h, d] = b.size;
        const hx = w / 2;
        const hy = h / 2;
        const hz = d / 2;
        const [lx, lz] = this.worldToBlockLocalXZ(nextX, nextZ, b);
        if (Math.abs(lx) > hx + radius * 0.5 || Math.abs(lz) > hz + radius * 0.5) continue;

        let undersideY = b.position[1] - hy;
        if (b.type === 'arch') {
          const pillarW = Math.max(0.2, w * 0.22);
          const lintelH = Math.max(0.2, h * 0.25);
          if (Math.abs(lx) < hx - pillarW) {
            undersideY = b.position[1] + hy - lintelH;
          }
        }

        if (curY + charH <= undersideY + 0.12 && nextY + charH > undersideY) {
          nextY = undersideY - charH - 0.01;
          this.playVelocityY = 0;
        }
      }
    }

    const dropDownOneWay = (this.pressedKeys.has('KeyS') || this.pressedKeys.has('ArrowDown')) && (is2DSide || this.pressedKeys.has('Space'));
    const supportY = this.findSurfaceSupportAt(
      nextX,
      nextZ,
      curY,
      this.playVelocityY,
      this.playGrounded,
      dropDownOneWay
    );

    if (this.playVelocityY <= 0.05 && nextY <= supportY) {
      nextY = supportY;
      this.playVelocityY = 0;
      this.playGrounded = true;
      this.playJumpsRemaining = m.doubleJumpHeight > 0 ? 2 : 1;
    } else if (
      this.playGrounded &&
      this.playVelocityY <= 0 &&
      supportY > -90 &&
      curY - supportY <= m.maxStepHeight + 0.18
    ) {
      // Stick smoothly to downward slopes/stairs
      nextY = supportY;
      this.playVelocityY = 0;
      this.playGrounded = true;
    } else {
      this.playGrounded = false;
      if (nextY < -18) {
        const respawn = this.getSafeSpawnPosition();
        nextX = respawn.pos[0];
        nextY = respawn.pos[1];
        nextZ = respawn.pos[2];
        this.playVelocityY = 0;
        this.playGrounded = true;
      }
    }

    pose.position = [Number(nextX.toFixed(2)), Number(nextY.toFixed(2)), Number(nextZ.toFixed(2))];
    pose.yaw = Math.round(((-this.playYaw * 180) / Math.PI + 360) % 360);

    const lastTrail = pose.trail[pose.trail.length - 1];
    if (!lastTrail || Math.hypot(nextX - lastTrail[0], nextZ - lastTrail[2], nextY - lastTrail[1]) > 0.7) {
      pose.trail.push([...pose.position]);
      if (pose.trail.length > 200) pose.trail.shift();
    }

    // 3. Camera Rig Update (Supports TPS, ISO Overview, FPS, 2D Side, 2D Top-Down)
    const eyeH = this.playCrouching ? m.crouchHeight * 0.85 : m.eyeHeight;
    if (this.playtestViewMode === 'iso' && !is2DSide && !is2DTopDown) {
      this.camera.fov = 55;
      this.camera.updateProjectionMatrix();
      this.camera.position.set(pose.position[0] + 10, pose.position[1] + 12, pose.position[2] + 12);
      this.camera.lookAt(pose.position[0], pose.position[1] + 1.0, pose.position[2]);
    } else {
      const effectiveCamMode = is2DSide
        ? ('side_2d' as const)
        : is2DTopDown
        ? ('topdown' as const)
        : this.playtestViewMode === 'fps'
        ? ('fps' as const)
        : ('tps' as const);
      const playMetrics = {
        ...m,
        cameraOffsetY: eyeH,
        cameraMode: effectiveCamMode,
      };
      const rig = computePlayerCameraRig(
        pose.position,
        pose.yaw,
        playMetrics,
        this.store.doc.blocks,
        (this.playPitch * 180) / Math.PI
      );
      this.camera.fov = rig.cameraFov;
      this.camera.updateProjectionMatrix();
      this.camera.position.set(rig.actualCamPos[0], rig.actualCamPos[1], rig.actualCamPos[2]);
      this.camera.lookAt(rig.lookTarget[0], rig.lookTarget[1], rig.lookTarget[2]);
    }

    // 4. Animate 3D Character Avatar & Ground Landing Drop-Shadow Ring
    const showAvatar = this.playtestViewMode !== 'fps' || is2DSide || is2DTopDown;
    this.scaleCapsuleMesh.visible = showAvatar;
    this.scaleCapsuleMesh.position.set(pose.position[0], pose.position[1], pose.position[2]);
    this.scaleCapsuleMesh.rotation.set(0, this.playYaw, 0);
    this.scaleCapsuleMesh.scale.set(
      m.playerRadius / 0.4,
      charH / 1.8,
      m.playerRadius / 0.4
    );

    const ud = this.scaleCapsuleMesh.userData;
    if (ud?.leftArmPivot) {
      if (!this.playGrounded) {
        ud.leftArmPivot.rotation.x = -2.2;
        ud.rightArmPivot.rotation.x = -2.2;
        ud.leftLegPivot.rotation.x = -0.45;
        ud.rightLegPivot.rotation.x = 0.35;
      } else if (moveLen > 0.05) {
        this.walkAnimPhase += dt * speed * 2.4;
        const swing = Math.sin(this.walkAnimPhase) * 0.65;
        ud.leftArmPivot.rotation.x = swing;
        ud.rightArmPivot.rotation.x = -swing;
        ud.leftLegPivot.rotation.x = -swing;
        ud.rightLegPivot.rotation.x = swing;
      } else {
        ud.leftArmPivot.rotation.x = 0;
        ud.rightArmPivot.rotation.x = 0;
        ud.leftLegPivot.rotation.x = 0;
        ud.rightLegPivot.rotation.x = 0;
      }
    }

    // Update ground projection ring directly below player feet for easy jump landing judgment
    const groundBelowY = this.findSurfaceSupportAt(nextX, nextZ, curY + 20, -1, false, false);
    const shadowY = groundBelowY > -90 ? groundBelowY : 0;
    this.dropShadowGroup.visible = showAvatar;
    this.dropShadowGroup.position.set(pose.position[0], shadowY + 0.03, pose.position[2]);
    const vLine = this.dropShadowGroup.userData?.vLine as THREE.Line | undefined;
    if (vLine) {
      const hDiff = Math.max(0, pose.position[1] - shadowY);
      vLine.scale.set(1, hDiff, 1);
      vLine.visible = hDiff > 0.15;
    }

    this.updatePlaytestHud();
    this.store.notifyViewportsOnly(false);
  }

  private elevationToHeatColor(topY: number): string {
    const t = Math.max(0, Math.min(1, (topY + 1) / 8));
    const hue = Math.round(210 - t * 185);
    return `hsl(${hue}, 70%, 42%)`;
  }

  private createBlockDimensionStencilMesh(b: LevelBlock): THREE.Mesh | null {
    const [w, h, d] = b.size;
    const isVerticalWall = h > d * 1.4 && w >= 1.5 && h >= 1.0;
    const isHorizontalPad = w >= 1.6 && d >= 1.2;
    if (!isVerticalWall && !isHorizontalPad) return null;

    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 128;
    const ctx = canvas.getContext('2d')!;

    ctx.fillStyle = 'rgba(15, 23, 42, 0.78)';
    ctx.beginPath();
    ctx.roundRect(6, 10, 500, 108, 14);
    ctx.fill();

    ctx.strokeStyle = 'rgba(248, 250, 252, 0.65)';
    ctx.lineWidth = 3;
    ctx.stroke();

    const topY = Number((b.position[1] + h / 2).toFixed(2));
    ctx.fillStyle = '#f8fafc';
    ctx.font = 'bold 30px "JetBrains Mono", Inter, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(`${w}m × ${h}m × ${d}m`, 256, 46);

    ctx.fillStyle = '#38bdf8';
    ctx.font = '600 22px "JetBrains Mono", Inter, sans-serif';
    ctx.fillText(`${b.name} · TOP ${topY >= 0 ? '+' : ''}${topY}m`, 256, 88);

    const tex = new THREE.CanvasTexture(canvas);
    tex.anisotropy = 4;
    tex.needsUpdate = true;

    const mat = new THREE.MeshBasicMaterial({
      map: tex,
      transparent: true,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      clippingPlanes: this.store.doc.sectionPlane.clip3D ? [this.clippingPlane] : [],
    });

    if (isVerticalWall && b.type !== 'ramp' && b.type !== 'stairs') {
      const decalW = Math.min(w * 0.75, Math.max(1.4, Math.min(3.6, h * 1.6)));
      const decalH = decalW * 0.25;
      const plane = new THREE.Mesh(new THREE.PlaneGeometry(decalW, decalH), mat);
      plane.position.set(0, 0, d / 2 + 0.012);
      return plane;
    }

    const spanW = Math.min(w * 0.78, d * 1.8, 3.8);
    const decalW = Math.max(1.2, spanW);
    const decalH = Math.min(d * 0.75, decalW * 0.25);
    const plane = new THREE.Mesh(new THREE.PlaneGeometry(decalW, decalH), mat);
    if (b.type === 'ramp') {
      const slopeAngle = Math.atan2(h, d);
      plane.rotation.x = -Math.PI / 2 + slopeAngle;
      plane.position.set(0, 0.015, 0);
    } else {
      plane.rotation.x = -Math.PI / 2;
      plane.position.set(0, h / 2 + 0.012, 0);
    }
    return plane;
  }

  private buildMeshForBlock(b: LevelBlock): THREE.Object3D {
    const meta = ROLE_META[b.role] || ROLE_META.walkable;
    const isSelected = this.store.selection?.kind === 'block' && this.store.selection.id === b.id;
    const isTrigger = b.role.startsWith('trigger_') || b.role === 'water' || b.role === 'hazard';
    const topY = Number((b.position[1] + b.size[1] / 2).toFixed(2));
    const baseColor = new THREE.Color(
      this.store.overlays.elevationHeatmap ? this.elevationToHeatColor(topY) : b.color || meta.color
    );

    const mat = new THREE.MeshStandardMaterial({
      color: baseColor,
      map: isTrigger ? null : this.gridTexture,
      roughness: 0.68,
      metalness: 0.1,
      transparent: isTrigger,
      opacity: isTrigger ? 0.35 : 1.0,
      clippingPlanes: this.store.doc.sectionPlane.clip3D ? [this.clippingPlane] : [],
    });

    const group = new THREE.Group();
    group.userData = { blockId: b.id };

    const [w, h, d] = b.size;
    const cylRad = b.type === 'cylinder' ? (w + d) / 4 : 0;

    const addPart = (rawGeo: THREE.BufferGeometry, offset: Vec3 = [0, 0, 0]) => {
      const edgeGeo = new THREE.EdgesGeometry(rawGeo, 20);
      const uvGeo = isTrigger
        ? rawGeo
        : this.applyMetricTriplanarUVs(rawGeo, offset, -h / 2, cylRad);
      if (uvGeo !== rawGeo) {
        rawGeo.dispose();
      }

      const mesh = new THREE.Mesh(uvGeo, mat);
      mesh.position.set(offset[0], offset[1], offset[2]);
      mesh.castShadow = !isTrigger;
      mesh.receiveShadow = true;
      group.add(mesh);

      const edges = new THREE.LineSegments(
        edgeGeo,
        new THREE.LineBasicMaterial({
          color: isSelected ? 0x38bdf8 : 0x0f172a,
          linewidth: 1,
        })
      );
      edges.position.copy(mesh.position);
      group.add(edges);
    };

    if (b.type === 'box') {
      addPart(new THREE.BoxGeometry(w, h, d));
    } else if (b.type === 'cylinder') {
      addPart(new THREE.CylinderGeometry(w / 2, d / 2, h, 24));
    } else if (b.type === 'ramp') {
      const geo = new THREE.BufferGeometry();
      const hx = w / 2, hy = h / 2, hz = d / 2;
      const positions = new Float32Array([
        -hx, -hy, -hz, hx, hy, -hz, hx, -hy, -hz,
        -hx, -hy, -hz, -hx, hy, -hz, hx, hy, -hz,
        -hx, -hy, -hz, hx, -hy, -hz, hx, -hy, hz,
        -hx, -hy, -hz, hx, -hy, hz, -hx, -hy, hz,
        -hx, hy, -hz, -hx, -hy, hz, hx, -hy, hz,
        -hx, hy, -hz, hx, -hy, hz, hx, hy, -hz,
        -hx, -hy, -hz, -hx, -hy, hz, -hx, hy, -hz,
        hx, -hy, -hz, hx, hy, -hz, hx, -hy, hz,
      ]);
      geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
      geo.computeVertexNormals();
      addPart(geo);
    } else if (b.type === 'stairs') {
      const steps = Math.max(2, Math.min(24, b.steps || Math.round(h / 0.25) || 8));
      const stepH = h / steps;
      const stepD = d / steps;
      for (let i = 0; i < steps; i++) {
        const curH = (i + 1) * stepH;
        const zCenter = d / 2 - (i + 0.5) * stepD;
        const yCenter = -h / 2 + curH / 2;
        addPart(new THREE.BoxGeometry(w, curH, stepD), [0, yCenter, zCenter]);
      }
    } else if (b.type === 'arch') {
      const pillarW = Math.max(0.2, w * 0.22);
      const lintelH = Math.max(0.2, h * 0.25);
      const pillarH = h - lintelH;
      addPart(new THREE.BoxGeometry(pillarW, pillarH, d), [-w / 2 + pillarW / 2, -lintelH / 2, 0]);
      addPart(new THREE.BoxGeometry(pillarW, pillarH, d), [w / 2 - pillarW / 2, -lintelH / 2, 0]);
      addPart(new THREE.BoxGeometry(w, lintelH, d), [0, h / 2 - lintelH / 2, 0]);
    }

    if (!isTrigger && (this.store.overlays.showDimensions || isSelected) && b.type !== 'stairs' && b.type !== 'arch') {
      const stencil = this.createBlockDimensionStencilMesh(b);
      if (stencil) group.add(stencil);
    }

    group.position.set(b.position[0], b.position[1], b.position[2]);
    group.rotation.set(
      THREE.MathUtils.degToRad(b.rotation[0]),
      THREE.MathUtils.degToRad(b.rotation[1]),
      THREE.MathUtils.degToRad(b.rotation[2])
    );

    return group;
  }

  private buildPOIObject(poi: LevelPOI): THREE.Object3D {
    const meta = POI_META[poi.category] || POI_META.objective;
    const isSel = this.store.selection?.kind === 'poi' && this.store.selection.id === poi.id;
    const group = new THREE.Group();
    group.userData = { poiId: poi.id };

    const col = new THREE.Color(meta.color);
    const pinMat = new THREE.MeshStandardMaterial({
      color: col,
      emissive: col,
      emissiveIntensity: isSel ? 0.5 : 0.2,
      roughness: 0.3,
    });

    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, poi.eyeHeight, 10), pinMat);
    pole.position.y = poi.eyeHeight / 2;
    group.add(pole);

    const head = new THREE.Mesh(new THREE.OctahedronGeometry(0.42, 1), pinMat);
    head.position.y = poi.eyeHeight;
    group.add(head);

    const arrow = new THREE.Mesh(new THREE.ConeGeometry(0.22, 0.65, 8), pinMat);
    arrow.rotation.x = -Math.PI / 2;
    arrow.position.set(0, poi.eyeHeight, -0.55);
    group.add(arrow);

    group.position.set(poi.position[0], poi.position[1], poi.position[2]);
    group.rotation.y = THREE.MathUtils.degToRad(-poi.yaw);
    return group;
  }

  /** 释放一个对象及其所有子对象的几何体、材质与独有贴图（共享白盒网格贴图不在这里释放） */
  private disposeObjectTree(root: THREE.Object3D): void {
    const disposeMat = (m: THREE.Material) => {
      const anyMat = m as THREE.MeshBasicMaterial & { map?: THREE.Texture | null };
      if (anyMat.map && anyMat.map !== this.gridTexture) {
        anyMat.map.dispose();
      }
      m.dispose();
    };
    root.traverse((obj) => {
      const o = obj as THREE.Mesh;
      if (o.geometry) o.geometry.dispose();
      const mat = o.material as THREE.Material | THREE.Material[] | undefined;
      if (Array.isArray(mat)) mat.forEach(disposeMat);
      else if (mat) disposeMat(mat);
    });
  }

  private disposeGroupContents(group: THREE.Group): void {
    this.disposeObjectTree(group);
    group.clear();
  }

  /**
   * 增量同步体块网格：每个体块按自身内容（含选中 / 剖切 / 语义色）算一个签名，
   * 签名没变的网格原样保留，只重建真正改动的那几个。拖动一个体块时不再重建整个场景。
   */
  private syncBlockMeshes(force: boolean): void {
    if (force) {
      this.disposeGroupContents(this.blockGroup);
      this.meshMap.clear();
      this.blockMeshKeys.clear();
    }
    const floorFilter = this.store.overlays.floorFilter;
    const sel = this.store.selection;
    const selectedId = sel?.kind === 'block' ? sel.id : '';
    const clip = this.store.doc.sectionPlane.clip3D ? '|clip' : '';
    const heat = this.store.overlays.elevationHeatmap ? '|heat' : '';
    const dim = this.store.overlays.showDimensions ? '|dim' : '';
    const liveSlots = new Set<string>();
    const createdNow: THREE.Object3D[] = [];

    for (const b of this.store.doc.blocks) {
      if (b.hidden || (floorFilter !== 'all' && b.floor !== floorFilter)) continue;
      // 旧存档里可能有重复 id：重复者用带序号的槽位，保证每个体块都有自己的网格
      const slot = liveSlots.has(b.id) ? `${b.id}#${liveSlots.size}` : b.id;
      liveSlots.add(slot);
      const key = `${JSON.stringify(b)}${b.id === selectedId ? '|sel' : ''}${clip}${heat}${dim}|${ROLE_META[b.role]?.color ?? ''}`;
      const existing = this.meshMap.get(slot);
      if (existing && this.blockMeshKeys.get(slot) === key) continue;
      if (existing) {
        this.disposeObjectTree(existing);
        this.blockGroup.remove(existing);
        this.blockPopIns.delete(existing);
      }
      const obj = this.buildMeshForBlock(b);
      if (!existing) createdNow.push(obj);
      this.blockGroup.add(obj);
      this.meshMap.set(slot, obj);
      this.blockMeshKeys.set(slot, key);
    }

    for (const [slot, obj] of this.meshMap) {
      if (liveSlots.has(slot)) continue;
      this.disposeObjectTree(obj);
      this.blockGroup.remove(obj);
      this.blockPopIns.delete(obj);
      this.meshMap.delete(slot);
      this.blockMeshKeys.delete(slot);
    }

    // 只给"少量新增"做入场动画：首次加载、切换场景、整体重建时一次出现很多体块，不做
    const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (this.hasSyncedBlocksOnce && !force && !reduceMotion && createdNow.length > 0 && createdNow.length <= 6) {
      const now = performance.now();
      for (const obj of createdNow) {
        obj.scale.setScalar(0.82);
        this.blockPopIns.set(obj, now);
      }
    }
    this.hasSyncedBlocksOnce = true;
  }

  private updateBlockPopIns(now: number): void {
    if (this.blockPopIns.size === 0) return;
    const DURATION = 220;
    for (const [obj, start] of this.blockPopIns) {
      const t = Math.min(1, (now - start) / DURATION);
      // easeOutBack：略微过冲再回落
      const c1 = 1.70158;
      const eased = 1 + (c1 + 1) * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
      obj.scale.setScalar(0.82 + 0.18 * eased);
      if (t >= 1) {
        obj.scale.setScalar(1);
        this.blockPopIns.delete(obj);
      }
    }
  }

  private computeOverlayRenderKey(): string {
    const doc = this.store.doc;
    return JSON.stringify([
      doc.pois,
      doc.paths,
      doc.jumps,
      doc.sightlines,
      this.store.activeRuler,
      this.draw3DState?.mode === 'jump' ? [this.draw3DState.startPt, this.draw3DState.curPt] : null,
      this.store.overlays,
      doc.metricsProfile,
      this.store.selection,
      computeBlocksSignature(doc.blocks),
      doc.blocks.map((b) => [b.id, b.linkedId || '']),
    ]);
  }

  /**
   * 按 store 当前状态同步 3D 场景。体块网格与叠加层（POI / 视野锥 / 路径 / 标尺）各自按内容签名
   * 判断是否需要重建；`force = true`（外部显式调用，如切换主题）时无条件全部重建。
   */
  public rebuildSceneFromStore(force = true): void {
    this.sceneDirty = false;
    const th = getTheme();
    this.scene.background = new THREE.Color(th.vp3dBg || '#0b111e');
    this.scene.fog = new THREE.FogExp2(th.vp3dBg || '#0b111e', 0.008);
    this.transformControl.detach();

    const { start, end, clip3D, flipNormal } = this.store.doc.sectionPlane;
    const dx = end[0] - start[0];
    const dz = end[1] - start[1];
    const secLen = Math.max(0.1, Math.hypot(dx, dz));
    const sign = flipNormal ? -1 : 1;
    const nx = (-dz / secLen) * sign;
    const nz = (dx / secLen) * sign;
    const normalVec = new THREE.Vector3(nx, 0, nz).normalize();
    this.clippingPlane.setFromNormalAndCoplanarPoint(normalVec, new THREE.Vector3(start[0], 0, start[1]));

    this.sectionPlaneHelper.visible = this.store.activeTool === 'edit_section' || clip3D;
    this.sectionPlaneHelper.scale.set(secLen, 1, 1);
    this.sectionPlaneHelper.position.set((start[0] + end[0]) / 2, 2.5, (start[1] + end[1]) / 2);
    this.sectionPlaneHelper.rotation.y = -Math.atan2(dz, dx);

    this.syncBlockMeshes(force);

    const overlayKey = this.computeOverlayRenderKey();
    if (force || overlayKey !== this.overlayRenderKey) {
      this.overlayRenderKey = overlayKey;
      this.disposeGroupContents(this.overlayGroup);
      this.poiMap.clear();
      this.rebuildOverlayObjects();
    }

    this.syncSelectionGizmoAndCapsule();
  }

  private rebuildOverlayObjects(): void {
    for (const poi of this.store.doc.pois) {
      const poiObj = this.buildPOIObject(poi);
      this.overlayGroup.add(poiObj);
      this.poiMap.set(poi.id, poiObj);

      const isPlayerSpawn = poi.category === 'spawn_player';
      const mp = this.store.doc.metricsProfile;
      const shouldDrawVision =
        this.store.overlays.showVisionCones &&
        (isPlayerSpawn ? (mp.showPlayerVision ?? true) : poi.showVision);

      if (shouldDrawVision) {
        const effectivePoi: LevelPOI = isPlayerSpawn
          ? {
              ...poi,
              fov: mp.playerVisionFov ?? poi.fov ?? 95,
              visionRange: mp.playerVisionRange ?? poi.visionRange ?? 26,
              eyeHeight: mp.eyeHeight ?? poi.eyeHeight ?? 1.65,
            }
          : poi;
        // 与俯视视口使用相同的射线数，两边共享同一份视野多边形缓存
        const poly = computeVisibilityPolygon(effectivePoi, this.store.doc.blocks, 56);
        if (poly.length >= 3) {
          const positions: number[] = [];
          const origin = poly[0];
          for (let i = 1; i < poly.length - 1; i++) {
            positions.push(
              origin[0], origin[1], origin[2],
              poly[i][0], poly[i][1], poly[i][2],
              poly[i + 1][0], poly[i + 1][1], poly[i + 1][2]
            );
          }
          const coneGeo = new THREE.BufferGeometry();
          coneGeo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
          const meta = POI_META[poi.category] || POI_META.sniper_nest;
          const coneMat = new THREE.MeshBasicMaterial({
            color: new THREE.Color(meta.color),
            transparent: true,
            opacity: isPlayerSpawn ? 0.16 : 0.22,
            side: THREE.DoubleSide,
            depthWrite: false,
          });
          this.overlayGroup.add(new THREE.Mesh(coneGeo, coneMat));
        }
      }

      // Draw Player 3D Camera Rig (SpringArm + Camera Body + 16:9 Frustum + Peripheral Ring)
      if (isPlayerSpawn && this.store.overlays.showVisionCones) {
        const periph = mp.playerPeripheralRange ?? 5.0;
        if (periph > 0 && (mp.showPlayerVision ?? true)) {
          const pRing = new THREE.RingGeometry(periph - 0.08, periph, 48);
          pRing.rotateX(-Math.PI / 2);
          const pMesh = new THREE.Mesh(
            pRing,
            new THREE.MeshBasicMaterial({ color: 0x22c55e, transparent: true, opacity: 0.4, side: THREE.DoubleSide })
          );
          pMesh.position.set(poi.position[0], poi.position[1] + 0.08, poi.position[2]);
          this.overlayGroup.add(pMesh);
        }

        if (mp.showPlayerCameraFrustum ?? true) {
          const rig = computePlayerCameraRig(poi.position, poi.yaw, mp, this.store.doc.blocks);
          const vPivot = new THREE.Vector3(...rig.pivotPos);
          const vActual = new THREE.Vector3(...rig.actualCamPos);
          const vIdeal = new THREE.Vector3(...rig.idealCamPos);

          // SpringArm Boom Line
          if (rig.idealDistance > 0.05) {
            this.overlayGroup.add(
              new THREE.Line(
                new THREE.BufferGeometry().setFromPoints([vPivot, vActual]),
                new THREE.LineBasicMaterial({ color: rig.springArmClipped ? 0xf59e0b : 0x38bdf8 })
              )
            );
            if (rig.springArmClipped) {
              this.overlayGroup.add(
                new THREE.Line(
                  new THREE.BufferGeometry().setFromPoints([vActual, vIdeal]),
                  new THREE.LineBasicMaterial({ color: 0xef4444 })
                )
              );
            }
          }

          // 3D Camera Body Box at actualCamPos
          const camBox = new THREE.Mesh(
            new THREE.BoxGeometry(0.45, 0.3, 0.55),
            new THREE.MeshBasicMaterial({ color: rig.springArmClipped ? 0xf59e0b : 0x38bdf8, wireframe: true })
          );
          camBox.position.copy(vActual);
          camBox.lookAt(rig.lookTarget[0], rig.lookTarget[1], rig.lookTarget[2]);
          this.overlayGroup.add(camBox);

          // 3D Camera Frustum Pyramid Lines
          const n = rig.frustumNear.map((p) => new THREE.Vector3(...p));
          const f = rig.frustumFar.map((p) => new THREE.Vector3(...p));
          const frustumSegments: THREE.Vector3[] = [
            n[0], n[1], n[1], n[2], n[2], n[3], n[3], n[0],
            f[0], f[1], f[1], f[2], f[2], f[3], f[3], f[0],
            vActual, f[0], vActual, f[1], vActual, f[2], vActual, f[3],
          ];
          const frustumGeo = new THREE.BufferGeometry().setFromPoints(frustumSegments);
          const frustumLines = new THREE.LineSegments(
            frustumGeo,
            new THREE.LineBasicMaterial({ color: 0x38bdf8, transparent: true, opacity: 0.65 })
          );
          this.overlayGroup.add(frustumLines);
        }
      }

      // Draw 3D Enemy Patrol Waypoints, A* Route, Hearing Ring & Chase Path
      if (poi.enemyConfig) {
        const cfg = poi.enemyConfig;
        if (cfg.hearingRange > 0 && this.store.overlays.showVisionCones) {
          const hRing = new THREE.RingGeometry(cfg.hearingRange - 0.08, cfg.hearingRange, 48);
          hRing.rotateX(-Math.PI / 2);
          const hMesh = new THREE.Mesh(
            hRing,
            new THREE.MeshBasicMaterial({ color: 0x38bdf8, transparent: true, opacity: 0.35, side: THREE.DoubleSide })
          );
          hMesh.position.set(poi.position[0], poi.position[1] + 0.08, poi.position[2]);
          this.overlayGroup.add(hMesh);
        }

        if (cfg.waypoints && cfg.waypoints.length > 0) {
          const chain: Vec3[] = [poi.position, ...cfg.waypoints];
          if (cfg.patrolMode === 'loop' && cfg.waypoints.length >= 2) {
            chain.push(poi.position);
          }
          const allPts: THREE.Vector3[] = [];
          for (let i = 0; i < chain.length - 1; i++) {
            const seg = cfg.autoPathfind
              ? computeEnemyPathAStar(chain[i], chain[i + 1], this.store.doc)
              : [chain[i], chain[i + 1]];
            for (const p of seg) {
              allPts.push(new THREE.Vector3(p[0], p[1] + 0.2, p[2]));
            }
          }
          if (allPts.length >= 2) {
            const lineGeo = new THREE.BufferGeometry().setFromPoints(allPts);
            this.overlayGroup.add(new THREE.Line(lineGeo, new THREE.LineBasicMaterial({ color: 0xfb923c })));
          }

          for (const wp of cfg.waypoints) {
            const wpMesh = new THREE.Mesh(
              new THREE.SphereGeometry(0.28, 12, 12),
              new THREE.MeshBasicMaterial({ color: 0xfb923c })
            );
            wpMesh.position.set(wp[0], wp[1] + 0.28, wp[2]);
            this.overlayGroup.add(wpMesh);
          }
        }
      }
    }

    if (this.store.overlays.showFlowPaths) {
      for (const path of this.store.doc.paths) {
        if (path.points.length < 2) continue;
        const meta = FLOW_META[path.type] || FLOW_META.main;
        const pts = path.points.map((p) => new THREE.Vector3(p[0], p[1] + 0.15, p[2]));
        const lineGeo = new THREE.BufferGeometry().setFromPoints(pts);
        const lineMat = new THREE.LineBasicMaterial({ color: new THREE.Color(meta.color) });
        this.overlayGroup.add(new THREE.Line(lineGeo, lineMat));
      }
    }

    if (this.store.overlays.showJumpArcs) {
      const jumpsToDraw = [
        ...this.store.doc.jumps,
        ...(this.draw3DState?.mode === 'jump'
          ? [{ id: '__preview__', name: 'Preview', from: this.draw3DState.startPt, to: this.draw3DState.curPt }]
          : []),
      ];
      for (const jmp of jumpsToDraw) {
        const evalRes = evaluateJumpLink(jmp.from, jmp.to, this.store.doc.metricsProfile, this.store.doc.blocks);
        const col =
          evalRes.status === 'safe'
            ? 0x22c55e
            : evalRes.status === 'stretch'
            ? 0xf59e0b
            : evalRes.status === 'double_jump'
            ? 0x38bdf8
            : 0xef4444;

        const capPts = evalRes.capabilityArcPoints.map((p) => new THREE.Vector3(p[0], p[1], p[2]));
        const capCurve = new THREE.CatmullRomCurve3(capPts);
        const tubeGeo = new THREE.TubeGeometry(capCurve, 24, 0.09, 8, false);
        const tubeMat = new THREE.MeshBasicMaterial({ color: col });
        this.overlayGroup.add(new THREE.Mesh(tubeGeo, tubeMat));

        const ringGeo = new THREE.RingGeometry(0.28, 0.45, 24);
        ringGeo.rotateX(-Math.PI / 2);
        const ringMesh = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ color: col, side: THREE.DoubleSide }));
        ringMesh.position.set(
          evalRes.maxReachPoint[0],
          evalRes.maxReachPoint[1] + 0.05,
          evalRes.maxReachPoint[2]
        );
        this.overlayGroup.add(ringMesh);

        const refPts = evalRes.arcPoints.map((p) => new THREE.Vector3(p[0], p[1], p[2]));
        const refGeo = new THREE.BufferGeometry().setFromPoints(refPts);
        const refLine = new THREE.Line(
          refGeo,
          new THREE.LineBasicMaterial({ color: 0x94a3b8, transparent: true, opacity: 0.5 })
        );
        this.overlayGroup.add(refLine);
      }
    }

    // 5. Render 3D Object-Connected Sightline Rulers
    const sightlinesToDraw = [
      ...(this.store.doc.sightlines || []).map((s) => resolveSightlineEndpoints(s, this.store.doc)),
      ...(this.store.activeRuler
        ? [{ from: this.store.activeRuler.start, to: this.store.activeRuler.end, fromLabel: 'Ruler', toLabel: 'Target' }]
        : []),
    ];

    for (const sl of sightlinesToDraw) {
      const los = raycastLevel3D(sl.from, sl.to, this.store.doc.blocks);
      const vFrom = new THREE.Vector3(sl.from[0], sl.from[1], sl.from[2]);
      const vTo = new THREE.Vector3(sl.to[0], sl.to[1], sl.to[2]);
      if (los.blocked && los.hitPoint) {
        const vHit = new THREE.Vector3(los.hitPoint[0], los.hitPoint[1], los.hitPoint[2]);
        this.overlayGroup.add(
          new THREE.Line(
            new THREE.BufferGeometry().setFromPoints([vFrom, vHit]),
            new THREE.LineBasicMaterial({ color: 0x4ade80 })
          )
        );
        this.overlayGroup.add(
          new THREE.Line(
            new THREE.BufferGeometry().setFromPoints([vHit, vTo]),
            new THREE.LineBasicMaterial({ color: 0xef4444 })
          )
        );
        const hitSphere = new THREE.Mesh(
          new THREE.SphereGeometry(0.22, 12, 12),
          new THREE.MeshBasicMaterial({ color: 0xef4444 })
        );
        hitSphere.position.copy(vHit);
        this.overlayGroup.add(hitSphere);
      } else {
        this.overlayGroup.add(
          new THREE.Line(
            new THREE.BufferGeometry().setFromPoints([vFrom, vTo]),
            new THREE.LineBasicMaterial({ color: 0x4ade80 })
          )
        );
      }
    }

    // 6. Render 3D Lock-and-Key / Mechanism Dependency Links
    if (this.store.overlays.showDesignNotes) {
      const tLinks = resolveTriggerLinks(this.store.doc);
      for (const lnk of tLinks) {
        const vFrom = new THREE.Vector3(lnk.fromPos[0], lnk.fromPos[1] + 0.4, lnk.fromPos[2]);
        const vTo = new THREE.Vector3(lnk.toPos[0], lnk.toPos[1] + 0.4, lnk.toPos[2]);
        const vMid = new THREE.Vector3(
          (vFrom.x + vTo.x) / 2,
          Math.max(vFrom.y, vTo.y) + 2.2,
          (vFrom.z + vTo.z) / 2
        );
        const curve = new THREE.QuadraticBezierCurve3(vFrom, vMid, vTo);
        const tubeGeo = new THREE.TubeGeometry(curve, 20, 0.07, 6, false);
        this.overlayGroup.add(
          new THREE.Mesh(tubeGeo, new THREE.MeshBasicMaterial({ color: 0xa855f7, transparent: true, opacity: 0.8 }))
        );
      }
    }

  }

  private syncSelectionGizmoAndCapsule(): void {
    const m = this.store.doc.metricsProfile;
    if (this.store.isPlaytesting && this.store.playtestPose) {
      const dimMode = this.store.getDimensionMode();
      const is2DSide = dimMode === '2d_side' || m.cameraMode === 'side_2d';
      const is2DTopDown = dimMode === '2d_topdown' || m.cameraMode === 'topdown';
      const showAvatar = this.playtestViewMode !== 'fps' || is2DSide || is2DTopDown;
      this.scaleCapsuleMesh.visible = showAvatar;
      this.scaleCapsuleMesh.position.set(
        this.store.playtestPose.position[0],
        this.store.playtestPose.position[1],
        this.store.playtestPose.position[2]
      );
      return;
    }

    this.scaleCapsuleMesh.visible = this.store.overlays.showScaleHuman;
    this.scaleCapsuleMesh.scale.set(
      m.playerRadius / 0.4,
      m.playerHeight / 1.8,
      m.playerRadius / 0.4
    );

    const sel = this.store.selection;
    if (sel) {
      this.transformControl.setMode(this.store.transformMode);
      this.transformControl.setTranslationSnap(this.store.doc.metadata.gridSize || 0.5);
      this.transformControl.setRotationSnap(
        THREE.MathUtils.degToRad(this.store.doc.metadata.snapRotation || 15)
      );

      if (sel.kind === 'block') {
        const targetObj = this.meshMap.get(sel.id);
        const blk = this.store.doc.blocks.find((x) => x.id === sel.id);
        if (targetObj && blk && !blk.locked) {
          this.transformControl.attach(targetObj);
          const topY = blk.position[1] + blk.size[1] / 2;
          this.scaleCapsuleMesh.position.set(
            blk.position[0] + blk.size[0] / 2 - 0.6,
            ROLE_META[blk.role]?.walkable ? topY : blk.position[1] - blk.size[1] / 2,
            blk.position[2]
          );
        }
      } else if (sel.kind === 'poi') {
        const targetPoi = this.poiMap.get(sel.id);
        const poi = this.store.doc.pois.find((x) => x.id === sel.id);
        if (targetPoi && poi) {
          this.transformControl.attach(targetPoi);
          this.scaleCapsuleMesh.position.set(poi.position[0], poi.position[1], poi.position[2]);
          this.scaleCapsuleMesh.rotation.set(0, (-poi.yaw * Math.PI) / 180, 0);
        }
      }
    } else {
      const sp = this.store.doc.pois.find((p) => p.category === 'spawn_player');
      if (sp) {
        this.scaleCapsuleMesh.position.set(sp.position[0], sp.position[1], sp.position[2]);
        this.scaleCapsuleMesh.rotation.set(0, (-sp.yaw * Math.PI) / 180, 0);
      } else {
        this.scaleCapsuleMesh.position.set(0, 0, 8);
      }
    }
  }

  private updateEnemyPatrolSimulation(dt: number): void {
    this.enemySimTime += dt;
    let moved = false;
    for (const poi of this.store.doc.pois) {
      const cfg = poi.enemyConfig;
      if (!cfg || !cfg.waypoints || cfg.waypoints.length === 0 || cfg.patrolMode === 'stationary') {
        continue;
      }
      const wps = cfg.waypoints;
      const speed = cfg.patrolSpeed || 2.8;
      // Compute A* loop/pingpong path across waypoints
      const fullRoute: Vec3[] = [];
      for (let i = 0; i < wps.length; i++) {
        const nextWp = wps[(i + 1) % wps.length];
        const seg = cfg.autoPathfind
          ? computeEnemyPathAStar(wps[i], nextWp, this.store.doc)
          : [wps[i], nextWp];
        fullRoute.push(...seg);
      }
      if (fullRoute.length < 2) continue;

      let totalLen = 0;
      const segLens: number[] = [];
      for (let i = 1; i < fullRoute.length; i++) {
        const d = Math.hypot(
          fullRoute[i][0] - fullRoute[i - 1][0],
          fullRoute[i][1] - fullRoute[i - 1][1],
          fullRoute[i][2] - fullRoute[i - 1][2]
        );
        segLens.push(d);
        totalLen += d;
      }
      if (totalLen < 0.2) continue;

      const distAlong = (this.enemySimTime * speed) % totalLen;
      let acc = 0;
      for (let i = 0; i < segLens.length; i++) {
        if (acc + segLens[i] >= distAlong) {
          const t = segLens[i] > 0.01 ? (distAlong - acc) / segLens[i] : 0;
          const p0 = fullRoute[i];
          const p1 = fullRoute[i + 1];
          poi.position = [
            Number((p0[0] + (p1[0] - p0[0]) * t).toFixed(2)),
            Number((p0[1] - 0.15 + (p1[1] - p0[1]) * t).toFixed(2)),
            Number((p0[2] + (p1[2] - p0[2]) * t).toFixed(2)),
          ];
          const dx = p1[0] - p0[0];
          const dz = p1[2] - p0[2];
          if (Math.hypot(dx, dz) > 0.05) {
            poi.yaw = Math.round(((Math.atan2(dx, -dz) * 180) / Math.PI + 360) % 360);
          }
          moved = true;
          break;
        }
        acc += segLens[i];
      }
    }
    if (moved) {
      this.store.notifyViewportsOnly(false);
    }
  }

  private animate = (): void => {
    requestAnimationFrame(this.animate);
    const now = performance.now();
    const dt = Math.min(0.05, (now - this.lastFrameTime) / 1000);
    this.lastFrameTime = now;

    if (this.store.isPlaytesting) {
      this.updatePlaytestPhysics(dt);
    } else if (this.isRMBFlying) {
      this.updateRMBFlythrough(dt);
    } else {
      this.orbit.update();
    }

    if (this.store.isSimulatingEnemies || this.store.isPlaytesting) {
      this.updateEnemyPatrolSimulation(dt);
    }

    // 一帧内无论收到多少次 store 通知，场景最多重建一次
    if (this.sceneDirty && !this.isDraggingTransform) {
      this.rebuildSceneFromStore(false);
    }
    this.updateBlockPopIns(now);

    const cw = this.container.clientWidth;
    const ch = this.container.clientHeight;
    this.renderer.setViewport(0, 0, cw, ch);
    this.renderer.setScissorTest(false);
    this.renderer.render(this.scene, this.camera);
    this.renderViewCube();

    // Live Picture-in-Picture (PiP) Player Camera Preview in bottom-right of 3D Viewport
    const spawnPoi = this.store.doc.pois.find((p) => p.category === 'spawn_player');
    if (this.showPlayerPiP && !this.store.isPlaytesting && spawnPoi && cw > 340 && ch > 240) {
      const m = this.store.doc.metricsProfile;
      const rig = computePlayerCameraRig(spawnPoi.position, spawnPoi.yaw, m, this.store.doc.blocks);
      const pipW = Math.min(248, Math.round(cw * 0.32));
      const pipH = Math.round((pipW * 9) / 16);
      const pad = 10;

      this.playerPipCamera.fov = rig.cameraFov;
      this.playerPipCamera.aspect = pipW / pipH;
      this.playerPipCamera.updateProjectionMatrix();
      this.playerPipCamera.position.set(rig.actualCamPos[0], rig.actualCamPos[1], rig.actualCamPos[2]);
      this.playerPipCamera.lookAt(rig.lookTarget[0], rig.lookTarget[1], rig.lookTarget[2]);

      const prevOverlayVis = this.overlayGroup.visible;
      this.overlayGroup.visible = false;
      this.renderer.setViewport(cw - pipW - pad, pad, pipW, pipH);
      this.renderer.setScissor(cw - pipW - pad, pad, pipW, pipH);
      this.renderer.setScissorTest(true);
      this.renderer.render(this.scene, this.playerPipCamera);
      this.renderer.setScissorTest(false);
      this.renderer.setViewport(0, 0, cw, ch);
      this.overlayGroup.visible = prevOverlayVis;

      // 徽标 DOM 只在内容或尺寸真的变化时才更新，避免每帧重写 innerHTML
      const badgeKey = `${pipW}|${pipH}|${rig.mode}|${rig.cameraFov}|${rig.effectiveDistance}|${rig.springArmClipped}`;
      if (badgeKey !== this.lastPipBadgeKey) {
        this.lastPipBadgeKey = badgeKey;
        this.pipBadgeEl.style.display = 'flex';
        this.pipBadgeEl.style.width = `${pipW}px`;
        this.pipBadgeEl.style.height = `${pipH}px`;
        this.pipBadgeEl.style.right = `${pad}px`;
        this.pipBadgeEl.style.bottom = `${pad}px`;
        this.pipBadgeEl.innerHTML = `
          <div class="pip-header">
            <span>🎥 玩家摄像机 (${rig.mode.toUpperCase()} · FOV ${rig.cameraFov}° · 臂长 ${rig.effectiveDistance}m)</span>
            ${rig.springArmClipped ? `<span style="color:#f87171;">⚠️防穿墙触发</span>` : ''}
          </div>
        `;
      }
    } else if (this.pipBadgeEl && this.lastPipBadgeKey !== 'hidden') {
      this.lastPipBadgeKey = 'hidden';
      this.pipBadgeEl.style.display = 'none';
    }
  };
}
