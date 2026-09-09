// section — 「统一搜索」设置节：页头 + 四页签（网页引擎/检索源/通用/诊断）。
//
// 形态向原生「插件」节学：文本页签 + 底部 dirty 保存条（草稿语义、expectedRevision 防陈旧覆盖）。
// 数据面：settingsScope（配置草稿与保存）、RPC state（健康投影）、credentials Remote（凭据单向录入）、
// RPC test（诊断实跑）。视觉全部 --dsw-alias-* token 内联，不自建视觉身份（知识库 client/15 红线）。
// 参考：docs/technical-details/设置页UI.md。
// @ts-check

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import { T, S, badgeStyle, pillBase, statusPillStyle, cardStyle, subCardStyle, dividerStyle, noteText, sectionHead, linkBtn, fieldStyle } from './theme.js'

/** 引擎行元数据（展示名与一行说明；诊断页签共用）。 */
const ENGINE_META = {
  bing: { label: 'Bing', note: '免 key HTML 兜底，时间过滤按实测 filters 语法' },
  ddg: { label: 'DuckDuckGo', note: '免 key HTML，df 粗粒度时间窗' },
  'ddg-lite': { label: 'DDG Lite', note: '极简 HTML，解析容错优先' },
  anysearch: { label: 'AnySearch', note: '免 key AI 检索，answer 透传信封' },
  searxng: { label: 'SearXNG', note: '自建/公共实例列表逐实例兜底，默认关闭' },
  keenable: { label: 'Keenable', note: '无 key 走公共 MCP，有 key 走 REST' },
  'deepseek-official': { label: 'DeepSeek 官方', note: '宿主现任后端自包含复刻' },
  tavily: { label: 'Tavily', note: 'key 引擎（TAVILY_API_KEY）' },
  exa: { label: 'Exa', note: 'key 引擎（EXA_API_KEY），startPublishedDate 精确' },
  perplexity: { label: 'Perplexity', note: 'key 引擎（PERPLEXITY_API_KEY），答案 + citations' },
}

/** 学术/平台源元数据（页签二行序即此表序）。 */
const SOURCE_META = [
  { id: 'arxiv', label: 'arXiv', note: '预印本；3s 礼貌间隔' },
  { id: 'openalex', label: 'OpenAlex', note: '开放学术图谱（题录级）' },
  { id: 'crossref', label: 'Crossref', note: 'DOI 注册机构（题录级）' },
  { id: 'pubmed', label: 'PubMed', note: '生医题录（两步 esearch/efetch）' },
  { id: 'europepmc', label: 'EuropePMC', note: '题录 + OA 标识' },
  { id: 'github', label: 'GitHub', note: '仓库搜索；可选 token 提额' },
  { id: 'stackoverflow', label: 'StackOverflow', note: '问答站内搜索' },
  { id: 'hn', label: 'Hacker News', note: 'Algolia 镜像' },
  { id: 'wikipedia', label: 'Wikipedia', note: '多语言站内检索' },
  { id: 'npm', label: 'npm', note: '包搜索' },
  { id: 'v2ex', label: 'V2EX', note: '仅热榜本地过滤（覆盖面有限）' },
  { id: 'bilibili', label: 'Bilibili', note: '视频站内检索' },
  { id: 'reddit', label: 'Reddit', note: '帖子搜索（无登录）' },
]

const TABS = [
  { id: 'engines', label: '网页引擎' },
  { id: 'sources', label: '检索源' },
  { id: 'general', label: '通用' },
  { id: 'diagnose', label: '诊断' },
]

/** 各页签管辖的顶层配置键（保存范围界定）。 */
const TAB_KEYS = {
  engines: ['chain', 'engines'],
  sources: ['sources'],
  general: ['contact', 'readSource'],
  diagnose: [],
}

/**
 * 设置节主组件。props 防御：注入面缺成员时降级空态（Client bundle 崩溃 = section 无痕 abdicate）。
 * props = { call, scope, credentials } 注入面（index.jsx 装配）：call 为 RPC 门面
 * （state/test），scope 为 settingsScope.bind 结果，credentials 为凭据门面（describe/set/unset）。
 * 组件对三者做形状防御（缺成员只降级不崩），故不钉死类型以免虚报精确度。
 * @param {Record<string, unknown>} props
 */
