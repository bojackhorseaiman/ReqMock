import React, { useState } from 'react';
import { motion } from 'framer-motion';
import { JbIcon } from './Icons.jsx';
import { maskFade, modalPop } from '../utils/motionPresets.js';
import { THEMES, ACCENTS, LAYOUTS, WORK_MODES, resolveTheme } from '../utils/themeUtil.js';

/**
 * 全页设置面板 — Hoppscotch 风格
 * 左右分区：左列为分区标题+副标题，右列为具体设置项
 * 每个设置项：标题（粗体） + 描述（灰色） + 控件
 */
export default function SettingsPage({ settings, onChange, onBackup, onRestore, onCheckUpdate, onClose }) {
  return (
    <motion.div className="settings-page-mask" onClick={onClose} {...maskFade}>
      <motion.div className="settings-page" onClick={(e) => e.stopPropagation()} {...modalPop}>
        <div className="settings-page-header">
          <span className="settings-page-title">设置</span>
          <button className="settings-page-close" onClick={onClose}><JbIcon name="close" size={16} /></button>
        </div>
        <div className="settings-page-body">

          {/* ── 主题 ── */}
          <section className="sp-section">
            <div className="sp-section-left">
              <h2 className="sp-section-title">主题</h2>
              <p className="sp-section-desc">自定义应用主题</p>
            </div>
            <div className="sp-section-right">
              <div className="sp-item">
                <div className="sp-item-header">
                  <span className="sp-item-title">外观</span>
                  <span className="sp-item-hint">
                    {THEMES.find((t) => t.value === settings.theme)?.label || '暗色'}
                    {settings.theme === 'system' ? ` · ${resolveTheme('system') === 'dark' ? 'Dark' : 'Light'}` : ''}
                  </span>
                </div>
                <div className="sp-theme-picker">
                  {THEMES.map((t) => (
                    <button
                      key={t.value}
                      className={`sp-theme-btn ${settings.theme === t.value ? 'active' : ''}`}
                      onClick={() => onChange({ theme: t.value })}
                      title={t.dark === null ? '跟随系统：随操作系统明暗自动切换' : t.label}
                    >
                      {t.dark === null ? '◐' : t.dark ? '☾' : '☀'}
                      <span>{t.label}</span>
                    </button>
                  ))}
                </div>
              </div>

              <div className="sp-item">
                <div className="sp-item-header">
                  <span className="sp-item-title">强调色</span>
                </div>
                <div className="sp-accent-picker">
                  {ACCENTS.map((a) => (
                    <span
                      key={a.value}
                      className={`sp-accent-dot ${settings.accent === a.value ? 'active' : ''}`}
                      style={{ background: a.color }}
                      title={a.label}
                      onClick={() => onChange({ accent: a.value })}
                    />
                  ))}
                </div>
              </div>

              <div className="sp-item">
                <div className="sp-item-header">
                  <span className="sp-item-title">界面缩放</span>
                </div>
                <select
                  className="sp-select"
                  value={settings.zoomLevel || 100}
                  onChange={(e) => onChange({ zoomLevel: Number(e.target.value) })}
                >
                  <option value={75}>75%</option>
                  <option value={100}>100%</option>
                  <option value={125}>125%</option>
                  <option value={150}>150%</option>
                </select>
              </div>
            </div>
          </section>

          {/* ── 视图 & 交互 ── */}
          <section className="sp-section">
            <div className="sp-section-left">
              <h2 className="sp-section-title">视图 & 交互</h2>
              <p className="sp-section-desc">视图和交互功能选项</p>
            </div>
            <div className="sp-section-right">
              <div className="sp-item sp-item-row">
                <div>
                  <span className="sp-item-title">请求 & 响应布局</span>
                  <span className="sp-item-desc">切换请求和响应的排列方向</span>
                </div>
                <select
                  className="sp-select"
                  value={settings.layout || 'vertical'}
                  onChange={(e) => onChange({ layout: e.target.value })}
                >
                  {LAYOUTS.map((l) => (
                    <option key={l.value} value={l.value}>{l.label}</option>
                  ))}
                </select>
              </div>

              <div className="sp-item sp-item-row">
                <div>
                  <span className="sp-item-title">工作模式</span>
                  <span className="sp-item-desc">经典：每条请求一条记录；聚合：相同 method+路径 的接口归为一条，不同域名/参数组合收纳为「变体」</span>
                </div>
                <select
                  className="sp-select"
                  value={settings.workMode || 'classic'}
                  onChange={(e) => onChange({ workMode: e.target.value })}
                >
                  {WORK_MODES.map((m) => (
                    <option key={m.value} value={m.value}>{m.label}</option>
                  ))}
                </select>
              </div>

              <div className="sp-item sp-item-row">
                <div>
                  <span className="sp-item-title">禅模式</span>
                  <span className="sp-item-desc">隐藏顶部菜单栏，专注于请求和响应内容</span>
                </div>
                <label className="sp-toggle">
                  <input type="checkbox" checked={settings.zenMode || false} onChange={(e) => onChange({ zenMode: e.target.checked })} />
                  <span className="sp-toggle-slider" />
                </label>
              </div>

              <div className="sp-item sp-item-row">
                <div>
                  <span className="sp-item-title">后台模式</span>
                  <span className="sp-item-desc">关闭窗口时最小化到系统托盘，而非退出应用</span>
                </div>
                <label className="sp-toggle">
                  <input type="checkbox" checked={settings.trayMode || false} onChange={(e) => onChange({ trayMode: e.target.checked })} />
                  <span className="sp-toggle-slider" />
                </label>
              </div>

              <div className="sp-item sp-item-row">
                <div>
                  <span className="sp-item-title">JSON 结构浏览器</span>
                  <span className="sp-item-desc">JSON 视图按根字段拆页签，提供概览表 / 下钻 / 美化展示；关闭时 JSON 视图仅显示缩进纯文本</span>
                </div>
                <label className="sp-toggle">
                  <input type="checkbox" checked={settings.jsonExplorer || false} onChange={(e) => onChange({ jsonExplorer: e.target.checked })} />
                  <span className="sp-toggle-slider" />
                </label>
              </div>
            </div>
          </section>

          {/* ── 编辑器 ── */}
          <section className="sp-section">
            <div className="sp-section-left">
              <h2 className="sp-section-title">编辑器</h2>
              <p className="sp-section-desc">代码编辑器相关设置</p>
            </div>
            <div className="sp-section-right">
              <div className="sp-item sp-item-row">
                <div>
                  <span className="sp-item-title">字号</span>
                  <span className="sp-item-desc">编辑器字体大小</span>
                </div>
                <select className="sp-select" value={settings.fontSize || 14} onChange={(e) => onChange({ fontSize: Number(e.target.value) })}>
                  {[12, 13, 14, 15, 16, 18, 20].map((s) => <option key={s} value={s}>{s}px</option>)}
                </select>
              </div>

              <div className="sp-item sp-item-row">
                <div>
                  <span className="sp-item-title">Tab 缩进</span>
                  <span className="sp-item-desc">每级缩进的空格数</span>
                </div>
                <select className="sp-select" value={settings.tabSize || 2} onChange={(e) => onChange({ tabSize: Number(e.target.value) })}>
                  <option value={2}>2 空格</option>
                  <option value={4}>4 空格</option>
                </select>
              </div>

              <div className="sp-item sp-item-row">
                <div>
                  <span className="sp-item-title">自动换行</span>
                  <span className="sp-item-desc">编辑器内容超出宽度时自动折行</span>
                </div>
                <label className="sp-toggle">
                  <input type="checkbox" checked={settings.wordWrap || false} onChange={(e) => onChange({ wordWrap: e.target.checked })} />
                  <span className="sp-toggle-slider" />
                </label>
              </div>

              <div className="sp-item sp-item-row">
                <div>
                  <span className="sp-item-title">显示行号</span>
                  <span className="sp-item-desc">在编辑器左侧显示行号栏</span>
                </div>
                <label className="sp-toggle">
                  <input type="checkbox" checked={settings.lineNumbers !== false} onChange={(e) => onChange({ lineNumbers: e.target.checked })} />
                  <span className="sp-toggle-slider" />
                </label>
              </div>
            </div>
          </section>

          {/* ── 网络 ── */}
          <section className="sp-section">
            <div className="sp-section-left">
              <h2 className="sp-section-title">网络</h2>
              <p className="sp-section-desc">HTTP 请求行为配置</p>
            </div>
            <div className="sp-section-right">
              <div className="sp-item sp-item-row">
                <div>
                  <span className="sp-item-title">请求超时</span>
                  <span className="sp-item-desc">超过此时间未响应将自动取消</span>
                </div>
                <select className="sp-select" value={settings.timeout || 30} onChange={(e) => onChange({ timeout: Number(e.target.value) })}>
                  {[5, 10, 15, 30, 60, 120, 300].map((s) => <option key={s} value={s}>{s}s</option>)}
                </select>
              </div>

              <div className="sp-item sp-item-row">
                <div>
                  <span className="sp-item-title">最大重定向</span>
                  <span className="sp-item-desc">自动跟随 3xx 重定向的最大次数</span>
                </div>
                <select className="sp-select" value={settings.maxRedirects ?? 5} onChange={(e) => onChange({ maxRedirects: Number(e.target.value) })}>
                  {[0, 1, 3, 5, 10, 20].map((n) => <option key={n} value={n}>{n} 次</option>)}
                </select>
              </div>

              <div className="sp-item sp-item-row">
                <div>
                  <span className="sp-item-title">SSL 证书验证</span>
                  <span className="sp-item-desc">关闭后可访问自签名证书的 HTTPS 服务</span>
                </div>
                <label className="sp-toggle">
                  <input type="checkbox" checked={settings.sslVerify !== false} onChange={(e) => onChange({ sslVerify: e.target.checked })} />
                  <span className="sp-toggle-slider" />
                </label>
              </div>

              <div className="sp-item sp-item-row">
                <div>
                  <span className="sp-item-title">自动管理 Cookie</span>
                  <span className="sp-item-desc">自动记录 Set-Cookie 并在发送时附加匹配 Cookie</span>
                </div>
                <label className="sp-toggle">
                  <input type="checkbox" checked={settings.cookiesEnabled !== false} onChange={(e) => onChange({ cookiesEnabled: e.target.checked })} />
                  <span className="sp-toggle-slider" />
                </label>
              </div>

              <div className="sp-item sp-item-row">
                <div>
                  <span className="sp-item-title">代理服务器</span>
                  <span className="sp-item-desc">所有请求通过代理发送（格式：http://host:port）</span>
                </div>
                <input
                  className="sp-input"
                  type="text"
                  placeholder="不使用代理"
                  value={settings.proxy || ''}
                  onChange={(e) => onChange({ proxy: e.target.value })}
                />
              </div>
            </div>
          </section>

          {/* ── AI 分析 ── */}
          <section className="sp-section">
            <div className="sp-section-left">
              <h2 className="sp-section-title">AI 分析</h2>
              <p className="sp-section-desc">流量报告 / 接口分析页内实时调用千问（OpenAI 兼容端点）</p>
            </div>
            <div className="sp-section-right">
              <div className="sp-item sp-item-row">
                <div>
                  <span className="sp-item-title">启用</span>
                  <span className="sp-item-desc">关闭时分析页不发起模型请求</span>
                </div>
                <label className="sp-toggle">
                  <input type="checkbox" checked={!!(settings.ai && settings.ai.enabled)} onChange={(e) => onChange({ ai: { ...(settings.ai || {}), enabled: e.target.checked } })} />
                  <span className="sp-toggle-slider" />
                </label>
              </div>

              <div className="sp-item sp-item-row">
                <div>
                  <span className="sp-item-title">Base URL</span>
                  <span className="sp-item-desc">OpenAI 兼容端点，默认阿里云 DashScope compatible-mode</span>
                </div>
                <input className="sp-input" type="text" placeholder="https://dashscope.aliyuncs.com/compatible-mode/v1"
                  value={(settings.ai && settings.ai.baseUrl) || ''} onChange={(e) => onChange({ ai: { ...(settings.ai || {}), baseUrl: e.target.value } })} />
              </div>

              <div className="sp-item sp-item-row">
                <div>
                  <span className="sp-item-title">API Key</span>
                  <span className="sp-item-desc">仅存本地，随请求以 Bearer 发送</span>
                </div>
                <input className="sp-input" type="password" placeholder="sk-…"
                  value={(settings.ai && settings.ai.apiKey) || ''} onChange={(e) => onChange({ ai: { ...(settings.ai || {}), apiKey: e.target.value } })} />
              </div>

              <div className="sp-item sp-item-row">
                <div>
                  <span className="sp-item-title">模型</span>
                  <span className="sp-item-desc">如 qwen-plus / qwen-max</span>
                </div>
                <input className="sp-input" type="text" placeholder="qwen-plus"
                  value={(settings.ai && settings.ai.model) || ''} onChange={(e) => onChange({ ai: { ...(settings.ai || {}), model: e.target.value } })} />
              </div>
            </div>
          </section>

          {/* ── 数据 ── */}
          <section className="sp-section">
            <div className="sp-section-left">
              <h2 className="sp-section-title">数据</h2>
              <p className="sp-section-desc">数据管理与存储</p>
            </div>
            <div className="sp-section-right">
              <div className="sp-item">
                <div className="sp-item-header">
                  <span className="sp-item-title">备份 / 恢复</span>
                  <span className="sp-item-desc">备份包含集合、环境、变量、历史、Mock、Cookie、设置</span>
                </div>
                <div className="sp-btn-group">
                  <button className="btn-secondary" onClick={onBackup}>备份到文件…</button>
                  <button className="btn-secondary" onClick={onRestore}>从备份恢复…</button>
                </div>
              </div>

              <div className="sp-item sp-item-row">
                <div>
                  <span className="sp-item-title">历史记录上限</span>
                  <span className="sp-item-desc">超出上限时自动删除最早的记录</span>
                </div>
                <select className="sp-select" value={settings.historyLimit || 200} onChange={(e) => onChange({ historyLimit: Number(e.target.value) })}>
                  {[50, 100, 200, 500, 1000].map((n) => <option key={n} value={n}>{n} 条</option>)}
                </select>
              </div>
            </div>
          </section>

          {/* ── 关于 ── */}
          <section className="sp-section">
            <div className="sp-section-left">
              <h2 className="sp-section-title">关于</h2>
              <p className="sp-section-desc">版本与更新</p>
            </div>
            <div className="sp-section-right">
              <div className="sp-item">
                <div className="sp-about">
                  <span className="sp-about-logo app-logo-dyn"><JbIcon name="galaxy" size={26} /></span>
                  <div>
                    <div className="sp-about-name">ReqMock <span className="sp-about-ver">v{typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : 'dev'}</span></div>
                    <div className="sp-about-desc">API 调试客户端 + Mock 服务桌面工具</div>
                  </div>
                </div>
              </div>
              <div className="sp-item">
                <div className="sp-btn-group">
                  <a className="btn-secondary sp-link-btn" href="https://github.com/bojackhorseaiman/ReqMock" target="_blank" rel="noreferrer">GitHub</a>
                  <a className="btn-secondary sp-link-btn" href="https://github.com/bojackhorseaiman/ReqMock/releases" target="_blank" rel="noreferrer">版本发布</a>
                  <button className="btn-secondary" onClick={onCheckUpdate}>检查更新</button>
                </div>
              </div>
            </div>
          </section>

        </div>
      </motion.div>
    </motion.div>
  );
}
