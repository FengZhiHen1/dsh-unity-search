# dsh-unity-search

DSH 统一检索插件：**默认接管 `web_search` 引擎链**（免 key 兜底、失败显形），另以两个常驻工具提供**多源证据检索**与**有界阅读**，捆绑 `unity-search` 技能与「统一搜索」设置节。

## 能力面

| 面 | 说明 |
|---|---|
| `web_search` seam | 注册为宿主默认检索 provider（`cordis.patch.yml` 双键重述 `searchProvider: unity-search` + `fetchProvider: http`）。按配置序跑引擎链（bing → ddg → anysearch → …），首个出结果者赢；错误进冷却并尝试下一个；全失败抛原生 `WebError`。免 key 链路开箱即用，key 引擎在设置页录入凭据后启用 |
| `search_sources` | 23 源（10 网页引擎 + 5 学术 + 8 平台）多源 fanout，产出恒定结构的**证据信封**：`status / sources.{queried,succeeded,failed} / items(+alsoIn) / duplicatesRemoved / answer / uncertainty / warnings / attempts`。跨源按 DOI > arXiv id > URL > 标题去重，多源命中即佐证 |
| `read_source` | 有界阅读：SSRF 私网拒绝（DNS 复校验逐跳重定向）→ 抽取正文 → focus 关键词重排 → `offset/limit` 分页（默认 8000、硬上限 20000 字符）→ **全量落盘** artifact（LRU 目录管理），不重抓即可 grep 自救 |
| skill `unity-search` | 检索面地图 / 源能力矩阵 / fanout 与交叉核验 / 学术工作流 / 有界阅读纪律 / L3 MCP 桥逃生舱；重内容下沉 `references/` |
| 设置节「统一搜索」 | 四页签（网页引擎 / 检索源 / 通用 / 诊断）：引擎链序与启停、凭据引用录入（官方 credentials 中心，值永不回显）、诊断实跑单源并呈现信封；写路径 `expectedRevision` 防陈旧覆盖 |

## 安装（web 稳定 profile）

```
dsh plugin --profile web add github:FengZhiHen1/dsh-unity-search
```

试验 profile（`test`）可直挂源码：`dsh plugin --profile test add link:./plugins/dsh-unity-search`。
⚠ 与 `dsh-free-search` 互斥（同一 seam 双 provider → `WEB_DUPLICATE_PROVIDER`）：接管前从同 profile 移除 free-search。

## 结构

```
src/core/      纯功能层（引擎/源适配器、链、信封、去重、阅读管线）——零 @deepseek-ai/* 依赖，裸 node 可单测
src/adapter/   DSH 接线层（seam/tools/settings/rpc/skill + 入口）
src/client/    浏览器半区（设置节 UI，esbuild → dist/client.js 产物提交进 git）
skills/        A 类捆绑技能（provider 注册，rank 600）
docs/          需求/技术设计/决策记录（本仓库唯一设计权威）
test/          node:test 单测（97 例）
```

## 开发

```
pnpm install
pnpm run check     # 产物新鲜度 --check + 分层门禁 + 单测
node build-client.mjs          # 改 client 后重建 dist/client.js（产物必须提交）
```

## 安全姿态

- 出站 UA 诚实署名；arXiv 3s 礼貌间隔；OpenAlex/Crossref/PubMed 支持 `contact`（mailto）署名。
- `read_source` 默认拒绝私网/元数据地址（含 IPv4-mapped、NAT64 内嵌 v4），DNS 无解析器时失败关闭；`allowPrivate` 为明示危险开关。
- API key 一律走 DSH 凭据中心（声明引用名 + 显式录入，不做环境变量兜底，防跨实例串 key）。
- 全仓无重试策略：失败在信封/尝试记录里显形，由模型决定重查。

## L3 长尾（可选，不进本插件代码）

学术长尾源经官方 `@deepseek-ai/dsh-mcp-client` 桥接第三方 MCP server（如 paper-search-mcp），见 `skills/unity-search/references/mcp-bridge.md`——启用必须显式关闭 Sci-Hub 通道并承受全量工具目录的 token 税。
