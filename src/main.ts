import './style.css';
import {
  auditLevel,
  computeEnemyPathAStar,
  computePlayerCameraRig,
  DESIGN_TAG_PRESETS,
  evaluateEnemyDetection,
  evaluateJumpLink,
  evaluatePlayerVisionTargets,
  POI_META,
  raycastLevel3D,
  resolveSightlineEndpoints,
  resolveTriggerLinks,
  ROLE_META,
} from './core/geometry-analysis';
import { getLang, LangCode, setLang, t } from './core/i18n';
import {
  createEmptyLevel,
  createStarterLevel,
  createTacticalCourtyardLevel,
  createVerticalRuinsLevel,
  METRICS_PRESETS,
} from './core/presets';
import {
  appendRoomTemplateToDoc,
  createSceneFromRoomTemplate,
  ROOM_CATEGORIES,
  ROOM_TEMPLATES,
  RoomCategoryId,
} from './core/room-templates';
import { LevelStore } from './core/store';
import {
  applyThemeToDOM,
  getTheme,
  QUICK_COLOR_SWATCHES,
  resetDefaultRoleColors,
  selectPresetTheme,
  THEME_PRESETS,
} from './core/theme';
import {
  ActiveTool,
  AICommandAction,
  BlockRole,
  BlockType,
  EnemyAIConfig,
  GameDimensionMode,
  PlayerCameraMode,
  POICategory,
  ViewportLayout,
} from './core/types';
import {
  exportBlueprintSVG,
  exportDesignDocMarkdown,
  exportLevelGLB,
  exportLevelJSON,
  exportLevelOBJ,
  exportUnityCS,
} from './exporters/exporters';
import { Viewport3D } from './viewports/Viewport3D';
import { ViewportSection2D } from './viewports/ViewportSection2D';
import { ViewportTop2D } from './viewports/ViewportTop2D';
import {
  animateCollapse,
  animateOut,
  installRippleEffect,
  runEveryFrameFor,
  staggerIn,
  withThemeTransition,
} from './ui/motion';
import { finiteInRange, loadPanelState, PANEL_DEFAULTS, savePanelState } from './ui/panelState';

const store = new LevelStore();
applyThemeToDOM();
const savedPanels = loadPanelState();
type SidebarTab = 'inspector' | 'metrics' | 'audit' | 'ai';
const SIDEBAR_TABS: SidebarTab[] = ['inspector', 'metrics', 'audit', 'ai'];
let activeSidebarTab: SidebarTab = SIDEBAR_TABS.includes(savedPanels.activeTab as SidebarTab)
  ? (savedPanels.activeTab as SidebarTab)
  : 'inspector';
let activeRoomCategoryFilter: RoomCategoryId | 'all' = 'all';
let isThemeStudioOpen = false;
let isNoteCardExpanded = false;
let isLeftDockCollapsed = savedPanels.leftCollapsed === true;
let isRightSidebarCollapsed = savedPanels.rightCollapsed === true;
const collapsedDockSections = new Set<string>(savedPanels.collapsedDockSections || []);
const collapsedCards = new Set<string>(savedPanels.collapsedCards || []);

/** 把当前面板折叠 / 页签状态写入本地存储，刷新后恢复 */
function persistPanelToggles(): void {
  savePanelState({
    leftCollapsed: isLeftDockCollapsed,
    rightCollapsed: isRightSidebarCollapsed,
    activeTab: activeSidebarTab,
    collapsedCards: Array.from(collapsedCards),
    collapsedDockSections: Array.from(collapsedDockSections),
  });
}

/** 把 "🎨 主题配色" 形式的文案拆成 图标 + 文字，窄屏时可只保留图标 */
function iconLabel(text: string): string {
  const i = text.indexOf(' ');
  if (i <= 0 || i > 4) return `<span class="lbl">${text}</span>`;
  return `<span class="ico">${text.slice(0, i)}</span><span class="lbl">${text.slice(i + 1)}</span>`;
}
let isScrubbingNumber = false;
let aiConsoleInput = JSON.stringify(
  {
    action: 'add_block',
    block: {
      name: 'AI_狙击掩体高台',
      type: 'box',
      role: 'walkable',
      position: [6, 1.5, -2],
      size: [5, 3, 4],
      floor: 1,
    },
  },
  null,
  2
);

const app = document.getElementById('app')!;
app.innerHTML = `
  <div class="workbench" id="workbench">
    <!-- Top Header -->
    <header class="topbar" id="topbar"></header>

    <!-- Main Body -->
    <div class="workspace-body" id="workspace-body">
      <!-- Left Pro Level Design Toolbar -->
      <aside class="left-dock" id="left-dock"></aside>
      <div class="dock-resizer-v" id="resizer-left-dock" title="拖拽调整左侧工具栏宽度 · 双击恢复默认"></div>

      <!-- Center Viewports -->
      <main class="viewport-stage">
        <div class="overlay-bar" id="overlay-bar"></div>
        <div class="viewports-grid layout-split_3d_2d" id="viewports-grid">
          <!-- 3D Viewport -->
          <div class="viewport-pane vp-3d">
            <div class="vp-header">
              <span id="vp3d-title"></span>
              <div style="display:flex;gap:6px;align-items:center;">
                <button class="chip-toggle on" id="btn-pip3d"></button>
                <button class="chip-toggle" id="btn-clip3d"></button>
                <button class="chip-toggle" id="btn-reset-3d"></button>
              </div>
            </div>
            <div class="vp-body" id="vp-3d-body"></div>
          </div>

          <!-- Resizer between 3D and 2D column -->
          <div class="vp-resizer-v" id="resizer-vp-x" title="拖拽调整 3D / 2D 视口比例 · 双击恢复默认"></div>

          <!-- 2D Top-Down Blueprint Viewport -->
          <div class="viewport-pane vp-top">
            <div class="vp-header">
              <span id="vptop-title"></span>
              <button class="chip-toggle" id="btn-reset-top"></button>
            </div>
            <div class="vp-body" id="vp-top-body"></div>
          </div>

          <!-- Resizer between Top-Down 2D and Cross-Section 2D -->
          <div class="vp-resizer-h" id="resizer-vp-y" title="拖拽调整 俯视 / 断面 视口比例 · 双击恢复默认"></div>

          <!-- 2D Cross-Section Viewport -->
          <div class="viewport-pane vp-sec">
            <div class="vp-header">
              <span id="vpsec-title"></span>
              <div style="display:flex;gap:6px;align-items:center;">
                <button class="chip-toggle" id="btn-flip-sec"></button>
                <button class="chip-toggle" id="btn-reset-sec"></button>
              </div>
            </div>
            <div class="vp-body" id="vp-sec-body"></div>
          </div>
        </div>

        <!-- Floating Object Identity & Design Rationale HUD Card (Click-to-Inspect) -->
        <div class="floating-note-card" id="floating-note-card"></div>
      </main>

      <div class="dock-resizer-v" id="resizer-right-sidebar" title="拖拽调整右侧属性栏宽度 · 双击恢复默认"></div>
      <!-- Right Inspector & Analytics Sidebar -->
      <aside class="right-sidebar" id="right-sidebar">
        <div class="sidebar-tabs" id="sidebar-tabs"></div>
        <div class="sidebar-toolbar" id="sidebar-toolbar">
          <span class="sidebar-toolbar-hint" title="点击卡片标题可折叠 / 展开">📋 点击卡片标题可折叠</span>
          <div style="display:flex;gap:4px;">
            <button class="chip-toggle" id="btn-expand-all-cards" style="padding:1px 5px;font-size:9px;">▾ 全部展开</button>
            <button class="chip-toggle" id="btn-collapse-all-cards" style="padding:1px 5px;font-size:9px;">▸ 全部折叠</button>
          </div>
        </div>
        <div class="sidebar-content" id="sidebar-content"></div>
      </aside>
    </div>

    <!-- Bottom Status Bar -->
    <footer class="statusbar">
      <div id="status-left">Ready</div>
      <div id="status-right"></div>
    </footer>
    <input id="file-import-input" type="file" accept=".json" style="display:none" />

    <!-- Floating Theme & Custom Color Studio Modal -->
    <div class="theme-studio-backdrop" id="theme-studio-backdrop">
      <div class="theme-studio-panel" id="theme-studio-panel"></div>
    </div>
  </div>
`;

const vp3D = new Viewport3D(document.getElementById('vp-3d-body')!, store);
const vpTop = new ViewportTop2D(document.getElementById('vp-top-body')!, store);
const vpSec = new ViewportSection2D(document.getElementById('vp-sec-body')!, store);

store.onFrameSelected(() => {
  vp3D.frameSelected();
  vpTop.frameSelected();
  vpSec.frameSelected();
});

function setupResizablePanes(): void {
  const root = document.documentElement;
  const grid = document.getElementById('viewports-grid')!;

  const resizeViewports = () => {
    vp3D.resize();
    vpTop.resize();
    vpSec.resize();
  };

  // 恢复上次保存的面板尺寸与折叠状态
  const layout = {
    leftDockW: finiteInRange(savedPanels.leftDockW, 175, 400) ?? PANEL_DEFAULTS.leftDockW,
    rightSidebarW: finiteInRange(savedPanels.rightSidebarW, 260, 560) ?? PANEL_DEFAULTS.rightSidebarW,
    vpSplitX: finiteInRange(savedPanels.vpSplitX, 22, 78) ?? PANEL_DEFAULTS.vpSplitX,
    vpSplitY: finiteInRange(savedPanels.vpSplitY, 22, 78) ?? PANEL_DEFAULTS.vpSplitY,
  };
  type LayoutKey = keyof typeof layout;
  const applyLayout = () => {
    root.style.setProperty('--left-dock-w', `${layout.leftDockW}px`);
    root.style.setProperty('--right-sidebar-w', `${layout.rightSidebarW}px`);
    root.style.setProperty('--vp-split-x', `${layout.vpSplitX}%`);
    root.style.setProperty('--vp-split-y', `${layout.vpSplitY}%`);
  };
  applyLayout();
  document.getElementById('left-dock')!.classList.toggle('collapsed', isLeftDockCollapsed);
  document.getElementById('resizer-left-dock')!.style.display = isLeftDockCollapsed ? 'none' : '';
  document.getElementById('right-sidebar')!.classList.toggle('collapsed', isRightSidebarCollapsed);
  document.getElementById('resizer-right-sidebar')!.style.display = isRightSidebarCollapsed ? 'none' : '';
  resizeViewports();

  const bindDrag = (handleId: string, key: LayoutKey, compute: (e: MouseEvent) => number) => {
    const handle = document.getElementById(handleId)!;
    handle.addEventListener('mousedown', (e) => {
      e.preventDefault();
      handle.classList.add('dragging');
      document.body.classList.add('is-resizing');
      const moveHandler = (ev: MouseEvent) => {
        layout[key] = Number(compute(ev).toFixed(1));
        applyLayout();
        resizeViewports();
      };
      const upHandler = () => {
        handle.classList.remove('dragging');
        document.body.classList.remove('is-resizing');
        window.removeEventListener('mousemove', moveHandler);
        window.removeEventListener('mouseup', upHandler);
        resizeViewports();
        savePanelState({ ...layout });
      };
      window.addEventListener('mousemove', moveHandler);
      window.addEventListener('mouseup', upHandler);
    });
    // 双击分隔条恢复默认尺寸
    handle.addEventListener('dblclick', () => {
      layout[key] = PANEL_DEFAULTS[key];
      applyLayout();
      savePanelState({ ...layout });
      runEveryFrameFor(340, resizeViewports);
    });
  };

  bindDrag('resizer-left-dock', 'leftDockW', (e) => Math.max(175, Math.min(400, e.clientX)));
  bindDrag('resizer-right-sidebar', 'rightSidebarW', (e) =>
    Math.max(260, Math.min(560, window.innerWidth - e.clientX))
  );
  bindDrag('resizer-vp-x', 'vpSplitX', (e) => {
    const rect = grid.getBoundingClientRect();
    return Math.max(22, Math.min(78, ((e.clientX - rect.left) / rect.width) * 100));
  });
  bindDrag('resizer-vp-y', 'vpSplitY', (e) => {
    const rect = grid.getBoundingClientRect();
    return Math.max(22, Math.min(78, ((e.clientY - rect.top) / rect.height) * 100));
  });
}

setupResizablePanes();
installRippleEffect();

/**
 * Enhances all <input type="number"> inside a container with:
 * 1. Left/Right drag-to-scrub (both on the ↔ handle, on the input itself when not typing, and on its row label)
 * 2. Custom sleek theme-aware ▴ / ▾ stepper buttons (replacing ugly browser spin boxes)
 */
function enhanceNumberInputs(root: HTMLElement): void {
  const numInputs = Array.from(root.querySelectorAll<HTMLInputElement>('input[type="number"]'));
  for (const inp of numInputs) {
    if (inp.parentElement?.classList.contains('num-scrub-wrap')) continue;

    const wrap = document.createElement('div');
    wrap.className = 'num-scrub-wrap';
    inp.parentNode?.insertBefore(wrap, inp);

    const handle = document.createElement('span');
    handle.className = 'num-scrub-handle';
    handle.title = '按住左右拖拽可连续调节数值 (按住 Shift 微调 / Alt 快调)';
    handle.textContent = '↔';
    const vecGroup = inp.closest('.vec3-inputs');
    if (vecGroup) {
      const axisIdx = Array.from(vecGroup.querySelectorAll('input[type="number"]')).indexOf(inp);
      const axis = ['x', 'y', 'z'][axisIdx];
      if (axis) {
        handle.textContent = axis.toUpperCase();
        handle.classList.add('axis', `axis-${axis}`);
      }
    }
    wrap.appendChild(handle);

    wrap.appendChild(inp);

    const stepBox = document.createElement('div');
    stepBox.className = 'num-step-btns';
    stepBox.innerHTML = `
      <button type="button" class="num-step-btn" data-dir="1" tabindex="-1" title="增加">▴</button>
      <button type="button" class="num-step-btn" data-dir="-1" tabindex="-1" title="减少">▾</button>
    `;
    wrap.appendChild(stepBox);

    const getStep = () => {
      const s = parseFloat(inp.step);
      return !isNaN(s) && s > 0 ? s : 1;
    };

    const clampAndFormat = (val: number, stepVal: number): string => {
      const min = inp.min !== '' ? parseFloat(inp.min) : -Infinity;
      const max = inp.max !== '' ? parseFloat(inp.max) : Infinity;
      const clamped = Math.max(min, Math.min(max, val));
      const decimals = (stepVal.toString().split('.')[1] || '').length;
      return Number(clamped.toFixed(Math.max(2, decimals))).toString();
    };

    const applyDelta = (dirOrMult: number, fineMode = false, fastMode = false) => {
      const baseStep = getStep();
      const mult = fineMode ? 0.1 : fastMode ? 5 : 1;
      const cur = parseFloat(inp.value) || 0;
      const next = cur + dirOrMult * baseStep * mult;
      inp.value = clampAndFormat(next, baseStep * mult);
      inp.dispatchEvent(new Event('input', { bubbles: true }));
      inp.dispatchEvent(new Event('change', { bubbles: true }));
    };

    stepBox.querySelectorAll<HTMLButtonElement>('.num-step-btn').forEach((btn) => {
      btn.addEventListener('mousedown', (e) => {
        e.preventDefault();
        e.stopPropagation();
        const dir = Number(btn.dataset.dir) || 1;
        store.pushUndoSnapshot();
        applyDelta(dir, e.shiftKey, e.altKey || e.ctrlKey);
      });
    });

    const startScrub = (e: MouseEvent, allowClickFocus: boolean) => {
      if (e.button !== 0) return;
      if (allowClickFocus && document.activeElement === inp) return;

      const startX = e.clientX;
      const startVal = parseFloat(inp.value) || 0;
      const baseStep = getStep();
      let moved = false;

      const onMove = (ev: MouseEvent) => {
        const dx = ev.clientX - startX;
        if (!moved && Math.abs(dx) > 3) {
          moved = true;
          isScrubbingNumber = true;
          store.pushUndoSnapshot();
          wrap.classList.add('scrubbing');
          document.body.style.cursor = 'ew-resize';
          inp.blur();
        }
        if (moved) {
          ev.preventDefault();
          const mult = ev.shiftKey ? 0.1 : ev.altKey || ev.ctrlKey ? 5 : 1;
          const steps = Math.round(dx / 4);
          const next = startVal + steps * baseStep * mult;
          const formatted = clampAndFormat(next, baseStep * mult);
          if (inp.value !== formatted) {
            inp.value = formatted;
            inp.dispatchEvent(new Event('input', { bubbles: true }));
            inp.dispatchEvent(new Event('change', { bubbles: true }));
          }
        }
      };

      const onUp = () => {
        window.removeEventListener('mousemove', onMove);
        window.removeEventListener('mouseup', onUp);
        if (moved) {
          wrap.classList.remove('scrubbing');
          document.body.style.cursor = '';
          isScrubbingNumber = false;
          renderLeftDock();
          renderSidebar();
        } else if (allowClickFocus) {
          inp.focus();
          inp.select();
        }
      };

      if (!allowClickFocus) {
        e.preventDefault();
      }
      window.addEventListener('mousemove', onMove);
      window.addEventListener('mouseup', onUp);
    };

    handle.addEventListener('mousedown', (e) => startScrub(e, false));
    inp.addEventListener('mousedown', (e) => startScrub(e, true));

    // Also allow dragging the row's <label> if not yet bound
    const row = inp.closest('.form-row');
    const lbl = row?.querySelector('label');
    if (lbl && !lbl.classList.contains('scrub-label')) {
      lbl.classList.add('scrub-label');
      lbl.title = '按住左右拖拽可调节数值';
      lbl.addEventListener('mousedown', (e) => startScrub(e as MouseEvent, false));
    }
  }
}