export function UnitySearchSection(props) {
  const { call, scope, credentials } = props ?? {}
  const unavailable = !call || !scope

  const [snapshot, setSnapshot] = useState(() => (scope ? scope.getSnapshot() : { status: 'loading' }))
  useEffect(() => {
    if (!scope) return undefined
    return scope.subscribe(() => setSnapshot(scope.getSnapshot()))
  }, [scope])

  const serverValue = snapshot.status === 'ready' && snapshot.value ? snapshot.value : null
  const [draft, setDraft] = useState(() => structuredClone(serverValue ?? {}))
  const [draftBase, setDraftBase] = useState(() => snapshot.revision)
  const [tab, setTab] = useState('engines')
  const [saveError, setSaveError] = useState(null)
  const [savedAt, setSavedAt] = useState(0)

  // 外部变更（原生设置文档编辑/其他页签写入）在无本地草稿分叉时镜像进来。
  useEffect(() => {
    if (snapshot.status !== 'ready') return
    if (snapshot.revision === draftBase) return
    if (!dirtyKeys(draft, serverValue, ['chain', 'engines', 'sources', 'contact', 'readSource']).length) {
      setDraft(structuredClone(serverValue ?? {}))
      setDraftBase(snapshot.revision)
    }
  }, [snapshot, serverValue, draft, draftBase])

  const stateData = useRpcState(call)
  const dirty = useMemo(() => dirtyKeys(draft, serverValue, TAB_KEYS[tab]), [draft, serverValue, tab])

  const patch = useCallback((fn) => {
    setDraft((prev) => {
      const next = structuredClone(prev)
      fn(next)
      return next
    })
    setSaveError(null)
  }, [])

  async function save() {
    if (!dirty.length) return
    const ops = collectOps(pick(serverValue ?? {}, dirty), pick(draft, dirty), [])
    try {
      await scope.mutate(ops, snapshot.revision)
    } catch (error) {
      setSaveError(`保存失败：${String(error && error.message ? error.message : error)}（草稿已保留；如提示冲突请刷新重试）`)
      return
    }
    const after = scope.getSnapshot()
    const afterValue = after.status === 'ready' && after.value ? after.value : null
    const residual = dirtyKeys(draft, afterValue, dirty)
    if (residual.length) {
      setSaveError(`配置被服务端校验拒绝（${residual.join('、')} 未生效）；草稿已保留，可对照页内规则修正后重试`)
      return
    }
    setDraftBase(after.revision)
    setDraft(structuredClone(afterValue ?? {}))
    setSavedAt(Date.now())
  }

  if (unavailable) {
    return <div style={S.panel}>统一搜索设置不可用：注入面缺失（Host 半区未挂载？）。</div>
  }

  return (
    <div style={{ ...S.panel, display: 'flex', flexDirection: 'column', gap: 12 }}>
      <header>
        <div style={{ ...sectionHead, fontSize: 15 }}>统一搜索</div>
        <div style={{ ...noteText, marginTop: 2 }}>多源统一检索：网页引擎链、学术与平台源、凭据与诊断。</div>
      </header>

      <TabBar active={tab} onChange={setTab} />

      {tab === 'engines' ? <EnginesTab cfg={draft} patch={patch} stateData={stateData} credentials={credentials} /> : null}
      {tab === 'sources' ? <SourcesTab cfg={draft} patch={patch} stateData={stateData} credentials={credentials} /> : null}
      {tab === 'general' ? <GeneralTab cfg={draft} patch={patch} /> : null}
      {tab === 'diagnose' ? <DiagnoseTab call={call} stateData={stateData} reloadState={stateData.reload} /> : null}

      {tab !== 'diagnose' ? (
        <SaveBar
          dirty={dirty.length > 0}
          error={saveError}
          savedAt={savedAt}
          onSave={save}
          onDiscard={() => {
            setDraft(structuredClone(serverValue ?? {}))
            setDraftBase(snapshot.revision)
            setSaveError(null)
          }}
        />
      ) : null}
    </div>
  )
}

