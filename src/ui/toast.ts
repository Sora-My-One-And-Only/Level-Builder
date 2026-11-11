/**
 * Level Builder UI — 轻量提示条 (toast)
 * --------------------------------------------------------------
 * 操作结果的即时反馈：出现在视口底部中央，几秒后自动消失，可带一个动作按钮（如"撤销"）。
 * 状态栏那一行字仍然保留，但不再是唯一的反馈通道。
 */
import { prefersReducedMotion } from './motion';

export type ToastKind = 'info' | 'success' | 'warning' | 'error';

export interface ToastOptions {
  kind?: ToastKind;
  /** 自动消失前的停留时间（毫秒）；带动作按钮或错误提示时默认更长 */
  duration?: number;
  actionLabel?: string;
  onAction?: () => void;
}

const MAX_VISIBLE = 3;
const ICONS: Record<ToastKind, string> = { info: 'ℹ', success: '✓', warning: '!', error: '✕' };

let host: HTMLDivElement | null = null;

function getHost(): HTMLDivElement {
  if (!host) {
    host = document.createElement('div');
    host.className = 'toast-host';
    host.setAttribute('role', 'status');
    host.setAttribute('aria-live', 'polite');
    document.body.appendChild(host);
  }
  return host;
}

function dismiss(el: HTMLElement): void {
  if (el.dataset.leaving) return;
  el.dataset.leaving = '1';
  const remove = () => el.remove();
  if (prefersReducedMotion()) {
    remove();
    return;
  }
  const anim = el.animate(
    [
      { opacity: 1, transform: 'translateY(0) scale(1)' },
      { opacity: 0, transform: 'translateY(6px) scale(0.98)' },
    ],
    { duration: 160, easing: 'ease-in', fill: 'forwards' }
  );
  anim.onfinish = remove;
  anim.oncancel = remove;
}

export function showToast(message: string, options: ToastOptions = {}): void {
  const kind = options.kind ?? 'info';
  const container = getHost();

  // 连续相同的提示只保留最新一条
  for (const old of Array.from(container.children) as HTMLElement[]) {
    if (old.dataset.message === message) dismiss(old);
  }
  const live = (Array.from(container.children) as HTMLElement[]).filter((c) => !c.dataset.leaving);
  for (const extra of live.slice(0, Math.max(0, live.length - (MAX_VISIBLE - 1)))) dismiss(extra);

  const el = document.createElement('div');
  el.className = `toast toast-${kind}`;
  el.dataset.message = message;

  const icon = document.createElement('span');
  icon.className = 'toast-icon';
  icon.textContent = ICONS[kind];
  el.appendChild(icon);

  const text = document.createElement('span');
  text.className = 'toast-text';
  text.textContent = message;
  el.appendChild(text);

  if (options.actionLabel && options.onAction) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'toast-action';
    btn.textContent = options.actionLabel;
    btn.onclick = () => {
      options.onAction?.();
      dismiss(el);
    };
    el.appendChild(btn);
  }

  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'toast-close';
  close.title = '关闭';
  close.textContent = '×';
  close.onclick = () => dismiss(el);
  el.appendChild(close);

  container.appendChild(el);

  const duration = options.duration ?? (options.actionLabel || kind === 'error' ? 6000 : 3200);
  let timer = window.setTimeout(() => dismiss(el), duration);
  // 鼠标停在提示上时不消失，方便点"撤销"
  el.addEventListener('mouseenter', () => window.clearTimeout(timer));
  el.addEventListener('mouseleave', () => {
    timer = window.setTimeout(() => dismiss(el), 1500);
  });
}
