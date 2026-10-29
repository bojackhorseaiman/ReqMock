import React, { useEffect, useRef, useState, useCallback } from 'react';







import { EditorView, keymap, lineNumbers, highlightActiveLine, highlightActiveLineGutter, placeholder as cmPlaceholder, Decoration, ViewPlugin } from '@codemirror/view';

import { EditorState, StateField, StateEffect } from '@codemirror/state';







import { history, defaultKeymap, historyKeymap, indentWithTab, toggleLineComment } from '@codemirror/commands';







import { codeFolding, foldGutter, foldKeymap, foldService, bracketMatching, indentOnInput, indentUnit, syntaxHighlighting, HighlightStyle, unfoldEffect, foldedRanges } from '@codemirror/language';







import { highlightSelectionMatches } from '@codemirror/search';







import { closeBrackets, closeBracketsKeymap } from '@codemirror/autocomplete';







import { json } from '@codemirror/lang-json';







import { javascript } from '@codemirror/lang-javascript';







import { tags } from '@lezer/highlight';















/**







 * 自定义 JSON 折叠服务（Reqable 风格）：







 * 1. 确保所有层级（含根对象/顶层属性）都能折叠







 * 2. 折叠后闭合括号保留在独立行并显示原始行号







 * 3. 性能优化：基于行扫描（非字符扫描），大文件时限制最大扫描行数







 */







const FOLD_MAX_LINES = 50000; // 超过此行数不进行折叠计算







const jsonBracketFold = foldService.of((state, lineStart, lineEnd) => {







  if (state.doc.lines > FOLD_MAX_LINES) return null;







  const line = state.doc.lineAt(lineStart);







  const text = line.text;







  const trimmed = text.trimEnd();







  const lastChar = trimmed[trimmed.length - 1];







  if (lastChar !== '{' && lastChar !== '[') return null;







  const closeChar = lastChar === '{' ? '}' : ']';







  // 基于行扫描匹配括号（快速：仅统计每行的开闭括号数，跳过字符串内容）







  let depth = 1;







  const totalLines = state.doc.lines;







  let lineNo = line.number + 1;







  while (lineNo <= totalLines && depth > 0) {







    const ln = state.doc.line(lineNo);







    const t = ln.text;







    let inStr = false;







    for (let i = 0, len = t.length; i < len; i++) {







      const ch = t[i];







      if (inStr) {







        if (ch === '\\') { i++; continue; }







        if (ch === '"') inStr = false;







      } else {







        if (ch === '"') inStr = true;







        else if (ch === lastChar) depth++;







        else if (ch === closeChar) {







          depth--;







          if (depth === 0) {







            // 闭括号保留在独立行，折叠范围到其前一行末尾







            const foldEnd = ln.from - 1;







            if (foldEnd <= line.to) return null;







            return { from: line.to, to: foldEnd };







          }







        }







      }







    }







    lineNo++;







  }







  return null;







});















/**
 * 折叠标记：SVG 箭头替代字体字符（字体字形大小/基线不可控，放大后会错位）
 * open=true 表示当前可折叠（向下箭头），false 表示已折叠（向右箭头）
 */
const FOLD_SVG_OPEN = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 6l4 4 4-4" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const FOLD_SVG_CLOSED = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M6 4l4 4-4 4" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>';
function createFoldMarker(open) {
  const el = document.createElement('span');
  el.className = open ? 'cm-fold-marker is-open' : 'cm-fold-marker is-closed';
  el.title = open ? '折叠' : '展开';
  el.innerHTML = open ? FOLD_SVG_OPEN : FOLD_SVG_CLOSED;
  return el;
}

/** 搜索高亮装饰：普通命中 */







const hitDeco = Decoration.mark({ class: 'cm-search-hit' });







/** 搜索高亮装饰：当前活跃命中 */







const activeHitDeco = Decoration.mark({ class: 'cm-search-hit-active' });















/** 搜索查询状态字段：{ query: RegExp | null, activeIdx: number, positions: Array<{from:number,to:number}> | null } */







const setSearchQueryEffect = StateEffect.define();







const searchQueryField = StateField.define({







  create: () => ({ query: null, activeIdx: -1, positions: null }),







  update(value, tr) {







    for (const e of tr.effects) {







      if (e.is(setSearchQueryEffect)) return e.value;







    }







    return value;







  }







});















