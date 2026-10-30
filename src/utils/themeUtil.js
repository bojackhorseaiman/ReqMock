/**
 * 主题系统：明暗模式 + 强调色
 * 通过 documentElement 的 data-theme / data-accent 属性驱动 CSS 变量
 */
import { normalizePresets } from './headerPresets.js';
import { normalizeParamPresets } from './paramPresets.js';

/* 预置主题仅保留明暗模式三项（其余主题选项已移除，旧值由 normalizeSettings 归一为 dark）；
   system 不绑定具体配色，由系统偏好解析成 dark / light（见 resolveTheme） */
export const THEMES = [
  { value: 'light', label: 'Light', dark: false },
  { value: 'dark', label: 'Dark', dark: true },
  { value: 'system', label: 'System', dark: null }
];

/** 系统是否偏好深色；环境不支持 matchMedia 时按深色处理（本产品的默认观感） */
export function systemPrefersDark() {
  if (typeof window === 'undefined' || !window.matchMedia) return true;
  return window.matchMedia('(prefers-color-scheme: dark)').matches;
}

/** 把设置里的主题值解析成实际生效的 data-theme（system → dark / light） */
export function resolveTheme(theme) {
  return theme === 'system' ? (systemPrefersDark() ? 'dark' : 'light') : theme;
}

/** 订阅系统明暗变化；返回取消订阅函数。仅在「跟随系统」下需要 */
export function watchSystemTheme(onChange) {
  if (typeof window === 'undefined' || !window.matchMedia) return () => {};
  const mq = window.matchMedia('(prefers-color-scheme: dark)');
  const handler = () => onChange();
  if (mq.addEventListener) mq.addEventListener('change', handler);
  else mq.addListener(handler); // Safari < 14 兜底
  return () => {
    if (mq.removeEventListener) mq.removeEventListener('change', handler);
    else mq.removeListener(handler);
  };
}

export const ACCENTS = [
  { value: 'blue', label: '蓝', color: '#4a8cf7' },
  { value: 'green', label: '绿', color: '#4caf7d' },
  { value: 'purple', label: '紫', color: '#a06fd6' },
  { value: 'orange', label: '橙', color: '#e0a04f' },
  { value: 'red', label: '红', color: '#e05f5f' },
  { value: 'cyan', label: '青', color: '#3fb6b2' }
];

export const LAYOUTS = [
  { value: 'vertical', label: '上下分栏' },
  { value: 'horizontal', label: '左右分栏' }
];

/** 工作模式：classic = 经典（每条请求一条记录）；endpoint = 聚合（同 method+path 归一条，域名/参数为变体） */
export const WORK_MODES = [
  { value: 'classic', label: '经典' },
  { value: 'endpoint', label: '聚合' }
];

/** 数值型设置项归一：非法值回退默认，并限制在合法区间内 */
function clampNum(value, min, max, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

export function normalizeSettings(s) {
  const settings = s || {};
  return {
    theme: THEMES.some((t) => t.value === settings.theme) ? settings.theme : 'dark',
    accent: ACCENTS.some((a) => a.value === settings.accent) ? settings.accent : 'blue',
    layout: LAYOUTS.some((l) => l.value === settings.layout) ? settings.layout : 'vertical',
    workMode: WORK_MODES.some((m) => m.value === settings.workMode) ? settings.workMode : 'classic',
    cookiesEnabled: settings.cookiesEnabled !== false,
    // 编辑器
    fontSize: clampNum(settings.fontSize, 12, 20, 14),
    tabSize: [2, 4, 8].includes(settings.tabSize) ? settings.tabSize : 2,
    wordWrap: settings.wordWrap === true,
    lineNumbers: settings.lineNumbers !== false,
    // 网络
    timeout: clampNum(settings.timeout, 5, 300, 30),
    maxRedirects: clampNum(settings.maxRedirects, 0, 20, 5),
    sslVerify: settings.sslVerify !== false,
    // 数据
    historyLimit: clampNum(settings.historyLimit, 50, 1000, 200),
    // 视图 & 交互
    zenMode: settings.zenMode === true,
    trayMode: settings.trayMode === true,
    jsonExplorer: settings.jsonExplorer === true,
    zoomLevel: [75, 100, 125, 150].includes(settings.zoomLevel) ? settings.zoomLevel : 100,
    proxy: typeof settings.proxy === 'string' ? settings.proxy : '',
    // 可拖拽布局：侧栏宽度 / 请求响应分栏比例
    sidebarWidth: clampNum(settings.sidebarWidth, 200, 420, 264),
    splitV: clampNum(settings.splitV, 25, 75, 45),
    splitH: clampNum(settings.splitH, 25, 75, 50),
    // HTTP 请求头预设（内置 + 自定义，随设置持久化）
    headerPresets: normalizePresets(settings.headerPresets),
    // URL 参数预设（内置 + 自定义，随设置持久化）
    paramPresets: normalizeParamPresets(settings.paramPresets)
  };
}

/** 把主题设置应用到文档根元素（theme=system 时按系统偏好解析为 dark / light） */
export function applyTheme(settings) {
  const { theme, accent } = normalizeSettings(settings);
  // 临时启用过渡动画，主题切换完成后移除
  document.documentElement.classList.add('theme-transitioning');
  document.documentElement.dataset.theme = resolveTheme(theme);
  document.documentElement.dataset.accent = accent;
  setTimeout(() => {
    document.documentElement.classList.remove('theme-transitioning');
  }, 300);
}