/**
 * Paints the filled part of every themed <input type="range"> track (CSS reads --fill)
 */
function enhanceRangeInputs(root: HTMLElement): void {
  root.querySelectorAll<HTMLInputElement>('input[type="range"]').forEach((rng) => {
    const paint = () => {
      const min = parseFloat(rng.min) || 0;
      const max = rng.max !== '' ? parseFloat(rng.max) : 100;
      const pct = max > min ? ((parseFloat(rng.value) - min) / (max - min)) * 100 : 0;
      rng.style.setProperty('--fill', `${Math.max(0, Math.min(100, pct)).toFixed(1)}%`);
    };
    paint();
    if (rng.dataset.fillBound) return;
    rng.dataset.fillBound = '1';
    rng.addEventListener('input', paint);
    rng.addEventListener('change', paint);
  });
}

/**
 * Makes every .panel-card inside a sidebar container collapsible by clicking its .card-title
 */
function enhanceCollapsibleCards(container: HTMLElement): void {
  const cards = Array.from(container.querySelectorAll<HTMLElement>('.panel-card'));
  cards.forEach((card, idx) => {
    const titleEl = card.querySelector<HTMLElement>('.card-title');
    if (!titleEl) return;

    const rawText = (titleEl.querySelector('span')?.textContent || titleEl.textContent || `card_${idx}`)
      .replace(/\(\d+.*?\)/g, '')
      .trim();
    const cardKey = `${activeSidebarTab}:${rawText}`;
    card.dataset.cardKey = cardKey;

    // Wrap all siblings after .card-title into .card-body if not already wrapped
    if (!card.querySelector('.card-body')) {
      const body = document.createElement('div');
      body.className = 'card-body';
      const children = Array.from(card.children);
      for (const ch of children) {
        if (ch !== titleEl) {
          body.appendChild(ch);
        }
      }
      card.appendChild(body);
    }

    // Add chevron indicator to title
    if (!titleEl.querySelector('.collapse-chevron')) {
      const firstSpan = titleEl.querySelector('span');
      const chev = document.createElement('span');
      chev.className = 'collapse-chevron';
      chev.textContent = '▾';
      chev.style.marginRight = '5px';
      if (firstSpan) {
        firstSpan.prepend(chev);
      } else {
        titleEl.prepend(chev);
      }
    }

    if (collapsedCards.has(cardKey)) {
      card.classList.add('collapsed');
    }

    titleEl.onclick = (e) => {
      const target = e.target as HTMLElement;
      if (target.closest('button') || target.closest('select') || target.closest('input')) {
        return;
      }
      if (collapsedCards.has(cardKey)) {
        collapsedCards.delete(cardKey);
        animateCollapse(card, ':scope > .card-body', false);
      } else {
        collapsedCards.add(cardKey);
        animateCollapse(card, ':scope > .card-body', true);
      }
      persistPanelToggles();
    };
  });
}

/**
 * 重绘会整体替换容器里的 DOM。若焦点正落在容器内带 id 的控件上（例如在输入框里按回车提交），
 * 重绘后把焦点和光标位置还给同 id 的新控件，避免焦点掉到 <body> 上——那样下一次退格 / Delete
 * 会被当成"删除选中体块"的全局快捷键。
 */
function withFocusPreserved(container: HTMLElement, render: () => void): void {
  const active = document.activeElement as HTMLElement | null;
  const id = active && active.id && container.contains(active) ? active.id : '';
  let selStart: number | null = null;
  let selEnd: number | null = null;
  if (id && (active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement)) {
    try {
      selStart = active.selectionStart;
      selEnd = active.selectionEnd;
    } catch {
      // number 等类型不支持选区
    }
  }
  render();
  if (!id) return;
  const next = document.getElementById(id);
  if (!next || next === active || !container.contains(next)) return;
  next.focus({ preventScroll: true });
  if (selStart !== null && selEnd !== null && (next instanceof HTMLInputElement || next instanceof HTMLTextAreaElement)) {
    try {
      next.setSelectionRange(selStart, selEnd);
    } catch {
      // ignore
    }
  }
}

function renderTopBar(): void {
  withFocusPreserved(document.getElementById('topbar')!, renderTopBarNow);
}

function renderTopBarNow(): void {
  const topbar = document.getElementById('topbar')!;
  const lang = getLang();
  const dim = store.getDimensionMode();

  topbar.innerHTML = `
    <div class="brand-group">
      <button id="btn-toggle-left-dock" class="btn btn-icon" title="折叠/展开左侧工具栏">
        ${isLeftDockCollapsed ? '▶ 工具' : '◀'}
      </button>
      <div class="brand-logo">
        <span class="brand-badge">LB</span>
        <span>Level Builder</span>
      </div>
      <input id="level-name-input" class="level-title-input" type="text" value="${store.doc.metadata.name}" title="关卡名称" />
      <span class="topbar-sep"></span>

      <!-- 3D / 2D 横版 / 2D 俯视 游戏关卡模式切换器 -->
      <div class="dim-mode-bar" title="切换 3D立体关卡 / 2D横版卷轴(平台跳跃/银河城) / 2D俯视角(塞尔达/肉鸽)">
        <button class="dim-mode-btn ${dim === '3d' ? 'active' : ''}" data-dim="3d" title="${t('dim3D')}">${iconLabel(t('dim3D'))}</button>
        <button class="dim-mode-btn ${dim === '2d_side' ? 'active' : ''}" data-dim="2d_side" title="${t('dim2DSide')}">${iconLabel(t('dim2DSide'))}</button>
        <button class="dim-mode-btn ${dim === '2d_topdown' ? 'active' : ''}" data-dim="2d_topdown" title="${t('dim2DTop')}">${iconLabel(t('dim2DTop'))}</button>
      </div>
      
      <!-- Dedicated New Scene Menu -->
      <span class="topbar-sep"></span>
      <select id="new-scene-select" class="select-pill select-accent" title="${t('newSceneBtn')}">
        <option value="">${t('newSceneBtn')}...</option>
        <option value="starter">📐 ${t('newSceneEmpty')}</option>
        <option value="zero">📄 ${t('newSceneZero')}</option>
      </select>

      <select id="template-select" class="select-pill" title="${t('templatePlaceholder')}">
        <option value="">${t('templatePlaceholder')}</option>
        <optgroup label="⭐ 完整综合示范关卡">
          <option value="courtyard">${t('tplCourtyard')}</option>
          <option value="ruins">${t('tplRuins')}</option>
          <option value="starter">${t('tplStarter')}</option>
        </optgroup>
        ${ROOM_CATEGORIES.map(
          (cat) => `
          <optgroup label="${cat.icon} ${cat.nameZh}">
            ${ROOM_TEMPLATES.filter((r) => r.categoryId === cat.id)
              .map((r) => `<option value="room:${r.id}">${r.icon} ${r.nameZh}</option>`)
              .join('')}
          </optgroup>
        `
        ).join('')}
      </select>
    </div>

    <div class="topbar-center">
      <select id="layout-select" class="select-pill" title="视口布局">
        <option value="split_3d_2d" ${store.layout === 'split_3d_2d' ? 'selected' : ''}>${t('layoutSplit')}</option>
        <option value="only_3d" ${store.layout === 'only_3d' ? 'selected' : ''}>${t('layout3D')}</option>
        <option value="only_top" ${store.layout === 'only_top' ? 'selected' : ''}>${t('layoutTop')}</option>
        <option value="only_section" ${store.layout === 'only_section' ? 'selected' : ''}>${t('layoutSec')}</option>
      </select>
      <button id="btn-undo" class="btn" title="${t('undo')} (Ctrl+Z)">${iconLabel(t('undo'))}</button>
      <button id="btn-redo" class="btn" title="${t('redo')} (Ctrl+Y)">${iconLabel(t('redo'))}</button>
      <span class="topbar-sep"></span>
      <button id="btn-sim-patrol" class="btn btn-sim-patrol ${store.isSimulatingEnemies ? 'active' : ''}" title="${store.isSimulatingEnemies ? t('simPatrolStop') : t('simPatrolStart')}">
        ${iconLabel(store.isSimulatingEnemies ? t('simPatrolStop') : t('simPatrolStart'))}
      </button>
      <button id="btn-playtest" class="btn btn-playtest ${store.isPlaytesting ? 'playing' : ''}" title="${store.isPlaytesting ? t('playtestStop') : t('playtestStart')}">
        ${iconLabel(store.isPlaytesting ? t('playtestStop') : t('playtestStart'))}
      </button>
    </div>

    <div class="topbar-right">
      <button id="btn-open-theme-studio" class="btn ${isThemeStudioOpen ? 'active' : ''}" title="主题配色：切换界面颜色模板与自定义色板">
        ${iconLabel('🎨 主题配色')}
      </button>

      <select id="export-select" class="select-pill" title="${t('exportMenu')}">
        <option value="">${t('exportMenu')}</option>
        <option value="import_json">${t('importJSON')}</option>
        <option value="md">${t('exportMD')}</option>
        <option value="svg">${t('exportSVG')}</option>
        <option value="glb">${t('exportGLB')}</option>
        <option value="obj">${t('exportOBJ')}</option>
        <option value="unity_cs">${t('exportUnity')}</option>
        <option value="json">${t('exportJSON')}</option>
      </select>

      <!-- Multi-Language Switcher -->
      <select id="lang-select" class="select-pill" title="Language / 语言 / 言語">
        <option value="zh" ${lang === 'zh' ? 'selected' : ''}>🌐 中文</option>
        <option value="en" ${lang === 'en' ? 'selected' : ''}>🌐 EN</option>
        <option value="ja" ${lang === 'ja' ? 'selected' : ''}>🌐 日本語</option>
      </select>

      <div id="bridge-status" class="bridge-pill ${store.bridgeConnected || store.isOnlineStaticHost() ? '' : 'offline'}" title="${store.bridgeConnected ? t('bridgeOnline') : store.isOnlineStaticHost() ? '在线版' : t('bridgeOffline')}">
        <span class="dot"></span>
        <span id="bridge-text">${store.bridgeConnected ? t('bridgeOnline') : store.isOnlineStaticHost() ? '🌐 在线版' : t('bridgeOffline')}</span>
      </div>

      <button id="btn-toggle-right-sidebar" class="btn btn-icon" title="折叠/展开右侧属性分析栏">
        ${isRightSidebarCollapsed ? '◀ 属性' : '▶'}
      </button>
    </div>
  `;

  document.getElementById('btn-toggle-left-dock')!.onclick = () => {
    isLeftDockCollapsed = !isLeftDockCollapsed;
    persistPanelToggles();
    document.getElementById('left-dock')!.classList.toggle('collapsed', isLeftDockCollapsed);
    document.getElementById('resizer-left-dock')!.style.display = isLeftDockCollapsed ? 'none' : '';
    renderTopBar();
    runEveryFrameFor(340, () => {
      vp3D.resize();
      vpTop.resize();
      vpSec.resize();
    });
  };

  document.getElementById('btn-toggle-right-sidebar')!.onclick = () => {
    isRightSidebarCollapsed = !isRightSidebarCollapsed;
    persistPanelToggles();
    document.getElementById('right-sidebar')!.classList.toggle('collapsed', isRightSidebarCollapsed);
    document.getElementById('resizer-right-sidebar')!.style.display = isRightSidebarCollapsed ? 'none' : '';
    renderTopBar();
    runEveryFrameFor(340, () => {
      vp3D.resize();
      vpTop.resize();
      vpSec.resize();
    });
  };

  topbar.querySelectorAll<HTMLButtonElement>('[data-dim]').forEach((btn) => {
    btn.onclick = () => {
      const nextDim = btn.dataset.dim as GameDimensionMode;
      store.setDimensionMode(nextDim);
      setTimeout(() => {
        vp3D.resize();
        vpTop.resize();
        vpSec.resize();
      }, 30);
    };
  });

  document.getElementById('level-name-input')!.onchange = (e) => {
    store.doc.metadata.name = (e.target as HTMLInputElement).value;
    store.notify(true);
  };

  document.getElementById('new-scene-select')!.onchange = (e) => {
    const sel = e.target as HTMLSelectElement;
    const val = sel.value;
    sel.value = '';
    if (val === 'starter') {
      store.setDocument(createStarterLevel(), true, true);
    } else if (val === 'zero') {
      store.setDocument(createEmptyLevel(), true, true);
    }
  };

  document.getElementById('template-select')!.onchange = (e) => {
    const sel = e.target as HTMLSelectElement;
    const val = sel.value;
    sel.value = '';
    if (val === 'courtyard') store.setDocument(createTacticalCourtyardLevel(), true, true);
    else if (val === 'ruins') store.setDocument(createVerticalRuinsLevel(), true, true);
    else if (val === 'starter') store.setDocument(createStarterLevel(), true, true);
    else if (val.startsWith('room:')) {
      const roomId = val.replace('room:', '');
      const doc = createSceneFromRoomTemplate(roomId);
      store.setDocument(doc, true, true);
      if (doc.metadata.dimensionMode) {
        store.setDimensionMode(doc.metadata.dimensionMode);
      }
    }
  };

  document.getElementById('layout-select')!.onchange = (e) => {
    store.layout = (e.target as HTMLSelectElement).value as ViewportLayout;
    store.notify(false);
    setTimeout(() => {
      vp3D.resize();
      vpTop.resize();
      vpSec.resize();
    }, 30);
  };

  document.getElementById('btn-undo')!.onclick = () => store.undo();
  document.getElementById('btn-redo')!.onclick = () => store.redo();

  document.getElementById('btn-sim-patrol')!.onclick = () => {
    store.isSimulatingEnemies = !store.isSimulatingEnemies;
    store.notify(false);
  };

  document.getElementById('btn-playtest')!.onclick = () => {
    if (store.isPlaytesting) vp3D.stopPlaytest();
    else vp3D.startPlaytest();
  };

  const fileInput = document.getElementById('file-import-input') as HTMLInputElement;
  document.getElementById('export-select')!.onchange = (e) => {
    const sel = e.target as HTMLSelectElement;
    const val = sel.value;
    sel.value = '';
    if (val === 'import_json') fileInput.click();
    if (val === 'md') exportDesignDocMarkdown(store.doc);
    if (val === 'glb') exportLevelGLB(vp3D.scene, store.doc);
    if (val === 'obj') exportLevelOBJ(store.doc);
    if (val === 'unity_cs') exportUnityCS(store.doc);
    if (val === 'svg') exportBlueprintSVG(store.doc);
    if (val === 'json') exportLevelJSON(store.doc);
  };

  document.getElementById('lang-select')!.onchange = (e) => {
    setLang((e.target as HTMLSelectElement).value as LangCode);
    renderAllUI();
  };

  document.getElementById('btn-open-theme-studio')!.onclick = () => {
    if (isThemeStudioOpen) {
      closeThemeStudio();
      return;
    }
    isThemeStudioOpen = true;
    renderThemeStudio();
    renderTopBar();
    const backdropEl = document.getElementById('theme-studio-backdrop')!;
    backdropEl.classList.add('intro');
    window.setTimeout(() => backdropEl.classList.remove('intro'), 520);
  };

  // Update viewport headers
  document.getElementById('vp3d-title')!.textContent = t('vp3DHeader');
  document.getElementById('btn-pip3d')!.textContent = t('vp3DPiP');
  document.getElementById('btn-pip3d')!.classList.toggle('on', vp3D.showPlayerPiP);
  document.getElementById('btn-clip3d')!.textContent = t('vp3DClip');
  document.getElementById('btn-clip3d')!.classList.toggle('on', Boolean(store.doc.sectionPlane.clip3D));
  document.getElementById('btn-reset-3d')!.textContent = t('vpResetCam');
  document.getElementById('vptop-title')!.textContent = t('vpTopHeader');
  document.getElementById('btn-reset-top')!.textContent = t('vpResetCam');
  document.getElementById('vpsec-title')!.textContent = t('vpSecHeader');
  document.getElementById('btn-flip-sec')!.textContent = t('vpSecFlip');
  document.getElementById('btn-reset-sec')!.textContent = t('vpResetCam');
  document.getElementById('status-right')!.textContent = t('statusShortcuts');
  document.getElementById('status-right')!.title = t('statusShortcuts');
  fitTopBar();
}

const TOPBAR_MAX_COMPACT = 4;
let topBarFitKey = '';
let topBarFitTier = 0;

/**
 * 顶栏自适应：内容放不下时逐级收紧（隐藏文字只留图标 → 下拉框缩成图标），
 * 直到单行放得下为止。按实际内容宽度判断，因此对中/英/日文案长度都成立。
 */
function fitTopBar(force = false): void {
  const topbar = document.getElementById('topbar')!;
  const applyTier = (tier: number) => {
    for (let i = 1; i <= TOPBAR_MAX_COMPACT; i++) topbar.classList.toggle(`c${i}`, i <= tier);
  };
  // 文案与宽度都没变时直接复用上次结果，避免每次重绘都强制回流
  const key = `${topbar.clientWidth}|${topbar.textContent}`;
  if (!force && key === topBarFitKey) {
    applyTier(topBarFitTier);
    return;
  }
  let tier = 0;
  for (; tier <= TOPBAR_MAX_COMPACT; tier++) {
    applyTier(tier);
    if (topbar.scrollWidth <= topbar.clientWidth + 1) break;
  }
  topBarFitKey = key;
  topBarFitTier = Math.min(tier, TOPBAR_MAX_COMPACT);
}