/** 搜索高亮 ViewPlugin：根据 searchQueryField 生成装饰 */







const searchHighlightPlugin = ViewPlugin.fromClass(class {







  constructor(view) {







    this.decorations = this.buildDecorations(view);







  }







  update(update) {







    if (update.docChanged || update.transactions.some((tr) => tr.effects.some((e) => e.is(setSearchQueryEffect)))) {







      this.decorations = this.buildDecorations(update.view);







    }







  }







  buildDecorations(view) {







    const { query, activeIdx, positions } = view.state.field(searchQueryField);







    if (!query || !positions) return Decoration.none;







    const builder = [];







    for (let i = 0; i < positions.length; i++) {







      const pos = positions[i];







      const deco = i === activeIdx ? activeHitDeco : hitDeco;







      builder.push(deco.range(pos.from, pos.to));







    }







    return Decoration.set(builder, true);







  }







}, {







  decorations: (v) => v.decorations







});















/** 语法高亮映射到全局 .tok-* 类，随 8 套主题的 CSS 变量自动换色 */







const themeHighlight = HighlightStyle.define([







  { tag: tags.propertyName, class: 'tok-key' },







  { tag: tags.string, class: 'tok-string' },







  { tag: [tags.number, tags.regexp], class: 'tok-number' },







  { tag: tags.bool, class: 'tok-boolean' },







  { tag: tags.null, class: 'tok-null' },







  { tag: [tags.keyword, tags.operatorKeyword], class: 'tok-boolean' },







  { tag: [tags.function(tags.variableName), tags.function(tags.propertyName)], class: 'tok-key' },







  { tag: tags.comment, class: 'tok-comment' }







]);















/**







 * 基于 CodeMirror 6 的代码编辑器/查看器







 * 内置：行号、层级折叠、括号匹配、Ctrl+F 搜索、撤销历史、JSON/JS 语法高亮







 * @param language 'json' | 'javascript' | 'text'







 * @param readOnly 只读模式（响应 Pretty 视图）







 * @param lineWrap 自动换行（关闭后横向滚动）







 */







