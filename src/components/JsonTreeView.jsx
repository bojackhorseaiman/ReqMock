import React, { useState } from 'react';

/**
 * JSON 节点美化展示（参考 njbp-tools/onlineissue 的 monitor_view.js）
 *   - 可折叠的树：子节点在展开时才渲染；默认展开 2 层（子节点 ≤ 60 的节点），独生子节点自动展开
 *   - JSON 字符串（"{...}" / "[...]"）自动解析成树并标注；http(s) 地址可点击
 *   - 对象数组（元素都是简单键值）用表格展示
 *   - pdsResult（设备能力开关 / 列表能力）、[step]（分支执行器）专用视图，可切回树形结构
 *   - 搜索：高亮命中，并自动展开包含命中的路径
 */

const CHILD_LIMIT = 200;        // 一次最多展示的子节点数，多的点「显示更多」
const OPEN_DEPTH = 2;           // 默认展开的层级
const OPEN_MAX_CHILDREN = 60;   // 子节点超过这个数的节点默认不展开
const OPEN_BUDGET = 3000;       // 展开全部 / 搜索自动展开时最多展开的子节点总数（避免卡顿）
const CHIP_LIMIT = 60;          // 列表能力每项最多直接展示的值

const hasOwn = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const isComplex = (v) => v !== null && typeof v === 'object';
const count = (v) => (Array.isArray(v) ? v.length : Object.keys(v).length);
const isOn = (v) => v === 1 || v === true || v === '1' || v === 'true';
const isOff = (v) => v === 0 || v === false || v === '0' || v === 'false';

const strCache = new WeakMap();
const lowCache = new WeakMap();
/** 紧凑 JSON（对象按引用缓存，避免重复序列化大节点） */
export function str(v) {
  if (!isComplex(v)) { const s0 = JSON.stringify(v); return s0 === undefined ? '' : s0; }
  let s = strCache.get(v);
  if (s === undefined) { try { s = JSON.stringify(v) || ''; } catch (e) { s = ''; } strCache.set(v, s); }
  return s;
}
function low(v) {
  if (!isComplex(v)) return String(v).toLowerCase();
  let s = lowCache.get(v);
  if (s === undefined) { s = str(v).toLowerCase(); lowCache.set(v, s); }
  return s;
}

/** 值是 JSON 字符串（对象 / 数组）时解析出来，否则返回 undefined */
export function parseJsonStr(s) {
  if (typeof s !== 'string' || s.length < 2) return undefined;
  const t = s.trim();
  const a = t.charAt(0);
  const b = t.charAt(t.length - 1);
  if (!((a === '{' && b === '}') || (a === '[' && b === ']'))) return undefined;
  try { const v = JSON.parse(t); return isComplex(v) ? v : undefined; } catch (e) { return undefined; }
}

/** 能否用树 / 专用视图展示（对象、数组、JSON 字符串） */
export const isTreeable = (v) => isComplex(v) || parseJsonStr(v) !== undefined;

const reEsc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** 高亮搜索词 */
function hl(text, q) {
  text = String(text);
  if (!q) return text;
  const re = new RegExp(reEsc(q), 'ig');
  const out = [];
  let last = 0;
  let m;
  let i = 0;
  while ((m = re.exec(text)) && i < 500) {
    if (m.index > last) out.push(text.slice(last, m.index));
    out.push(<mark className="jt-hl" key={i++}>{m[0]}</mark>);
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

/** http(s) 地址转成链接（新窗口 → 主进程交给系统浏览器打开） */
const URL_RE = /https?:\/\/[^\s"'<>\\]+/g;
function linkify(text) {
  text = String(text);
  const out = [];
  let last = 0;
  let m;
  let i = 0;
  URL_RE.lastIndex = 0;
  while ((m = URL_RE.exec(text))) {
    const u = m[0].replace(/[,;.)\]}]+$/, '');
    if (m.index > last) out.push(text.slice(last, m.index));
    out.push(<a key={i++} href={u} target="_blank" rel="noopener noreferrer">{u}</a>);
    last = m.index + u.length;
    URL_RE.lastIndex = last;
  }
  if (last < text.length) out.push(text.slice(last));
  return out.length ? out : text;
}