/**
 * 页签栏：文本页签，active = 前景色 + 底部指示条（原生分页几何）。
 * @param {{ active: string, onChange: (id: string) => void }} props
 */
function TabBar({ active, onChange }) {
  return (
    <nav style={{ display: 'flex', gap: 16, borderBottom: `1px solid ${T.borderL1}` }}>
      {TABS.map((t) => {
        const on = t.id === active
        return (
          <button
            key={t.id}
            type="button"
            onClick={() => onChange(t.id)}
            style={{
              border: 'none',
              borderBottom: on ? `2px solid ${T.brand}` : '2px solid transparent',
              background: 'none',
              font: 'inherit',
              fontSize: 13,
              fontWeight: on ? 600 : 400,
              color: on ? T.labelPrimary : T.labelSecondary,
              cursor: 'pointer',
              padding: '6px 2px',
            }}
          >
            {t.label}
          </button>
        )
      })}
    </nav>
  )
}

/**
 * RPC state 投影（无推送通道：挂载拉一次 + 手动/测试后重拉）。
 * @param {{ state: () => Promise<import('./api.js').NormalizedState> }} call
 */
function useRpcState(call) {
  const [data, setData] = useState(null)
  const [error, setError] = useState(null)
  const [loading, setLoading] = useState(false)
  const reload = useCallback(() => {
    if (!call) return
    setLoading(true)
    call.state().then(
      (value) => {
        setData(value)
        setError(null)
      },
      (err) => setError(String(err && err.message ? err.message : err)),
    ).finally(() => setLoading(false))
  }, [call])
  useEffect(reload, [reload])
  return { data, error, loading, reload }
}

/**
 * 页签一：网页引擎链。链参数 + 引擎行（顺序/启停/凭据/searxng 实例）。
 */
