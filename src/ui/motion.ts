/**
 * Level Builder UI Motion Layer
 * --------------------------------------------------------------
 * 轻量级界面动效工具：折叠/展开高度动画、面板淡入淡出、按钮点击涟漪、
 * 主题切换颜色过渡、Tab 内容切换过渡。全部基于 Web Animations API，
 * 自动尊重系统 `prefers-reduced-motion` 设置。
 */

export const EASE_OUT = 'cubic-bezier(0.22, 1, 0.36, 1)';
export const EASE_IN_OUT = 'cubic-bezier(0.65, 0, 0.35, 1)';

export function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
}

/**
 * 以高度 + 透明度动画折叠/展开一个容器（.panel-card / .dock-section）。
 * `collapsed` class 会在折叠动画结束后才添加，展开时立即移除后再播放动画。
 */
export function animateCollapse(container: HTMLElement, bodySelector: string, collapse: boolean): void {
  const body = container.querySelector<HTMLElement>(bodySelector);
  const running = (container as HTMLElement & { __collapseAnim?: Animation }).__collapseAnim;
  if (running) running.cancel();

  if (!body || prefersReducedMotion()) {
    container.classList.toggle('collapsed', collapse);
    return;
  }

  if (collapse) {
    const h = body.offsetHeight;
    const anim = body.animate(
      [
        { height: `${h}px`, opacity: 1, paddingTop: getComputedStyle(body).paddingTop, paddingBottom: getComputedStyle(body).paddingBottom },
        { height: '0px', opacity: 0, paddingTop: '0px', paddingBottom: '0px' },
      ],
      { duration: 200, easing: EASE_IN_OUT, fill: 'forwards' }
    );
    body.style.overflow = 'hidden';
    (container as HTMLElement & { __collapseAnim?: Animation }).__collapseAnim = anim;
    anim.onfinish = () => {
      container.classList.add('collapsed');
      anim.cancel();
    };
    anim.oncancel = () => {
      body.style.overflow = '';
    };
  } else {
    container.classList.remove('collapsed');
    const cs = getComputedStyle(body);
    const h = body.offsetHeight;
    body.style.overflow = 'hidden';
    const anim = body.animate(
      [
        { height: '0px', opacity: 0, paddingTop: '0px', paddingBottom: '0px', transform: 'translateY(-4px)' },
        { height: `${h}px`, opacity: 1, paddingTop: cs.paddingTop, paddingBottom: cs.paddingBottom, transform: 'translateY(0)' },
      ],
      { duration: 240, easing: EASE_OUT }
    );
    (container as HTMLElement & { __collapseAnim?: Animation }).__collapseAnim = anim;
    const clear = () => {
      body.style.overflow = '';
    };
    anim.onfinish = clear;
    anim.oncancel = clear;
  }
}

/** 给一个容器的直接子元素做错落淡入（用于 Tab 切换后的新内容）。 */
export function staggerIn(container: HTMLElement, childSelector = ':scope > *', maxItems = 6): void {
  if (prefersReducedMotion()) return;
  const items = Array.from(container.querySelectorAll<HTMLElement>(childSelector)).slice(0, maxItems);
  items.forEach((el, i) => {
    el.animate(
      [
        { opacity: 0, transform: 'translateY(6px)' },
        { opacity: 1, transform: 'translateY(0)' },
      ],
      // 页签切换是高频操作：整体控制在 ~250ms 内完成，不让人等动画
      { duration: 180, delay: i * 14, easing: EASE_OUT, fill: 'backwards' }
    );
  });
}

/** 播放退出动画后执行回调（用于关闭弹窗等）。 */
export function animateOut(el: HTMLElement, keyframes: Keyframe[], duration: number, done: () => void): void {
  if (prefersReducedMotion()) {
    done();
    return;
  }
  const anim = el.animate(keyframes, { duration, easing: EASE_IN_OUT, fill: 'forwards' });
  anim.onfinish = () => {
    done();
    anim.cancel();
  };
}

/** 主题切换时短暂开启全局颜色过渡，让配色平滑渐变而非瞬间跳变。 */
export function withThemeTransition(apply: () => void): void {
  if (prefersReducedMotion()) {
    apply();
    return;
  }
  const root = document.documentElement;
  root.classList.add('theme-transitioning');
  apply();
  window.setTimeout(() => root.classList.remove('theme-transitioning'), 420);
}

/** 在一段时间内每帧调用回调（例如侧栏宽度过渡时持续重设视口画布尺寸）。 */
export function runEveryFrameFor(ms: number, cb: () => void): void {
  const start = performance.now();
  const tick = (now: number) => {
    cb();
    if (now - start < ms) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

/** 安装全局按钮点击涟漪效果（事件委托，一次安装即可覆盖动态渲染的按钮）。 */
export function installRippleEffect(): void {
  const SELECTOR =
    // 只给"主操作"保留涟漪；折叠标题、图层开关这类高频小控件靠颜色过渡反馈就够了
    '.btn-primary, .btn-playtest, .btn-sim-patrol, .theme-preset-card';
  document.addEventListener(
    'pointerdown',
    (e) => {
      if (prefersReducedMotion() || e.button !== 0) return;
      const target = (e.target as HTMLElement | null)?.closest<HTMLElement>(SELECTOR);
      if (!target || target.matches(':disabled')) return;
      const rect = target.getBoundingClientRect();
      const size = Math.max(rect.width, rect.height) * 2.2;
      const ripple = document.createElement('span');
      ripple.className = 'ui-ripple';
      ripple.style.width = ripple.style.height = `${size}px`;
      ripple.style.left = `${e.clientX - rect.left - size / 2}px`;
      ripple.style.top = `${e.clientY - rect.top - size / 2}px`;
      if (getComputedStyle(target).position === 'static') target.classList.add('ui-ripple-host');
      target.appendChild(ripple);
      const anim = ripple.animate(
        [
          { transform: 'scale(0)', opacity: 0.35 },
          { transform: 'scale(1)', opacity: 0 },
        ],
        { duration: 520, easing: EASE_OUT }
      );
      anim.onfinish = () => ripple.remove();
    },
    { passive: true }
  );
}
