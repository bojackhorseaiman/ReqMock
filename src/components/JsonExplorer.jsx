import React, { useMemo, useState } from 'react';
import { JsonValueView, isTreeable, special } from './JsonTreeView.jsx';

/**
 * JSON 结构浏览器：根节点子页签内部视图（交互参考 njbp-tools/onlineissue 的 monitor_view.js）
 *   左侧：概览 + 当前层子节点列表（键名 + 体积；搜索时显示命中数）
 *   右侧：概览表（节点 / 类型 / 大小 / 占比 / 内容预览）；点击节点在右侧美化展示（树 / 表格 / 专用视图）
 *   对象/数组可「进入」作为当前层继续下钻，上方路径可跳回任意一层
 */

/** 列表/概览表最多渲染行数（超大数组避免卡顿，可用搜索缩小范围） */
const LIST_MAX = 1000;

export const hasOwn = (o, k) => Object.prototype.hasOwnProperty.call(o, k);

export const isContainer = (v) => v !== null && typeof v === 'object';

/** UTF-8 字节数（逐字符计数，不分配缓冲区） */
export function utf8Len(s) {
  let n = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c < 0x80) n += 1;
    else if (c < 0x800) n += 2;
    else if (c >= 0xd800 && c <= 0xdbff) { n += 4; i++; }
    else n += 3;
  }
  return n;
}

export function formatBytes(b) {
  if (b < 1024) return b + ' B';
  if (b < 1024 * 1024) return (b / 1024).toFixed(1) + ' KB';
  return (b / 1024 / 1024).toFixed(1) + ' MB';
}

/** 类型描述：type 用于配色，label 用于展示 */
export function describeJsonValue(v) {
  if (v === null) return { type: 'null', label: 'null' };
  if (Array.isArray(v)) return { type: 'array', label: `数组 · ${v.length} 项`, count: v.length };
  if (typeof v === 'object') {
    const n = Object.keys(v).length;
    return { type: 'object', label: `对象 · ${n} 个键`, count: n };
  }
  if (typeof v === 'string') return { type: 'string', label: `字符串 · ${v.length} 字符` };
  if (typeof v === 'number') return { type: 'number', label: '数字' };
  return { type: 'boolean', label: '布尔' };
}

/** 标量展示文本：字符串不带引号 */
export const scalarText = (v) => (typeof v === 'string' ? v : String(v));

/** JSONPath 片段：数组 [i]，标识符 .key，其它键 ["key"] */
export function pathSeg(parentIsArray, key) {
  if (parentIsArray) return `[${key}]`;
  return /^[A-Za-z_$][\w$]*$/.test(key) ? `.${key}` : `[${JSON.stringify(key)}]`;
}

/** 构建子节点列表：键 / 展示名 / 类型 / 字节数 / 预览 / 搜索串 */
export function buildChildren(node) {
  const isArr = Array.isArray(node);
  const keys = isArr ? node.map((_, i) => String(i)) : Object.keys(node);
  return keys.map((k) => {
    const v = node[k];
    const compact = JSON.stringify(v) ?? 'null';
    return {
      key: k,
      name: isArr ? `[${k}]` : k,
      ...describeJsonValue(v),
      bytes: utf8Len(compact),
      preview: compact.length > 300 ? compact.slice(0, 300) + '…' : compact,
      hay: (k + '\u0000' + compact).toLowerCase()
    };
  });
}

/**
 * 按导航状态解析当前所在节点：沿 want.path 逐层下钻，新响应缺失某一层时停在最深的有效层
 * @param want { path: string[], leaf: string|null, mode: 'overview'|'json' } | null
 * @param opts { label?, path? } 根层显示名与 JSONPath（默认取 rootKey / $.rootKey）
 */