function EnginesTab({ cfg, patch, stateData, credentials }) {
  const chain = cfg.chain ?? {}
  const engines = cfg.engines ?? {}
  const order = Array.isArray(chain.order) ? chain.order : []
  const ids = useMemo(() => {
    const known = Object.keys(ENGINE_META)
    const listed = order.filter((id) => known.includes(id))
    const unlisted = known.filter((id) => !listed.includes(id))
    return { rows: [...listed, ...unlisted] }
  }, [order])
  const engineState = new Map((stateData.data?.engines ?? []).map((e) => [e.id, e]))

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ ...cardStyle }}>
        <div style={S.listRow}>
          <span style={sectionHead}>链参数</span>
          <span style={{ flex: 1 }} />
          {stateData.loading ? <span style={noteText}>状态刷新中…</span> : null}
          <Button variant="outline" size="sm" onClick={stateData.reload}>刷新状态</Button>
        </div>
        <div style={dividerStyle} />
        <div style={S.listRow}>
          <NumberField label="失败冷却（秒）" value={chain.cooldownSeconds} min={0} max={3600} onChange={(v) => patch((d) => { d.chain.cooldownSeconds = v })} />
          <NumberField label="单次引擎超时（ms）" value={chain.timeoutMs} min={1000} max={120000} step={1000} onChange={(v) => patch((d) => { d.chain.timeoutMs = v })} />
        </div>
        {stateData.error ? <div style={{ ...noteText, color: T.error, padding: '0 12px 8px' }}>状态投影失败：{stateData.error}</div> : null}
      </div>

      <div style={cardStyle}>
        {ids.rows.map((id, index) => {
          const meta = ENGINE_META[id]
          const engineCfg = engines[id] ?? {}
          const st = engineState.get(id)
          const inOrder = order.includes(id)
          const ref = engineCfg.apiKeyEnv ?? ''
          return (
            <div key={id}>
              {index > 0 ? <div style={dividerStyle} /> : null}
              <div style={S.listRow}>
                <div style={{ display: 'flex', gap: 4 }}>
                  <button type="button" title="上移" disabled={!inOrder || index === 0 || order.length === 0}
                    style={{ ...linkBtn, opacity: !inOrder || index === 0 ? 0.35 : 1 }}
                    onClick={() => patch((d) => moveInOrder(d.chain.order, id, -1))}>↑</button>
                  <button type="button" title="下移" disabled={!inOrder || !order.includes(id)}
                    style={{ ...linkBtn, opacity: !inOrder ? 0.35 : 1 }}
                    onClick={() => patch((d) => moveInOrder(d.chain.order, id, 1))}>↓</button>
                </div>
                <div style={{ minWidth: 150 }}>
                  <div style={{ fontWeight: 600, fontSize: 13 }}>{meta.label}</div>
                  <div style={noteText}>{meta.note}</div>
                </div>
                <EnginePill st={st} now={stateData.data?.now} enabled={engineCfg.enabled !== false} refName={ref} configured={st?.configured} />
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  {inOrder ? null : <button type="button" style={linkBtn} onClick={() => patch((d) => { d.chain.order.push(id) })}>加入链</button>}
                  <Checkbox checked={engineCfg.enabled !== false} label="启用" onChange={(v) => patch((d) => { d.engines[id] = { ...d.engines[id], enabled: v } })} />
                </div>
                {ref ? (
                  <div style={{ width: '100%', display: 'flex', gap: 8, alignItems: 'center', paddingLeft: 34 }}>
                    <TextField label="凭据引用名" value={ref} placeholder="如 TAVILY_API_KEY" style={{ width: 200 }}
                      onChange={(v) => patch((d) => { d.engines[id] = { ...d.engines[id], apiKeyEnv: v } })} />
                    <CredRow credentials={credentials} refName={ref} />
                  </div>
                ) : null}
                {id === 'searxng' ? (
                  <div style={{ width: '100%', paddingLeft: 34, paddingRight: 12, paddingBottom: 8 }}>
                    <InstancesEditor value={Array.isArray(engineCfg.instances) ? engineCfg.instances : []} onChange={(list) => patch((d) => { d.engines.searxng = { ...d.engines.searxng, instances: list } })} />
                  </div>
                ) : null}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

/**
 * 引擎徽标：停用/冷却中/失败(码)/免KEY/需KEY·配置态。
 */
function EnginePill({ st, now, enabled, refName, configured }) {
  const cooling = st && typeof st.coolingUntil === 'number' && st.coolingUntil > (now ?? Date.now())
  /** @type {{text: string, kind: 'ok'|'warn'|'error'}[]} */
  const pills = []
  if (!enabled) pills.push({ text: '已停用', kind: 'ok' })
  if (cooling) pills.push({ text: `冷却至 ${new Date(st.coolingUntil).toLocaleTimeString()}`, kind: 'warn' })
  if (st?.lastOutcome?.outcome === 'error') pills.push({ text: `失败(${st.lastOutcome.code ?? '?'})`, kind: 'error' })
  pills.push(refName ? { text: configured ? '需 KEY·已配置' : '需 KEY·未配置', kind: configured ? 'ok' : 'warn' } : { text: '免 KEY', kind: 'ok' })
  return (
    <span style={{ display: 'inline-flex', gap: 4, flexWrap: 'wrap' }}>
      {pills.map((p) => <span key={p.text} style={statusPillStyle(p.kind)}>{p.text}</span>)}
    </span>
  )
}

/**
 * 页签二：学术/平台源启停与附加配置。
 */
function SourcesTab({ cfg, patch, stateData, credentials }) {
  const sources = cfg.sources ?? {}
  const stateSources = new Map((stateData.data?.sources ?? []).map((s) => [s.id, s]))
  return (
    <div style={cardStyle}>
      {SOURCE_META.map((meta, index) => {
        const srcCfg = sources[meta.id] ?? {}
        const st = stateSources.get(meta.id)
        const ref = srcCfg.apiKeyEnv ?? ''
        return (
          <div key={meta.id}>
            {index > 0 ? <div style={dividerStyle} /> : null}
            <div style={S.listRow}>
              <div style={{ minWidth: 150 }}>
                <div style={{ fontWeight: 600, fontSize: 13 }}>{meta.label}<span style={{ ...noteText, marginLeft: 6, textTransform: 'uppercase' }}>{st?.family ?? ''}</span></div>
                <div style={noteText}>{meta.note}</div>
              </div>
              <span style={{ ...pillBase, ...(srcCfg.enabled === false ? badgeStyle(T.labelSecondary) : undefined) }}>
                {srcCfg.enabled === false ? '已停用' : ref ? (st?.configured ? '可选 KEY·已配置' : '可选 KEY·未配置') : '免 KEY'}
              </span>
              <span style={{ flex: 1 }} />
              <Checkbox checked={srcCfg.enabled !== false} label="启用" onChange={(v) => patch((d) => { d.sources[meta.id] = { ...d.sources[meta.id], enabled: v } })} />
              {(meta.id === 'github' || meta.id === 'wikipedia') ? (
                <div style={{ width: '100%', display: 'flex', gap: 8, alignItems: 'center', paddingLeft: 4 }}>
                  {meta.id === 'github' ? (
                    <>
                      <TextField label="凭据引用名（可选）" value={ref} placeholder="如 GITHUB_TOKEN" style={{ width: 200 }}
                        onChange={(v) => patch((d) => { d.sources.github = { ...d.sources.github, apiKeyEnv: v } })} />
                      <CredRow credentials={credentials} refName={ref} />
                    </>
                  ) : (
                    <TextField label="语言（子域）" value={srcCfg.language ?? 'zh'} style={{ width: 120 }}
                      onChange={(v) => patch((d) => { d.sources.wikipedia = { ...d.sources.wikipedia, language: v || 'zh' } })} />
                  )}
                </div>
              ) : null}
            </div>
          </div>
        )
      })}
    </div>
  )
}

/**
 * 页签三：通用（contact 与阅读参数）。
 */
function GeneralTab({ cfg, patch }) {
  const read = cfg.readSource ?? {}
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={cardStyle}>
        <div style={{ ...S.listRow }}>
          <TextField label="礼貌池 contact（mailto，学术源署名用；可空）" value={cfg.contact ?? ''} style={{ flex: 1, minWidth: 260 }}
            placeholder="you@example.com" onChange={(v) => patch((d) => { d.contact = v })} />
        </div>
      </div>
      <div style={cardStyle}>
        <div style={S.listRow}>
          <span style={sectionHead}>有界阅读</span>
          <span style={noteText}>read_source 的分页与落盘参数；SSRF 私网拒绝默认开启。</span>
        </div>
        <div style={dividerStyle} />
        <div style={S.listRow}>
          <NumberField label="默认返回字符" value={read.defaultChars} min={1000} max={20000} step={1000} onChange={(v) => patch((d) => { d.readSource.defaultChars = v })} />
          <NumberField label="硬上限字符" value={read.maxChars} min={1000} max={20000} step={1000} onChange={(v) => patch((d) => { d.readSource.maxChars = v })} />
          <Checkbox checked={read.allowPrivate === true} label="允许内网目标（危险）" onChange={(v) => patch((d) => { d.readSource.allowPrivate = v })} />
        </div>
        <div style={dividerStyle} />
        <div style={S.listRow}>
          <Checkbox checked={read.persist !== false} label="全量落盘" onChange={(v) => patch((d) => { d.readSource.persist = v })} />
          <TextField label="落盘目录（空 = $DSH_HOME 插件数据区；test 必须指 fixture）" value={read.dir ?? ''} style={{ flex: 1, minWidth: 280 }}
            onChange={(v) => patch((d) => { d.readSource.dir = v })} />
          <NumberField label="目录上限 MB" value={read.maxTotalMB} min={1} max={10240} step={1} onChange={(v) => patch((d) => { d.readSource.maxTotalMB = v })} />
        </div>
      </div>
    </div>
  )
}

/**
 * 页签四：诊断实跑（state 投影 + test 信封渲染）。
 */
function DiagnoseTab({ call, stateData, reloadState }) {
  const [source, setSource] = useState('web')
  const [query, setQuery] = useState('')
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState(null)
  const [error, setError] = useState(null)
  const options = useMemo(() => ['web', ...Object.keys(ENGINE_META), ...SOURCE_META.map((s) => s.id)], [])

  async function run() {
    if (!query.trim() || busy) return
    setBusy(true)
    setError(null)
    try {
      setResult(await call.test({ source, query: query.trim() }))
    } catch (err) {
      setResult(null)
      setError(String(err && err.message ? err.message : err))
    } finally {
      setBusy(false)
      reloadState()
    }
  }

  const envelope = result && typeof result === 'object' ? result : null
  const statusKind = envelope?.status === 'ok' ? 'ok' : envelope?.status === 'degraded' ? 'warn' : 'error'

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={cardStyle}>
        <div style={S.listRow}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: T.labelSecondary }}>
            源
            <select value={source} onChange={(e) => setSource(e.target.value)} style={{ ...fieldStyle, font: 'inherit' }}>
              {options.map((id) => <option key={id} value={id}>{id}</option>)}
            </select>
          </label>
          <input style={{ ...fieldStyle, flex: 1, minWidth: 180 }} placeholder="诊断查询（实跑会产生出站请求）" value={query}
            onChange={(e) => setQuery(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && run()} />
          <Button variant="primary" size="sm" disabled={busy || !query.trim()} onClick={run}>{busy ? '运行中…' : '运行'}</Button>
        </div>
      </div>

      {error ? <div style={{ ...subCardStyle, padding: '8px 12px', fontSize: 12, color: T.error }}>调用失败：{error}</div> : null}

      {envelope ? (
        <div style={cardStyle}>
          <div style={S.listRow}>
            <span style={statusPillStyle(statusKind)}>status: {String(envelope.status)}</span>
            {(envelope.sources?.succeeded ?? []).map((id) => <span key={`s${id}`} style={statusPillStyle('ok')}>✓ {id}</span>)}
            {(envelope.sources?.failed ?? []).map((f) => <span key={`f${f.source}`} style={statusPillStyle('error')}>✗ {f.source}({f.code})</span>)}
            <span style={noteText}>去重 {envelope.duplicatesRemoved ?? 0} 条 · 条目 {envelope.items?.length ?? 0}</span>
          </div>
          <div style={dividerStyle} />
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead>
              <tr style={{ color: T.labelSecondary, textAlign: 'left' }}>
                <th style={{ padding: '6px 12px', fontWeight: 500 }}>尝试</th>
                <th style={{ padding: '6px 4px', fontWeight: 500 }}>结果</th>
                <th style={{ padding: '6px 4px', fontWeight: 500 }}>延迟</th>
              </tr>
            </thead>
            <tbody>
              {(envelope.attempts ?? []).map((a, i) => (
                <tr key={`${a.source}-${i}`} style={{ borderTop: `1px solid ${T.borderL1}` }}>
                  <td style={{ padding: '5px 12px' }}>{a.source}</td>
                  <td style={{ padding: '5px 4px' }}>{a.outcome}</td>
                  <td style={{ padding: '5px 4px' }}>{typeof a.latencyMs === 'number' ? `${a.latencyMs}ms` : ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div style={dividerStyle} />
          <div style={{ padding: '8px 12px', display: 'flex', flexDirection: 'column', gap: 4 }}>
            {(envelope.items ?? []).slice(0, 5).map((item, i) => (
              <div key={`${item.url}-${i}`} style={{ fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                <a href={item.url} target="_blank" rel="noreferrer" style={{ color: T.brand, textDecoration: 'none' }}>{item.title ?? item.url}</a>
                <span style={{ ...noteText, marginLeft: 6 }}>— {item.source}{Array.isArray(item.alsoIn) && item.alsoIn.length ? `（亦见 ${item.alsoIn.join(', ')}）` : ''}</span>
              </div>
            ))}
            {Array.isArray(envelope.uncertainty) && envelope.uncertainty.length ? (
              <div style={{ ...noteText, ...badgeStyle(T.warn), padding: '4px 8px', borderRadius: 8, marginTop: 4 }}>
                uncertainty：{envelope.uncertainty.join('；')}
              </div>
            ) : null}
            {Array.isArray(envelope.warnings) && envelope.warnings.length ? (
              <div style={{ ...noteText, marginTop: 2 }}>warnings：{envelope.warnings.join('；')}</div>
            ) : null}
          </div>
        </div>
      ) : (
        <div style={{ ...noteText, padding: '4px 2px' }}>选择源并输入查询，实跑一次检索（含被禁用/无凭据源的直调诊断）。运行后引擎徽标区会自动重拉状态。</div>
      )}
    </div>
  )
}

/**
 * 底部操作条：dirty 才可用；保存冲突/校验拒绝在此呈现。
 */
function SaveBar({ dirty, error, savedAt, onSave, onDiscard }) {
  return (
    <div style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '6px 0' }}>
      <Button variant="primary" size="sm" disabled={!dirty} onClick={onSave}>保存本页签</Button>
      <Button variant="outline" size="sm" disabled={!dirty} onClick={onDiscard}>放弃修改</Button>
      {error ? <span style={{ ...noteText, color: T.error, whiteSpace: 'normal' }}>{error}</span> : null}
      {!error && savedAt && !dirty ? <span style={noteText}>已保存</span> : null}
    </div>
  )
}

/** 行内布尔开关（原生设置页 checkbox 几何）。 */
function Checkbox({ checked, label, onChange }) {
  return (
    <label style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 12, color: T.labelSecondary, cursor: 'pointer' }}>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} style={{ accentColor: T.brand, width: 13, height: 13, margin: 0 }} />
      {label}
    </label>
  )
}

/** 行内文本字段。 */
function TextField({ label, value, onChange, placeholder, style }) {
  return (
    <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, color: T.labelSecondary, minWidth: 0 }}>
      {label}
      <input style={{ ...fieldStyle, ...style }} value={String(value ?? '')} placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)} />
    </label>
  )
}