/** 文本：包含搜索词时高亮，否则地址可点击 */
function textNode(text, q) {
  text = String(text);
  return q && text.toLowerCase().indexOf(q.toLowerCase()) !== -1 ? hl(text, q) : linkify(text);
}

function Leaf({ v, q }) {
  if (v === null || v === undefined) return <span className="jt-null">null</span>;
  if (typeof v === 'boolean') return <span className={`jt-b ${v ? 't' : 'f'}`}>{String(v)}</span>;
  if (typeof v === 'number') return <span className="jt-n">{hl(String(v), q)}</span>;
  if (v === '') return <span className="jt-s empty">""</span>;
  return <span className="jt-s">"{textNode(v, q)}"</span>;
}

/** 表格单元格：字符串不加引号，嵌套值压成一行 */
function Cell({ v, q }) {
  if (isComplex(v)) return <span className="jt-s">{textNode(str(v), q)}</span>;
  if (typeof v === 'string') return v === '' ? <span className="jt-null">（空）</span> : <span className="jt-s">{textNode(v, q)}</span>;
  return <Leaf v={v} q={q} />;
}

// ------------------------------------------------------------------
// 可折叠的树
// ------------------------------------------------------------------
function shouldOpen(ctx, v, n, depth, siblings, pk) {
  if (!n) return false;
  if (ctx.open.has(pk)) return ctx.open.get(pk);
  let open;
  if (ctx.mode === 'all') open = ctx.budget > 0;
  else if (ctx.mode === 'none') open = false;
  else open = (depth < OPEN_DEPTH && n <= OPEN_MAX_CHILDREN) || (siblings === 1 && n <= CHILD_LIMIT);
  // 搜索时自动展开包含搜索词的路径
  if (!open && ctx.ql && ctx.budget > 0 && low(v).indexOf(ctx.ql) !== -1) open = true;
  if (open && (ctx.mode === 'all' || ctx.ql)) ctx.budget -= Math.min(n, CHILD_LIMIT);
  return open;
}

/** 对象数组（各元素都是简单键值）用表格展示：返回列名，不适合时返回 null */
function flatKeys(arr) {
  if (arr.length < 2 || arr.length > 500) return null;
  const keys = [];
  const seen = {};
  for (const o of arr) {
    if (!isObj(o)) return null;
    for (const k of Object.keys(o)) {
      if (isComplex(o[k]) && str(o[k]).length > 160) return null;
      if (!seen[k]) { seen[k] = 1; keys.push(k); if (keys.length > 12) return null; }
    }
  }
  return keys.length ? keys : null;
}