new ResizeObserver(() => fitTopBar()).observe(document.getElementById('topbar')!);
document.fonts?.ready.then(() => fitTopBar(true));

function renderSidebarTabs(): void {
  const tabsEl = document.getElementById('sidebar-tabs')!;
  tabsEl.innerHTML = `
    <button class="tab-btn ${activeSidebarTab === 'inspector' ? 'active' : ''}" data-tab="inspector">${t('tabInspector')}</button>
    <button class="tab-btn ${activeSidebarTab === 'metrics' ? 'active' : ''}" data-tab="metrics">${t('tabMetrics')}</button>
    <button class="tab-btn ${activeSidebarTab === 'audit' ? 'active' : ''}" data-tab="audit">${t('tabAudit')}</button>
    <button class="tab-btn ${activeSidebarTab === 'ai' ? 'active' : ''}" data-tab="ai">${t('tabAI')}</button>
  `;
  tabsEl.querySelectorAll<HTMLButtonElement>('.tab-btn').forEach((btn) => {
    btn.onclick = () => {
      if (activeSidebarTab === btn.dataset.tab) return;
      activeSidebarTab = btn.dataset.tab as typeof activeSidebarTab;
      persistPanelToggles();
      renderSidebarTabs();
      renderSidebar();
      const content = document.getElementById('sidebar-content');
      if (content) staggerIn(content);
    };
  });
}

function renderLeftDock(): void {
  withFocusPreserved(document.getElementById('left-dock')!, renderLeftDockNow);
}

function renderLeftDockNow(): void {
  const dock = document.getElementById('left-dock')!;
  const tool = store.activeTool;
  const tf = store.transformMode;
  const cd = store.creationDefaults;

  dock.innerHTML = `
    <div class="dock-section ${collapsedDockSections.has('sec1') ? 'collapsed' : ''}" data-dock-sec="sec1">
      <div class="dock-section-header">
        <span>${t('sec1Title')}</span>
        <span class="collapse-chevron">▾</span>
      </div>
      <div class="dock-section-body">
        <div class="tool-grid">
          <button class="tool-btn full ${tool === 'select' ? 'active' : ''}" data-tool="select">
            ${t('toolSelect')}
          </button>
          <button class="tool-btn ${tf === 'translate' ? 'active' : ''}" data-tf="translate">
            ${t('tfTranslate')}
          </button>
          <button class="tool-btn ${tf === 'rotate' ? 'active' : ''}" data-tf="rotate">
            ${t('tfRotate')}
          </button>
          <button class="tool-btn ${tf === 'scale' ? 'active' : ''}" data-tf="scale">
            ${t('tfScale')}
          </button>
          <button class="tool-btn" id="btn-dock-frame" style="border-color:rgba(250,204,21,0.5);">
            ${t('btnFrameSel')}
          </button>
        </div>
      </div>
    </div>

    <div class="dock-section ${collapsedDockSections.has('sec2') ? 'collapsed' : ''}" data-dock-sec="sec2">
      <div class="dock-section-header">
        <span>${t('sec2Title')}</span>
        <span class="collapse-chevron">▾</span>
      </div>
      <div class="dock-section-body">
        <div class="tool-grid">
          <button class="tool-btn ${tool === 'draw_box' ? 'active' : ''}" data-tool="draw_box">
            ${t('toolBox')}
          </button>
          <button class="tool-btn ${tool === 'draw_ramp' ? 'active' : ''}" data-tool="draw_ramp">
            ${t('toolRamp')}
          </button>
          <button class="tool-btn ${tool === 'draw_stairs' ? 'active' : ''}" data-tool="draw_stairs">
            ${t('toolStairs')}
          </button>
          <button class="tool-btn ${tool === 'draw_arch' ? 'active' : ''}" data-tool="draw_arch">
            ${t('toolArch')}
          </button>
          <button class="tool-btn full ${tool === 'draw_cylinder' ? 'active' : ''}" data-tool="draw_cylinder">
            ${t('toolCylinder')}
          </button>
        </div>

        <button class="btn btn-primary" id="btn-quick-spawn-3d" style="width:100%;justify-content:center;margin-top:2px;">
          ${t('quickSpawn3D')}
        </button>

        <div class="form-row" style="margin-top:2px;">
          <label>${t('floorPreset')}</label>
          <select id="dock-floor-preset">
            <option value="-1" ${cd.floor === -1 ? 'selected' : ''}>B1 (-3.0m)</option>
            <option value="0" ${cd.floor === 0 ? 'selected' : ''}>1F (±0.0m)</option>
            <option value="1" ${cd.floor === 1 ? 'selected' : ''}>2F (+3.0m)</option>
            <option value="2" ${cd.floor === 2 ? 'selected' : ''}>3F (+6.0m)</option>
          </select>
        </div>
        <div class="form-row">
          <label>${t('baseAndHeight')}</label>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:4px;">
            <input id="dock-base-y" type="number" step="0.5" value="${cd.baseY}" title="Base Y (m)" />
            <input id="dock-height" type="number" step="0.25" min="0.2" value="${cd.height}" title="Height (m)" />
          </div>
        </div>
      </div>
    </div>

    <div class="dock-section ${collapsedDockSections.has('sec_role') ? 'collapsed' : ''}" data-dock-sec="sec_role">
      <div class="dock-section-header">
        <span>${t('roleTitle')}</span>
        <span class="collapse-chevron">▾</span>
      </div>
      <div class="dock-section-body">
        <div class="role-chip-list">
          ${(Object.keys(ROLE_META) as BlockRole[])
            .map((roleKey) => {
              const m = ROLE_META[roleKey];
              return `
                <button class="role-chip ${cd.role === roleKey ? 'active' : ''}" data-role="${roleKey}">
                  <span class="color-swatch" style="background:${m.color}"></span>
                  <span>${m.label.split(' ')[0]}</span>
                </button>
              `;
            })
            .join('')}
        </div>

        <!-- Custom Block Creation Color Override -->
        <div class="dock-title" style="margin-top:4px;display:flex;justify-content:space-between;align-items:center;">
          <span>🎨 白盒自定义颜色</span>
          ${
            cd.customColor
              ? `<button class="chip-toggle" id="dock-clear-color" style="padding:1px 5px;font-size:9px;">恢复语义色</button>`
              : `<span style="font-size:9px;color:var(--text-muted);">跟随语义</span>`
          }
        </div>
        <div class="swatch-row">
          <input type="color" id="dock-custom-color" class="color-picker-input" value="${cd.customColor || ROLE_META[cd.role].color}" title="点击自由取色" />
          ${QUICK_COLOR_SWATCHES.map(
            (hex) =>
              `<span class="swatch-dot ${cd.customColor === hex ? 'active' : ''}" data-dock-swatch="${hex}" style="background:${hex}" title="${hex}"></span>`
          ).join('')}
        </div>
      </div>
    </div>

    <div class="dock-section ${collapsedDockSections.has('sec3') ? 'collapsed' : ''}" data-dock-sec="sec3">
      <div class="dock-section-header">
        <span>${t('sec3Title')}</span>
        <span class="collapse-chevron">▾</span>
      </div>
      <div class="dock-section-body">
        <div class="tool-grid">
          <button class="tool-btn full ${tool === 'edit_section' ? 'active' : ''}" data-tool="edit_section">
            ${t('toolSection')}
          </button>
          <button class="tool-btn full ${tool === 'measure_jump' ? 'active' : ''}" data-tool="measure_jump">
            ${t('toolJump')}
          </button>
          <button class="tool-btn full ${tool === 'measure_ruler' ? 'active' : ''}" data-tool="measure_ruler">
            ${t('toolRuler')}
          </button>
          <button class="tool-btn full ${tool === 'add_enemy_waypoint' ? 'active' : ''}" data-tool="add_enemy_waypoint">
            ${t('toolEnemyWP')}
          </button>
          <button class="tool-btn ${tool === 'place_poi' ? 'active' : ''}" data-tool="place_poi">
            ${t('toolPOI')}
          </button>
          <button class="tool-btn ${tool === 'draw_path' ? 'active' : ''}" data-tool="draw_path">
            ${t('toolPath')}
          </button>
        </div>

        ${
          tool === 'place_poi'
            ? `
          <div class="form-row" style="margin-top:4px;">
            <label>POI</label>
            <select id="dock-poi-cat">
              ${(Object.keys(POI_META) as POICategory[])
                .map(
                  (k) =>
                    `<option value="${k}" ${vpTop.activePOICategory === k ? 'selected' : ''}>${POI_META[k].icon} ${POI_META[k].label}</option>`
                )
                .join('')}
            </select>
          </div>`
            : ''
        }

        ${
          tool === 'draw_path'
            ? `
          <div class="form-row" style="margin-top:4px;">
            <label>Path</label>
            <select id="dock-path-type">
              <option value="main" ${vpTop.activePathType === 'main' ? 'selected' : ''}>Golden Path</option>
              <option value="flank" ${vpTop.activePathType === 'flank' ? 'selected' : ''}>Flank Route</option>
              <option value="secret" ${vpTop.activePathType === 'secret' ? 'selected' : ''}>Secret</option>
              <option value="patrol" ${vpTop.activePathType === 'patrol' ? 'selected' : ''}>Patrol</option>
            </select>
          </div>`
            : ''
        }
      </div>
    </div>
  `;

  dock.querySelectorAll<HTMLElement>('.dock-section').forEach((secEl) => {
    const secKey = secEl.dataset.dockSec!;
    const hdr = secEl.querySelector<HTMLElement>('.dock-section-header');
    if (hdr) {
      hdr.onclick = () => {
        if (collapsedDockSections.has(secKey)) {
          collapsedDockSections.delete(secKey);
          animateCollapse(secEl, ':scope > .dock-section-body', false);
        } else {
          collapsedDockSections.add(secKey);
          animateCollapse(secEl, ':scope > .dock-section-body', true);
        }
        persistPanelToggles();
      };
    }
  });

  dock.querySelectorAll<HTMLButtonElement>('[data-tool]').forEach((btn) => {
    btn.onclick = () => {
      const nextTool = btn.dataset.tool as ActiveTool;
      if (nextTool === 'add_enemy_waypoint' && !store.getSelectedPOI()) {
        const firstEnemy = store.doc.pois.find(
          (p) => p.category === 'spawn_enemy' || p.category === 'sniper_nest' || p.category === 'boss'
        );
        if (firstEnemy) store.selection = { kind: 'poi', id: firstEnemy.id };
      }
      store.activeTool = nextTool;
      store.notify(false);
    };
  });

  dock.querySelectorAll<HTMLButtonElement>('[data-tf]').forEach((btn) => {
    btn.onclick = () => {
      store.transformMode = btn.dataset.tf as 'translate' | 'rotate' | 'scale';
      store.activeTool = 'select';
      store.notify(false);
    };
  });

  document.getElementById('btn-dock-frame')!.onclick = () => {
    store.requestFrameSelected();
  };

  document.getElementById('btn-quick-spawn-3d')!.onclick = () => {
    const mapType: Record<string, BlockType> = {
      draw_box: 'box',
      draw_ramp: 'ramp',
      draw_stairs: 'stairs',
      draw_arch: 'arch',
      draw_cylinder: 'cylinder',
    };
    const bType = mapType[store.activeTool] || 'box';
    const { role, floor, baseY, height } = store.creationDefaults;
    const h =
      role === 'walkable'
        ? 0.5
        : role === 'cover_low'
        ? store.doc.metricsProfile.lowCoverHeight
        : role === 'cover_full'
        ? store.doc.metricsProfile.fullCoverHeight
        : height;
    const cy = role === 'walkable' ? Number((baseY - h / 2).toFixed(2)) : Number((baseY + h / 2).toFixed(2));
    const offset = (store.doc.blocks.length % 5) * 0.5;
    store.dispatchAICommand({
      action: 'add_block',
      block: {
        name: `${ROLE_META[role].label.split(' ')[0]}_${store.doc.blocks.length + 1}`,
        type: bType,
        role,
        position: [offset, cy, offset],
        size: [4, h, 4],
        rotation: [0, 0, 0],
        floor,
        color: store.creationDefaults.customColor,
      },
    });
    store.activeTool = 'select';
    store.notify(true);
  };

  dock.querySelectorAll<HTMLButtonElement>('[data-role]').forEach((btn) => {
    btn.onclick = () => {
      const r = btn.dataset.role as BlockRole;
      store.creationDefaults.role = r;
      if (r === 'cover_low') store.creationDefaults.height = store.doc.metricsProfile.lowCoverHeight;
      if (r === 'cover_full') store.creationDefaults.height = store.doc.metricsProfile.fullCoverHeight;
      if (r === 'walkable') store.creationDefaults.height = 0.5;
      if (r === 'wall') store.creationDefaults.height = 3.0;
      const selBlk = store.getSelectedBlock();
      if (selBlk && store.activeTool === 'select') {
        store.pushUndoSnapshot();
        store.updateBlockLive(selBlk.id, { role: r }, true);
      } else {
        store.notify(false);
      }
    };
  });

  const floorPreset = document.getElementById('dock-floor-preset') as HTMLSelectElement | null;
  if (floorPreset) {
    floorPreset.onchange = () => {
      const f = Number(floorPreset.value);
      store.creationDefaults.floor = f;
      store.creationDefaults.baseY = f * 3.0;
      store.notify(false);
    };
  }

  const baseYIn = document.getElementById('dock-base-y') as HTMLInputElement | null;
  if (baseYIn) {
    baseYIn.onchange = () => {
      store.creationDefaults.baseY = Number(baseYIn.value) || 0;
    };
  }

    const heightIn = document.getElementById('dock-height') as HTMLInputElement | null;
  if (heightIn) {
    heightIn.onchange = () => {
      store.creationDefaults.height = Math.max(0.2, Number(heightIn.value) || 3);
    };
  }

  const dockColorIn = document.getElementById('dock-custom-color') as HTMLInputElement | null;
  if (dockColorIn) {
    dockColorIn.oninput = () => {
      store.creationDefaults.customColor = dockColorIn.value;
      const selBlk = store.getSelectedBlock();
      if (selBlk && store.activeTool === 'select') {
        store.updateBlockLive(selBlk.id, { color: dockColorIn.value }, true);
      } else {
        renderLeftDock();
      }
    };
  }

  const dockClearBtn = document.getElementById('dock-clear-color');
  if (dockClearBtn) {
    dockClearBtn.onclick = () => {
      store.creationDefaults.customColor = undefined;
      const selBlk = store.getSelectedBlock();
      if (selBlk && store.activeTool === 'select') {
        store.updateBlockLive(selBlk.id, { color: undefined }, true);
      }
      renderLeftDock();
    };
  }

  dock.querySelectorAll<HTMLElement>('[data-dock-swatch]').forEach((sw) => {
    sw.onclick = () => {
      const hex = sw.dataset.dockSwatch!;
      store.creationDefaults.customColor = hex;
      const selBlk = store.getSelectedBlock();
      if (selBlk && store.activeTool === 'select') {
        store.pushUndoSnapshot();
        store.updateBlockLive(selBlk.id, { color: hex }, true);
      } else {
        renderLeftDock();
      }
    };
  });

  const poiCatSel = document.getElementById('dock-poi-cat') as HTMLSelectElement | null;
  if (poiCatSel) {
    poiCatSel.onchange = () => {
      vpTop.activePOICategory = poiCatSel.value as POICategory;
    };
  }

  const pathTypeSel = document.getElementById('dock-path-type') as HTMLSelectElement | null;
  if (pathTypeSel) {
    pathTypeSel.onchange = () => {
      vpTop.activePathType = pathTypeSel.value as 'main' | 'flank' | 'secret' | 'patrol';
    };
  }

  // 窄栏下按钮文字可能被截断，补上完整文案的悬停提示
  dock.querySelectorAll<HTMLElement>('.tool-btn, .role-chip').forEach((btn) => {
    if (!btn.title) btn.title = (btn.textContent || '').trim();
  });

  enhanceNumberInputs(dock);
}

