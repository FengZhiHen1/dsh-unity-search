window.__ModuleLoader__.load({ id: "dsh-unity-search", factory: (require) => {
var module = { exports: {} };
var exports = module.exports;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/client/index.jsx
var index_exports = {};
__export(index_exports, {
  apply: () => apply,
  inject: () => inject
});
module.exports = __toCommonJS(index_exports);

// src/client/api.js
var CHANNEL = "/unity-search";
var STATE_TIMEOUT_MS = 15e3;
var TEST_TIMEOUT_MS = 35e3;
var RpcError = class extends Error {
  /** @type {string} */
  code;
  /** @type {boolean} */
  retryable;
  /**
   * @param {string} message
   * @param {{ code?: string, retryable?: boolean }} [options]
   */
  constructor(message, { code = "internal", retryable = false } = {}) {
    super(message);
    this.name = "RpcError";
    this.code = code;
    this.retryable = retryable;
  }
};
function createCall(ctx) {
  async function call(endpoint, payload, budgetMs) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), budgetMs);
    let result;
    try {
      result = await ctx.connection.rpc.call(CHANNEL, endpoint, payload, controller.signal);
    } catch (error) {
      const aborted = Boolean(error && (error.name === "AbortError" || error.name === "TimeoutError"));
      throw new RpcError(
        aborted ? `\u8C03\u7528 ${endpoint} \u8D85\u65F6\uFF08${Math.round(budgetMs / 1e3)}s\uFF09` : `RPC \u901A\u9053\u5931\u8D25\uFF08${endpoint}\uFF09\uFF1A${error && error.message ? error.message : String(error)}`,
        { code: "transport", retryable: true }
      );
    } finally {
      clearTimeout(timer);
    }
    if (result && typeof result === "object" && result.ok === true) return result.value;
    const failure = result && typeof result === "object" && result.error ? result.error : {};
    throw new RpcError(failure.message || "\u8BF7\u6C42\u5931\u8D25", { code: failure.code || "internal", retryable: false });
  }
  return {
    async state() {
      return narrowState(await call("state", {}, STATE_TIMEOUT_MS));
    },
    async test(payload) {
      return call("test", payload, TEST_TIMEOUT_MS);
    }
  };
}
function narrowState(value) {
  const root = (
    /** @type {Record<string, unknown>} */
    value && typeof value === "object" ? value : {}
  );
  const isArr = (v) => Array.isArray(v);
  const engines = isArr(root.engines) ? root.engines.map((e) => {
    const row = (
      /** @type {Record<string, unknown>} */
      e
    );
    return {
      id: typeof row.id === "string" ? row.id : "?",
      enabled: row.enabled === true,
      configured: row.configured === true,
      available: row.available === true,
      coolingUntil: typeof row.coolingUntil === "number" ? row.coolingUntil : 0,
      lastOutcome: row.lastOutcome && typeof row.lastOutcome === "object" ? (
        /** @type {NormalizedState['engines'][number]['lastOutcome']} */
        row.lastOutcome
      ) : null
    };
  }) : [];
  const sources = isArr(root.sources) ? root.sources.map((s) => {
    const row = (
      /** @type {Record<string, unknown>} */
      s
    );
    return {
      id: typeof row.id === "string" ? row.id : "?",
      family: typeof row.family === "string" ? row.family : "web",
      enabled: row.enabled === true,
      configured: row.configured === true,
      available: row.available === true
    };
  }) : [];
  const chain = (
    /** @type {Record<string, unknown>} */
    root.chain && typeof root.chain === "object" ? root.chain : {}
  );
  return {
    engines,
    sources,
    chain: {
      order: isArr(chain.order) ? chain.order.filter((x) => typeof x === "string") : [],
      cooldownSeconds: typeof chain.cooldownSeconds === "number" ? chain.cooldownSeconds : 300,
      timeoutMs: typeof chain.timeoutMs === "number" ? chain.timeoutMs : 15e3
    },
    now: typeof root.now === "number" ? root.now : Date.now()
  };
}

// src/client/credentials.js
function createCredentials(ctx) {
  function remoteCredentials() {
    try {
      return (
        /** @type {{ describe?: Function, set?: Function, unset?: Function } | undefined} */
        ctx.remote && /** @type {Record<string, unknown>} */
        ctx.remote.credentials
      );
    } catch {
      return void 0;
    }
  }
  function unwrap(result, op) {
    if (result && typeof result === "object" && result.ok === true) return result.value;
    const failure = result && typeof result === "object" && result.error ? result.error : {};
    throw new RpcError(failure.message || `credentials.${op} \u5931\u8D25`, { code: failure.code || "internal", retryable: false });
  }
  return {
    /**
     * @param {string[]} refs
     * @returns {Promise<Map<string, CredentialState>>}
     */
    async describe(refs) {
      const rc = remoteCredentials();
      const out = /* @__PURE__ */ new Map();
      if (!rc || typeof rc.describe !== "function") {
        for (const ref of refs) out.set(ref, { configured: false, source: null, writable: false });
        return out;
      }
      const value = unwrap(await rc.describe(refs), "describe");
      const record = value && typeof value === "object" ? (
        /** @type {Record<string, unknown>} */
        value
      ) : {};
      for (const ref of refs) {
        const info = record[ref] && typeof record[ref] === "object" ? (
          /** @type {Record<string, unknown>} */
          record[ref]
        ) : {};
        out.set(ref, {
          configured: info.configured === true,
          source: typeof info.source === "string" ? info.source : null,
          writable: info.writable === true
        });
      }
      return out;
    },
    /**
     * @param {string} ref
     * @param {string} value
     */
    async set(ref, value) {
      const rc = remoteCredentials();
      if (!rc || typeof rc.set !== "function") throw new RpcError("\u51ED\u636E\u4E2D\u5FC3\u4E0D\u53EF\u7528\uFF1A\u5F53\u524D\u90E8\u7F72\u672A\u6302\u8F7D credentials Remote \u547D\u540D\u7A7A\u95F4", { code: "unavailable", retryable: false });
      unwrap(await rc.set(ref, value), "set");
    },
    /**
     * @param {string} ref
     */
    async unset(ref) {
      const rc = remoteCredentials();
      if (!rc || typeof rc.unset !== "function") throw new RpcError("\u51ED\u636E\u4E2D\u5FC3\u4E0D\u53EF\u7528\uFF1A\u5F53\u524D\u90E8\u7F72\u672A\u6302\u8F7D credentials Remote \u547D\u540D\u7A7A\u95F4", { code: "unavailable", retryable: false });
      unwrap(await rc.unset(ref), "unset");
    }
  };
}

