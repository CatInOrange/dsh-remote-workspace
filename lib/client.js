window.__ModuleLoader__.load({
  id: "dsh-remote-workspace",
  factory: (require) => {
    var module = { exports: {} }; var exports = module.exports;
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

// src/client/index.ts
var index_exports = {};
__export(index_exports, {
  apply: () => apply,
  inject: () => inject
});
module.exports = __toCommonJS(index_exports);

// src/client/Panel.tsx
var import_react = require("react");
var import_dsh_client_ui_primitives = require("@deepseek-ai/dsh-client-ui-primitives");

// src/client/connection.ts
function remoteTarget(address, token) {
  const url = new URL(address.includes("://") ? address : `https://${address}`);
  if (url.protocol !== "https:" || url.username !== "" || url.password !== "" || url.pathname !== "/" || url.hash !== "" || [...url.searchParams.keys()].some((key) => key !== "token") || url.searchParams.getAll("token").length > 1) throw new Error("invalid-address");
  const accessToken = token.trim() || url.searchParams.get("token") || "";
  const login = new URL(url.origin);
  if (accessToken !== "") login.searchParams.set("token", accessToken);
  return { address: url.origin, login: login.href };
}

// src/client/guest.ts
var RemoteGuest = class {
  constructor(bridge) {
    this.bridge = bridge;
  }
  bridge;
  disposed = false;
  reservation;
  element;
  releaseLinks;
  pending;
  /** @param host - plugin-owned viewport. @param address - sanitized origin. @param login - temporary login URL. @param report - visible loading/failure callback. */
  mount(host, address, login, report) {
    if (this.pending !== void 0) throw new Error("remote guest already mounted");
    this.pending = this.start(host, address, login, report);
    return this.pending;
  }
  async start(host, address, login, report) {
    const reservation = await this.bridge.acquire(`remote.workspace:${address}`, { persistent: true });
    this.reservation = reservation;
    if (this.disposed) return;
    const element = document.createElement("webview");
    this.element = element;
    element.style.cssText = "display:flex;width:100%;height:100%;min-height:0;";
    element.setAttribute("partition", reservation.partition);
    element.setAttribute("allowpopups", "");
    element.setAttribute("src", `about:blank#${reservation.lease}`);
    element.setAttribute("aria-label", address);
    let bootstrapped = false;
    let loadFailed = false;
    element.addEventListener("dom-ready", () => {
      if (bootstrapped || this.disposed) return;
      bootstrapped = true;
      const initialUrl = login;
      login = "";
      void element.loadURL(initialUrl).catch(() => {
        loadFailed = true;
        if (!this.disposed) report("error");
      });
    });
    element.addEventListener("did-start-loading", () => {
      if (bootstrapped && !this.disposed) {
        loadFailed = false;
        report("loading");
      }
    });
    element.addEventListener("did-stop-loading", () => {
      if (bootstrapped && !this.disposed && !loadFailed) report("loaded");
    });
    element.addEventListener("did-fail-load", () => {
      loadFailed = true;
      if (!this.disposed) report("error");
    });
    element.addEventListener("render-process-gone", () => {
      if (!this.disposed) report("error");
    });
    this.releaseLinks = this.bridge.onOpenRequested(reservation.lease, (url) => {
      if (new URL(url).origin === address && !this.disposed) void element.loadURL(url).catch(() => report("error"));
    });
    host.append(element);
  }
  /** Reload without retaining or replaying the access token. */
  reload() {
    this.element?.reload();
  }
  /** Settle a late reservation before releasing; cleanup never ends Linux tasks. */
  async dispose() {
    this.disposed = true;
    try {
      await this.pending;
    } catch (error) {
    }
    this.releaseLinks?.();
    this.element?.remove();
    if (this.reservation !== void 0) {
      const reservation = this.reservation;
      this.reservation = void 0;
      await this.bridge.release(reservation.lease);
    }
  }
};

// src/client/Panel.module.css
var Panel_default = { "viewport": "remote_viewport_JKEyxW", "status": "remote_status_JKEyxW", "header": "remote_header_JKEyxW", "panel": "remote_panel_JKEyxW", "form": "remote_form_JKEyxW" };

// src/client/Panel.tsx
var import_jsx_runtime = require("react/jsx-runtime");
function Panel({ t, bridge, readAddress, saveAddress }) {
  const [address, setAddress] = (0, import_react.useState)(readAddress);
  const [token, setToken] = (0, import_react.useState)("");
  const [target, setTarget] = (0, import_react.useState)(() => {
    const saved = readAddress();
    return saved === "" ? null : remoteTarget(saved, "");
  });
  const [status, setStatus] = (0, import_react.useState)("loading");
  const [online, setOnline] = (0, import_react.useState)(navigator.onLine);
  const viewport = (0, import_react.useRef)(null);
  const guest = (0, import_react.useRef)(null);
  const onlineState = (0, import_react.useRef)(online);
  (0, import_react.useEffect)(() => {
    const update = () => {
      const next = navigator.onLine;
      if (next && !onlineState.current) guest.current?.reload();
      onlineState.current = next;
      setOnline(next);
    };
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);
  (0, import_react.useEffect)(() => {
    if (target === null || bridge === void 0 || viewport.current === null) return;
    const current = new RemoteGuest(bridge);
    guest.current = current;
    let active = true;
    setStatus("loading");
    void current.mount(viewport.current, target.address, target.login, (state) => {
      if (active) setStatus(state);
    }).catch(() => {
      if (active) setStatus("error");
    });
    return () => {
      active = false;
      guest.current = null;
      void current.dispose().catch((error) => {
        console.error("Remote workspace cleanup failed", error);
      });
    };
  }, [bridge, target]);
  const connect = (event) => {
    event.preventDefault();
    let next;
    try {
      next = remoteTarget(address, token);
    } catch (error) {
      setStatus("invalid");
      return;
    }
    try {
      saveAddress(next.address);
    } catch (error) {
      setStatus("error");
      return;
    }
    setAddress(next.address);
    setToken("");
    setTarget(next);
  };
  return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("section", { className: Panel_default.panel, children: [
    /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("header", { className: Panel_default.header, children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("h2", { children: t("title") }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("form", { className: Panel_default.form, onSubmit: connect, children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("label", { children: [
          t("address"),
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_dsh_client_ui_primitives.Input, { value: address, onChange: (event) => setAddress(event.target.value), spellCheck: false, placeholder: "https://example.com", autoComplete: "off" })
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("label", { children: [
          t("token"),
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_dsh_client_ui_primitives.Input, { type: "password", value: token, onChange: (event) => setToken(event.target.value), autoComplete: "off" })
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_dsh_client_ui_primitives.Button, { size: "sm", variant: "outline", type: "submit", disabled: bridge === void 0, children: t("connect") }),
        target !== null && /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_dsh_client_ui_primitives.Button, { size: "sm", variant: "outline", type: "button", onClick: () => guest.current?.reload(), children: t("retry") }),
        target !== null && /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_dsh_client_ui_primitives.Button, { size: "sm", variant: "outline", type: "button", onClick: () => {
          setTarget(null);
          setToken("");
        }, children: t("disconnect") })
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { children: t("auth") }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { children: t("note") }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { role: "status", "aria-live": "polite", className: Panel_default.status, children: bridge === void 0 ? t("unsupported") : !online ? t("offline") : status === "error" ? t("error") : status === "invalid" ? t("invalid") : target !== null && status === "loading" ? t("loading") : "" })
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: Panel_default.viewport, ref: viewport })
  ] });
}

// src/client/locales.ts
var en = {
  title: "Linux workspace",
  address: "Server address",
  token: "Access token (first login)",
  connect: "Connect",
  disconnect: "Disconnect",
  retry: "Reload",
  loading: "Connecting\u2026",
  error: "Connection failed. Check the address, network and access token, then retry.",
  invalid: "Enter an HTTPS server origin or a Harness login link.",
  unsupported: "This plugin requires the Harness desktop browser bridge.",
  note: "Remote sessions and tools run on Linux. This preview embeds the remote UI, including its workspace list.",
  auth: "Use the native Harness access token, not your DeepSeek API key. Only the server address is saved.",
  offline: "Offline \u2014 Linux tasks are not moved to Windows."
};
var zh = {
  title: "Linux \u5DE5\u4F5C\u533A",
  address: "\u670D\u52A1\u5668\u5730\u5740",
  token: "\u8BBF\u95EE\u4EE4\u724C\uFF08\u9996\u6B21\u767B\u5F55\uFF09",
  connect: "\u8FDE\u63A5",
  disconnect: "\u65AD\u5F00",
  retry: "\u91CD\u65B0\u52A0\u8F7D",
  loading: "\u6B63\u5728\u8FDE\u63A5\u2026",
  error: "\u8FDE\u63A5\u5931\u8D25\uFF0C\u8BF7\u68C0\u67E5\u5730\u5740\u3001\u7F51\u7EDC\u548C\u8BBF\u95EE\u4EE4\u724C\u540E\u91CD\u8BD5",
  invalid: "\u8BF7\u8F93\u5165 HTTPS \u670D\u52A1\u5668\u5730\u5740\u6216 Harness \u767B\u5F55\u94FE\u63A5",
  unsupported: "\u6B64\u63D2\u4EF6\u9700\u8981 Harness \u684C\u9762\u7248\u7684\u6D4F\u89C8\u5668\u6865\u63A5\u529F\u80FD",
  note: "\u8FDC\u7A0B\u4F1A\u8BDD\u548C\u5DE5\u5177\u5728 Linux \u6267\u884C\u3002\u9884\u89C8\u7248\u5185\u5D4C\u8FDC\u7A0B\u754C\u9762\uFF0C\u5305\u542B\u670D\u52A1\u5668\u81EA\u5DF1\u7684\u5DE5\u4F5C\u533A\u5217\u8868\u3002",
  auth: "\u586B\u5199 Harness \u539F\u751F\u8BBF\u95EE\u4EE4\u724C\uFF0C\u4E0D\u662F DeepSeek API Key\u3002\u63D2\u4EF6\u4EC5\u4FDD\u5B58\u670D\u52A1\u5668\u5730\u5740\u3002",
  offline: "\u7F51\u7EDC\u79BB\u7EBF\uFF0CLinux \u4EFB\u52A1\u4E0D\u4F1A\u8F6C\u5230 Windows \u6267\u884C"
};

// src/client/apply.tsx
var import_jsx_runtime2 = require("react/jsx-runtime");
var inject = ["slots", "locale", "layout"];
function apply(ctx) {
  const namespace = "remoteWorkspace";
  const panel = "remote.workspace";
  const t = ctx.locale.bind(namespace);
  const carrier = globalThis.dshDesktop;
  const bridge = carrier?.protocolVersion === 1 ? carrier.browser : void 0;
  const storage = "remote.workspace.address";
  const actions = {
    bridge,
    readAddress: () => {
      const saved = localStorage.getItem(storage);
      if (saved === null) return "";
      try {
        return remoteTarget(saved, "").address;
      } catch (error) {
        localStorage.removeItem(storage);
        return "";
      }
    },
    saveAddress: (address) => {
      localStorage.setItem(storage, remoteTarget(address, "").address);
    }
  };
  ctx.effect(() => ctx.locale.register(namespace, { en, zh }), "remote-workspace: copy");
  ctx.slots.inject("main", () => ctx.slots.register({ name: "main", key: panel, locale: namespace, inject: () => actions }, Panel));
  ctx.slots.inject("sidebar.panellist", () => ctx.slots.register(
    { name: "sidebar.panellist", id: panel, order: 15, label: () => t("title") },
    ({ size }) => /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("svg", { width: size, height: size, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: "1.5", "aria-hidden": "true", children: [
      /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("rect", { x: "3", y: "4", width: "18", height: "7", rx: "2" }),
      /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("rect", { x: "3", y: "13", width: "18", height: "7", rx: "2" }),
      /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("path", { d: "M7 7.5h1M7 16.5h1" })
    ] })
  ));
}

    return module.exports;
  },
  meta: () => ({ stylesheets: {"src/client/Panel.module.css": { text: () => ".remote_panel_JKEyxW{width:100%;height:100%;min-height:0;color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-base);flex-direction:column;display:flex}.remote_header_JKEyxW{flex:none;padding:12px 16px}.remote_header_JKEyxW h2{margin:0 0 8px;font-size:16px;font-weight:500}.remote_header_JKEyxW p{margin:4px 0;font-size:12px}.remote_form_JKEyxW{flex-wrap:wrap;align-items:end;gap:8px;display:flex}.remote_form_JKEyxW label{flex-direction:column;flex:180px;gap:4px;font-size:12px;display:flex}.remote_status_JKEyxW{min-height:18px;font-size:12px}.remote_viewport_JKEyxW{flex:1;min-height:0;position:relative}" }} })
});