function renderOverlayBar(): void {
  const bar = document.getElementById('overlay-bar')!;
  const ov = store.overlays;

  bar.innerHTML = `
    <div class="overlay-group">
      <span style="color:var(--text-muted);font-weight:600;font-size:10px;">${t('ovLabel')}</span>
      <button class="chip-toggle ${ov.showGrid ? 'on' : ''}" data-ov="showGrid">${t('ovGrid')}</button>
      <button class="chip-toggle ${ov.showVisionCones ? 'on' : ''}" data-ov="showVisionCones">${t('ovVision')}</button>
      <button class="chip-toggle ${ov.showFlowPaths ? 'on' : ''}" data-ov="showFlowPaths">${t('ovFlow')}</button>
      <button class="chip-toggle ${ov.showJumpArcs ? 'on' : ''}" data-ov="showJumpArcs">${t('ovJump')}</button>
      <button class="chip-toggle ${ov.showDesignNotes ? 'on' : ''}" data-ov="showDesignNotes">${t('ovNotes')}</button>
      <button class="chip-toggle ${ov.showScaleHuman ? 'on' : ''}" data-ov="showScaleHuman">${t('ovHuman')}</button>
      <button class="chip-toggle ${ov.elevationHeatmap ? 'on' : ''}" data-ov="elevationHeatmap">${t('ovHeat')}</button>
    </div>

    <div class="overlay-group">
      <span style="color:var(--text-muted);font-size:10px;">${t('snapLabel')}</span>
      <select id="snap-grid-select" class="select-pill" style="padding:2px 6px;font-size:10px;">
        <option value="0.25" ${store.doc.metadata.gridSize === 0.25 ? 'selected' : ''}>0.25m</option>
        <option value="0.5" ${store.doc.metadata.gridSize === 0.5 ? 'selected' : ''}>0.5m</option>
        <option value="1" ${store.doc.metadata.gridSize === 1 ? 'selected' : ''}>1.0m</option>
        <option value="2" ${store.doc.metadata.gridSize === 2 ? 'selected' : ''}>2.0m</option>
      </select>

      <span style="color:var(--text-muted);font-size:10px;margin-left:6px;">${t('floorFilterLabel')}</span>
      <select id="floor-filter-select" class="select-pill" style="padding:2px 6px;font-size:10px;">
        <option value="all" ${ov.floorFilter === 'all' ? 'selected' : ''}>${t('floorAll')}</option>
        <option value="-1" ${ov.floorFilter === -1 ? 'selected' : ''}>B1 (-1)</option>
        <option value="0" ${ov.floorFilter === 0 ? 'selected' : ''}>1F (0)</option>
        <option value="1" ${ov.floorFilter === 1 ? 'selected' : ''}>2F (+1)</option>
        <option value="2" ${ov.floorFilter === 2 ? 'selected' : ''}>3F (+2)</option>
      </select>
    </div>
  `;

  bar.querySelectorAll<HTMLButtonElement>('[data-ov]').forEach((btn) => {
    btn.onclick = () => {
      const k = btn.dataset.ov as keyof typeof ov;
      (ov[k] as boolean) = !ov[k];
      store.notify(false);
    };
  });

  const snapSel = document.getElementById('snap-grid-select') as HTMLSelectElement;
  snapSel.onchange = () => {
    store.doc.metadata.gridSize = Number(snapSel.value);
    store.notify(true);
  };

  const floorSel = document.getElementById('floor-filter-select') as HTMLSelectElement;
  floorSel.onchange = () => {
    ov.floorFilter = floorSel.value === 'all' ? 'all' : Number(floorSel.value);
    store.notify(false);
  };
}

function renderFloatingNoteCard(): void {
  const card = document.getElementById('floating-note-card')!;
  const blk = store.getSelectedBlock();
  const poi = store.getSelectedPOI();

  if (store.isPlaytesting || (!blk && !poi) || !store.showFloatingNoteCard) {
    if (card.classList.contains('visible') && !card.classList.contains('leaving')) {
      card.classList.add('leaving');
      window.setTimeout(() => {
        if (card.classList.contains('leaving')) {
          card.classList.remove('visible', 'leaving');
        }
      }, 170);
    }
    return;
  }

  card.classList.remove('leaving');
  card.classList.add('visible');

  // 备注卡的输入框是边输入边写回 store 的；如果每次按键都重绘卡片，输入框会被替换、
  // 焦点丢失（中文输入法的候选也会被打断）。同一对象、展开状态下正在输入时保持现有 DOM。
  const cardStateKey = `${blk ? 'block' : 'poi'}:${(blk || poi)!.id}:${isNoteCardExpanded ? 1 : 0}`;
  const focusedEl = document.activeElement;
  if (
    isNoteCardExpanded &&
    card.dataset.stateKey === cardStateKey &&
    focusedEl instanceof HTMLElement &&
    card.contains(focusedEl) &&
    (focusedEl.tagName === 'INPUT' || focusedEl.tagName === 'TEXTAREA')
  ) {
    return;
  }
  card.dataset.stateKey = cardStateKey;

  const allTargets = [
    ...store.doc.blocks.map((b) => ({ id: b.id, label: `[白盒] ${b.name}` })),
    ...store.doc.pois.map((p) => ({ id: p.id, label: `[POI] ${p.name}` })),
  ];

  const obj = blk || poi!;
  const isBlk = Boolean(blk);
  const badgeColor = blk
    ? blk.color || (ROLE_META[blk.role] || ROLE_META.walkable).color
    : (POI_META[poi!.category] || POI_META.objective).color;
  const badgeText = blk
    ? (ROLE_META[blk.role] || ROLE_META.walkable).label.split(' ')[0]
    : `${(POI_META[poi!.category] || POI_META.objective).icon} ${(POI_META[poi!.category] || POI_META.objective).label.split(' ')[0]}`;
  const subMeta = blk ? `(${blk.size.join('×')}m · ${blk.floor}F)` : `(${poi!.position.map((v) => v.toFixed(1)).join(', ')})`;
  const linkedTarget = obj.linkedId ? allTargets.find((tItem) => tItem.id === obj.linkedId) : null;

  card.innerHTML = `
    <div class="fnc-header">
      <div class="fnc-title">
        <span class="fnc-role-badge" style="background:${badgeColor};">${badgeText}</span>
        <span>${isBlk ? '🧱' : '📍'} ${obj.name}</span>
        <span style="font-size:10px;color:#94a3b8;font-family:'JetBrains Mono',monospace;">${subMeta}</span>
        ${
          obj.designTag
            ? `<span style="font-size:10px;padding:1px 6px;border-radius:99px;background:rgba(56,189,248,0.2);border:1px solid var(--accent);color:#e0f2fe;">🏷️ ${obj.designTag}</span>`
            : ''
        }
      </div>
      <div style="display:flex;gap:4px;align-items:center;flex-shrink:0;">
        <button class="chip-toggle" id="fnc-focus-btn" title="镜头居中聚焦 (F)">🎯 聚焦</button>
        <button class="chip-toggle ${isNoteCardExpanded ? 'on' : ''}" id="fnc-toggle-edit-btn">
          ${isNoteCardExpanded ? '▲ 收起' : '✏️ 编辑备注'}
        </button>
        <button class="chip-toggle" id="fnc-close-btn" title="取消选中">✕</button>
      </div>
    </div>

    ${
      !isNoteCardExpanded
        ? `
      <div class="fnc-summary-line">
        ${
          obj.notes
            ? `<div><b>💡 设计思路：</b>${obj.notes}</div>`
            : `<div style="color:var(--text-muted);">💡 尚未填写设计思路 — 点击右上角「<b>✏️ 编辑备注</b>」可快速打标或记录设计意图</div>`
        }
        ${
          obj.mechanicsTip || linkedTarget
            ? `<div style="margin-top:2px;font-size:10px;color:#93c5fd;display:flex;gap:10px;flex-wrap:wrap;">
                ${obj.mechanicsTip ? `<span>⚙️ <b>机制：</b>${obj.mechanicsTip}</span>` : ''}
                ${linkedTarget ? `<span style="color:#d8b4fe;">🔑 <b>联动：</b>➔ ${linkedTarget.label}</span>` : ''}
              </div>`
            : ''
        }
      </div>
    `
        : `
      <div style="font-size:10px;color:#38bdf8;font-weight:600;margin-top:2px;">🏷️ 一键标记设计定位:</div>
      <div class="design-tag-chips">
        ${DESIGN_TAG_PRESETS.map(
          (p) => `
          <button class="design-tag-chip ${obj.designTag === p.tag ? 'active' : ''}" data-fnc-tag="${p.tag}" data-fnc-note="${p.defaultNote}">
            ${p.icon} ${p.tag}
          </button>
        `
        ).join('')}
      </div>

      <div class="form-row" style="grid-template-columns: 68px 1fr;">
        <label>🏷️ 定位标签</label>
        <input type="text" id="fnc-tag-in" placeholder="例如: 视觉引导地标 / 交叉火力掩体..." value="${obj.designTag || ''}" />
      </div>
      <div class="form-row" style="grid-template-columns: 68px 1fr;align-items:flex-start;">
        <label style="padding-top:4px;">💡 设计思路</label>
        <textarea id="fnc-note-in" rows="2" placeholder="这是什么？为什么放在这里？承担什么视线/动线/节奏作用？" style="min-height:42px;">${obj.notes || ''}</textarea>
      </div>
      <div class="form-row" style="grid-template-columns: 68px 1fr;">
        <label>⚙️ 玩法提示</label>
        <input type="text" id="fnc-tip-in" placeholder="例如: 可翻越 / 炸药桶 / 单向跳台..." value="${obj.mechanicsTip || ''}" />
      </div>
      <div class="form-row" style="grid-template-columns: 68px 1fr;">
        <label>🔑 机关联动</label>
        <select id="fnc-link-in">
          <option value="">-- 无关联机关/锁门 --</option>
          ${allTargets
            .filter((tItem) => tItem.id !== obj.id)
            .map((tItem) => `<option value="${tItem.id}" ${obj.linkedId === tItem.id ? 'selected' : ''}>➔ ${tItem.label}</option>`)
            .join('')}
        </select>
      </div>
    `
    }
  `;

  document.getElementById('fnc-focus-btn')!.onclick = () => {
    store.requestFrameSelected();
  };

  document.getElementById('fnc-toggle-edit-btn')!.onclick = () => {
    isNoteCardExpanded = !isNoteCardExpanded;
    renderFloatingNoteCard();
  };

  document.getElementById('fnc-close-btn')!.onclick = () => {
    store.setSelection(null);
  };

  if (isNoteCardExpanded) {
    const updateObj = (patch: Record<string, unknown>) => {
      if (blk) store.updateBlockLive(blk.id, patch, true);
      else if (poi) store.updatePOILive(poi.id, patch, true);
    };

    card.querySelectorAll<HTMLButtonElement>('[data-fnc-tag]').forEach((btn) => {
      btn.onclick = () => {
        store.pushUndoSnapshot();
        const tag = btn.dataset.fncTag!;
        const defNote = btn.dataset.fncNote!;
        updateObj({
          designTag: tag,
          // 读取最新的备注（卡片在输入期间不重绘，闭包里的 obj 可能是旧快照）
          notes: (() => {
            const cur = blk ? store.getSelectedBlock() : store.getSelectedPOI();
            const curNotes = cur?.notes ?? obj.notes;
            return curNotes && curNotes.trim().length > 0 ? curNotes : defNote;
          })(),
        });
        renderFloatingNoteCard();
        renderSidebar();
      };
    });

    const tagIn = document.getElementById('fnc-tag-in') as HTMLInputElement;
    const noteIn = document.getElementById('fnc-note-in') as HTMLTextAreaElement;
    const tipIn = document.getElementById('fnc-tip-in') as HTMLInputElement;
    const linkIn = document.getElementById('fnc-link-in') as HTMLSelectElement;

    tagIn.oninput = () => updateObj({ designTag: tagIn.value });
    noteIn.oninput = () => updateObj({ notes: noteIn.value });
    tipIn.oninput = () => updateObj({ mechanicsTip: tipIn.value });
    linkIn.onchange = () => {
      store.pushUndoSnapshot();
      updateObj({ linkedId: linkIn.value || undefined });
      renderFloatingNoteCard();
      renderSidebar();
    };
  }
}

function renderSidebar(): void {
  withFocusPreserved(document.getElementById('sidebar-content')!, renderSidebarNow);
}

function renderSidebarNow(): void {
  const container = document.getElementById('sidebar-content')!;
  if (activeSidebarTab === 'inspector') {
    renderInspectorTab(container);
  } else if (activeSidebarTab === 'metrics') {
    renderMetricsTab(container);
  } else if (activeSidebarTab === 'audit') {
    renderAuditTab(container);
  } else {
    renderAITab(container);
  }
  enhanceCollapsibleCards(container);
  enhanceNumberInputs(container);
  enhanceRangeInputs(container);

  const btnExpandAll = document.getElementById('btn-expand-all-cards');
  const btnCollapseAll = document.getElementById('btn-collapse-all-cards');
  if (btnExpandAll) {
    btnExpandAll.onclick = () => {
      container.querySelectorAll<HTMLElement>('.panel-card').forEach((c) => {
        if (c.dataset.cardKey) collapsedCards.delete(c.dataset.cardKey);
        if (c.classList.contains('collapsed')) animateCollapse(c, ':scope > .card-body', false);
      });
      persistPanelToggles();
    };
  }
  if (btnCollapseAll) {
    btnCollapseAll.onclick = () => {
      container.querySelectorAll<HTMLElement>('.panel-card').forEach((c) => {
        if (c.dataset.cardKey) collapsedCards.add(c.dataset.cardKey);
        if (!c.classList.contains('collapsed')) animateCollapse(c, ':scope > .card-body', true);
      });
      persistPanelToggles();
    };
  }
}