function renderTable(q, arr) {
  const keys = flatKeys(arr);
  if (!keys) return null;
  return (
    <div className="jt-tblwrap" key="\u0000tbl">
      <table className="jt-tbl">
        <thead><tr><th className="idx">#</th>{keys.map((k) => <th key={k}>{hl(k, q)}</th>)}</tr></thead>
        <tbody>
          {arr.map((o, i) => (
            <tr key={i}>
              <td className="idx">{i}</td>
              {keys.map((k) => <td key={k}>{hasOwn(o, k) ? <Cell v={o[k]} q={q} /> : <span className="jt-null">—</span>}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function renderChildren(ctx, v, depth, keys, inStr) {
  const isArr = Array.isArray(v);
  if (isArr) {
    const t = renderTable(ctx.q, v);
    if (t) return t;
  }
  const ks = isArr ? null : Object.keys(v);
  const n = isArr ? v.length : ks.length;
  const pk = JSON.stringify(keys);
  const end = Math.min(n, ctx.more.get(pk) || CHILD_LIMIT);
  const out = [];
  for (let i = 0; i < end; i++) {
    const k = isArr ? String(i) : ks[i];
    out.push(renderRow(ctx, k, isArr, v[k], depth, n, [...keys, k], inStr));
  }
  if (end < n) {
    out.push(
      <div key="\u0000more" className="jt-more" onClick={() => ctx.onMore(pk, end + CHILD_LIMIT)}>还有 {n - end} 项，点击显示更多</div>
    );
  }
  return out;
}

function renderRow(ctx, key, isIdx, val, depth, siblings, keys, inStr) {
  let v = val;
  const parsed = parseJsonStr(val);
  const fromStr = parsed !== undefined;
  if (fromStr) v = parsed;
  const keyEl = <span className={`jt-k${isIdx ? ' idx' : ''}`}>{hl(key, ctx.q)}</span>;
  if (!isComplex(v)) {
    return (
      <div className="jt-row leaf" key={key}>
        <span className="jt-tg" />{keyEl}<span className="jt-p">: </span><Leaf v={v} q={ctx.q} />
      </div>
    );
  }
  const n = count(v);
  const pk = JSON.stringify(keys);
  const open = shouldOpen(ctx, v, n, depth, siblings, pk);
  const toggle = n ? () => ctx.onToggle(pk, !open) : undefined;
  const br = Array.isArray(v) ? ['[', ']'] : ['{', '}'];
  // JSON 字符串里的节点在原始数据中并不存在，不能作为下钻目标
  const canEnter = !!ctx.onEnter && !inStr && !fromStr && n > 0;
  return (
    <div key={key} className={`jt-row${n ? '' : ' leaf'}${open ? ' open' : ''}`}>
      <span className="jt-line">
        <span className="jt-tg" onClick={toggle} />
        <span className={`jt-k${isIdx ? ' idx' : ''}`} onClick={toggle}>{hl(key, ctx.q)}</span>
        <span className="jt-p" onClick={toggle}>: </span>
        <span className={`jt-sum${n ? '' : ' empty'}`} onClick={toggle}>{br[0]}{n || ''}{br[1]}</span>
        {fromStr && <span className="jt-badge" title="原值是 JSON 字符串，已解析展示">JSON 字符串</span>}
        {canEnter && <button className="jt-enter" title="把该节点作为当前层（下钻）" onClick={() => ctx.onEnter(keys)}>进入</button>}
        {n > 0 && !open && <span className="jt-pv" onClick={toggle}>{str(v).slice(0, 120)}</span>}
      </span>
      {open && <div className="jt-ch">{renderChildren(ctx, v, depth + 1, keys, inStr || fromStr)}</div>}
    </div>
  );
}

/** 一棵树：展开状态 / 「显示更多」进度由组件自己维护；搜索词、展开模式变化时由调用方换 key 重置 */
function TreeBlock({ value, q = '', mode = '', onEnter }) {
  const [open, setOpen] = useState(() => new Map());
  const [more, setMore] = useState(() => new Map());
  const ctx = {
    q, ql: q.toLowerCase(), mode, budget: OPEN_BUDGET, open, more, onEnter,
    onToggle: (pk, val) => setOpen((prev) => { const m = new Map(prev); m.set(pk, val); return m; }),
    onMore: (pk, lim) => setMore((prev) => { const m = new Map(prev); m.set(pk, lim); return m; })
  };
  return <div className="jt-tree">{renderChildren(ctx, value, 0, [], false)}</div>;
}

// ------------------------------------------------------------------
// 专用视图：pdsResult（设备能力）/ [step]（分支执行器）
// ------------------------------------------------------------------
function Sec({ title, sub, children }) {
  return (
    <div className="jt-sec">
      <div className="jt-sec-h">{title}{sub && <span className="sub">{sub}</span>}</div>
      {children}
    </div>
  );
}

function Chip({ x, q }) {
  return <span className="jt-chip">{isComplex(x) ? textNode(str(x), q) : hl(String(x), q)}</span>;
}

function isPds(v) {
  return Array.isArray(v) && v.length > 0 && v.every((x) => isObj(x) && (isObj(x.intPdsMap) || isObj(x.arrayPdsMap)));
}

function IntPds({ im, q }) {
  const ql = q.toLowerCase();
  const ks = Object.keys(im);
  const on = ks.filter((k) => isOn(im[k])).length;
  const other = ks.filter((k) => !isOn(im[k]) && !isOff(im[k])).length;
  const show = ks.filter((k) => !ql || (k + '=' + str(im[k])).toLowerCase().indexOf(ql) !== -1);
  return (
    <Sec
      title={<>开关能力 <code>intPdsMap</code></>}
      sub={<>共 {ks.length} 项 · 开启 <b className="ok">{on}</b> · 关闭 {ks.length - on - other}{other ? ` · 其他值 ${other}` : ''}{ql ? ` · 匹配 ${show.length}` : ''}</>}
    >
      <div className="jt-legend">
        <span className="jt-flag on">1 开启</span><span className="jt-flag">0 关闭</span><span className="jt-flag v">其他值</span>
        <span className="tip">鼠标悬停看具体值</span>
      </div>
      {show.length ? (
        <div className="jt-flags">
          {show.map((k) => {
            const val = im[k];
            const cls = isOn(val) ? 'on' : isOff(val) ? '' : 'v';
            return (
              <span key={k} className={`jt-flag ${cls}`} title={`${k} = ${str(val)}`}>
                {hl(k, q)}{cls === 'v' && <i>={hl(isComplex(val) ? str(val) : String(val), q)}</i>}
              </span>
            );
          })}
        </div>
      ) : <div className="jt-empty">没有匹配的开关能力</div>}
    </Sec>
  );
}

function ArrPds({ am, q }) {
  const ql = q.toLowerCase();
  const aks = Object.keys(am);
  const nonEmpty = aks.filter((k) => !Array.isArray(am[k]) || am[k].length);
  const ordered = nonEmpty.concat(aks.filter((k) => nonEmpty.indexOf(k) === -1)); // 有值的排在前面
  const rows = ordered.filter((k) => !ql || (k + '=' + str(am[k])).toLowerCase().indexOf(ql) !== -1);
  return (
    <Sec
      title={<>列表能力 <code>arrayPdsMap</code></>}
      sub={<>共 {aks.length} 项 · 有值 <b className="ok">{nonEmpty.length}</b> · 空 {aks.length - nonEmpty.length}{ql ? ` · 匹配 ${rows.length}` : ''}</>}
    >
      {rows.length ? (
        <div className="jt-tblwrap">
          <table className="jt-tbl">
            <thead><tr><th>能力</th><th className="num">数量</th><th>值</th></tr></thead>
            <tbody>
              {rows.map((k) => {
                const a = am[k];
                const arr = Array.isArray(a) ? a : [a];
                return (
                  <tr key={k} className={arr.length ? '' : 'off'}>
                    <td className="k">{hl(k, q)}</td>
                    <td className="num">{arr.length}</td>
                    <td>
                      {arr.length ? (
                        <>
                          {arr.slice(0, CHIP_LIMIT).map((y, i) => <Chip key={i} x={y} q={q} />)}
                          {arr.length > CHIP_LIMIT && (
                            <details className="jt-rest">
                              <summary>还有 {arr.length - CHIP_LIMIT} 个</summary>
                              {arr.slice(CHIP_LIMIT).map((y, i) => <Chip key={i} x={y} q={q} />)}
                            </details>
                          )}
                        </>
                      ) : <span className="jt-null">空</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : <div className="jt-empty">没有匹配的列表能力</div>}
    </Sec>
  );
}

function PdsView({ v, q }) {
  return v.map((x, gi) => {
    const others = Object.keys(x).filter((k) => k !== 'intPdsMap' && k !== 'arrayPdsMap');
    const rest = {};
    others.forEach((k) => { rest[k] = x[k]; });
    return (
      <React.Fragment key={gi}>
        {v.length > 1 && <div className="jt-group">第 {gi + 1} 组</div>}
        {isObj(x.intPdsMap) && <IntPds im={x.intPdsMap} q={q} />}
        {isObj(x.arrayPdsMap) && <ArrPds am={x.arrayPdsMap} q={q} />}
        {others.length > 0 && <Sec title="其他"><TreeBlock value={rest} q={q} /></Sec>}
      </React.Fragment>
    );
  });
}

function isStep(v) {
  if (!isObj(v)) return false;
  const bs = Object.keys(v);
  return bs.length > 0 && bs.every((b) => {
    const acts = v[b];
    return isObj(acts) && Object.keys(acts).every((a) => isObj(acts[a]) && 'execute' in acts[a]);
  });
}

function StepView({ v, q }) {
  const ql = q.toLowerCase();
  const secs = Object.keys(v).map((b) => {
    const acts = v[b];
    const ks = Object.keys(acts);
    const name = b.replace(/\[route\]\[branch\]$/, '').replace(/^\[([^\]]*)\]$/, '$1'); // "[10000][route][branch]" → 10000
    const isEx = (o) => o.execute === true || o.execute === 'true';
    const execN = ks.filter((k) => isEx(acts[k])).length;
    const hasExtra = ks.some((k) => Object.keys(acts[k]).length > 1);
    const rows = ks.filter((k) => !ql || (b + k + str(acts[k])).toLowerCase().indexOf(ql) !== -1);
    if (!rows.length) return null;
    return (
      <Sec
        key={b}
        title={<>分支 <code>{hl(name, q)}</code></>}
        sub={<>{ks.length} 个执行器 · 执行 <b className="ok">{execN}</b>{execN < ks.length && <> · 未执行 <b className="err">{ks.length - execN}</b></>}</>}
      >
        <div className="jt-tblwrap">
          <table className="jt-tbl">
            <thead><tr><th className="idx">#</th><th>执行器</th><th>步骤类型</th><th>execute</th>{hasExtra && <th>其他</th>}</tr></thead>
            <tbody>
              {rows.map((k) => {
                const m = k.match(/^\[([^\]]*)\]\[([^\]]*)\]$/);
                const o = acts[k];
                const extra = {};
                Object.keys(o).forEach((x) => { if (x !== 'execute') extra[x] = o[x]; });
                return (
                  <tr key={k} className={isEx(o) ? '' : 'off'}>
                    <td className="idx">{ks.indexOf(k) + 1}</td>
                    <td className="k">{hl(m ? m[1] : k, q)}</td>
                    <td className="dim">{hl(m ? m[2] : '', q)}</td>
                    <td><Leaf v={o.execute} q="" /></td>
                    {hasExtra && <td>{Object.keys(extra).length ? <Cell v={extra} q={q} /> : null}</td>}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Sec>
    );
  }).filter(Boolean);
  return secs.length ? secs : <div className="jt-empty">没有匹配的执行器</div>;
}

/** 识别专用视图：'pds' | 'step' | null */
export function special(v) {
  if (isPds(v)) return 'pds';
  if (isStep(v)) return 'step';
  return null;
}

/**
 * 一个节点的美化展示。value 为标量（且不是 JSON 字符串）时返回 null，由调用方展示值卡片
 * @param mode '' 默认 / 'all' 展开全部 / 'none' 收起全部
 * @param raw  专用视图切回树形结构
 * @param onEnter (keys) => void  树中「进入」按钮：keys 为相对 value 的路径
 */
export function JsonValueView({ value, q = '', mode = '', raw = false, onEnter }) {
  const sp = special(value);
  if (sp && !raw) {
    return <div className="jt-pane">{sp === 'pds' ? <PdsView v={value} q={q} /> : <StepView v={value} q={q} />}</div>;
  }
  const parsed = parseJsonStr(value);
  const v = parsed !== undefined ? parsed : value;
  if (!isComplex(v)) return null;
  return (
    <div className="jt-pane">
      {parsed !== undefined && <div className="jt-note"><span className="jt-badge">JSON 字符串</span> 原值是 JSON 字符串，已解析展示</div>}
      {count(v) === 0
        ? <div className="jt-tree"><span className="jt-null">{Array.isArray(v) ? '[] 空数组' : '{} 空对象'}</span></div>
        : <TreeBlock value={v} q={q} mode={mode} onEnter={parsed === undefined ? onEnter : undefined} />}
    </div>
  );
}