export function resolveExplorer(rootNode, rootKey, rootBytes, want, opts = {}) {
  const w = want || { path: [], leaf: null, mode: 'overview' };
  let node = rootNode;
  let path = opts.path ?? ('$' + pathSeg(false, rootKey));
  const crumbs = [{ label: opts.label ?? rootKey, path }];
  const keys = [];
  for (const k of w.path) {
    if (!hasOwn(node, k) || !isContainer(node[k])) break;
    path += pathSeg(Array.isArray(node), k);
    crumbs.push({ label: Array.isArray(node) ? `[${k}]` : k, path });
    node = node[k];
    keys.push(k);
  }
  const complete = keys.length === w.path.length;
  const leaf = complete && w.leaf != null && hasOwn(node, w.leaf) ? w.leaf : null;
  return {
    root: rootKey, node, keys, crumbs, path, leaf,
    items: buildChildren(node),
    isArr: Array.isArray(node),
    label: describeJsonValue(node).label,
    bytes: keys.length === 0 && rootBytes != null ? rootBytes : utf8Len(JSON.stringify(node)),
    mode: complete && leaf === null && w.mode === 'json' ? 'json' : 'overview'
  };
}

function pctText(p) {
  if (p === 0) return '0%';
  if (p < 0.1) return '<0.1%';
  return p.toFixed(1) + '%';
}

/** 搜索命中次数（最多数到 999） */
function countHits(text, ql) {
  let n = 0;
  let i = 0;
  while (n < 999 && (i = text.indexOf(ql, i)) !== -1) { n++; i += ql.length; }
  return n;
}

const PANE_DEFAULT = { mode: '', seq: 0, raw: false };

/**
 * 结构浏览器
 *   点击左侧节点 / 概览表一行：右侧美化展示该节点（与 onlineissue 一致）
 *   对象/数组：标题栏「进入下一层」、树中节点的「进入」、双击左侧节点 → 作为当前层继续下钻
 *   键盘：Backspace 或 Alt+← 返回（先回到概览，再回上一层）
 */
