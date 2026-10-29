import React, { useState, useMemo, useRef, useEffect, useCallback } from 'react';
import { motion, LayoutGroup } from 'framer-motion';
import { tokenizeJson, HIGHLIGHT_MAX_LENGTH } from '../utils/highlightUtil.js';
import JsonFormatWorker from '../utils/jsonFormatWorker.js?worker';
import { tryDecodeSelection } from '../utils/toolboxUtil.js';
import { explainRequestError } from '../utils/errorExplain.js';
import { diffLines, diffStats } from '../utils/diffUtil.js';
import { toCurl } from '../utils/curlUtil.js';
import CodeEditor from './CodeEditor.jsx';
import {
  JsonNodeExplorer, describeJsonValue, formatBytes, isContainer, pathSeg, resolveExplorer, scalarText, utf8Len
} from './JsonExplorer.jsx';
import { JbIcon } from './Icons.jsx';

/** 体内搜索最大命中数 */
const SEARCH_MAX_HITS = 5000;
/** Hex 视图最大显示字节数 */
const HEX_MAX_BYTES = 512 * 1024;
/** 响应体大文件阈值（1MB） */
const LARGE_BODY_THRESHOLD = 1024 * 1024;
/** 大文件最大显示行数 */
const LARGE_BODY_MAX_LINES = 5000;
/** 根节点子页签：超过此体积不拆分（避免重复解析超大 JSON） */
const ROOT_TABS_MAX_BYTES = 5 * 1024 * 1024;
/** 页签/视图顺序：切换时据序号差决定滑动方向 */
const RESP_TABS = ['body', 'headers', 'cookies', 'timings', 'trace', 'tests'];
/** 响应体视图：美化视图按内容类型展示，原始视图看原始内容，Diff 对比历史响应 */
const RESP_VIEWS = ['json', 'html', 'xml', 'javascript', 'raw', 'hex', 'base64', 'preview', 'diff'];
/** 美化类视图：走 CodeMirror 高亮 + 体内搜索 */
const PRETTY_VIEWS = ['json', 'html', 'xml', 'javascript'];
/** 视图切换按钮三组：美化视图 / 原始视图 / 对比，组间渲染分隔线（Diff 依赖历史响应，无基准时置灰） */
const VIEW_GROUPS = [[
  ['json', 'JSON'], ['html', 'HTML'], ['xml', 'XML'], ['javascript', 'JavaScript'],
], [
  ['raw', 'Raw'], ['hex', 'Hex'], ['base64', 'Base64'], ['preview', '预览'],
], [
  ['diff', 'Diff']
]];

/** 重内容延迟一帧挂载：先出骨架占位，待入场动画起步后再挂 CodeMirror 等大组件，避免同帧卡顿 */
function DeferredMount({ children }) {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const id = requestAnimationFrame(() => setReady(true));
    return () => cancelAnimationFrame(id);
  }, []);
  if (!ready) return <div className="pane-skeleton" aria-hidden="true"><i /><i /><i /></div>;
  return children;
}

/**
 * 发送实时计时器：sending=true 时每 100ms 递增显示
 */
function SendingTimer() {
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    const start = performance.now();
    const timer = setInterval(() => {
      setElapsed(Math.round((performance.now() - start) / 100) / 10);
    }, 100);
    return () => clearInterval(timer);
  }, []);
  return (
    <div className="sending-timer">
      <span className="sending-timer-dot" />
      <span className="sending-timer-text">
        发送中... {elapsed.toFixed(1)}s
      </span>
    </div>
  );
}

/**
 * 响应面板：状态行 + Response(JSON/HTML/XML/JavaScript/Raw/Hex/Base64/Diff 横向切换 + 搜索/下载)/Headers/测试 页签 + 响应历史回看 + 布局切换 + 响应转 Mock 按钮
 * 失败时展示诊断视图：错误解释 + 排查建议 + 实际发送的请求 + 重试/复制 cURL 等快捷动作
 */