// src/client/section.jsx
var import_react = require("react");
var import_dsh_client_ui_primitives = require("@deepseek-ai/dsh-client-ui-primitives");

// src/client/theme.js
var T = {
  bgBase: "var(--dsw-alias-bg-base)",
  bgLayer2: "var(--dsw-alias-bg-layer-2)",
  bgLayer3: "var(--dsw-alias-bg-layer-3)",
  bgModulePlatform: "var(--dsw-alias-bg-module-platform)",
  borderL1: "var(--dsw-alias-border-l1)",
  borderL2: "var(--dsw-alias-border-l2)",
  brand: "var(--dsw-alias-brand-primary)",
  labelPrimary: "var(--dsw-alias-label-primary)",
  labelSecondary: "var(--dsw-alias-label-secondary)",
  labelTertiary: "var(--dsw-alias-label-tertiary)",
  success: "var(--dsw-alias-state-success-primary)",
  error: "var(--dsw-alias-state-error-primary)",
  warn: "var(--dsw-alias-state-warn-primary)"
};
var badgeStyle = (color) => ({
  color,
  background: `color-mix(in srgb, ${color} 15%, transparent)`
});
var pillBase = {
  display: "inline-block",
  padding: "1px 8px",
  borderRadius: 999,
  fontSize: 11,
  lineHeight: "17px",
  background: T.bgModulePlatform,
  color: T.labelSecondary,
  whiteSpace: "nowrap"
};
var statusPillStyle = (kind) => {
  if (kind === "warn") return { ...pillBase, ...badgeStyle(T.warn) };
  if (kind === "error") return { ...pillBase, ...badgeStyle(T.error) };
  return pillBase;
};
var S = {
  panel: { padding: "10px 0" },
  listRow: { display: "flex", alignItems: "center", gap: 8, padding: "8px 12px", fontSize: 13, flexWrap: "wrap" },
  toolbar: { display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginBottom: 6 },
  muted: { color: T.labelSecondary, fontSize: 12 }
};
var cardStyle = { border: `1px solid ${T.borderL1}`, borderRadius: 12, background: T.bgLayer3, overflow: "hidden" };
var subCardStyle = { borderRadius: 10, background: T.bgModulePlatform };
var dividerStyle = { height: 1, background: T.borderL1, flex: "none" };
var noteText = { fontSize: 11, color: T.labelSecondary, lineHeight: 1.5 };
var sectionHead = { fontSize: 14, fontWeight: 600, color: T.labelPrimary };
var linkBtn = { border: "none", background: "none", padding: 0, font: "inherit", fontSize: 11, color: T.labelSecondary, cursor: "pointer" };
var fieldStyle = { border: `1px solid ${T.borderL1}`, borderRadius: 8, background: T.bgLayer3, padding: "4px 8px", font: "inherit", fontSize: 12, color: T.labelPrimary, minWidth: 0 };

