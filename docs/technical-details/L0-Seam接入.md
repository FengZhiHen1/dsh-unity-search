# L0-Seam 接入

本文唯一拥有：web seam provider 的注册与投影、web 行 patch 的双键重述、多 provider 仲裁语义。信封与引擎链的内部机制归「检索核心与信封契约」。

## 目标与边界

让原生 `web_search`/`web_fetch` 开箱即用（RQ-01）：模型可见工具与 schema 完全不变，插件只在 seam 层替换检索后端。seam 契约（已确认事实，DSH 源码 `packages/web/web`）：

- provider 选择：config pin（`searchProvider`/`fetchProvider`）→ 环境变量 → 恰好一个可用自动选中；多个可用报 `WEB_PROVIDER_AMBIGUOUS`。
- 结果形状固定：`WebSearchResult { content?, sources[{ url, title?, snippet?, publishedAt? }], truncated }`；`WebFetchResult { url, statusCode, body: html|text, truncated }`。
- `available()` 必须本地廉价、无网络。

## search provider

adapter 注册一个 `WebSearchProvider`：

| 成员 | 实现 |
| --- | --- |
| `id` | `'unity-search'` |
| `available()` | 引擎链中至少一个引擎 `available()`（本地检查，含冷却状态） |
| `search(request, signal)` | 走引擎链兜底，胜出引擎的信封投影为 seam 形状 |

**投影规则**（信封 → `WebSearchResult`）：

- `sources[]` ← 信封 `items` 的 `{ url, title, snippet, publishedAt }`（`maxResults` 由 seam 截断，provider 不重复截断）。
- `content` ← 仅当信封 `status: 'degraded'` 时填入一行降级注记（如"首选引擎不可用，结果来自备选引擎 bing"）；`ok` 时不填，避免噪音。`unavailable` 时按 seam 语义抛出 `WebError`（工具层渲染为错误结果）。
- 完整信封不穿过 seam——seam 形状固定，证据面由 `search_sources` 工具完整暴露（分层意图见决策记录 DSR-003）。

## fetch 不自建 provider

fetch 端 pin 内建 `http` provider（`@deepseek-ai/dsh-web-fetch-http`，随 base bundle 携带）：匿名公共 HTTP(S) 抓取，自带大小界、超时、重定向界与私网拒绝。高阶读取（正文抽取、聚焦、分页）由 `read_source` 工具承担，与 seam 的"原始取回"语义刻意分工。

## patch 双键重述（约束）

`cordis.patch.yml` 必须双键重述 web 行 config——patch 语义是整行 `config` 替换，只写 `searchProvider` 会丢掉 `fetchProvider`（modsearch 实测事故：多一个 fetch provider 即 `WEB_PROVIDER_AMBIGUOUS`）：

```yaml
- insert:
    - id: unity-search
      name: dsh-unity-search
- id: web
  config:
    searchProvider: unity-search
    fetchProvider: http
```

## 仲裁与部署语义

- 本插件 pin 后，若 profile 另有插件（如 free-search）也在其 bundle 层 pin 同一行，层序后应用者胜出（`dsh.profile.bundles` 列表顺序）；两插件共存时的 pin 归属不确定即部署事故。
- 因此部署约束：web profile 启用本插件时应移除 free-search（部署操作，登记于 TODO.md，需用户指令）。test profile 实测期共存的 pin 以本插件为准（本插件 bundle 在列表中靠后时生效；实测以 `--dump-config` 核对最终行为准）。
- 环境变量 `DSH_WEB_SEARCH_PROVIDER`/`DSH_WEB_FETCH_PROVIDER` 优先于 config pin，属用户显式覆盖通道，文档不屏蔽。

## 验证方式

- test profile 启动后 `--dump-config` 确认 web 行最终 config 双键齐备。
- 原生 `web_search` 实跑冒烟（追溯 AC-01）；禁用首选引擎后再查验证 fallback。
- 卸载验证：dispose 后 provider 从 seam 注册表消失（`registerSearchProvider` 返回的 disposer 绑 fiber）。