/** 行内数字字段（非数字输入不落草稿，避免脏值进入 diff）。 */
function NumberField({ label, value, onChange, min, max, step }) {
  const [text, setText] = useState(value === undefined ? '' : String(value))
  useEffect(() => { setText(value === undefined ? '' : String(value)) }, [value])
  return (
    <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, color: T.labelSecondary }}>
      {label}
      <input type="number" style={{ ...fieldStyle, width: 92 }} value={text} min={min} max={max} step={step ?? 1}
        onChange={(e) => {
          setText(e.target.value)
          const n = Number(e.target.value)
          if (e.target.value !== '' && Number.isFinite(n) && (min === undefined || n >= min) && (max === undefined || n <= max)) onChange(Math.round(n))
        }} />
    </label>
  )
}

/** SearXNG 实例列表编辑器（每行一个 URL）。 */
function InstancesEditor({ value, onChange }) {
  const [text, setText] = useState(value.join('\n'))
  useEffect(() => { setText(value.join('\n')) }, [value])
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12, color: T.labelSecondary, width: '100%' }}>
      实例 URL 列表（每行一个；启用 searxng 至少需要一个，非法 URL 会被保存校验拒绝）
      <textarea style={{ ...fieldStyle, minHeight: 64, resize: 'vertical', fontFamily: 'var(--dsw-font-mono, ui-monospace, monospace)' }} value={text}
        onChange={(e) => {
          setText(e.target.value)
          onChange(e.target.value.split('\n').map((line) => line.trim()).filter((line) => line.length > 0))
        }} />
    </label>
  )
}