// src/client/section.jsx
var import_jsx_runtime = require("react/jsx-runtime");
var ENGINE_META = {
  bing: { label: "Bing", note: "\u514D key HTML \u515C\u5E95\uFF0C\u65F6\u95F4\u8FC7\u6EE4\u6309\u5B9E\u6D4B filters \u8BED\u6CD5" },
  ddg: { label: "DuckDuckGo", note: "\u514D key HTML\uFF0Cdf \u7C97\u7C92\u5EA6\u65F6\u95F4\u7A97" },
  "ddg-lite": { label: "DDG Lite", note: "\u6781\u7B80 HTML\uFF0C\u89E3\u6790\u5BB9\u9519\u4F18\u5148" },
  anysearch: { label: "AnySearch", note: "\u514D key AI \u68C0\u7D22\uFF0Canswer \u900F\u4F20\u4FE1\u5C01" },
  searxng: { label: "SearXNG", note: "\u81EA\u5EFA/\u516C\u5171\u5B9E\u4F8B\u5217\u8868\u9010\u5B9E\u4F8B\u515C\u5E95\uFF0C\u9ED8\u8BA4\u5173\u95ED" },
  keenable: { label: "Keenable", note: "\u65E0 key \u8D70\u516C\u5171 MCP\uFF0C\u6709 key \u8D70 REST" },
  "deepseek-official": { label: "DeepSeek \u5B98\u65B9", note: "\u5BBF\u4E3B\u73B0\u4EFB\u540E\u7AEF\u81EA\u5305\u542B\u590D\u523B" },
  tavily: { label: "Tavily", note: "key \u5F15\u64CE\uFF08TAVILY_API_KEY\uFF09" },
  exa: { label: "Exa", note: "key \u5F15\u64CE\uFF08EXA_API_KEY\uFF09\uFF0CstartPublishedDate \u7CBE\u786E" },
  perplexity: { label: "Perplexity", note: "key \u5F15\u64CE\uFF08PERPLEXITY_API_KEY\uFF09\uFF0C\u7B54\u6848 + citations" }
};
var SOURCE_META = [
  { id: "arxiv", label: "arXiv", note: "\u9884\u5370\u672C\uFF1B3s \u793C\u8C8C\u95F4\u9694" },
  { id: "openalex", label: "OpenAlex", note: "\u5F00\u653E\u5B66\u672F\u56FE\u8C31\uFF08\u9898\u5F55\u7EA7\uFF09" },
  { id: "crossref", label: "Crossref", note: "DOI \u6CE8\u518C\u673A\u6784\uFF08\u9898\u5F55\u7EA7\uFF09" },
  { id: "pubmed", label: "PubMed", note: "\u751F\u533B\u9898\u5F55\uFF08\u4E24\u6B65 esearch/efetch\uFF09" },
  { id: "europepmc", label: "EuropePMC", note: "\u9898\u5F55 + OA \u6807\u8BC6" },
  { id: "github", label: "GitHub", note: "\u4ED3\u5E93\u641C\u7D22\uFF1B\u53EF\u9009 token \u63D0\u989D" },
  { id: "stackoverflow", label: "StackOverflow", note: "\u95EE\u7B54\u7AD9\u5185\u641C\u7D22" },
  { id: "hn", label: "Hacker News", note: "Algolia \u955C\u50CF" },
  { id: "wikipedia", label: "Wikipedia", note: "\u591A\u8BED\u8A00\u7AD9\u5185\u68C0\u7D22" },
  { id: "npm", label: "npm", note: "\u5305\u641C\u7D22" },
  { id: "v2ex", label: "V2EX", note: "\u4EC5\u70ED\u699C\u672C\u5730\u8FC7\u6EE4\uFF08\u8986\u76D6\u9762\u6709\u9650\uFF09" },
  { id: "bilibili", label: "Bilibili", note: "\u89C6\u9891\u7AD9\u5185\u68C0\u7D22" },
  { id: "reddit", label: "Reddit", note: "\u5E16\u5B50\u641C\u7D22\uFF08\u65E0\u767B\u5F55\uFF09" }
];
var TABS = [
  { id: "engines", label: "\u7F51\u9875\u5F15\u64CE" },
  { id: "sources", label: "\u68C0\u7D22\u6E90" },
  { id: "general", label: "\u901A\u7528" },
  { id: "diagnose", label: "\u8BCA\u65AD" }
];
var TAB_KEYS = {
  engines: ["chain", "engines"],
  sources: ["sources"],
  general: ["contact", "readSource"],
  diagnose: []
};
function UnitySearchSection(props) {
  const { call, scope, credentials } = props ?? {};
  const unavailable = !call || !scope;
  const [snapshot, setSnapshot] = (0, import_react.useState)(() => scope ? scope.getSnapshot() : { status: "loading" });
  (0, import_react.useEffect)(() => {
    if (!scope) return void 0;
    return scope.subscribe(() => setSnapshot(scope.getSnapshot()));
  }, [scope]);
  const serverValue = snapshot.status === "ready" && snapshot.value ? snapshot.value : null;
  const [draft, setDraft] = (0, import_react.useState)(() => structuredClone(serverValue ?? {}));
  const [draftBase, setDraftBase] = (0, import_react.useState)(() => snapshot.revision);
  const [tab, setTab] = (0, import_react.useState)("engines");
  const [saveError, setSaveError] = (0, import_react.useState)(null);
  const [savedAt, setSavedAt] = (0, import_react.useState)(0);
  (0, import_react.useEffect)(() => {
    if (snapshot.status !== "ready") return;
    if (snapshot.revision === draftBase) return;
    if (!dirtyKeys(draft, serverValue, ["chain", "engines", "sources", "contact", "readSource"]).length) {
      setDraft(structuredClone(serverValue ?? {}));
      setDraftBase(snapshot.revision);
    }
  }, [snapshot, serverValue, draft, draftBase]);
  const stateData = useRpcState(call);
  const dirty = (0, import_react.useMemo)(() => dirtyKeys(draft, serverValue, TAB_KEYS[tab]), [draft, serverValue, tab]);
  const patch = (0, import_react.useCallback)((fn) => {
    setDraft((prev) => {
      const next = structuredClone(prev);
      fn(next);
      return next;
    });
    setSaveError(null);
  }, []);
  async function save() {
    if (!dirty.length) return;
    const ops = collectOps(pick(serverValue ?? {}, dirty), pick(draft, dirty), []);
    try {
      await scope.mutate(ops, snapshot.revision);
    } catch (error) {
      setSaveError(`\u4FDD\u5B58\u5931\u8D25\uFF1A${String(error && error.message ? error.message : error)}\uFF08\u8349\u7A3F\u5DF2\u4FDD\u7559\uFF1B\u5982\u63D0\u793A\u51B2\u7A81\u8BF7\u5237\u65B0\u91CD\u8BD5\uFF09`);
      return;
    }
    const after = scope.getSnapshot();
    const afterValue = after.status === "ready" && after.value ? after.value : null;
    const residual = dirtyKeys(draft, afterValue, dirty);
    if (residual.length) {
      setSaveError(`\u914D\u7F6E\u88AB\u670D\u52A1\u7AEF\u6821\u9A8C\u62D2\u7EDD\uFF08${residual.join("\u3001")} \u672A\u751F\u6548\uFF09\uFF1B\u8349\u7A3F\u5DF2\u4FDD\u7559\uFF0C\u53EF\u5BF9\u7167\u9875\u5185\u89C4\u5219\u4FEE\u6B63\u540E\u91CD\u8BD5`);
      return;
    }
    setDraftBase(after.revision);
    setDraft(structuredClone(afterValue ?? {}));
    setSavedAt(Date.now());
  }
  if (unavailable) {
    return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { style: S.panel, children: "\u7EDF\u4E00\u641C\u7D22\u8BBE\u7F6E\u4E0D\u53EF\u7528\uFF1A\u6CE8\u5165\u9762\u7F3A\u5931\uFF08Host \u534A\u533A\u672A\u6302\u8F7D\uFF1F\uFF09\u3002" });
  }
  return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: { ...S.panel, display: "flex", flexDirection: "column", gap: 12 }, children: [
    /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("header", { children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { style: { ...sectionHead, fontSize: 15 }, children: "\u7EDF\u4E00\u641C\u7D22" }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { style: { ...noteText, marginTop: 2 }, children: "\u591A\u6E90\u7EDF\u4E00\u68C0\u7D22\uFF1A\u7F51\u9875\u5F15\u64CE\u94FE\u3001\u5B66\u672F\u4E0E\u5E73\u53F0\u6E90\u3001\u51ED\u636E\u4E0E\u8BCA\u65AD\u3002" })
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)(TabBar, { active: tab, onChange: setTab }),
    tab === "engines" ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)(EnginesTab, { cfg: draft, patch, stateData, credentials }) : null,
    tab === "sources" ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)(SourcesTab, { cfg: draft, patch, stateData, credentials }) : null,
    tab === "general" ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)(GeneralTab, { cfg: draft, patch }) : null,
    tab === "diagnose" ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)(DiagnoseTab, { call, stateData, reloadState: stateData.reload }) : null,
    tab !== "diagnose" ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
      SaveBar,
      {
        dirty: dirty.length > 0,
        error: saveError,
        savedAt,
        onSave: save,
        onDiscard: () => {
          setDraft(structuredClone(serverValue ?? {}));
          setDraftBase(snapshot.revision);
          setSaveError(null);
        }
      }
    ) : null
  ] });
}
function TabBar({ active, onChange }) {
  return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("nav", { style: { display: "flex", gap: 16, borderBottom: `1px solid ${T.borderL1}` }, children: TABS.map((t) => {
    const on = t.id === active;
    return /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
      "button",
      {
        type: "button",
        onClick: () => onChange(t.id),
        style: {
          border: "none",
          borderBottom: on ? `2px solid ${T.brand}` : "2px solid transparent",
          background: "none",
          font: "inherit",
          fontSize: 13,
          fontWeight: on ? 600 : 400,
          color: on ? T.labelPrimary : T.labelSecondary,
          cursor: "pointer",
          padding: "6px 2px"
        },
        children: t.label
      },
      t.id
    );
  }) });
}
function useRpcState(call) {
  const [data, setData] = (0, import_react.useState)(null);
  const [error, setError] = (0, import_react.useState)(null);
  const [loading, setLoading] = (0, import_react.useState)(false);
  const reload = (0, import_react.useCallback)(() => {
    if (!call) return;
    setLoading(true);
    call.state().then(
      (value) => {
        setData(value);
        setError(null);
      },
      (err) => setError(String(err && err.message ? err.message : err))
    ).finally(() => setLoading(false));
  }, [call]);
  (0, import_react.useEffect)(reload, [reload]);
  return { data, error, loading, reload };
}
function EnginesTab({ cfg, patch, stateData, credentials }) {
  const chain = cfg.chain ?? {};
  const engines = cfg.engines ?? {};
  const order = Array.isArray(chain.order) ? chain.order : [];
  const ids = (0, import_react.useMemo)(() => {
    const known = Object.keys(ENGINE_META);
    const listed = order.filter((id) => known.includes(id));
    const unlisted = known.filter((id) => !listed.includes(id));
    return { rows: [...listed, ...unlisted] };
  }, [order]);
  const engineState = new Map((stateData.data?.engines ?? []).map((e) => [e.id, e]));
  return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: { display: "flex", flexDirection: "column", gap: 10 }, children: [
    /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: { ...cardStyle }, children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: S.listRow, children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { style: sectionHead, children: "\u94FE\u53C2\u6570" }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { style: { flex: 1 } }),
        stateData.loading ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { style: noteText, children: "\u72B6\u6001\u5237\u65B0\u4E2D\u2026" }) : null,
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_dsh_client_ui_primitives.Button, { variant: "outline", size: "sm", onClick: stateData.reload, children: "\u5237\u65B0\u72B6\u6001" })
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { style: dividerStyle }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: S.listRow, children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)(NumberField, { label: "\u5931\u8D25\u51B7\u5374\uFF08\u79D2\uFF09", value: chain.cooldownSeconds, min: 0, max: 3600, onChange: (v) => patch((d) => {
          d.chain.cooldownSeconds = v;
        }) }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)(NumberField, { label: "\u5355\u6B21\u5F15\u64CE\u8D85\u65F6\uFF08ms\uFF09", value: chain.timeoutMs, min: 1e3, max: 12e4, step: 1e3, onChange: (v) => patch((d) => {
          d.chain.timeoutMs = v;
        }) })
      ] }),
      stateData.error ? /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: { ...noteText, color: T.error, padding: "0 12px 8px" }, children: [
        "\u72B6\u6001\u6295\u5F71\u5931\u8D25\uFF1A",
        stateData.error
      ] }) : null
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { style: cardStyle, children: ids.rows.map((id, index) => {
      const meta = ENGINE_META[id];
      const engineCfg = engines[id] ?? {};
      const st = engineState.get(id);
      const inOrder = order.includes(id);
      const ref = engineCfg.apiKeyEnv ?? "";
      return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { children: [
        index > 0 ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { style: dividerStyle }) : null,
        /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: S.listRow, children: [
          /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: { display: "flex", gap: 4 }, children: [
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
              "button",
              {
                type: "button",
                title: "\u4E0A\u79FB",
                disabled: !inOrder || index === 0 || order.length === 0,
                style: { ...linkBtn, opacity: !inOrder || index === 0 ? 0.35 : 1 },
                onClick: () => patch((d) => moveInOrder(d.chain.order, id, -1)),
                children: "\u2191"
              }
            ),
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
              "button",
              {
                type: "button",
                title: "\u4E0B\u79FB",
                disabled: !inOrder || !order.includes(id),
                style: { ...linkBtn, opacity: !inOrder ? 0.35 : 1 },
                onClick: () => patch((d) => moveInOrder(d.chain.order, id, 1)),
                children: "\u2193"
              }
            )
          ] }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: { minWidth: 150 }, children: [
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { style: { fontWeight: 600, fontSize: 13 }, children: meta.label }),
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { style: noteText, children: meta.note })
          ] }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)(EnginePill, { st, now: stateData.data?.now, enabled: engineCfg.enabled !== false, refName: ref, configured: st?.configured }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: { display: "flex", gap: 8, alignItems: "center" }, children: [
            inOrder ? null : /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { type: "button", style: linkBtn, onClick: () => patch((d) => {
              d.chain.order.push(id);
            }), children: "\u52A0\u5165\u94FE" }),
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Checkbox, { checked: engineCfg.enabled !== false, label: "\u542F\u7528", onChange: (v) => patch((d) => {
              d.engines[id] = { ...d.engines[id], enabled: v };
            }) })
          ] }),
          ref ? /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: { width: "100%", display: "flex", gap: 8, alignItems: "center", paddingLeft: 34 }, children: [
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
              TextField,
              {
                label: "\u51ED\u636E\u5F15\u7528\u540D",
                value: ref,
                placeholder: "\u5982 TAVILY_API_KEY",
                style: { width: 200 },
                onChange: (v) => patch((d) => {
                  d.engines[id] = { ...d.engines[id], apiKeyEnv: v };
                })
              }
            ),
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)(CredRow, { credentials, refName: ref })
          ] }) : null,
          id === "searxng" ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { style: { width: "100%", paddingLeft: 34, paddingRight: 12, paddingBottom: 8 }, children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(InstancesEditor, { value: Array.isArray(engineCfg.instances) ? engineCfg.instances : [], onChange: (list) => patch((d) => {
            d.engines.searxng = { ...d.engines.searxng, instances: list };
          }) }) }) : null
        ] })
      ] }, id);
    }) })
  ] });
}
function EnginePill({ st, now, enabled, refName, configured }) {
  const cooling = st && typeof st.coolingUntil === "number" && st.coolingUntil > (now ?? Date.now());
  const pills = [];
  if (!enabled) pills.push({ text: "\u5DF2\u505C\u7528", kind: "ok" });
  if (cooling) pills.push({ text: `\u51B7\u5374\u81F3 ${new Date(st.coolingUntil).toLocaleTimeString()}`, kind: "warn" });
  if (st?.lastOutcome?.outcome === "error") pills.push({ text: `\u5931\u8D25(${st.lastOutcome.code ?? "?"})`, kind: "error" });
  pills.push(refName ? { text: configured ? "\u9700 KEY\xB7\u5DF2\u914D\u7F6E" : "\u9700 KEY\xB7\u672A\u914D\u7F6E", kind: configured ? "ok" : "warn" } : { text: "\u514D KEY", kind: "ok" });
  return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { style: { display: "inline-flex", gap: 4, flexWrap: "wrap" }, children: pills.map((p) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { style: statusPillStyle(p.kind), children: p.text }, p.text)) });
}
function SourcesTab({ cfg, patch, stateData, credentials }) {
  const sources = cfg.sources ?? {};
  const stateSources = new Map((stateData.data?.sources ?? []).map((s) => [s.id, s]));
  return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { style: cardStyle, children: SOURCE_META.map((meta, index) => {
    const srcCfg = sources[meta.id] ?? {};
    const st = stateSources.get(meta.id);
    const ref = srcCfg.apiKeyEnv ?? "";
    return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { children: [
      index > 0 ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { style: dividerStyle }) : null,
      /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: S.listRow, children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: { minWidth: 150 }, children: [
          /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: { fontWeight: 600, fontSize: 13 }, children: [
            meta.label,
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { style: { ...noteText, marginLeft: 6, textTransform: "uppercase" }, children: st?.family ?? "" })
          ] }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { style: noteText, children: meta.note })
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { style: { ...pillBase, ...srcCfg.enabled === false ? badgeStyle(T.labelSecondary) : void 0 }, children: srcCfg.enabled === false ? "\u5DF2\u505C\u7528" : ref ? st?.configured ? "\u53EF\u9009 KEY\xB7\u5DF2\u914D\u7F6E" : "\u53EF\u9009 KEY\xB7\u672A\u914D\u7F6E" : "\u514D KEY" }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { style: { flex: 1 } }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Checkbox, { checked: srcCfg.enabled !== false, label: "\u542F\u7528", onChange: (v) => patch((d) => {
          d.sources[meta.id] = { ...d.sources[meta.id], enabled: v };
        }) }),
        meta.id === "github" || meta.id === "wikipedia" ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { style: { width: "100%", display: "flex", gap: 8, alignItems: "center", paddingLeft: 4 }, children: meta.id === "github" ? /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(import_jsx_runtime.Fragment, { children: [
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
            TextField,
            {
              label: "\u51ED\u636E\u5F15\u7528\u540D\uFF08\u53EF\u9009\uFF09",
              value: ref,
              placeholder: "\u5982 GITHUB_TOKEN",
              style: { width: 200 },
              onChange: (v) => patch((d) => {
                d.sources.github = { ...d.sources.github, apiKeyEnv: v };
              })
            }
          ),
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)(CredRow, { credentials, refName: ref })
        ] }) : /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
          TextField,
          {
            label: "\u8BED\u8A00\uFF08\u5B50\u57DF\uFF09",
            value: srcCfg.language ?? "zh",
            style: { width: 120 },
            onChange: (v) => patch((d) => {
              d.sources.wikipedia = { ...d.sources.wikipedia, language: v || "zh" };
            })
          }
        ) }) : null
      ] })
    ] }, meta.id);
  }) });
}
function GeneralTab({ cfg, patch }) {
  const read = cfg.readSource ?? {};
  return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: { display: "flex", flexDirection: "column", gap: 10 }, children: [
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { style: cardStyle, children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { style: { ...S.listRow }, children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
      TextField,
      {
        label: "\u793C\u8C8C\u6C60 contact\uFF08mailto\uFF0C\u5B66\u672F\u6E90\u7F72\u540D\u7528\uFF1B\u53EF\u7A7A\uFF09",
        value: cfg.contact ?? "",
        style: { flex: 1, minWidth: 260 },
        placeholder: "you@example.com",
        onChange: (v) => patch((d) => {
          d.contact = v;
        })
      }
    ) }) }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: cardStyle, children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: S.listRow, children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { style: sectionHead, children: "\u6709\u754C\u9605\u8BFB" }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { style: noteText, children: "read_source \u7684\u5206\u9875\u4E0E\u843D\u76D8\u53C2\u6570\uFF1BSSRF \u79C1\u7F51\u62D2\u7EDD\u9ED8\u8BA4\u5F00\u542F\u3002" })
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { style: dividerStyle }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: S.listRow, children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)(NumberField, { label: "\u9ED8\u8BA4\u8FD4\u56DE\u5B57\u7B26", value: read.defaultChars, min: 1e3, max: 2e4, step: 1e3, onChange: (v) => patch((d) => {
          d.readSource.defaultChars = v;
        }) }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)(NumberField, { label: "\u786C\u4E0A\u9650\u5B57\u7B26", value: read.maxChars, min: 1e3, max: 2e4, step: 1e3, onChange: (v) => patch((d) => {
          d.readSource.maxChars = v;
        }) }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Checkbox, { checked: read.allowPrivate === true, label: "\u5141\u8BB8\u5185\u7F51\u76EE\u6807\uFF08\u5371\u9669\uFF09", onChange: (v) => patch((d) => {
          d.readSource.allowPrivate = v;
        }) })
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { style: dividerStyle }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: S.listRow, children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Checkbox, { checked: read.persist !== false, label: "\u5168\u91CF\u843D\u76D8", onChange: (v) => patch((d) => {
          d.readSource.persist = v;
        }) }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
          TextField,
          {
            label: "\u843D\u76D8\u76EE\u5F55\uFF08\u7A7A = $DSH_HOME \u63D2\u4EF6\u6570\u636E\u533A\uFF1Btest \u5FC5\u987B\u6307 fixture\uFF09",
            value: read.dir ?? "",
            style: { flex: 1, minWidth: 280 },
            onChange: (v) => patch((d) => {
              d.readSource.dir = v;
            })
          }
        ),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)(NumberField, { label: "\u76EE\u5F55\u4E0A\u9650 MB", value: read.maxTotalMB, min: 1, max: 10240, step: 1, onChange: (v) => patch((d) => {
          d.readSource.maxTotalMB = v;
        }) })
      ] })
    ] })
  ] });
}
function DiagnoseTab({ call, stateData, reloadState }) {
  const [source, setSource] = (0, import_react.useState)("web");
  const [query, setQuery] = (0, import_react.useState)("");
  const [busy, setBusy] = (0, import_react.useState)(false);
  const [result, setResult] = (0, import_react.useState)(null);
  const [error, setError] = (0, import_react.useState)(null);
  const options = (0, import_react.useMemo)(() => ["web", ...Object.keys(ENGINE_META), ...SOURCE_META.map((s) => s.id)], []);
  async function run() {
    if (!query.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      setResult(await call.test({ source, query: query.trim() }));
    } catch (err) {
      setResult(null);
      setError(String(err && err.message ? err.message : err));
    } finally {
      setBusy(false);
      reloadState();
    }
  }
  const envelope = result && typeof result === "object" ? result : null;
  const statusKind = envelope?.status === "ok" ? "ok" : envelope?.status === "degraded" ? "warn" : "error";
  return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: { display: "flex", flexDirection: "column", gap: 10 }, children: [
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { style: cardStyle, children: /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: S.listRow, children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("label", { style: { display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: T.labelSecondary }, children: [
        "\u6E90",
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("select", { value: source, onChange: (e) => setSource(e.target.value), style: { ...fieldStyle, font: "inherit" }, children: options.map((id) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)("option", { value: id, children: id }, id)) })
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
        "input",
        {
          style: { ...fieldStyle, flex: 1, minWidth: 180 },
          placeholder: "\u8BCA\u65AD\u67E5\u8BE2\uFF08\u5B9E\u8DD1\u4F1A\u4EA7\u751F\u51FA\u7AD9\u8BF7\u6C42\uFF09",
          value: query,
          onChange: (e) => setQuery(e.target.value),
          onKeyDown: (e) => e.key === "Enter" && run()
        }
      ),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_dsh_client_ui_primitives.Button, { variant: "primary", size: "sm", disabled: busy || !query.trim(), onClick: run, children: busy ? "\u8FD0\u884C\u4E2D\u2026" : "\u8FD0\u884C" })
    ] }) }),
    error ? /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: { ...subCardStyle, padding: "8px 12px", fontSize: 12, color: T.error }, children: [
      "\u8C03\u7528\u5931\u8D25\uFF1A",
      error
    ] }) : null,
    envelope ? /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: cardStyle, children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: S.listRow, children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { style: statusPillStyle(statusKind), children: [
          "status: ",
          String(envelope.status)
        ] }),
        (envelope.sources?.succeeded ?? []).map((id) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { style: statusPillStyle("ok"), children: [
          "\u2713 ",
          id
        ] }, `s${id}`)),
        (envelope.sources?.failed ?? []).map((f) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { style: statusPillStyle("error"), children: [
          "\u2717 ",
          f.source,
          "(",
          f.code,
          ")"
        ] }, `f${f.source}`)),
        /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { style: noteText, children: [
          "\u53BB\u91CD ",
          envelope.duplicatesRemoved ?? 0,
          " \u6761 \xB7 \u6761\u76EE ",
          envelope.items?.length ?? 0
        ] })
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { style: dividerStyle }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("table", { style: { width: "100%", borderCollapse: "collapse", fontSize: 12 }, children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("thead", { children: /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("tr", { style: { color: T.labelSecondary, textAlign: "left" }, children: [
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("th", { style: { padding: "6px 12px", fontWeight: 500 }, children: "\u5C1D\u8BD5" }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("th", { style: { padding: "6px 4px", fontWeight: 500 }, children: "\u7ED3\u679C" }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("th", { style: { padding: "6px 4px", fontWeight: 500 }, children: "\u5EF6\u8FDF" })
        ] }) }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("tbody", { children: (envelope.attempts ?? []).map((a, i) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("tr", { style: { borderTop: `1px solid ${T.borderL1}` }, children: [
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("td", { style: { padding: "5px 12px" }, children: a.source }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("td", { style: { padding: "5px 4px" }, children: a.outcome }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("td", { style: { padding: "5px 4px" }, children: typeof a.latencyMs === "number" ? `${a.latencyMs}ms` : "" })
        ] }, `${a.source}-${i}`)) })
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { style: dividerStyle }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: { padding: "8px 12px", display: "flex", flexDirection: "column", gap: 4 }, children: [
        (envelope.items ?? []).slice(0, 5).map((item, i) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: { fontSize: 12, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }, children: [
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("a", { href: item.url, target: "_blank", rel: "noreferrer", style: { color: T.brand, textDecoration: "none" }, children: item.title ?? item.url }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { style: { ...noteText, marginLeft: 6 }, children: [
            "\u2014 ",
            item.source,
            Array.isArray(item.alsoIn) && item.alsoIn.length ? `\uFF08\u4EA6\u89C1 ${item.alsoIn.join(", ")}\uFF09` : ""
          ] })
        ] }, `${item.url}-${i}`)),
        Array.isArray(envelope.uncertainty) && envelope.uncertainty.length ? /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: { ...noteText, ...badgeStyle(T.warn), padding: "4px 8px", borderRadius: 8, marginTop: 4 }, children: [
          "uncertainty\uFF1A",
          envelope.uncertainty.join("\uFF1B")
        ] }) : null,
        Array.isArray(envelope.warnings) && envelope.warnings.length ? /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: { ...noteText, marginTop: 2 }, children: [
          "warnings\uFF1A",
          envelope.warnings.join("\uFF1B")
        ] }) : null
      ] })
    ] }) : /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { style: { ...noteText, padding: "4px 2px" }, children: "\u9009\u62E9\u6E90\u5E76\u8F93\u5165\u67E5\u8BE2\uFF0C\u5B9E\u8DD1\u4E00\u6B21\u68C0\u7D22\uFF08\u542B\u88AB\u7981\u7528/\u65E0\u51ED\u636E\u6E90\u7684\u76F4\u8C03\u8BCA\u65AD\uFF09\u3002\u8FD0\u884C\u540E\u5F15\u64CE\u5FBD\u6807\u533A\u4F1A\u81EA\u52A8\u91CD\u62C9\u72B6\u6001\u3002" })
  ] });
}
function SaveBar({ dirty, error, savedAt, onSave, onDiscard }) {
  return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: { display: "flex", gap: 8, alignItems: "center", padding: "6px 0" }, children: [
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_dsh_client_ui_primitives.Button, { variant: "primary", size: "sm", disabled: !dirty, onClick: onSave, children: "\u4FDD\u5B58\u672C\u9875\u7B7E" }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_dsh_client_ui_primitives.Button, { variant: "outline", size: "sm", disabled: !dirty, onClick: onDiscard, children: "\u653E\u5F03\u4FEE\u6539" }),
    error ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { style: { ...noteText, color: T.error, whiteSpace: "normal" }, children: error }) : null,
    !error && savedAt && !dirty ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { style: noteText, children: "\u5DF2\u4FDD\u5B58" }) : null
  ] });
}
function Checkbox({ checked, label, onChange }) {
  return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("label", { style: { display: "inline-flex", alignItems: "center", gap: 5, fontSize: 12, color: T.labelSecondary, cursor: "pointer" }, children: [
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("input", { type: "checkbox", checked, onChange: (e) => onChange(e.target.checked), style: { accentColor: T.brand, width: 13, height: 13, margin: 0 } }),
    label
  ] });
}
function TextField({ label, value, onChange, placeholder, style }) {
  return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("label", { style: { display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12, color: T.labelSecondary, minWidth: 0 }, children: [
    label,
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
      "input",
      {
        style: { ...fieldStyle, ...style },
        value: String(value ?? ""),
        placeholder,
        onChange: (e) => onChange(e.target.value)
      }
    )
  ] });
}
function NumberField({ label, value, onChange, min, max, step }) {
  const [text, setText] = (0, import_react.useState)(value === void 0 ? "" : String(value));
  (0, import_react.useEffect)(() => {
    setText(value === void 0 ? "" : String(value));
  }, [value]);
  return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("label", { style: { display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12, color: T.labelSecondary }, children: [
    label,
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
      "input",
      {
        type: "number",
        style: { ...fieldStyle, width: 92 },
        value: text,
        min,
        max,
        step: step ?? 1,
        onChange: (e) => {
          setText(e.target.value);
          const n = Number(e.target.value);
          if (e.target.value !== "" && Number.isFinite(n) && (min === void 0 || n >= min) && (max === void 0 || n <= max)) onChange(Math.round(n));
        }
      }
    )
  ] });
}
function InstancesEditor({ value, onChange }) {
  const [text, setText] = (0, import_react.useState)(value.join("\n"));
  (0, import_react.useEffect)(() => {
    setText(value.join("\n"));
  }, [value]);
  return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("label", { style: { display: "flex", flexDirection: "column", gap: 4, fontSize: 12, color: T.labelSecondary, width: "100%" }, children: [
    "\u5B9E\u4F8B URL \u5217\u8868\uFF08\u6BCF\u884C\u4E00\u4E2A\uFF1B\u542F\u7528 searxng \u81F3\u5C11\u9700\u8981\u4E00\u4E2A\uFF0C\u975E\u6CD5 URL \u4F1A\u88AB\u4FDD\u5B58\u6821\u9A8C\u62D2\u7EDD\uFF09",
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
      "textarea",
      {
        style: { ...fieldStyle, minHeight: 64, resize: "vertical", fontFamily: "var(--dsw-font-mono, ui-monospace, monospace)" },
        value: text,
        onChange: (e) => {
          setText(e.target.value);
          onChange(e.target.value.split("\n").map((line) => line.trim()).filter((line) => line.length > 0));
        }
      }
    )
  ] });
}
function CredRow({ credentials, refName }) {
  const [info, setInfo] = (0, import_react.useState)(null);
  const [editing, setEditing] = (0, import_react.useState)(false);
  const [value, setValue] = (0, import_react.useState)("");
  const [busy, setBusy] = (0, import_react.useState)(false);
  const [error, setError] = (0, import_react.useState)(null);
  const refresh = (0, import_react.useCallback)(() => {
    if (!credentials || !refName) return;
    credentials.describe([refName]).then(
      (map) => setInfo(map.get(refName) ?? null),
      (err) => setError(String(err && err.message ? err.message : err))
    );
  }, [credentials, refName]);
  (0, import_react.useEffect)(() => {
    setInfo(null);
    setError(null);
    refresh();
  }, [refresh]);
  if (!refName) return null;
  const dot = info?.configured ? T.success : T.labelTertiary;
  return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { style: { display: "inline-flex", alignItems: "center", gap: 6, flexWrap: "wrap" }, children: [
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { style: { width: 7, height: 7, borderRadius: 4, background: dot, flex: "none" } }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { style: noteText, children: info ? `${info.configured ? "\u5DF2\u914D\u7F6E" : "\u672A\u914D\u7F6E"}${info.source ? `\uFF08${info.source}\uFF09` : ""}` : "\u2026" }),
    editing ? /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(import_jsx_runtime.Fragment, { children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
        "input",
        {
          type: "password",
          style: { ...fieldStyle, width: 180 },
          placeholder: "\u65B0\u503C\uFF08\u4E0D\u56DE\u663E\uFF09",
          value,
          autoFocus: true,
          onChange: (e) => setValue(e.target.value)
        }
      ),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_dsh_client_ui_primitives.Button, { size: "sm", variant: "primary", disabled: busy || !value, onClick: async () => {
        setBusy(true);
        try {
          await credentials.set(refName, value);
          setValue("");
          setEditing(false);
          setError(null);
          refresh();
        } catch (err) {
          setError(String(err && err.message ? err.message : err));
        } finally {
          setBusy(false);
        }
      }, children: "\u5B58\u5165" }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_dsh_client_ui_primitives.Button, { size: "sm", variant: "ghost", disabled: busy, onClick: () => {
        setEditing(false);
        setValue("");
      }, children: "\u53D6\u6D88" })
    ] }) : /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(import_jsx_runtime.Fragment, { children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_dsh_client_ui_primitives.Button, { size: "sm", variant: "outline", onClick: () => setEditing(true), children: info?.configured ? "\u6539\u503C" : "\u5F55\u5165" }),
      info?.configured && info?.writable ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_dsh_client_ui_primitives.Button, { size: "sm", variant: "ghost", disabled: busy, onClick: async () => {
        setBusy(true);
        try {
          await credentials.unset(refName);
          setError(null);
          refresh();
        } catch (err) {
          setError(String(err && err.message ? err.message : err));
        } finally {
          setBusy(false);
        }
      }, children: "\u6E05\u9664" }) : null
    ] }),
    error ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { style: { ...noteText, color: T.error }, children: error }) : null
  ] });
}
function pick(obj, keys) {
  const out = {};
  for (const k of keys) out[k] = obj?.[k];
  return out;
}
function dirtyKeys(draft, server, keys) {
  if (!server && !draft) return [];
  const out = [];
  for (const k of keys) {
    const a = safeStringify(draft?.[k] ?? null);
    const b = safeStringify(server?.[k] ?? null);
    if (a !== b) out.push(k);
  }
  return out;
}
function collectOps(base, target, path, ops = []) {
  const b = base && typeof base === "object" && !Array.isArray(base) ? base : {};
  const t = target && typeof target === "object" && !Array.isArray(target) ? target : {};
  for (const key of Object.keys(t)) {
    const tv = t[key];
    const bv = b[key];
    if (isPlain(tv) && isPlain(bv)) collectOps(bv, tv, [...path, key], ops);
    else if (safeStringify(tv) !== safeStringify(bv)) ops.push({ op: "set", path: [...path, key], value: tv });
  }
  for (const key of Object.keys(b)) {
    if (!(key in t)) ops.push({ op: "unset", path: [...path, key] });
  }
  return ops;
}
function isPlain(v) {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}
function safeStringify(v) {
  try {
    return JSON.stringify(v);
  } catch {
    return `!<unstringifiable:${String(v)}>`;
  }
}
function moveInOrder(order, id, delta) {
  if (!Array.isArray(order)) return;
  const i = order.indexOf(id);
  const j = i + delta;
  if (i < 0 || j < 0 || j >= order.length) return;
  order.splice(j, 0, ...order.splice(i, 1));
}