function renderInspectorTab(container: HTMLElement): void {
  const blk = store.getSelectedBlock();
  const poi = store.getSelectedPOI();
  const sec = store.doc.sectionPlane;

  let selectionCardHTML = `
    <div class="panel-card">
      <div class="card-title"><span>${t('noSelectionTitle')}</span></div>
      <div style="color:var(--text-muted);line-height:1.5;">
        ${t('noSelectionHint')}
      </div>
    </div>
  `;

  if (blk) {
    const slopeDeg =
      blk.type === 'ramp' || blk.type === 'stairs'
        ? ((Math.atan2(blk.size[1], blk.size[2]) * 180) / Math.PI).toFixed(1)
        : null;
    selectionCardHTML = `
      <div class="panel-card">
        <div class="card-title">
          <span>${t('blockProps')} (${blk.id})</span>
          <div style="display:flex;gap:4px;">
            <button class="btn" id="ins-frame-blk" title="Frame (F)">🎯 F</button>
            <button class="btn" id="ins-dup-blk">${t('dupBtn')}</button>
            <button class="btn" id="ins-del-blk" style="color:#fca5a5;">${t('delBtn')}</button>
          </div>
        </div>
        <div class="form-row">
          <label>${t('lblName')}</label>
          <input type="text" id="ins-blk-name" value="${blk.name}" />
        </div>
        <div class="form-row">
          <label>${t('lblType')}</label>
          <select id="ins-blk-type">
            <option value="box" ${blk.type === 'box' ? 'selected' : ''}>Box</option>
            <option value="ramp" ${blk.type === 'ramp' ? 'selected' : ''}>Ramp</option>
            <option value="stairs" ${blk.type === 'stairs' ? 'selected' : ''}>Stairs</option>
            <option value="arch" ${blk.type === 'arch' ? 'selected' : ''}>Arch</option>
            <option value="cylinder" ${blk.type === 'cylinder' ? 'selected' : ''}>Cylinder</option>
          </select>
        </div>
        <div class="form-row">
          <label>${t('lblRole')}</label>
          <select id="ins-blk-role">
            ${(Object.keys(ROLE_META) as BlockRole[])
              .map(
                (r) =>
                  `<option value="${r}" ${blk.role === r ? 'selected' : ''}>${ROLE_META[r].label}</option>`
              )
              .join('')}
          </select>
        </div>
        <div class="form-row">
          <label>${t('lblFloor')}</label>
          <input type="number" id="ins-blk-floor" step="1" value="${blk.floor}" />
        </div>
        <div class="form-row">
          <label>${t('lblPos')}</label>
          <div class="vec3-inputs">
            <input type="number" step="0.25" id="ins-pos-x" value="${blk.position[0]}" title="X" />
            <input type="number" step="0.25" id="ins-pos-y" value="${blk.position[1]}" title="Y" />
            <input type="number" step="0.25" id="ins-pos-z" value="${blk.position[2]}" title="Z" />
          </div>
        </div>
        <div class="form-row">
          <label>${t('lblSize')}</label>
          <div class="vec3-inputs">
            <input type="number" step="0.25" min="0.2" id="ins-size-x" value="${blk.size[0]}" title="W" />
            <input type="number" step="0.25" min="0.2" id="ins-size-y" value="${blk.size[1]}" title="H" />
            <input type="number" step="0.25" min="0.2" id="ins-size-z" value="${blk.size[2]}" title="D" />
          </div>
        </div>
        <div class="form-row">
          <label>${t('lblRot')}</label>
          <div class="vec3-inputs">
            <input type="number" step="5" id="ins-rot-x" value="${blk.rotation[0]}" />
            <input type="number" step="15" id="ins-rot-y" value="${blk.rotation[1]}" />
            <input type="number" step="5" id="ins-rot-z" value="${blk.rotation[2]}" />
          </div>
        </div>
        ${
          slopeDeg
            ? `<div style="font-size:11px;color:${
                Number(slopeDeg) > store.doc.metricsProfile.maxSlopeAngle ? '#ef4444' : '#38bdf8'
              };">📐 Slope: <b>${slopeDeg}°</b> (Max ${store.doc.metricsProfile.maxSlopeAngle}°)</div>`
            : ''
        }
        <div class="form-row">
          <label>🎨 专属颜色</label>
          <div style="display:flex;flex-direction:column;gap:5px;">
            <div style="display:flex;align-items:center;gap:6px;">
              <input type="color" id="ins-blk-color" class="color-picker-input" value="${blk.color || ROLE_META[blk.role].color}" />
              <span style="font-family:'JetBrains Mono',monospace;font-size:10px;color:var(--text-muted);">${blk.color || '默认语义色'}</span>
              ${
                blk.color
                  ? `<button class="chip-toggle" id="ins-blk-color-reset" style="margin-left:auto;">恢复默认</button>`
                  : ''
              }
            </div>
            <div class="swatch-row">
              ${QUICK_COLOR_SWATCHES.map(
                (hex) =>
                  `<span class="swatch-dot ${blk.color === hex ? 'active' : ''}" data-ins-swatch="${hex}" style="background:${hex}" title="${hex}"></span>`
              ).join('')}
            </div>
          </div>
        </div>
        <div class="form-row">
          <label>${t('lblNotes')}</label>
          <input type="text" id="ins-blk-notes" value="${blk.notes || ''}" />
        </div>
      </div>
    `;
  } else if (poi) {
    const isPlayerSpawn = poi.category === 'spawn_player';
    const mp = store.doc.metricsProfile;
    const ec: EnemyAIConfig = poi.enemyConfig || {
      patrolMode: 'loop',
      waypoints: [],
      autoPathfind: true,
      patrolSpeed: 2.6,
      chaseSpeed: 5.5,
      hearingRange: 7.0,
      targetId: 'poi_spawn_player',
    };

    const targetPOI =
      store.doc.pois.find((p) => p.id === ec.targetId) ||
      store.doc.pois.find((p) => p.category === 'spawn_player');
    const det = !isPlayerSpawn && targetPOI ? evaluateEnemyDetection(poi, targetPOI.position, store.doc) : null;

    let patrolTotalDist = 0;
    if (!isPlayerSpawn && ec.waypoints.length >= 2) {
      for (let i = 0; i < ec.waypoints.length - 1; i++) {
        const seg = ec.autoPathfind
          ? computeEnemyPathAStar(ec.waypoints[i], ec.waypoints[i + 1], store.doc)
          : [ec.waypoints[i], ec.waypoints[i + 1]];
        for (let k = 0; k < seg.length - 1; k++) {
          patrolTotalDist += Math.hypot(seg[k + 1][0] - seg[k][0], seg[k + 1][2] - seg[k][2]);
        }
      }
    }

    const playerRig = isPlayerSpawn ? computePlayerCameraRig(poi.position, poi.yaw, mp, store.doc.blocks) : null;
    const playerTargets = isPlayerSpawn ? evaluatePlayerVisionTargets(poi, store.doc) : [];

    selectionCardHTML = `
      <div class="panel-card">
        <div class="card-title">
          <span>📍 POI (${poi.id})</span>
          <div style="display:flex;gap:4px;">
            <button class="btn" id="ins-frame-poi" title="Frame (F)">🎯 F</button>
            <button class="btn" id="ins-del-poi" style="color:#fca5a5;">${t('delBtn')}</button>
          </div>
        </div>
        <div class="form-row">
          <label>${t('lblName')}</label>
          <input type="text" id="ins-poi-name" value="${poi.name}" />
        </div>
        <div class="form-row">
          <label>${t('lblType')}</label>
          <select id="ins-poi-cat">
            ${(Object.keys(POI_META) as POICategory[])
              .map(
                (k) =>
                  `<option value="${k}" ${poi.category === k ? 'selected' : ''}>${POI_META[k].icon} ${POI_META[k].label}</option>`
              )
              .join('')}
          </select>
        </div>
        <div class="form-row">
          <label>${t('lblPos')}</label>
          <div class="vec3-inputs">
            <input type="number" step="0.5" id="ins-poi-x" value="${poi.position[0]}" />
            <input type="number" step="0.25" id="ins-poi-y" value="${poi.position[1]}" />
            <input type="number" step="0.5" id="ins-poi-z" value="${poi.position[2]}" />
          </div>
        </div>
        <div class="form-row">
          <label>Yaw (°)</label>
          <input type="number" step="5" id="ins-poi-yaw" value="${poi.yaw}" />
        </div>
        <div class="form-row">
          <label>LOS Vision</label>
          <input type="checkbox" id="ins-poi-vision" ${poi.showVision ? 'checked' : ''} style="width:16px;height:16px;" />
        </div>
        <div class="form-row">
          <label>FOV / Range</label>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:4px;">
            <input type="number" step="5" id="ins-poi-fov" value="${poi.fov}" />
            <input type="number" step="1" id="ins-poi-range" value="${poi.visionRange}" />
          </div>
        </div>
      </div>

      ${
        isPlayerSpawn && playerRig
          ? `
        <!-- Player Camera Settings & Player Vision Settings Panel -->
        <div class="panel-card" style="border-color:rgba(56,189,248,0.5);">
          <div class="card-title">
            <span style="color:#38bdf8;">${t('playerCamVisionTitle')}</span>
          </div>
          <div class="form-row">
            <label>${t('camModeLbl')}</label>
            <select id="ins-pcam-mode">
              <option value="fps" ${(mp.cameraMode ?? 'tps') === 'fps' ? 'selected' : ''}>FPS (第一人称主视角)</option>
              <option value="tps" ${(mp.cameraMode ?? 'tps') === 'tps' ? 'selected' : ''}>TPS (第三人称越肩弹簧臂)</option>
              <option value="topdown" ${(mp.cameraMode ?? 'tps') === 'topdown' ? 'selected' : ''}>Top-Down (2D/3D俯视镜头)</option>
              <option value="side_2d" ${(mp.cameraMode ?? 'tps') === 'side_2d' ? 'selected' : ''}>2D Side-Scroller (2D横版卷轴跟拍)</option>
            </select>
          </div>
          <div class="form-row">
            <label>${t('camFovLbl')}</label>
            <input type="number" step="2" min="35" max="120" id="ins-pcam-fov" value="${mp.cameraFov ?? 68}" />
          </div>
          <div class="form-row">
            <label>${t('camDistLbl')}</label>
            <input type="number" step="0.2" min="0" max="20" id="ins-pcam-dist" value="${mp.cameraDistance ?? 3.2}" />
          </div>
          <div class="form-row">
            <label>${t('camOffsetYLbl')}</label>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:4px;">
              <input type="number" step="0.05" id="ins-pcam-offy" value="${mp.cameraOffsetY ?? mp.eyeHeight}" title="Pivot Y (m)" />
              <input type="number" step="0.05" id="ins-pcam-shoulder" value="${mp.cameraShoulderOffset ?? 0.45}" title="Shoulder Offset X (m)" />
            </div>
          </div>
          <div class="form-row">
            <label>${t('camPitchLbl')}</label>
            <input type="number" step="2" min="-80" max="45" id="ins-pcam-pitch" value="${mp.cameraPitch ?? -10}" />
          </div>
          <div class="form-row">
            <label>${t('camCollLbl')}</label>
            <div style="display:flex;align-items:center;gap:10px;">
              <input type="checkbox" id="ins-pcam-coll" ${(mp.cameraCollision ?? true) ? 'checked' : ''} style="width:16px;height:16px;" />
              <span style="font-size:10px;color:var(--text-muted);">${t('showCamFrustumLbl')}</span>
              <input type="checkbox" id="ins-pcam-frustum" ${(mp.showPlayerCameraFrustum ?? true) ? 'checked' : ''} style="width:16px;height:16px;" />
            </div>
          </div>
          <div class="form-row">
            <label>${t('showPlayerVisLbl')}</label>
            <input type="checkbox" id="ins-pvis-show" ${(mp.showPlayerVision ?? true) ? 'checked' : ''} style="width:16px;height:16px;" />
          </div>
          <div class="form-row">
            <label>${t('playerVisFovLbl')}</label>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:4px;">
              <input type="number" step="5" min="30" max="170" id="ins-pvis-fov" value="${mp.playerVisionFov ?? 95}" title="Player Vision FOV (°)" />
              <input type="number" step="1" min="5" max="80" id="ins-pvis-range" value="${mp.playerVisionRange ?? 26}" title="Player Vision Range (m)" />
            </div>
          </div>
          <div class="form-row">
            <label>${t('playerPeriphLbl')}</label>
            <input type="number" step="0.5" min="0" max="25" id="ins-pvis-periph" value="${mp.playerPeripheralRange ?? 5.0}" />
          </div>

          <div style="font-size:10px;color:#cbd5e1;background:var(--bg-1);padding:6px;border-radius:4px;line-height:1.45;">
            <div>🎥 <b>相机实际机位</b>: (${playerRig.actualCamPos.join(', ')}) · 实际臂长 <b>${playerRig.effectiveDistance}m</b> / 设定 ${playerRig.idealDistance}m</div>
            ${
              playerRig.springArmClipped
                ? `<div style="color:#f59e0b;">⚠️ 弹簧臂被身后「<b>${playerRig.clippedByBlockName}</b>」遮挡，已自动前移防穿墙！</div>`
                : `<div style="color:#86efac;">✓ 弹簧臂无穿墙遮挡 (Clear SpringArm)</div>`
            }
            <div style="margin-top:4px;padding-top:4px;border-top:1px solid var(--border);">
              <b>👁️ 玩家出生点视野目标检测 (${playerTargets.length})</b>:
              ${playerTargets
                .map(
                  (pt) =>
                    `<div style="color:${
                      pt.status === 'visible'
                        ? '#22c55e'
                        : pt.status === 'peripheral'
                        ? '#38bdf8'
                        : pt.status === 'occluded'
                        ? '#f59e0b'
                        : '#94a3b8'
                    };">• ${pt.name}: ${pt.statusLabel}</div>`
                )
                .join('')}
            </div>
          </div>
        </div>
      `
          : `
        <!-- Enemy Patrol Waypoints, A* Pathfinding & Target Detection Panel -->
        <div class="panel-card" style="border-color:rgba(244,63,94,0.45);">
          <div class="card-title">
            <span style="color:#fda4af;">${t('enemyAITitle')}</span>
          </div>
          <div class="form-row">
            <label>${t('patrolModeLbl')}</label>
            <select id="ins-ec-mode">
              <option value="stationary" ${ec.patrolMode === 'stationary' ? 'selected' : ''}>Stationary (定点防守)</option>
              <option value="loop" ${ec.patrolMode === 'loop' ? 'selected' : ''}>Loop (循环巡逻 W1→Wn→W1)</option>
              <option value="pingpong" ${ec.patrolMode === 'pingpong' ? 'selected' : ''}>Ping-Pong (往返巡逻 W1↔Wn)</option>
            </select>
          </div>
          <div class="form-row">
            <label>${t('autoPathLbl')}</label>
            <input type="checkbox" id="ins-ec-astar" ${ec.autoPathfind ? 'checked' : ''} style="width:16px;height:16px;" />
          </div>
          <div class="form-row">
            <label>${t('patrolSpeedLbl')}</label>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:4px;">
              <input type="number" step="0.2" id="ins-ec-pspd" value="${ec.patrolSpeed}" title="Patrol m/s" />
              <input type="number" step="0.2" id="ins-ec-cspd" value="${ec.chaseSpeed}" title="Chase m/s" />
            </div>
          </div>
          <div class="form-row">
            <label>${t('hearingRangeLbl')}</label>
            <input type="number" step="0.5" min="0" id="ins-ec-hear" value="${ec.hearingRange}" />
          </div>
          <div class="form-row">
            <label>${t('targetIdLbl')}</label>
            <select id="ins-ec-target">
              ${store.doc.pois
                .filter((p) => p.id !== poi.id)
                .map(
                  (p) =>
                    `<option value="${p.id}" ${ec.targetId === p.id ? 'selected' : ''}>${p.name} (${p.id})</option>`
                )
                .join('')}
            </select>
          </div>

          <div style="display:flex;gap:5px;margin-top:2px;">
            <button class="btn ${store.activeTool === 'add_enemy_waypoint' ? 'active' : 'btn-primary'}" id="btn-ins-add-wp" style="flex:1;justify-content:center;">
              ${t('addWPToolBtn')}
            </button>
            <button class="btn" id="btn-ins-clear-wp" style="color:#fca5a5;">${t('clearWPBtn')}</button>
          </div>

          <div style="font-size:10px;color:#cbd5e1;background:var(--bg-1);padding:6px;border-radius:4px;line-height:1.45;">
            <div>🚩 <b>巡逻点 (${ec.waypoints.length})</b> · A* 巡逻总程: <b>${patrolTotalDist.toFixed(1)}m</b> (${(patrolTotalDist / Math.max(0.5, ec.patrolSpeed)).toFixed(1)}s)</div>
            <div style="display:flex;flex-wrap:wrap;gap:4px;margin-top:4px;">
              ${ec.waypoints
                .map(
                  (wp, idx) => `
                  <span class="chip-toggle" style="display:inline-flex;align-items:center;gap:4px;">
                    W${idx + 1}(${wp[0]},${wp[1]},${wp[2]})
                    <b data-del-wp="${idx}" style="color:#f87171;cursor:pointer;">×</b>
                  </span>
                `
                )
                .join('')}
            </div>
            ${
              det
                ? `<div style="margin-top:6px;padding-top:5px;border-top:1px solid var(--border);color:${
                    det.status === 'detected_visual' ? '#ef4444' : det.status === 'detected_hearing' ? '#f59e0b' : '#22c55e'
                  };">
                    🎯 <b>实时索敌判定 (${targetPOI?.name})</b>: ${det.statusLabel} (直线 ${det.distance}m)<br/>
                    🧭 <b>A* 追击寻路距离</b>: <b>${det.chaseDistance}m</b> (预计追击耗时 <b>${det.chaseTimeSec}s</b>)
                  </div>`
                : ''
            }
          </div>
        </div>
      `
      }
    `;
  }

  const sightlines = store.doc.sightlines || [];

  container.innerHTML = `
    ${selectionCardHTML}

    <div class="panel-card">
      <div class="card-title">
        <span>${t('sightlineListTitle')} (${sightlines.length})</span>
        <button class="btn" id="btn-start-ruler-tool" style="padding:2px 7px;font-size:10px;">📏 +拉线绑定</button>
      </div>
      ${
        sightlines.length === 0
          ? `<div style="font-size:10px;color:var(--text-muted);">点击「📏 +拉线绑定」并在 2D 或 3D 视口中从一个 POI/体块拖到另一个物体，即可创建随物体实时移动的 3D 遮挡测距线。</div>`
          : sightlines
              .map((s) => {
                const { from, to, fromLabel, toLabel } = resolveSightlineEndpoints(s, store.doc);
                const res = raycastLevel3D(from, to, store.doc.blocks);
                return `
                  <div class="issue-item ${!res.blocked ? 'info' : 'error'}" style="padding:5px 7px;">
                    <div style="display:flex;justify-content:space-between;align-items:center;">
                      <span style="font-weight:600;">${fromLabel} → ${toLabel} (${res.distance}m)</span>
                      <button class="chip-toggle" data-del-sightline="${s.id}" style="color:#fca5a5;">×</button>
                    </div>
                    <div style="font-size:10px;color:${!res.blocked ? '#86efac' : '#fca5a5'};">
                      ${!res.blocked ? '✓ 视线畅通 (Clear LOS)' : `✖ 在 ${res.hitDistance}m 处被「${res.hitBlockName}」遮挡`}
                    </div>
                  </div>
                `;
              })
              .join('')
      }
    </div>

    <div class="panel-card">
      <div class="card-title">
        <span>✂ Section A—A'</span>
      </div>
      <div class="form-row">
        <label>Start A (X,Z)</label>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:4px;">
          <input type="number" step="0.5" id="sec-start-x" value="${sec.start[0]}" />
          <input type="number" step="0.5" id="sec-start-z" value="${sec.start[1]}" />
        </div>
      </div>
      <div class="form-row">
        <label>End A' (X,Z)</label>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:4px;">
          <input type="number" step="0.5" id="sec-end-x" value="${sec.end[0]}" />
          <input type="number" step="0.5" id="sec-end-z" value="${sec.end[1]}" />
        </div>
      </div>
      <div class="form-row">
        <label>Slab Depth(m)</label>
        <input type="number" step="1" min="1" max="50" id="sec-slab" value="${sec.slabDepth}" />
      </div>
      <div style="display:flex;gap:5px;">
        <button class="btn" id="sec-align-x" style="flex:1;justify-content:center;">X-Axis Cut</button>
        <button class="btn" id="sec-align-z" style="flex:1;justify-content:center;">Z-Axis Cut</button>
      </div>
    </div>

    <div class="panel-card">
      <div class="card-title">
        <span>${t('outlinerTitle')} (${store.doc.blocks.length})</span>
        <button class="btn" id="btn-clear-all" style="color:#fca5a5;padding:2px 6px;font-size:10px;">${t('clearSceneBtn')}</button>
      </div>
      <div class="outliner-list" id="outliner-list">
        ${store.doc.blocks
          .map((b) => {
            const m = ROLE_META[b.role] || ROLE_META.walkable;
            const isSel = store.selection?.kind === 'block' && store.selection.id === b.id;
            return `
              <div class="outliner-item ${isSel ? 'selected' : ''}" data-sel-kind="block" data-sel-id="${b.id}">
                <div style="display:flex;align-items:center;gap:6px;">
                  <span class="color-swatch" style="background:${b.color || m.color}"></span>
                  <span>${b.name}</span>
                </div>
                <span style="color:var(--text-muted);font-family:'JetBrains Mono',monospace;font-size:10px;">
                  ${b.floor}F · ${b.size[0]}×${b.size[1]}×${b.size[2]}
                </span>
              </div>
            `;
          })
          .join('')}
        ${store.doc.pois
          .map((p) => {
            const m = POI_META[p.category] || POI_META.objective;
            const isSel = store.selection?.kind === 'poi' && store.selection.id === p.id;
            return `
              <div class="outliner-item ${isSel ? 'selected' : ''}" data-sel-kind="poi" data-sel-id="${p.id}">
                <div style="display:flex;align-items:center;gap:6px;">
                  <span class="color-swatch" style="background:${m.color}"></span>
                  <span>[POI] ${p.name}</span>
                </div>
                <span style="color:var(--text-muted);font-size:10px;">${p.enemyConfig ? '🤖 A*' : ''} ${p.showVision ? '👁️ LOS' : ''}</span>
              </div>
            `;
          })
          .join('')}
      </div>
    </div>
  `;

  document.getElementById('btn-start-ruler-tool')!.onclick = () => {
    store.activeTool = 'measure_ruler';
    store.notify(false);
  };

  container.querySelectorAll<HTMLButtonElement>('[data-del-sightline]').forEach((btn) => {
    btn.onclick = () => {
      store.dispatchAICommand({ action: 'delete_sightline', id: btn.dataset.delSightline! });
    };
  });

  if (blk) {
    const bindBlkPatch = (id: string, fn: (val: string) => Partial<typeof blk & object>) => {
      const el = document.getElementById(id) as HTMLInputElement | HTMLSelectElement | null;
      if (!el) return;
      el.onchange = () => {
        store.pushUndoSnapshot();
        store.updateBlockLive(blk.id, fn(el.value), true);
      };
    };
    bindBlkPatch('ins-blk-name', (v) => ({ name: v }));
    bindBlkPatch('ins-blk-type', (v) => ({ type: v as BlockType }));
    bindBlkPatch('ins-blk-role', (v) => ({ role: v as BlockRole }));
    bindBlkPatch('ins-blk-floor', (v) => ({ floor: Number(v) || 0 }));
    bindBlkPatch('ins-blk-notes', (v) => ({ notes: v }));

    const updateVec = () => {
      const px = Number((document.getElementById('ins-pos-x') as HTMLInputElement).value) || 0;
      const py = Number((document.getElementById('ins-pos-y') as HTMLInputElement).value) || 0;
      const pz = Number((document.getElementById('ins-pos-z') as HTMLInputElement).value) || 0;
      const sx = Math.max(0.2, Number((document.getElementById('ins-size-x') as HTMLInputElement).value) || 1);
      const sy = Math.max(0.2, Number((document.getElementById('ins-size-y') as HTMLInputElement).value) || 1);
      const sz = Math.max(0.2, Number((document.getElementById('ins-size-z') as HTMLInputElement).value) || 1);
      const rx = Number((document.getElementById('ins-rot-x') as HTMLInputElement).value) || 0;
      const ry = Number((document.getElementById('ins-rot-y') as HTMLInputElement).value) || 0;
      const rz = Number((document.getElementById('ins-rot-z') as HTMLInputElement).value) || 0;
      store.updateBlockLive(blk.id, { position: [px, py, pz], size: [sx, sy, sz], rotation: [rx, ry, rz] }, true);
    };
    ['ins-pos-x', 'ins-pos-y', 'ins-pos-z', 'ins-size-x', 'ins-size-y', 'ins-size-z', 'ins-rot-x', 'ins-rot-y', 'ins-rot-z'].forEach(
      (id) => {
        const el = document.getElementById(id);
        if (el) el.oninput = updateVec;
      }
    );

    document.getElementById('ins-frame-blk')!.onclick = () => store.requestFrameSelected();
    document.getElementById('ins-dup-blk')!.onclick = () => store.duplicateSelectedBlock();
    document.getElementById('ins-del-blk')!.onclick = () => store.deleteSelected();

    const blkColIn = document.getElementById('ins-blk-color') as HTMLInputElement | null;
    if (blkColIn) {
      blkColIn.oninput = () => {
        store.updateBlockLive(blk.id, { color: blkColIn.value }, true);
      };
    }

    const blkColReset = document.getElementById('ins-blk-color-reset');
    if (blkColReset) {
      blkColReset.onclick = () => {
        store.pushUndoSnapshot();
        store.updateBlockLive(blk.id, { color: undefined }, true);
      };
    }

    container.querySelectorAll<HTMLElement>('[data-ins-swatch]').forEach((sw) => {
      sw.onclick = () => {
        store.pushUndoSnapshot();
        store.updateBlockLive(blk.id, { color: sw.dataset.insSwatch }, true);
      };
    });
  }

  if (poi) {
    const isPlayerSpawn = poi.category === 'spawn_player';
    const updatePOI = () => {
      const name = (document.getElementById('ins-poi-name') as HTMLInputElement).value;
      const category = (document.getElementById('ins-poi-cat') as HTMLSelectElement).value as POICategory;
      const px = Number((document.getElementById('ins-poi-x') as HTMLInputElement).value) || 0;
      const py = Number((document.getElementById('ins-poi-y') as HTMLInputElement).value) || 0;
      const pz = Number((document.getElementById('ins-poi-z') as HTMLInputElement).value) || 0;
      const yaw = Number((document.getElementById('ins-poi-yaw') as HTMLInputElement).value) || 0;
      const showVision = (document.getElementById('ins-poi-vision') as HTMLInputElement).checked;
      const fov = Number((document.getElementById('ins-poi-fov') as HTMLInputElement).value) || 90;
      const visionRange = Number((document.getElementById('ins-poi-range') as HTMLInputElement).value) || 20;

      if (isPlayerSpawn) {
        const mp = store.doc.metricsProfile;
        mp.cameraMode = (document.getElementById('ins-pcam-mode') as HTMLSelectElement).value as PlayerCameraMode;
        mp.cameraFov = Number((document.getElementById('ins-pcam-fov') as HTMLInputElement).value) || 68;
        mp.cameraDistance = Number((document.getElementById('ins-pcam-dist') as HTMLInputElement).value) || 0;
        mp.cameraOffsetY = Number((document.getElementById('ins-pcam-offy') as HTMLInputElement).value) || 1.65;
        mp.cameraShoulderOffset = Number((document.getElementById('ins-pcam-shoulder') as HTMLInputElement).value) || 0;
        mp.cameraPitch = Number((document.getElementById('ins-pcam-pitch') as HTMLInputElement).value) || 0;
        mp.cameraCollision = (document.getElementById('ins-pcam-coll') as HTMLInputElement).checked;
        mp.showPlayerCameraFrustum = (document.getElementById('ins-pcam-frustum') as HTMLInputElement).checked;
        mp.showPlayerVision = (document.getElementById('ins-pvis-show') as HTMLInputElement).checked;
        mp.playerVisionFov = Number((document.getElementById('ins-pvis-fov') as HTMLInputElement).value) || 95;
        mp.playerVisionRange = Number((document.getElementById('ins-pvis-range') as HTMLInputElement).value) || 26;
        mp.playerPeripheralRange = Number((document.getElementById('ins-pvis-periph') as HTMLInputElement).value) || 0;

        store.updatePOILive(
          poi.id,
          {
            name,
            category,
            position: [px, py, pz],
            yaw,
            showVision: mp.showPlayerVision,
            fov: mp.playerVisionFov,
            visionRange: mp.playerVisionRange,
          },
          true
        );
        if (!isScrubbingNumber) renderSidebar();
        return;
      }

      const existingEC: EnemyAIConfig = poi.enemyConfig || {
        patrolMode: 'loop',
        waypoints: [structuredClone(poi.position)],
        autoPathfind: true,
        patrolSpeed: 2.6,
        chaseSpeed: 5.5,
        hearingRange: 7.0,
        targetId: 'poi_spawn_player',
      };

      const patrolMode = (document.getElementById('ins-ec-mode') as HTMLSelectElement).value as EnemyAIConfig['patrolMode'];
      const autoPathfind = (document.getElementById('ins-ec-astar') as HTMLInputElement).checked;
      const patrolSpeed = Number((document.getElementById('ins-ec-pspd') as HTMLInputElement).value) || 2.5;
      const chaseSpeed = Number((document.getElementById('ins-ec-cspd') as HTMLInputElement).value) || 5.5;
      const hearingRange = Number((document.getElementById('ins-ec-hear') as HTMLInputElement).value) || 0;
      const targetId = (document.getElementById('ins-ec-target') as HTMLSelectElement).value;

      store.updatePOILive(
        poi.id,
        {
          name,
          category,
          position: [px, py, pz],
          yaw,
          showVision,
          fov,
          visionRange,
          enemyConfig: {
            ...existingEC,
            patrolMode,
            autoPathfind,
            patrolSpeed,
            chaseSpeed,
            hearingRange,
            targetId,
          },
        },
        true
      );
      if (!isScrubbingNumber) renderSidebar();
    };

    [
      'ins-poi-name',
      'ins-poi-cat',
      'ins-poi-x',
      'ins-poi-y',
      'ins-poi-z',
      'ins-poi-yaw',
      'ins-poi-vision',
      'ins-poi-fov',
      'ins-poi-range',
      'ins-ec-mode',
      'ins-ec-astar',
      'ins-ec-pspd',
      'ins-ec-cspd',
      'ins-ec-hear',
      'ins-ec-target',
      'ins-pcam-mode',
      'ins-pcam-fov',
      'ins-pcam-dist',
      'ins-pcam-offy',
      'ins-pcam-shoulder',
      'ins-pcam-pitch',
      'ins-pcam-coll',
      'ins-pcam-frustum',
      'ins-pvis-show',
      'ins-pvis-fov',
      'ins-pvis-range',
      'ins-pvis-periph',
    ].forEach((id) => {
      const el = document.getElementById(id) as HTMLInputElement | null;
      if (el) {
        el.onchange = updatePOI;
        if (el.type === 'number') el.oninput = updatePOI;
      }
    });

    document.getElementById('ins-frame-poi')!.onclick = () => store.requestFrameSelected();
    document.getElementById('ins-del-poi')!.onclick = () => store.deleteSelected();

    const addWpBtn = document.getElementById('btn-ins-add-wp');
    if (addWpBtn) {
      addWpBtn.onclick = () => {
        store.activeTool = store.activeTool === 'add_enemy_waypoint' ? 'select' : 'add_enemy_waypoint';
        store.notify(false);
      };
    }

    const clearWpBtn = document.getElementById('btn-ins-clear-wp');
    if (clearWpBtn) {
      clearWpBtn.onclick = () => {
        if (!poi.enemyConfig) return;
        store.pushUndoSnapshot();
        poi.enemyConfig.waypoints = [structuredClone(poi.position)];
        store.notify(true);
      };
    }

    container.querySelectorAll<HTMLElement>('[data-del-wp]').forEach((btn) => {
      btn.onclick = () => {
        const idx = Number(btn.dataset.delWp);
        if (!poi.enemyConfig) return;
        store.pushUndoSnapshot();
        poi.enemyConfig.waypoints.splice(idx, 1);
        store.notify(true);
      };
    });
  }

  const updateSec = () => {
    const sx = Number((document.getElementById('sec-start-x') as HTMLInputElement).value) || 0;
    const sz = Number((document.getElementById('sec-start-z') as HTMLInputElement).value) || 0;
    const ex = Number((document.getElementById('sec-end-x') as HTMLInputElement).value) || 0;
    const ez = Number((document.getElementById('sec-end-z') as HTMLInputElement).value) || 0;
    const slab = Number((document.getElementById('sec-slab') as HTMLInputElement).value) || 8;
    store.doc.sectionPlane.start = [sx, sz];
    store.doc.sectionPlane.end = [ex, ez];
    store.doc.sectionPlane.slabDepth = slab;
    store.notifyViewportsOnly(true);
  };
  ['sec-start-x', 'sec-start-z', 'sec-end-x', 'sec-end-z', 'sec-slab'].forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.oninput = updateSec;
  });

  document.getElementById('sec-align-x')!.onclick = () => {
    store.dispatchAICommand({ action: 'set_section', section: { start: [-15, 0], end: [15, 0] } });
  };
  document.getElementById('sec-align-z')!.onclick = () => {
    store.dispatchAICommand({ action: 'set_section', section: { start: [0, 15], end: [0, -15] } });
  };

  document.getElementById('btn-clear-all')!.onclick = () => {
    store.dispatchAICommand({ action: 'clear_all' });
  };

  container.querySelectorAll<HTMLElement>('[data-sel-id]').forEach((item) => {
    item.onclick = () => {
      const kind = item.dataset.selKind as 'block' | 'poi';
      const id = item.dataset.selId!;
      store.setSelection({ kind, id });
    };
    item.ondblclick = () => {
      const kind = item.dataset.selKind as 'block' | 'poi';
      const id = item.dataset.selId!;
      store.setSelection({ kind, id });
      store.requestFrameSelected();
    };
  });
}

