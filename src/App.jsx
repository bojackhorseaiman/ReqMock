import React, { useState, useEffect, useRef, useCallback } from 'react';

import { motion, AnimatePresence, MotionConfig, useAnimate } from 'framer-motion';

import { toastSlide, popoverRise } from './utils/motionPresets.js';

import Sidebar from './components/Sidebar.jsx';

import TabBar from './components/TabBar.jsx';

import RequestEditor, { RequestBar } from './components/RequestEditor.jsx';

import ResponsePanel from './components/ResponsePanel.jsx';

import MockPanel from './components/MockPanel.jsx';

import CookiePanel from './components/CookiePanel.jsx';

import WsPanel from './components/WsPanel.jsx';

import SsePanel from './components/SsePanel.jsx';

import ToolsPanel, { TOOLS } from './components/ToolsPanel.jsx';

import RunnerPanel from './components/RunnerPanel.jsx';

import CommandPalette from './components/CommandPalette.jsx';

import GlobalSearch from './components/GlobalSearch.jsx';

import TopBar from './components/TopBar.jsx';

import { JbIcon } from './components/Icons.jsx';

import UtilBar from './components/UtilBar.jsx';

import ConsolePanel from './components/ConsolePanel.jsx';

import WelcomePage from './components/WelcomePage.jsx';

import { normalizeOpenedRequest } from './utils/urlSync.js';

import { executeRequest } from './utils/requestPipeline.js';

import EnvironmentPanel from './components/EnvironmentPanel.jsx';

import {

  SaveRequestModal, CollectionSettingsModal, CurlImportModal,

  CodegenModal, ExportCollectionModal, PromptModal, ConfirmModal, AboutModal

} from './components/Modals.jsx';

import SettingsPage from './components/SettingsPage.jsx';

import {

  newCollection, newFolder, normalizeNode, normalizeRequest,

  updateNode, removeNode, findNode, findOwnerCollection,

  upsertRequestById, removeRequestById, findRequestPath, findRequestById, moveRequest,
  findRequestAncestorIds,

  exportCollection, exportWorkspace, exportEnvironment, exportEnvironments, parseImport, nameFromUrl

} from './utils/collectionUtil.js';

import { historyMatches, findVariantGroup, variantLabel } from './utils/endpointUtil.js';

import { newEnvironment, buildVarMap, resolveRequest, mergeVariables } from './utils/envUtil.js';

import { applyAutoGroups, pickGroupColor, reorderTabsByGroup } from './utils/tabGroupUtil.js';

import { applyAuth } from './utils/authUtil.js';

import { toCurl, parseCurl } from './utils/curlUtil.js';

import { upsertCookies, pruneCookies } from './utils/cookieUtil.js';

import { normalizeSettings, applyTheme, watchSystemTheme } from './utils/themeUtil.js';

import { initA11yClicks } from './utils/a11yClicks.js';

import { describeError } from './utils/errorExplain.js';

import { exportPostmanCollection, exportMarkdownDocs } from './utils/exportUtil.js';

import { buildSampleWorkspace } from './utils/sampleData.js';



function uuid() {

  return crypto.randomUUID();

}



export function newRequest() {

  return normalizeRequest({ id: uuid() });

}



/** 请求显示名：优先用 name，否则从 URL 提取最后路径段 */

export function reqDisplayName(req) {
  return (req.name && req.name !== '未命名请求') ? req.name : nameFromUrl(req.url);
}



/** 新建一个请求标签页（每个标签独立持有请求/响应/脚本结果/发送状态） */

function createTab(request) {

  return { id: uuid(), kind: 'request', request, response: null, scriptResult: null, sending: false };

}



/** 判断是否为未编辑过的空白请求，打开请求时可直接复用该标签 */

function isBlankRequest(req) {

  return !req.url && req.bodyType === 'none' && !req.body &&

    (req.params || []).length === 0 && (req.headers || []).length === 0 &&

    !req.name;

}



/** 状态栏响应体积展示 */

function formatKb(bytes) {

  if (bytes == null) return '';

  if (bytes < 1024) return bytes + ' B';

  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';

  return (bytes / 1024 / 1024).toFixed(2) + ' MB';

}



function newMockRoute() {

  return {

    id: uuid(),

    name: '新建路由',

    method: 'GET',

    path: '/api/example',

    status: 200,

    headers: [],

    body: '{\n  "message": "hello from mock"\n}',

    delayMs: 0,

    enabled: true,

    rules: [],

    responseMode: 'template',

    script: ''

  };

}



const DEFAULT_STATE = {

  collections: [newCollection('默认集合')],

  environments: [],

  activeEnvId: null,

  history: [],

  mock: { port: 3600, routes: [] }

};



/** 状态栏 ⌨ 快捷键速查表 */

const SHORTCUTS = [

  ['发送请求', 'Shift+F10'],

  ['全局搜索 / 命令', 'Ctrl+Shift+A'],

  ['保存请求', 'Ctrl+S'],

  ['新建请求标签', 'Ctrl+T'],

  ['关闭标签', 'Ctrl+F4'],

  ['复制当前请求标签', 'Ctrl+D'],

  ['切换到左侧标签', 'Alt+Left'],

  ['切换到右侧标签', 'Alt+Right'],

  ['循环切换环境', 'Ctrl+E'],

  ['新建窗口', 'Ctrl+Shift+N'],

  ['切换侧边栏', 'Alt+1'],

  ['搜索文件/请求', 'Ctrl+Shift+F'],

  ['注释行', 'Ctrl+/'],

  ['格式化代码', 'Ctrl+Alt+L'],

  ['快捷键速查', 'F1'],
  ['切换导航面板', 'F2–F7'],

  ['跳转到行', 'Ctrl+G'],

  ['最近文件', 'Ctrl+E']

];