// src/client/nav-icon.js
var SECTION_LABEL = "\u7EDF\u4E00\u641C\u7D22";
var SEARCH_ICON_PATHS = [
  "M11.894845 6.647401C11.894845 3.725463 9.534486 1.356779 6.623219 1.35657C3.711786 1.35657 1.351635 3.725338 1.351635 6.647401C1.351843 9.569296 3.711911 11.938273 6.623219 11.938273C9.534361 11.938064 11.894637 9.569171 11.894845 6.647401ZM13.245462 6.647401C13.245254 10.317935 10.280401 13.293613 6.623219 13.293821C2.965871 13.293821 0.000204 10.31806 0 6.647401C0 2.976574 2.965746 0 6.623219 0C10.280526 0.000205 13.245462 2.9767 13.245462 6.647401Z",
  "M16.000417 15.041079L15.044449 16.000433L11.530434 12.473588L12.486298 11.514234L16.000417 15.041079Z"
];
function patchSectionNavIcon() {
  for (const label of document.querySelectorAll('span[class*="navLabel"]')) {
    if (label.textContent?.trim() !== SECTION_LABEL) continue;
    const cell = label.closest("button");
    const svg = cell?.querySelector("svg");
    if (!svg) continue;
    const first = svg.firstElementChild;
    if (first && first.tagName === "path" && first.getAttribute("d") === SEARCH_ICON_PATHS[0]) continue;
    while (svg.firstChild) svg.removeChild(svg.firstChild);
    svg.setAttribute("viewBox", "0 0 16 16");
    svg.setAttribute("fill", "none");
    for (const d of SEARCH_ICON_PATHS) {
      const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
      path.setAttribute("d", d);
      path.setAttribute("fill", "currentColor");
      svg.appendChild(path);
    }
  }
}
function observeSectionNavIcon() {
  patchSectionNavIcon();
  const observer = new MutationObserver((mutations) => {
    if (mutations.some((m) => m.addedNodes.length > 0)) patchSectionNavIcon();
  });
  observer.observe(document.body, { childList: true, subtree: true });
  return () => observer.disconnect();
}

// src/client/index.jsx
var inject = ["slots", "settingsScope", "connection", "remote"];
function apply(ctx) {
  const call = createCall(ctx);
  const scope = ctx.settingsScope.bind({ namespace: "unity-search" });
  const credentials = createCredentials(ctx);
  ctx.effect(() => {
    const offSection = ctx.slots.inject(
      "settings.section",
      () => ctx.slots.register(
        {
          name: "settings.section",
          id: "unity-search",
          order: 17,
          label: SECTION_LABEL,
          inject: () => ({ call, scope, credentials })
        },
        UnitySearchSection
      )
    );
    const offNavIcon = observeSectionNavIcon();
    return () => {
      offSection();
      offNavIcon();
    };
  }, "dsh-unity-search: settings section");
}
return module.exports; } });