function renderMetricsTab(container: HTMLElement): void {
  const m = store.doc.metricsProfile;

  const sliderRow = (
    labelKey: string,
    id: string,
    val: number,
    min: number,
    max: number,
    step: number
  ) => `
    <div class="form-row" style="grid-template-columns: 98px 1fr 56px;">
      <label>${t(labelKey)}</label>
      <input type="range" id="${id}-rng" min="${min}" max="${max}" step="${step}" value="${val}" style="accent-color:var(--accent);cursor:pointer;" />
      <input type="number" id="${id}-num" min="${min}" max="${max}" step="${step}" value="${val}" />
    </div>
  `;

  container.innerHTML = `
    <div class="panel-card">
      <div class="card-title"><span>${t('metricsPresetTitle')}</span></div>
      <select id="metrics-preset-select">
        <option value="">-- Preset --</option>
        ${Object.entries(METRICS_PRESETS)
          .map(
            ([key, val]) =>
              `<option value="${key}" ${m.presetName === val.presetName ? 'selected' : ''}>${val.presetName}</option>`
          )
          .join('')}
      </select>
      <div style="font-size:10px;color:#38bdf8;line-height:1.4;">
        ${t('metricsPresetHint')}
      </div>
    </div>

    <div class="panel-card" style="border-color:rgba(56,189,248,0.45);">
      <div class="card-title"><span style="color:#38bdf8;">${t('playerCamVisionTitle')}</span></div>
      <div class="form-row">
        <label>${t('camModeLbl')}</label>
        <select id="m-cam-mode">
          <option value="fps" ${(m.cameraMode ?? 'tps') === 'fps' ? 'selected' : ''}>FPS (第一人称主视角)</option>
          <option value="tps" ${(m.cameraMode ?? 'tps') === 'tps' ? 'selected' : ''}>TPS (第三人称越肩弹簧臂)</option>
          <option value="topdown" ${(m.cameraMode ?? 'tps') === 'topdown' ? 'selected' : ''}>Top-Down (2D/3D俯视镜头)</option>
          <option value="side_2d" ${(m.cameraMode ?? 'tps') === 'side_2d' ? 'selected' : ''}>2D Side-Scroller (2D横版卷轴跟拍)</option>
        </select>
      </div>
      ${sliderRow('camFovLbl', 'm-cam-fov', m.cameraFov ?? 68, 35, 120, 1)}
      ${sliderRow('camDistLbl', 'm-cam-dist', m.cameraDistance ?? 3.2, 0, 18, 0.2)}
      ${sliderRow('camOffsetYLbl', 'm-cam-offy', m.cameraOffsetY ?? m.eyeHeight, 0.5, 3.0, 0.05)}
      ${sliderRow('camShoulderLbl', 'm-cam-shld', m.cameraShoulderOffset ?? 0.45, -1.5, 1.5, 0.05)}
      ${sliderRow('camPitchLbl', 'm-cam-pitch', m.cameraPitch ?? -10, -75, 45, 1)}
      <div class="form-row">
        <label>${t('camCollLbl')}</label>
        <div style="display:flex;align-items:center;gap:8px;">
          <input type="checkbox" id="m-cam-coll" ${(m.cameraCollision ?? true) ? 'checked' : ''} style="width:15px;height:15px;" />
          <span style="font-size:10px;color:var(--text-muted);">${t('showCamFrustumLbl')}</span>
          <input type="checkbox" id="m-cam-frust" ${(m.showPlayerCameraFrustum ?? true) ? 'checked' : ''} style="width:15px;height:15px;" />
        </div>
      </div>
      <div class="form-row">
        <label>${t('showPlayerVisLbl')}</label>
        <input type="checkbox" id="m-pvis-show" ${(m.showPlayerVision ?? true) ? 'checked' : ''} style="width:15px;height:15px;" />
      </div>
      ${sliderRow('playerVisFovLbl', 'm-pvis-fov', m.playerVisionFov ?? 95, 30, 160, 2)}
      ${sliderRow('playerVisRangeLbl', 'm-pvis-rng', m.playerVisionRange ?? 26, 5, 60, 1)}
      ${sliderRow('playerPeriphLbl', 'm-pvis-periph', m.playerPeripheralRange ?? 5.0, 0, 20, 0.5)}
    </div>

    <div class="panel-card">
      <div class="card-title"><span>${t('movJumpTitle')}</span></div>
      ${sliderRow('mWalk', 'm-walk', m.walkSpeed, 1, 15, 0.2)}
      ${sliderRow('mRun', 'm-run', m.runSpeed, 2, 22, 0.2)}
      ${sliderRow('mJumpH', 'm-jmp-h', m.jumpHeight, 0.4, 8.0, 0.1)}
      ${sliderRow('mJumpD', 'm-jmp-d', m.jumpDistance, 1.0, 16.0, 0.2)}
      ${sliderRow('mDoubleH', 'm-djmp-h', m.doubleJumpHeight, 0.8, 14.0, 0.2)}
      ${sliderRow('mDoubleD', 'm-djmp-d', m.doubleJumpDistance, 2.0, 24.0, 0.2)}
      ${sliderRow('mGravity', 'm-grav', m.gravity, 4.0, 35.0, 0.5)}
      ${sliderRow('mSlope', 'm-slope', m.maxSlopeAngle, 15, 75, 1)}
      <div id="live-jump-feedback" style="margin-top:4px;padding:6px;background:var(--bg-1);border-radius:4px;font-size:10px;line-height:1.45;"></div>
    </div>

    <div class="panel-card">
      <div class="card-title"><span>${t('charCoverTitle')}</span></div>
      ${sliderRow('mHeight', 'm-height', m.playerHeight, 0.8, 3.5, 0.05)}
      ${sliderRow('mRadius', 'm-radius', m.playerRadius, 0.2, 1.2, 0.05)}
      ${sliderRow('mCrouch', 'm-crouch', m.crouchHeight, 0.4, 2.0, 0.05)}
      ${sliderRow('mEye', 'm-eye', m.eyeHeight, 0.6, 3.2, 0.05)}
      ${sliderRow('mLowCov', 'm-low-cov', m.lowCoverHeight, 0.5, 2.0, 0.05)}
      ${sliderRow('mFullCov', 'm-full-cov', m.fullCoverHeight, 1.2, 3.5, 0.05)}
    </div>
  `;

  const updateLiveJumpFeedback = () => {
    const fb = document.getElementById('live-jump-feedback');
    if (!fb) return;
    const mp = store.doc.metricsProfile;
    const dynFlatSpan =
      mp.jumpDistance *
      Math.max(0.15, mp.runSpeed / 7.0) *
      Math.sqrt(18.0 / Math.max(2.0, mp.gravity)) *
      Math.sqrt(Math.max(0.15, mp.jumpHeight / 1.6));
    const lines = [
      `<div style="color:#f8fafc;font-weight:600;">⚡ 实时物理包络: 平地单跳极限跨距 = <span style="color:#22c55e;">${dynFlatSpan.toFixed(2)}m</span> (跃高 ${mp.jumpHeight}m)</div>`,
    ];
    for (const j of store.doc.jumps) {
      const ev = evaluateJumpLink(j.from, j.to, mp, store.doc.blocks);
      const c =
        ev.status === 'safe'
          ? '#22c55e'
          : ev.status === 'stretch'
          ? '#f59e0b'
          : ev.status === 'double_jump'
          ? '#38bdf8'
          : '#ef4444';
      lines.push(
        `<div style="color:${c};">• ${j.name}: 目标 ${ev.horizontalDist}m / 当前可达 ${ev.effectiveMaxDistSingle}m → <b>${ev.statusLabel}</b></div>`
      );
    }
    fb.innerHTML = lines.join('');
  };

  updateLiveJumpFeedback();

  const presetSel = document.getElementById('metrics-preset-select') as HTMLSelectElement;
  presetSel.onchange = () => {
    const p = METRICS_PRESETS[presetSel.value];
    if (p) {
      store.dispatchAICommand({ action: 'update_metrics', metrics: structuredClone(p) });
    }
  };

  const bindLiveMetric = (id: string, key: keyof typeof m) => {
    const rng = document.getElementById(`${id}-rng`) as HTMLInputElement | null;
    const num = document.getElementById(`${id}-num`) as HTMLInputElement | null;
    if (!rng || !num) return;

    const applyVal = (v: number) => {
      if (isNaN(v)) return;
      (store.doc.metricsProfile[key] as number) = v;
      store.notifyViewportsOnly(true);
      updateLiveJumpFeedback();
    };

    rng.oninput = () => {
      num.value = rng.value;
      applyVal(Number(rng.value));
    };
    num.oninput = () => {
      rng.value = num.value;
      applyVal(Number(num.value));
    };
  };

  bindLiveMetric('m-walk', 'walkSpeed');
  bindLiveMetric('m-run', 'runSpeed');
  bindLiveMetric('m-jmp-h', 'jumpHeight');
  bindLiveMetric('m-jmp-d', 'jumpDistance');
  bindLiveMetric('m-djmp-h', 'doubleJumpHeight');
  bindLiveMetric('m-djmp-d', 'doubleJumpDistance');
  bindLiveMetric('m-grav', 'gravity');
  bindLiveMetric('m-slope', 'maxSlopeAngle');
  bindLiveMetric('m-height', 'playerHeight');
  bindLiveMetric('m-radius', 'playerRadius');
  bindLiveMetric('m-crouch', 'crouchHeight');
  bindLiveMetric('m-eye', 'eyeHeight');
  bindLiveMetric('m-low-cov', 'lowCoverHeight');
  bindLiveMetric('m-full-cov', 'fullCoverHeight');
  bindLiveMetric('m-cam-fov', 'cameraFov');
  bindLiveMetric('m-cam-dist', 'cameraDistance');
  bindLiveMetric('m-cam-offy', 'cameraOffsetY');
  bindLiveMetric('m-cam-shld', 'cameraShoulderOffset');
  bindLiveMetric('m-cam-pitch', 'cameraPitch');
  bindLiveMetric('m-pvis-fov', 'playerVisionFov');
  bindLiveMetric('m-pvis-rng', 'playerVisionRange');
  bindLiveMetric('m-pvis-periph', 'playerPeripheralRange');

  const camModeSel = document.getElementById('m-cam-mode') as HTMLSelectElement | null;
  if (camModeSel) {
    camModeSel.onchange = () => {
      const mode = camModeSel.value as PlayerCameraMode;
      store.doc.metricsProfile.cameraMode = mode;
      if (mode === 'fps') {
        store.doc.metricsProfile.cameraDistance = 0;
        store.doc.metricsProfile.cameraShoulderOffset = 0;
        store.doc.metricsProfile.cameraPitch = 0;
      } else if (mode === 'tps' && (store.doc.metricsProfile.cameraDistance ?? 0) < 0.5) {
        store.doc.metricsProfile.cameraDistance = 3.2;
        store.doc.metricsProfile.cameraShoulderOffset = 0.45;
        store.doc.metricsProfile.cameraPitch = -10;
      } else if (mode === 'topdown') {
        store.doc.metricsProfile.cameraDistance = 11.0;
        store.doc.metricsProfile.cameraShoulderOffset = 0;
        store.doc.metricsProfile.cameraPitch = -48;
      }
      store.notify(true);
    };
  }

  const bindBoolMetric = (id: string, key: 'cameraCollision' | 'showPlayerCameraFrustum' | 'showPlayerVision') => {
    const el = document.getElementById(id) as HTMLInputElement | null;
    if (!el) return;
    el.onchange = () => {
      store.doc.metricsProfile[key] = el.checked;
      store.notifyViewportsOnly(true);
    };
  };
  bindBoolMetric('m-cam-coll', 'cameraCollision');
  bindBoolMetric('m-cam-frust', 'showPlayerCameraFrustum');
  bindBoolMetric('m-pvis-show', 'showPlayerVision');
}

