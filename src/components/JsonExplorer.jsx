import React, { useMemo } from 'react';

/**
 * JSON 结构浏览器：根节点子页签内部视图
 *   左侧：概览 + 子节点列表（键名 + 体积）
 *   右侧：概览表（节点 / 类型 / 大小 / 占比 / 内容预览），点击一行进入该节点详情（由调用方渲染 detail）
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

function pctText(p) {
  if (p === 0) return '0%';
  if (p < 0.1) return '<0.1%';
  return p.toFixed(1) + '%';
}

export function JsonNodeExplorer({ name, nodeBytes, items, childKey, onSelectChild, filter, detail }) {
  const f = (filter || '').trim().toLowerCase();
  const shown = useMemo(() => (f ? items.filter((c) => c.hay.includes(f)) : items), [items, f]);
  const list = shown.length > LIST_MAX ? shown.slice(0, LIST_MAX) : shown;
  const inDetail = childKey !== null;

  return (
    <div className="json-exp">
      <aside className="json-exp-side">
        <div className={`json-exp-item overview${inDetail ? '' : ' active'}`} onClick={() => onSelectChild(null)}>
          <span className="json-exp-item-name">概览</span>
          <span className="json-exp-item-size">{f ? `${shown.length}/${items.length}` : items.length} 个节点</span>
        </div>
        {list.map((c) => (
          <div
            key={c.key}
            className={`json-exp-item${c.key === childKey ? ' active' : ''}`}
            title={`${c.name}\n${c.label} · ${formatBytes(c.bytes)}`}
            onClick={() => onSelectChild(c.key)}
          >
            <span className="json-exp-item-name">{c.name}</span>
            <span className="json-exp-item-size">{formatBytes(c.bytes)}</span>
          </div>
        ))}
        {shown.length > LIST_MAX && <div className="json-exp-more">仅列出前 {LIST_MAX} 项，可用右上角搜索缩小范围</div>}
        {f && shown.length === 0 && <div className="json-exp-more">没有匹配「{filter.trim()}」的节点</div>}
      </aside>

      <section className="json-exp-main">
        {inDetail ? detail : (
          <div className="json-exp-overview">
            <div className="json-exp-title">
              <b>{name} 概览</b>
              <span>{items.length} 个节点 · {formatBytes(nodeBytes)}</span>
            </div>
            <div className="json-exp-hint">点击一行查看该节点；右上角可按键名或内容搜索</div>
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
                      <td className="c-name" title={c.name}>{c.name}</td>
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
            {f && shown.length === 0 && <div className="json-exp-more">没有匹配「{filter.trim()}」的节点</div>}
          </div>
        )}
      </section>
    </div>
  );
}
