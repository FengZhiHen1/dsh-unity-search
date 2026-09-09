# L3 逃生舱：官方 MCP 桥（dsh-mcp-client）

本插件 23 源之外的学术长尾（如 Google Scholar、IACR、下载器类能力）经 DSH 官方桥 `@deepseek-ai/dsh-mcp-client` 接入第三方 MCP server。**本插件与本技能不承担桥的安装、配置与生命周期**——本文只是已核实过方向的样例与红线。

## 路线事实（设计期调研登记）

- `@deepseek-ai/dsh-mcp-client` 是发布在 npm 的 DSH 插件，每 MCP server 一行配置即桥（stdio / streamable-http），工具以 `mcp__<server>__<tool>` 命名注册进工具目录，默认不启用。
- 上游样例 server：[openags/paper-search-mcp](https://github.com/openags/paper-search-mcp)（Python，arXiv/PubMed/bioRxiv/Google Scholar 等约 22 源，含下载能力）。
- ⚠ 桥包配置的确切键名以**安装时的包 README 现查为准**（`npm view @deepseek-ai/dsh-mcp-client` / 装后读其 README）。本文样例为形态示意，非逐键验证过的事实（本机网络无法复核上游仓库，属登记项）。

## 配置样例（形态示意）

```yaml
# profiles/<name>/cordis.user.yml —— 先经 dsh plugin 安装桥包，再补一行带 config 的插入
- insert:
    - id: mcp-client
      name: '@deepseek-ai/dsh-mcp-client'
      config:
        servers:
          paper-search:
            command: uvx           # stdio 通道：本地进程
            args: ['paper-search-mcp']
            env:
              USE_SCIHUB: 'False'  # ★ 红线，见下
```

（键名 `servers`/`command`/`args`/`env` 是 MCP 生态通行形态；若与桥包 README 有出入，以 README 为准并回来更新本文。）

## ★ 红线：必须显式关闭 Sci-Hub

paper-search-mcp 的下载族包含 Sci-Hub 通道——侵权灰区、域名漂移、内容不可信三重问题。启用桥时**必须显式设置 `use_scihub=False`（大小写/键形随目标版本，装后先查其工具 schema）**，并确认模型侧不可通过工具参数把它打开。做不到就不要启用该 server，改走本插件 23 源 + `read_source` 读 OA 页面。

## token 税与运维

- 桥工具**全量**进每轮工具目录：paper-search-mcp ≈57 个工具描述，常驻消耗数千 token——只在确有长尾需求的会话期开启，用完移除该行配置。
- Python MCP server 经 uvx 拉起有秒级冷启动；桥侧失败与 unity-search 信封互不隶属，模型须自行区分 `mcp__*` 工具的报错。
- 安全：MCP server 是第三方代码，能读写本机资源（如 PDF 下载目录）。只启用可信上游、锁版本、给最小文件系统权限。

## 验证清单（启用后）

1. `--dump-config` 出现 mcp-client 行且无 duplicate id。
2. 启动无 `N entries did not activate`。
3. 目录中出现 `mcp__paper-search__*` 工具且数量为预期（防 server 半挂）。
4. 跑一次仅涉 arXiv 的查询，确认返回结构可解析；Sci-Hub 相关工具行为符合关闭预期（若存在独立下载工具，不主动调用即为兜底纪律）。