export default function CodeEditor({ value, onChange, language = 'text', placeholder = '', readOnly = false, lineWrap = true, className = '', searchQuery, hideBuiltinSearch = false, fontSize = 14, tabSize = 2, showLineNumbers = true, wordWrap }) {







  const hostRef = useRef(null);







  const viewRef = useRef(null);



  // 内置搜索栏状态（当没有外部 searchQuery 控制时使用）

  const [internalSearch, setInternalSearch] = useState(false);

  const [searchText, setSearchText] = useState('');

  const [caseSense, setCaseSense] = useState(false);

  const [regexOn, setRegexOn] = useState(false);

  const [hitIdx, setHitIdx] = useState(0);

  const [hitCount, setHitCount] = useState(0);

  const [searchError, setSearchError] = useState(false);

  const searchInputRef = useRef(null);



  const openInternalSearch = useCallback(() => {

    setInternalSearch(true);

    setTimeout(() => searchInputRef.current && searchInputRef.current.focus(), 0);

  }, []);



  const closeInternalSearch = useCallback(() => {

    setInternalSearch(false);

    setSearchText('');

    setHitIdx(0);

    setHitCount(0);

    setSearchError(false);

  }, []);







  // 回调与初始文档走 ref，避免重建编辑器或闭包过期







  const onChangeRef = useRef(onChange);







  onChangeRef.current = onChange;







  const valueRef = useRef(value);







  valueRef.current = value;















  useEffect(() => {







    const extensions = [







      codeFolding({ placeholderText: '\u22EF' }),







      ...(showLineNumbers ? [lineNumbers()] : []),







      foldGutter({ markerDOM: createFoldMarker }),







      bracketMatching(),













      highlightSelectionMatches(),







      syntaxHighlighting(themeHighlight),







      searchQueryField,







      searchHighlightPlugin,







      keymap.of([

        ...defaultKeymap, ...foldKeymap,

        { key: 'Mod-/', run: (view) => {

          // 先尝试 CM6 内置注释切换（JS 等语言有效）

          if (toggleLineComment(view)) return true;

          // JSON 等无注释语法的语言：手动切换行首 // 注释

          const { state } = view;

          const changes = [];

          for (let i = state.selection.main.from; i <= state.selection.main.to;) {

            const line = state.doc.lineAt(i);

            if (line.text.trimStart().startsWith('//')) {

              const idx = line.text.indexOf('//');

              changes.push({ from: line.from + idx, to: line.from + idx + (line.text[idx + 2] === ' ' ? 3 : 2) });

            } else {

              const idx = line.text.length - line.text.trimStart().length;

              changes.push({ from: line.from + idx, insert: '// ' });

            }

            i = line.to + 1;

          }

          if (changes.length) view.dispatch({ changes });

          return true;

        }},

        { key: 'Mod-f', run: () => { openInternalSearch(); return true; } },

        { key: 'Escape', run: () => { if (internalSearch) { closeInternalSearch(); return true; } return false; } }

      ])







    ];







    if (language === 'json' || language === 'text') extensions.push(jsonBracketFold);







    // wordWrap prop（来自 settings）优先，未传时回退 lineWrap prop
    const shouldWrap = wordWrap !== undefined ? wordWrap : lineWrap;
    if (shouldWrap) extensions.push(EditorView.lineWrapping);
    extensions.push(indentUnit.of(' '.repeat(tabSize)));
    extensions.push(EditorView.theme({ '&': { fontSize: fontSize + 'px' } }));







    if (language === 'json') extensions.push(json());







    if (language === 'javascript') extensions.push(javascript());







    if (placeholder) extensions.push(cmPlaceholder(placeholder));







    if (readOnly) {







      extensions.push(EditorState.readOnly.of(true), EditorView.editable.of(false));







    } else {







      extensions.push(







        history(),







        indentOnInput(),







        closeBrackets(),







        highlightActiveLine(),







        highlightActiveLineGutter(),







        keymap.of([...closeBracketsKeymap, ...historyKeymap, indentWithTab]),







        EditorView.updateListener.of((u) => {







          if (u.docChanged && onChangeRef.current) onChangeRef.current(u.state.doc.toString());







        })







      );







    }







    const view = new EditorView({







      parent: hostRef.current,







      state: EditorState.create({ doc: valueRef.current || '', extensions })







    });







    viewRef.current = view;







    return () => { view.destroy(); viewRef.current = null; };







  }, [language, readOnly, placeholder, lineWrap, fontSize, tabSize, showLineNumbers, wordWrap]);















  // 外部 value 变化（切换标签/响应更新）时同步文档，避免光标位置丢失只在内容确实不同步时替换







  useEffect(() => {







    const view = viewRef.current;







    if (!view) return;







    const cur = view.state.doc.toString();







    if ((value || '') !== cur) {







      view.dispatch({ changes: { from: 0, to: cur.length, insert: value || '' } });







    }







  }, [value]);















  // 外部搜索查询变化时同步到 CodeMirror 装饰，并滚动到当前命中







  const searchQueryRef = useRef(null);







  searchQueryRef.current = searchQuery;







  useEffect(() => {







    const view = viewRef.current;







    if (!view) return;







    const sq = searchQuery || { query: null, activeIdx: -1 };







    // 计算匹配位置







    let positions = null;







    if (sq.query) {







      positions = [];







      const text = view.state.doc.toString();







      const re = new RegExp(sq.query.source, sq.query.flags.includes('g') ? sq.query.flags : sq.query.flags + 'g');







      let m;







      while ((m = re.exec(text)) !== null) {







        if (m[0] === '') { re.lastIndex++; continue; }







        positions.push({ from: m.index, to: m.index + m[0].length });







        if (positions.length > 5000) break;







      }







    }







    view.dispatch({ effects: setSearchQueryEffect.of({ ...sq, positions }) });







    // 延迟滚动：等 CodeMirror 渲染完装饰后再滚动到当前命中位置







    if (sq.activeIdx >= 0 && positions && positions[sq.activeIdx]) {







      const pos = positions[sq.activeIdx];







      setTimeout(() => {







        if (viewRef.current) {



          // 搜索结果在折叠区域内时，先展开该区域



          const folded = foldedRanges(viewRef.current.state);



          const unfolds = [];



          folded.between(0, viewRef.current.state.doc.length, (from, to) => {



            if (pos.from >= from && pos.from <= to) {



              unfolds.push(unfoldEffect.of({ from, to }));



            }



          });



          if (unfolds.length) viewRef.current.dispatch({ effects: unfolds });







          viewRef.current.dispatch({







            effects: EditorView.scrollIntoView(pos.from, { y: 'center' })







          });







        }







      }, 50);







    }







  }, [searchQuery]);















  // 内部搜索逻辑：searchText/caseSense/regexOn 变化时计算匹配并更新装饰

  useEffect(() => {

    if (searchQuery) return; // 外部控制时不走内部逻辑

    const view = viewRef.current;

    if (!view) return;

    if (!internalSearch || !searchText) {

      view.dispatch({ effects: setSearchQueryEffect.of({ query: null, activeIdx: -1, positions: null }) });

      setHitCount(0);

      setSearchError(false);

      return;

    }

    let regex;

    try {

      const escaped = regexOn ? searchText : searchText.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

      const flags = caseSense ? 'g' : 'gi';

      regex = new RegExp(escaped, flags);

      setSearchError(false);

    } catch (e) {

      setSearchError(true);

      setHitCount(0);

      view.dispatch({ effects: setSearchQueryEffect.of({ query: null, activeIdx: -1, positions: null }) });

      return;

    }

    const text = view.state.doc.toString();

    const positions = [];

    let m;

    while ((m = regex.exec(text)) !== null) {

      if (m[0] === '') { regex.lastIndex++; continue; }

      positions.push({ from: m.index, to: m.index + m[0].length });

      if (positions.length > 5000) break;

    }

    setHitCount(positions.length);

    const idx = positions.length > 0 ? ((hitIdx % positions.length) + positions.length) % positions.length : -1;

    view.dispatch({ effects: setSearchQueryEffect.of({ query: regex, activeIdx: idx, positions }) });

    // 滚动到当前命中

    if (idx >= 0 && positions[idx]) {

      const pos = positions[idx];

      setTimeout(() => {

        if (viewRef.current) {

          const folded = foldedRanges(viewRef.current.state);

          const unfolds = [];

          folded.between(0, viewRef.current.state.doc.length, (from, to) => {

            if (pos.from >= from && pos.from <= to) unfolds.push(unfoldEffect.of({ from, to }));

          });

          if (unfolds.length) viewRef.current.dispatch({ effects: unfolds });

          viewRef.current.dispatch({ effects: EditorView.scrollIntoView(pos.from, { y: 'center' }) });

        }

      }, 30);

    }

  }, [searchText, caseSense, regexOn, hitIdx, internalSearch, searchQuery]);

  const curHit = hitCount > 0 ? ((hitIdx % hitCount) + hitCount) % hitCount : 0;



  return (

    <div className={`code-editor ${className}`}>

      {internalSearch && !searchQuery && (

        <div className="body-search-bar">

          <input

            ref={searchInputRef}

            className="body-search-input"

            placeholder="搜索…"

            value={searchText}

            onChange={(e) => { setSearchText(e.target.value); setHitIdx(0); }}

            onKeyDown={(e) => {

              if (e.key === 'Enter') setHitIdx(e.shiftKey ? hitIdx - 1 : hitIdx + 1);

              if (e.key === 'Escape') closeInternalSearch();

            }}

          />

          <button className={caseSense ? 'search-toggle on' : 'search-toggle'} title="区分大小写" onClick={() => { setCaseSense(!caseSense); setHitIdx(0); }}>Aa</button>

          <button className={regexOn ? 'search-toggle on' : 'search-toggle'} title="正则表达式" onClick={() => { setRegexOn(!regexOn); setHitIdx(0); }}>.*</button>

          <span className={`search-count ${searchError ? 'search-count-err' : ''}`}>

            {searchError ? '正则错误' : searchText ? `${hitCount ? curHit + 1 : 0}/${hitCount}` : ''}

          </span>

          <button className="search-toggle" title="上一个 (Shift+Enter)" disabled={!hitCount} onClick={() => setHitIdx(hitIdx - 1)}>↑</button>

          <button className="search-toggle" title="下一个 (Enter)" disabled={!hitCount} onClick={() => setHitIdx(hitIdx + 1)}>↓</button>

          <button className="search-toggle" title="关闭 (Esc)" onClick={closeInternalSearch}>×</button>

        </div>

      )}

      <div ref={hostRef} style={{ flex: 1, minHeight: 0 }} />

    </div>

  );







}