function renderAuditTab(container: HTMLElement): void {
  const audit = auditLevel(store.doc);
  const beats = audit.pacingBeats || [];
  const tLinks = resolveTriggerLinks(store.doc);

  // Build SVG Pacing & Tension Curve
  const svgW = 300;
  const svgH = 115;
  const padL = 24;
  const padR = 10;
  const padT = 12;
  const padB = 20;
  const plotW = svgW - padL - padR;
  const plotH = svgH - padT - padB;

  const tensionPts = beats
    .map((b, idx) => {
      const x = padL + (idx / Math.max(1, beats.length - 1)) * plotW;
      const y = padT + (1 - b.tension / 100) * plotH;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');

  const safetyPts = beats
    .map((b, idx) => {
      const x = padL + (idx / Math.max(1, beats.length - 1)) * plotW;
      const y = padT + (1 - b.safety / 100) * plotH;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');

  const annotatedBlocks = store.doc.blocks.filter((b) => b.designTag || b.notes || b.mechanicsTip || b.linkedId);
  const annotatedPOIs = store.doc.pois.filter((p) => p.designTag || p.notes || p.mechanicsTip || p.linkedId);

  container.innerHTML = `
    <div class="panel-card">
      <div class="card-title"><span>${t('auditStatsTitle')}</span></div>
      <div class="stat-grid">
        <div class="stat-box">
          <div class="stat-label">${t('statWalkArea')}</div>
          <div class="stat-val">${audit.totalWalkableArea} ㎡</div>
        </div>
        <div class="stat-box">
          <div class="stat-label">${t('statCoverRatio')}</div>
          <div class="stat-val">${audit.totalCoverLength}m (${audit.coverToAreaRatio}%)</div>
        </div>
        <div class="stat-box">
          <div class="stat-label">${t('statMainPath')}</div>
          <div class="stat-val">${audit.mainPathDistance} m</div>
        </div>
        <div class="stat-box">
          <div class="stat-label">${t('statRunWalkTime')}</div>
          <div class="stat-val">${audit.estimatedRunTimeSec}s / ${audit.estimatedWalkTimeSec}s</div>
        </div>
      </div>
      <div style="font-size:11px;color:var(--text-muted);margin-top:4px;">
        Elevation Span: <b>${audit.elevationSpan[0]}m ~ +${audit.elevationSpan[1]}m</b> · 机关联动数: <b>${tLinks.length}</b>
      </div>
    </div>

    <!-- Pacing & Intensity Curve Card -->
    <div class="panel-card" style="border-color:rgba(244,63,94,0.45);">
      <div class="card-title">
        <span>📈 关卡心流与交火烈度曲线 (Pacing Curve)</span>
      </div>
      <svg viewBox="0 0 ${svgW} ${svgH}" style="width:100%;height:auto;background:#070b14;border:1px solid var(--border);border-radius:6px;">
        <line x1="${padL}" y1="${padT + plotH * 0.25}" x2="${svgW - padR}" y2="${padT + plotH * 0.25}" stroke="#1e293b" stroke-dasharray="2,2" />
        <line x1="${padL}" y1="${padT + plotH * 0.5}" x2="${svgW - padR}" y2="${padT + plotH * 0.5}" stroke="#1e293b" stroke-dasharray="2,2" />
        <line x1="${padL}" y1="${padT + plotH * 0.75}" x2="${svgW - padR}" y2="${padT + plotH * 0.75}" stroke="#1e293b" stroke-dasharray="2,2" />
        <text x="4" y="${padT + 6}" fill="#94a3b8" font-size="8">100</text>
        <text x="8" y="${padT + plotH / 2 + 3}" fill="#94a3b8" font-size="8">50</text>
        <text x="12" y="${padT + plotH}" fill="#94a3b8" font-size="8">0</text>
        <polyline fill="none" stroke="#22c55e" stroke-width="1.8" stroke-dasharray="3,2" points="${safetyPts}" />
        <polyline fill="none" stroke="#f43f5e" stroke-width="2.4" points="${tensionPts}" />
        ${beats
          .map((b, idx) => {
            const x = padL + (idx / Math.max(1, beats.length - 1)) * plotW;
            const y = padT + (1 - b.tension / 100) * plotH;
            return `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="2.6" fill="#f43f5e"><title>${b.progressPct}%: ${b.beatLabel} (烈度 ${b.tension} / 掩体安全 ${b.safety})</title></circle>`;
          })
          .join('')}
        <text x="${padL}" y="${svgH - 5}" fill="#f43f5e" font-size="8.5" font-weight="bold">━ 战斗威胁烈度 (Tension)</text>
        <text x="${padL + 132}" y="${svgH - 5}" fill="#22c55e" font-size="8.5" font-weight="bold">┅ 掩体/补给安全度 (Safety)</text>
      </svg>
      <div style="font-size:10px;color:#cbd5e1;line-height:1.45;">
        ${audit.pacingVerdict || ''}
      </div>
    </div>

    <!-- Annotated Objects & Design Rationale Summary Table -->
    <div class="panel-card" style="border-color:rgba(250,204,21,0.4);">
      <div class="card-title">
        <span>📝 全关卡物体设计思路汇总 (${annotatedBlocks.length + annotatedPOIs.length})</span>
        <button class="btn" id="btn-export-md-doc" style="padding:2px 7px;font-size:10px;color:#fde047;">📄 导出设计文档(.md)</button>
      </div>
      ${
        annotatedBlocks.length + annotatedPOIs.length === 0
          ? `<div style="font-size:10px;color:var(--text-muted);">点击视口中的任意体块或 POI，即可在左下角浮动备注卡中一键打标签并记录设计思路。</div>`
          : `<div style="display:flex;flex-direction:column;gap:4px;max-height:210px;overflow-y:auto;">
              ${annotatedBlocks
                .map(
                  (b) => `
                <div class="issue-item info" data-focus-kind="block" data-focus-id="${b.id}" style="padding:5px 7px;">
                  <div style="display:flex;justify-content:space-between;align-items:center;">
                    <span style="font-weight:700;color:#f8fafc;">🧱 ${b.name}</span>
                    ${b.designTag ? `<span style="font-size:9px;background:rgba(250,204,21,0.2);color:#fde047;padding:1px 5px;border-radius:4px;">🏷️ ${b.designTag}</span>` : ''}
                  </div>
                  ${b.notes ? `<div style="font-size:10px;color:#cbd5e1;">💡 ${b.notes}</div>` : ''}
                  ${b.mechanicsTip ? `<div style="font-size:9.5px;color:#38bdf8;">⚙️ ${b.mechanicsTip}</div>` : ''}
                </div>
              `
                )
                .join('')}
              ${annotatedPOIs
                .map(
                  (p) => `
                <div class="issue-item info" data-focus-kind="poi" data-focus-id="${p.id}" style="padding:5px 7px;border-left-color:#a855f7;">
                  <div style="display:flex;justify-content:space-between;align-items:center;">
                    <span style="font-weight:700;color:#f8fafc;">📍 ${p.name}</span>
                    ${p.designTag ? `<span style="font-size:9px;background:rgba(168,85,247,0.25);color:#e9d5ff;padding:1px 5px;border-radius:4px;">🏷️ ${p.designTag}</span>` : ''}
                  </div>
                  ${p.notes ? `<div style="font-size:10px;color:#cbd5e1;">💡 ${p.notes}</div>` : ''}
                  ${p.mechanicsTip ? `<div style="font-size:9.5px;color:#38bdf8;">⚙️ ${p.mechanicsTip}</div>` : ''}
                </div>
              `
                )
                .join('')}
            </div>`
      }
    </div>

    <div class="panel-card">
      <div class="card-title">
        <span>${t('jumpListTitle')} (${store.doc.jumps.length})</span>
      </div>
      ${
        store.doc.jumps.length === 0
          ? `<div style="color:var(--text-muted);font-size:11px;">Use the Jump Arc tool on the left to drag between any two platforms in 2D or 3D.</div>`
          : store.doc.jumps
              .map((j) => {
                const ev = evaluateJumpLink(j.from, j.to, store.doc.metricsProfile, store.doc.blocks);
                return `
                  <div class="issue-item ${ev.status === 'safe' ? 'info' : ev.status === 'stretch' ? '' : 'error'}">
                    <div style="display:flex;justify-content:space-between;font-weight:600;">
                      <span>${j.name}</span>
                      <button class="chip-toggle" data-del-jump="${j.id}">${t('delBtn')}</button>
                    </div>
                    <div style="font-size:10px;color:var(--text-muted);">${ev.statusLabel} — ${ev.reason}</div>
                  </div>
                `;
              })
              .join('')
      }
    </div>

    <div class="panel-card">
      <div class="card-title">
        <span>${t('auditIssuesTitle')} (${audit.issues.length})</span>
      </div>
      ${
        audit.issues.length === 0
          ? `<div style="color:#86efac;font-size:11px;">✓ All slopes, cover heights, and jump links pass current character metrics!</div>`
          : audit.issues
              .map(
                (iss) => `
              <div class="issue-item ${iss.severity}" data-focus-id="${iss.relatedIds[0] || ''}">
                <div style="font-weight:600;color:#f8fafc;">${iss.title}</div>
                <div style="font-size:10px;color:var(--text-muted);">${iss.detail}</div>
              </div>
            `
              )
              .join('')
      }
    </div>
  `;

  const expMdBtn = document.getElementById('btn-export-md-doc');
  if (expMdBtn) {
    expMdBtn.onclick = () => exportDesignDocMarkdown(store.doc);
  }

  container.querySelectorAll<HTMLButtonElement>('[data-del-jump]').forEach((btn) => {
    btn.onclick = (e) => {
      e.stopPropagation();
      store.dispatchAICommand({ action: 'delete_jump', id: btn.dataset.delJump! });
    };
  });

  container.querySelectorAll<HTMLElement>('[data-focus-id]').forEach((el) => {
    el.onclick = () => {
      const id = el.dataset.focusId;
      if (!id) return;
      if (store.doc.blocks.some((b) => b.id === id)) {
        store.setSelection({ kind: 'block', id });
        store.requestFrameSelected();
      } else if (store.doc.pois.some((p) => p.id === id)) {
        store.setSelection({ kind: 'poi', id });
        store.requestFrameSelected();
      }
    };
  });
}

function renderAITab(container: HTMLElement): void {
  const filteredRooms =
    activeRoomCategoryFilter === 'all'
      ? ROOM_TEMPLATES
      : ROOM_TEMPLATES.filter((r) => r.categoryId === activeRoomCategoryFilter);

  container.innerHTML = `
    <!-- Categorized Game Room Template Generator -->
    <div class="panel-card" style="border-color:rgba(56,189,248,0.5);">
      <div class="card-title">
        <span style="color:#38bdf8;">🏗️ 游戏品类常见房间模板库 (${ROOM_TEMPLATES.length}套)</span>
      </div>
      <div style="font-size:10px;color:var(--text-muted);line-height:1.4;">
        按游戏类型分类收录经典关卡拓扑结构（自带全套<b>物体设计思路备注</b>、<b>机关联动</b>与<b>2D/3D相机预设</b>），支持一键拼接到当前关卡或新建独立场景：
      </div>

      <div class="room-category-pills">
        <button class="room-cat-pill ${activeRoomCategoryFilter === 'all' ? 'active' : ''}" data-rcat="all">
          🌟 全部品类 (${ROOM_TEMPLATES.length})
        </button>
        ${ROOM_CATEGORIES.map(
          (cat) => `
          <button class="room-cat-pill ${activeRoomCategoryFilter === cat.id ? 'active' : ''}" data-rcat="${cat.id}" title="${cat.descZh}">
            ${cat.icon} ${cat.nameZh.split(' ')[0]}
          </button>
        `
        ).join('')}
      </div>

      <div style="display:flex;flex-direction:column;gap:7px;max-height:360px;overflow-y:auto;padding-right:2px;">
        ${filteredRooms
          .map((tpl) => {
            const dimLabel =
              tpl.dimensionMode === '2d_side'
                ? '🍄 2D横版'
                : tpl.dimensionMode === '2d_topdown'
                ? '🗡️ 2D俯视'
                : '🧊 3D空间';
            return `
              <div class="room-template-card">
                <div style="display:flex;justify-content:space-between;align-items:center;gap:4px;">
                  <span style="font-weight:700;font-size:11.5px;color:#f8fafc;">${tpl.icon} ${tpl.nameZh}</span>
                  <span style="font-size:9.5px;padding:1px 6px;border-radius:4px;background:rgba(56,189,248,0.18);color:#38bdf8;white-space:nowrap;">${dimLabel} · ${tpl.sizeLabel}</span>
                </div>
                <div style="font-size:10px;color:#94a3b8;">📐 空间结构: <b style="color:#cbd5e1;">${tpl.summaryZh}</b></div>
                <div style="font-size:10px;color:#cbd5e1;line-height:1.4;background:var(--bg-0);padding:5px 6px;border-radius:4px;border-left:2px solid var(--accent);">
                  💡 <b>设计原理</b>: ${tpl.designTheoryZh}
                </div>
                <div class="room-template-actions">
                  <button class="btn btn-primary" data-room-append="${tpl.id}" style="justify-content:center;font-size:10px;">
                    ➕ 拼接追加到当前关卡
                  </button>
                  <button class="btn" data-room-load="${tpl.id}" style="justify-content:center;font-size:10px;">
                    📂 设为独立新场景
                  </button>
                </div>
              </div>
            `;
          })
          .join('')}
      </div>
    </div>

    <!-- Expanded Procedural Macros -->
    <div class="panel-card">
      <div class="card-title"><span>⚡ AI Procedural Macros (快速程序化白盒宏)</span></div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:5px;">
        <button class="btn" id="macro-room">🏠 生成围合房间</button>
        <button class="btn" id="macro-cover">🛡️ 自动布置掩体群</button>
        <button class="btn" id="macro-mirror-x">🪞 左右对称镜像 (X)</button>
        <button class="btn" id="macro-mirror-z">🪞 前后对称镜像 (Z)</button>
        <button class="btn" id="macro-sniper">🎯 添加制高狙击点</button>
        <button class="btn" id="macro-stairs">🪜 生成二层登高阶梯</button>
      </div>
    </div>

    <div class="panel-card">
      <div class="card-title">
        <span>🤖 AI / JSON Action Console</span>
        <button class="btn btn-primary" id="btn-run-ai-cmd">▶ Execute</button>
      </div>
      <textarea id="ai-cmd-textarea" rows="6" spellcheck="false">${aiConsoleInput}</textarea>
      <div style="font-size:10px;color:#86efac;">Last: ${store.lastAILog}</div>
    </div>

    <div class="panel-card">
      <div class="card-title"><span>🔌 Claude Code & Codex CLI / MCP</span></div>
      <div class="code-snippet">npm run ai -- status
npm run ai -- add-block --name "二层连桥" --type box --role walkable --pos 0,3,-4 --size 8,0.5,3 --floor 1
npm run ai -- check-jump --from -8,3,-2 --to -4.5,3,-2
claude mcp add levelforge -- npx tsx server/mcp-server.ts</div>
    </div>
  `;

  container.querySelectorAll<HTMLButtonElement>('[data-rcat]').forEach((btn) => {
    btn.onclick = () => {
      activeRoomCategoryFilter = btn.dataset.rcat as RoomCategoryId | 'all';
      renderAITab(container);
    };
  });

  container.querySelectorAll<HTMLButtonElement>('[data-room-append]').forEach((btn) => {
    btn.onclick = () => {
      const tplId = btn.dataset.roomAppend!;
      store.pushUndoSnapshot();
      const res = appendRoomTemplateToDoc(store.doc, tplId);
      store.doc = res.doc;
      store.lastAILog = res.message;
      store.notify(true);
    };
  });

  container.querySelectorAll<HTMLButtonElement>('[data-room-load]').forEach((btn) => {
    btn.onclick = () => {
      const tplId = btn.dataset.roomLoad!;
      const doc = createSceneFromRoomTemplate(tplId);
      store.setDocument(doc, true, true);
      if (doc.metadata.dimensionMode) {
        store.setDimensionMode(doc.metadata.dimensionMode);
      }
    };
  });

  const ta = document.getElementById('ai-cmd-textarea') as HTMLTextAreaElement;
  ta.oninput = () => {
    aiConsoleInput = ta.value;
  };

  document.getElementById('btn-run-ai-cmd')!.onclick = () => {
    try {
      const parsed = JSON.parse(ta.value) as AICommandAction | AICommandAction[];
      (window as unknown as { LevelForgeAI: { execute: (c: unknown) => void } }).LevelForgeAI.execute(parsed);
    } catch (e) {
      alert(`JSON Error: ${(e as Error).message}`);
    }
  };

  document.getElementById('macro-room')!.onclick = () => {
    store.dispatchAICommand({
      action: 'generate_room',
      name: '北侧扩展厅',
      center: [0, 3, -18],
      size: [14, 4, 10],
      floor: 1,
      doorways: ['south'],
    });
  };

  document.getElementById('macro-cover')!.onclick = () => {
    store.dispatchAICommand({
      action: 'scatter_cover',
      boundsMin: [-8, 0, -4],
      boundsMax: [8, 0, 8],
      count: 4,
      floor: 0,
    });
  };

  document.getElementById('macro-mirror-x')!.onclick = () => {
    store.dispatchAICommand({
      action: 'mirror_blocks',
      axis: 'x',
      blockIds: store.selection?.kind === 'block' ? [store.selection.id] : undefined,
    });
  };

  document.getElementById('macro-mirror-z')!.onclick = () => {
    store.dispatchAICommand({
      action: 'mirror_blocks',
      axis: 'z',
      blockIds: store.selection?.kind === 'block' ? [store.selection.id] : undefined,
    });
  };

  document.getElementById('macro-sniper')!.onclick = () => {
    store.dispatchAICommand({
      action: 'add_poi',
      poi: {
        name: '高台巡逻狙击哨',
        category: 'sniper_nest',
        position: [-6, 3.0, -8],
        yaw: 165,
        showVision: true,
        fov: 80,
        visionRange: 22,
        designTag: '制高点压制位',
        notes: '提供高低差视界统治力，迫使玩家利用掩体或侧翼迂回推进。',
        enemyConfig: {
          patrolMode: 'pingpong',
          waypoints: [
            [-6, 3.0, -8],
            [6, 3.0, -8],
          ],
          autoPathfind: true,
          patrolSpeed: 2.5,
          chaseSpeed: 5.0,
          hearingRange: 7.0,
          targetId: 'poi_spawn_player',
        },
      },
    });
  };

  document.getElementById('macro-stairs')!.onclick = () => {
    store.dispatchAICommand({
      action: 'add_block',
      block: {
        name: '二层登高阶梯',
        type: 'stairs',
        role: 'walkable',
        position: [0, 1.5, 0],
        size: [3, 3.0, 6],
        rotation: [0, 0, 0],
        floor: 1,
        steps: 12,
        designTag: '高程引导阶梯',
        notes: '连接 1F 与 2F (+3.0m) 的标准 26.5° 舒适爬坡阶梯。',
      },
    });
  };
}

function closeThemeStudio(): void {
  if (!isThemeStudioOpen) return;
  const backdrop = document.getElementById('theme-studio-backdrop')!;
  const panel = document.getElementById('theme-studio-panel')!;
  isThemeStudioOpen = false;
  renderTopBar();
  animateOut(
    panel,
    [
      { opacity: 1, transform: 'translateY(0) scale(1)' },
      { opacity: 0, transform: 'translateY(-8px) scale(0.97)' },
    ],
    170,
    () => {}
  );
  animateOut(backdrop, [{ opacity: 1 }, { opacity: 0 }], 190, () => renderThemeStudio());
}

function renderThemeStudio(): void {
  const backdrop = document.getElementById('theme-studio-backdrop')!;
  const panel = document.getElementById('theme-studio-panel')!;
  backdrop.classList.toggle('open', isThemeStudioOpen);
  if (!isThemeStudioOpen) return;

  const th = getTheme();
  const lang = getLang();

  const presetCount = Object.keys(THEME_PRESETS).length;
  panel.innerHTML = `
    <div class="card-title" style="font-size:13px;cursor:default;">
      <span>🎨 界面主题模板与自定义颜色工作台</span>
      <button class="btn" id="btn-close-theme-studio">✕ 关闭</button>
    </div>

    <div class="dock-title">1. 常规界面颜色模板 (${presetCount}套工业级与设计师预设)</div>
    <div class="theme-preset-grid">
      ${Object.values(THEME_PRESETS)
        .map((p) => {
          const title = lang === 'en' ? p.nameEn : lang === 'ja' ? p.nameJa : p.nameZh;
          return `
            <div class="theme-preset-card ${th.id === p.id ? 'active' : ''}" data-preset-theme="${p.id}">
              <div style="font-weight:600;font-size:11px;color:var(--text-main);">${title}</div>
              <div class="theme-preview-bar">
                <span style="background:${p.bg0}"></span>
                <span style="background:${p.bg1}"></span>
                <span style="background:${p.bg2}"></span>
                <span style="background:${p.vp3dBg}"></span>
                <span style="background:${p.accent}"></span>
              </div>
            </div>
          `;
        })
        .join('')}
    </div>

    <div class="dock-title" style="margin-top:4px;">2. 自由定制界面与视口颜色 (实时生效)</div>
    <div class="color-grid-2col">
      <div class="color-item-row">
        <span>主背景色 (BG0)</span>
        <input type="color" class="color-picker-input" data-ui-col="bg0" value="${th.bg0}" />
      </div>
      <div class="color-item-row">
        <span>面板底色 (BG1)</span>
        <input type="color" class="color-picker-input" data-ui-col="bg1" value="${th.bg1}" />
      </div>
      <div class="color-item-row">
        <span>控件底色 (BG2)</span>
        <input type="color" class="color-picker-input" data-ui-col="bg2" value="${th.bg2}" />
      </div>
      <div class="color-item-row">
        <span>主题高亮色 (Accent)</span>
        <input type="color" class="color-picker-input" data-ui-col="accent" value="${th.accent}" />
      </div>
      <div class="color-item-row">
        <span>文字主色 (Text)</span>
        <input type="color" class="color-picker-input" data-ui-col="textMain" value="${th.textMain}" />
      </div>
      <div class="color-item-row">
        <span>边框线条色 (Border)</span>
        <input type="color" class="color-picker-input" data-ui-col="borderLight" value="${th.borderLight}" />
      </div>
      <div class="color-item-row">
        <span>3D 视口背景色</span>
        <input type="color" class="color-picker-input" data-ui-col="vp3dBg" value="${th.vp3dBg}" />
      </div>
      <div class="color-item-row">
        <span>2D 俯视/断面背景色</span>
        <input type="color" class="color-picker-input" data-ui-col="vp2dBg" value="${th.vp2dBg}" />
      </div>
    </div>

    <div class="dock-title" style="margin-top:4px;display:flex;justify-content:space-between;align-items:center;">
      <span>3. 全局白盒语义默认配色表 (Role Colors)</span>
      <button class="chip-toggle" id="btn-reset-role-colors">恢复默认语义色</button>
    </div>
    <div class="color-grid-2col">
      ${(Object.keys(ROLE_META) as BlockRole[])
        .map((roleKey) => {
          const meta = ROLE_META[roleKey];
          return `
            <div class="color-item-row">
              <span>${meta.label.split(' ')[0]}</span>
              <input type="color" class="color-picker-input" data-role-col="${roleKey}" value="${meta.color}" />
            </div>
          `;
        })
        .join('')}
    </div>
  `;

  document.getElementById('btn-close-theme-studio')!.onclick = () => closeThemeStudio();

  backdrop.onclick = (e) => {
    if (e.target === backdrop) closeThemeStudio();
  };

  panel.querySelectorAll<HTMLElement>('[data-preset-theme]').forEach((card) => {
    card.onclick = () => {
      withThemeTransition(() => {
        selectPresetTheme(card.dataset.presetTheme!);
        renderAllUI();
        renderThemeStudio();
      });
    };
  });

  panel.querySelectorAll<HTMLInputElement>('[data-ui-col]').forEach((inp) => {
    inp.oninput = () => {
      const key = inp.dataset.uiCol as keyof typeof th;
      (th[key] as string) = inp.value;
      th.id = 'custom';
      applyThemeToDOM(th);
      vp3D.rebuildSceneFromStore();
      vpTop.render();
      vpSec.render();
    };
  });

  panel.querySelectorAll<HTMLInputElement>('[data-role-col]').forEach((inp) => {
    inp.oninput = () => {
      const roleKey = inp.dataset.roleCol as BlockRole;
      if (!th.roleColors) th.roleColors = {};
      th.roleColors[roleKey] = inp.value;
      applyThemeToDOM(th);
      renderLeftDock();
      renderSidebar();
      vp3D.rebuildSceneFromStore();
      vpTop.render();
      vpSec.render();
    };
  });

  document.getElementById('btn-reset-role-colors')!.onclick = () => {
    resetDefaultRoleColors();
    renderAllUI();
    renderThemeStudio();
  };
}

function updateStatusBar(): void {
  const gridEl = document.getElementById('viewports-grid')!;
  gridEl.className = `viewports-grid layout-${store.layout}`;

  const statusLeft = document.getElementById('status-left')!;
  statusLeft.textContent = `${store.lastAILog} | Blocks: ${store.doc.blocks.length} | Sightlines: ${(store.doc.sightlines || []).length} | Section A-A': (${store.doc.sectionPlane.start.join(',')}) → (${store.doc.sectionPlane.end.join(',')})`;
}

function renderAllUI(): void {
  renderTopBar();
  renderLeftDock();
  renderOverlayBar();
  renderFloatingNoteCard();
  renderSidebarTabs();
  renderSidebar();
  renderThemeStudio();
  updateStatusBar();
  vp3D.rebuildSceneFromStore();
  vpTop.render();
  vpSec.render();
}

const fileInput = document.getElementById('file-import-input') as HTMLInputElement;
fileInput.onchange = () => {
  const file = fileInput.files?.[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const parsed = JSON.parse(String(reader.result));
      if (parsed && Array.isArray(parsed.blocks)) {
        store.setDocument(parsed, true, true);
      }
    } catch (err) {
      alert(`JSON parse error: ${(err as Error).message}`);
    }
  };
  reader.readAsText(file);
};

document.getElementById('btn-pip3d')!.onclick = () => {
  vp3D.showPlayerPiP = !vp3D.showPlayerPiP;
  renderTopBar();
};

document.getElementById('btn-clip3d')!.onclick = () => {
  store.doc.sectionPlane.clip3D = !store.doc.sectionPlane.clip3D;
  store.notify(true);
};

document.getElementById('btn-flip-sec')!.onclick = () => {
  store.doc.sectionPlane.flipNormal = !store.doc.sectionPlane.flipNormal;
  store.notify(true);
};

document.getElementById('btn-reset-3d')!.onclick = () => vp3D.resetCamera();
document.getElementById('btn-reset-top')!.onclick = () => vpTop.resetCamera();
document.getElementById('btn-reset-sec')!.onclick = () => vpSec.resetCamera();

window.addEventListener('keydown', (e) => {
  const tag = document.activeElement?.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;

  if (e.key === 'Tab') {
    e.preventDefault();
    if (store.isPlaytesting) vp3D.stopPlaytest();
    else vp3D.startPlaytest();
    return;
  }

  // Do not trigger Q/W/E/R tool switches while RMB Flythrough or Playtest is active!
  if (store.isPlaytesting || vp3D.isRMBFlying) return;

  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
    e.preventDefault();
    store.undo();
  } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') {
    e.preventDefault();
    store.redo();
  } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'd') {
    e.preventDefault();
    store.duplicateSelectedBlock();
  } else if (e.key === 'Delete' || e.key === 'Backspace') {
    store.deleteSelected();
  } else if (e.key.toLowerCase() === 'f') {
    e.preventDefault();
    store.requestFrameSelected();
  } else if (e.key.toLowerCase() === 'q' || e.key.toLowerCase() === 'v') {
    store.activeTool = 'select';
    store.notify(false);
  } else if (e.key.toLowerCase() === 'b') {
    store.activeTool = 'draw_box';
    store.notify(false);
  } else if (e.key.toLowerCase() === 'w') {
    store.transformMode = 'translate';
    store.activeTool = 'select';
    store.notify(false);
  } else if (e.key.toLowerCase() === 'e') {
    store.transformMode = 'rotate';
    store.activeTool = 'select';
    store.notify(false);
  } else if (e.key.toLowerCase() === 'r') {
    store.transformMode = 'scale';
    store.activeTool = 'select';
    store.notify(false);
  }
});

/**
 * store 通知 → 界面重绘。拖拽 Gizmo / 数值时一帧内会连续通知很多次，这里合并成每帧最多重绘一次
 * （页面在后台时 rAF 不触发，用定时器兜底）。
 */
let uiRenderQueued = false;
let uiRenderFallbackTimer: number | undefined;

function flushUIRender(): void {
  if (!uiRenderQueued) return;
  uiRenderQueued = false;
  window.clearTimeout(uiRenderFallbackTimer);
  renderTopBar();
  if (!isScrubbingNumber) {
    renderLeftDock();
    renderSidebar();
  }
  renderOverlayBar();
  renderFloatingNoteCard();
  renderSidebarTabs();
  updateStatusBar();
}

store.subscribe(() => {
  if (uiRenderQueued) return;
  uiRenderQueued = true;
  requestAnimationFrame(flushUIRender);
  uiRenderFallbackTimer = window.setTimeout(flushUIRender, 120);
});

renderAllUI();