/**
 * 凭据录入行：describe 状态点 + 内联一次性录入/清除；任何路径不回显值。
 */
function CredRow({ credentials, refName }) {
  const [info, setInfo] = useState(null)
  const [editing, setEditing] = useState(false)
  const [value, setValue] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  const refresh = useCallback(() => {
    if (!credentials || !refName) return
    credentials.describe([refName]).then(
      (map) => setInfo(map.get(refName) ?? null),
      (err) => setError(String(err && err.message ? err.message : err)),
    )
  }, [credentials, refName])
  useEffect(() => { setInfo(null); setError(null); refresh() }, [refresh])

  if (!refName) return null
  const dot = info?.configured ? T.success : T.labelTertiary
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
      <span style={{ width: 7, height: 7, borderRadius: 4, background: dot, flex: 'none' }} />
      <span style={noteText}>{info ? `${info.configured ? '已配置' : '未配置'}${info.source ? `（${info.source}）` : ''}` : '…'}</span>
      {editing ? (
        <>
          <input type="password" style={{ ...fieldStyle, width: 180 }} placeholder="新值（不回显）" value={value} autoFocus
            onChange={(e) => setValue(e.target.value)} />
          <Button size="sm" variant="primary" disabled={busy || !value} onClick={async () => {
            setBusy(true)
            try {
              await credentials.set(refName, value)
              setValue(''); setEditing(false); setError(null); refresh()
            } catch (err) { setError(String(err && err.message ? err.message : err)) } finally { setBusy(false) }
          }}>存入</Button>
          <Button size="sm" variant="ghost" disabled={busy} onClick={() => { setEditing(false); setValue('') }}>取消</Button>
        </>
      ) : (
        <>
          <Button size="sm" variant="outline" onClick={() => setEditing(true)}>{info?.configured ? '改值' : '录入'}</Button>
          {info?.configured && info?.writable ? (
            <Button size="sm" variant="ghost" disabled={busy} onClick={async () => {
              setBusy(true)
              try { await credentials.unset(refName); setError(null); refresh() } catch (err) { setError(String(err && err.message ? err.message : err)) } finally { setBusy(false) }
            }}>清除</Button>
          ) : null}
        </>
      )}
      {error ? <span style={{ ...noteText, color: T.error }}>{error}</span> : null}
    </span>
  )
}

