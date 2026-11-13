/**
 * Level Builder UI Panel Layout Persistence
 * --------------------------------------------------------------
 * 记住面板布局（侧栏宽度 / 视口分割比例 / 侧栏与卡片折叠状态 / 当前页签），
 * 刷新页面后恢复到上次的工作区排布。存储在 localStorage，读写失败时静默降级。
 */

const STORAGE_KEY = 'levelforge_ui_panels_v1';
const MAX_COLLAPSED_KEYS = 200;

export interface PanelLayoutState {
  leftDockW?: number;
  rightSidebarW?: number;
  vpSplitX?: number;
  vpSplitY?: number;
  leftCollapsed?: boolean;
  rightCollapsed?: boolean;
  activeTab?: string;
  collapsedCards?: string[];
  collapsedDockSections?: string[];
  /** 当前工作区模式：build（搭建）/ analyze（分析） */
  workspaceMode?: string;
  /** 每个工作区模式各自记住的视口布局 */
  modeLayouts?: Record<string, string>;
}

export const PANEL_DEFAULTS = {
  leftDockW: 215,
  rightSidebarW: 335,
  vpSplitX: 54,
  vpSplitY: 50,
} as const;

let cache: PanelLayoutState | null = null;
let writeTimer: number | undefined;

export function loadPanelState(): PanelLayoutState {
  if (cache) return cache;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    cache = parsed && typeof parsed === 'object' ? (parsed as PanelLayoutState) : {};
  } catch {
    cache = {};
  }
  return cache;
}

export function savePanelState(patch: PanelLayoutState): void {
  const next = { ...loadPanelState(), ...patch };
  if (next.collapsedCards && next.collapsedCards.length > MAX_COLLAPSED_KEYS) {
    next.collapsedCards = next.collapsedCards.slice(-MAX_COLLAPSED_KEYS);
  }
  cache = next;
  window.clearTimeout(writeTimer);
  writeTimer = window.setTimeout(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(cache));
    } catch {
      /* 存储不可用（隐私模式 / 配额已满）时忽略 */
    }
  }, 150);
}

export function finiteInRange(v: unknown, min: number, max: number): number | null {
  return typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max ? v : null;
}