export function JsonNodeExplorer({
  crumbs, onCrumb, node, items, isArray, nodeLabel, nodeBytes,
  leafKey, onSelectChild, onEnter, mode, onMode, filter, onCopy, detail
}) {
  const q = (filter || '').trim();
  const f = q.toLowerCase();
  const hits = useMemo(() => {
    if (!f) return null;
    const m = new Map();
    for (const c of items) m.set(c.key, countHits(c.hay, f));
    return m;
  }, [items, f]);
  // 搜索时只留命中的节点（当前选中的节点即使没命中也保留，避免右侧内容「消失」）
  const shown = useMemo(() => (hits ? items.filter((c) => hits.get(c.key) > 0 || c.key === leafKey) : items), [items, hits, leafKey]);
  const list = shown.length > LIST_MAX ? shown.slice(0, LIST_MAX) : shown;
  const leaf = leafKey !== null ? items.find((c) => c.key === leafKey) || null : null;
  const depth = crumbs.length - 1;
  const cur = crumbs[depth];
  const showDetail = !!leaf || mode === 'json';

  // 详情展示方式（展开全部 / 收起全部 / 美化⇄树形）：换节点时自动回到默认
  const paneKey = cur.path + '\u0000' + (leafKey ?? '');
  const [pane, setPane] = useState({ key: paneKey, ...PANE_DEFAULT });
  const ps = pane.key === paneKey ? pane : { key: paneKey, ...PANE_DEFAULT };
  const leafVal = leaf ? node[leaf.key] : undefined;
  const leafSpecial = leaf ? special(leafVal) : null;
  const leafTree = leaf ? isTreeable(leafVal) : false;
  const leafEnterable = leaf && (leaf.type === 'object' || leaf.type === 'array') && leaf.count > 0;

  const goUp = () => {
    if (leaf) onSelectChild(null);
    else if (depth > 0) onCrumb(depth - 1);
  };
  const onKeyDown = (e) => {
    if (e.target.closest && e.target.closest('input, textarea, .cm-editor')) return;
    if (e.key === 'Backspace' || (e.altKey && e.key === 'ArrowLeft')) { e.preventDefault(); goUp(); }
  };
  const hitBadge = (k) => hits && <span className={`json-exp-hits${hits.get(k) ? '' : ' zero'}`}>{hits.get(k)}</span>;
  const emptyHint = items.length === 0 && <div className="json-exp-more">（空{isArray ? '数组' : '对象'}）</div>;
  const noMatch = f && items.length > 0 && shown.length === 0 && <div className="json-exp-more">没有节点包含「{q}」</div>;

  return (
    <div className="json-exp" tabIndex={-1} onKeyDown={onKeyDown}>
      <aside className="json-exp-side">
        {depth > 0 && (
          <div className="json-exp-item up" title={`返回上一层 ${crumbs[depth - 1].path}（Backspace）`} onClick={() => onCrumb(depth - 1)}>
            <span className="json-exp-item-name">‹ {crumbs[depth - 1].label}</span>
            <span className="json-exp-item-size">上一层</span>
          </div>
        )}
        <div className={`json-exp-item overview${showDetail ? '' : ' active'}`} title={cur.path} onClick={() => onSelectChild(null)}>
          <span className="json-exp-item-name">概览</span>
          <span className="json-exp-item-size">{f ? `${shown.length}/${items.length}` : items.length} 个节点</span>
        </div>
        {list.map((c) => {
          const canEnter = (c.type === 'object' || c.type === 'array') && c.count > 0;
          return (
            <div
              key={c.key}
              className={`json-exp-item${c.key === leafKey ? ' active' : ''}`}
              title={`${c.name}\n${c.label} · ${formatBytes(c.bytes)}${canEnter ? '\n双击进入下一层' : ''}`}
              onClick={() => onSelectChild(c.key)}
              onDoubleClick={canEnter ? () => onEnter([c.key]) : undefined}
            >
              <span className="json-exp-item-name">{hits ? hlText(c.name, q) : c.name}</span>
              {hits ? hitBadge(c.key) : <span className="json-exp-item-size">{formatBytes(c.bytes)}</span>}
            </div>
          );
        })}
        {shown.length > LIST_MAX && <div className="json-exp-more">仅列出前 {LIST_MAX} 项，可用右上角搜索缩小范围</div>}
        {emptyHint}
        {noMatch}
      </aside>

      <section className="json-exp-main">
        <div className="json-exp-head">
          <nav className="json-exp-crumbs" aria-label="节点路径" title={leaf ? cur.path + pathSeg(isArray, leaf.key) : cur.path}>
            {crumbs.map((c, i) => (
              <React.Fragment key={i}>
                {i > 0 && <span className="json-exp-crumb-sep">›</span>}
                {i === depth && !leaf
                  ? <span className="json-exp-crumb current">{c.label}</span>
                  : <button className="json-exp-crumb" title={c.path} onClick={() => onCrumb(i)}>{c.label}</button>}
              </React.Fragment>
            ))}
            {leaf && (
              <>
                <span className="json-exp-crumb-sep">›</span>
                <span className="json-exp-crumb current">{leaf.name}</span>
              </>
            )}
          </nav>
          <span className={`json-exp-type type-${leaf ? leaf.type : (isArray ? 'array' : 'object')}`}>{leaf ? leaf.label : nodeLabel}</span>
          <span className="json-exp-size">{formatBytes(leaf ? leaf.bytes : nodeBytes)}</span>
          <span className="flex-spacer" />
          {leaf ? (
            <div className="json-exp-tools">
              {leafSpecial && (
                <button className="json-exp-tool" title={ps.raw ? '切回专用美化视图' : '查看原始树形结构'} onClick={() => setPane({ ...ps, raw: !ps.raw })}>
                  {ps.raw ? '美化展示' : '树形结构'}
                </button>
              )}
              {leafTree && (!leafSpecial || ps.raw) && (
                <>
                  <button className="json-exp-tool" onClick={() => setPane({ ...ps, mode: 'all', seq: ps.seq + 1 })}>展开全部</button>
                  <button className="json-exp-tool" onClick={() => setPane({ ...ps, mode: 'none', seq: ps.seq + 1 })}>收起全部</button>
                </>
              )}
              {leafEnterable && (
                <button className="json-exp-tool" title="把该节点作为当前层，在左侧列出它的子节点" onClick={() => onEnter([leaf.key])}>进入下一层 ›</button>
              )}
            </div>
          ) : (
            <div className="json-exp-modes" role="tablist" aria-label="展示方式">
              <button role="tab" aria-selected={mode !== 'json'} className={mode !== 'json' ? 'active' : ''} onClick={() => onMode('overview')}>概览</button>
              <button role="tab" aria-selected={mode === 'json'} className={mode === 'json' ? 'active' : ''} onClick={() => onMode('json')}>JSON</button>
            </div>
          )}
          <button className="btn-secondary json-exp-copy" title={leaf ? '复制该节点' : '复制当前层 JSON'} onClick={onCopy}>复制</button>
        </div>

        {leaf ? (
          (leafTree || leafSpecial) ? (
            <JsonValueView
              key={`${paneKey}|${ps.mode}|${ps.seq}|${ps.raw}|${q}`}
              value={leafVal}
              q={q}
              mode={ps.mode}
              raw={ps.raw}
              onEnter={(ks) => onEnter([leaf.key, ...ks])}
            />
          ) : (
            <div className="root-field-scalar-wrap">
              <div className={`root-field-scalar type-${leaf.type}`}>{scalarText(leafVal)}</div>
            </div>
          )
        ) : mode === 'json' ? detail : (
          <div className="json-exp-overview">
            <div className="json-exp-hint">点击一行查看该节点；对象/数组可「进入下一层」（或双击左侧节点）；上方路径可跳回任意一层，Backspace 返回</div>
            <table className="json-exp-table">
              <colgroup>
                <col style={{ width: '22%' }} /><col style={{ width: 120 }} /><col style={{ width: 90 }} />
                <col style={{ width: 180 }} /><col />
              </colgroup>
              <thead>
                <tr><th>节点</th><th>类型</th><th className="c-size">大小</th><th>占比</th><th>内容预览</th></tr>
              </thead>
              <tbody>
                {list.map((c) => {
                  const pct = nodeBytes > 0 ? (c.bytes / nodeBytes) * 100 : 0;
                  return (
                    <tr key={c.key} onClick={() => onSelectChild(c.key)}>
                      <td className="c-name" title={c.name}>{hits ? hlText(c.name, q) : c.name}{hitBadge(c.key)}</td>
                      <td className="c-type">{c.label}</td>
                      <td className={`c-size${pct >= 20 ? ' big' : ''}`}>{formatBytes(c.bytes)}</td>
                      <td className="c-pct">
                        <span className="json-exp-bar"><i style={{ width: `${Math.min(100, pct)}%` }} /></span>
                        {pctText(pct)}
                      </td>
                      <td className={`c-preview type-${c.type}`} title={c.preview}>{c.preview}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {emptyHint}
            {noMatch}
          </div>
        )}
      </section>
    </div>
  );
}

/** 左侧列表 / 概览表中的键名高亮 */
function hlText(text, q) {
  if (!q) return text;
  const lowText = text.toLowerCase();
  const ql = q.toLowerCase();
  const out = [];
  let last = 0;
  let i;
  let n = 0;
  while ((i = lowText.indexOf(ql, last)) !== -1 && n < 50) {
    if (i > last) out.push(text.slice(last, i));
    out.push(<mark className="jv-hl" key={n++}>{text.slice(i, i + q.length)}</mark>);
    last = i + q.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}