/* ------------------------------- 纯工具函数 ------------------------------- */

/** 深拷贝缺省（结构化克隆不可用环境的兜底不走——浏览器必有 structuredClone）。 */
function pick(obj, keys) {
  const out = {}
  for (const k of keys) out[k] = obj?.[k]
  return out
}

/**
 * 草稿与服务值的脏键集合（JSON 比较，顶层键粒度）。
 */
function dirtyKeys(draft, server, keys) {
  if (!server && !draft) return []
  const out = []
  for (const k of keys) {
    const a = safeStringify(draft?.[k] ?? null)
    const b = safeStringify(server?.[k] ?? null)
    if (a !== b) out.push(k)
  }
  return out
}

/**
 * 叶子级 diff → settings mutate 路径操作集（数组整体替换）。
 * @returns {Array<{op:'set',path:string[],value:unknown}|{op:'unset',path:string[]}>}
 */
function collectOps(base, target, path, ops = []) {
  const b = base && typeof base === 'object' && !Array.isArray(base) ? base : {}
  const t = target && typeof target === 'object' && !Array.isArray(target) ? target : {}
  for (const key of Object.keys(t)) {
    const tv = t[key]
    const bv = b[key]
    if (isPlain(tv) && isPlain(bv)) collectOps(bv, tv, [...path, key], ops)
    else if (safeStringify(tv) !== safeStringify(bv)) ops.push({ op: 'set', path: [...path, key], value: tv })
  }
  for (const key of Object.keys(b)) {
    if (!(key in t)) ops.push({ op: 'unset', path: [...path, key] })
  }
  return ops
}

function isPlain(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v)
}

function safeStringify(v) {
  try {
    return JSON.stringify(v)
  } catch {
    return `!<unstringifiable:${String(v)}>`
  }
}

/** 链序数组内移一位（就地作用于草稿副本）。 */
function moveInOrder(order, id, delta) {
  if (!Array.isArray(order)) return
  const i = order.indexOf(id)
  const j = i + delta
  if (i < 0 || j < 0 || j >= order.length) return
  order.splice(j, 0, ...order.splice(i, 1))
}