export default function ResponsePanel({
  response, requestId, sending, scriptResult, onResponseToMock, onToast,
  layout, onToggleLayout, focused, onToggleFocus, historyList = [], onSelectHistory,
  onRetry, onRetryNoSsl, onOpenConsole,
  onSaveExample, onSaveBody, onExtractVariable, onInsertAssertion,
  fontSize, tabSize, wordWrap, showLineNumbers
}) {
  const [tab, setTab] = useState('body');
  const [view, setView] = useState('json');
  const [histOpen, setHistOpen] = useState(false); // 响应历史下拉
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [caseSense, setCaseSense] = useState(false);
  const [regexOn, setRegexOn] = useState(false);
  const [hitIdx, setHitIdx] = useState(0);
  const [wrapOn, setWrapOn] = useState(true); // 正文自动换行开关

  // 切换请求时清除搜索状态
  const prevRequestIdRef = useRef(requestId);
  if (requestId !== prevRequestIdRef.current) {
    prevRequestIdRef.current = requestId;
    if (searchOpen) { setSearchOpen(false); setQuery(''); setHitIdx(0); }
    setShowFullBody(false);
    setLoadingFull(false);
  }

  // 自动检测响应格式，切换最合适的视图
  const prevResponseRef = useRef(null);
  if (response && response !== prevResponseRef.current && response.ok) {
    prevResponseRef.current = response;
    const ct = (response.headers && (response.headers['content-type'] || response.headers['Content-Type']) || '').toLowerCase();
    if (ct.includes('json')) {
      setTab('body'); setView('json');
    } else if (ct.includes('html')) {
      setTab('body'); setView('preview');
    } else if (ct.includes('xml')) {
      setTab('body'); setView('json');
    } else if (ct.includes('image')) {
      setTab('body'); setView('preview');
    }
  }

  const [decodeTip, setDecodeTip] = useState(null); // { kind, text, x, y }
  const [showFullBody, setShowFullBody] = useState(false); // 加载所有内容
  const [loadingFull, setLoadingFull] = useState(false);
  const handleLoadFull = () => {
    setLoadingFull(true);
    // 延迟一帧让 loading 状态先渲染，再加载大内容
    requestAnimationFrame(() => {
      setTimeout(() => { setShowFullBody(true); setLoadingFull(false); }, 50);
    });
  };
  const contentRef = useRef(null);
  const searchInputRef = useRef(null);
  const paneKey = `${tab}-${view}`;
  const prevPaneKeyRef = useRef(paneKey);
  const paneDirRef = useRef(1);
  if (prevPaneKeyRef.current !== paneKey) {
    const rank = (t, v) => RESP_TABS.indexOf(t) * 10 + RESP_VIEWS.indexOf(v);
    const [pt, pv] = prevPaneKeyRef.current.split('-');
    paneDirRef.current = rank(tab, view) >= rank(pt, pv) ? 1 : -1;
    prevPaneKeyRef.current = paneKey;
  }

  // ── Web Worker 格式化：JSON parse + stringify 完全在独立线程执行，主线程零阻塞 ──
  const [fmtResult, setFmtResult] = useState(null); // { pretty, isJson }
  const workerRef = useRef(null);
  const fmtIdRef = useRef(0);

  // 创建 / 销毁 Worker（组件级单例）
  useEffect(() => {
    const w = new JsonFormatWorker();
    w.onmessage = (e) => {
      const { id, ok, pretty } = e.data;
      if (id === fmtIdRef.current) {
        setFmtResult(ok ? { pretty, isJson: true } : { pretty: '', isJson: false });
      }
    };
    workerRef.current = w;
    return () => { w.terminate(); workerRef.current = null; };
  }, []);

  // 响应变化时触发格式化（小响应同步，大响应走 Worker）
  useEffect(() => {
    if (!response || !response.ok) { setFmtResult(null); return; }
    const body = response.body;
    const id = ++fmtIdRef.current;
    // ≤500KB 同步处理（实测 <30ms）：避免 Worker 异步返回前 fmtResult=null 导致搜索视图瞬间显示未格式化原文
    if (body.length <= 500000) {
      try {
        const pretty = JSON.stringify(JSON.parse(body), null, 2);
        setFmtResult({ pretty, isJson: true });
      } catch (_e) {
        setFmtResult({ pretty: '', isJson: false });
      }
      return;
    }
    // 超大响应（>500KB）：先展示原始 body，Worker 后台格式化完成后自动替换
    setFmtResult(null);
    workerRef.current.postMessage({ id, body });
  }, [response]);

  // Pretty 视图文本 + 高亮 token（小响应同步 tokenize，大响应跳过 token 走 CodeMirror 内置高亮）
  const { prettyBody, tokens, fmtPending } = useMemo(() => {
    if (!response || !response.ok) return { prettyBody: '', tokens: null, fmtPending: false };
    // fmtResult 尚未就绪（Worker 处理中）时标记 pending，搜索视图回退 CodeMirror 避免显示原始单行 JSON
    const pending = !fmtResult && response.body.length > 500000;
    const body = fmtResult ? fmtResult.pretty : response.body;
    if (body.length <= HIGHLIGHT_MAX_LENGTH && fmtResult && fmtResult.isJson) {
      return { prettyBody: body, tokens: tokenizeJson(body), fmtPending: false };
    }
    return { prettyBody: body, tokens: null, fmtPending: pending };
  }, [response, fmtResult]);

  // 响应体是否为合法 JSON（决定 JSON 美化视图的语法高亮语言）
  const isJsonBody = useMemo(() => {
    if (!response || !response.ok) return false;
    if (fmtResult) return fmtResult.isJson;
    try { JSON.parse(response.body); return true; } catch { return false; }
  }, [response, fmtResult]);

  // ── 根节点子页签：对象/数组类根字段各成一个页签（内部为结构浏览器），标量根字段以「键 = 值」标签平铺 ──
  const [rootPref, setRootKey] = useState(undefined); // undefined = 自动（首个对象/数组字段），null = 完整 JSON
  const [nav, setNav] = useState(null);               // { root, path: string[], leaf, mode }：页签内的下钻位置
  const [nodeFilter, setNodeFilter] = useState('');
  const rootTabs = useMemo(() => {
    if (!response || !response.ok || !isJsonBody || response.body.length > ROOT_TABS_MAX_BYTES) return null;
    let data;
    try { data = JSON.parse(response.body); } catch { return null; }
    if (!data || typeof data !== 'object' || Array.isArray(data)) return null;
    const tabs = [];
    const scalars = [];
    for (const k of Object.keys(data)) {
      const v = data[k];
      if (isContainer(v)) tabs.push({ key: k, ...describeJsonValue(v), bytes: utf8Len(JSON.stringify(v)) });
      else scalars.push({ key: k, type: describeJsonValue(v).type, text: scalarText(v) });
    }
    if (tabs.length === 0) return null; // 全是标量时无需拆分
    return { data, tabs, scalars, totalBytes: utf8Len(response.body) };
  }, [response, isJsonBody]);
  // 当前根页签：用户选过且新响应仍有该字段则保持（便于重复发送时盯同一字段），否则落到首个对象/数组字段
  const rootKey = !rootTabs || rootPref === null ? null
    : (rootPref !== undefined && rootTabs.tabs.some((t) => t.key === rootPref)) ? rootPref
      : rootTabs.tabs[0].key;
  // 下钻位置随新响应保留：路径在新响应中缺失时自动停在最深的有效层
  const explorer = useMemo(() => {
    if (!rootTabs || rootKey === null) return null;
    const tabInfo = rootTabs.tabs.find((t) => t.key === rootKey);
    return resolveExplorer(rootTabs.data[rootKey], rootKey, tabInfo.bytes, nav && nav.root === rootKey ? nav : null);
  }, [rootTabs, rootKey, nav]);
  const explorerLeaf = useMemo(() => {
    if (!explorer || explorer.leaf === null) return null;
    return {
      key: explorer.leaf,
      meta: explorer.items.find((c) => c.key === explorer.leaf),
      path: explorer.path + pathSeg(explorer.isArr, explorer.leaf),
      text: scalarText(explorer.node[explorer.leaf])
    };
  }, [explorer]);
  const explorerJsonText = useMemo(
    () => (explorer && explorer.leaf === null && explorer.mode === 'json' ? JSON.stringify(explorer.node, null, 2) : ''),
    [explorer]
  );
  const showRootView = view === 'json' && !!explorer;
  const explorerText = explorerLeaf ? explorerLeaf.text : explorerJsonText;
  const explorerSig = explorer ? `${explorer.path}|${explorer.leaf ?? ''}|${explorer.mode}` : '';
  /** 进入某一层（keys 为相对根页签的路径），切层时清空节点筛选 */
  const goPath = (keys) => {
    setNav({ root: explorer.root, path: keys, leaf: null, mode: 'overview' });
    setNodeFilter('');
  };
  /** 点击子节点：对象/数组进入下一层，标量在当前层显示详情；null 回到当前层概览 */
  const selectChild = (k) => {
    if (k !== null && isContainer(explorer.node[k])) { goPath([...explorer.keys, k]); return; }
    setNav({ root: explorer.root, path: explorer.keys, leaf: k, mode: 'overview' });
  };
  const setExplorerMode = (m) => setNav({ root: explorer.root, path: explorer.keys, leaf: null, mode: m });
  const copyText = async (text, okMsg) => {
    try {
      await navigator.clipboard.writeText(text);
      onToast && onToast(okMsg);
    } catch (e) {
      onToast && onToast('复制失败：' + e.message);
    }
  };

  // 新响应到达：美化类视图按 Content-Type 自动对齐（Raw/Hex/Base64 保持用户选择）
  const lastRespRef = useRef(null);
  useEffect(() => {
    if (!response || !response.ok || lastRespRef.current === response) return;
    lastRespRef.current = response;
    setView((prev) => {
      if (!PRETTY_VIEWS.includes(prev)) return prev;
      const ctEntry = Object.entries(response.headers).find(([k]) => k.toLowerCase() === 'content-type');
      const ct = ctEntry ? ctEntry[1] : '';
      if (/json/i.test(ct)) return 'json';
      if (/html/i.test(ct)) return 'html';
      if (/xml/i.test(ct)) return 'xml';
      if (/javascript|ecmascript/i.test(ct)) return 'javascript';
      return 'raw';
    });
  }, [response]);

  // 体内搜索：把当前视图文本切成 普通段/命中段，命中段带序号；同时记录命中区间供高亮合并渲染
  const searchInfo = useMemo(() => {
    if (!searchOpen || !query || !response || !response.ok) return null;
    const text = view === 'raw' ? response.body : (showRootView ? explorerText : prettyBody);
    let re;
    try {
      const src = regexOn ? query : query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      re = new RegExp(src, caseSense ? 'g' : 'gi');
    } catch (e) {
      return { error: true, segments: null, hits: null, count: 0 };
    }
    const segments = [];
    const hits = [];
    let count = 0;
    let last = 0;
    let m;
    while ((m = re.exec(text)) !== null) {
      if (m[0] === '') { re.lastIndex++; continue; }
      if (m.index > last) segments.push({ t: text.slice(last, m.index) });
      hits.push({ start: m.index, end: m.index + m[0].length, idx: count });
      segments.push({ t: m[0], hit: count++ });
      last = m.index + m[0].length;
      if (count >= SEARCH_MAX_HITS) break;
    }
    if (last < text.length) segments.push({ t: text.slice(last) });
    return { error: false, segments, hits, count };
  }, [searchOpen, query, caseSense, regexOn, view, prettyBody, response, showRootView, explorerText]);

  const hitCount = searchInfo && !searchInfo.error ? searchInfo.count : 0;
  const curHit = hitCount > 0 ? ((hitIdx % hitCount) + hitCount) % hitCount : 0;

  // 搜索条件变化时回到第一个命中
  useEffect(() => { setHitIdx(0); }, [query, caseSense, regexOn, view, rootKey, explorerSig]);

  // Pretty 视图：将搜索查询传递给 CodeMirror 装饰系统
  const cmSearchQuery = useMemo(() => {
    if (!searchOpen || !PRETTY_VIEWS.includes(view) || !query) return null;
    try {
      const src = regexOn ? query : query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      return { query: new RegExp(src, caseSense ? 'g' : 'gi'), activeIdx: hitCount > 0 ? curHit : -1, _seq: hitIdx };
    } catch (_e) { return null; }
  }, [searchOpen, view, query, caseSense, regexOn, curHit, hitCount, hitIdx]);

  // 当前命中滚动到可视区域中央（非 Pretty 视图用 DOM scrollIntoView；依赖 hitIdx 确保单结果时按上下键也能重新定位）
  useEffect(() => {
    if (PRETTY_VIEWS.includes(view) || !contentRef.current) return;
    const el = contentRef.current.querySelector('.search-hit-active');
    if (el) el.scrollIntoView({ block: 'center' });
  }, [hitIdx, curHit, searchInfo, view]);

  // 打开搜索栏时聚焦输入框
  useEffect(() => {
    if (searchOpen && searchInputRef.current) searchInputRef.current.focus();
  }, [searchOpen]);

  // Ctrl/Cmd+F：打开响应体搜索栏并聚焦（输入框/可编辑编辑器内保留其自身的查找行为）
  useEffect(() => {
    const onKeyDown = (e) => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey || e.shiftKey) return;
      if (e.key.toLowerCase() !== 'f') return;
      if (!response || !response.ok) return;
      if (e.target instanceof Element && e.target.closest('input, textarea, [contenteditable="true"]')) return;
      e.preventDefault();
      setTab('body');
      if (searchOpen && searchInputRef.current) {
        searchInputRef.current.focus();
        searchInputRef.current.select();
      } else {
        setSearchOpen(true);
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [response, searchOpen]);

  // 历史下拉展开后：点击弹层外部或按 Esc 自动关闭
  useEffect(() => {
    if (!histOpen) return;
    const onMouseDown = (e) => {
      if (!(e.target instanceof Element)) return;
      if (e.target.closest('.resp-history-anchor')) return;
      setHistOpen(false);
    };
    const onKeyDown = (e) => { if (e.key === 'Escape') setHistOpen(false); };
    document.addEventListener('mousedown', onMouseDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onMouseDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [histOpen]);

  // 布局切换按钮：四种面板状态（空/发送中/成功/失败）均可达
  const layoutBtn = onToggleLayout ? (
    <button
      className="icon-btn"
      title={layout === 'vertical' ? '切换为左右分栏' : '切换为上下分栏'}
      onClick={onToggleLayout}
    >{layout === 'vertical' ? '◫' : '⊟'}</button>
  ) : null;

  // 专注模式按钮：临时隐藏请求编辑区，响应独占全屏（Esc 退出）
  const focusBtn = onToggleFocus ? (
    <button
      className={focused ? 'icon-btn on' : 'icon-btn'}
      title={focused ? '退出专注模式 (Esc)' : '专注响应：隐藏请求编辑区'}
      onClick={onToggleFocus}
    >{focused ? '⤢' : '⤡'}</button>
  ) : null;

  const cornerActions = <>{focusBtn}{layoutBtn}</>;

  // 响应历史回看：同一标签多次发送的响应可回看对比（会话级）
  const historyBtn = historyList.length > 1 ? (
    <span className="resp-history-anchor">
      <button
        className={histOpen ? 'icon-btn on' : 'icon-btn'}
        title="回看本标签最近的响应"
        onClick={() => setHistOpen(!histOpen)}
      >⏱ {historyList.length}</button>
      {histOpen && (
        <div className="ctx-menu resp-history-menu">
          {historyList.map((h) => (
            <div
              key={h.id}
              className="ctx-item"
              onClick={() => { setHistOpen(false); onSelectHistory && onSelectHistory(h); }}
            >
              <span className="ctx-check">{response === h.response ? <JbIcon name="checkmark" size={12} /> : ''}</span>
              {h.response.ok ? (
                <span className={`status-tag ${h.response.status < 400 ? 'status-good' : 'status-bad'}`}>{h.response.status}</span>
              ) : (
                <span className="status-tag status-bad">失败</span>
              )}
              <span className="ctx-label">{h.time}</span>
              {h.response.timeMs != null && <span className="ctx-kbd">{h.response.timeMs} ms</span>}
            </div>
          ))}
        </div>
      )}
    </span>
  ) : null;

  if (sending) {
    return (
      <div className="response-panel">
        <div className="response-corner">{cornerActions}</div>
        <SendingTimer />
        <div className="response-placeholder" aria-busy="true">
          <div className="resp-skeleton">
            <div className="skel-line w60" />
            <div className="skel-line w90" style={{marginLeft: 16}} />
            <div className="skel-line w75" style={{marginLeft: 16}} />
            <div className="skel-line w40" style={{marginLeft: 32}} />
            <div className="skel-line w85" style={{marginLeft: 32}} />
            <div className="skel-line w55" style={{marginLeft: 16}} />
            <div className="skel-line w30" />
          </div>
        </div>
      </div>
    );
  }
  if (!response) {
    return (
      <div className="response-panel">
        <div className="response-corner">{cornerActions}</div>
        <div className="response-placeholder">
          <div className="empty-hero">
            <span className="empty-hero-icon" aria-hidden="true"><JbIcon name="play" size={22} /></span>
            <div className="empty-hero-title">发送请求查看响应</div>
            <div className="empty-hero-subtitle">编辑左侧请求参数后点击发送，响应结果将在此展示</div>
            <div className="empty-hero-keys">
              <span className="kbd-chip"><JbIcon name="play" size={11} /> Shift + F10</span> 发送请求
              <span className="kbd-chip">Ctrl + Enter</span> 发送
              <span className="kbd-chip">Ctrl + F</span> 体内搜索
            </div>
            {historyList.length > 0 && (
              <div className="empty-hero-history">
                <div className="empty-hero-history-title"><JbIcon name="time" size={12} /> 最近请求</div>
                <div className="empty-hero-history-list">
                  {historyList.slice(0, 3).map((h) => (
                    <button
                      key={h.id}
                      className="empty-hero-history-item"
                      onClick={() => onSelectHistory && onSelectHistory(h)}
                    >
                      {h.response.ok ? (
                        <span className={`status-tag ${h.response.status < 400 ? 'status-good' : 'status-bad'}`}>{h.response.status}</span>
                      ) : (
                        <span className="status-tag status-bad">失败</span>
                      )}
                      <span className="empty-hero-history-time">{h.time}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}
            </div>
          </div>
        </div>
    );
  }
  if (!response.ok) {
    return (
      <FailureView
        response={response}
        scriptResult={scriptResult}
        historyBtn={historyBtn}
        layoutBtn={cornerActions}
        onRetry={onRetry}
        onRetryNoSsl={onRetryNoSsl}
        onOpenConsole={onOpenConsole}
        onToast={onToast}
      />
    );
  }

  const statusClass = response.status < 400 ? 'status-good' : 'status-bad';
  const testCount = scriptResult ? scriptResult.tests.length : 0;
  const testFailed = scriptResult ? scriptResult.tests.filter((t) => !t.passed).length : 0;
  const hasScriptInfo = scriptResult && (testCount > 0 || scriptResult.logs.length > 0 || scriptResult.errors.length > 0);
  const trace = response.trace || [];
  const setCookies = response.setCookies || [];

  /** 下载响应体：优先走 App 层保存通道（支持二进制 bodyBase64），否则按文本导出 */
  const handleDownload = async () => {
    if (onSaveBody) { onSaveBody(); return; }
    const ctEntry = Object.entries(response.headers).find(([k]) => k.toLowerCase() === 'content-type');
    const ext = contentTypeToExt(ctEntry ? ctEntry[1] : '');
    const res = await window.api.exportFile({
      defaultName: `response-${Date.now()}.${ext}`,
      content: response.body
    });
    if (res && res.ok) onToast && onToast('已保存：' + res.filePath);
    else if (res && res.error) onToast && onToast('保存失败：' + res.error);
  };

  /** 复制当前视图的响应体（Pretty 复制美化后文本，其他复制原文） */
  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(showRootView
        ? (explorerLeaf ? explorerLeaf.text : (explorerJsonText || JSON.stringify(explorer.node, null, 2)))
        : (PRETTY_VIEWS.includes(view) ? prettyBody : response.body));
      onToast && onToast(showRootView ? `已复制 ${explorerLeaf ? explorerLeaf.path : explorer.path}` : '已复制响应体');
    } catch (e) {
      onToast && onToast('复制失败：' + e.message);
    }
  };

  /** 选中文本尝试 JWT / Base64 即时解码，浮层跟随鼠标 */
  const handleMouseUp = (e) => {
    const sel = window.getSelection();
    const text = sel ? sel.toString().trim() : '';
    if (!text || text.length > 4096) { setDecodeTip(null); return; }
    const d = tryDecodeSelection(text);
    if (d) {
      setDecodeTip({
        ...d,
        x: Math.min(e.clientX + 8, window.innerWidth - 380),
        y: Math.min(e.clientY + 12, window.innerHeight - 200)
      });
    } else {
      setDecodeTip(null);
    }
  };

  /** 带搜索命中标记的正文渲染（Pretty 视图下命中区间与语法 token 合并，保留 JSON 高亮） */
  const searchActive = !!(searchInfo && !searchInfo.error && query);
  const renderTokenPiece = (tk, text, key) =>
    tk.type === 'plain' ? text : <span key={key} className={`tok-${tk.type}`}>{text}</span>;
  /** token 流按命中区间切片：命中片段包 mark 且叠加原 tok-* 颜色类 */
  const renderTokensWithHits = () => {
    const hits = searchInfo.hits;
    const out = [];
    let pos = 0;
    let hi = 0;
    let key = 0;
    for (const tk of tokens) {
      const end = pos + tk.text.length;
      let cur = pos;
      while (hi < hits.length && hits[hi].start < end) {
        const h = hits[hi];
        const s = Math.max(h.start, cur);
        const t = Math.min(h.end, end);
        if (s > cur) out.push(renderTokenPiece(tk, tk.text.slice(cur - pos, s - pos), key++));
        out.push(
          <mark
            key={key++}
            className={(h.idx === curHit ? 'search-hit search-hit-active' : 'search-hit') + (tk.type !== 'plain' ? ` tok-${tk.type}` : '')}
          >{tk.text.slice(s - pos, t - pos)}</mark>
        );
        cur = t;
        if (h.end <= end) hi++;
        else break;
      }
      if (cur < end) out.push(renderTokenPiece(tk, tk.text.slice(cur - pos), key++));
      pos = end;
    }
    return out;
  };
  const renderBodyText = () => {
    if (searchActive) {
      // Pretty 视图且有语法 token：合并渲染，既保留高亮又精确标记命中
      if (view === 'json' && tokens) return renderTokensWithHits();
      return searchInfo.segments.map((seg, i) =>
        seg.hit != null
          ? <mark key={i} className={seg.hit === curHit ? 'search-hit search-hit-active' : 'search-hit'}>{seg.t}</mark>
          : seg.t
      );
    }
    if (view === 'raw') return response.body;
    return tokens
      ? tokens.map((t, i) =>
          t.type === 'plain' ? t.text : <span key={i} className={`tok-${t.type}`}>{t.text}</span>
        )
      : prettyBody;
  };

  // Diff 对比基准：本标签历史中除当前外的成功响应
  const diffBases = historyList.filter((h) => h.response !== response && h.response.ok);

  return (
    <div className="response-panel">
      <div className="response-status">
        <span className={`status-tag ${statusClass}`}>{response.status} {response.statusText}</span>
        <span className="meta">HTTP/{response.httpVersion || '1.1'}</span>
        <span className="meta">{response.timeMs} ms</span>
        <span className="meta">{formatSize(response.sizeBytes)}</span>
        {response.fromHistory && <span className="meta" title="此为历史记录中保存的响应快照">📜 历史快照 {response.historyTime || ''}</span>}
        <span className="flex-spacer" />
        {onRetry && <button className="icon-btn" title="重新发送请求 (Shift+F10)" onClick={onRetry}><JbIcon name="update" size={14} /></button>}
        {historyBtn}
        {onSaveExample && <button className="btn-secondary" title="把当前响应保存为请求示例（示例可一键转 Mock）" onClick={onSaveExample}>存为示例</button>}
        <button className="btn-secondary" onClick={onResponseToMock}>响应转 Mock</button>
        {cornerActions}
      </div>

      <LayoutGroup id="resp-tabs">
      <div className="editor-tabs">
        <button className={tab === 'body' ? 'active' : ''} onClick={() => setTab('body')}>
          Response
          {tab === 'body' && <motion.span className="tab-indicator" layoutId="resp-tab-indicator" transition={{ type: 'spring', stiffness: 500, damping: 38 }} />}
        </button>
        <button className={tab === 'headers' ? 'active' : ''} onClick={() => setTab('headers')}>
          Headers
          <span className="tab-count">({Object.keys(response.headers).length})</span>
          {tab === 'headers' && <motion.span className="tab-indicator" layoutId="resp-tab-indicator" transition={{ type: 'spring', stiffness: 500, damping: 38 }} />}
        </button>
        {setCookies.length > 0 && (
          <button className={tab === 'cookies' ? 'active' : ''} onClick={() => setTab('cookies')}>
            Cookies
            <span className="tab-count">({setCookies.length})</span>
            {tab === 'cookies' && <motion.span className="tab-indicator" layoutId="resp-tab-indicator" transition={{ type: 'spring', stiffness: 500, damping: 38 }} />}
          </button>
        )}
        {response.timings && (
          <button className={tab === 'timings' ? 'active' : ''} onClick={() => setTab('timings')}>
            耗时
            {tab === 'timings' && <motion.span className="tab-indicator" layoutId="resp-tab-indicator" transition={{ type: 'spring', stiffness: 500, damping: 38 }} />}
          </button>
        )}
        {trace.length > 1 && (
          <button className={tab === 'trace' ? 'active' : ''} onClick={() => setTab('trace')}>
            重定向
            <span className="tab-count">({trace.length - 1})</span>
            {tab === 'trace' && <motion.span className="tab-indicator" layoutId="resp-tab-indicator" transition={{ type: 'spring', stiffness: 500, damping: 38 }} />}
          </button>
        )}
        {hasScriptInfo && (
          <button className={tab === 'tests' ? 'active' : ''} onClick={() => setTab('tests')}>
            测试 {testCount > 0 && (testFailed > 0 ? `(${testCount - testFailed}/${testCount} 通过)` : `(${testCount} 通过)`)}
            {tab === 'tests' && <motion.span className="tab-indicator" layoutId="resp-tab-indicator" transition={{ type: 'spring', stiffness: 500, damping: 38 }} />}
          </button>
        )}
      </div>
      </LayoutGroup>

      {tab === 'body' && (
        <div className="body-toolbar">
          {/* 视图切换：横向平铺（JSON/HTML/XML/JavaScript/Raw/Hex/Base64/Diff） */}
          <div className="view-switch">
            {VIEW_GROUPS.map((grp, gi) => (
              <React.Fragment key={gi}>
                {gi > 0 && <span className="view-sep" aria-hidden="true" />}
                {grp.map(([v, label]) => (
                  <button
                    key={v}
                    className={view === v ? 'active' : ''}
                    disabled={v === 'diff' && diffBases.length === 0}
                    title={v === 'diff' && diffBases.length === 0 ? '再次发送后可与历史响应对比' : undefined}
                    onClick={() => setView(v)}
                  >{label}</button>
                ))}
              </React.Fragment>
            ))}
          </div>
          <span className="flex-spacer" />
          <button
            className={searchOpen ? 'icon-btn on' : 'icon-btn'}
            title="在响应体中搜索"
            onClick={() => setSearchOpen(!searchOpen)}
          ><JbIcon name="search" size={14} /></button>
          <button
            className={wrapOn ? 'icon-btn on' : 'icon-btn'}
            title={wrapOn ? '关闭自动换行' : '开启自动换行'}
            onClick={() => setWrapOn(!wrapOn)}
          ><JbIcon name="wrap" size={14} /></button>
          <button className="icon-btn" title="复制响应体" onClick={handleCopy}><JbIcon name="copy" size={14} /></button>
          <button className="icon-btn" title="下载响应体为文件" onClick={handleDownload}><JbIcon name="download" size={14} /></button>
        </div>
      )}

      {tab === 'body' && view === 'json' && rootTabs && (
        <div className="root-tabs" role="tablist" aria-label="JSON 根节点">
          <span className="root-tabs-label">根节点</span>
          {rootTabs.tabs.map((t) => (
            <button
              key={t.key} role="tab" aria-selected={rootKey === t.key}
              className={`root-tab${rootKey === t.key ? ' active' : ''}`}
              title={`${t.key} · ${t.label} · ${formatBytes(t.bytes)}`}
              onClick={() => setRootKey(t.key)}
            >
              <span className="root-tab-key">{t.key}</span>
              <span className="root-tab-meta">{t.type === 'array' ? `${t.count} 项 · ` : ''}{formatBytes(t.bytes)}</span>
            </button>
          ))}
          <button
            role="tab" aria-selected={rootKey === null}
            className={`root-tab root-tab-full${rootKey === null ? ' active' : ''}`}
            title="显示完整响应"
            onClick={() => setRootKey(null)}
          >
            <span className="root-tab-key">完整 JSON</span>
            <span className="root-tab-meta">{formatBytes(rootTabs.totalBytes)}</span>
          </button>
          <span className="flex-spacer" />
          {rootTabs.scalars.map((sc) => (
            <button
              key={sc.key} className={`root-scalar type-${sc.type}`}
              title={`${sc.key} = ${sc.text}\n点击复制值`}
              onClick={() => copyText(sc.text, `已复制 ${sc.key}`)}
            >
              <span className="root-scalar-key">{sc.key}</span> = <span className="root-scalar-val">{sc.text}</span>
            </button>
          ))}
          {rootKey !== null && (
            <input
              className="root-node-filter"
              placeholder="搜索键名或内容"
              value={nodeFilter}
              onChange={(e) => setNodeFilter(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Escape') setNodeFilter(''); }}
            />
          )}
        </div>
      )}

      {tab === 'body' && searchOpen && (
        <div className="body-search-bar">
          <input
            ref={searchInputRef}
            className="body-search-input"
            placeholder="搜索响应体…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') setHitIdx(e.shiftKey ? hitIdx - 1 : hitIdx + 1);
              if (e.key === 'Escape') { setSearchOpen(false); setQuery(''); }
            }}
          />
          <button
            className={caseSense ? 'search-toggle on' : 'search-toggle'}
            title="区分大小写"
            onClick={() => setCaseSense(!caseSense)}
          >Aa</button>
          <button
            className={regexOn ? 'search-toggle on' : 'search-toggle'}
            title="正则表达式"
            onClick={() => setRegexOn(!regexOn)}
          >.*</button>
          <span className={`search-count ${searchInfo && searchInfo.error ? 'search-count-err' : ''}`}>
            {searchInfo && searchInfo.error
              ? '正则错误'
              : query ? `${hitCount ? curHit + 1 : 0}/${hitCount}` : ''}
          </span>
          <button className="search-toggle" title="上一个 (Shift+Enter)" disabled={!hitCount} onClick={() => setHitIdx(hitIdx - 1)}>↑</button>
          <button className="search-toggle" title="下一个 (Enter)" disabled={!hitCount} onClick={() => setHitIdx(hitIdx + 1)}>↓</button>
          <button className="search-toggle" title="关闭" onClick={() => { setSearchOpen(false); setQuery(''); }}><JbIcon name="close" size={12} /></button>
          {(view === 'hex' || view === 'base64') && <span className="env-hint">搜索仅在美化 / Raw 视图生效</span>}
        </div>
      )}

      <div className="response-content" ref={contentRef} onMouseUp={handleMouseUp}>
        {/* 页签/视图切换时方向滑动交叉淡出；滚动容器下沉到 pane 层；重内容延迟一帧挂载 */}
        <div className="response-pane">
        {/* 美化视图（JSON/HTML/XML/JavaScript）：始终使用 CodeMirror（内置 Ctrl+F 搜索 + 行号 + 层级折叠），避免自定义 mark 渲染大 JSON 时卡顿 */}
        {tab === 'body' && showRootView && (
          <DeferredMount key={'root-' + explorer.root}>
            <JsonNodeExplorer
              crumbs={explorer.crumbs}
              onCrumb={(d) => goPath(explorer.keys.slice(0, d))}
              items={explorer.items}
              isArray={explorer.isArr}
              nodeLabel={explorer.label}
              nodeBytes={explorer.bytes}
              leafKey={explorer.leaf}
              onSelectChild={selectChild}
              mode={explorer.mode}
              onMode={setExplorerMode}
              filter={nodeFilter}
              onCopy={handleCopy}
              detail={explorerLeaf ? (
                <div className="root-field-scalar-wrap">
                  <div className={`root-field-scalar type-${explorerLeaf.meta.type}`}>{explorerLeaf.text}</div>
                </div>
              ) : explorer.mode === 'json' ? (
                <div className="json-exp-editor">
                  <CodeEditor className="response-code" value={explorerJsonText} language="json" readOnly lineWrap={wrapOn} searchQuery={cmSearchQuery} fontSize={fontSize} tabSize={tabSize} wordWrap={wordWrap} showLineNumbers={showLineNumbers} />
                </div>
              ) : null}
            />
          </DeferredMount>
        )}
        {tab === 'body' && PRETTY_VIEWS.includes(view) && !showRootView && (
          <DeferredMount>
            {response.body.length > LARGE_BODY_THRESHOLD && !showFullBody && (
              <div className="large-body-banner">
                <JbIcon name="warning" size={14} />
                <span>响应体较大（{(response.body.length / 1024 / 1024).toFixed(2)} MB），仅显示前 {LARGE_BODY_MAX_LINES} 行</span>
                <span className="large-body-actions">
                  <button className="btn-secondary" disabled={loadingFull} onClick={handleLoadFull}>{loadingFull ? <><span className="btn-ring" /> 加载中…</> : '加载所有内容'}</button>
                  <button className="btn-secondary" onClick={handleDownload}>下载完整响应</button>
                </span>
              </div>
            )}
            <CodeEditor className="response-code" value={response.body.length > LARGE_BODY_THRESHOLD && !showFullBody ? prettyBody.split('\n').slice(0, LARGE_BODY_MAX_LINES).join('\n') : prettyBody} language={view === 'json' ? (isJsonBody ? 'json' : 'text') : view === 'javascript' ? 'javascript' : 'text'} readOnly lineWrap={wrapOn} searchQuery={cmSearchQuery} fontSize={fontSize} tabSize={tabSize} wordWrap={wordWrap} showLineNumbers={showLineNumbers} />
          </DeferredMount>
        )}
        {tab === 'body' && view === 'raw' && (
          <DeferredMount>
            {response.body.length > LARGE_BODY_THRESHOLD && !showFullBody && (
              <div className="large-body-banner">
                <JbIcon name="warning" size={14} />
                <span>响应体较大（{(response.body.length / 1024 / 1024).toFixed(2)} MB），仅显示前 {LARGE_BODY_MAX_LINES} 行</span>
                <span className="large-body-actions">
                  <button className="btn-secondary" disabled={loadingFull} onClick={handleLoadFull}>{loadingFull ? <><span className="btn-ring" /> 加载中…</> : '加载所有内容'}</button>
                  <button className="btn-secondary" onClick={handleDownload}>下载完整响应</button>
                </span>
              </div>
            )}
            <pre className={wrapOn ? 'response-body' : 'response-body nowrap'}>
              {response.body.length > LARGE_BODY_THRESHOLD && !showFullBody
                ? response.body.split('\n').slice(0, LARGE_BODY_MAX_LINES).join('\n')
                : renderBodyText()}
            </pre>
          </DeferredMount>
        )}
        {tab === 'body' && view === 'hex' && <DeferredMount><HexView text={response.body} /></DeferredMount>}
        {tab === 'body' && view === 'base64' && <DeferredMount><Base64View text={response.body} /></DeferredMount>}
        {tab === 'body' && view === 'preview' && (
          <div className="preview-view">
            {response.bodyBase64 && /^image\//i.test((response.headers || {})['content-type'] || '') ? (
              <img className="preview-img" src={`data:${(response.headers || {})['content-type']};base64,${response.bodyBase64}`} alt="响应图片" />
            ) : response.body && /^\s*</.test(response.body) ? (
              <iframe className="preview-frame" srcDoc={response.body} sandbox="" title="HTML 预览" />
            ) : (
              <div className="empty-hint">当前响应不支持预览（支持图片和 HTML 类型）</div>
            )}
          </div>
        )}
        {tab === 'body' && view === 'diff' && <DiffView response={response} bases={diffBases} />}
        {tab === 'headers' && (
          <table className="headers-table">
            <tbody>
              {Object.entries(response.headers).map(([k, v]) => (
                <tr key={k}>
                  <td className="header-key">{k}</td>
                  <td className="header-value">{v}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {tab === 'cookies' && (
          <table className="headers-table">
            <tbody>
              {setCookies.map((c, i) => (
                <tr key={i}>
                  <td className="header-key">Set-Cookie</td>
                  <td className="header-value">{typeof c === 'string' ? c : c.raw}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {tab === 'timings' && response.timings && <TimingsView timings={response.timings} />}
        {tab === 'trace' && <TraceView trace={trace} />}
        {tab === 'tests' && scriptResult && <ScriptResultView result={scriptResult} />}
        </div>
      </div>

      {decodeTip && (
        <div className="decode-tip" style={{ left: decodeTip.x, top: decodeTip.y }}>
          <div className="decode-tip-title">
            {decodeTip.kind === 'jwt' ? 'JWT 解码' : 'Base64 解码'}
            <span className="decode-tip-close" onClick={() => setDecodeTip(null)}><JbIcon name="close" size={12} /></span>
          </div>
          <pre className="decode-tip-body">{decodeTip.text}</pre>
        </div>
      )}
    </div>
  );
}

/**
 * 失败诊断视图：错误码/失败阶段 + 中文解释 + 原始错误 + 排查建议
 * + 实际发送的请求（变量已替换）+ 重试 / 关 SSL 重试 / 复制 cURL / 控制台入口
 */
function FailureView({ response, scriptResult, historyBtn, layoutBtn, onRetry, onRetryNoSsl, onOpenConsole, onToast }) {
  const explain = useMemo(() => explainRequestError(response), [response]);
  const finalReq = response.finalRequest || null;
  const failUrl = useMemo(() => buildSentUrl(finalReq), [finalReq]);
  const sentHeaders = finalReq
    ? (finalReq.headers || []).filter((h) => h.enabled !== false && h.key)
    : [];
  const failTrace = response.trace || [];

  const copyText = async (text, tip) => {
    try {
      await navigator.clipboard.writeText(text);
      onToast && onToast(tip);
    } catch (e) {
      onToast && onToast('复制失败：' + e.message);
    }
  };

  return (
    <div className="response-panel">
      <div className="response-status">
        <span className="status-tag status-bad">请求失败</span>
        {explain.code && <span className="fail-code-tag">{explain.code}</span>}
        {response.timeMs != null && <span className="meta">{response.timeMs} ms</span>}
        {explain.phaseLabel && <span className="meta">失败于：{explain.phaseLabel}</span>}
        <span className="flex-spacer" />
        {historyBtn}
        {layoutBtn}
      </div>
      <div className="fail-view">
        <div className="fail-card">
          <div className="fail-title">
            <span className="fail-icon"><JbIcon name="warning" size={20} /></span>
            <span>{explain.title}</span>
          </div>
          <div className="fail-raw-row">
            <pre className="fail-raw">{response.error || '（无错误详情）'}</pre>
            <button
              className="icon-btn"
              title="复制错误信息"
              onClick={() => copyText(
                [explain.title, response.error, explain.code ? `错误码: ${explain.code}` : '', explain.phaseLabel ? `阶段: ${explain.phaseLabel}` : ''].filter(Boolean).join('\n'),
                '已复制完整错误信息'
              )}
            ><JbIcon name="copy" size={14} /></button>
          </div>
          {response.errorStack && (
            <details className="fail-stack-details">
              <summary>错误堆栈</summary>
              <pre className="fail-raw fail-stack">{response.errorStack}</pre>
            </details>
          )}
          {explain.suggestions.length > 0 && (
            <div className="fail-suggests">
              <div className="fail-suggests-title">排查建议</div>
              {explain.suggestions.map((s, i) => (
                <div key={i} className="fail-suggest-item"><span className="fail-suggest-dot">•</span>{s}</div>
              ))}
            </div>
          )}
          <div className="fail-actions">
            {onRetry && <button className="btn-primary" onClick={onRetry}>重试</button>}
            {explain.sslRelated && onRetryNoSsl && (
              <button className="btn-secondary" onClick={onRetryNoSsl}>关闭 SSL 校验并重试</button>
            )}
            {finalReq && (
              <button className="btn-secondary" onClick={() => copyText(toCurl(finalReq), 'cURL 命令已复制')}>复制 cURL</button>
            )}
            {onOpenConsole && <button className="btn-secondary" onClick={onOpenConsole}>查看控制台日志</button>}
          </div>
        </div>

        {finalReq && (
          <details className="fail-section" open>
            <summary>实际发送的请求（变量已替换）</summary>
            <div className="fail-req-line">
              <span className={`method method-${finalReq.method}`}>{finalReq.method}</span>
              <span className="fail-req-url">{failUrl}</span>
              <button
                className="icon-btn"
                title="复制最终 URL"
                onClick={() => copyText(failUrl, '已复制最终 URL')}
              ><JbIcon name="copy" size={14} /></button>
            </div>
            {(finalReq.proxy || finalReq.timeoutMs) && (
              <div className="fail-req-meta">
                {finalReq.timeoutMs ? <span className="meta">超时：{finalReq.timeoutMs} ms</span> : null}
                {finalReq.proxy ? <span className="meta">代理：{finalReq.proxy}</span> : null}
              </div>
            )}
            {sentHeaders.length > 0 && (
              <table className="headers-table">
                <tbody>
                  {sentHeaders.map((h, i) => (
                    <tr key={i}>
                      <td className="header-key">{h.key}</td>
                      <td className="header-value">{h.value}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </details>
        )}

        {failTrace.length > 0 && (
          <details className="fail-section">
            <summary>失败前的重定向链路（{failTrace.length} 跳）</summary>
            <TraceView trace={failTrace} />
          </details>
        )}

        {scriptResult && <ScriptResultView result={scriptResult} />}
      </div>
    </div>
  );
}

/** 把 Params 表合进 URL，还原实际发出的最终地址（与 httpClient 拼接逻辑一致） */
function buildSentUrl(finalReq) {
  if (!finalReq) return '';
  try {
    const u = new URL(finalReq.url);
    for (const p of finalReq.params || []) {
      if (p.key) u.searchParams.delete(p.key);
    }
    for (const p of finalReq.params || []) {
      if (p.enabled !== false && p.key) u.searchParams.append(p.key, p.value ?? '');
    }
    return u.toString();
  } catch (e) {
    return finalReq.url || '';
  }
}


/** Base64 视图：响应体按 UTF-8 编码为 base64 文本（1MB 以上提示下载） */
function Base64View({ text }) {
  const b64 = useMemo(() => {
    if (text.length > LARGE_BODY_THRESHOLD) return null;
    const bytes = new TextEncoder().encode(text || '');
    let bin = '';
    const CHUNK = 0x8000;
    for (let i = 0; i < bytes.length; i += CHUNK) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
    return btoa(bin);
  }, [text]);
  if (b64 === null) return <div className="empty-hint" style={{ padding: 12 }}>响应体较大，Base64 视图仅支持 1MB 以内，请下载后查看</div>;
  return <pre className="response-body nowrap">{b64}</pre>;
}

/** JSON 优先美化后再逐行对比，非 JSON 按原文对比 */
function tryPretty(text) {
  try { return JSON.stringify(JSON.parse(text), null, 2); } catch (e) { return String(text ?? ''); }
}

/** Diff 视图：当前响应与本标签历史响应逐行对比，可切换对比基准 */
function DiffView({ response, bases }) {
  const [baseId, setBaseId] = useState(bases.length ? bases[0].id : null);
  const base = bases.find((h) => h.id === baseId) || bases[0] || null;

  const diff = useMemo(() => {
    if (!base) return null;
    return diffLines(tryPretty(base.response.body), tryPretty(response.body));
  }, [base, response]);
  const stats = diff ? diffStats(diff) : { added: 0, removed: 0 };

  if (!base) return <div className="empty-hint" style={{ padding: 12 }}>本标签暂无可对比的历史响应</div>;
  return (
    <div className="diff-view">
      <div className="diff-toolbar">
        <span className="meta">对比基准：</span>
        <select className="diff-base-select" value={base.id} onChange={(e) => setBaseId(e.target.value)}>
          {bases.map((h) => (
            <option key={h.id} value={h.id}>{h.time}（{h.response.status} / {h.response.timeMs} ms）</option>
          ))}
        </select>
        <span className="diff-stat diff-stat-add">+{stats.added}</span>
        <span className="diff-stat diff-stat-del">−{stats.removed}</span>
        {stats.added === 0 && stats.removed === 0 && <span className="meta">内容完全一致</span>}
      </div>
      <pre className="diff-body">
        {diff.map((d, i) => (
          <div key={i} className={`diff-line diff-${d.type}`}>
            <span className="diff-sign">{d.type === 'add' ? '+' : d.type === 'del' ? '−' : ' '}</span>{d.text}
          </div>
        ))}
      </pre>
    </div>
  );
}

/** Hex 视图：offset + 16 字节十六进制 + ASCII，超长截断 */
function HexView({ text }) {
  const { rows, truncated, total } = useMemo(() => {
    const bytes = new TextEncoder().encode(text || '');
    const limit = Math.min(bytes.length, HEX_MAX_BYTES);
    const rows = [];
    for (let off = 0; off < limit; off += 16) {
      const chunk = bytes.subarray(off, Math.min(off + 16, limit));
      let hex = '';
      let ascii = '';
      for (let i = 0; i < 16; i++) {
        if (i < chunk.length) {
          hex += chunk[i].toString(16).padStart(2, '0') + ' ';
          ascii += chunk[i] >= 0x20 && chunk[i] <= 0x7e ? String.fromCharCode(chunk[i]) : '·';
        } else {
          hex += '   ';
        }
        if (i === 7) hex += ' ';
      }
      rows.push({ offset: off.toString(16).padStart(8, '0'), hex, ascii });
    }
    return { rows, truncated: bytes.length > HEX_MAX_BYTES, total: bytes.length };
  }, [text]);

  return (
    <div className="hex-view">
      {rows.map((r) => (
        <div key={r.offset} className="hex-row">
          <span className="hex-offset">{r.offset}</span>
          <span className="hex-bytes">{r.hex}</span>
          <span className="hex-ascii">{r.ascii}</span>
        </div>
      ))}
      {truncated && <div className="env-hint">已截断，仅显示前 {HEX_MAX_BYTES / 1024} KB（共 {(total / 1024).toFixed(1)} KB）</div>}
    </div>
  );
}

/** 阶段耗时条形图：DNS / TCP / TLS / 首字节 / 下载 */
function TimingsView({ timings }) {
  const stages = [
    { key: 'dns', label: 'DNS 解析' },
    { key: 'connect', label: 'TCP 连接' },
    { key: 'tls', label: 'TLS 握手' },
    { key: 'ttfb', label: '等待首字节' },
    { key: 'download', label: '内容下载' }
  ].filter((s) => timings[s.key] != null && timings[s.key] >= 0);
  const total = Math.max(timings.total || 1, 1);

  return (
    <div className="timings-view">
      {stages.map((s) => (
        <div key={s.key} className="timing-row">
          <span className="timing-label">{s.label}</span>
          <div className="timing-bar-track">
            <div
              className="timing-bar"
              style={{ width: `${Math.max((timings[s.key] / total) * 100, 0.5)}%` }}
            />
          </div>
          <span className="timing-value">{timings[s.key]} ms</span>
        </div>
      ))}
      <div className="timing-row timing-total">
        <span className="timing-label">总耗时（末跳）</span>
        <div className="timing-bar-track" />
        <span className="timing-value">{timings.total} ms</span>
      </div>
      <div className="env-hint">复用连接时无 DNS / 连接 / 握手阶段；多次重定向时仅统计最后一跳</div>
    </div>
  );
}

/** 重定向链路列表 */
function TraceView({ trace }) {
  return (
    <div className="trace-view">
      {trace.map((t, i) => (
        <div key={i} className="trace-item">
          <span className="trace-index">{i + 1}</span>
          <span className={`status-tag ${t.status < 400 ? 'status-good' : 'status-bad'}`}>{t.status}</span>
          <span className={`method method-${t.method}`}>{t.method}</span>
          <span className="trace-url" title={t.url}>{t.url}</span>
          <span className="meta">{t.timeMs} ms</span>
        </div>
      ))}
    </div>
  );
}

/** 脚本执行结果：测试断言 + 控制台输出 + 脚本错误 */
function ScriptResultView({ result }) {
  const { tests, logs, errors } = result;
  return (
    <div className="script-result">
      {errors.map((err, i) => (
        <div key={'e' + i} className="script-error">脚本错误：{err}</div>
      ))}
      {tests.length > 0 && (
        <div className="test-list">
          {tests.map((t, i) => (
            <div key={i} className={`test-item ${t.passed ? 'test-pass' : 'test-fail'}`}>
              <span>{t.passed ? <JbIcon name="checkmark" size={12} /> : <JbIcon name="close" size={12} />}</span>
              <span>{t.name}</span>
              {!t.passed && t.error && <span className="test-error-msg">— {t.error}</span>}
            </div>
          ))}
        </div>
      )}
      {logs.length > 0 && (
        <div className="script-console">
          <div className="script-title">控制台输出</div>
          {logs.map((l, i) => (
            <pre key={i} className={`console-line console-${l.level}`}>{l.text}</pre>
          ))}
        </div>
      )}
      {tests.length === 0 && logs.length === 0 && errors.length === 0 && (
        <div className="empty-hint">脚本未产生测试或输出</div>
      )}
    </div>
  );
}

/** Content-Type → 下载文件扩展名 */
function contentTypeToExt(ct) {
  const t = String(ct || '').toLowerCase();
  if (t.includes('json')) return 'json';
  if (t.includes('html')) return 'html';
  if (t.includes('xml')) return 'xml';
  if (t.includes('csv')) return 'csv';
  if (t.includes('javascript')) return 'js';
  if (t.includes('css')) return 'css';
  if (t.includes('markdown')) return 'md';
  if (t.includes('text/')) return 'txt';
  return 'bin';
}

function formatSize(bytes) {
  if (bytes == null) return '';
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / 1024 / 1024).toFixed(2) + ' MB';
}