export default function App() {

  const [loaded, setLoaded] = useState(false);

  const [collections, setCollections] = useState(DEFAULT_STATE.collections);

  const [environments, setEnvironments] = useState(DEFAULT_STATE.environments);

  const [activeEnvId, setActiveEnvId] = useState(DEFAULT_STATE.activeEnvId);

  const [history, setHistory] = useState(DEFAULT_STATE.history);

  const [mock, setMock] = useState(DEFAULT_STATE.mock);

  const [cookieJar, setCookieJar] = useState([]);

  const [globals, setGlobals] = useState([]); // 全局变量（所有环境生效）

  const [settings, setSettings] = useState(() => normalizeSettings(null));



  const [activity, setActivity] = useState('collections'); // 活动栏当前项

  const [panelOpen, setPanelOpen] = useState(true); // 导航面板展开状态

  // 「在集合中定位当前请求」信号：tick 递增一次即触发一次定位（同一请求连点两次也要生效）
  const [reveal, setReveal] = useState({ reqId: null, tick: 0 });

  const [tabs, setTabs] = useState(() => [createTab(newRequest())]);

  const [tabGroups, setTabGroups] = useState([]); // 标签分组（Chrome 式）

  const [activeTabId, setActiveTabId] = useState(null);

  // 用户主动解散过的自动分组 urlKey，会话内不再自动重建

  const dismissedGroupKeysRef = useRef(new Set());



  const [mockRunning, setMockRunning] = useState(false);

  const [mockBusy, setMockBusy] = useState(false); // Mock 启停进行中（按钮 loading 态）

  const [importing, setImporting] = useState(false); // 集合导入解析中（集合树骨架屏，ioBusyRef 只防重入不驱动界面）

  const [mockLogs, setMockLogs] = useState([]);

  // WS/SSE 连接会话状态（不持久化）：tabId -> { status, connected, connectedAt, events: [], unread }

  const [rtState, setRtState] = useState({});

  // applyRtEvent 在挂载 effect 内闭包，读当前激活标签用 ref 避免过期

  const activeTabIdRef = useRef(null);

  useEffect(() => { activeTabIdRef.current = activeTabId; }, [activeTabId]);

  // 切换标签：顺带清零 WS/SSE 标签的未读消息徽标

  const selectTab = useCallback((id) => {

    setRtState((prev) => (prev[id] && prev[id].unread ? { ...prev, [id]: { ...prev[id], unread: 0 } } : prev));

    setActiveTabId(id);

  }, []);

  const [selectedRouteId, setSelectedRouteId] = useState(null);

  const [toast, setToast] = useState(null);

  const [notices, setNotices] = useState([]); // 通知中心消息列表（会话级）

  const [noticeUnread, setNoticeUnread] = useState(0);

  const [noticesOpen, setNoticesOpen] = useState(false);

  const [modal, setModal] = useState(null); // {type:'save'} | {type:'colSettings', colId} | {type:'curl'}

  // 通用输入弹窗（Electron 不支持 window.prompt）：{title, label, defaultValue, onConfirm}

  const [prompt, setPrompt] = useState(null);

  // 通用确认弹窗（统一替代 window.confirm）：{title, message, danger, onConfirm}

  const [confirm, setConfirm] = useState(null);

  const [paletteOpen, setPaletteOpen] = useState(false); // Ctrl+K 全局搜索/命令面板

  const [globalSearchOpen, setGlobalSearchOpen] = useState(false); // Ctrl+Shift+F 全局搜索

  const [consoleOpen, setConsoleOpen] = useState(false); // 底部控制台抽屉

  const [consoleLogs, setConsoleLogs] = useState([]); // 控制台：请求日志（会话级）

  const [scriptLogs, setScriptLogs] = useState([]); // 控制台：脚本 console 输出（会话级）

  const [kbdOpen, setKbdOpen] = useState(false); // 状态栏快捷键速查弹层

  const [appVersion, setAppVersion] = useState(''); // 应用版本号（主进程读取）

  const [updateProgress, setUpdateProgress] = useState(null); // 新版本下载进度百分比（null=未在下载）

  // 手动点了"检查更新"时置位：无更新/失败才弹 toast，启动静默检查不打扰

  const manualUpdateCheckRef = useRef(false);



  // 当前激活标签页及其派生状态（仅请求类标签持有 request）

  const curTab = tabs.find((t) => t.id === activeTabId) || tabs[0];

  const activeRequest = curTab.kind === 'request' ? curTab.request : null;



  /** 请求标签是否有未保存改动：与集合中已存版本对比；未入集合的非空白请求也视为未保存 */

  const isTabDirty = useCallback((tab) => {

    if (!tab || tab.kind !== 'request') return false;

    const saved = findRequestById(collections, tab.request.id);

    if (saved) return JSON.stringify(normalizeRequest(saved)) !== JSON.stringify(normalizeRequest(tab.request));

    return !isBlankRequest(tab.request);

  }, [collections]);



  const patchTab = useCallback((tabId, patch) => {

    setTabs((prev) => prev.map((t) => (t.id === tabId ? { ...t, ...patch } : t)));

  }, []);



  const setActiveRequest = (req) => patchTab(curTab.id, { request: req });



  /** 活动栏点击：同一项再次点击折叠/展开导航面板 */

  const handleActivity = (key) => {

    if (key === activity) setPanelOpen((v) => !v);

    else { setActivity(key); setPanelOpen(true); }

  };

  /**
   * 「在集合中定位当前请求」：展开左侧集合树并把当前请求滚到视野内。
   * 未保存的请求在树里没有节点，此时给出可操作提示而不是静默失败。
   * 右侧工具条与集合面板标题栏共用这一个入口，保证两处行为一致。
   */
  const handleRevealActiveRequest = () => {
    if (!activeRequest) {
      showToast('当前标签不是请求，无法在集合中定位', 'warn');
      return;
    }
    if (!findRequestAncestorIds(collections, activeRequest.id)) {
      showToast('该请求尚未保存到集合（Ctrl+S 保存后可定位）', 'warn');
      return;
    }
    setActivity('collections');
    setPanelOpen(true);
    setReveal((r) => ({ reqId: activeRequest.id, tick: r.tick + 1 }));
  };



  /** 打开单例页面标签（环境/Cookie/Mock/工具）：已打开则直接聚焦 */

  const openPageTab = (kind, extra = {}) => {

    const found = tabs.find((t) => t.kind === kind &&

      (kind !== 'env' || t.envId === extra.envId) &&

      (kind !== 'tool' || t.tool === extra.tool) &&

      (kind !== 'runner' || t.nodeId === extra.nodeId));

    if (found) {

      setActiveTabId(found.id);

      return;

    }

    const tab = { id: uuid(), kind, ...extra };

    setTabs((prev) => [...prev, tab]);

    setActiveTabId(tab.id);

  };



  /** 非请求标签的图标与名称（TabBar 用） */

  const tabMeta = (tab) => {

    if (tab.kind === 'welcome') return { icon: 'galaxy', label: '欢迎', title: '欢迎使用 ReqMock' };

    if (tab.kind === 'env') {

      if (tab.envId === '__globals__') return { icon: 'galaxy', label: '全局变量', title: '全局变量' };

      const env = environments.find((e) => e.id === tab.envId);

      return { icon: 'earth', label: env ? env.name : '环境已删除', title: '环境变量' };

    }

    if (tab.kind === 'cookies') return { icon: 'archive', label: 'Cookie 管理', title: 'Cookie 管理器' };

    if (tab.kind === 'mock') return { icon: 'services', label: 'Mock 服务', title: 'Mock 服务面板' };

    if (tab.kind === 'tool') {

      const t = TOOLS.find((x) => x.key === tab.tool);

      return { icon: t ? t.icon : 'puzzle', label: t ? t.label : '工具', title: '工具箱' };

    }

    if (tab.kind === 'runner') {

      const node = findNode(collections, tab.nodeId);

      return { icon: 'play', label: node ? `运行 ${node.name}` : '批量运行', title: 'Collection Runner' };

    }

    if (tab.kind === 'ws') {

      return { icon: 'link', label: (tab.config && tab.config.name) || 'WebSocket', title: 'WebSocket 连接' };

    }

    if (tab.kind === 'sse') {

      return { icon: 'activity', label: (tab.config && tab.config.name) || 'SSE', title: 'SSE 连接' };

    }

    return { icon: 'file', label: '未知页面', title: '' };

  };



  // ---- 初始加载持久化数据（含旧版数据结构迁移） ----

  useEffect(() => {

    window.api.loadStore().then((saved) => {

      if (saved) {

        if (saved.collections) setCollections(saved.collections.map(normalizeNode));

        if (saved.environments) setEnvironments(saved.environments);

        if (saved.activeEnvId) setActiveEnvId(saved.activeEnvId);

        if (saved.history) setHistory(saved.history);

        if (saved.mock) setMock(saved.mock);

        if (Array.isArray(saved.cookieJar)) setCookieJar(pruneCookies(saved.cookieJar));

        if (Array.isArray(saved.globals)) setGlobals(saved.globals);

        const st = normalizeSettings(saved.settings);

        setSettings(st);

        applyTheme(st);

        if (Array.isArray(saved.openTabs) && saved.openTabs.length > 0) {

          const restored = saved.openTabs.map((t) => {

            // 页面类标签（环境/Cookie/Mock/工具/WS/SSE）直接恢复标识

            if (t.kind && t.kind !== 'request') {

              return { id: t.id || uuid(), kind: t.kind, envId: t.envId, tool: t.tool, nodeId: t.nodeId, config: t.config, groupId: t.groupId };

            }

            return {

              ...createTab(normalizeOpenedRequest(normalizeRequest(t.request || {}))),

              id: t.id || uuid(),

              groupId: t.groupId

            };

          });

          setTabs(restored);

          if (Array.isArray(saved.tabGroups)) setTabGroups(saved.tabGroups);

          setActiveTabId(

            restored.some((t) => t.id === saved.activeTabId) ? saved.activeTabId : restored[0].id

          );

        }

      } else {

        // 首次启动：注入示例集合/环境并打开欢迎页，避免空白工具感

        const sample = buildSampleWorkspace();

        setCollections(sample.collections);

        setEnvironments(sample.environments);

        setActiveEnvId(sample.activeEnvId);

        const welcomeTab = { id: uuid(), kind: 'welcome' };

        setTabs((prev) => [welcomeTab, ...prev]);

        setActiveTabId(welcomeTab.id);

      }

      setLoaded(true);

    });

    if (window.api.appVersion) window.api.appVersion().then((v) => setAppVersion(typeof v === 'string' ? v : ''));

    window.api.mockStatus().then((s) => setMockRunning(s.running));

    const unsubscribe = window.api.onMockLog((entry) => {

      setMockLogs((prev) => [entry, ...prev].slice(0, 200));

    });

    // WS/SSE 事件汇总：按连接 id（= 标签 id）归档，维护连接状态机与未读计数

    const applyRtEvent = (evt) => {

      setRtState((prev) => {

        const cur = prev[evt.id] || { status: 'idle', connected: false, connectedAt: 0, events: [], unread: 0 };

        const status =

          evt.type === 'connecting' ? 'connecting'

            : evt.type === 'open' ? 'connected'

            : evt.type === 'error' ? 'error'

            : evt.type === 'close' ? 'disconnected'

            : cur.status;

        const isActive = evt.id === activeTabIdRef.current;

        const isInMsg = evt.type === 'message' && evt.direction === 'in';

        return {

          ...prev,

          [evt.id]: {

            status,

            connected: status === 'connected',

            connectedAt: evt.type === 'open' ? evt.time

              : (evt.type === 'close' || evt.type === 'error') ? 0 : cur.connectedAt,

            events: [...cur.events, evt].slice(-500),

            unread: isActive ? 0 : (isInMsg ? cur.unread + 1 : cur.unread)

          }

        };

      });

    };

    const unsubWs = window.api.onWsEvent(applyRtEvent);

    const unsubSse = window.api.onSseEvent(applyRtEvent);

    return () => { unsubscribe(); unsubWs(); unsubSse(); };

  }, []);



  // ---- 状态变化去抖持久化 ----

  const saveTimer = useRef(null);

  useEffect(() => {

    if (!loaded) return;

    clearTimeout(saveTimer.current);

    saveTimer.current = setTimeout(() => {

      window.api.saveStore({

        collections, environments, activeEnvId, history, mock,

        cookieJar, globals, settings,

        openTabs: tabs.map((t) => (

          t.kind === 'request'

            ? { id: t.id, kind: 'request', request: t.request, groupId: t.groupId }

            : { id: t.id, kind: t.kind, envId: t.envId, tool: t.tool, nodeId: t.nodeId, config: t.config, groupId: t.groupId }

        )),

        tabGroups,

        activeTabId: curTab.id

      });

    }, 800);

    return () => clearTimeout(saveTimer.current);

  }, [loaded, collections, environments, activeEnvId, history, mock, cookieJar, globals, settings, tabs, tabGroups, activeTabId]);



  // ---- Mock 运行中路由热更新 ----

  useEffect(() => {

    if (mockRunning) {

      window.api.updateMockRoutes(mock.routes);

    }

  }, [mockRunning, mock.routes]);



  /** 记录到通知中心（不弹 toast），type: info | success | error */

  const pushNotice = useCallback((text, type = 'info') => {

    setNotices((prev) => [{ id: uuid(), time: new Date().toISOString(), type, text }, ...prev].slice(0, 100));

    setNoticeUnread((n) => n + 1);

  }, []);



  // 「跟随系统」：系统明暗切换时实时重涂，无需重启或重开设置面板

  useEffect(() => {

    if (settings.theme !== 'system') return undefined;

    return watchSystemTheme(() => applyTheme(settings));

  }, [settings.theme, settings.accent]);



  /** 底部弹出 toast（同时记入通知中心），type 决定左侧色条与图标：info | success | error | warn */

  const showToast = useCallback((text, type = 'info') => {

    setToast({ text, type });

    setTimeout(() => setToast(null), 2500);

    pushNotice(text, type);

  }, [pushNotice]);



  const handleToggleNotices = () => {

    if (!noticesOpen) setNoticeUnread(0);

    setNoticesOpen(!noticesOpen);

  };



  // ---- 自动更新：主进程事件 → 确认弹窗/状态栏进度/toast ----

  useEffect(() => {

    const unsub = window.api.onUpdateEvent((evt) => {

      if (evt.type === 'available') {

        manualUpdateCheckRef.current = false;

        pushNotice(`正在下载新版本 v${evt.version}…`, 'info');

        setUpdateProgress(0);

      } else if (evt.type === 'not-available') {

        if (manualUpdateCheckRef.current) showToast('当前已是最新版本', 'success');

        manualUpdateCheckRef.current = false;

      } else if (evt.type === 'progress') {

        setUpdateProgress(Math.min(100, Math.round(evt.percent || 0)));

      } else if (evt.type === 'downloaded') {

        setUpdateProgress(null);

        setConfirm({

          title: '新版本已下载完成',

          message: `v${evt.version} 下载完成，立即重启安装？取消则在退出应用时自动安装。`,

          onConfirm: () => window.api.installUpdate()

        });

      } else if (evt.type === 'error') {

        setUpdateProgress(null);

        if (manualUpdateCheckRef.current) showToast('检查更新失败：' + describeError(evt.message), 'error');

        else pushNotice('自动更新失败：' + describeError(evt.message), 'error');

      } else if (evt.type === 'retry') {

        pushNotice(`下载中断，${evt.delay / 1000}秒后第${evt.attempt}次重试…`, 'warn');

      } else if (evt.type === 'resuming') {

        pushNotice(`检测到上次未完成的更新 v${evt.version}，正在续传…`, 'info');

        manualUpdateCheckRef.current = false;

      }

    });

    return unsub;

  }, [showToast, pushNotice]);



  /** 设置页"检查更新"：结果统一由 update:event 回调展示 */

  const handleCheckUpdate = async () => {

    manualUpdateCheckRef.current = true;

    const res = await window.api.checkUpdate();

    if (res && !res.ok) {

      manualUpdateCheckRef.current = false;

      if (res.reason === 'dev') showToast('开发模式下不支持检查更新（需安装包环境）', 'warn');

      else showToast('检查更新失败：' + describeError(res.error), 'error');

    }

  };



  // 通知中心打开后：点击弹层外部或按 Esc 自动关闭（✉ 按钮自身除外，避免关闭后又被切换重开）

  useEffect(() => {

    if (!noticesOpen) return;

    const onMouseDown = (e) => {

      if (!(e.target instanceof Element)) return;

      if (e.target.closest('.notice-popover') || e.target.closest('[data-notice-toggle]')) return;

      setNoticesOpen(false);

    };

    const onKeyDown = (e) => {

      if (e.key === 'Escape') setNoticesOpen(false);

    };

    document.addEventListener('mousedown', onMouseDown);

    document.addEventListener('keydown', onKeyDown);

    return () => {

      document.removeEventListener('mousedown', onMouseDown);

      document.removeEventListener('keydown', onKeyDown);

    };

  }, [noticesOpen]);



  // 快捷键速查弹层：点击弹层外部或按 Esc 自动关闭（⌨ 按钮自身除外）

  useEffect(() => {

    if (!kbdOpen) return;

    const onMouseDown = (e) => {

      if (!(e.target instanceof Element)) return;

      if (e.target.closest('.kbd-popover') || e.target.closest('[data-kbd-toggle]')) return;

      setKbdOpen(false);

    };

    const onKeyDown = (e) => {

      if (e.key === 'Escape') setKbdOpen(false);

    };

    document.addEventListener('mousedown', onMouseDown);

    document.addEventListener('keydown', onKeyDown);

    return () => {

      document.removeEventListener('mousedown', onMouseDown);

      document.removeEventListener('keydown', onKeyDown);

    };

  }, [kbdOpen]);



  // 主区切换反馈：只在"跨页面类型"（request↔mock↔welcome↔tool 等整树重挂载）时轻淡入，

  // 且只淡入不位移；同级标签之间（request↔request）内容变、框架不变，一律不动画，

  // 否则标题行 / 保存 / URL 栏 / 发送 / 子页签会整体滑 5px 并闪一下

  const [pageScope, animatePage] = useAnimate();

  const prevTabKindRef = useRef(null);

  useEffect(() => {

    const kindChanged = prevTabKindRef.current !== curTab.kind;

    prevTabKindRef.current = curTab.kind;

    if (!kindChanged || !pageScope.current) return;

    animatePage(pageScope.current, { opacity: [0.72, 1] }, { duration: 0.12, ease: 'easeOut' });

  }, [curTab.id]);



  // 键盘可达性垫片：让 div/span + onClick 实现的控件可 Tab 聚焦、可用 Enter/Space 激活

  useEffect(() => initA11yClicks(), []);



  // ---- 请求/响应分栏拖拽：比例存入 settings 持久化（25%–75%） ----

  const workspaceRef = useRef(null);

  const [splitDrag, setSplitDrag] = useState(false);

  // 响应专注模式：临时隐藏请求编辑区，Esc 退出；切换标签时自动复位

  const [focusResponse, setFocusResponse] = useState(false);

  useEffect(() => { setFocusResponse(false); }, [curTab.id]);

  useEffect(() => {

    if (!focusResponse) return;

    const onKey = (e) => { if (e.key === 'Escape') setFocusResponse(false); };

    window.addEventListener('keydown', onKey);

    return () => window.removeEventListener('keydown', onKey);

  }, [focusResponse]);

  const handleSplitDown = (e) => {

    e.preventDefault();

    const el = workspaceRef.current;

    if (!el) return;

    const rect = el.getBoundingClientRect();

    const horizontal = settings.layout === 'horizontal';

    setSplitDrag(true);

    document.body.classList.add('resizing');

    const onMove = (ev) => {

      const ratio = horizontal

        ? ((ev.clientX - rect.left) / rect.width) * 100

        : ((ev.clientY - rect.top) / rect.height) * 100;

      const v = Math.round(Math.min(75, Math.max(25, ratio)) * 10) / 10;

      handleChangeSettings(horizontal ? { splitH: v } : { splitV: v });

    };

    const onUp = () => {

      setSplitDrag(false);

      document.body.classList.remove('resizing');

      document.removeEventListener('mousemove', onMove);

      document.removeEventListener('mouseup', onUp);

    };

    document.addEventListener('mousemove', onMove);

    document.addEventListener('mouseup', onUp);

  };



  // ---- 环境相关 ----

  const activeEnv = environments.find((e) => e.id === activeEnvId) || null;

  const varNames = Object.keys(buildVarMap(activeEnv, globals));



  // 去重后的历史 URL 列表（供 RequestBar 自动补全）

  const urlHistory = React.useMemo(() => {

    const seen = new Set();

    return history.filter((h) => {

      if (!h.url || seen.has(h.url)) return false;

      seen.add(h.url);

      return true;

    }).map((h) => ({ url: h.url, method: h.method }));

  }, [history]);



  /** 修改应用设置（主题/强调色/Cookie 开关）并即时应用主题 */

  const handleChangeSettings = (patch) => {

    // 主题/强调色变化时给根元素短暂挂上过渡类，颜色平滑切换不闪变

    const colorChange = ('theme' in patch && patch.theme !== settings.theme) || ('accent' in patch && patch.accent !== settings.accent);

    if (colorChange) {

      document.documentElement.classList.add('theme-switching');

      clearTimeout(handleChangeSettings._tt);

      handleChangeSettings._tt = setTimeout(() => document.documentElement.classList.remove('theme-switching'), 250);

    }

    setSettings((prev) => {

      const next = normalizeSettings({ ...prev, ...patch });

      applyTheme(next);

      return next;

    });

  };



  /** 把脚本产生的环境变量变更写回激活环境 */

  const persistEnvChanges = useCallback(({ envSet, envUnset }) => {

    if (Object.keys(envSet).length === 0 && envUnset.length === 0) return;

    if (!activeEnvId) {

      showToast('未激活环境，脚本 rm.env.set 未持久化', 'warn');

      return;

    }

    setEnvironments((prev) => prev.map((env) => {

      if (env.id !== activeEnvId) return env;

      let vars = env.variables.filter((v) => !envUnset.includes(v.key));

      for (const [k, val] of Object.entries(envSet)) {

        const idx = vars.findIndex((v) => v.key === k);

        if (idx >= 0) {

          vars = vars.map((v, i) => (i === idx ? { ...v, value: val, enabled: true } : v));

        } else {

          vars = [...vars, { key: k, value: val, enabled: true }];

        }

      }

      return { ...env, variables: vars };

    }));

  }, [activeEnvId, showToast]);



  const handleNewEnv = () => {

    const env = newEnvironment(`环境 ${environments.length + 1}`);

    setEnvironments((prev) => [...prev, env]);

    openPageTab('env', { envId: env.id });

  };



  const handleUpdateEnv = (env) => {

    setEnvironments((prev) => prev.map((e) => (e.id === env.id ? env : e)));

  };



  const handleDeleteEnv = (envId) => {

    setConfirm({

      title: '删除环境', message: '确定删除该环境？其中的变量将一并删除。', danger: true,

      onConfirm: () => {

        setEnvironments((prev) => prev.filter((e) => e.id !== envId));

        if (activeEnvId === envId) setActiveEnvId(null);

        // 同步关闭对应的环境标签页

        const envTab = tabs.find((t) => t.kind === 'env' && t.envId === envId);

        if (envTab) handleCloseTab(envTab.id);

      }

    });

  };



  // ---- 请求发送（管线见 utils/requestPipeline.js）----

  // 发送中的取消令牌：tabId -> cancelToken，用于发送中主动取消

  const sendTokensRef = useRef(new Map());

  /** 实际发送逻辑：供手动发送与失败视图的重试（可携改动后的请求快照）复用 */

  const doSend = async (tabId, reqSnapshot) => {

    // 发送即让位：侧边栏展开时自动收起，把宽度让给请求参数与响应
    if (panelOpen) setPanelOpen(false);

    patchTab(tabId, { sending: true, response: null, scriptResult: null });
    try {



    // 注册取消令牌，发送中可点“取消”中断请求

    const cancelToken = uuid();

    sendTokensRef.current.set(tabId, cancelToken);

    const { result, finalReq, logs, tests, errors, envSet, envUnset, cookieOn } =

      await executeRequest(reqSnapshot, {

        collections,

        varMap: buildVarMap(activeEnv, globals),

        settings,

        cookieJar,

        send: (payload) => window.api.sendRequest(payload),

        cancelToken

      });

    sendTokensRef.current.delete(tabId);



    // 脚本产生的环境变量变更写回激活环境

    persistEnvChanges({ envSet, envUnset });



    // 记录响应中的 Set-Cookie 到 Cookie jar

    if (cookieOn && result.setCookies && result.setCookies.length > 0) {

      setCookieJar((jar) => upsertCookies(jar, result.setCookies, result.finalUrl || finalReq.url));

    }



    const scriptResult = tests.length || logs.length || errors.length ? { tests, logs, errors } : null;

    // 失败时把变量替换后的最终请求附在响应上，供失败视图展示实际发出的请求与复制 cURL

    const finalResult = result.ok ? result : { ...result, finalRequest: finalReq };

    // 写回响应并追加到标签的响应历史（会话级，最多 20 条，供回看对比）

    setTabs((prev) => prev.map((t) => (t.id === tabId ? {

      ...t,

      sending: false,

      response: finalResult,

      scriptResult,

      responseHistory: [

        { id: uuid(), time: new Date().toLocaleTimeString(), response: finalResult, scriptResult },

        ...(t.responseHistory || [])

      ].slice(0, 20)

    } : t)));

    // 控制台：记录变量替换后的最终请求与响应摘要

    setConsoleLogs((prev) => [{

      id: uuid(),

      time: new Date().toLocaleTimeString(),

      method: finalReq.method,

      url: finalReq.url,

      ok: result.ok,

      status: result.status,

      timeMs: result.timeMs,

      error: result.error,

      requestHeaders: (finalReq.headers || []).filter((h) => h.enabled !== false && h.key),

      responseHeaders: result.headers || {}

    }, ...prev].slice(0, 200));

    // 控制台：汇总前置/后置脚本的 console 输出

    if (logs.length) {

      const source = reqSnapshot.name || finalReq.url;

      const time = new Date().toLocaleTimeString();

      setScriptLogs((prev) => [

        ...logs.map((l) => ({ id: uuid(), time, source, level: l.level, text: l.text })),

        ...prev

      ].slice(0, 300));

    }

    if (!result.ok) pushNotice(`请求失败 ${finalReq.url}：${result.error || '未知错误'}`, 'error');

    if (errors.length) pushNotice(`脚本异常（${reqSnapshot.name || finalReq.url}）：${errors.join('；')}`, 'error');

    // 历史条目：保留原请求 id（requestId）与耗时/体积，并附截断后的响应快照供回看

    const snapBody = typeof result.body === 'string' ? result.body.slice(0, 20480) : '';

    setHistory((prev) => [{

      ...reqSnapshot,

      id: uuid(),

      requestId: reqSnapshot.id,

      time: new Date().toISOString(),

      status: result.ok ? result.status : 'ERR',

      timeMs: result.timeMs,

      sizeBytes: result.ok ? result.sizeBytes : undefined,

      responseSnapshot: result.ok ? {

        status: result.status,

        statusText: result.statusText,

        headers: result.headers,

        body: snapBody,

        bodyTruncated: typeof result.body === 'string' && result.body.length > 20480,

        timeMs: result.timeMs,

        sizeBytes: result.sizeBytes

      } : undefined

    }, ...prev].slice(0, 100));

    // 聚合模式：发送尚未保存的请求时，若集合中已有同键（method+path）接口，则自动落为新变体
    if (settings.workMode === 'endpoint') {
      const alreadySaved = findRequestById(collections, reqSnapshot.id);
      if (!alreadySaved) {
        const group = findVariantGroup(collections, reqSnapshot);
        if (group) {
          const req = { ...reqSnapshot, variantName: variantLabel(reqSnapshot) };
          setCollections((prev) => updateNode(prev, group.node.id, (node) => ({
            ...node,
            requests: [...(node.requests || []), req]
          })));
          pushNotice(`聚合模式：已自动存为变体「${variantLabel(reqSnapshot)}」`, 'success');
        }
      }
    }

    } catch (err) {
      // 确保任何异常都清除 sending 状态
      sendTokensRef.current.delete(tabId);
      patchTab(tabId, { sending: false, response: { ok: false, error: (err && err.message) || '请求执行异常', errorCode: 'EXEC_ERROR' } });
      pushNotice(`请求异常：${err.message}`, 'error');
    }
  };



  const handleSend = async () => {

    if (curTab.kind !== 'request') return;

    if (!curTab.request.url) {

      showToast('请先填写 URL', 'warn');

      return;

    }

    await doSend(curTab.id, curTab.request);

  };



  /** 失败视图快捷动作：关闭 SSL 证书校验后重试（证书类错误专用） */

  const handleRetryNoSsl = () => {

    if (curTab.kind !== 'request') return;

    const req = { ...curTab.request, sslVerify: false };

    patchTab(curTab.id, { request: req });

    doSend(curTab.id, req);

  };



  /** 取消当前标签发送中的请求 */

  const handleCancelSend = () => {

    const token = sendTokensRef.current.get(curTab.id);

    if (token) window.api.cancelRequest(token);

  };



  /** 响应历史回看：把选中的历史响应切回面板展示 */

  const handleSelectHistory = (h) => {

    patchTab(curTab.id, { response: h.response, scriptResult: h.scriptResult });

  };



  /** 标题行点击重命名请求：已在集合中则同步更新集合树 */

  const handleRenameRequest = () => {

    if (!activeRequest) return;

    setPrompt({

      title: '重命名请求', label: '请求名称', defaultValue: reqDisplayName(activeRequest),

      onConfirm: (name) => {

        if (!name || name === activeRequest.name) return;

        const req = { ...activeRequest, name };

        setActiveRequest(req);

        const { tree, found } = upsertRequestById(collections, req);

        if (found) setCollections(tree);

      }

    });

  };



  // ---- 请求保存：已在集合中则原位更新，否则弹窗选择保存位置 ----

  const handleSaveRequest = () => {

    if (!activeRequest) return;

    const { tree, found } = upsertRequestById(collections, activeRequest);

    if (found) {

      setCollections(tree);

      showToast('已保存', 'success');

    } else {

      setModal({ type: 'save' });

    }

  };



  const handleSaveConfirm = (name, targetId) => {

    const req = { ...activeRequest, name };

    setActiveRequest(req);

    setCollections((prev) => updateNode(prev, targetId, (node) => ({

      ...node,

      requests: [...(node.requests || []), req]

    })));

    setModal(null);

    showToast('已保存到集合', 'success');

  };



  // ---- 聚合模式（Endpoint Mode）：变体切换 / 存为变体 / 历史应用 ----

  // 当前接口的同键成员（纯派生，不落库）；空数组 = 尚无同键接口
  const activeVariants = settings.workMode === 'endpoint' && activeRequest
    ? ((findVariantGroup(collections, activeRequest) || {}).members || [])
    : [];

  // 当前标签的最近发送记录，供「历史」页签（作用域随工作模式变化）
  // 聚合：同接口（method+path）的所有变体发送；经典：这条请求记录自己的发送
  const editorHistory = activeRequest
    ? history.filter((h) => historyMatches(h, activeRequest, settings.workMode)).slice(0, 20)
    : [];

  /** 切换变体：目标已在某标签打开则聚焦；当前标签干净且已保存则原位替换，否则新开标签 */
  const handleSwitchVariant = (v) => {
    if (!v || (activeRequest && v.id === activeRequest.id)) return;
    const existing = tabs.find((t) => t.kind === 'request' && t.request.id === v.id);
    if (existing) { setActiveTabId(existing.id); return; }
    const curSaved = activeRequest && !!findRequestById(collections, activeRequest.id);
    if (curTab.kind === 'request' && curSaved && !isTabDirty(curTab)) {
      patchTab(curTab.id, { request: normalizeOpenedRequest(normalizeRequest(v)), response: null, scriptResult: null });
    } else {
      handleOpenRequest(v);
    }
  };

  /** 存为变体：当前内容克隆为新记录（新 id）落入同键组所在节点；无同键组时走常规保存弹窗 */
  const handleSaveVariant = () => {
    if (!activeRequest) return;
    const group = findVariantGroup(collections, activeRequest);
    if (!group) { setModal({ type: 'save' }); return; }
    const base = group.members.find((m) => m.id === activeRequest.id) || group.members[0];
    const req = normalizeRequest({
      ...activeRequest,
      id: uuid(),
      name: base.name || activeRequest.name || '',
      variantName: variantLabel(activeRequest)
    });
    setCollections((prev) => updateNode(prev, group.node.id, (node) => ({
      ...node,
      requests: [...(node.requests || []), req]
    })));
    showToast(`已存为变体「${variantLabel(req)}」`, 'success');
  };


  const handleOpenRequest = (req) => {

    // URL 带 query 而 Params 表为空时自动解析加载

    const request = normalizeOpenedRequest(normalizeRequest(req));

    // 已在某标签中打开则直接聚焦，保留标签内未保存的编辑

    const existing = tabs.find((t) => t.kind === 'request' && t.request.id === request.id);

    if (existing) {

      setActiveTabId(existing.id);

      return;

    }

    // 当前标签是空白请求则复用，否则新开标签

    if (curTab.kind === 'request' && isBlankRequest(curTab.request)) {

      patchTab(curTab.id, { request, response: null, scriptResult: null });

      setActiveTabId(curTab.id);

      return;

    }

    const tab = createTab(request);

    setTabs((prev) => [...prev, tab]);

    setActiveTabId(tab.id);

  };



  /** 从历史打开请求；withSnapshot 时把当时的响应快照一并展示到响应面板 */

  const handleOpenHistoryItem = (item, withSnapshot = false) => {

    const { responseSnapshot, requestId, time, status, timeMs, sizeBytes, ...rest } = item;

    const request = normalizeOpenedRequest(normalizeRequest({ ...rest, id: requestId || item.id }));

    const snap = withSnapshot && responseSnapshot

      ? { ok: true, ...responseSnapshot, fromHistory: true, historyTime: time }

      : null;

    const existing = tabs.find((t) => t.kind === 'request' && t.request.id === request.id);

    if (existing) {

      setActiveTabId(existing.id);

      if (snap) patchTab(existing.id, { response: snap, scriptResult: null });

      return;

    }

    if (curTab.kind === 'request' && isBlankRequest(curTab.request)) {

      patchTab(curTab.id, { request, response: snap, scriptResult: null });

      setActiveTabId(curTab.id);

      return;

    }

    const tab = { ...createTab(request), response: snap };

    setTabs((prev) => [...prev, tab]);

    setActiveTabId(tab.id);

  };



  const handleDeleteHistoryItem = (id) => {

    setHistory((prev) => prev.filter((h) => h.id !== id));

  };



  const handleClearHistory = () => {

    setConfirm({

      title: '清空历史', message: '确定清空全部请求历史？此操作不可撤销。', danger: true,

      onConfirm: () => setHistory([])

    });

  };



  /** 历史条目右键：复制为 cURL 命令 */

  const handleCopyHistoryCurl = async (item) => {

    try {

      await navigator.clipboard.writeText(toCurl(normalizeRequest(item)));

      showToast('cURL 命令已复制到剪贴板', 'success');

    } catch (e) {

      showToast('复制失败：' + e.message, 'error');

    }

  };



  // ---- 标签页操作 ----

  const handleNewTab = () => {

    const tab = createTab(newRequest());

    setTabs((prev) => [...prev, tab]);

    setActiveTabId(tab.id);

  };



  /** 新建 WebSocket / SSE 连接标签（配置随标签持久化，消息为会话级） */

  const handleNewRealtimeTab = (kind) => {

    const tab = {

      id: uuid(), kind,

      config: { name: kind === 'ws' ? 'WebSocket' : 'SSE', url: '', headers: [] }

    };

    setTabs((prev) => [...prev, tab]);

    setActiveTabId(tab.id);

  };



  /** 关闭 WS/SSE 标签时断开对应连接并清理会话状态 */

  const closeRealtime = (tab) => {

    if (!tab || (tab.kind !== 'ws' && tab.kind !== 'sse')) return;

    if (tab.kind === 'ws') window.api.wsClose(tab.id);

    else window.api.sseClose(tab.id);

    setRtState((prev) => {

      const next = { ...prev };

      delete next[tab.id];

      return next;

    });

  };



  const handleCloseTab = (tabId, force = false) => {

    const tab = tabs.find((t) => t.id === tabId);

    // 固定标签防误关（含固定组内成员）：需先右键取消固定

    if (!force && tab && (tab.pinned || (tab.groupId && tabGroups.some((g) => g.id === tab.groupId && g.pinned)))) {

      showToast('该标签已固定，右键取消固定后才能关闭', 'warn');

      return;

    }

    // 未保存改动二次确认，避免误关丢稿

    if (!force && isTabDirty(tab)) {

      setConfirm({

        title: '关闭未保存的标签',

        message: `「${reqDisplayName(tab.request)}」有未保存的修改，关闭后将丢失，确定关闭？`,

        danger: true,

        onConfirm: () => handleCloseTab(tabId, true)

      });

      return;

    }

    closeRealtime(tab);

    const next = tabs.filter((t) => t.id !== tabId);

    if (next.length === 0) {

      // 关闭最后一个标签时自动新建空白标签

      const tab = createTab(newRequest());

      setTabs([tab]);

      setActiveTabId(tab.id);

      return;

    }

    setTabs(next);

    if (tabId === curTab.id) {

      const idx = tabs.findIndex((t) => t.id === tabId);

      setActiveTabId(next[Math.max(0, idx - 1)].id);

    }

  };



  /** 关闭所有标签（保留一个空白标签） */

  const handleCloseAll = () => {

    const dirty = tabs.filter((t) => t.kind === 'request' && isTabDirty(t));

    if (dirty.length > 0) {

      setConfirm({

        title: '关闭所有标签',

        message: `有 ${dirty.length} 个标签包含未保存的修改，关闭后将丢失，确定全部关闭？`,

        danger: true,

        onConfirm: () => {

          tabs.forEach((t) => closeRealtime(t));

          const tab = createTab(newRequest());

          setTabs([tab]);

          setActiveTabId(tab.id);

        }

      });

      return;

    }

    tabs.forEach((t) => closeRealtime(t));

    const tab = createTab(newRequest());

    setTabs([tab]);

    setActiveTabId(tab.id);

  };



  /** 关闭右侧所有标签 */

  const handleCloseToRight = (tabId) => {

    const idx = tabs.findIndex((t) => t.id === tabId);

    if (idx < 0 || idx >= tabs.length - 1) return;

    const toClose = tabs.slice(idx + 1);

    toClose.forEach((t) => closeRealtime(t));

    const next = tabs.slice(0, idx + 1);

    setTabs(next);

    if (!next.find((t) => t.id === activeTabId)) setActiveTabId(next[next.length - 1].id);

  };



  /** 关闭左侧所有标签 */

  const handleCloseToLeft = (tabId) => {

    const idx = tabs.findIndex((t) => t.id === tabId);

    if (idx <= 0) return;

    const toClose = tabs.slice(0, idx);

    toClose.forEach((t) => closeRealtime(t));

    const next = tabs.slice(idx);

    setTabs(next);

    if (!next.find((t) => t.id === activeTabId)) setActiveTabId(next[0].id);

  };



  // ---- 标签分组操作（Chrome 式） ----

  /** 把标签加入新建的手动分组 */

  const handleNewGroup = (tabId) => {

    setPrompt({

      title: '新建分组', label: '分组名称', defaultValue: '新分组',

      onConfirm: (name) => {

        const group = { id: uuid(), name, color: pickGroupColor(tabGroups), collapsed: false, auto: false };

        setTabGroups((prev) => [...prev, group]);

        setTabs((prev) => reorderTabsByGroup(prev.map((t) => (t.id === tabId ? { ...t, groupId: group.id } : t))));

      }

    });

  };



  /** 把标签加入已有分组；自动组被手动加人后转为手动组，并把该标签从排除名单中放出 */

  const handleAssignGroup = (tabId, groupId) => {

    setTabGroups((prev) => prev.map((g) => (

      g.id === groupId

        ? { ...g, auto: false, excludedTabIds: (g.excludedTabIds || []).filter((id) => id !== tabId) }

        : g

    )));

    setTabs((prev) => reorderTabsByGroup(prev.map((t) => (t.id === tabId ? { ...t, groupId } : t))));

  };



  /** 把标签移出分组；记入该组排除名单，相同 URI 规则不会把它拉回去，也不影响其他同 URI 标签继续归组 */

  const handleLeaveGroup = (tabId) => {

    const tab = tabs.find((t) => t.id === tabId);

    if (tab && tab.groupId) {

      setTabGroups((prev) => prev.map((g) => (

        g.id === tab.groupId

          ? { ...g, excludedTabIds: [...new Set([...(g.excludedTabIds || []), tabId])] }

          : g

      )));

    }

    setTabs((prev) => prev.map((t) => (t.id === tabId ? { ...t, groupId: undefined } : t)));

  };



  const handleRenameGroup = (groupId) => {

    const group = tabGroups.find((g) => g.id === groupId);

    if (!group) return;

    setPrompt({

      title: '重命名分组', label: '分组名称', defaultValue: group.name,

      onConfirm: (name) => {

        if (name === group.name) return;

        setTabGroups((prev) => prev.map((g) => (g.id === groupId ? { ...g, name } : g)));

      }

    });

  };



  const handleRecolorGroup = (groupId, color) => {

    setTabGroups((prev) => prev.map((g) => (g.id === groupId ? { ...g, color } : g)));

  };



  const handleToggleGroupCollapse = (groupId) => {

    setTabGroups((prev) => prev.map((g) => (g.id === groupId ? { ...g, collapsed: !g.collapsed } : g)));

  };



  /** 固定/取消固定标签：固定标签常驻标签栏左侧且防误关 */

  const handleTogglePinTab = (tabId) => {

    setTabs((prev) => prev.map((t) => (t.id === tabId ? { ...t, pinned: !t.pinned } : t)));

  };



  /** 固定/取消固定分组：成员标签整组常驻标签栏左侧且防误关 */

  const handleTogglePinGroup = (groupId) => {

    setTabGroups((prev) => prev.map((g) => (g.id === groupId ? { ...g, pinned: !g.pinned } : g)));

  };



  /** 解散分组但保留标签；URI 组（含手动化的）记入 dismissed，会话内不再重建 */

  const handleUngroup = (groupId) => {

    const group = tabGroups.find((g) => g.id === groupId);

    if (group && group.urlKey) dismissedGroupKeysRef.current.add(group.urlKey);

    setTabGroups((prev) => prev.filter((g) => g.id !== groupId));

    setTabs((prev) => prev.map((t) => (t.groupId === groupId ? { ...t, groupId: undefined } : t)));

  };



  /** 关闭分组内全部标签（含未保存成员时先确认） */

  const handleCloseGroup = (groupId, force = false) => {

    const group = tabGroups.find((g) => g.id === groupId);

    if (group && group.pinned) {

      showToast('该分组已固定，取消固定后才能关闭', 'warn');

      return;

    }

    const dirtyCount = tabs.filter((t) => t.groupId === groupId && isTabDirty(t)).length;

    if (!force && dirtyCount > 0) {

      setConfirm({

        title: '关闭分组',

        message: `分组内有 ${dirtyCount} 个标签存在未保存的修改，关闭后将丢失，确定全部关闭？`,

        danger: true,

        onConfirm: () => handleCloseGroup(groupId, true)

      });

      return;

    }

    if (group && group.urlKey) dismissedGroupKeysRef.current.add(group.urlKey);

    setTabGroups((prev) => prev.filter((g) => g.id !== groupId));

    tabs.filter((t) => t.groupId === groupId).forEach(closeRealtime);

    const next = tabs.filter((t) => t.groupId !== groupId);

    if (next.length === 0) {

      const tab = createTab(newRequest());

      setTabs([tab]);

      setActiveTabId(tab.id);

      return;

    }

    setTabs(next);

    if (!next.some((t) => t.id === curTab.id)) setActiveTabId(next[0].id);

  };



  /** Ctrl+D：把当前请求复制到新标签（新 id，与原请求脱钩） */

  const handleDuplicateTab = () => {

    if (curTab.kind !== 'request') return;

    const req = normalizeRequest({ ...curTab.request, id: uuid(), name: (reqDisplayName(curTab.request)) + ' 副本' });

    const tab = createTab(req);

    setTabs((prev) => [...prev, tab]);

    setActiveTabId(tab.id);

    showToast('已复制为新标签', 'success');

  };



  /** 右键菜单：复制指定标签为新标签，插入到原标签右侧并激活 */

  const handleCloneTab = (tabId) => {

    const srcTab = tabs.find((t) => t.id === tabId);

    if (!srcTab || srcTab.kind !== 'request') return;

    const req = normalizeRequest({ ...JSON.parse(JSON.stringify(srcTab.request)), id: uuid(), name: reqDisplayName(srcTab.request) + ' 副本' });

    const tab = createTab(req);

    const idx = tabs.findIndex((t) => t.id === tabId);

    setTabs((prev) => [...prev.slice(0, idx + 1), tab, ...prev.slice(idx + 1)]);

    setActiveTabId(tab.id);

    showToast('已复制为新标签', 'success');

  };



  /** Ctrl+Tab / Ctrl+Shift+Tab：按标签栏顺序循环切换 */

  const handleCycleTab = (dir) => {

    if (tabs.length < 2) return;

    const idx = tabs.findIndex((t) => t.id === curTab.id);

    setActiveTabId(tabs[(idx + dir + tabs.length) % tabs.length].id);

  };



  /** Ctrl+E：在无环境与各环境间循环切换 */

  const handleCycleEnv = () => {

    if (environments.length === 0) {

      showToast('暂无环境，请先在环境面板创建', 'warn');

      return;

    }

    const ids = [null, ...environments.map((e) => e.id)];

    const next = ids[(ids.indexOf(activeEnvId) + 1) % ids.length];

    setActiveEnvId(next);

    const env = environments.find((e) => e.id === next);

    showToast(env ? `已切换环境：${env.name}` : '已切换为无环境');

  };



  // ---- 快捷键（通过 ref 避免闭包过期） ----

  const hotkeysRef = useRef({});

  hotkeysRef.current = {

    send: handleSend,

    save: handleSaveRequest,

    newTab: handleNewTab,

    closeTab: () => handleCloseTab(curTab.id),

    dupTab: handleDuplicateTab,

    cycleTab: handleCycleTab,

    cycleEnv: handleCycleEnv

  };

  useEffect(() => {

    const onKey = (e) => {

      const h = hotkeysRef.current;

      const k = e.key;

      const ctrl = e.ctrlKey || e.metaKey;

      const shift = e.shiftKey;

      const alt = e.altKey;



      // Shift+F10: 发送请求

      if (shift && !ctrl && !alt && k === 'F10') { e.preventDefault(); h.send(); }

      // Ctrl+Shift+A: 命令面板（IDEA: Find Action）

      else if (ctrl && shift && k.toLowerCase() === 'a') { e.preventDefault(); setPaletteOpen((v) => !v); }

      // Ctrl+Shift+F: 全局搜索（跨集合搜索请求）

      else if (ctrl && shift && k.toLowerCase() === 'f') { e.preventDefault(); setGlobalSearchOpen((v) => !v); }

      // Ctrl+S: 保存

      else if (ctrl && !shift && !alt && k.toLowerCase() === 's') { e.preventDefault(); h.save(); }

      // Ctrl+T: 新建标签

      else if (ctrl && !shift && !alt && k.toLowerCase() === 't') { e.preventDefault(); h.newTab(); }

      // Ctrl+F4: 关闭标签（IDEA 风格）

      else if (ctrl && !shift && !alt && k === 'F4') { e.preventDefault(); h.closeTab(); }

      // Ctrl+D: 复制当前标签

      else if (ctrl && !shift && !alt && k.toLowerCase() === 'd') { e.preventDefault(); h.dupTab(); }

      // Alt+Left / Alt+Right: 切换标签（IDEA: Navigate tabs）

      else if (alt && !ctrl && !shift && k === 'ArrowLeft') { e.preventDefault(); h.cycleTab(-1); }

      else if (alt && !ctrl && !shift && k === 'ArrowRight') { e.preventDefault(); h.cycleTab(1); }

      // Ctrl+E: 循环切换环境（IDEA: Recent Files）

      else if (ctrl && !shift && !alt && k.toLowerCase() === 'e') { e.preventDefault(); h.cycleEnv(); }

      // Alt+1: 切换侧边栏（IDEA: Tool Windows）

      else if (alt && !ctrl && !shift && k === '1') { e.preventDefault(); setPanelOpen((v) => !v); }

      // F1: 快捷键速查

      else if (!ctrl && !shift && !alt && k === 'F1') { e.preventDefault(); setKbdOpen((v) => !v); }

      // F2–F7: 直达各导航面板（对标 Reqable）。

      // 这里刻意不调 handleActivity：它在本 effect 的闭包里读到的 activity 是注册时的旧值，

      // 会把「切回当前面板」误判成「再按一次收起」。setter 本身稳定，不受闭包过期影响。

      else if (!ctrl && !shift && !alt && /^F([2-7])$/.test(k)) {

        const panelByFn = { F2: 'collections', F3: 'env', F4: 'mocks', F5: 'cookies', F6: 'history', F7: 'tools' };

        const target = panelByFn[k];

        if (target) { e.preventDefault(); setActivity(target); setPanelOpen(true); }

      }

      // Ctrl+Shift+N: 新建窗口

      else if (ctrl && shift && k.toLowerCase() === 'n') { e.preventDefault(); window.api.newWindow(); }

    };

    window.addEventListener('keydown', onKey);

    return () => window.removeEventListener('keydown', onKey);

  }, []);



  // ---- cURL 导入 / 导出 ----

  const handleCurlImport = (parsed) => {

    let name = '导入的请求';

    try {

      name = new URL(parsed.url).pathname || name;

    } catch (e) { /* 保持默认 */ }

    // URL 中的 query 同步到 Params 表

    const request = normalizeOpenedRequest(normalizeRequest({ ...parsed, id: uuid(), name }));

    const tab = createTab(request);

    setTabs((prev) => [...prev, tab]);

    setActiveTabId(tab.id);

    setModal(null);

    showToast('导入成功', 'success');

  };



  const handleCopyCurl = async () => {

    try {

      await navigator.clipboard.writeText(toCurl(activeRequest));

      showToast('cURL 命令已复制到剪贴板', 'success');

    } catch (e) {

      showToast('复制失败：' + e.message, 'error');

    }

  };



  // ---- 集合树操作 ----

  const handleNewCollection = () => {

    setPrompt({

      title: '新建集合', label: '集合名称', defaultValue: `集合 ${collections.length + 1}`,

      onConfirm: (name) => setCollections((prev) => [...prev, newCollection(name)])

    });

  };



  const handleAddFolder = (parentId) => {

    setPrompt({

      title: '新建文件夹', label: '文件夹名称', defaultValue: '新建文件夹',

      onConfirm: (name) => setCollections((prev) => updateNode(prev, parentId, (node) => ({

        ...node,

        folders: [...(node.folders || []), newFolder(name)]

      })))

    });

  };



  const handleRenameNode = (nodeId, currentName) => {

    setPrompt({

      title: '重命名', label: '名称', defaultValue: currentName,

      onConfirm: (name) => {

        if (name === currentName) return;

        setCollections((prev) => updateNode(prev, nodeId, (node) => ({ ...node, name })));

      }

    });

  };



  const handleDeleteFolder = (folderId) => {

    setConfirm({

      title: '删除文件夹', message: '确定删除该文件夹及其中所有请求？', danger: true,

      onConfirm: () => setCollections((prev) => removeNode(prev, folderId))

    });

  };



  const handleDeleteCollection = (colId) => {

    setConfirm({

      title: '删除集合', message: '确定删除该集合及其中所有请求？', danger: true,

      onConfirm: () => setCollections((prev) => prev.filter((c) => c.id !== colId))

    });

  };



  const handleDeleteRequest = (reqId) => {

    setConfirm({

      title: '删除请求', message: '确定删除该请求？此操作不可撤销。', danger: true,

      onConfirm: () => setCollections((prev) => removeRequestById(prev, reqId))

    });

  };



  const handleCollectionSettings = (colId) => setModal({ type: 'colSettings', colId });



  /** 集合树拖拽：把请求移到目标集合/文件夹（可指定插入到某请求之前） */

  const handleMoveRequest = (reqId, targetNodeId, beforeReqId = null) => {

    setCollections((prev) => moveRequest(prev, reqId, targetNodeId, beforeReqId));

  };



  // ---- Collection Runner ----

  /** 打开批量运行标签（同一节点复用标签） */

  const handleOpenRunner = (nodeId) => openPageTab('runner', { nodeId });



  /** Runner 执行上下文：与单发共用管线，Set-Cookie 写回 Cookie jar */

  const buildRunnerCtx = () => ({

    collections,

    varMap: buildVarMap(activeEnv, globals),

    settings,

    cookieJar,

    send: async (payload) => {

      const result = await window.api.sendRequest(payload);

      const cookieOn = payload.cookieJarMode === 'on' ||

        (payload.cookieJarMode !== 'off' && settings.cookiesEnabled);

      if (cookieOn && result.setCookies && result.setCookies.length > 0) {

        setCookieJar((jar) => upsertCookies(jar, result.setCookies, result.finalUrl || payload.url));

      }

      return result;

    }

  });



  const handleSettingsConfirm = (colId, patch) => {

    setCollections((prev) => updateNode(prev, colId, (node) => ({ ...node, ...patch })));

    setModal(null);

    showToast('集合设置已保存', 'success');

  };



  // ---- 导入 / 导出 ----

  // 文件对话框进行中标记：防止连续点击重复弹窗

  const ioBusyRef = useRef(false);

  /** 解析导入文本并合入工作区（文件选择与拖拽导入共用） */

  const applyImportContent = (content) => {

    try {

      const { collections: cols, environments: envs, globals: gvars = [] } = parseImport(content);

      if (cols.length) setCollections((prev) => [...prev, ...cols]);

      if (envs.length) setEnvironments((prev) => [...prev, ...envs]);

      if (gvars.length) setGlobals((prev) => mergeVariables(prev, gvars));

      const parts = [];

      if (cols.length) parts.push(`${cols.length} 个集合`);

      if (envs.length) parts.push(`${envs.length} 个环境`);

      if (gvars.length) parts.push(`${gvars.length} 个全局变量`);

      if (parts.length) showToast(`导入成功：${parts.join('，')}`, 'success');

      else showToast('导入完成：文件中没有可导入的数据', 'warn');

    } catch (e) {

      showToast('导入失败：' + describeError(e.message), 'error');

    }

  };



  const handleImport = async () => {

    if (ioBusyRef.current) return;

    ioBusyRef.current = true;

    try {

      const res = await window.api.importFile();

      if (!res.ok) {

        if (!res.canceled) showToast('导入失败：' + describeError(res.error), 'error');

        return;

      }

      // 解析 + 重渲染是同步的，大集合会阻塞主线程；先让出一帧把骨架画出来再干活

      setImporting(true);

      setTimeout(() => {

        try {

          applyImportContent(res.content);

        } finally {

          setImporting(false);

        }

      }, 30);

    } finally {

      ioBusyRef.current = false;

    }

  };



  // 导出集合：先弹窗选择格式（ReqMock / Postman / Markdown）

  const handleExportCollection = (colId) => setModal({ type: 'exportCol', colId });



  const handleExportColConfirm = async (format) => {

    const col = collections.find((c) => c.id === modal.colId);

    setModal(null);

    if (!col) return;

    let defaultName;

    let content;

    if (format === 'postman') {

      defaultName = `${col.name}.postman.json`;

      content = exportPostmanCollection(col);

    } else if (format === 'markdown') {

      defaultName = `${col.name}.md`;

      content = exportMarkdownDocs(col);

    } else {

      defaultName = `${col.name}.reqmock.json`;

      content = exportCollection(col);

    }

    const res = await window.api.exportFile({ defaultName, content });

    if (res.ok) showToast('已导出：' + res.filePath, 'success');

    else if (!res.canceled) showToast('导出失败：' + res.error, 'error');

  };



  const handleExportAll = async () => {

    if (ioBusyRef.current) return;

    ioBusyRef.current = true;

    try {

      const res = await window.api.exportFile({

        defaultName: 'reqmock-workspace.json',

        content: exportWorkspace(collections, environments)

      });

      if (res.ok) showToast('已导出：' + res.filePath, 'success');

      else if (!res.canceled) showToast('导出失败：' + res.error, 'error');

    } finally {

      ioBusyRef.current = false;

    }

  };



  /** 导出单个环境（全局变量页导出为含 globals 的环境包格式） */

  const handleExportEnv = async (env) => {

    if (ioBusyRef.current) return;

    ioBusyRef.current = true;

    try {

      const isGlobals = env.id === '__globals__';

      const res = await window.api.exportFile({

        defaultName: isGlobals ? '全局变量.reqmock-env.json' : `${env.name || '环境'}.reqmock-env.json`,

        content: isGlobals ? exportEnvironments([], env.variables) : exportEnvironment(env)

      });

      if (res.ok) showToast('已导出：' + res.filePath, 'success');

      else if (!res.canceled) showToast('导出失败：' + res.error, 'error');

    } finally {

      ioBusyRef.current = false;

    }

  };



  /** 导出全部环境 + 全局变量 */

  const handleExportAllEnvs = async () => {

    if (environments.length === 0 && globals.filter((v) => v.key).length === 0) {

      showToast('暂无环境或全局变量可导出', 'warn');

      return;

    }

    if (ioBusyRef.current) return;

    ioBusyRef.current = true;

    try {

      const res = await window.api.exportFile({

        defaultName: 'reqmock-environments.json',

        content: exportEnvironments(environments, globals)

      });

      if (res.ok) showToast('已导出：' + res.filePath, 'success');

      else if (!res.canceled) showToast('导出失败：' + res.error, 'error');

    } finally {

      ioBusyRef.current = false;

    }

  };



  // ---- 数据备份 / 恢复 ----

  /** 备份全部数据（集合 / 环境 / 全局变量 / 历史 / Mock / Cookie / 设置）到 JSON 文件 */

  const handleBackupData = async () => {

    if (ioBusyRef.current) return;

    ioBusyRef.current = true;

    try {

      const stamp = new Date().toISOString().slice(0, 19).replace(/[T:]/g, '-');

      const content = JSON.stringify({

        reqmock: true, version: 1, type: 'backup', exportedAt: new Date().toISOString(),

        data: { collections, environments, activeEnvId, globals, history, mock, cookieJar, settings }

      }, null, 2);

      const res = await window.api.exportFile({ defaultName: `reqmock-backup-${stamp}.json`, content });

      if (res.ok) showToast('备份成功：' + res.filePath, 'success');

      else if (!res.canceled) showToast('备份失败：' + res.error, 'error');

    } finally {

      ioBusyRef.current = false;

    }

  };



  /** 从备份文件恢复：校验格式后二次确认，确认后覆盖全部数据 */

  const handleRestoreBackup = async () => {

    if (ioBusyRef.current) return;

    ioBusyRef.current = true;

    try {

      const res = await window.api.importFile();

      if (!res.ok) {

        if (!res.canceled) showToast('读取备份失败：' + res.error, 'error');

        return;

      }

      let backup;

      try {

        backup = JSON.parse(res.content);

      } catch (e) {

        showToast('恢复失败：不是合法的 JSON 文件', 'error');

        return;

      }

      if (!backup || backup.reqmock !== true || backup.type !== 'backup' || !backup.data) {

        showToast('恢复失败：不是 ReqMock 备份文件', 'error');

        return;

      }

      const d = backup.data;

      setConfirm({

        title: '恢复备份',

        message: '恢复将覆盖当前全部数据（集合 / 环境 / 全局变量 / 历史 / Mock / Cookie / 设置）且不可撤销，确定继续？',

        danger: true,

        onConfirm: () => {

          setCollections((d.collections || []).map(normalizeNode));

          setEnvironments(Array.isArray(d.environments) ? d.environments : []);

          setActiveEnvId(d.activeEnvId || null);

          setGlobals(Array.isArray(d.globals) ? d.globals : []);

          setHistory(Array.isArray(d.history) ? d.history : []);

          setMock(d.mock && Array.isArray(d.mock.routes) ? d.mock : DEFAULT_STATE.mock);

          setCookieJar(Array.isArray(d.cookieJar) ? pruneCookies(d.cookieJar) : []);

          const st = normalizeSettings(d.settings);

          setSettings(st);

          applyTheme(st);

          setModal(null);

          showToast('备份已恢复', 'success');

        }

      });

    } finally {

      ioBusyRef.current = false;

    }

  };



  // ---- Mock 相关 ----

  /** 启停 Mock 服务：进行中禁用按钮并展示 loading 文案，完成后 toast 反馈成败 */

  const handleMockToggle = async () => {

    if (mockBusy) return;

    setMockBusy(true);

    try {

      if (mockRunning) {

        await window.api.stopMock();

        setMockRunning(false);

        showToast('Mock 服务已停止');

      } else {

        const result = await window.api.startMock({ port: mock.port, routes: mock.routes });

        if (result.ok) {

          setMockRunning(true);

          showToast(`Mock 服务已启动: http://localhost:${mock.port}`, 'success');

        } else {

          showToast('启动失败：' + describeError(result.error), 'error');

        }

      }

    } finally {

      setMockBusy(false);

    }

  };



  const handleAddRoute = () => {

    const route = newMockRoute();

    setMock((prev) => ({ ...prev, routes: [...prev.routes, route] }));

    setSelectedRouteId(route.id);

  };



  const handleUpdateRoute = (route) => {

    setMock((prev) => ({

      ...prev,

      routes: prev.routes.map((r) => (r.id === route.id ? route : r))

    }));

  };



  const handleDeleteRoute = (routeId) => {

    setConfirm({

      title: '删除 Mock 路由', message: '确定删除该 Mock 路由？其中的条件规则将一并删除。', danger: true,

      onConfirm: () => {

        setMock((prev) => ({ ...prev, routes: prev.routes.filter((r) => r.id !== routeId) }));

        if (selectedRouteId === routeId) {

          setSelectedRouteId(null);

        }

      }

    });

  };



  /** 联动：当前响应一键转 Mock 路由 */

  const handleResponseToMock = () => {

    const response = curTab.response;

    if (!response || !response.ok) {

      showToast('没有可转换的成功响应', 'warn');

      return;

    }

    let pathName = '/';

    try {

      pathName = new URL(response.finalUrl || activeRequest.url).pathname;

    } catch (e) { /* 保持默认 */ }

    const contentType = response.headers['content-type'] || 'application/json; charset=utf-8';

    const route = {

      ...newMockRoute(),

      name: `${activeRequest.method} ${pathName}`,

      method: activeRequest.method,

      path: pathName,

      status: response.status,

      headers: [{ key: 'Content-Type', value: contentType, enabled: true }],

      body: response.body

    };

    setMock((prev) => ({ ...prev, routes: [...prev.routes, route] }));

    setSelectedRouteId(route.id);

    openPageTab('mock');

    showToast('已生成 Mock 路由', 'success');

  };



  /** JSON 树节点值提取为变量：写入激活环境，无激活环境时写入全局变量 */

  const handleExtractVariable = (value, suggestedName = 'extracted') => {

    setPrompt({

      title: '提取为变量', label: '变量名', defaultValue: suggestedName,

      onConfirm: (name) => {

        if (!name) return;

        const val = typeof value === 'string' ? value : JSON.stringify(value);

        const upsertVar = (vars) => {

          const idx = vars.findIndex((v) => v.key === name);

          return idx >= 0

            ? vars.map((v, i) => (i === idx ? { ...v, value: val, enabled: true } : v))

            : [...vars, { key: name, value: val, enabled: true }];

        };

        if (activeEnvId) {

          setEnvironments((prev) => prev.map((env) => (

            env.id === activeEnvId ? { ...env, variables: upsertVar(env.variables) } : env

          )));

          showToast(`已写入环境变量 {{${name}}}`, 'success');

        } else {

          setGlobals((prev) => upsertVar(prev));

          showToast(`未激活环境，已写入全局变量 {{${name}}}`, 'success');

        }

      }

    });

  };



  /** 将断言代码追加到当前标签的后置脚本末尾 */

  const handleInsertAssertion = (code) => {

    const req = curTab.request;

    const existing = req.postScript || '';

    const newScript = existing ? existing.trimEnd() + '\n\n' + code : code;

    setActiveRequest({ ...req, postScript: newScript });

    showToast('已添加断言到后置脚本', 'success');

  };



  /** 把当前响应体保存到文件（图片等二进制响应按原始字节写入） */

  const handleSaveResponseBody = async () => {

    const resp = curTab.response;

    if (!resp || !resp.ok) return;

    if (ioBusyRef.current) return;

    ioBusyRef.current = true;

    try {

      const ct = (resp.headers && resp.headers['content-type']) || '';

      const extMap = [

        ['application/json', '.json'], ['text/html', '.html'], ['xml', '.xml'],

        ['image/png', '.png'], ['image/jpeg', '.jpg'], ['image/gif', '.gif'],

        ['image/webp', '.webp'], ['image/svg', '.svg'], ['pdf', '.pdf'], ['text/csv', '.csv']

      ];

      const ext = (extMap.find(([k]) => ct.includes(k)) || [null, '.txt'])[1];

      let pathName = 'response';

      try {

        pathName = new URL(resp.finalUrl || (activeRequest && activeRequest.url)).pathname.split('/').filter(Boolean).pop() || 'response';

      } catch (e) { /* 保持默认 */ }

      const defaultName = pathName.includes('.') ? pathName : pathName + ext;

      const res = resp.bodyBase64

        ? await window.api.exportFile({ defaultName, content: resp.bodyBase64, encoding: 'base64' })

        : await window.api.exportFile({ defaultName, content: resp.body || '' });

      if (res.ok) showToast('已保存：' + res.filePath, 'success');

      else if (!res.canceled) showToast('保存失败：' + res.error, 'error');

    } finally {

      ioBusyRef.current = false;

    }

  };



  /** 把当前响应存为请求的示例响应（已在集合中则同步更新集合树） */

  const handleSaveExample = () => {

    const resp = curTab.response;

    if (!activeRequest || !resp || !resp.ok) {

      showToast('没有可保存的成功响应', 'warn');

      return;

    }

    setPrompt({

      title: '保存为示例响应', label: '示例名称', defaultValue: `${resp.status} 示例`,

      onConfirm: (name) => {

        if (!name) return;

        const example = {

          id: uuid(),

          name,

          status: resp.status,

          contentType: (resp.headers && resp.headers['content-type']) || '',

          headers: resp.headers || {},

          body: typeof resp.body === 'string' ? resp.body.slice(0, 200 * 1024) : '',

          savedAt: new Date().toISOString()

        };

        const req = { ...activeRequest, examples: [...(activeRequest.examples || []), example] };

        setActiveRequest(req);

        const { tree, found } = upsertRequestById(collections, req);

        if (found) setCollections(tree);

        showToast('已保存示例响应，可在「示例」页签查看', 'success');

      }

    });

  };



  /** 联动：从示例响应一键生成 Mock 路由 */

  const handleExampleToMock = (example) => {

    if (!activeRequest) return;

    let pathName = '/';

    try {

      pathName = new URL(activeRequest.url).pathname;

    } catch (e) { /* 保持默认 */ }

    const route = {

      ...newMockRoute(),

      name: `${activeRequest.method} ${pathName}（${example.name}）`,

      method: activeRequest.method,

      path: pathName,

      status: example.status,

      headers: example.contentType ? [{ key: 'Content-Type', value: example.contentType, enabled: true }] : [],

      body: example.body

    };

    setMock((prev) => ({ ...prev, routes: [...prev.routes, route] }));

    setSelectedRouteId(route.id);

    openPageTab('mock');

    showToast('已从示例生成 Mock 路由', 'success');

  };



  /** 联动：从 Mock 路由生成调试请求（新开标签） */

  const handleRouteToRequest = (route) => {

    const req = {

      ...newRequest(),

      name: route.name,

      method: route.method === 'ANY' ? 'GET' : route.method,

      url: `http://localhost:${mock.port}${route.path.replace(/:([\w-]+)/g, '1').replace(/\*/g, 'x')}`

    };

    const tab = createTab(req);

    setTabs((prev) => [...prev, tab]);

    setActiveTabId(tab.id);

  };



  const settingsCollection = modal && modal.type === 'colSettings' ? findNode(collections, modal.colId) : null;



  // ---- 全局拖拽导入：把集合/环境文件拖入窗口任意位置即可导入（环境面板拖拽区自行处理，避免重复） ----

  const [dragImportOver, setDragImportOver] = useState(false);

  const applyImportRef = useRef(null);

  applyImportRef.current = applyImportContent;

  useEffect(() => {

    let depth = 0;

    const hasFiles = (e) => e.dataTransfer && Array.from(e.dataTransfer.types || []).includes('Files');

    const inDropZone = (e) => e.target instanceof Element && e.target.closest('.env-drop-zone');

    const onDragEnter = (e) => {

      if (!hasFiles(e)) return;

      depth++;

      if (!inDropZone(e)) setDragImportOver(true);

    };

    const onDragOver = (e) => {

      if (!hasFiles(e)) return;

      e.preventDefault();

      setDragImportOver(!inDropZone(e));

    };

    const onDragLeave = () => {

      depth = Math.max(0, depth - 1);

      if (depth === 0) setDragImportOver(false);

    };

    const onDrop = async (e) => {

      depth = 0;

      setDragImportOver(false);

      if (!hasFiles(e) || inDropZone(e)) return;

      e.preventDefault();

      for (const file of Array.from(e.dataTransfer.files)) {

        try {

          applyImportRef.current(await file.text());

        } catch (err) { /* 单个文件读取失败不阻断其余 */ }

      }

    };

    window.addEventListener('dragenter', onDragEnter);

    window.addEventListener('dragover', onDragOver);

    window.addEventListener('dragleave', onDragLeave);

    window.addEventListener('drop', onDrop);

    return () => {

      window.removeEventListener('dragenter', onDragEnter);

      window.removeEventListener('dragover', onDragOver);

      window.removeEventListener('dragleave', onDragLeave);

      window.removeEventListener('drop', onDrop);

    };

  }, []);



  // ---- 全局 paste 事件：自动检测 cURL 命令并提示导入 ----

  const handleCurlImportRef = useRef(null);

  handleCurlImportRef.current = handleCurlImport;

  useEffect(() => {

    const onPaste = (e) => {

      // 排除：焦点在 input/textarea/contenteditable/CodeMirror 编辑区时不触发

      const active = document.activeElement;

      if (active) {

        const tag = active.tagName.toLowerCase();

        if (tag === 'input' || tag === 'textarea') return;

        if (active.isContentEditable) return;

        if (active.closest && active.closest('.cm-editor')) return;

      }



      const text = (e.clipboardData || window.clipboardData)?.getData('text') || '';

      const trimmed = text.trim();

      if (!trimmed) return;



      // 检测是否以 curl 或 curl.exe 开头（不区分大小写）

      const isCurl = /^curl(\.exe)?\s/i.test(trimmed);

      if (!isCurl) return;



      // 弹出确认

      setConfirm({

        title: '检测到 cURL 命令',

        message: '检测到 cURL 命令，是否导入为新请求？',

        onConfirm: () => {

          try {

            const parsed = parseCurl(trimmed);

            handleCurlImportRef.current(parsed);

          } catch (err) {

            showToast('cURL 解析失败：' + err.message, 'error');

          }

        }

      });

    };

    window.addEventListener('paste', onPaste);

    return () => window.removeEventListener('paste', onPaste);

  }, [showToast]);



  // 面包屑：当前请求在集合树中的路径（未保存的请求不显示）

  const breadcrumb = activeRequest ? findRequestPath(collections, activeRequest.id) : null;



  return (

    <MotionConfig reducedMotion="user">

    <div className="app">

      {/* 顶部全局栏：＋新建统一入口 + 全局环境切换器 */}

      <TopBar

        environments={environments}

        activeEnvId={activeEnvId}

        globals={globals}

        onActivateEnv={setActiveEnvId}

        onOpenGlobals={() => openPageTab('env', { envId: '__globals__' })}

        onManageEnvs={() => { setActivity('env'); setPanelOpen(true); }}

        onNewRequest={handleNewTab}

        onNewWs={() => handleNewRealtimeTab('ws')}

        onNewSse={() => handleNewRealtimeTab('sse')}

        onNewMockRoute={() => { handleAddRoute(); openPageTab('mock'); }}

        onNewEnv={handleNewEnv}

        onImportCurl={() => setModal({ type: 'curl' })}

        onImportFile={handleImport}

        collections={collections}

        onOpenRequest={handleOpenRequest}

        onOpenFullSearch={() => setGlobalSearchOpen(true)}

        onExportAll={handleExportAll}

        onBackup={handleBackupData}

        onToggleLayout={() => handleChangeSettings({ layout: settings.layout === 'vertical' ? 'horizontal' : 'vertical' })}

        onToggleConsole={() => setConsoleOpen((v) => !v)}

        onToggleSidebar={() => setPanelOpen((v) => !v)}

        onOpenPalette={() => setPaletteOpen(true)}

        onOpenMock={() => openPageTab('mock')}

        onOpenCookies={() => openPageTab('cookies')}

        onOpenTool={(tool) => openPageTab('tool', { tool })}

        onKbd={() => setKbdOpen(true)}

        onOpenWelcome={() => openPageTab('welcome')}

        onCheckUpdate={handleCheckUpdate}

        onAbout={() => setModal({ type: 'about' })}

      />

      <div className="app-body">

      <Sidebar

        activity={activity}

        panelOpen={panelOpen}

        onActivity={handleActivity}

        collections={collections}

        environments={environments}

        activeEnvId={activeEnvId}

        history={history}

        mock={mock}

        mockRunning={mockRunning}

        selectedRouteId={selectedRouteId}

        cookieJar={cookieJar}

        curTab={curTab}

        globals={globals}

        workMode={settings.workMode}

        activeRequestId={activeRequest ? activeRequest.id : null}

        onToast={showToast}

        importing={importing}

        onOpenRequest={handleOpenRequest}

        onOpenHistory={handleOpenHistoryItem}

        onDeleteHistory={handleDeleteHistoryItem}

        onClearHistory={handleClearHistory}

        onCopyHistoryCurl={handleCopyHistoryCurl}

        onMoveRequest={handleMoveRequest}

        onDeleteRequest={handleDeleteRequest}

        onNewRequest={handleNewTab}

        onNewCollection={handleNewCollection}

        onAddFolder={handleAddFolder}

        onRenameNode={handleRenameNode}

        onDeleteFolder={handleDeleteFolder}

        onDeleteCollection={handleDeleteCollection}

        onCollectionSettings={handleCollectionSettings}

        onOpenRunner={handleOpenRunner}

        onExportCollection={handleExportCollection}

        onImport={handleImport}

        onImportContent={applyImportContent}

        onExportAll={handleExportAll}

        onOpenEnv={(id) => openPageTab('env', { envId: id })}

        onNewEnv={handleNewEnv}

        onExportEnvs={handleExportAllEnvs}

        onSelectRoute={(id) => { setSelectedRouteId(id); openPageTab('mock'); }}

        onAddRoute={() => { handleAddRoute(); openPageTab('mock'); }}

        onOpenMock={() => openPageTab('mock')}

        onOpenCookies={() => openPageTab('cookies')}

        onOpenTool={(tool) => openPageTab('tool', { tool })}

        settings={settings}

        onChangeSettings={handleChangeSettings}

        onOpenSettings={() => setModal({ type: 'settings' })}

        noticeUnread={noticeUnread}

        onToggleNotices={handleToggleNotices}

        reveal={reveal}

        onRevealRequest={handleRevealActiveRequest}

      />

      <div className="main-area">

        {/* 发送中顶部流光进度条：比居中 spinner 感知等待更短 */}

        {curTab.sending && <div className="app-progress" aria-hidden="true"><span className="app-progress-bar" /></div>}

        <TabBar

          tabs={tabs}

          groups={tabGroups}

          activeTabId={curTab.id}

          tabMeta={tabMeta}

          isTabDirty={isTabDirty}

          rtState={rtState}

          onSelect={selectTab}

          onClose={handleCloseTab}

          onCloneTab={handleCloneTab}

          onNew={handleNewTab}

          onNewWs={() => handleNewRealtimeTab('ws')}

          onNewSse={() => handleNewRealtimeTab('sse')}

          onNewGroup={handleNewGroup}

          onAssignGroup={handleAssignGroup}

          onLeaveGroup={handleLeaveGroup}

          onCloseAll={handleCloseAll}

          onCloseToRight={handleCloseToRight}

          onCloseToLeft={handleCloseToLeft}

          onRenameGroup={handleRenameGroup}

          onRecolorGroup={handleRecolorGroup}

          onToggleGroupCollapse={handleToggleGroupCollapse}

          onUngroup={handleUngroup}

          onCloseGroup={handleCloseGroup}

          onTogglePinTab={handleTogglePinTab}

          onTogglePinGroup={handleTogglePinGroup}

        />

        <div className="page-body" ref={pageScope}>

        {curTab.kind === 'welcome' && (

          <WelcomePage

            version={appVersion}

            onNewRequest={handleNewTab}

            onOpenPalette={() => setPaletteOpen(true)}

            onOpenMock={() => openPageTab('mock')}

            onKbd={() => setKbdOpen(true)}

            onOpenAbout={() => setModal({ type: 'about' })}

          />

        )}

        {curTab.kind === 'request' && (

          <>

            {/* 标题行：请求名（点击重命名）+ 所属集合路径 + 保存按钮 */}

            <div className="title-row">

              <span className="req-title" title="点击重命名" onClick={handleRenameRequest}>

                {reqDisplayName(activeRequest)}<span className="req-title-edit"><JbIcon name="pencil" size={12} /></span>

              </span>

              {breadcrumb ? (

                <span className="title-crumbs">

                  {breadcrumb.map((seg, i) => (

                    <React.Fragment key={i}>

                      {i > 0 && <span className="crumb-sep">›</span>}

                      <span className="crumb">{seg}</span>

                    </React.Fragment>

                  ))}

                </span>

              ) : (

                <span className="title-unsaved">未保存到集合</span>

              )}

              <span className="flex-spacer" />

              <button className="btn-secondary btn-save-sm" title="保存请求 (Ctrl+S)" onClick={handleSaveRequest}>保存</button>

            </div>

            {/* 全宽请求顶栏：不受下方分栏影响，URL 完整可见 */}

            <RequestBar

              request={activeRequest}

              sending={curTab.sending}

              error={curTab.response && !curTab.response.ok}

              varNames={varNames}

              varMap={buildVarMap(activeEnv, globals)}

              activeEnv={activeEnv}

              urlHistory={urlHistory}

              onChange={setActiveRequest}

              onSend={handleSend}

              onCancel={handleCancelSend}

              onToast={showToast}

            />

            <div

              className={`request-workspace layout-${settings.layout} ${focusResponse ? 'focus-mode' : ''}`}

              ref={workspaceRef}

              style={{ '--split-v': settings.splitV + '%', '--split-h': settings.splitH + '%' }}

            >

              {!focusResponse && (

                <>

                  <RequestEditor

                    request={activeRequest}

                    varNames={varNames}

                    fontSize={settings.fontSize}

                    tabSize={settings.tabSize}

                    wordWrap={settings.wordWrap}

                    showLineNumbers={settings.lineNumbers}

                    varMap={buildVarMap(activeEnv, globals)}

                    ownerCollection={findOwnerCollection(collections, activeRequest.id)}

                    onChange={setActiveRequest}

                    onExampleToMock={handleExampleToMock}

                    headerPresets={settings.headerPresets}

                    onChangeHeaderPresets={(p) => handleChangeSettings({ headerPresets: p })}

                    paramPresets={settings.paramPresets}

                    onChangeParamPresets={(p) => handleChangeSettings({ paramPresets: p })}

                    workMode={settings.workMode}

                    variants={activeVariants}

                    activeRequestId={activeRequest ? activeRequest.id : null}

                    onSwitchVariant={handleSwitchVariant}

                    onSaveVariant={handleSaveVariant}

                    requestHistory={editorHistory}

                  />

                  {/* 分栏拖拽手柄：上下布局调高度、左右布局调宽度；双击复位默认比例 */}

                  <div

                    className={`split-resizer ${settings.layout === 'horizontal' ? 'split-resizer-h' : 'split-resizer-v'} ${splitDrag ? 'dragging' : ''}`}

                    title="拖拽调整分栏比例，双击复位"

                    onMouseDown={handleSplitDown}

                    onDoubleClick={() => handleChangeSettings({ splitV: 45, splitH: 50 })}

                  />

                </>

              )}

              <ResponsePanel

                response={curTab.response}

                requestId={activeRequest && activeRequest.id}

                sending={curTab.sending}

                fontSize={settings.fontSize}

                tabSize={settings.tabSize}

                wordWrap={settings.wordWrap}

                showLineNumbers={settings.lineNumbers}

                jsonExplorer={settings.jsonExplorer === true}

                scriptResult={curTab.scriptResult}

                onResponseToMock={handleResponseToMock}

                onSaveExample={handleSaveExample}

                onSaveBody={handleSaveResponseBody}

                onExtractVariable={handleExtractVariable}

                onToast={showToast}

                onInsertAssertion={handleInsertAssertion}

                layout={settings.layout}

                onToggleLayout={() => handleChangeSettings({ layout: settings.layout === 'vertical' ? 'horizontal' : 'vertical' })}

                focused={focusResponse}

                onToggleFocus={() => setFocusResponse((v) => !v)}

                historyList={curTab.responseHistory || []}

                onSelectHistory={handleSelectHistory}

                onRetry={handleSend}

                onRetryNoSsl={handleRetryNoSsl}

                onOpenConsole={() => setConsoleOpen(true)}

              />

            </div>

          </>

        )}

        {curTab.kind === 'mock' && (

          <MockPanel

            mock={mock}

            mockRunning={mockRunning}

            fontSize={settings.fontSize}

            tabSize={settings.tabSize}

            wordWrap={settings.wordWrap}

            showLineNumbers={settings.lineNumbers}

            mockBusy={mockBusy}

            mockLogs={mockLogs}

            selectedRouteId={selectedRouteId}

            onPortChange={(port) => setMock((prev) => ({ ...prev, port }))}

            onToggle={handleMockToggle}

            onUpdateRoute={handleUpdateRoute}

            onDeleteRoute={handleDeleteRoute}

            onRouteToRequest={handleRouteToRequest}

            onClearLogs={() => setMockLogs([])}

          />

        )}

        {curTab.kind === 'ws' && (

          <WsPanel

            tabId={curTab.id}

            config={curTab.config || {}}

            state={rtState[curTab.id]}

            varNames={varNames}

            varMap={buildVarMap(activeEnv, globals)}

            onChangeConfig={(config) => patchTab(curTab.id, { config })}

            onClear={() => setRtState((prev) => ({ ...prev, [curTab.id]: { ...(prev[curTab.id] || { connected: false }), events: [] } }))}

            onToast={showToast}

          />

        )}

        {curTab.kind === 'sse' && (

          <SsePanel

            tabId={curTab.id}

            config={curTab.config || {}}

            state={rtState[curTab.id]}

            varNames={varNames}

            varMap={buildVarMap(activeEnv, globals)}

            onChangeConfig={(config) => patchTab(curTab.id, { config })}

            onClear={() => setRtState((prev) => ({ ...prev, [curTab.id]: { ...(prev[curTab.id] || { connected: false }), events: [] } }))}

            onToast={showToast}

          />

        )}

        {curTab.kind === 'cookies' && (

          <CookiePanel

            jar={cookieJar}

            cookiesEnabled={settings.cookiesEnabled}

            onChangeJar={setCookieJar}

            onToggleEnabled={(v) => handleChangeSettings({ cookiesEnabled: v })}

          />

        )}

        {curTab.kind === 'tool' && (
          <ToolsPanel
            tool={curTab.tool}
            history={curTab.tool === 'analysis' ? history : undefined}
            collections={curTab.tool === 'analysis' ? collections : undefined}
            workMode={curTab.tool === 'analysis' ? settings.workMode : undefined}
          />
        )}

        {curTab.kind === 'runner' && (

          <RunnerPanel

            nodeId={curTab.nodeId}

            collections={collections}

            buildCtx={buildRunnerCtx}

            onToast={showToast}

          />

        )}

        {curTab.kind === 'env' && (

          curTab.envId === '__globals__' ? (

            <EnvironmentPanel

              environment={{ id: '__globals__', name: '全局变量', variables: globals }}

              isGlobal

              activeEnv={activeEnv}

              onChange={(env) => setGlobals(env.variables)}

              onExport={handleExportEnv}

            />

          ) : (

            <EnvironmentPanel

              environment={environments.find((e) => e.id === curTab.envId) || null}

              isActive={curTab.envId === activeEnvId}

              globals={globals}

              onChange={handleUpdateEnv}

              onDelete={handleDeleteEnv}

              onActivate={setActiveEnvId}

              onExport={handleExportEnv}

            />

          )

        )}

        </div>

      </div>

      {/* 右侧上下文工具条：代码/cURL/文档/变量预览 */}

      <UtilBar

        isRequestTab={curTab.kind === 'request'}

        request={activeRequest}

        onChangeRequest={setActiveRequest}

        onCodegen={() => setModal({ type: 'codegen' })}

        onCopyCurl={handleCopyCurl}

        varMap={buildVarMap(activeEnv, globals)}

        activeEnvName={activeEnv ? activeEnv.name : ''}

        environments={environments}

        activeEnvId={activeEnvId}

        onSelectEnv={setActiveEnvId}

        onRevealInTree={handleRevealActiveRequest}

      />

      </div>



      {/* 底部控制台抽屉：请求日志 / 脚本输出 / Mock 命中 */}

      <AnimatePresence initial={false}>

        {consoleOpen && (

          <motion.div

            className="console-wrap"

            initial={{ height: 0 }}

            animate={{ height: 220 }}

            exit={{ height: 0 }}

            transition={{ duration: 0.18, ease: 'easeOut' }}

          >

            <ConsolePanel

              requestLogs={consoleLogs}

              scriptLogs={scriptLogs}

              mockLogs={mockLogs}

              onClearRequests={() => setConsoleLogs([])}

              onClearScripts={() => setScriptLogs([])}

              onClearMock={() => setMockLogs([])}

              onClose={() => setConsoleOpen(false)}

            />

          </motion.div>

        )}

      </AnimatePresence>



      {/* 底部状态栏：Mock 状态 / 激活环境 / 控制台开关 / 当前响应摘要 / 快捷键速查 */}

      <div className="status-bar">

        <span

          className={`status-item status-clickable ${mockRunning ? 'status-item-on' : ''}`}

          title={mockRunning ? `Mock 服务运行中（端口 ${mock.port}），点击打开服务面板` : 'Mock 服务未启动，点击打开服务面板'}

          onClick={() => openPageTab('mock')}

        ><span className={`status-dot ${mockRunning ? 'on' : ''}`} />{mockRunning ? `Mock :${mock.port}` : 'Mock 未启动'}</span>

        <span

          className={`status-item ${activeEnvId ? 'status-clickable' : ''}`}

          title="当前激活环境"

          onClick={() => activeEnvId && openPageTab('env', { envId: activeEnvId })}

        ><JbIcon name="earth" size={12} /> {activeEnv ? activeEnv.name : '无环境'}</span>

        <span

          className={`status-item status-clickable ${consoleOpen ? 'status-item-on' : ''}`}

          title="打开/关闭控制台（请求日志 / 脚本输出 / Mock 命中）"

          onClick={() => setConsoleOpen(!consoleOpen)}

        ><JbIcon name="terminal" size={12} /> 控制台</span>

        <span className="flex-spacer" />

        {updateProgress != null && (

          <span className="status-item status-item-on" title="正在下载新版本安装包"><JbIcon name="update" size={12} /> 更新下载 {updateProgress}%</span>

        )}

        {curTab.kind === 'request' && curTab.sending && <span className="status-item status-item-on">发送中…</span>}

        {curTab.kind === 'request' && !curTab.sending && curTab.response && curTab.response.ok && (

          <span

            className="status-item"

            title={curTab.response.timings ? (

              ['dns:DNS', 'connect:TCP', 'tls:TLS', 'ttfb:首字节', 'download:下载']

                .map((s) => { const [k, label] = s.split(':'); return curTab.response.timings[k] != null ? `${label} ${curTab.response.timings[k]}ms` : null; })

                .filter(Boolean).join(' · ') || undefined

            ) : undefined}

          >

            {curTab.response.status} · {curTab.response.timeMs} ms · {formatKb(curTab.response.sizeBytes)}

          </span>

        )}

        {curTab.kind === 'request' && !curTab.sending && curTab.response && !curTab.response.ok && (

          <span className="status-item status-item-err">请求失败</span>

        )}

        <span className="status-item" title="打开的标签数">{tabs.length} 标签</span>

        {appVersion && (

          <span

            className="status-item status-clickable status-version"

            title="关于 ReqMock"

            onClick={() => setModal({ type: 'about' })}

          >v{appVersion}</span>

        )}

        <span

          className="status-item status-clickable"

          title="快捷键速查"

          data-kbd-toggle

          onClick={() => setKbdOpen(!kbdOpen)}

        ><JbIcon name="quick-guide" size={12} /></span>

      </div>



      <AnimatePresence>

        {kbdOpen && (

          <motion.div className="kbd-popover" {...popoverRise}>

            <div className="kbd-title">快捷键</div>

            {SHORTCUTS.map(([label, keys]) => (

              <div key={label} className="kbd-row">

                <span>{label}</span>

                <span className="kbd-key">{keys}</span>

              </div>

            ))}

          </motion.div>

        )}

      </AnimatePresence>



      {paletteOpen && (

        <CommandPalette

          collections={collections}

          environments={environments}

          history={history}

          mock={mock}

          activeEnvId={activeEnvId}

          onClose={() => setPaletteOpen(false)}

          onOpenRequest={handleOpenRequest}

          onOpenEnv={(id) => openPageTab('env', { envId: id })}

          onSelectRoute={(id) => { setSelectedRouteId(id); openPageTab('mock'); }}

          onOpenTool={(tool) => openPageTab('tool', { tool })}

          onNewTab={handleNewTab}

          onNewWs={() => handleNewRealtimeTab('ws')}

          onNewSse={() => handleNewRealtimeTab('sse')}

          onOpenMock={() => openPageTab('mock')}

          onOpenCookies={() => openPageTab('cookies')}

          onOpenSettings={() => setModal({ type: 'settings' })}

          onActivateEnv={setActiveEnvId}

        />

      )}



      {globalSearchOpen && (

        <GlobalSearch

          collections={collections}

          onClose={() => setGlobalSearchOpen(false)}

          onOpenRequest={handleOpenRequest}

        />

      )}



      {modal && modal.type === 'save' && (

        <SaveRequestModal

          collections={collections}

          defaultName={activeRequest ? activeRequest.name : ''}

          onConfirm={handleSaveConfirm}

          onClose={() => setModal(null)}

        />

      )}

      {modal && modal.type === 'curl' && (

        <CurlImportModal onConfirm={handleCurlImport} onClose={() => setModal(null)} />

      )}

      {modal && modal.type === 'codegen' && activeRequest && (

        <CodegenModal

          request={applyAuth(resolveRequest(activeRequest, buildVarMap(activeEnv, globals)))}

          onClose={() => setModal(null)}

        />

      )}

      {modal && modal.type === 'settings' && (

        <SettingsPage

          settings={settings}

          onChange={handleChangeSettings}

          onBackup={handleBackupData}

          onRestore={handleRestoreBackup}

          onCheckUpdate={handleCheckUpdate}

          onClose={() => setModal(null)}

        />

      )}

      {modal && modal.type === 'about' && (

        <AboutModal

          version={appVersion}

          onCheckUpdate={handleCheckUpdate}

          onClose={() => setModal(null)}

        />

      )}

      {modal && modal.type === 'exportCol' && (() => {

        const col = collections.find((c) => c.id === modal.colId);

        return col ? (

          <ExportCollectionModal collection={col} onConfirm={handleExportColConfirm} onClose={() => setModal(null)} />

        ) : null;

      })()}

      {prompt && (

        <PromptModal

          title={prompt.title}

          label={prompt.label}

          defaultValue={prompt.defaultValue}

          onConfirm={(value) => { setPrompt(null); prompt.onConfirm(value); }}

          onClose={() => setPrompt(null)}

        />

      )}

      {confirm && (

        <ConfirmModal

          title={confirm.title}

          message={confirm.message}

          danger={confirm.danger}

          onConfirm={() => { setConfirm(null); confirm.onConfirm(); }}

          onClose={() => setConfirm(null)}

        />

      )}

      {settingsCollection && (

        <CollectionSettingsModal

          collection={settingsCollection}

          onConfirm={(patch) => handleSettingsConfirm(modal.colId, patch)}

          onClose={() => setModal(null)}

        />

      )}



      <AnimatePresence>

        {noticesOpen && (

          <motion.div className="notice-popover" {...popoverRise}>

            <div className="notice-header">

            <span>通知中心</span>

            <span className="notice-actions">

              <button className="btn-text" onClick={() => { setNotices([]); setNoticeUnread(0); }}>清空</button>

              <button className="btn-text" onClick={() => setNoticesOpen(false)}><JbIcon name="close" size={12} /></button>

            </span>

            </div>

            <div className="notice-list">

              {notices.length === 0 && <div className="notice-empty">暂无通知</div>}

              {notices.map((n) => (

                <div key={n.id} className={`notice-item notice-${n.type}`}>

                  <div className="notice-text">{n.text}</div>

                  <div className="notice-time">{new Date(n.time).toLocaleTimeString()}</div>

                </div>

              ))}

            </div>

          </motion.div>

        )}

      </AnimatePresence>



      <AnimatePresence>

        {toast && (

          <motion.div className={`toast toast-${toast.type}`} {...toastSlide}>

            <span className="toast-icon">

              <JbIcon name={toast.type === 'success' ? 'checkmark' : toast.type === 'error' ? 'close' : toast.type === 'warn' ? 'warning' : 'info'} size={14} />

            </span>

            {toast.text}

          </motion.div>

        )}

      </AnimatePresence>



      {/* 全局拖拽导入遮罩 */}

      {dragImportOver && (

        <div className="drag-import-overlay">

          <div className="drag-import-box">

            <div className="drag-import-icon">⤓</div>

            <div>松开即导入集合 / 环境文件</div>

            <div className="drag-import-sub">支持 ReqMock / Postman / OpenAPI / Insomnia / HAR / Hoppscotch</div>

          </div>

        </div>

      )}

    </div>

    </MotionConfig>

  );

}

