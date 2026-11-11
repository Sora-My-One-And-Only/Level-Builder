/**
 * Level Builder UI — 轻量 DOM 差量更新 (morph)
 * --------------------------------------------------------------
 * 面板仍然用模板字符串描述"应该长什么样"，但不再用 innerHTML 整块替换，
 * 而是把现有 DOM 就地修补成目标结构：没变的节点原样保留。这样
 *   · 按下和抬起之间按钮不会被换掉（点击不再丢失）；
 *   · 正在输入的输入框、打开的下拉框、滚动位置都不受影响；
 *   · class 变化发生在同一个元素上，CSS 过渡才真正播得出来。
 *
 * 匹配规则：带 key 的元素（id / data-card-key / data-sel-id / data-key）只和同 key 的兄弟元素
 * 配对，可跨位置移动——中间插入或删除一张卡片、一行列表时，其余的不受牵连；不带 key 的按
 * 位置、标签名（input 还要同 type）配对；配不上的直接换成新节点。
 */

function keyOf(el: Element): string {
  return (
    el.id ||
    el.getAttribute('data-card-key') ||
    el.getAttribute('data-sel-id') ||
    el.getAttribute('data-key') ||
    ''
  );
}

/** 面板代码用属性方式绑定事件；保留下来的元素在重新绑定前先清掉旧处理器，避免残留过期闭包 */
const HANDLER_PROPS = ['onclick', 'onchange', 'oninput', 'ondblclick', 'onmousedown', 'onkeydown'] as const;

function isCompatible(oldNode: Node, newNode: Node): boolean {
  if (oldNode.nodeType !== newNode.nodeType) return false;
  if (oldNode.nodeType !== Node.ELEMENT_NODE) return true;
  const a = oldNode as Element;
  const b = newNode as Element;
  if (a.tagName !== b.tagName) return false;
  const ka = keyOf(a);
  const kb = keyOf(b);
  if (ka || kb) return ka === kb;
  if (a.tagName === 'INPUT' && a.getAttribute('type') !== b.getAttribute('type')) return false;
  return true;
}

function findMatch(firstCandidate: Node | null, newNode: Node): Node | null {
  if (!firstCandidate) return null;
  const key = newNode.nodeType === Node.ELEMENT_NODE ? keyOf(newNode as Element) : '';
  if (key) {
    for (let n: Node | null = firstCandidate; n; n = n.nextSibling) {
      if (n.nodeType === Node.ELEMENT_NODE && keyOf(n as Element) === key && isCompatible(n, newNode)) return n;
    }
    return null;
  }
  return isCompatible(firstCandidate, newNode) ? firstCandidate : null;
}

function syncAttributes(live: Element, next: Element): void {
  for (const attr of Array.from(live.attributes)) {
    if (!next.hasAttribute(attr.name)) live.removeAttribute(attr.name);
  }
  for (const attr of Array.from(next.attributes)) {
    if (live.getAttribute(attr.name) !== attr.value) live.setAttribute(attr.name, attr.value);
  }
}

function morphNode(live: Node, next: Node): void {
  if (live.nodeType !== Node.ELEMENT_NODE) {
    if (live.nodeValue !== next.nodeValue) live.nodeValue = next.nodeValue;
    return;
  }
  const liveEl = live as HTMLElement;
  const nextEl = next as HTMLElement;
  if (liveEl.isEqualNode(nextEl)) return;
  for (const prop of HANDLER_PROPS) {
    if (liveEl[prop]) liveEl[prop] = null;
  }
  syncAttributes(liveEl, nextEl);
  morphChildren(liveEl, nextEl);
}

/** 把 `live` 的子节点修补成与 `next` 的子节点一致。`next` 是一次性的游离树，其节点可能被直接搬进 `live`。 */
export function morphChildren(live: Element, next: Element): void {
  let oldNode: Node | null = live.firstChild;
  let newNode: Node | null = next.firstChild;
  while (newNode) {
    const following: Node | null = newNode.nextSibling;
    const match = findMatch(oldNode, newNode);
    if (match) {
      if (match === oldNode) oldNode = oldNode.nextSibling;
      else live.insertBefore(match, oldNode);
      morphNode(match, newNode);
    } else {
      live.insertBefore(newNode, oldNode);
    }
    newNode = following;
  }
  while (oldNode) {
    const following: Node | null = oldNode.nextSibling;
    live.removeChild(oldNode);
    oldNode = following;
  }
}

/**
 * 属性只描述"默认值"，表单控件真正显示的是它的 property。修补完属性后把未聚焦控件的
 * 显示值拉回到模板给出的值（等价于以前整块重绘的效果）；正在输入的控件不动。
 */
export function syncFormState(root: Element): void {
  const active = document.activeElement;
  root.querySelectorAll<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>('input, textarea, select').forEach((el) => {
    if (el instanceof HTMLInputElement) {
      if (el.type === 'checkbox' || el.type === 'radio') {
        if (el.checked !== el.defaultChecked) el.checked = el.defaultChecked;
      } else if (el.type !== 'file' && el !== active && el.value !== el.defaultValue) {
        el.value = el.defaultValue;
      }
    } else if (el instanceof HTMLTextAreaElement) {
      if (el !== active && el.value !== el.defaultValue) el.value = el.defaultValue;
    } else if (el !== active) {
      let idx = Array.from(el.options).findIndex((o) => o.defaultSelected);
      if (idx < 0) idx = el.options.length > 0 ? 0 : -1;
      if (el.selectedIndex !== idx) el.selectedIndex = idx;
    }
  });
}

/**
 * `patchTarget(el, prepare).html = \`...\`` —— 与 `el.innerHTML = \`...\`` 写法对应的差量版本。
 * `prepare` 在游离树上先做结构性增强（包一层、加把手等），保证比较的是最终结构。
 */
export function patchTarget(container: HTMLElement, prepare?: (root: HTMLElement) => void): { html: string } {
  return {
    set html(value: string) {
      const next = container.cloneNode(false) as HTMLElement;
      next.innerHTML = value;
      prepare?.(next);
      morphChildren(container, next);
      syncFormState(container);
    },
    get html() {
      return container.innerHTML;
    },
  };
}
