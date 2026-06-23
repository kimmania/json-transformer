/**
 * app.js — json-transformer Web Transform Assistant
 *
 * Preact-based single-page app with:
 * - Source data tree viewer
 * - Visual mapping editor (table-based)
 * - Free-form JSON/JS editor
 * - Live preview
 * - Guided wizard mode
 * - Export/import
 * - Toast notifications
 * - Dark/light theme
 */

(function () {
  "use strict";

  var h = preact.h;
  var Fragment = preact.Fragment;
  var useState = preact.useState;
  var useEffect = preact.useEffect;
  var useRef = preact.useRef;
  var useMemo = preact.useMemo;
  var useCallback = preact.useCallback;

  var MF = typeof MappingFeatures !== "undefined" ? MappingFeatures : null;


  // ── Toast system ───────────────────────────────────────────────────

  var toasts = [];
  var toastSubscribers = [];

  function showToast(message, type, duration) {
    type = type || "info";
    duration = duration || 4000;
    var id = Date.now() + Math.random();
    toasts.push({ id, message, type });
    notifySubscribers();
    if (duration > 0) {
      setTimeout(function () { removeToast(id); }, duration);
    }
  }

  function removeToast(id) {
    toasts = toasts.filter(function (t) { return t.id !== id; });
    notifySubscribers();
  }

  function useToasts() {
    var _a = useState(toasts.slice()), localToasts = _a[0], setLocalToasts = _a[1];
    useEffect(function () {
      function onToastsChange() { setLocalToasts(toasts.slice()); }
      toastSubscribers.push(onToastsChange);
      return function () { toastSubscribers = toastSubscribers.filter(function (s) { return s !== onToastsChange; }); };
    }, []);
    return localToasts;
  }

  function notifySubscribers() {
    toastSubscribers.forEach(function (fn) { try { fn(); } catch (e) { } });
  }

  // ── Theme ──────────────────────────────────────────────────────────

  function getTheme() {
    return localStorage.getItem("jt-theme") || "light";
  }

  function setTheme(theme) {
    localStorage.setItem("jt-theme", theme);
    document.documentElement.setAttribute("data-theme", theme);
  }

  // ── Utility helpers ────────────────────────────────────────────────

  function getType(value) {
    if (value === null || value === undefined) return "null";
    if (Array.isArray(value)) return "array";
    return typeof value;
  }

  function truncate(str, max) {
    max = max || 40;
    if (typeof str !== "string") str = JSON.stringify(str);
    return str.length > max ? str.slice(0, max) + "..." : str;
  }

  async function downloadFile(content, filename, mimeType) {
    mimeType = mimeType || "application/json";
    if (window.showSaveFilePicker) {
      var ext = filename.split(".").pop();
      var accept = {};
      accept[mimeType] = ["." + ext];
      try {
        var fh = await window.showSaveFilePicker({
          suggestedName: filename,
          types: [{ description: "File", accept: accept }],
        });
        var writable = await fh.createWritable();
        await writable.write(content);
        await writable.close();
        return fh.name;
      } catch (e) {
        if (e.name === "AbortError") return null;
        // showSaveFilePicker unsupported in this context — fall through
      }
    }
    var blob = new Blob([content], { type: mimeType });
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    return filename;
  }

  function copyToClipboard(text) {
    function onSuccess() { showToast("Copied to clipboard", "success", 2000); }
    function onFail() { showToast("Failed to copy", "error"); }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(onSuccess, onFail);
      return;
    }
    try {
      var ta = document.createElement("textarea");
      ta.value = text;
      ta.setAttribute("readonly", "");
      ta.style.position = "fixed";
      ta.style.left = "-9999px";
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
      onSuccess();
    } catch (e) {
      onFail();
    }
  }

  function mappingHasCompute(obj) {
    return MF ? MF.mappingHasCompute(obj) : false;
  }

  function parseMappingFromCode(text, mode) {
    if (!text || !String(text).trim()) return null;
    if (mode === "json") {
      return JSON.parse(text);
    }
    if (MF && MF.parseMappingModule) {
      return MF.parseMappingModule(text);
    }
    return new Function("return (" + String(text).trim() + ")")();
  }

  function emptyMappingDocument(meta) {
    var mapping = { fields: {} };
    return MF ? MF.applyMappingMeta(mapping, meta || {}) : mapping;
  }

  function mappingToCodeText(mapping, mode) {
    if (mode === "json") {
      return JSON.stringify(mapping, null, 2);
    }
    return MF ? MF.formatMappingAsModule(mapping, true) : JSON.stringify(mapping, null, 2);
  }

  var ARRAY_LABEL_KEYS = [
    "ProductSKU", "SKU", "sku", "order_id", "orderId", "id", "name", "Name",
    "title", "Title", "FullName", "EmployeeName", "Email",
  ];

  function resolvePathInSourceData(data, path) {
    if (path == null || path === "") return data;
    if (data == null) return undefined;
    var parts = String(path).split(".").filter(function (p) { return p !== ""; });
    var cur = data;
    for (var i = 0; i < parts.length; i++) {
      if (cur == null) return undefined;
      var p = parts[i];
      if (Array.isArray(cur) && /^\d+$/.test(p)) {
        cur = cur[parseInt(p, 10)];
      } else if (typeof cur === "object") {
        cur = cur[p];
      } else {
        return undefined;
      }
    }
    return cur;
  }

  function arrayItemDisplayLabel(item, index) {
    var base = "[" + index + "]";
    if (item == null) return base + " null";
    if (typeof item !== "object") return base + " " + String(item);
    var i;
    for (i = 0; i < ARRAY_LABEL_KEYS.length; i++) {
      var k = ARRAY_LABEL_KEYS[i];
      if (item[k] != null && item[k] !== "") {
        return base + " " + String(item[k]);
      }
    }
    var keys = Object.keys(item);
    if (keys.length) {
      var fv = item[keys[0]];
      if (fv != null && typeof fv !== "object") {
        return base + " " + truncate(String(fv), 28);
      }
    }
    return base;
  }

  function collapsedCollectionPreview(value, type, expanded) {
    if (expanded || !value) return null;
    if (type === "object") {
      var keys = Object.keys(value);
      if (!keys.length) return "{empty}";
      var names = keys.slice(0, 4).join(", ");
      if (keys.length > 4) names += ", …";
      return names;
    }
    if (type === "array") {
      if (!value.length) return "empty";
      return value.slice(0, 3).map(function (item, i) {
        return arrayItemDisplayLabel(item, i);
      }).join(", ") + (value.length > 3 ? ", …" : "");
    }
    return null;
  }

  function pathToBreadcrumbs(data, path) {
    if (path == null || path === "") return [];
    var parts = String(path).split(".").filter(function (p) { return p !== ""; });
    var crumbs = [];
    var acc = "";
    var i;
    for (i = 0; i < parts.length; i++) {
      acc = acc ? acc + "." + parts[i] : parts[i];
      var label = parts[i];
      if (/^\d+$/.test(parts[i])) {
        var idx = parseInt(parts[i], 10);
        if (i === 0 && Array.isArray(data)) {
          label = "Record " + (idx + 1);
        } else {
          var item = resolvePathInSourceData(data, acc);
          label = arrayItemDisplayLabel(item, idx);
        }
      }
      crumbs.push({ label: label, path: acc });
    }
    return crumbs;
  }

  function formatSourceDetailJson(value) {
    if (value === undefined) return "// Path not found in loaded data";
    try {
      return JSON.stringify(value, null, 2);
    } catch (e) {
      return String(value);
    }
  }

  function treeNodeMatchesSearch(path, nodeKey, value, query) {
    if (!query) return true;
    var q = query.toLowerCase();
    if (nodeKey && String(nodeKey).toLowerCase().indexOf(q) >= 0) return true;
    if (path && String(path).toLowerCase().indexOf(q) >= 0) return true;
    var type = getType(value);
    if (type === "string" && String(value).toLowerCase().indexOf(q) >= 0) return true;
    if ((type === "number" || type === "boolean") && String(value).toLowerCase().indexOf(q) >= 0) return true;
    return false;
  }

  function treeHasMatchingDescendant(value, path, query) {
    if (!query) return true;
    if (treeNodeMatchesSearch(path, null, value, query)) return true;
    var type = getType(value);
    if (type === "object") {
      return Object.keys(value).some(function (k) {
        var childPath = path != null && path !== "" ? path + "." + k : k;
        return treeNodeMatchesSearch(childPath, k, value[k], query) ||
          treeHasMatchingDescendant(value[k], childPath, query);
      });
    }
    if (type === "array") {
      return value.some(function (item, i) {
        var childPath = path != null && path !== "" ? path + "." + i : String(i);
        return treeHasMatchingDescendant(item, childPath, query);
      });
    }
    return false;
  }

  function renderSearchHighlight(text, query) {
    if (!query || text == null) return text;
    var s = String(text);
    var q = String(query).toLowerCase();
    var lower = s.toLowerCase();
    if (lower.indexOf(q) < 0) return s;
    var parts = [];
    var i = 0;
    var partKey = 0;
    while (i < s.length) {
      var idx = lower.indexOf(q, i);
      if (idx < 0) {
        parts.push(s.slice(i));
        break;
      }
      if (idx > i) parts.push(s.slice(i, idx));
      parts.push(h("mark", { key: "m" + partKey++, className: "tree-search-mark" }, s.slice(idx, idx + q.length)));
      i = idx + q.length;
    }
    if (parts.length === 1 && typeof parts[0] === "string") return parts[0];
    return h(Fragment, null, parts);
  }

  function nodeMatchesSearchQuery(path, nodeKey, value, query) {
    return !!query && treeNodeMatchesSearch(path, nodeKey, value, query);
  }

  function visualFieldsFromMapping(mapping) {
    return MF ? MF.visualFieldsFromMapping(mapping) : [];
  }

  function buildMappingFromVisual(fields, passthrough, meta) {
    if (!MF) return { fields: {} };
    return MF.buildFullMapping(fields, {
      passthrough: passthrough === true,
      meta: meta || {},
    });
  }

  function resolveActiveMapping(editorMode, mappingFields, codeEditorValue, passthrough, mappingMeta, codeSnapshot) {
    if (!MF) return null;
    if (editorMode === "visual") {
      if (codeSnapshot && codeSnapshot.mapping) {
        return MF.mergeVisualFieldsIntoMapping(mappingFields, codeSnapshot.mapping, {
          passthrough: passthrough === true,
          meta: mappingMeta,
        });
      }
      return buildMappingFromVisual(mappingFields, passthrough, mappingMeta);
    }
    if (!codeEditorValue || !String(codeEditorValue).trim()) return null;
    if (editorMode === "json") {
      return MF.applyMappingMeta(JSON.parse(codeEditorValue), mappingMeta);
    }
    var parsed = MF.applyMappingMeta(MF.parseMappingModule(codeEditorValue), mappingMeta);
    if (
      codeSnapshot &&
      codeSnapshot.mapping &&
      codeSnapshot.mode === "js" &&
      MF.mappingHasCompute(codeSnapshot.mapping) &&
      String(codeEditorValue).trim() === String(codeSnapshot.text).trim()
    ) {
      return MF.applyMappingMeta(codeSnapshot.mapping, mappingMeta);
    }
    return parsed;
  }

  function parseImportedMapping(text, fileName) {
    var isJson = /\.json$/i.test(fileName);
    var isJs = /\.js$/i.test(fileName);
    var mapping;
    var bodyText;

    if (isJson) {
      mapping = JSON.parse(text);
      bodyText = JSON.stringify(mapping, null, 2);
    } else if (isJs) {
      mapping = MF.parseMappingModule(text);
      // Keep full file text in the editor (export, comments, all field defs)
      bodyText = String(text).replace(/^\uFEFF/, "").trim();
    } else {
      throw new Error("Unsupported file type (use .json or .js)");
    }

    var meta = MF.extractMappingMeta(mapping);
    var useCodeEditor = MF.mappingRequiresCodeEditor(mapping) || MF.mappingHasCompute(mapping);
    var visualFields = MF.visualFieldsFromMapping(mapping);
    var fieldCount = Object.keys(mapping.fields || {}).length;
    var advancedCount = visualFields.filter(function (f) {
      return f.kind === "advanced" || f.kind === "condition" || f.kind === "static";
    }).length;

    return {
      mapping: mapping,
      meta: meta,
      editorMode: useCodeEditor ? (isJs ? "js" : "json") : "visual",
      codeEditorValue: bodyText,
      // Avoid visual↔code sync overwriting imported JS (see useEffect in App)
      mappingFields: useCodeEditor ? [] : visualFields,
      fieldSummary: MF.fieldSummaryFromMapping(mapping),
      passthrough: MF.passthroughToBool(meta.passthrough),
      toast: useCodeEditor
        ? {
          message: "Imported " + fileName + " (" + fieldCount + " fields, " + advancedCount + " advanced). Edit in " + (isJs ? "JS" : "JSON") + " mode; see field list below.",
          type: "info",
          duration: 6000,
        }
        : { message: "Imported " + fileName + " (" + fieldCount + " fields)", type: "success", duration: 3000 },
    };
  }

  function treeTypeBadgeClass(type) {
    if (type === "string") return "tree-type-s";
    if (type === "number") return "tree-type-n";
    if (type === "boolean") return "tree-type-b";
    if (type === "object") return "tree-type-o";
    if (type === "array") return "tree-type-a";
    return "tree-type-l";
  }

  function treeTypeBadgeLabel(type) {
    if (type === "string") return "s";
    if (type === "number") return "n";
    if (type === "boolean") return "b";
    if (type === "object") return "o";
    if (type === "array") return "a";
    return "∅";
  }

  // ── Tree Node Component ────────────────────────────────────────────

  function TreeNode(props) {
    var nodeKey = props.nodeKey;
    var value = props.value;
    var path = props.path;
    var onSelect = props.onSelect;
    var selectedPath = props.selectedPath;
    var searchQuery = props.searchQuery;
    var sourceData = props.sourceData;
    var depth = props.depth || 0;
    var expandControl = props.expandControl;

    if (searchQuery && !treeHasMatchingDescendant(value, path, searchQuery)) {
      return null;
    }

    var type = getType(value);
    var isExpandable = type === "object" || type === "array";
    var isSelected = path === selectedPath;
    var isSearchMatch = nodeMatchesSearchQuery(path, nodeKey, value, searchQuery);

    var _useState = useState(function () {
      if (searchQuery) return true;
      if (isExpandable && depth === 0) return true;
      return depth > 0;
    }), expanded = _useState[0], setExpanded = _useState[1];

    useEffect(function () {
      if (searchQuery) setExpanded(true);
    }, [searchQuery]);

    useEffect(function () {
      if (expandControl && expandControl.version > 0) {
        setExpanded(!!expandControl.all || !!searchQuery);
      }
    }, [expandControl ? expandControl.version : 0]);

    function handleClick(e) {
      if (e.target.closest && e.target.closest(".tree-toggle")) {
        if (isExpandable) setExpanded(function (ex) { return !ex; });
        return;
      }
      if (isExpandable) {
        setExpanded(function (ex) { return !ex; });
      }
      if (onSelect) {
        onSelect(path, value, type);
      }
    }

    function handleToggleClick(e) {
      e.stopPropagation();
      if (isExpandable) setExpanded(function (ex) { return !ex; });
    }

    function renderValue() {
      var collectionPreview = collapsedCollectionPreview(value, type, expanded);
      if (type === "null") return h("span", { className: "tree-value tree-value-primitive" }, "null");
      if (type === "boolean") return h("span", { className: "tree-value tree-value-primitive" }, String(value));
      if (type === "number") return h("span", { className: "tree-value tree-value-primitive" }, String(value));
      if (type === "string") {
        var display = truncate(value, 48);
        var displayContent = searchQuery && isSearchMatch
          ? renderSearchHighlight(display, searchQuery)
          : display;
        return h("span", { className: "tree-value tree-value-string", title: value },
          "\"", displayContent, "\""
        );
      }
      if (type === "array") {
        return h(Fragment, null,
          h("span", { className: "tree-value tree-value-meta" }, value.length + " item" + (value.length === 1 ? "" : "s")),
          collectionPreview ? h("span", { className: "tree-inline-preview", title: collectionPreview }, collectionPreview) : null
        );
      }
      if (type === "object") {
        var keys = Object.keys(value);
        return h(Fragment, null,
          h("span", { className: "tree-value tree-value-meta" }, keys.length + " field" + (keys.length === 1 ? "" : "s")),
          collectionPreview ? h("span", { className: "tree-inline-preview", title: collectionPreview }, collectionPreview) : null
        );
      }
      return null;
    }

    var sampleHint = null;
    if (path && MF && sourceData && (type === "string" || type === "number" || type === "boolean")) {
      var samples = MF.getSampleValuesForPath(sourceData, path, 3);
      if (samples.length) {
        sampleHint = h("span", { className: "tree-samples", title: "Sample values across records" }, " eg. " + samples.join(", "));
      }
    }

    var displayKey = nodeKey;
    if (type === "array" || (nodeKey && /^\[\d+\]$/.test(nodeKey))) {
      var idxMatch = nodeKey && nodeKey.match(/^\[(\d+)\]$/);
      if (idxMatch) {
        displayKey = arrayItemDisplayLabel(value, parseInt(idxMatch[1], 10));
      }
    }

    var children = [
      h("div", {
        className: "tree-node-content"
          + (isSelected ? " selected" : "")
          + (isSearchMatch ? " tree-search-match" : "")
          + (isExpandable ? "" : " tree-node-leaf"),
        "data-depth": depth,
        onClick: handleClick,
        style: { paddingLeft: (depth * 14 + 6) + "px" },
      },
        isExpandable
          ? h("span", { className: "tree-toggle", onClick: handleToggleClick }, expanded ? "\u25BC" : "\u25B6")
          : h("span", { className: "tree-toggle" }),
        h("span", { className: "tree-label" },
          displayKey ? h("span", {
            className: "tree-key",
            title: path && path !== displayKey ? displayKey + " — path: " + path : displayKey,
          },
            searchQuery && isSearchMatch ? renderSearchHighlight(displayKey, searchQuery) : displayKey
          ) : null,
          h("span", { className: "tree-type " + treeTypeBadgeClass(type), title: type }, treeTypeBadgeLabel(type))
        ),
        h("span", { className: "tree-value-wrap" }, renderValue(), sampleHint)
      )
    ];

    if (isExpandable && expanded) {
      children.push(h("div", { className: "tree-children", "data-depth": depth + 1 },
        type === "array" ? value.map(function (item, i) {
          return h(TreeNode, {
            key: "arr-" + i,
            nodeKey: arrayItemDisplayLabel(item, i),
            value: item,
            path: path != null && path !== "" ? path + "." + i : String(i),
            onSelect: onSelect,
            selectedPath: selectedPath,
            searchQuery: searchQuery,
            sourceData: sourceData,
            depth: depth + 1,
            expandControl: expandControl,
          });
        }) : Object.keys(value).map(function (k) {
          return h(TreeNode, {
            key: "obj-" + k,
            nodeKey: k,
            value: value[k],
            path: path != null && path !== "" ? path + "." + k : k,
            onSelect: onSelect,
            selectedPath: selectedPath,
            searchQuery: searchQuery,
            sourceData: sourceData,
            depth: depth + 1,
            expandControl: expandControl,
          });
        })
      ));
    }

    return h("div", { className: "tree-node" }, children);
  }

  // ── Collapsible panel header ───────────────────────────────────────

  function PanelCollapseHeader(props) {
    var collapsed = props.collapsed;
    var title = props.title;
    var shortTitle = props.shortTitle || title;
    var onToggle = props.onToggle;
    var meta = props.meta;

    function handleToggleClick(e) {
      e.stopPropagation();
      if (onToggle) onToggle();
    }

    function handleHeaderClick() {
      if (collapsed && onToggle) onToggle();
    }

    if (collapsed) {
      return h("div", {
        className: "panel-header panel-header-collapsed",
        onClick: handleHeaderClick,
        title: "Expand " + title,
        role: "button",
        "aria-label": "Expand " + title,
      },
        h("button", {
          type: "button",
          className: "btn btn-secondary panel-collapse-btn-expand",
          onClick: handleToggleClick,
          title: "Expand " + title,
          "aria-label": "Expand " + title,
        }, "\u25B6"),
        h("span", { className: "panel-collapsed-label" }, shortTitle)
      );
    }

    return h("div", { className: "panel-header" },
      h("span", { className: "panel-title" }, title),
      h("div", { className: "panel-header-actions" },
        props.children,
        meta || null,
        onToggle ? h("button", {
          type: "button",
          className: "btn btn-sm btn-secondary panel-collapse-btn",
          onClick: handleToggleClick,
          title: "Collapse " + title,
          "aria-label": "Collapse " + title,
        }, "\u25C0") : null
      )
    );
  }

  // ── Source Tree Panel ──────────────────────────────────────────────

  function SourceBreadcrumb(props) {
    var crumbs = props.crumbs || [];
    var onNavigate = props.onNavigate;
    if (!crumbs.length) {
      return h("div", { className: "source-breadcrumb source-breadcrumb-empty" },
        h("span", { className: "text-sm text-muted" }, "Select a node to see path and detail")
      );
    }
    return h("div", { className: "source-breadcrumb" },
      crumbs.map(function (crumb, i) {
        return h(Fragment, { key: crumb.path },
          i > 0 ? h("span", { className: "source-breadcrumb-sep" }, "\u203A") : null,
          h("button", {
            type: "button",
            className: "source-breadcrumb-item" + (i === crumbs.length - 1 ? " is-current" : ""),
            title: crumb.path,
            onClick: function () { onNavigate(crumb.path); },
          }, crumb.label)
        );
      })
    );
  }

  function SourceDetailPane(props) {
    var path = props.path;
    var value = props.value;
    var detailText = formatSourceDetailJson(value);

    return h("div", { className: "source-detail" },
      h("div", { className: "source-detail-header" },
        h("span", { className: "source-detail-title" }, "Selection detail"),
        h("div", { className: "source-detail-actions" },
          path ? h("button", {
            type: "button",
            className: "btn btn-sm btn-secondary",
            onClick: function () { copyToClipboard(path); },
            title: "Copy dot path for mapping",
          }, "Copy path") : null,
          h("button", {
            type: "button",
            className: "btn btn-sm btn-secondary",
            onClick: function () { copyToClipboard(detailText); },
            disabled: value === undefined,
          }, "Copy JSON")
        )
      ),
      path ? h("div", { className: "source-detail-path font-mono text-sm", title: path }, path) : null,
      h("pre", { className: "source-detail-json" }, value === undefined
        ? "// Click a field in the tree to inspect its value"
        : detailText)
    );
  }

  function SourceTreePanel(props) {
    var data = props.data;
    var onSelect = props.onSelect;
    var collapsed = props.collapsed;
    var onToggleCollapse = props.onToggleCollapse;
    var panelStyle = props.panelStyle;
    var _useState = useState(""), searchQuery = _useState[0], setSearchQuery = _useState[1];
    var _useState2 = useState({ version: 0, all: true }), expandControl = _useState2[0], setExpandControl = _useState2[1];
    var _useState3 = useState(0), recordIndex = _useState3[0], setRecordIndex = _useState3[1];
    var _useState4 = useState("single"), treeViewMode = _useState4[0], setTreeViewMode = _useState4[1];
    var selectedPath = props.selectedPath;

    var isRecordArray = Array.isArray(data) && data.length > 0;
    var safeRecordIndex = isRecordArray ? Math.min(Math.max(0, recordIndex), data.length - 1) : 0;

    useEffect(function () {
      if (isRecordArray && recordIndex >= data.length) {
        setRecordIndex(Math.max(0, data.length - 1));
      }
    }, [data, isRecordArray, recordIndex]);

    function expandAll() {
      setExpandControl({ version: expandControl.version + 1, all: true });
    }

    function collapseAll() {
      setExpandControl({ version: expandControl.version + 1, all: false });
    }

    function resolveTreeContext() {
      if (!data) return { treeData: null, treeSourceData: null, breadcrumbData: null };
      if (!isRecordArray) {
        return { treeData: data, treeSourceData: data, breadcrumbData: data };
      }
      if (treeViewMode === "all") {
        return { treeData: data, treeSourceData: data, breadcrumbData: data };
      }
      var record = data[safeRecordIndex];
      return { treeData: record, treeSourceData: data, breadcrumbData: record };
    }

    var treeContext = resolveTreeContext();

    function handleNavigate(path) {
      if (!path || !onSelect || !treeContext.breadcrumbData) return;
      var val = resolvePathInSourceData(treeContext.breadcrumbData, path);
      onSelect(path, val, getType(val));
    }

    function goToRecord(nextIndex) {
      if (!isRecordArray) return;
      var idx = Math.min(data.length - 1, Math.max(0, nextIndex));
      setRecordIndex(idx);
      if (onSelect) {
        onSelect("", data[idx], getType(data[idx]));
      }
    }

    var breadcrumbs = selectedPath && treeContext.breadcrumbData
      ? pathToBreadcrumbs(treeContext.breadcrumbData, selectedPath)
      : [];
    var selectedValue = selectedPath != null && selectedPath !== "" && treeContext.breadcrumbData
      ? resolvePathInSourceData(treeContext.breadcrumbData, selectedPath)
      : undefined;

    if (!data) {
      return h("div", {
        className: "panel panel-source" + (collapsed ? " panel-collapsed" : ""),
        style: panelStyle,
      },
        h(PanelCollapseHeader, {
          collapsed: collapsed,
          title: "Source Data",
          shortTitle: "Src",
          onToggle: onToggleCollapse,
        }),
        h("div", { className: "panel-body" },
          h("div", { className: "empty-state" },
            h("div", { className: "empty-state-icon" }, "\uD83D\uDCC4"),
            h("div", { className: "empty-state-text" }, "No data loaded"),
            h("div", { className: "empty-state-text" }, "Load a JSON file or use sample data")
          )
        )
      );
    }

    return h("div", {
      className: "panel panel-source" + (collapsed ? " panel-collapsed" : ""),
      style: panelStyle,
    },
      h(PanelCollapseHeader, {
        collapsed: collapsed,
        title: "Source Data",
        shortTitle: "Src",
        onToggle: onToggleCollapse,
        meta: collapsed ? null : h("span", { className: "text-sm text-muted panel-header-meta" },
          Array.isArray(data) ? data.length + " records" : "1 object"
        ),
      }),
      collapsed ? null : h("div", { className: "source-panel-body" },
        h("div", { className: "source-toolbar" },
          h("input", {
            className: "tree-search",
            type: "search",
            placeholder: "Search keys & values…",
            value: searchQuery,
            onInput: function (e) { setSearchQuery(e.target.value); },
          }),
          h("div", { className: "source-toolbar-actions" },
            h("button", { type: "button", className: "btn btn-sm btn-secondary", onClick: expandAll, title: "Expand all nodes" }, "Expand"),
            h("button", { type: "button", className: "btn btn-sm btn-secondary", onClick: collapseAll, title: "Collapse all nodes" }, "Collapse")
          )
        ),
        isRecordArray ? h("div", { className: "source-record-controls" },
          h("div", { className: "source-view-toggle", role: "group", "aria-label": "Source tree view" },
            h("button", {
              type: "button",
              className: "btn btn-sm" + (treeViewMode === "single" ? " btn-primary" : " btn-secondary"),
              onClick: function () { setTreeViewMode("single"); },
              "data-tooltip": "Browse one record at a time (paths match mapping fields)",
            }, "One record"),
            h("button", {
              type: "button",
              className: "btn btn-sm" + (treeViewMode === "all" ? " btn-primary" : " btn-secondary"),
              onClick: function () { setTreeViewMode("all"); },
              "data-tooltip": "List every record at the top level",
            }, "All records")
          ),
          treeViewMode === "single" ? h("div", { className: "source-record-nav" },
            h("button", {
              type: "button",
              className: "btn btn-sm btn-secondary",
              onClick: function () { goToRecord(safeRecordIndex - 1); },
              disabled: safeRecordIndex <= 0,
              title: "Previous record",
            }, "\u25C0"),
            h("label", { className: "source-record-goto" },
              h("span", { className: "text-sm text-muted" }, "Record"),
              h("input", {
                className: "source-record-input",
                type: "number",
                min: 1,
                max: data.length,
                value: safeRecordIndex + 1,
                onChange: function (e) {
                  var n = parseInt(e.target.value, 10);
                  if (!isNaN(n)) goToRecord(n - 1);
                },
              }),
              h("span", { className: "text-sm text-muted" }, "of " + data.length)
            ),
            h("button", {
              type: "button",
              className: "btn btn-sm btn-secondary",
              onClick: function () { goToRecord(safeRecordIndex + 1); },
              disabled: safeRecordIndex >= data.length - 1,
              title: "Next record",
            }, "\u25B6")
          ) : h("span", { className: "source-record-hint text-sm text-muted" },
            data.length + " records — expand each to inspect"
          )
        ) : null,
        h(SourceBreadcrumb, { crumbs: breadcrumbs, onNavigate: handleNavigate }),
        h("div", { className: "source-split" },
          h("div", { className: "source-tree-scroll tree" },
            isRecordArray && treeViewMode === "all" ? data.map(function (record, i) {
              return h(TreeNode, {
                key: "record-" + i,
                nodeKey: "Record " + (i + 1),
                value: record,
                path: String(i),
                onSelect: onSelect,
                selectedPath: selectedPath,
                searchQuery: searchQuery,
                sourceData: data,
                depth: 0,
                expandControl: expandControl,
              });
            }) : h(TreeNode, {
              key: isRecordArray ? "record-" + safeRecordIndex : "root",
              nodeKey: isRecordArray ? "Record " + (safeRecordIndex + 1) : "root",
              value: treeContext.treeData,
              path: "",
              onSelect: onSelect,
              selectedPath: selectedPath,
              searchQuery: searchQuery,
              sourceData: treeContext.treeSourceData,
              depth: 0,
              expandControl: expandControl,
            })
          ),
          h(SourceDetailPane, {
            path: selectedPath,
            value: selectedValue,
          })
        )
      )
    );
  }

  // ── Mapping Editor (Table-based) ───────────────────────────────────

  function readStoredPanelWidth(key, fallback, min, max) {
    try {
      var w = localStorage.getItem(key);
      if (w) return Math.min(max, Math.max(min, parseInt(w, 10)));
    } catch (e) { console.warn("Could not read panel width from localStorage:", e); }
    return fallback;
  }

  function startPanelResize(e, config) {
    e.preventDefault();
    var startX = e.clientX;
    var startW = config.getStartWidth();
    var currentW = startW;
    function onMove(ev) {
      currentW = Math.min(config.max, Math.max(config.min, startW + (ev.clientX - startX) * config.direction));
      config.onWidth(currentW);
    }
    function onUp() {
      try {
        if (config.storageKey) localStorage.setItem(config.storageKey, String(currentW));
      } catch (err) { console.warn("Could not save panel width to localStorage:", err); }
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    }
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  }

  var HELP_TOPICS = [
    {
      id: "overview",
      title: "Overview",
      body: "Load JSON source data, define a mapping, and preview transformed output in real time.\n\nThree editor modes work together: Visual (table UI), JSON (pure data), and JS (module with export default). Not every feature is available in every mode — start with JSON vs JS in the help nav.",
    },
    {
      id: "samples",
      title: "Sample files",
      body: "The samples/ directory contains ready-to-run mapping and data file pairs — a good starting point for exploring features or understanding the mapping format.\n\nTo load a sample: click Load Data and pick a test-*.json file from samples/, then click Import and pick the matching mapping-*.json or mapping-*.js file.\n\nmapping-nested — forEach line items, nested objects, and conditions (test-nested.json)\n\nmapping-crm-example — value maps, date formatting, simple conditions (test-data.json)\n\nmapping-employee — composite and/or/not conditions (test-employees.json)\n\nmapping-data-cleaning — passthrough, template strings, coalesce, compute (test-data-cleaning.json)\n\nmapping-shaping — groupBy, flatten, aggregates (test-shaping.json)\n\nmapping-validated — mapping with schema validation rules (test-data.json)\n\nmapping-timesheet — timesheet aggregation and compute (test-data.json)\n\nEach sample comes in a .json and a .js variant. The .js variant uses JavaScript function compute; the .json variant uses string expressions.",
    },
    {
      id: "json-vs-js",
      title: "JSON vs JS",
      body: "JSON and JS both describe the same mapping object. JSON is strict data only; JS wraps that object in export default and allows real JavaScript functions. The app picks Visual, JSON, or JS automatically when you import, or you can switch with the Visual / JSON / JS buttons.",
      compareRows: [
        { feature: "from, format, map, default", visual: "Yes", json: "Yes", js: "Yes" },
        { feature: "forEach & nested fields", visual: "Yes", json: "Yes", js: "Yes" },
        { feature: "if / then / else, and / or / not", visual: "View only", json: "Yes", js: "Yes" },
        { feature: "template string {Field}", visual: "Yes", json: "Yes", js: "Yes" },
        { feature: "static value", visual: "View only", json: "Yes", js: "Yes" },
        { feature: "coalesce (fallback paths)", visual: "Yes", json: "Yes", js: "Yes" },
        { feature: "lookup & inline dictionaries", visual: "View only", json: "Yes", js: "Yes" },
        { feature: "schema validation block", visual: "View only", json: "Yes", js: "Yes" },
        { feature: "passthrough: true (toggle)", visual: "Yes", json: "Yes", js: "Yes" },
        { feature: "passthrough: { exclude: [...] }", visual: "View only", json: "Yes", js: "Yes" },
        { feature: "compute as expression string", visual: "Templates", json: "Yes", js: "Yes" },
        { feature: "compute as (a,b) => { ... }", visual: "No", json: "No", js: "JS only" },
        { feature: "Comments in mapping file", visual: "—", json: "No", js: "Yes" },
        { feature: "dictionaries.$file (external JSON)", visual: "—", json: "CLI only", js: "CLI only" },
        { feature: "groupBy, flatten, filter, aggregate…", visual: "View only", json: "Yes", js: "Yes" },
      ],
      examples: [
        {
          title: "Same logic — JSON vs JS",
          description: "JSON must use a string for compute. JS can use an arrow function (required for multi-line logic and dicts access patterns).",
          mode: "both",
          code: [
            "// ── JSON (.json) ──",
            '"line_total": {',
            '  "from": ["Price", "Qty"],',
            '  "compute": "return parseFloat(a) * Number(b);"',
            "}",
            "",
            "// ── JS (.js) ──",
            "line_total: {",
            '  from: ["Price", "Qty"],',
            "  compute: (price, qty) => parseFloat(price) * qty,",
            "},",
          ].join("\n"),
        },
        {
          title: "When the app forces JS mode",
          description: "Import or export switches to JS if any field uses a function-valued compute. Visual mode stays available for simple rows; advanced fields show as read-only cards.",
          mode: "js",
          code: [
            "// Nested order sample — line_total uses a function → use JS mode",
            "compute: (price, qty) => parseFloat(price) * qty",
          ].join("\n"),
        },
      ],
    },
    {
      id: "field-map",
      title: "Field mapping",
      body: "Each destination field is defined under fields. Works in Visual, JSON, and JS.\n\nVisual mode edits these interactively; JSON/JS show the full document.",
      examples: [
        {
          title: "Rename + format",
          description: "Copy a source field and apply a format on output.",
          code: [
            'full_name: { from: "FullName", format: "uppercase" },',
            'age:       { from: "BirthYear", format: "number" },',
          ].join("\n"),
        },
        {
          title: "Value map (lookup table)",
          description: "Translate known source values to output codes.",
          code: [
            'dept_code: {',
            '  from: "Department",',
            '  map: {',
            '    "Engineering": "ENG",',
            '    "Marketing": "MKT",',
            '  },',
            '},',
          ].join("\n"),
        },
        {
          title: "Default when missing",
          description: "Use default when the source path is null or undefined.",
          code: 'status_label: { from: "Status", default: "unknown" }',
        },
      ],
    },
    {
      id: "compute",
      title: "Compute",
      body: "Compute combines source paths with custom logic.\n\nJSON or JS: use a string expression (return …) — parameters are a, b, c in order, plus row and dicts when needed.\n\nJS only: use a real function (price, qty) => … or (empId, row, dicts) => …. Required for samples like Nested order (line_total) and Timesheet (dictionary hops).\n\nVisual: Compute row type writes a sandboxed string expression (same as JSON), not an arrow function.",
      examples: [
        {
          title: "Multiply two fields (line total)",
          description: "Nested order sample — in JSON use the string form; in JS use the function form.",
          mode: "both",
          code: [
            "// JS (.js file):",
            "line_total: {",
            '  from: ["Price", "Qty"],',
            "  compute: (price, qty) => parseFloat(price) * qty,",
            "},",
            "",
            '// JSON (.json file) — string only:',
            '"line_total": {',
            '  "from": ["Price", "Qty"],',
            '  "compute": "return parseFloat(a) * Number(b);"',
            "},",
          ].join("\n"),
        },
        {
          title: "Concatenate with full row access",
          description: "JS only — arrow functions can use the row argument.",
          mode: "js",
          code: [
            "display_name: {",
            '  from: ["FirstName", "LastName"],',
            "  compute: (first, last, row) => `${first} ${last}`.trim(),",
            "},",
          ].join("\n"),
        },
        {
          title: "Build a formatted address",
          description: "JS only — multi-line function body.",
          mode: "js",
          code: [
            "address: {",
            '  from: ["street", "city", "state", "zip"],',
            "  compute: (street, city, state, zip) => {",
            '    const tc = s => String(s).toLowerCase().replace(/\\b\\w/g, c => c.toUpperCase());',
            '    return `${tc(street)}, ${tc(city)}, ${String(state).toUpperCase()} ${zip}`;',
            "  },",
            "},",
          ].join("\n"),
        },
        {
          title: "Dictionary lookup in compute",
          description: "JS only — dicts is passed to function compute; use string compute in JSON only for simple expressions.",
          mode: "js",
          code: [
            "department: {",
            '  from: ["employee_id"],',
            "  compute: (empId, row, dicts) => {",
            "    const emp = dicts.employees?.[empId];",
            "    if (!emp) return \"Unknown\";",
            "    return dicts.departments?.[emp.dept_code]?.name ?? emp.dept_code;",
            "  },",
            "},",
          ].join("\n"),
        },
        {
          title: "Visual editor templates",
          description: "Visual / JSON — produces a string compute field (export as JSON or JS).",
          mode: "json",
          code: [
            "// Equivalent to: return [a, b].filter(...).join(\" \");",
            'compute: "return String(a) + \\" \\" + String(b);"',
          ].join("\n"),
        },
      ],
    },
    {
      id: "conditions",
      title: "Conditions (if / then / else)",
      body: "JSON or JS only — not editable in Visual (shown as read-only cards). Paste or write rules in JSON/JS mode, or import a sample like Employee conditions.\n\nOperators: eq, neq, gt, gte, lt, lte, truthy, falsy, exists, matches (regex), in (array). Field may be a top-level or dot path.",
      examples: [
        {
          title: "Simple if / then / else",
          description: "Compare one field to a value.",
          code: [
            "employment_type: {",
            '  if: { field: "HourlyRate", op: "gt", value: 0 },',
            '  then: "hourly",',
            '  else: "salaried",',
            "},",
          ].join("\n"),
        },
        {
          title: "Boolean flag",
          description: "CRM sample — active status check.",
          code: [
            "is_vip: {",
            '  if: { field: "StatusCode", op: "eq", value: "A" },',
            "  then: true,",
            "  else: false,",
            "},",
          ].join("\n"),
        },
        {
          title: "thenMap (post-process then value)",
          description: "Map the then result through a lookup table.",
          code: [
            "tier: {",
            '  if: { field: "TotalSpend", op: "gte", value: 10000 },',
            '  then: "platinum",',
            "  thenMap: { platinum: \"VIP Platinum\" },",
            "},",
          ].join("\n"),
        },
        {
          title: "exists — use another field when present",
          description: "then can be a nested field definition, not only a literal.",
          code: [
            "emergency_contact: {",
            '  if: { field: "EmergencyPhone", op: "exists", value: true },',
            '  then: { from: "EmergencyPhone" },',
            '  else: "N/A",',
            "},",
          ].join("\n"),
        },
        {
          title: "matches (regex) and in (list)",
          description: "Employee / CRM patterns.",
          code: [
            'email_valid: { if: { field: "Email", op: "matches", value: "^[^@]+@[^@]+\\\\.[^@]+$" }, then: true, else: false },',
            'message: { if: { field: "StatusCode", op: "in", value: ["A", "P"] }, then: "Welcome!", else: "Unavailable." },',
          ].join("\n"),
        },
        {
          title: "Nested paths in conditions",
          description: "Order priority from customer + total (Nested order sample).",
          code: [
            "priority: {",
            "  if: {",
            "    and: [",
            '      { field: "customer.FullName", op: "exists", value: true },',
            '      { field: "grand_total", op: "gte", value: 500 },',
            "    ],",
            "  },",
            '  then: "high",',
            '  else: "standard",',
            "},",
          ].join("\n"),
        },
      ],
    },
    {
      id: "logic-composite",
      title: "AND / OR / NOT",
      body: "JSON or JS only (Visual: view-only). Combine conditions with and, or, not. Employee import sample demonstrates nested composites.",
      examples: [
        {
          title: "AND — all conditions must pass",
          description: "Bonus eligibility example.",
          code: [
            "bonus_eligible: {",
            "  if: {",
            "    and: [",
            '      { field: "Status", op: "eq", value: "active" },',
            '      { field: "YearsEmployed", op: "gt", value: 1 },',
            '      { field: "Salary", op: "gt", value: 50000 },',
            "    ],",
            "  },",
            "  then: true,",
            "  else: false,",
            "},",
          ].join("\n"),
        },
        {
          title: "OR — any condition passes",
          description: "Remote work eligibility.",
          code: [
            "remote_ok: {",
            "  if: {",
            "    or: [",
            '      { field: "Department", op: "eq", value: "Engineering" },',
            '      { field: "Department", op: "eq", value: "Management" },',
            '      { field: "Title", op: "matches", value: "(?i)(director|vp|chief)" },',
            "    ],",
            "  },",
            "  then: true,",
            "  else: false,",
            "},",
          ].join("\n"),
        },
        {
          title: "NOT — invert a condition",
          description: "Flag records that are not active.",
          code: [
            "needs_review: {",
            '  if: { not: { field: "Status", op: "eq", value: "active" } },',
            "  then: true,",
            "  else: false,",
            "},",
          ].join("\n"),
        },
        {
          title: "Nested AND + OR",
          description: "Senior IC rule — mix groups.",
          code: [
            "senior_ic: {",
            "  if: {",
            "    and: [",
            "      { or: [",
            '          { field: "Department", op: "eq", value: "Engineering" },',
            '          { field: "Department", op: "eq", value: "Data" },',
            "        ] },",
            "      { or: [",
            '          { field: "Level", op: "eq", value: "senior" },',
            '          { field: "Level", op: "eq", value: "staff" },',
            "        ] },",
            '      { field: "EmployeeType", op: "neq", value: "contractor" },',
            "    ],",
            "  },",
            "  then: true,",
            "  else: false,",
            "},",
          ].join("\n"),
        },
      ],
    },
    {
      id: "templates-coalesce",
      title: "Templates & coalesce",
      body: "Template strings use {FieldName} placeholders (Visual: set Source to “Template string”). static value is JSON/JS only. coalesce tries fallback paths in order on simple field rows.",
      examples: [
        {
          title: "Template string",
          description: "Data cleaning sample — optional format on result.",
          code: [
            "full_name: {",
            '  template: "{first_name} {last_name}",',
            '  format: "titlecase",',
            "},",
          ].join("\n"),
        },
        {
          title: "Coalesce with default",
          description: "First available phone wins.",
          code: [
            "phone: {",
            '  coalesce: ["mobile", "work_phone", "home_phone"],',
            '  default: "N/A",',
            "},",
          ].join("\n"),
        },
        {
          title: "Static value",
          description: "No from — always emits the literal.",
          code: 'source_system: { value: "crm-legacy" }',
        },
      ],
    },
    {
      id: "foreach",
      title: "Array (forEach)",
      body: "Visual, JSON, and JS. Wizard can build forEach steps; add function compute on sub-fields in JS mode only.",
      examples: [
        {
          title: "Line items array",
          description: "JSON or JS — but line_total compute must be string (JSON) or function (JS).",
          mode: "both",
          code: [
            "items: {",
            '  forEach: "LineItems",',
            "  fields: {",
            '    product_code: { from: "SKU" },',
            '    quantity:     { from: "Qty", format: "number" },',
            '    unit_price:   { from: "Price", format: "number" },',
            "    line_total: {",
            '      from: ["Price", "Qty"],',
            '      // JS: compute: (price, qty) => parseFloat(price) * qty',
            '      // JSON: "compute": "return parseFloat(a) * Number(b);"',
            "    },",
            "  },",
            "},",
          ].join("\n"),
        },
      ],
    },
    {
      id: "nested",
      title: "Nested objects",
      body: "Visual, JSON, and JS. Group outputs under a fields block or use dot-path destination keys.",
      examples: [
        {
          title: "Nested shipping block",
          description: "Nested order sample.",
          code: [
            "shipping: {",
            "  fields: {",
            '    city:  { from: "ship_city", format: "uppercase" },',
            '    state: { from: "ship_state" },',
            '    zip:   { from: "ship_zip", map: { "10001": "10xxx" } },',
            "  },",
            "},",
          ].join("\n"),
        },
        {
          title: "Dot-path target (flat nested shape)",
          description: "Alternative style — single-level keys with dots.",
          code: [
            '"customer.name":  { from: "customer.FullName", format: "uppercase" },',
            '"customer.email": { from: "customer.Email", format: "lowercase" },',
          ].join("\n"),
        },
      ],
    },
    {
      id: "dictionaries",
      title: "Dictionaries & lookup",
      body: "JSON or JS (Visual: view-only). In the browser, dictionaries must be inline objects — $file paths work in the CLI only, not in this app.\n\nlookup / lookupPath work in JSON and JS. Heavy multi-hop lookups are usually written as JS compute functions.",
      examples: [
        {
          title: "Inline dictionary + lookup",
          description: "JSON or JS in browser — no $file.",
          mode: "json",
          code: [
            "dictionaries: {",
            "  statusMap: { A: \"approved\", P: \"pending\", R: \"rejected\" },",
            "},",
            "fields: {",
            '  entry_status: { from: "status", lookup: "statusMap" },',
            "},",
          ].join("\n"),
        },
        {
          title: "lookupPath — field from record",
          description: "Resolve employee_id to full_name from employees dict.",
          code: [
            "employee_name: {",
            '  from: "employee_id",',
            '  lookup: "employees",',
            '  lookupPath: "full_name",',
            "},",
          ].join("\n"),
        },
      ],
    },
    {
      id: "formats",
      title: "Date & number formats",
      body: "Set format on a from field. Dates use outputFormat tokens: YYYY, MM, DD, MMMM, hh, mm, AMPM. Numbers can use round with precision, or split/join/truncate/replace for strings.",
      examples: [
        {
          title: "Date output formats",
          code: [
            'created: { from: "CreatedDate", format: "date", outputFormat: "YYYY-MM-DD" },',
            'ship_date: { from: "date_shipped", format: "date", outputFormat: "MMMM DD, YYYY" },',
          ].join("\n"),
        },
        {
          title: "Round / split / join",
          code: [
            'price: { from: "price", format: "round", precision: 2 },',
            'tags:  { from: "tags", format: "split", separator: "," },',
            'keywords: { from: "keywords", format: "join", separator: " | " },',
          ].join("\n"),
        },
      ],
    },
    {
      id: "passthrough",
      title: "Passthrough",
      body: "passthrough: true copies all unmapped source keys to output (camelCase). Use an object to exclude paths: passthrough: { exclude: [\"internal_id\"] }.",
      examples: [
        {
          title: "Passthrough with exclusions",
          code: [
            'passthrough: { exclude: ["internal_id"] },',
            "fields: {",
            "  // fields here override passthrough keys",
            "},",
          ].join("\n"),
        },
      ],
    },
    {
      id: "wizard",
      title: "Mapping wizard",
      body: "Visual only output — produces simple, forEach, and nested mappings without function compute or conditions. After Finish, switch to JSON/JS to add if/compute/dictionaries.",
    },
    {
      id: "import-export",
      title: "Import & export",
      body: "Imports auto-select mode: simple mappings → Visual; advanced rules → JSON; any function compute → JS.\n\nExport: .json when the mapping is data-only; .js when compute uses functions (functions are serialized if you export from JSON with string compute). Copy mapping follows the same rules.",
    },
    {
      id: "panels",
      title: "Panels & layout",
      body: "Drag handles resize Source and Preview panels. Collapse headers hide panel bodies. Mapping editor fills remaining width.",
    },
  ];

  function helpModeBadge(mode) {
    if (!mode) return null;
    var labels = { json: "JSON or JS", js: "JS only", both: "JSON vs JS", visual: "Visual" };
    var label = labels[mode] || mode;
    return h("span", { className: "help-mode-badge help-mode-" + mode }, label);
  }

  function HelpPanel(props) {
    var open = props.open;
    var onClose = props.onClose;
    var _useState = useState("json-vs-js"), activeId = _useState[0], setActiveId = _useState[1];
    var contentRef = useRef(null);
    var navRef = useRef(null);

    useEffect(function () {
      if (!open) return;
      if (contentRef.current) contentRef.current.scrollTop = 0;
      if (navRef.current) navRef.current.scrollTop = 0;
    }, [activeId, open]);

    if (!open) return null;

    var active = HELP_TOPICS.find(function (t) { return t.id === activeId; }) || HELP_TOPICS[0];

    return h("div", {
      className: "help-overlay",
      onClick: function (e) { if (e.target === e.currentTarget) onClose(); },
    },
      h("aside", { className: "help-panel", role: "dialog", "aria-label": "Help" },
        h("div", { className: "help-panel-header" },
          h("span", { className: "help-panel-title" }, "Help"),
          h("button", { type: "button", className: "btn btn-icon", onClick: onClose, title: "Close help" }, "\u2715")
        ),
        h("div", { className: "help-panel-body" },
          h("nav", { ref: navRef, className: "help-nav" },
            HELP_TOPICS.map(function (topic) {
              return h("button", {
                key: topic.id,
                type: "button",
                className: "help-nav-item" + (topic.id === activeId ? " active" : ""),
                onClick: function () { setActiveId(topic.id); },
              }, topic.title);
            })
          ),
          h("div", { ref: contentRef, className: "help-content", key: activeId },
            h("h3", { className: "help-content-title" }, active.title),
            active.body.split("\n\n").map(function (para, i) {
              return h("p", { key: "p-" + i, className: "help-content-body" }, para);
            }),
            active.compareRows && active.compareRows.length ? h("div", { className: "help-compare-wrap" },
              h("table", { className: "help-compare-table" },
                h("thead", null,
                  h("tr", null,
                    h("th", null, "Feature"),
                    h("th", null, "Visual"),
                    h("th", null, "JSON"),
                    h("th", null, "JS")
                  )
                ),
                h("tbody", null,
                  active.compareRows.map(function (row, i) {
                    return h("tr", { key: "cmp-" + i },
                      h("td", null, row.feature),
                      h("td", null, row.visual),
                      h("td", null, row.json),
                      h("td", null, row.js)
                    );
                  })
                )
              )
            ) : null,
            active.examples && active.examples.length ? h("div", { className: "help-examples" },
              active.examples.map(function (ex, i) {
                return h("section", { key: "ex-" + i, className: "help-example" },
                  h("h4", { className: "help-example-title" },
                    ex.title,
                    helpModeBadge(ex.mode)
                  ),
                  ex.description ? h("p", { className: "help-example-desc" }, ex.description) : null,
                  h("pre", { className: "help-example-code" }, ex.code)
                );
              })
            ) : null
          )
        )
      )
    );
  }

  function MappingFieldLabel(props) {
    return h("label", {
      className: "mapping-field-label" + (props.tooltip ? " mapping-field-label-tip" : ""),
      "data-tooltip": props.tooltip || undefined,
      title: props.tooltip || undefined,
    }, props.children);
  }

  function FormatOptionExtras(props) {
    var field = props.field;
    var onPatch = props.onPatch;
    var compact = props.compact;
    if (!MF || !field) return null;

    if (field.format === "date") {
      var preset = MF.dateOutputPresetValue(field.outputFormat);
      var isCustom = preset === "__custom__";
      return h("div", { className: "format-option-extras" + (compact ? " format-option-extras-compact" : "") },
        h("label", { className: "mapping-field-label" }, "Date output format"),
        h("select", {
          className: "mapping-field-input",
          value: isCustom ? "__custom__" : preset,
          onChange: function (e) {
            var val = e.target.value;
            if (val === "__custom__") {
              onPatch({ outputFormat: field.outputFormat || "YYYY-MM-DD" });
            } else {
              onPatch({ outputFormat: val });
            }
          },
        },
          MF.DATE_OUTPUT_PRESETS.map(function (p) {
            return h("option", { key: p.value, value: p.value }, p.label);
          }),
          h("option", { value: "__custom__" }, "Custom…")
        ),
        isCustom ? h("input", {
          className: "mapping-field-input",
          type: "text",
          value: field.outputFormat || "",
          placeholder: "YYYY-MM-DD",
          onInput: function (e) { onPatch({ outputFormat: e.target.value.trim() }); },
        }) : null
      );
    }

    if (field.format === "number" || field.format === "round") {
      var numUi = MF.numberFormatUiValue(field);
      return h("div", { className: "format-option-extras" + (compact ? " format-option-extras-compact" : "") },
        h("label", { className: "mapping-field-label" }, "Number style"),
        h("select", {
          className: "mapping-field-input",
          value: numUi,
          onChange: function (e) {
            var patch = MF.applyNumberFormatUi(e.target.value);
            onPatch(patch);
          },
        },
          MF.NUMBER_FORMAT_OPTIONS.map(function (opt) {
            return h("option", { key: opt.value, value: opt.value }, opt.label);
          })
        )
      );
    }

    return null;
  }

  function MapPairsEditor(props) {
    var entries = props.entries || [];
    var onChange = props.onChange;
    var distinctValues = props.distinctValues || [];
    var compact = props.compact;
    var _useState = useState(entries.length > 0), expanded = _useState[0], setExpanded = _useState[1];

    useEffect(function () {
      if (entries.length > 0) setExpanded(true);
    }, [entries.length]);

    function setEntries(next) {
      onChange(next);
    }

    function updateEntry(index, patch) {
      var next = entries.slice();
      next[index] = Object.assign({}, next[index], patch);
      setEntries(next);
    }

    function removeEntry(index) {
      var next = entries.slice();
      next.splice(index, 1);
      setEntries(next);
    }

    function addEntry() {
      setExpanded(true);
      setEntries(entries.concat([{ key: "", value: "" }]));
    }

    function addFromSampleValues() {
      var existing = {};
      entries.forEach(function (entry) {
        if (entry.key) existing[String(entry.key)] = true;
      });
      var added = distinctValues.filter(function (val) {
        return !existing[val];
      }).map(function (val) {
        return { key: val, value: val };
      });
      if (!added.length) {
        showToast("All sample values are already in the map", "info", 2500);
        return;
      }
      setExpanded(true);
      setEntries(entries.concat(added));
      showToast("Added " + added.length + " value(s) from sample data", "success", 2500);
    }

    var entryCount = entries.filter(function (entry) {
      return entry.key && String(entry.key).trim();
    }).length;

    return h("div", { className: "map-pairs-editor" + (compact ? " map-pairs-editor-compact" : "") },
      h("div", { className: "map-pairs-toolbar" },
        h("button", {
          type: "button",
          className: "map-pairs-toggle",
          onClick: function () { setExpanded(!expanded); },
        },
          h("span", { className: "map-pairs-toggle-icon" }, expanded ? "\u25BE" : "\u25B8"),
          h("span", { className: "mapping-field-label" }, "Value map"),
          h("span", { className: "map-pairs-count text-sm text-muted" },
            entryCount ? entryCount + " entr" + (entryCount === 1 ? "y" : "ies") : "none"
          )
        ),
        h("div", { className: "map-pairs-toolbar-actions" },
          h("button", {
            type: "button",
            className: "btn btn-sm btn-secondary",
            onClick: addEntry,
          }, "+ Add row"),
          distinctValues.length ? h("button", {
            type: "button",
            className: "btn btn-sm btn-secondary",
            title: "Add rows for distinct values found in loaded data",
            onClick: addFromSampleValues,
          }, "From sample data (" + distinctValues.length + ")") : null
        )
      ),
      expanded ? h("div", { className: "map-pairs-scroll" },
        entries.length ? h("div", { className: "map-pairs-header" },
          h("span", null, "Source value"),
          h("span", null, "Mapped value"),
          h("span", { className: "map-pairs-header-action" }, "")
        ) : h("p", { className: "map-pairs-empty text-sm text-muted" },
            "Map source values to output values (e.g. status codes → labels)."
          ),
        entries.map(function (entry, i) {
          return h("div", { key: i, className: "map-pairs-row" },
            h("input", {
              className: "mapping-field-input",
              type: "text",
              value: entry.key || "",
              placeholder: "source",
              title: "Value from source field",
              onInput: function (e) { updateEntry(i, { key: e.target.value }); },
            }),
            h("input", {
              className: "mapping-field-input",
              type: "text",
              value: entry.value || "",
              placeholder: "output",
              title: "Value to emit when source matches",
              onInput: function (e) { updateEntry(i, { value: e.target.value }); },
            }),
            h("button", {
              type: "button",
              className: "btn btn-sm btn-secondary",
              title: "Remove row",
              onClick: function () { removeEntry(i); },
            }, "\u2715")
          );
        })
      ) : null
    );
  }

  function CoalescePathsEditor(props) {
    var value = props.value || "";
    var onChange = props.onChange;
    var pathSuggestions = props.pathSuggestions || [];
    var primarySource = props.primarySource || "";
    var compact = props.compact;
    var paths = MF ? (MF.parseCoalesce(value) || []) : [];
    var _useState = useState(paths.length > 0), expanded = _useState[0], setExpanded = _useState[1];

    useEffect(function () {
      if (value && String(value).trim()) setExpanded(true);
    }, [value]);

    function setPaths(next) {
      onChange(MF ? MF.coalescePathsToText(next) : next.join(", "));
    }

    function updatePath(index, path) {
      var next = paths.slice();
      next[index] = path;
      setPaths(next);
    }

    function removePath(index) {
      var next = paths.slice();
      next.splice(index, 1);
      setPaths(next);
    }

    function addPath() {
      setExpanded(true);
      setPaths(paths.concat([""]));
    }

    function addSuggested(path) {
      if (!path || paths.indexOf(path) >= 0) return;
      setExpanded(true);
      setPaths(paths.concat([path]));
    }

    var filledCount = paths.filter(function (p) { return p && String(p).trim(); }).length;
    var pickList = pathSuggestions.filter(function (p) {
      return p && p !== primarySource && paths.indexOf(p) < 0;
    }).slice(0, 24);

    return h("div", { className: "coalesce-paths-editor" + (compact ? " coalesce-paths-editor-compact" : "") },
      h("div", { className: "coalesce-paths-toolbar" },
        h("button", {
          type: "button",
          className: "coalesce-paths-toggle",
          onClick: function () { setExpanded(!expanded); },
        },
          h("span", { className: "coalesce-paths-toggle-icon" }, expanded ? "\u25BE" : "\u25B8"),
          h(MappingFieldLabel, { tooltip: "Try each path in order; first non-null value wins" }, "Coalesce fallbacks"),
          h("span", { className: "coalesce-paths-count text-sm text-muted" },
            filledCount ? filledCount + " path" + (filledCount === 1 ? "" : "s") : "none"
          )
        ),
        h("div", { className: "coalesce-paths-toolbar-actions" },
          h("button", { type: "button", className: "btn btn-sm btn-secondary", onClick: addPath }, "+ Add fallback")
        )
      ),
      expanded ? h("div", { className: "coalesce-paths-body" },
        paths.length ? null : h("p", { className: "coalesce-paths-empty text-sm text-muted" },
          "Add alternate source paths used when the primary source is null or missing."
        ),
        paths.map(function (path, i) {
          return h("div", { key: i, className: "coalesce-paths-row" },
            h("input", {
              className: "mapping-field-input",
              type: "text",
              value: path || "",
              placeholder: "fallback.path",
              list: "field-suggestions",
              title: "Fallback source path",
              onInput: function (e) { updatePath(i, e.target.value); },
            }),
            h("button", {
              type: "button",
              className: "btn btn-sm btn-secondary",
              title: "Remove fallback path",
              onClick: function () { removePath(i); },
            }, "\u2715")
          );
        }),
        pickList.length ? h("div", { className: "coalesce-paths-suggestions" },
          h("span", { className: "text-sm text-muted" }, "Add from data:"),
          pickList.map(function (p) {
            return h("button", {
              key: p,
              type: "button",
              className: "btn btn-sm btn-secondary coalesce-suggest-chip",
              onClick: function () { addSuggested(p); },
            }, p);
          })
        ) : null
      ) : null
    );
  }

  function TemplateStringEditor(props) {
    var value = props.value || "";
    var onChange = props.onChange;
    var pathSuggestions = props.pathSuggestions || [];
    var compact = props.compact;
    var _useState = useState(!!String(value).trim()), expanded = _useState[0], setExpanded = _useState[1];
    var inputRef = useRef(null);

    useEffect(function () {
      if (String(value).trim()) setExpanded(true);
    }, [value]);

    function insertField(path) {
      if (!path) return;
      var token = "{" + path + "}";
      var el = inputRef.current;
      var next;
      if (el && typeof el.selectionStart === "number") {
        var start = el.selectionStart;
        var end = el.selectionEnd;
        next = value.slice(0, start) + token + value.slice(end);
      } else {
        next = value + (value && !/\s$/.test(value) ? " " : "") + token;
      }
      onChange(next);
      setExpanded(true);
    }

    var placeholders = MF ? MF.extractTemplateFields(value) : [];
    var pickList = pathSuggestions.filter(function (p) {
      return p && placeholders.indexOf(p) < 0;
    }).slice(0, 24);

    return h("div", { className: "template-string-editor" + (compact ? " template-string-editor-compact" : "") },
      h("div", { className: "template-string-toolbar" },
        h("button", {
          type: "button",
          className: "template-string-toggle",
          onClick: function () { setExpanded(!expanded); },
        },
          h("span", { className: "template-string-toggle-icon" }, expanded ? "\u25BE" : "\u25B8"),
          h(MappingFieldLabel, {
            tooltip: "Build text from source fields using {FieldName} placeholders",
          }, "Template string"),
          placeholders.length
            ? h("span", { className: "template-string-count text-sm text-muted" },
              placeholders.length + " field" + (placeholders.length === 1 ? "" : "s")
            )
            : h("span", { className: "template-string-count text-sm text-muted" }, "none")
        )
      ),
      expanded ? h("div", { className: "template-string-body" },
        h("input", {
          ref: inputRef,
          className: "mapping-field-input template-string-input",
          type: "text",
          value: value,
          placeholder: "{Salary} {Status}",
          onInput: function (e) { onChange(e.target.value); },
        }),
        placeholders.length ? h("p", { className: "template-string-placeholders text-sm text-muted" },
          "Uses: ",
          placeholders.map(function (p, i) {
            return h(Fragment, { key: p },
              i > 0 ? ", " : null,
              h("code", { className: "template-placeholder-tag" }, "{" + p + "}")
            );
          })
        ) : h("p", { className: "template-string-empty text-sm text-muted" },
          "Type {FieldName} tokens or insert fields below."
        ),
        pickList.length ? h("div", { className: "template-string-suggestions" },
          h("span", { className: "text-sm text-muted" }, "Insert field:"),
          pickList.map(function (p) {
            return h("button", {
              key: p,
              type: "button",
              className: "btn btn-sm btn-secondary template-suggest-chip",
              onClick: function () { insertField(p); },
            }, "{" + p + "}")
          })
        ) : null
      ) : null
    );
  }

  function NestedFieldsEditor(props) {
    var nestedFields = props.fields || [];
    var onChange = props.onChange;
    var depth = props.depth || 0;
    var inspection = props.inspection;
    var sourceData = props.sourceData;

    function updateChild(ci, updated) {
      var next = nestedFields.slice();
      next[ci] = updated;
      onChange(next);
    }

    function addChild() {
      var next = nestedFields.slice();
      next.push(MF.defaultVisualField({ target: "field_" + (next.length + 1), kind: "simple" }));
      onChange(next);
    }

    return h("div", { className: "nested-fields-editor", style: { marginLeft: depth ? "12px" : "0" } },
      nestedFields.map(function (nf, ci) {
        return h(MappingFieldRow, {
          key: ci,
          field: nf,
          index: ci,
          onChange: function (_, u) { updateChild(ci, u); },
          onRemove: function (idx) {
            var next = nestedFields.slice();
            next.splice(idx, 1);
            onChange(next);
          },
          onMove: function () { },
          totalFields: nestedFields.length,
          compact: true,
          hideKindSelect: true,
          inspection: inspection,
          sourceData: sourceData,
        });
      }),
      h("button", { type: "button", className: "btn btn-sm btn-secondary mt-1", onClick: addChild }, "+ Nested field")
    );
  }

  function MappingFieldRow(props) {
    var field = props.field;
    var index = props.index;
    var onChange = props.onChange;
    var onRemove = props.onRemove;
    var onMove = props.onMove;
    var compact = props.compact;
    var hideKindSelect = props.hideKindSelect;
    var rowError = props.rowError;
    var inspection = props.inspection;
    var sourceData = props.sourceData;

    var _computeErrState = useState(null);
    var computeErr = _computeErrState[0];
    var setComputeErr = _computeErrState[1];
    var paramLabels = useMemo(function () {
      if (!MF) return ["a"];
      return MF.computeParamLabels(field.computeSources || field.source || "");
    }, [field.computeSources, field.source]);

    function update(key, value) {
      var updated = Object.assign({}, field, {});
      updated[key] = value;
      if (key === "kind") {
        if (value === "forEach" || value === "nested") {
          if (!updated.nestedFields || !updated.nestedFields.length) {
            updated.nestedFields = [MF.defaultVisualField({ target: "item_field", kind: "simple" })];
          }
        }
        if (value === "compute" && MF) {
          var tpl = MF.COMPUTE_TEMPLATES[0];
          updated.computeTemplate = tpl.id;
          updated.computeCode = tpl.code;
        }
      }
      if (key === "computeTemplate" && MF) {
        var t = MF.COMPUTE_TEMPLATES.find(function (x) { return x.id === value; });
        if (t) {
          updated.computeCode = t.code;
        }
      }
      onChange(index, updated);
    }

    function updateMapEntries(entries) {
      var updated = Object.assign({}, field, {
        mapEntries: entries,
        mapPairs: "",
      });
      onChange(index, updated);
    }

    var kind = field.kind || "simple";
    if (kind === "template") {
      field = Object.assign({}, field, { kind: "simple", sourceMode: "template" });
      kind = "simple";
    }
    var useTemplateMode = MF ? MF.visualFieldUsesTemplate(field) : false;
    var templates = MF ? MF.COMPUTE_TEMPLATES : [];
    var mapEntries = MF ? MF.normalizeMapEntries(field) : [];
    var mapDistinctValues = kind === "simple" && field.source && MF
      ? MF.collectDistinctValuesForPath(sourceData, field.source, inspection)
      : [];
    var pathSuggestions = inspection ? Object.keys(inspection.fields || {}) : [];
    var activeComputeTemplate = templates.find(function (t) {
      return t.id === (field.computeTemplate || "concat");
    });

    if (kind === "condition" || kind === "static" || kind === "advanced") {
      var kindLabels = {
        condition: "Condition (if/then/else)",
        static: "Static value",
        advanced: "Advanced",
      };
      return h("div", { className: "mapping-field-row mapping-field-readonly" },
        h("div", { className: "mapping-field-row-main" },
          h("div", null,
            h("label", { className: "mapping-field-label" }, "Destination"),
            h("div", { className: "font-mono text-sm font-bold" }, field.target || "(unnamed)")
          ),
          h("div", null,
            h("label", { className: "mapping-field-label" }, "Type"),
            h("span", { className: "mapping-kind-badge" }, kindLabels[kind] || "Advanced")
          ),
          !compact ? h("div", { className: "mapping-field-actions" },
            h("button", {
              type: "button",
              className: "btn btn-sm btn-danger",
              onClick: function () { onRemove(index); },
              title: "Remove from visual list only",
            }, "\u2715")
          ) : null
        ),
        field.advancedSummary ? h("div", { className: "mapping-advanced-summary" }, field.advancedSummary) : null,
        field.advancedDefJson ? h("pre", { className: "mapping-advanced-def" }, field.advancedDefJson) : null,
        h("div", { className: "mapping-readonly-footnote" }, "Preserved from JS/JSON — edit the full rule in code mode")
      );
    }

    return h("div", { className: "mapping-field-row" + (rowError ? " has-error" : "") },
      rowError ? h("div", { className: "mapping-row-error" }, rowError) : null,
      h("div", { className: "mapping-field-row-main" },
        h("div", null,
          h(MappingFieldLabel, { tooltip: "Destination field name in the output JSON" }, "Target Field"),
          h("input", {
            className: "mapping-field-input",
            type: "text",
            value: field.target || "",
            placeholder: "output_field_name",
            onInput: function (e) { update("target", e.target.value); },
          })
        ),
        kind === "compute" || (kind === "simple" && !useTemplateMode) ? h("div", null,
          h(MappingFieldLabel, {
            tooltip: kind === "compute"
              ? "Comma-separated source paths; bound to parameters a, b, c… in order"
              : "Dot-path to the source field (e.g. user.email)",
          },
            kind === "compute" ? "Source Path(s)" : "Source Path"
          ),
          h("input", {
            className: "mapping-field-input",
            type: "text",
            value: kind === "compute" ? (field.computeSources || field.source || "") : (field.source || ""),
            placeholder: kind === "compute" ? "path.a, path.b" : "source.field.path",
            onInput: function (e) {
              if (kind === "compute") update("computeSources", e.target.value);
              else update("source", e.target.value);
            },
            list: "field-suggestions",
          })
        ) : kind === "simple" && useTemplateMode ? h("div", null,
          h(MappingFieldLabel, {
            tooltip: "Interpolate multiple source fields into one output string",
          }, "Source"),
          h("span", { className: "mapping-source-mode-badge" }, "Template string")
        ) : h("div", null,
          h(MappingFieldLabel, {
            tooltip: kind === "forEach"
              ? "Path to the source array to iterate (forEach)"
              : "Root path of the nested source object",
          },
            kind === "forEach" ? "Array Path (forEach)" : "Object root"
          ),
          h("input", {
            className: "mapping-field-input",
            type: "text",
            value: field.forEachPath || field.source || "",
            placeholder: "items",
            onInput: function (e) { update("forEachPath", e.target.value); },
            list: "field-suggestions",
          })
        ),
        !compact ? h("div", { className: "mapping-field-actions" },
          h("button", { type: "button", className: "btn btn-sm btn-secondary", onClick: function () { onMove(index, -1); }, disabled: index === 0 }, "\u25B2"),
          h("button", { type: "button", className: "btn btn-sm btn-secondary", onClick: function () { onMove(index, 1); }, disabled: index === (props.totalFields - 1) }, "\u25BC"),
          h("button", { type: "button", className: "btn btn-sm btn-danger", onClick: function () { onRemove(index); } }, "\u2715")
        ) : h("div", { className: "mapping-field-actions" },
          h("button", { type: "button", className: "btn btn-sm btn-danger", onClick: function () { onRemove(index); } }, "\u2715")
        )
      ),
      !hideKindSelect && !compact ? h("div", { className: "mapping-field-options" },
        h("div", null,
          h(MappingFieldLabel, { tooltip: "How this destination field is populated" }, "Mapping Type"),
          h("select", { value: kind, onChange: function (e) { update("kind", e.target.value); } },
            h("option", { value: "simple" }, "Field map"),
            h("option", { value: "forEach" }, "Array (forEach)"),
            h("option", { value: "nested" }, "Nested object"),
            h("option", { value: "compute" }, "Compute")
          )
        ),
        kind === "simple" ? h("div", null,
          h(MappingFieldLabel, {
            tooltip: "Single source field, or a template with {FieldName} placeholders",
          }, "Source"),
          h("select", {
            value: field.sourceMode || (useTemplateMode ? "template" : "path"),
            onChange: function (e) {
              var mode = e.target.value;
              var updated = Object.assign({}, field, { sourceMode: mode });
              if (mode === "template") {
                if (!String(updated.template || "").trim()) {
                  updated.template = "";
                }
                updated.source = "";
              } else {
                updated.template = "";
              }
              onChange(index, updated);
            },
          },
            h("option", { value: "path" }, "Single field"),
            h("option", { value: "template" }, "Template string")
          )
        ) : null,
        kind === "simple" ? h("div", null,
          h(MappingFieldLabel, { tooltip: "Coerce output to this type when set" }, "Type"),
          h("select", { value: field.type || "auto", onChange: function (e) { update("type", e.target.value); } },
            h("option", { value: "auto" }, "Auto"),
            h("option", { value: "string" }, "String"),
            h("option", { value: "number" }, "Number"),
            h("option", { value: "boolean" }, "Boolean"),
            h("option", { value: "date" }, "Date")
          )
        ) : null,
        kind === "simple" || kind === "compute" ? h("div", null,
          h(MappingFieldLabel, { tooltip: "Transform the source value (case, date, number, etc.)" }, "Format"),
          h("select", {
            value: field.format || "",
            onChange: function (e) {
              var fmt = e.target.value;
              var updated = Object.assign({}, field, { format: fmt });
              if (fmt === "date" && !field.outputFormat) updated.outputFormat = "YYYY-MM-DD";
              if (fmt === "number" && MF) Object.assign(updated, MF.applyNumberFormatUi("plain"));
              if (fmt !== "number" && fmt !== "round") updated.precision = "";
              onChange(index, updated);
            },
          },
            h("option", { value: "" }, "None"),
            h("option", { value: "uppercase" }, "Uppercase"),
            h("option", { value: "lowercase" }, "Lowercase"),
            h("option", { value: "titlecase" }, "Title Case"),
            h("option", { value: "trim" }, "Trim"),
            h("option", { value: "number" }, "Number"),
            h("option", { value: "date" }, "Date")
          )
        ) : null,
        kind === "simple" ? h("div", null,
          h(MappingFieldLabel, { tooltip: "Value used when source and coalesce paths are all null" }, "Default"),
          h("input", { className: "mapping-field-input", type: "text", value: field.default || "", onInput: function (e) { update("default", e.target.value); } })
        ) : null
      ) : null,
      kind === "simple" ? h(FormatOptionExtras, {
        field: field,
        compact: compact,
        onPatch: function (patch) {
          var updated = Object.assign({}, field, patch);
          onChange(index, updated);
        },
      }) : null,
      kind === "simple" ? h(MapPairsEditor, {
        entries: mapEntries,
        onChange: updateMapEntries,
        distinctValues: mapDistinctValues,
        compact: compact,
      }) : null,
      kind === "simple" && useTemplateMode ? h(TemplateStringEditor, {
        value: field.template || "",
        onChange: function (v) { update("template", v); },
        pathSuggestions: pathSuggestions,
        compact: compact,
      }) : null,
      kind === "simple" && !useTemplateMode ? h(CoalescePathsEditor, {
        value: field.coalesce || "",
        onChange: function (v) { update("coalesce", v); },
        pathSuggestions: pathSuggestions,
        primarySource: field.source || "",
        compact: compact,
      }) : null,
      kind === "compute" && !compact ? h("div", { className: "mapping-field-options mapping-compute-panel" },
        h("div", null,
          h(MappingFieldLabel, { tooltip: "Starter expression; edit the code below" }, "Template"),
          h("select", {
            value: field.computeTemplate || "concat",
            onChange: function (e) {
              update("computeTemplate", e.target.value);
              setComputeErr(null);
            },
          },
            templates.map(function (t) {
              return h("option", { key: t.id, value: t.id }, t.label);
            })
          ),
          activeComputeTemplate && activeComputeTemplate.sourceHint
            ? h("p", { className: "mapping-compute-hint text-sm text-muted" }, activeComputeTemplate.sourceHint)
            : null
        ),
        h("div", { className: "mapping-compute-code-wrap" },
          h(MappingFieldLabel, {
            tooltip: "Sandboxed JS body; must return a value. Parameters match source paths in order.",
          },
            "Expression"
          ),
          h("p", { className: "mapping-compute-params text-sm text-muted" },
            "Parameters: ",
            paramLabels.map(function (name, i) {
              return h(Fragment, { key: name },
                i > 0 ? ", " : null,
                h("code", { className: "mapping-param-name" }, name)
              );
            })
          ),
          h("textarea", {
            className: "mapping-compute-code" + (computeErr ? " has-error" : ""),
            value: field.computeCode || "",
            rows: 4,
            onInput: function (e) {
              update("computeCode", e.target.value);
              if (computeErr) setComputeErr(null);
            },
            onBlur: function () {
              if (!MF) return;
              setComputeErr(MF.validateComputeExpression(field.computeCode || ""));
            },
          }),
          computeErr ? h("div", { className: "mapping-compute-error" }, computeErr) : null
        )
      ) : null,
      (kind === "forEach" || kind === "nested") && !compact ? h("div", { className: "mapping-nested-block" },
        h("div", { className: "mapping-field-label mb-1" }, "Nested field mappings"),
        h(NestedFieldsEditor, {
          fields: field.nestedFields || [],
          onChange: function (nf) { update("nestedFields", nf); },
          inspection: inspection,
          sourceData: sourceData,
        })
      ) : null
    );
  }

  function VisualMappingEditor(props) {
    var fields = props.fields;
    var onChange = props.onChange;
    var inspection = props.inspection;
    var passthrough = props.passthrough;
    var onPassthroughChange = props.onPassthroughChange;
    var sourceData = props.sourceData;
    var validationErrors = props.validationErrors || [];

    function addField() {
      var newFields = fields.slice();
      newFields.push(MF.defaultVisualField({
        target: "new_field_" + (newFields.length + 1),
        kind: "simple",
      }));
      onChange(newFields);
    }

    function updateField(index, updated) {
      var newFields = fields.slice();
      newFields[index] = updated;
      onChange(newFields);
    }

    function removeField(index) {
      var newFields = fields.slice();
      newFields.splice(index, 1);
      onChange(newFields);
    }

    function moveField(index, direction) {
      var newIndex = index + direction;
      if (newIndex < 0 || newIndex >= fields.length) return;
      var newFields = fields.slice();
      var temp = newFields[index];
      newFields[index] = newFields[newIndex];
      newFields[newIndex] = temp;
      onChange(newFields);
    }

    function errorForIndex(i) {
      var msgs = validationErrors.filter(function (e) { return e.index === i; }).map(function (e) { return e.message; });
      return msgs.length ? msgs.join("; ") : "";
    }

    return h("div", { className: "mapping-editor" },
      h("div", { className: "mapping-toolbar" },
        h("label", {
          className: "mapping-passthrough",
          "data-tooltip": "Copy source fields that have no explicit mapping row",
        },
          h("input", {
            type: "checkbox",
            checked: !!passthrough,
            onChange: function (e) { onPassthroughChange(e.target.checked); },
          }),
          " Passthrough (include unmapped source fields)"
        ),
        h("button", { type: "button", className: "btn btn-sm btn-primary", onClick: addField }, "+ Add Field")
      ),
      validationErrors.length > 0 ? h("div", { className: "mapping-validation-summary" },
        validationErrors.length + " mapping issue(s) — check highlighted rows"
      ) : null,
      fields.some(function (f) {
        return f.kind === "advanced" || f.kind === "condition" || f.kind === "static";
      })
        ? h("div", { className: "mapping-readonly-hint" },
            "Condition and advanced rules are shown read-only. Edit them in JS/JSON mode; simple field rows remain editable here."
          )
        : null,
      fields.length === 0 ? h("div", { className: "empty-state" },
        h("div", { className: "empty-state-icon" }, "\uD83D\uDC64"),
        h("div", { className: "empty-state-text" }, "No fields mapped yet"),
        h("div", { className: "empty-state-text" }, "Click \"+ Add Field\" or run the Wizard")
      ) : fields.map(function (field, i) {
        return h(MappingFieldRow, {
          key: i,
          field: field,
          index: i,
          onChange: updateField,
          onRemove: removeField,
          onMove: moveField,
          totalFields: fields.length,
          rowError: errorForIndex(i),
          inspection: inspection,
          sourceData: sourceData,
        });
      }),
      h("datalist", { id: "field-suggestions" },
        (inspection ? Object.keys(inspection.fields || {}).sort() : []).map(function (f) {
          return h("option", { key: f, value: f });
        })
      )
    );
  }

  // ── Mapping field outline (read-only summary for JSON/JS imports) ───

  function MappingFieldOutline(props) {
    var summary = props.summary || [];
    if (!summary.length) return null;
    return h("div", { className: "mapping-field-outline" },
      h("div", { className: "mapping-field-outline-title" },
        summary.length + " destination field" + (summary.length === 1 ? "" : "s")
      ),
      h("ul", { className: "mapping-field-outline-list" },
        summary.map(function (row) {
          return h("li", { key: row.target, className: "mapping-field-outline-item kind-" + row.kind },
            h("span", { className: "mapping-field-outline-target font-mono" }, row.target),
            h("span", { className: "mapping-field-outline-meta text-sm text-muted" },
              row.kind === "advanced" ? "advanced (edit in JSON/JS)" : (row.label || row.kind)
            )
          );
        })
      )
    );
  }

  // ── Code Editor (Free-form) ────────────────────────────────────────

  function escapeHtml(text) {
    return String(text)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  }

  function highlightJson(text) {
    var escaped = escapeHtml(text);
    return escaped.replace(
      /("(?:\\.|[^"\\])*")(\s*:)?|\b(true|false|null)\b|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/g,
      function (match, str, colon) {
        if (str) {
          if (colon) {
            return '<span class="hl-key">' + str + '</span><span class="hl-punct">:</span>';
          }
          return '<span class="hl-string">' + str + '</span>';
        }
        if (/^null$/.test(match)) return '<span class="hl-null">' + match + "</span>";
        if (/true|false/.test(match)) return '<span class="hl-boolean">' + match + "</span>";
        return '<span class="hl-number">' + match + "</span>";
      }
    );
  }

  function highlightJavaScript(text) {
    var out = "";
    var i = 0;
    var len = text.length;
    var keywords = {
      export: 1, default: 1, function: 1, return: 1, const: 1, let: 1, var: 1,
      if: 1, else: 1, for: 1, while: 1, switch: 1, case: 1, break: 1, continue: 1,
      new: 1, typeof: 1, true: 1, false: 1, null: 1, undefined: 1, async: 1, await: 1,
    };

    function append(str, cls) {
      out += cls ? ('<span class="' + cls + '">' + str + "</span>") : escapeHtml(str);
    }

    while (i < len) {
      var ch = text.charAt(i);

      if (ch === "/" && text.charAt(i + 1) === "/") {
        var end = text.indexOf("\n", i);
        if (end < 0) end = len;
        append(text.slice(i, end), "hl-comment");
        i = end;
        continue;
      }
      if (ch === "/" && text.charAt(i + 1) === "*") {
        var endBlock = text.indexOf("*/", i + 2);
        if (endBlock < 0) endBlock = len - 2;
        append(text.slice(i, endBlock + 2), "hl-comment");
        i = endBlock + 2;
        continue;
      }
      if (ch === '"' || ch === "'" || ch === "`") {
        var j = i + 1;
        while (j < len) {
          if (text.charAt(j) === "\\") { j += 2; continue; }
          if (text.charAt(j) === ch) { j++; break; }
          j++;
        }
        append(text.slice(i, j), "hl-string");
        i = j;
        continue;
      }
      if (/[0-9]/.test(ch) || (ch === "-" && /[0-9]/.test(text.charAt(i + 1)))) {
        var k = i + 1;
        while (k < len && /[0-9.eE+-]/.test(text.charAt(k))) k++;
        append(text.slice(i, k), "hl-number");
        i = k;
        continue;
      }
      if (/[A-Za-z_$]/.test(ch)) {
        var w = i + 1;
        while (w < len && /[\w$]/.test(text.charAt(w))) w++;
        var word = text.slice(i, w);
        append(word, keywords[word] ? "hl-keyword" : null);
        i = w;
        continue;
      }

      append(ch, /[{}\[\](),:]/.test(ch) ? "hl-punct" : null);
      i++;
    }
    return out;
  }

  function wrapErrorLineHtml(html, errorLine) {
    if (!errorLine || !errorLine.line) return html;
    var lines = html.split("\n");
    var idx = errorLine.line - 1;
    if (idx >= 0 && idx < lines.length) {
      lines[idx] = '<span class="hl-error-line">' + lines[idx] + "</span>";
    }
    return lines.join("\n");
  }

  function getParseErrorLocation(text, err) {
    if (!err || !text) return null;
    var msg = err.message || String(err);
    var lineMatch = msg.match(/line (\d+)/i);
    var colMatch = msg.match(/column (\d+)/i);
    if (lineMatch) {
      return {
        line: parseInt(lineMatch[1], 10),
        col: colMatch ? parseInt(colMatch[1], 10) : 1,
      };
    }
    var posMatch = msg.match(/position (\d+)/i);
    if (posMatch) {
      var pos = parseInt(posMatch[1], 10);
      var line = 1;
      var col = 1;
      for (var i = 0; i < pos && i < text.length; i++) {
        if (text.charAt(i) === "\n") {
          line++;
          col = 1;
        } else {
          col++;
        }
      }
      return { line: line, col: col };
    }
    return null;
  }

  function parsePreviewTransformError(message, row) {
    var fieldMatch = String(message).match(/field "([^"]+)"/);
    return {
      row: row,
      field: fieldMatch ? fieldMatch[1] : null,
      message: String(message).replace(/^row \d+:\s*/i, ""),
    };
  }

  function previewErrorsForRecord(errors, recordIndex) {
    return (errors || []).filter(function (err) {
      return err.row == null || err.row === recordIndex;
    });
  }

  function previewErrorKeysForRecord(errors, recordIndex) {
    var keys = {};
    previewErrorsForRecord(errors, recordIndex).forEach(function (err) {
      if (!err.field) return;
      keys[err.field] = err.message || "error";
      err.field.split(".").reduce(function (prefix, part) {
        var path = prefix ? prefix + "." + part : part;
        keys[path] = err.message || "error";
        return path;
      }, "");
    });
    return keys;
  }

  function previewLineErrorInfo(line, highlightKeys) {
    var match = line.match(/^\s*"([^"]+)"\s*:/);
    if (!match) return null;
    var key = match[1];
    if (highlightKeys[key]) return { key: key, message: highlightKeys[key] };
    return null;
  }

  function SyntaxEditor(props) {
    var value = props.value;
    var onChange = props.onChange;
    var mode = props.mode;
    var hasError = props.hasError;
    var errorLine = props.errorLine;
    var textareaRef = useRef(null);
    var preRef = useRef(null);

    var highlighted = useMemo(function () {
      var html = mode === "json" ? highlightJson(value) : highlightJavaScript(value);
      return wrapErrorLineHtml(html, errorLine);
    }, [value, mode, errorLine]);

    function syncScroll() {
      if (!textareaRef.current || !preRef.current) return;
      preRef.current.scrollTop = textareaRef.current.scrollTop;
      preRef.current.scrollLeft = textareaRef.current.scrollLeft;
    }

    useEffect(function () {
      syncScroll();
    }, [value, highlighted]);

    return h("div", { className: "syntax-editor" },
      h("pre", {
        ref: preRef,
        className: "syntax-editor-highlight",
        "aria-hidden": "true",
      }, h("code", { dangerouslySetInnerHTML: { __html: highlighted + "\n" } })),
      h("textarea", {
        ref: textareaRef,
        className: "syntax-editor-input code-editor" + (hasError ? " error" : ""),
        value: value,
        onInput: function (e) { onChange(e.target.value); },
        onScroll: syncScroll,
        spellcheck: false,
      })
    );
  }

  function PreviewJsonDisplay(props) {
    var record = props.record;
    var errors = props.errors || [];
    var recordIndex = props.recordIndex || 0;

    if (!record) return null;

    if (record.__transformError) {
      return h("div", { className: "preview-record-error" },
        h("div", { className: "preview-inline-error" },
          h("span", { className: "preview-inline-error-icon" }, "\u26A0"),
          h("span", null, record.__transformError)
        ),
        h("pre", { className: "preview-output preview-output-muted" },
          "// Record " + (recordIndex + 1) + " failed to transform"
        )
      );
    }

    var highlightKeys = previewErrorKeysForRecord(errors, recordIndex);
    var jsonText = JSON.stringify(record, null, 2);
    var lines = jsonText.split("\n");
    var hasInline = Object.keys(highlightKeys).length > 0;

    if (!hasInline) {
      return h("pre", { className: "preview-output" }, jsonText);
    }

    return h("pre", { className: "preview-output preview-output-annotated" },
      lines.map(function (line, i) {
        var info = previewLineErrorInfo(line, highlightKeys);
        return h("div", {
          key: i,
          className: "preview-json-line" + (info ? " preview-line-error" : ""),
          title: info ? info.message : undefined,
        },
          h("span", { className: "preview-line-gutter" }, info ? "\u26A0" : " "),
          h("span", { className: "preview-line-text" }, line || " ")
        );
      })
    );
  }

  function CodeEditor(props) {
    var mode = props.mode; // "json" or "js"
    var value = props.value;
    var onChange = props.onChange;
    var inspection = props.inspection;
    var _useState = useState(""), error = _useState[0], setError = _useState[1];
    var _useState2 = useState(null), errorLine = _useState2[0], setErrorLine = _useState2[1];
    var _useState3 = useState([]), warnings = _useState3[0], setWarnings = _useState3[1];

    function validateText(text) {
      if (!text || !String(text).trim()) {
        setError("");
        setErrorLine(null);
        setWarnings([]);
        return;
      }
      if (mode === "json") {
        JSON.parse(text);
      } else if (MF && MF.parseMappingModule) {
        MF.parseMappingModule(text);
      } else {
        new Function("return (" + text + ")")();
      }
      setError("");
      setErrorLine(null);
      setWarnings(collectSemanticWarnings(text, mode, inspection));
    }

    function collectSemanticWarnings(text, editorMode, insp) {
      if (!insp || !MF) return [];
      var mapping;
      try {
        mapping = editorMode === "json" ? JSON.parse(text) : MF.parseMappingModule(text);
      } catch (e) {
        return [];
      }
      if (!mapping || !mapping.fields) return [];
      var known = insp.fields || {};
      var warns = [];
      function checkFrom(path, target) {
        if (!path || known[path]) return;
        warns.push('Source path "' + path + '" for "' + target + '" not found in loaded data');
      }
      function walkFields(fields, prefix) {
        Object.keys(fields || {}).forEach(function (target) {
          var def = fields[target];
          if (!def || typeof def !== "object") return;
          if (def.from) {
            if (Array.isArray(def.from)) def.from.forEach(function (p) { checkFrom(p, target); });
            else checkFrom(def.from, target);
          }
          if (def.fields) walkFields(def.fields, prefix ? prefix + "." + target : target);
        });
      }
      walkFields(mapping.fields, "");
      return warns.slice(0, 8);
    }

    useEffect(function () {
      try {
        validateText(value);
      } catch (e) {
        setError(e.message);
        setErrorLine(getParseErrorLocation(value, e));
        setWarnings([]);
      }
    }, [value, mode, inspection]);

    function handleChange(text) {
      onChange(text);
      try {
        validateText(text);
      } catch (e) {
        setError(e.message);
        setErrorLine(getParseErrorLocation(text, e));
        setWarnings([]);
      }
    }

    function formatJson() {
      try {
        var parsed = JSON.parse(value);
        var formatted = JSON.stringify(parsed, null, 2);
        handleChange(formatted);
      } catch (e) {
        setError("Cannot format: " + e.message);
        setErrorLine(getParseErrorLocation(value, e));
      }
    }

    function formatJs() {
      if (!MF) return;
      try {
        var parsed = MF.parseMappingModule(value);
        handleChange(MF.formatMappingAsModule(parsed, true));
      } catch (e) {
        setError("Cannot format: " + e.message);
        setErrorLine(getParseErrorLocation(value, e));
      }
    }

    return h("div", { className: "code-editor-wrap" },
      props.fieldSummary && props.fieldSummary.length
        ? h(MappingFieldOutline, { summary: props.fieldSummary })
        : null,
      h("div", { className: "flex justify-between items-center mb-1" },
        h("span", { className: "font-bold text-sm" }, mode === "json" ? "JSON Mapping" : "JS Mapping"),
        h("div", { className: "flex gap-1" },
          h("button", {
            type: "button",
            className: "btn btn-sm btn-secondary",
            onClick: mode === "json" ? formatJson : formatJs,
          }, "Format"),
          h("button", {
            type: "button",
            className: "btn btn-sm btn-secondary",
            onClick: function () { copyToClipboard(value); },
          }, "Copy")
        )
      ),
      h(SyntaxEditor, {
        value: value,
        onChange: handleChange,
        mode: mode,
        hasError: !!error,
        errorLine: errorLine,
      }),
      error ? h("div", { className: "validation-error" },
        "\u26A0 " + error +
        (errorLine ? " (line " + errorLine.line + (errorLine.col ? ", column " + errorLine.col : "") + ")" : "")
      ) : null,
      !error && warnings.length ? h("div", { className: "validation-warning" },
        warnings.map(function (w, i) {
          return h("div", { key: i, className: "validation-warning-line" }, "\u26A0 " + w);
        })
      ) : null,
      !error && !warnings.length && value.trim()
        ? h("div", { className: "validation-ok" }, "\u2713 Valid " + mode.toUpperCase())
        : null
    );
  }

  // ── Preview Panel ──────────────────────────────────────────────────

  function PreviewPanel(props) {
    var output = props.output;
    var errors = props.errors;
    var expectedOutput = props.expectedOutput;
    var previewLimit = props.previewLimit;
    var onPreviewLimitChange = props.onPreviewLimitChange;
    var onClearPreview = props.onClearPreview;
    var onLoadExpected = props.onLoadExpected;
    var _useState = useState(0), recordIndex = _useState[0], setRecordIndex = _useState[1];
    var _useState2 = useState(false), showDiff = _useState2[0], setShowDiff = _useState2[1];

    var totalRecords = Array.isArray(output) ? output.length : (output ? 1 : 0);

    useEffect(function () {
      setRecordIndex(0);
    }, [output, totalRecords]);

    function getDisplayRecord() {
      if (!output) return null;
      if (Array.isArray(output)) {
        return output[recordIndex] || output[0];
      }
      return output;
    }

    function getExpectedRecord() {
      if (!expectedOutput) return null;
      if (Array.isArray(expectedOutput)) {
        return expectedOutput[recordIndex] || expectedOutput[0];
      }
      return expectedOutput;
    }

    var actual = getDisplayRecord();
    var expected = getExpectedRecord();
    var diffLines = showDiff && expected != null && actual != null && MF
      ? MF.diffRecords(expected, actual)
      : null;

    return h("div", {
      className: "panel panel-preview" + (props.collapsed ? " panel-collapsed" : ""),
      style: props.collapsed ? undefined : props.panelStyle,
    },
      h(PanelCollapseHeader, {
        collapsed: props.collapsed,
        title: "Preview",
        shortTitle: "Prev",
        onToggle: props.onToggleCollapse,
        meta: props.collapsed ? null : (
          errors && errors.length > 0
            ? h("span", { className: "text-sm panel-header-meta", style: { color: "var(--danger)" } }, errors.length + " err")
            : h("span", { className: "text-sm text-muted panel-header-meta" }, totalRecords + " shown")
        ),
      }),
      h("div", { className: "preview-controls" },
        h("label", { className: "text-sm" }, "Records:"),
        h("input", {
          type: "number",
          className: "preview-limit-input",
          min: 1,
          max: 1000,
          value: previewLimit,
          onInput: function (e) { onPreviewLimitChange(Math.max(1, parseInt(e.target.value, 10) || 5)); },
        }),
        h("button", { type: "button", className: "btn btn-sm btn-secondary", onClick: onLoadExpected }, "Load expected"),
        expectedOutput ? h("button", {
          type: "button",
          className: "btn btn-sm " + (showDiff ? "btn-primary" : "btn-secondary"),
          onClick: function () { setShowDiff(!showDiff); },
        }, "Diff") : null,
        h("button", { type: "button", className: "btn btn-sm btn-secondary", onClick: onClearPreview }, "Clear")
      ),
      Array.isArray(output) && output.length > 1 ? h("div", { className: "preview-record-nav" },
        h("button", { type: "button", className: "btn btn-sm btn-secondary", onClick: function () { setRecordIndex(function (i) { return Math.max(0, i - 1); }); }, disabled: recordIndex === 0 }, "\u25C0"),
        h("span", { className: "preview-record-count" }, "Record " + (recordIndex + 1) + " / " + output.length),
        h("button", { type: "button", className: "btn btn-sm btn-secondary", onClick: function () { setRecordIndex(function (i) { return Math.min(output.length - 1, i + 1); }); }, disabled: recordIndex >= output.length - 1 }, "\u25B6")
      ) : null,
      h("div", { className: "panel-body" },
        showDiff && diffLines ? h("div", { className: "preview-diff" },
          diffLines.map(function (line, i) {
            return h("div", { key: i, className: "diff-line diff-" + line.type }, line.text);
          })
        ) : output ? h(PreviewJsonDisplay, {
          record: actual,
          errors: errors,
          recordIndex: recordIndex,
        })
          : h("div", { className: "empty-state" },
              h("div", { className: "empty-state-icon" }, "\uD83D\uDCC1"),
              h("div", { className: "empty-state-text" }, "No output yet"),
              h("div", { className: "empty-state-text" }, "Load data and create a mapping")
            ),
        errors && errors.length > 0 ? h("div", { className: "preview-errors" },
          h("div", { className: "font-bold text-sm mb-1" }, "Errors"),
          errors.map(function (err, i) {
            var canJump = err.row != null && Array.isArray(output) && output.length > 1;
            return h("button", {
              key: i,
              type: "button",
              className: "preview-error-item" + (canJump ? " preview-error-clickable" : ""),
              disabled: !canJump,
              onClick: canJump ? function () { setRecordIndex(err.row); } : undefined,
              title: canJump ? "Jump to record " + (err.row + 1) : undefined,
            },
              (err.row != null ? "Record " + (err.row + 1) + ": " : "") +
              (err.field ? err.field + " — " : "") +
              (err.message || "error")
            );
          })
        ) : null
      )
    );
  }

  // ── Data Inspector ─────────────────────────────────────────────────

  function DataInspector(props) {
    var inspection = props.inspection;
    if (!inspection) return null;

    return h("div", { className: "inspector" },
      h("div", { className: "inspector-stat" },
        h("span", { className: "inspector-stat-label" }, "Records"),
        h("span", { className: "inspector-stat-value" }, inspection.recordCount)
      ),
      h("div", { className: "inspector-stat" },
        h("span", { className: "inspector-stat-label" }, "Fields"),
        h("span", { className: "inspector-stat-value" }, Object.keys(inspection.fields || {}).length)
      ),
      Object.entries(inspection.fields || {}).slice(0, 10).map(function (_a) {
        var field = _a[0], info = _a[1];
        return h("div", { key: field, className: "inspector-stat" },
          h("span", { className: "inspector-stat-label font-mono" }, field),
          h("span", { className: "inspector-stat-value" }, info.type + (info.min !== undefined ? " [" + info.min + "-" + info.max + "]" : ""))
        );
      })
    );
  }

  // ── Wizard helpers (steps, forEach / nested sub-mapping) ───────────

  function buildWizardSteps(inspection) {
    if (!inspection || !inspection.fields) return [];
    var allFields = Object.keys(inspection.fields);
    var arrayRoots = {};
    allFields.forEach(function (f) {
      if (f.indexOf(".") < 0 && inspection.fields[f].type === "array") {
        arrayRoots[f] = allFields.filter(function (x) { return x.indexOf(f + ".") === 0; });
      }
    });

    var nestedRoots = {};
    allFields.forEach(function (f) {
      if (f.indexOf(".") < 0) return;
      var root = f.split(".")[0];
      if (arrayRoots[root]) return;
      if (!nestedRoots[root]) nestedRoots[root] = [];
      nestedRoots[root].push(f);
    });

    var subToArrayRoot = {};
    Object.keys(arrayRoots).forEach(function (root) {
      arrayRoots[root].forEach(function (sub) { subToArrayRoot[sub] = root; });
    });

    var nestedEmitted = {};
    var consumed = {};
    var steps = [];

    allFields.forEach(function (f) {
      if (consumed[f]) return;

      if (subToArrayRoot[f]) return;

      if (arrayRoots[f] !== undefined) {
        arrayRoots[f].forEach(function (sub) { consumed[sub] = true; });
        consumed[f] = true;
        steps.push({
          kind: "forEach",
          field: f,
          subFieldPaths: arrayRoots[f],
        });
        return;
      }

      if (f.indexOf(".") >= 0) {
        var root = f.split(".")[0];
        if (arrayRoots[root]) {
          consumed[f] = true;
          return;
        }
        var group = nestedRoots[root];
        if (group && !nestedEmitted[root]) {
          nestedEmitted[root] = true;
          group.forEach(function (sub) { consumed[sub] = true; });
          steps.push({
            kind: "nested",
            parent: root,
            field: root,
            subFieldPaths: group,
          });
        }
        return;
      }

      consumed[f] = true;
      steps.push({ kind: "simple", field: f });
    });

    return steps;
  }

  function relativeSubSource(parentKind, parentField, subPath) {
    if (parentKind === "forEach") {
      return subPath.slice(parentField.length + 1);
    }
    return subPath;
  }

  function inferSubFieldTarget(subPath) {
    var leaf = subPath.split(".").pop() || subPath;
    return JsonTransformer.toCamelCase(leaf);
  }

  function defaultNestedAnswers(stepDef, inspection) {
    var parentKind = stepDef.kind;
    var parentField = stepDef.field || stepDef.parent;
    return (stepDef.subFieldPaths || []).map(function (subPath) {
      var inf = JsonTransformer.inferFieldDefaults(inspection, subPath);
      return {
        field: subPath,
        action: "accept",
        source: relativeSubSource(parentKind, parentField, subPath),
        target: inferSubFieldTarget(subPath),
        type: inf.type,
        format: inf.format,
      };
    });
  }

  function buildSubFieldsMap(nestedAnswers, parentKind, parentField) {
    var sub = {};
    (nestedAnswers || []).forEach(function (a) {
      if (a.action === "skip") return;
      var target = a.target || inferSubFieldTarget(a.field);
      var def = {
        from: a.source || relativeSubSource(parentKind, parentField, a.field),
      };
      if (a.type && a.type !== "auto") def.type = a.type;
      if (a.format) def.format = a.format;
      if (a.outputFormat) def.outputFormat = a.outputFormat;
      if (a.precision !== "" && a.precision != null && !isNaN(Number(a.precision))) {
        def.precision = Number(a.precision);
      }
      if (a.default !== undefined) def.default = a.default;
      sub[target] = def;
    });
    return sub;
  }

  function buildMappingFromAnswers(ans, pt, inspection) {
    var fields = {};
    (ans || []).forEach(function (a) {
      if (a.action === "skip") return;
      if (a.kind === "forEach") {
        var feTarget = a.target || a.field;
        var nested = a.nestedAnswers && a.nestedAnswers.length
          ? a.nestedAnswers
          : defaultNestedAnswers({ kind: "forEach", field: a.field, subFieldPaths: [] }, inspection);
        fields[feTarget] = {
          forEach: a.forEachPath || a.field,
          fields: buildSubFieldsMap(
            a.nestedAnswers && a.nestedAnswers.length ? a.nestedAnswers : nested,
            "forEach",
            a.field
          ),
        };
        return;
      }
      if (a.kind === "nested") {
        var nestTarget = a.target || a.parent || a.field;
        fields[nestTarget] = {
          fields: buildSubFieldsMap(a.nestedAnswers || [], "nested", nestTarget),
        };
        return;
      }
      var target = a.target || JsonTransformer.toCamelCase(a.field.replace(/\./g, "_"));
      var fieldDef = { from: a.source || a.field };
      if (a.type && a.type !== "auto") fieldDef.type = a.type;
      if (a.format) fieldDef.format = a.format;
      if (a.outputFormat) fieldDef.outputFormat = a.outputFormat;
      if (a.precision !== "" && a.precision != null && !isNaN(Number(a.precision))) {
        fieldDef.precision = Number(a.precision);
      }
      if (a.default !== undefined) fieldDef.default = a.default;
      fields[target] = fieldDef;
    });
    var mapping = { fields: fields };
    if (pt) mapping.passthrough = true;
    return mapping;
  }

  function wizardStepLabel(stepDef) {
    if (stepDef.kind === "forEach") return stepDef.field + " (array)";
    if (stepDef.kind === "nested") return stepDef.parent + " (nested object)";
    return stepDef.field;
  }

  function wizardResolvedFormat(answer, fieldPath, inspection) {
    if (answer && Object.prototype.hasOwnProperty.call(answer, "format")) {
      return answer.format || "";
    }
    var inf = JsonTransformer.inferFieldDefaults(inspection, fieldPath);
    return inf.format || "";
  }

  function wizardFormatSelect(props) {
    var options = [
      { value: "", label: "None" },
      { value: "uppercase", label: "Uppercase" },
      { value: "lowercase", label: "Lowercase" },
      { value: "titlecase", label: "Title Case" },
      { value: "trim", label: "Trim" },
      { value: "number", label: "Number" },
      { value: "date", label: "Date" },
    ];
    return h("select", {
      id: props.id,
      className: "mapping-field-input wizard-format-select",
      value: props.value || "",
      disabled: props.disabled,
      title: props.title || "Output format",
      onChange: props.onChange,
    }, options.map(function (opt) {
      return h("option", { key: opt.value, value: opt.value }, opt.label);
    }));
  }

  // ── Swagger / JSON Schema Import ──────────────────────────────────

  function schemaToVisualFields(schema) {
    if (!MF || !schema || !schema.properties) return [];
    return Object.keys(schema.properties).map(function (key) {
      var prop = schema.properties[key];
      if (!prop) return MF.defaultVisualField({ target: key, kind: "simple" });
      if (prop.type === "object" && prop.properties) {
        var childFields = schemaToVisualFields(prop);
        return MF.defaultVisualField({
          target: key,
          kind: "nested",
          nestedFields: childFields.length ? childFields : [MF.defaultVisualField({ target: "field", kind: "simple" })],
        });
      }
      if (prop.type === "array" && prop.items && prop.items.properties) {
        var itemFields = schemaToVisualFields(prop.items);
        return MF.defaultVisualField({
          target: key,
          kind: "forEach",
          forEachPath: "",
          nestedFields: itemFields.length ? itemFields : [MF.defaultVisualField({ target: "item", kind: "simple" })],
        });
      }
      var typeHint = "auto";
      if (prop.type === "integer" || prop.type === "number") typeHint = "number";
      else if (prop.type === "boolean") typeHint = "boolean";
      else if (prop.type === "string") typeHint = "string";
      return MF.defaultVisualField({ target: key, kind: "simple", type: typeHint });
    });
  }

  function getOpenApiSchemas(doc) {
    if (doc.components && doc.components.schemas && Object.keys(doc.components.schemas).length) {
      return doc.components.schemas;
    }
    if (doc.definitions && Object.keys(doc.definitions).length) {
      return doc.definitions;
    }
    return null;
  }

  function sampleJsonToVisualFields(data) {
    if (!MF) return [];
    var obj = Array.isArray(data) ? data[0] : data;
    if (!obj || typeof obj !== "object" || Array.isArray(obj)) return [];
    return Object.keys(obj).map(function (key) {
      var val = obj[key];
      if (val !== null && typeof val === "object" && !Array.isArray(val)) {
        var childFields = sampleJsonToVisualFields(val);
        return MF.defaultVisualField({
          target: key,
          kind: "nested",
          nestedFields: childFields.length ? childFields : [MF.defaultVisualField({ target: "field", kind: "simple" })],
        });
      }
      if (Array.isArray(val)) {
        var first = val[0];
        if (first !== null && first !== undefined && typeof first === "object" && !Array.isArray(first)) {
          var itemFields = sampleJsonToVisualFields(first);
          return MF.defaultVisualField({
            target: key,
            kind: "forEach",
            forEachPath: "",
            nestedFields: itemFields.length ? itemFields : [MF.defaultVisualField({ target: "item", kind: "simple" })],
          });
        }
        return MF.defaultVisualField({ target: key, kind: "simple" });
      }
      var typeHint = "auto";
      if (typeof val === "number") typeHint = "number";
      else if (typeof val === "boolean") typeHint = "boolean";
      else if (typeof val === "string") typeHint = "string";
      return MF.defaultVisualField({ target: key, kind: "simple", type: typeHint });
    });
  }

  function SwaggerSchemaModal(props) {
    var open = props.open;
    var onClose = props.onClose;
    var onApply = props.onApply;

    var _s0 = useState("schema"), inputMode = _s0[0], setInputMode = _s0[1];
    var _s1 = useState(""), pastedText = _s1[0], setPastedText = _s1[1];
    var _s2 = useState(null), parsed = _s2[0], setParsed = _s2[1];
    var _s3 = useState(""), parseError = _s3[0], setParseError = _s3[1];
    var _s4 = useState(""), selectedName = _s4[0], setSelectedName = _s4[1];
    var _s5 = useState("replace"), applyMode = _s5[0], setApplyMode = _s5[1];

    useEffect(function () {
      if (open) {
        setInputMode("schema"); setPastedText(""); setParsed(null); setParseError(""); setSelectedName(""); setApplyMode("replace");
      }
    }, [open]);

    if (!open) return null;

    function switchInputMode(m) {
      setInputMode(m); setPastedText(""); setParsed(null); setParseError("");
    }

    function handleParse() {
      setParseError(""); setParsed(null);
      var trimmed = pastedText.trim();
      if (!trimmed) { setParseError("Paste " + (inputMode === "sample" ? "a JSON object or array" : "a schema") + " first."); return; }
      var doc;
      try { doc = JSON.parse(trimmed); } catch (e) { setParseError("Invalid JSON: " + e.message); return; }

      if (inputMode === "sample") {
        var sampleObj = Array.isArray(doc) ? doc[0] : doc;
        if (!sampleObj || typeof sampleObj !== "object" || Array.isArray(sampleObj)) {
          setParseError("Expected a JSON object or an array of objects.");
          return;
        }
        var fields = sampleJsonToVisualFields(doc);
        if (!fields.length) { setParseError("No keys found in the sample JSON."); return; }
        setParsed({ kind: "sample", fields: fields });
        return;
      }

      // Schema / OpenAPI mode
      var schemas = getOpenApiSchemas(doc);
      if (schemas) {
        var names = Object.keys(schemas);
        setParsed({ kind: "openapi", schemas: schemas, names: names });
        setSelectedName(names[0]);
        return;
      }

      var schemaObj = (doc.type === "object" || doc.properties) ? doc : null;
      if (!schemaObj) {
        setParseError("Could not detect schema. Expected a JSON Schema object with 'properties', or a full OpenAPI/Swagger document.");
        return;
      }
      var schemaFields = schemaToVisualFields(schemaObj);
      if (!schemaFields.length) { setParseError("No properties found in this schema."); return; }
      setParsed({ kind: "schema", fields: schemaFields });
    }

    var previewFields = null;
    if (parsed) {
      if (parsed.kind === "openapi" && selectedName && parsed.schemas[selectedName]) {
        previewFields = schemaToVisualFields(parsed.schemas[selectedName]);
      } else if (parsed.kind === "schema" || parsed.kind === "sample") {
        previewFields = parsed.fields;
      }
    }

    function handleApply() {
      if (!previewFields || !previewFields.length) return;
      onApply(previewFields, applyMode);
    }

    var tabStyle = { padding: "6px 14px", border: "1px solid var(--border-color)", cursor: "pointer", fontSize: "13px", background: "var(--bg-secondary)", color: "var(--text-primary)" };
    var tabActiveStyle = Object.assign({}, tabStyle, { background: "var(--accent)", color: "#fff", borderColor: "var(--accent)" });
    var placeholder = inputMode === "sample"
      ? '{\n  "id": "abc123",\n  "name": "Alice",\n  "age": 30,\n  "address": { "city": "SF", "zip": "94102" }\n}'
      : '{\n  "type": "object",\n  "properties": {\n    "id": { "type": "string" },\n    "name": { "type": "string" }\n  }\n}';

    return h("div", { className: "modal-overlay", onClick: function (e) { if (e.target === e.currentTarget) onClose(); } },
      h("div", { className: "modal", style: { minWidth: "520px", maxWidth: "640px" } },
        h("div", { className: "modal-header" },
          h("span", { className: "modal-title" }, "Generate Fields from Schema"),
          h("button", { type: "button", className: "btn btn-icon btn-secondary", onClick: onClose }, "✕")
        ),
        h("div", { className: "modal-body" },
          h("div", { style: { display: "flex", marginBottom: "14px", borderRadius: "var(--radius)", overflow: "hidden", border: "1px solid var(--border-color)", width: "fit-content" } },
            h("button", { type: "button", style: inputMode === "schema" ? tabActiveStyle : tabStyle, onClick: function () { switchInputMode("schema"); } }, "Swagger / JSON Schema"),
            h("button", { type: "button", style: inputMode === "sample" ? tabActiveStyle : tabStyle, onClick: function () { switchInputMode("sample"); } }, "Sample JSON")
          ),
          h("p", { className: "text-sm text-muted", style: { marginBottom: "12px" } },
            inputMode === "sample"
              ? "Paste a sample JSON request or response object. Fields are inferred from the keys and value types — fill in the source paths in the Visual editor afterward."
              : "Paste a JSON Schema object or a full OpenAPI/Swagger document. Target fields are generated from the schema properties."
          ),
          h("label", { className: "form-label" }, inputMode === "sample" ? "Sample JSON" : "Schema JSON"),
          h("textarea", {
            style: {
              width: "100%", height: "180px", fontFamily: "monospace", fontSize: "12px",
              boxSizing: "border-box", padding: "8px", border: "1px solid var(--border-color)",
              borderRadius: "var(--radius)", background: "var(--bg-secondary)", color: "var(--text-primary)",
              resize: "vertical",
            },
            placeholder: placeholder,
            value: pastedText,
            onInput: function (e) { setPastedText(e.target.value); setParsed(null); setParseError(""); },
            spellcheck: false,
          }),
          h("button", {
            type: "button", className: "btn btn-secondary", style: { marginTop: "8px" }, onClick: handleParse,
          }, inputMode === "sample" ? "Parse Sample" : "Parse Schema"),

          parseError ? h("div", { className: "validation-error", style: { marginTop: "8px" } }, parseError) : null,

          parsed && parsed.kind === "openapi" ? h("div", { style: { marginTop: "14px" } },
            h("label", { className: "form-label" }, parsed.names.length + " schema" + (parsed.names.length !== 1 ? "s" : "") + " found — select one:"),
            h("select", {
              className: "mapping-field-input",
              value: selectedName,
              onChange: function (e) { setSelectedName(e.target.value); },
              style: { width: "100%", marginTop: "4px" },
            }, parsed.names.map(function (n) { return h("option", { key: n, value: n }, n); }))
          ) : null,

          previewFields && previewFields.length ? h("div", { style: { marginTop: "14px" } },
            h("div", { className: "form-label" }, previewFields.length + " target field" + (previewFields.length !== 1 ? "s" : "") + " to create:"),
            h("ul", { style: { margin: "6px 0 0 18px", fontSize: "13px", lineHeight: "1.9" } },
              previewFields.map(function (f, i) {
                var badge = f.kind === "nested" ? " — nested object" : f.kind === "forEach" ? " — array (forEach)" : "";
                return h("li", { key: i }, h("code", null, f.target), badge);
              })
            )
          ) : null,

          parsed ? h("div", { style: { marginTop: "16px", paddingTop: "12px", borderTop: "1px solid var(--border-color)" } },
            h("div", { className: "form-label" }, "Apply mode:"),
            h("div", { style: { display: "flex", gap: "20px", marginTop: "6px" } },
              [["replace", "Replace existing fields"], ["append", "Append to existing fields"]].map(function (pair) {
                return h("label", { key: pair[0], style: { display: "flex", alignItems: "center", gap: "6px", cursor: "pointer", fontSize: "13px" } },
                  h("input", { type: "radio", name: "schema-apply-mode", value: pair[0], checked: applyMode === pair[0], onChange: function () { setApplyMode(pair[0]); } }),
                  pair[1]
                );
              })
            )
          ) : null
        ),
        h("div", { className: "modal-footer" },
          h("button", { type: "button", className: "btn btn-secondary", onClick: onClose }, "Cancel"),
          h("button", {
            type: "button",
            className: "btn btn-primary",
            onClick: handleApply,
            disabled: !previewFields || !previewFields.length,
          }, "Apply " + (previewFields ? previewFields.length : 0) + " Field" + (previewFields && previewFields.length !== 1 ? "s" : ""))
        )
      )
    );
  }

  // ── Wizard Modal ───────────────────────────────────────────────────

  function WizardModal(props) {
    var open = props.open;
    var onClose = props.onClose;
    var data = props.data;
    var inspection = props.inspection;
    var onComplete = props.onComplete;

    var wizardSteps = useMemo(function () {
      return buildWizardSteps(inspection);
    }, [inspection]);

    var _useState = useState(0), step = _useState[0], setStep = _useState[1];
    var _useState2 = useState([]), answers = _useState2[0], setAnswers = _useState2[1];
    var _useState3 = useState(false), passthrough = _useState3[0], setPassthrough = _useState3[1];

    var fieldStepCount = wizardSteps.length;
    var reviewStep = fieldStepCount + 1;
    var previewStep = fieldStepCount + 2;
    var totalSteps = fieldStepCount + 3;

    useEffect(function () {
      if (open) {
        setStep(0);
        setAnswers([]);
        setPassthrough(false);
      }
    }, [open]);

    if (!open) return null;

    function getAnswerForStep(stepDef) {
      var key = stepDef.kind === "nested" ? stepDef.parent : stepDef.field;
      return answers.find(function (a) {
        return a.kind === stepDef.kind && (a.field === key || a.parent === key);
      });
    }

    function saveStepAnswer(stepDef, patch) {
      var key = stepDef.kind === "nested" ? stepDef.parent : stepDef.field;
      var newAnswers = answers.slice();
      var idx = newAnswers.findIndex(function (a) {
        return a.kind === stepDef.kind && (a.field === key || a.parent === key);
      });
      var base = {
        kind: stepDef.kind,
        field: stepDef.field || stepDef.parent,
        parent: stepDef.parent,
        action: "accept",
      };
      if (idx >= 0) {
        newAnswers[idx] = Object.assign({}, newAnswers[idx], patch);
      } else {
        newAnswers.push(Object.assign(base, patch));
      }
      setAnswers(newAnswers);
    }

    function acceptAllRemaining(fromIndex) {
      var newAnswers = answers.slice();
      for (var i = fromIndex; i < wizardSteps.length; i++) {
        var stepDef = wizardSteps[i];
        var key = stepDef.kind === "nested" ? stepDef.parent : stepDef.field;
        if (newAnswers.find(function (a) {
          return a.kind === stepDef.kind && (a.field === key || a.parent === key);
        })) continue;

        if (stepDef.kind === "forEach") {
          newAnswers.push({
            kind: "forEach",
            field: stepDef.field,
            action: "accept",
            target: JsonTransformer.toCamelCase(stepDef.field),
            forEachPath: stepDef.field,
            nestedAnswers: defaultNestedAnswers(stepDef, inspection),
          });
        } else if (stepDef.kind === "nested") {
          newAnswers.push({
            kind: "nested",
            field: stepDef.parent,
            parent: stepDef.parent,
            action: "accept",
            target: JsonTransformer.toCamelCase(stepDef.parent),
            nestedAnswers: defaultNestedAnswers(stepDef, inspection),
          });
        } else {
          var inferred = JsonTransformer.inferFieldDefaults(inspection, stepDef.field);
          newAnswers.push({
            kind: "simple",
            field: stepDef.field,
            action: "accept",
            source: stepDef.field,
            target: inferred.targetField,
            type: inferred.type,
            format: inferred.format,
          });
        }
      }
      setAnswers(newAnswers);
      showToast("Defaults applied to remaining fields", "success", 2500);
    }

    function handleNext() {
      if (step >= 1 && step <= fieldStepCount) {
        var stepDef = wizardSteps[step - 1];
        var ans = getAnswerForStep(stepDef);
        if (!ans || ans.action !== "skip") {
          if (stepDef.kind === "forEach") {
            if (!ans) {
              saveStepAnswer(stepDef, {
                action: "accept",
                target: JsonTransformer.toCamelCase(stepDef.field),
                forEachPath: stepDef.field,
                nestedAnswers: stepDef.subFieldPaths.length
                  ? defaultNestedAnswers(stepDef, inspection)
                  : [],
              });
            } else if (!ans.target || !String(ans.target).trim()) {
              showToast("Enter a destination name for the array output", "warning");
              return;
            } else if (stepDef.subFieldPaths.length && (!ans.nestedAnswers || !ans.nestedAnswers.length)) {
              saveStepAnswer(stepDef, {
                nestedAnswers: defaultNestedAnswers(stepDef, inspection),
              });
            }
          } else if (stepDef.kind === "nested") {
            if (!ans) {
              saveStepAnswer(stepDef, {
                action: "accept",
                target: JsonTransformer.toCamelCase(stepDef.parent),
                nestedAnswers: defaultNestedAnswers(stepDef, inspection),
              });
            } else if (!ans.target || !String(ans.target).trim()) {
              showToast("Enter a destination name for the nested object", "warning");
              return;
            } else if (!ans.nestedAnswers || !ans.nestedAnswers.length) {
              saveStepAnswer(stepDef, {
                nestedAnswers: defaultNestedAnswers(stepDef, inspection),
              });
            }
          } else {
            var inf = JsonTransformer.inferFieldDefaults(inspection, stepDef.field);
            if (!ans) {
              saveStepAnswer(stepDef, {
                kind: "simple",
                action: "accept",
                source: stepDef.field,
                target: inf.targetField,
                type: inf.type,
                format: inf.format,
              });
            } else if (!ans.target || !String(ans.target).trim()) {
              showToast("Enter a destination field name or skip this field", "warning");
              return;
            }
          }
        }
      }
      if (step < previewStep) {
        setStep(step + 1);
      } else {
        var mapping = buildMappingFromAnswers(answers, passthrough, inspection);
        onComplete(mapping, passthrough);
        onClose();
      }
    }

    function handleBack() {
      setStep(Math.max(0, step - 1));
    }

    function updateNestedAnswer(stepDef, subPath, patch) {
      var ans = getAnswerForStep(stepDef) || {};
      var nested = (ans.nestedAnswers || []).slice();
      var ni = nested.findIndex(function (a) { return a.field === subPath; });
      var inf = JsonTransformer.inferFieldDefaults(inspection, subPath);
      var base = {
        field: subPath,
        action: "accept",
        source: relativeSubSource(stepDef.kind, stepDef.field || stepDef.parent, subPath),
        target: inferSubFieldTarget(subPath),
        type: inf.type,
        format: inf.format,
      };
      if (ni >= 0) {
        nested[ni] = Object.assign({}, nested[ni], patch);
      } else {
        nested.push(Object.assign(base, patch));
      }
      saveStepAnswer(stepDef, { nestedAnswers: nested, action: "accept" });
    }

    function renderSubFieldEditor(stepDef) {
      if (!stepDef.subFieldPaths || !stepDef.subFieldPaths.length) {
        return h("p", { className: "text-sm text-muted" }, "No object fields detected in sample data.");
      }
      var ans = getAnswerForStep(stepDef);
      return h("div", { className: "wizard-subfields" },
        h("div", { className: "wizard-subfields-title" },
          stepDef.kind === "forEach" ? "Map each array item" : "Map nested fields"
        ),
        h("div", { className: "wizard-subfield-header" },
          h("span", null, "Source"),
          h("span", null, "Destination"),
          h("span", null, "Format"),
          h("span", { className: "wizard-subfield-header-action" }, "")
        ),
        stepDef.subFieldPaths.map(function (subPath) {
          var subAns = ans && ans.nestedAnswers
            ? ans.nestedAnswers.find(function (a) { return a.field === subPath; })
            : null;
          var isSubSkipped = subAns && subAns.action === "skip";
          var relSource = relativeSubSource(stepDef.kind, stepDef.field || stepDef.parent, subPath);
          var dest = isSubSkipped ? "" : ((subAns && subAns.target) || inferSubFieldTarget(subPath));
          var subFormat = wizardResolvedFormat(subAns, subPath, inspection);
          var displayFormat = subAns && subAns.format === "round" ? "number" : subFormat;
          return h("div", { key: subPath, className: "wizard-subfield-block" },
            h("div", { className: "wizard-subfield-row" },
              h("div", { className: "wizard-subfield-source" },
                h("span", { className: "font-mono text-sm", title: subPath }, relSource)
              ),
              h("input", {
                className: "mapping-field-input",
                type: "text",
                value: dest,
                disabled: isSubSkipped,
                placeholder: "output_field",
                onInput: function (e) {
                  updateNestedAnswer(stepDef, subPath, {
                    action: "accept",
                    target: e.target.value.trim(),
                  });
                },
              }),
              wizardFormatSelect({
                value: displayFormat,
                disabled: isSubSkipped,
                onChange: function (e) {
                  var fmt = e.target.value || null;
                  var patch = { action: "accept", format: fmt };
                  if (fmt === "date") patch.outputFormat = (subAns && subAns.outputFormat) || "YYYY-MM-DD";
                  if (fmt === "number" && MF) Object.assign(patch, MF.applyNumberFormatUi("plain"));
                  if (fmt !== "number" && fmt !== "round") patch.precision = "";
                  updateNestedAnswer(stepDef, subPath, patch);
                },
              }),
              h("button", {
                type: "button",
                className: "btn btn-sm btn-secondary",
                title: isSubSkipped ? "Include sub-field" : "Skip sub-field",
                onClick: function () {
                  updateNestedAnswer(stepDef, subPath, {
                    action: isSubSkipped ? "accept" : "skip",
                    target: inferSubFieldTarget(subPath),
                  });
                },
              }, isSubSkipped ? "Undo" : "Skip")
            ),
            !isSubSkipped && (displayFormat === "date" || displayFormat === "number" || (subAns && subAns.format === "round"))
              ? h(FormatOptionExtras, {
                field: {
                  format: (subAns && subAns.format) || displayFormat,
                  outputFormat: subAns && subAns.outputFormat,
                  precision: subAns && subAns.precision,
                },
                compact: true,
                onPatch: function (patch) {
                  updateNestedAnswer(stepDef, subPath, Object.assign({ action: "accept" }, patch));
                },
              })
              : null
          );
        }),
        h("button", {
          type: "button",
          className: "btn btn-sm btn-secondary mt-1",
          onClick: function () {
            saveStepAnswer(stepDef, {
              action: "accept",
              nestedAnswers: defaultNestedAnswers(stepDef, inspection),
            });
            showToast("Sub-field defaults applied", "info", 2000);
          },
        }, "Use defaults for all sub-fields")
      );
    }

    function renderStep() {
      if (step === 0) {
        return h("div", null,
          h("h3", { className: "mb-2" }, "Welcome to the Mapping Wizard"),
          h("p", { className: "mb-2" }, "This wizard will guide you through creating a mapping for your data."),
          h("p", { className: "mb-2" },
            "You have " + inspection.recordCount + " records with " + fieldStepCount + " mapping step" +
            (fieldStepCount === 1 ? "" : "s") + " (arrays and nested objects are grouped)."
          ),
          h("label", { className: "flex items-center gap-2" },
            h("input", {
              type: "checkbox",
              checked: passthrough,
              onChange: function (e) { setPassthrough(e.target.checked); },
            }),
            "Include unmapped source fields (passthrough)"
          )
        );
      }

      if (step <= fieldStepCount) {
        var stepDef = wizardSteps[step - 1];
        var fieldInfo = inspection.fields[stepDef.field || stepDef.parent];
        var currentAnswer = getAnswerForStep(stepDef);
        var isSkipped = currentAnswer && currentAnswer.action === "skip";
        var defaultTarget = stepDef.kind === "nested"
          ? JsonTransformer.toCamelCase(stepDef.parent)
          : JsonTransformer.inferFieldDefaults(inspection, stepDef.field).targetField;
        var destinationName = isSkipped ? "" : ((currentAnswer && currentAnswer.target) || defaultTarget);

        function saveDestination(target) {
          if (stepDef.kind === "forEach") {
            saveStepAnswer(stepDef, {
              action: "accept",
              target: target || defaultTarget,
              forEachPath: stepDef.field,
              nestedAnswers: (currentAnswer && currentAnswer.nestedAnswers) ||
                (stepDef.subFieldPaths.length ? defaultNestedAnswers(stepDef, inspection) : []),
            });
          } else if (stepDef.kind === "nested") {
            saveStepAnswer(stepDef, {
              action: "accept",
              target: target || defaultTarget,
              nestedAnswers: (currentAnswer && currentAnswer.nestedAnswers) ||
                defaultNestedAnswers(stepDef, inspection),
            });
          } else {
            var inferred = JsonTransformer.inferFieldDefaults(inspection, stepDef.field);
            saveStepAnswer(stepDef, {
              kind: "simple",
              action: "accept",
              source: stepDef.field,
              target: target || inferred.targetField,
              type: inferred.type,
              format: (currentAnswer && Object.prototype.hasOwnProperty.call(currentAnswer, "format"))
                ? currentAnswer.format
                : inferred.format,
            });
          }
        }

        var simpleInferred = stepDef.kind === "simple"
          ? JsonTransformer.inferFieldDefaults(inspection, stepDef.field)
          : null;
        var simpleFormat = stepDef.kind === "simple" && !isSkipped
          ? wizardResolvedFormat(currentAnswer, stepDef.field, inspection)
          : "";

        return h("div", null,
          h("h3", { className: "mb-2" }, "Step " + step + " of " + fieldStepCount),
          h("div", { className: "wizard-field-map" },
            h("div", { className: "wizard-field-map-row" },
              h("label", { className: "wizard-field-map-label" }, "Source"),
              h("div", { className: "wizard-source-field" }, wizardStepLabel(stepDef))
            ),
            stepDef.kind === "forEach" ? h("div", { className: "wizard-kind-badge" }, "Array mapping (forEach)") : null,
            stepDef.kind === "nested" ? h("div", { className: "wizard-kind-badge" }, "Nested object mapping") : null,
            h("div", { className: "wizard-field-map-row" },
              h("label", { className: "wizard-field-map-label", for: "wizard-target-" + step }, "Destination"),
              h("input", {
                id: "wizard-target-" + step,
                className: "mapping-field-input wizard-destination-input",
                type: "text",
                value: destinationName,
                disabled: isSkipped,
                placeholder: "output_field_name",
                onInput: function (e) { saveDestination(e.target.value.trim()); },
              })
            ),
            !isSkipped && stepDef.kind === "simple" ? h("div", { className: "wizard-field-map-row" },
              h("label", { className: "wizard-field-map-label", for: "wizard-format-" + step }, "Format"),
              wizardFormatSelect({
                id: "wizard-format-" + step,
                value: currentAnswer && currentAnswer.format === "round" ? "number" : simpleFormat,
                onChange: function (e) {
                  var fmt = e.target.value || null;
                  var patch = {
                    kind: "simple",
                    action: "accept",
                    source: stepDef.field,
                    target: destinationName || simpleInferred.targetField,
                    type: simpleInferred.type,
                    format: fmt,
                  };
                  if (fmt === "date") patch.outputFormat = (currentAnswer && currentAnswer.outputFormat) || "YYYY-MM-DD";
                  if (fmt === "number" && MF) Object.assign(patch, MF.applyNumberFormatUi("plain"));
                  if (fmt !== "number" && fmt !== "round") patch.precision = "";
                  saveStepAnswer(stepDef, patch);
                },
              })
            ) : null,
            !isSkipped && stepDef.kind === "simple" && (simpleFormat === "date" || simpleFormat === "number" || (currentAnswer && currentAnswer.format === "round"))
              ? h(FormatOptionExtras, {
                field: {
                  format: (currentAnswer && currentAnswer.format) || simpleFormat,
                  outputFormat: currentAnswer && currentAnswer.outputFormat,
                  precision: currentAnswer && currentAnswer.precision,
                },
                compact: false,
                onPatch: function (patch) {
                  saveStepAnswer(stepDef, Object.assign({
                    kind: "simple",
                    action: "accept",
                    source: stepDef.field,
                    target: destinationName || simpleInferred.targetField,
                    type: simpleInferred.type,
                    format: (currentAnswer && currentAnswer.format) || simpleFormat,
                  }, patch));
                },
              })
              : null,
            fieldInfo ? h("div", { className: "text-sm text-muted" },
              "Type: " + fieldInfo.type +
              (stepDef.subFieldPaths && stepDef.subFieldPaths.length
                ? " | " + stepDef.subFieldPaths.length + " sub-field(s)"
                : "")
            ) : null
          ),
          !isSkipped && (stepDef.kind === "forEach" || stepDef.kind === "nested")
            ? renderSubFieldEditor(stepDef)
            : null,
          h("div", { className: "wizard-options" },
            h("button", {
              type: "button",
              className: "wizard-option" + (!isSkipped && currentAnswer ? " selected" : ""),
              onClick: function () { saveDestination(defaultTarget); },
            },
              h("span", null, "\u2705"),
              h("span", null, "Use suggested name: " + defaultTarget)
            ),
            h("button", {
              type: "button",
              className: "wizard-option" + (isSkipped ? " selected" : ""),
              onClick: function () {
                saveStepAnswer(stepDef, { action: "skip", nestedAnswers: [] });
              },
            },
              h("span", null, "\u23E9"),
              h("span", null, stepDef.kind === "forEach" || stepDef.kind === "nested"
                ? "Skip this " + (stepDef.kind === "forEach" ? "array" : "object")
                : "Skip this field")
            )
          ),
          !isSkipped ? h("p", { className: "text-sm text-muted mt-2" },
            stepDef.kind === "forEach"
              ? "Configure how each array element maps to the destination object."
              : stepDef.kind === "nested"
                ? "Configure fields inside the nested output object."
                : "Edit the destination name and format, or use the suggested defaults."
          ) : null,
          step - 1 < fieldStepCount - 1 ? h("button", {
            type: "button",
            className: "btn btn-sm btn-secondary mt-2",
            onClick: function () { acceptAllRemaining(step - 1); },
          }, "Apply defaults to all remaining fields") : null
        );
      }

      if (step === reviewStep) {
        var mappingReview = buildMappingFromAnswers(answers, passthrough, inspection);
        return h("div", null,
          h("h3", { className: "mb-2" }, "Review Your Mapping"),
          h("pre", { className: "code-editor", style: { maxHeight: "280px", overflow: "auto" } },
            JSON.stringify(mappingReview, null, 2)
          )
        );
      }

      if (step === previewStep) {
        var mappingPreview = buildMappingFromAnswers(answers, passthrough, inspection);
        var previewOut = null;
        var previewErr = null;
        if (data && mappingPreview.fields && Object.keys(mappingPreview.fields).length) {
          try {
            var slice = Array.isArray(data) ? data.slice(0, 5) : [data];
            previewOut = JsonTransformer.transform(slice, JsonTransformer.prepareMapping(mappingPreview));
          } catch (ex) {
            previewErr = ex.message;
          }
        }
        return h("div", null,
          h("h3", { className: "mb-2" }, "Preview Output"),
          h("p", { className: "text-sm text-muted mb-2" },
            "Sample transform on first " + Math.min(5, (data && data.length) || 0) + " record(s)"
          ),
          previewErr ? h("div", { className: "validation-error" }, previewErr)
            : h("pre", { className: "code-editor", style: { maxHeight: "280px", overflow: "auto" } },
                JSON.stringify(previewOut, null, 2)
              )
        );
      }

      return null;
    }

    return h("div", { className: "modal-overlay", onClick: function (e) { if (e.target === e.currentTarget) onClose(); } },
      h("div", { className: "modal modal-wizard" },
        h("div", { className: "modal-header" },
          h("span", { className: "modal-title" }, "Mapping Wizard"),
          h("button", { className: "btn btn-icon", onClick: onClose }, "\u2715")
        ),
        h("div", { className: "wizard-progress" },
          Array.from({ length: totalSteps }).map(function (_, i) {
            return h("div", {
              key: i,
              className: "wizard-step-indicator" + (i === step ? " active" : "") + (i < step ? " completed" : ""),
            });
          })
        ),
        h("div", { className: "modal-body wizard-modal-body" }, renderStep()),
        h("div", { className: "modal-footer" },
          h("button", {
            className: "btn btn-secondary",
            onClick: function () { step === 0 ? onClose() : handleBack(); },
          },
            step === 0 ? "Cancel" : "Back"
          ),
          h("button", { className: "btn btn-primary", onClick: handleNext },
            step === previewStep ? "Finish" : "Next"
          )
        )
      )
    );
  }

  // ── Toast Container ────────────────────────────────────────────────

  function ToastContainer() {
    var toasts = useToasts();
    return h("div", { className: "toast-container" },
      toasts.map(function (toast) {
        return h("div", {
          key: toast.id,
          className: "toast toast-" + toast.type,
        },
          h("span", null, toast.message),
          h("button", {
            className: "btn btn-icon btn-sm",
            onClick: function () { removeToast(toast.id); },
          }, "\u2715")
        );
      })
    );
  }

  // ── Main App ───────────────────────────────────────────────────────

  function App() {
    // State
    var _useState = useState(null), sourceData = _useState[0], setSourceData = _useState[1];
    var _useState2 = useState(null), inspection = _useState2[0], setInspection = _useState2[1];
    var _useState3 = useState([]), mappingFields = _useState3[0], setMappingFields = _useState3[1];
    var _useState4 = useState("visual"), editorMode = _useState4[0], setEditorMode = _useState4[1];
    var _useState5 = useState(""), codeEditorValue = _useState5[0], setCodeEditorValue = _useState5[1];
    var _useState6 = useState(null), previewOutput = _useState6[0], setPreviewOutput = _useState6[1];
    var _useState7 = useState([]), previewErrors = _useState7[0], setPreviewErrors = _useState7[1];
    var _useState8 = useState(false), wizardOpen = _useState8[0], setWizardOpen = _useState8[1];
    var _useState9 = useState(getTheme()), theme = _useState9[0], setThemeState = _useState9[1];
    var _useState10 = useState(""), selectedPath = _useState10[0], setSelectedPath = _useState10[1];
    var _useState11 = useState(false), isLoading = _useState11[0], setIsLoading = _useState11[1];
    var _useState12 = useState(function () {
      try { return localStorage.getItem("jt-autosave-pref"); } catch (e) { return "off"; }
    }), autosavePref = _useState12[0], setAutosavePref = _useState12[1];
    var _useState13 = useState(false), passthrough = _useState13[0], setPassthrough = _useState13[1];
    var _useState13b = useState({}), mappingMeta = _useState13b[0], setMappingMeta = _useState13b[1];
    var _useState14 = useState(5), previewLimit = _useState14[0], setPreviewLimit = _useState14[1];
    var _useState15 = useState(null), expectedOutput = _useState15[0], setExpectedOutput = _useState15[1];
    var _useState16 = useState([]), mappingValidationErrors = _useState16[0], setMappingValidationErrors = _useState16[1];
    var _useState17 = useState({ source: false, mapping: false, preview: false }), collapsedPanels = _useState17[0], setCollapsedPanels = _useState17[1];
    var _useState18 = useState([]), undoStack = _useState18[0], setUndoStack = _useState18[1];
    var _useState19 = useState([]), redoStack = _useState19[0], setRedoStack = _useState19[1];
    var _useState20 = useState(function () {
      return readStoredPanelWidth("jt-source-width", 360, 260, 640);
    }), sourcePanelWidth = _useState20[0], setSourcePanelWidth = _useState20[1];
    var _useState20b = useState(function () {
      return readStoredPanelWidth("jt-preview-width", 350, 250, 600);
    }), previewPanelWidth = _useState20b[0], setPreviewPanelWidth = _useState20b[1];
    var _useState20c = useState(false), helpOpen = _useState20c[0], setHelpOpen = _useState20c[1];
    var _useState20d = useState(false), schemaModalOpen = _useState20d[0], setSchemaModalOpen = _useState20d[1];
    var computeWarningAck = useRef(false);
    var skipVisualCodeSyncRef = useRef(false);
    var codeSnapshotRef = useRef(null);
    var fileInputRef = useRef(null);
    var expectedInputRef = useRef(null);
    var _useState21 = useState([]), importedFieldSummary = _useState21[0], setImportedFieldSummary = _useState21[1];

    var mappingFieldSummary = useMemo(function () {
      if (!MF) return [];
      try {
        if (editorMode === "visual" && mappingFields.length) {
          return mappingFields
            .filter(function (f) { return f.target; })
            .map(function (f) {
              return {
                target: f.target,
                kind: f.kind || "simple",
                label: f.kind === "advanced" ? "" : (f.source || f.forEachPath || ""),
              };
            });
        }
        if (editorMode !== "visual" && codeEditorValue.trim()) {
          return MF.fieldSummaryFromMapping(parseMappingFromCode(codeEditorValue, editorMode));
        }
      } catch (e) { /* invalid while typing */ }
      if (importedFieldSummary.length) return importedFieldSummary;
      return [];
    }, [editorMode, mappingFields, codeEditorValue, importedFieldSummary]);


    function setMappingFieldsWithHistory(next) {
      setUndoStack(function (s) {
        return s.concat([JSON.stringify(mappingFields)]).slice(-50);
      });
      setRedoStack([]);
      setMappingFields(next);
    }

    function undoMapping() {
      if (!undoStack.length) return;
      var prev = undoStack[undoStack.length - 1];
      setUndoStack(function (s) { return s.slice(0, -1); });
      setRedoStack(function (s) { return s.concat([JSON.stringify(mappingFields)]); });
      setMappingFields(JSON.parse(prev));
      showToast("Undo", "info", 1500);
    }

    function redoMapping() {
      if (!redoStack.length) return;
      var next = redoStack[redoStack.length - 1];
      setRedoStack(function (s) { return s.slice(0, -1); });
      setUndoStack(function (s) { return s.concat([JSON.stringify(mappingFields)]); });
      setMappingFields(JSON.parse(next));
      showToast("Redo", "info", 1500);
    }

    function togglePanel(name) {
      setCollapsedPanels(function (c) {
        var n = Object.assign({}, c);
        n[name] = !n[name];
        return n;
      });
    }

    // Apply theme
    useEffect(function () {
      setTheme(theme);
    }, [theme]);

    // Load saved state from localStorage (only when auto-save is enabled)
    useEffect(function () {
      if (autosavePref !== "on") return;
      try {
        var saved = localStorage.getItem("jt-mapping");
        if (saved) {
          var parsed = JSON.parse(saved);
          if (parsed.fields) setMappingFields(parsed.fields);
          if (parsed.passthrough) setPassthrough(MF ? MF.passthroughToBool(parsed.passthrough) : true);
          if (parsed.mappingMeta) setMappingMeta(parsed.mappingMeta);
          if (parsed.code) {
            setCodeEditorValue(parsed.code);
            if (parsed.mode) setEditorMode(parsed.mode);
          }
        }
      } catch (e) { console.warn("Auto-save restore failed:", e); }
    }, [autosavePref]);

    // Save mapping to localStorage when opted in
    useEffect(function () {
      if (autosavePref !== "on") return;
      if (mappingFields.length > 0 || codeEditorValue) {
        var state = {
          fields: mappingFields,
          code: codeEditorValue,
          mode: editorMode,
          passthrough: passthrough,
          mappingMeta: mappingMeta,
        };
        try {
          localStorage.setItem("jt-mapping", JSON.stringify(state));
        } catch (e) {
          console.warn("Auto-save failed:", e);
          setAutosavePref("off");
          showToast("Auto-save unavailable — export your mapping before leaving.", "warning", 8000);
        }
      }
    }, [mappingFields, codeEditorValue, editorMode, autosavePref, passthrough, mappingMeta]);

    useEffect(function () {
      if (editorMode === "visual" && sourceData && MF) {
        setMappingValidationErrors(MF.validateVisualFields(mappingFields, sourceData));
      } else {
        setMappingValidationErrors([]);
      }
    }, [mappingFields, sourceData, editorMode]);

    // Run transform when data or mapping changes (debounced)
    useEffect(function () {
      if (!sourceData) {
        setPreviewOutput(null);
        setPreviewErrors([]);
        return;
      }

      var timer = setTimeout(function () {
        try {
          var mapping = resolveActiveMapping(
            editorMode,
            mappingFields,
            codeEditorValue,
            passthrough,
            mappingMeta,
            codeSnapshotRef.current
          );

          if (!mapping || !mapping.fields) {
            setPreviewOutput(null);
            setPreviewErrors([]);
            return;
          }

          if (mappingHasCompute(mapping) && !computeWarningAck.current) {
            var ok = window.confirm(
              "This mapping includes compute functions that run JavaScript on your data. " +
              "Only continue if you trust this mapping. Continue?"
            );
            if (!ok) {
              setPreviewOutput(null);
              setPreviewErrors([{ message: "Preview blocked: compute functions require confirmation" }]);
              return;
            }
            computeWarningAck.current = true;
          }

          var ready = JsonTransformer.prepareMapping(mapping);
          var previewData = Array.isArray(sourceData)
            ? sourceData.slice(0, previewLimit)
            : [sourceData];
          var schemaErrors = [];
          if (ready.schema) {
            var validation = JsonTransformer.validate(previewData, ready);
            schemaErrors = validation.errors || [];
          }

          var transformErrors = [];
          var result = previewData.map(function (row, ri) {
            try {
              return JsonTransformer.transformOne(row, ready);
            } catch (ex) {
              var parsed = parsePreviewTransformError(ex.message, ri);
              transformErrors.push(parsed);
              return {
                __transformError: parsed.message,
                __row: ri,
              };
            }
          });
          setPreviewErrors(schemaErrors.concat(transformErrors));
          setPreviewOutput(result);
        } catch (e) {
          setPreviewOutput(null);
          setPreviewErrors([{ message: "Transform error: " + e.message }]);
        }
      }, 200);

      return function () { clearTimeout(timer); };
    }, [sourceData, mappingFields, codeEditorValue, editorMode, passthrough, previewLimit, mappingMeta]);

    // File loading
    function handleFileLoad(e) {
      var file = e.target.files[0];
      if (!file) return;
      setIsLoading(true);
      var reader = new FileReader();
      reader.onload = function (ev) {
        try {
          var data = JSON.parse(ev.target.result);
          // Ensure data is an array
          if (!Array.isArray(data)) {
            data = [data];
          }
          setSourceData(data);
          var insp = JsonTransformer.inspect(data);
          setInspection(insp);
          showToast("Loaded " + insp.recordCount + " records with " + Object.keys(insp.fields).length + " fields", "success");
        } catch (err) {
          showToast("Failed to parse JSON: " + err.message, "error");
        } finally {
          setIsLoading(false);
          e.target.value = "";
        }
      };
      reader.onerror = function () {
        showToast("Failed to read file", "error");
        setIsLoading(false);
        e.target.value = "";
      };
      reader.readAsText(file);
    }

    // Inspection report loading
    var inspFileInputRef = useRef(null);

    function handleInspectionLoad(e) {
      var file = e.target.files[0];
      if (!file) return;
      var reader = new FileReader();
      reader.onload = function (ev) {
        try {
          var data = JSON.parse(ev.target.result);
          if (!data.fields || typeof data.fields !== "object") {
            showToast("Not a valid inspection report (missing 'fields')", "error");
            return;
          }
          setInspection(data);
          showToast("Loaded inspection: " + Object.keys(data.fields).length + " fields", "success");
        } catch (err) {
          showToast("Failed to parse inspection file: " + err.message, "error");
        } finally {
          e.target.value = "";
        }
      };
      reader.onerror = function () { showToast("Failed to read file", "error"); e.target.value = ""; };
      reader.readAsText(file);
    }

    // Export
    async function exportMapping() {
      var mapping;
      try {
        mapping = resolveActiveMapping(
          editorMode,
          mappingFields,
          codeEditorValue,
          passthrough,
          mappingMeta,
          codeSnapshotRef.current
        );
      } catch (e) {
        showToast("Cannot export: invalid mapping (" + e.message + ")", "error");
        return;
      }
      if (!mapping || !mapping.fields || Object.keys(mapping.fields).length === 0) {
        showToast("No mapping to export", "warning");
        return;
      }
      var useJs = editorMode === "js" || mappingHasCompute(mapping);
      var content;
      var filename;
      var mimeType;
      if (useJs) {
        content = MF.formatMappingAsModule(mapping, true);
        if (MF.mappingHasCompute(mapping)) {
          showToast("Exported as JS module (compute functions serialized as JSON)", "info", 4500);
        }
        filename = "mapping.js";
        mimeType = "text/javascript";
      } else {
        content = JSON.stringify(mapping, null, 2);
        filename = "mapping.json";
        mimeType = "application/json";
      }
      var savedAs = await downloadFile(content, filename, mimeType);
      if (savedAs) showToast("Mapping exported as " + savedAs, "success");
    }

    function copyMapping() {
      var mapping;
      try {
        mapping = resolveActiveMapping(
          editorMode,
          mappingFields,
          codeEditorValue,
          passthrough,
          mappingMeta,
          codeSnapshotRef.current
        );
      } catch (e) {
        showToast("Cannot copy: invalid mapping (" + e.message + ")", "error");
        return;
      }
      if (!mapping || !mapping.fields || Object.keys(mapping.fields).length === 0) {
        showToast("No mapping to copy", "warning");
        return;
      }
      var useJs = editorMode === "js" || mappingHasCompute(mapping);
      var content = useJs
        ? MF.formatMappingAsModule(mapping, true)
        : JSON.stringify(mapping, null, 2);
      copyToClipboard(content);
      showToast("Mapping copied to clipboard", "success");
    }

    async function exportOutput() {
      if (!previewOutput) {
        showToast("No output to export", "warning");
        return;
      }
      var content = JSON.stringify(previewOutput, null, 2);
      var savedAs = await downloadFile(content, "output.json", "application/json");
      if (savedAs) showToast("Output exported as " + savedAs, "success");
    }

    // Import mapping (.json / .js from json-transformer CLI)
    function handleMappingImport(e) {
      var file = e.target.files[0];
      if (!file) return;
      var reader = new FileReader();
      reader.onload = function (ev) {
        try {
          if (!MF) throw new Error("mapping-features.js not loaded");
          var result = parseImportedMapping(ev.target.result, file.name);
          skipVisualCodeSyncRef.current = true;
          codeSnapshotRef.current = {
            text: result.codeEditorValue,
            mode: result.editorMode === "js" ? "js" : "json",
            mapping: result.mapping,
          };
          setMappingMeta(result.meta);
          setPassthrough(result.passthrough);
          setEditorMode(result.editorMode);
          setCodeEditorValue(result.codeEditorValue);
          setMappingFields(result.mappingFields);
          setImportedFieldSummary(result.fieldSummary || []);
          computeWarningAck.current = false;
          showToast(result.toast.message, result.toast.type, result.toast.duration);
        } catch (err) {
          showToast("Failed to import mapping: " + err.message, "error");
        }
        e.target.value = "";
      };
      reader.readAsText(file);
    }

    // Sync code editor with visual fields when switching modes
    function switchMode(mode) {
      if (mode === editorMode) return;

      if (mode === "visual" && editorMode !== "visual") {
        try {
          if (!codeEditorValue.trim()) {
            setEditorMode(mode);
            return;
          }
          var parsed = parseMappingFromCode(codeEditorValue, editorMode);
          codeSnapshotRef.current = {
            text: codeEditorValue,
            mode: editorMode,
            mapping: parsed,
          };
          skipVisualCodeSyncRef.current = true;
          setMappingFields(visualFieldsFromMapping(parsed));
          setImportedFieldSummary([]);
          setEditorMode(mode);
          return;
        } catch (e) {
          showToast("Cannot convert to visual mode: " + e.message, "error");
          return;
        }
      }

      if (mode !== "visual" && editorMode === "visual") {
        var snap = codeSnapshotRef.current;
        if (snap && snap.mapping) {
          var merged = MF.mergeVisualFieldsIntoMapping(mappingFields, snap.mapping, {
            passthrough: passthrough === true,
            meta: mappingMeta,
          });
          skipVisualCodeSyncRef.current = true;
          var hasFnCompute = MF.mappingHasCompute(merged);
          var nextText;

          if (mode === "json") {
            nextText = JSON.stringify(merged, null, 2);
            setCodeEditorValue(nextText);
          } else if (hasFnCompute && snap.mode === "js") {
            nextText = snap.text;
            setCodeEditorValue(nextText);
            showToast(
              "JS source preserved (compute functions). Preview and export use merged mapping.",
              "info",
              5500
            );
          } else {
            nextText = MF.formatMappingAsModule(merged, true);
            setCodeEditorValue(nextText);
          }

          codeSnapshotRef.current = {
            text: nextText,
            mode: mode,
            mapping: merged,
          };
        } else if (mappingFields.length > 0) {
          var built = buildMappingFromVisual(mappingFields, passthrough, mappingMeta);
          skipVisualCodeSyncRef.current = true;
          var builtText = mappingToCodeText(built, mode);
          setCodeEditorValue(builtText);
          codeSnapshotRef.current = { text: builtText, mode: mode, mapping: built };
        } else {
          var emptyMapping = emptyMappingDocument(mappingMeta);
          var emptyText = mappingToCodeText(emptyMapping, mode);
          skipVisualCodeSyncRef.current = true;
          setCodeEditorValue(emptyText);
          codeSnapshotRef.current = { text: emptyText, mode: mode, mapping: emptyMapping };
        }
        setEditorMode(mode);
        return;
      }

      if (mode === "json" && editorMode === "js") {
        try {
          var fromJs = !String(codeEditorValue).trim()
            ? emptyMappingDocument(mappingMeta)
            : MF.applyMappingMeta(MF.parseMappingModule(codeEditorValue), mappingMeta);
          skipVisualCodeSyncRef.current = true;
          var jsonText = mappingToCodeText(fromJs, "json");
          setCodeEditorValue(jsonText);
          codeSnapshotRef.current = { text: jsonText, mode: "json", mapping: fromJs };
        } catch (e) {
          showToast("Invalid JS mapping: " + e.message, "error");
          return;
        }
      } else if (mode === "js" && editorMode === "json") {
        try {
          var fromJson = !String(codeEditorValue).trim()
            ? emptyMappingDocument(mappingMeta)
            : MF.applyMappingMeta(JSON.parse(codeEditorValue), mappingMeta);
          skipVisualCodeSyncRef.current = true;
          var jsText = mappingToCodeText(fromJson, "js");
          setCodeEditorValue(jsText);
          codeSnapshotRef.current = { text: jsText, mode: "js", mapping: fromJson };
        } catch (e) {
          showToast("Invalid JSON mapping: " + e.message, "error");
          return;
        }
      }

      setEditorMode(mode);
    }

    function handleCodeEditorChange(text) {
      setCodeEditorValue(text);
      setImportedFieldSummary([]);
      if (editorMode === "visual" || !MF) return;
      try {
        var parsed = parseMappingFromCode(text, editorMode);
        codeSnapshotRef.current = {
          text: text,
          mode: editorMode,
          mapping: parsed,
        };
      } catch (e) { /* ignore while typing invalid code */ }
    }

    // Tree node selection — copy dot-path to clipboard (FR-102)
    function handleTreeSelect(path, value, type) {
      if (path == null) return;
      setSelectedPath(path);
      if (path !== "") copyToClipboard(path);
    }

    function handleSourceResizeStart(e) {
      startPanelResize(e, {
        getStartWidth: function () { return sourcePanelWidth; },
        onWidth: setSourcePanelWidth,
        storageKey: "jt-source-width",
        min: 260,
        max: 640,
        direction: 1,
      });
    }

    function handlePreviewResizeStart(e) {
      startPanelResize(e, {
        getStartWidth: function () { return previewPanelWidth; },
        onWidth: setPreviewPanelWidth,
        storageKey: "jt-preview-width",
        min: 250,
        max: 600,
        direction: 1,
      });
    }

    function clearSavedData() {
      localStorage.removeItem("jt-mapping");
      showToast("Saved draft cleared", "success", 2000);
    }

    function setAutosavePreference(enabled) {
      if (enabled) {
        try {
          localStorage.setItem("jt-autosave-pref", "on");
        } catch (e) {
          console.warn("localStorage unavailable:", e);
          showToast("Auto-save unavailable in this browser context — export your mapping before leaving.", "warning", 8000);
          setAutosavePref("off");
          return;
        }
        setAutosavePref("on");
        showToast("Auto-save enabled", "info", 2500);
      } else {
        try { localStorage.setItem("jt-autosave-pref", "off"); } catch (e) { /* best effort */ }
        try { localStorage.removeItem("jt-mapping"); } catch (e) { /* best effort */ }
        setAutosavePref("off");
        showToast("Auto-save disabled", "info", 2500);
      }
    }

    // Schema import
    function handleSchemaApply(fields, mode) {
      if (!fields || !fields.length) return;
      var next = mode === "append" ? mappingFields.concat(fields) : fields;
      setMappingFieldsWithHistory(next);
      setEditorMode("visual");
      setSchemaModalOpen(false);
      showToast((mode === "append" ? "Added " : "Created ") + fields.length + " field" + (fields.length !== 1 ? "s" : "") + " from schema.", "success");
    }

    // Wizard complete
    function handleWizardComplete(mapping, wizardPassthrough) {
      var fields = visualFieldsFromMapping(mapping);
      setMappingFieldsWithHistory(fields);
      setMappingMeta(MF ? MF.extractMappingMeta(mapping) : {});
      setPassthrough(!!wizardPassthrough);
      setEditorMode("visual");
      showToast("Wizard complete! " + fields.length + " fields mapped.", "success");
    }

    function handleLoadExpected(e) {
      var file = e.target.files[0];
      if (!file) return;
      var reader = new FileReader();
      reader.onload = function (ev) {
        try {
          var data = JSON.parse(ev.target.result);
          if (!Array.isArray(data)) data = [data];
          setExpectedOutput(data);
          showToast("Loaded expected output (" + data.length + " records)", "success");
        } catch (err) {
          showToast("Invalid expected output JSON", "error");
        }
        e.target.value = "";
      };
      reader.readAsText(file);
    }

    function triggerExpectedLoad() {
      if (!expectedInputRef.current) {
        var input = document.createElement("input");
        input.type = "file";
        input.accept = ".json,application/json";
        input.onchange = handleLoadExpected;
        input.click();
        return;
      }
      expectedInputRef.current.click();
    }

    function clearPreview() {
      setPreviewOutput(null);
      setPreviewErrors([]);
      showToast("Preview cleared", "info", 1500);
    }

    // Reset workspace — clear loaded data and mapping
    function clearData() {
      setSourceData(null);
      setInspection(null);
      setMappingFields([]);
      setCodeEditorValue("");
      setEditorMode("visual");
      setPreviewOutput(null);
      setPreviewErrors([]);
      setExpectedOutput(null);
      setPassthrough(false);
      setMappingMeta({});
      setImportedFieldSummary([]);
      setMappingValidationErrors([]);
      setUndoStack([]);
      setRedoStack([]);
      setSelectedPath("");
      setWizardOpen(false);
      computeWarningAck.current = false;
      codeSnapshotRef.current = null;
      if (fileInputRef.current) fileInputRef.current.value = "";
      if (expectedInputRef.current) expectedInputRef.current.value = "";
      if (autosavePref === "on") {
        localStorage.removeItem("jt-mapping");
      }
      showToast("Data and mapping reset", "success", 2000);
    }

    // Sync code editor from visual fields only while in visual mode (never clobber JS/JSON imports)
    useEffect(function () {
      if (skipVisualCodeSyncRef.current) {
        skipVisualCodeSyncRef.current = false;
        return;
      }
      if (editorMode !== "visual" || mappingFields.length === 0) return;
      var mapping = buildMappingFromVisual(mappingFields, passthrough, mappingMeta);
      setCodeEditorValue(JSON.stringify(mapping, null, 2));
      setImportedFieldSummary([]);
    }, [editorMode, mappingFields, passthrough, mappingMeta]);

    return h("div", { className: "app-shell" },
      autosavePref === null ? h("div", { className: "autosave-banner" },
        h("span", null, "Auto-save your work to browser storage? (data stays on this device)"),
        h("div", { className: "flex gap-1" },
          h("button", { className: "btn btn-sm btn-primary", onClick: function () { setAutosavePreference(true); } }, "Enable"),
          h("button", { className: "btn btn-sm btn-secondary", onClick: function () { setAutosavePreference(false); } }, "No thanks")
        )
      ) : null,
      // Header
      h("header", { className: "app-header" },
        h("div", { className: "app-title" },
          h("span", { className: "logo" }, "\uD83D\uDD04"),
          "json-transformer Assistant"
        ),
        h("div", { className: "header-actions" },
          // Data loading
          h("button", {
            className: "btn btn-secondary",
            onClick: function () { return fileInputRef.current.click(); },
          }, "\uD83D\uDCC4 Load Data"),
          h("input", {
            ref: fileInputRef,
            type: "file",
            accept: ".json,application/json",
            style: { display: "none" },
            onChange: handleFileLoad,
          }),
          h("button", {
            className: "btn btn-secondary",
            "data-tooltip": "Load a saved --inspect report to populate field suggestions without loading full data",
            onClick: function () { return inspFileInputRef.current.click(); },
          }, "\uD83D\uDD0D Load Inspection"),
          h("input", {
            ref: inspFileInputRef,
            type: "file",
            accept: ".json,application/json",
            style: { display: "none" },
            onChange: handleInspectionLoad,
          }),
          h("button", {
            className: "btn btn-secondary",
            onClick: function () { setWizardOpen(true); },
            disabled: !inspection,
          }, "\uD83D\uDD74 Wizard"),
          h("button", {
            className: "btn btn-secondary",
            onClick: function () { setSchemaModalOpen(true); },
            "data-tooltip": "Generate target fields from a Swagger / JSON Schema",
          }, "\uD83D\uDCCB Schema"),
          // Mapping import
          h("button", {
            className: "btn btn-secondary",
            onClick: function () {
              var input = document.createElement("input");
              input.type = "file";
              input.accept = ".json,.js";
              input.onchange = handleMappingImport;
              input.click();
            },
          }, "\uD83D\uDCE5 Import"),
          // Export
          h("button", { className: "btn btn-primary", onClick: exportMapping }, "\uD83D\uDCE4 Export"),
          h("button", {
            className: "btn btn-secondary",
            onClick: copyMapping,
            title: "Copy mapping JSON/JS to clipboard",
          }, "Copy mapping"),
          h("button", {
            className: "btn btn-secondary",
            onClick: exportOutput,
            disabled: !previewOutput,
          }, "\uD83D\uDCE4 Output"),
          h("button", {
            className: "btn btn-secondary",
            onClick: clearData,
            "data-tooltip": "Reset — clear data, mapping, and preview",
          }, "\u2716 Reset"),
          autosavePref === "on" ? h("button", {
            className: "btn btn-secondary",
            onClick: clearSavedData,
            "data-tooltip": "Clear auto-saved draft",
          }, "Clear draft") : null,
          h("button", {
            className: "btn btn-icon btn-secondary",
            onClick: function () { setHelpOpen(true); },
            "data-tooltip": "Help & documentation",
            title: "Help",
          }, "?"),
          // Theme toggle
          h("button", {
            className: "btn btn-icon btn-secondary",
            onClick: function () { setThemeState(theme === "light" ? "dark" : "light"); },
            "data-tooltip": "Toggle theme",
          }, theme === "light" ? "\u2600" : "\uD83C\uDF19")
        )
      ),
      h("input", {
        ref: expectedInputRef,
        type: "file",
        accept: ".json,application/json",
        style: { display: "none" },
        onChange: handleLoadExpected,
      }),
      // Main content
      h("main", { className: "app-main" },
        h(SourceTreePanel, {
          data: sourceData,
          onSelect: handleTreeSelect,
          selectedPath: selectedPath,
          collapsed: collapsedPanels.source,
          onToggleCollapse: function () { togglePanel("source"); },
          panelStyle: collapsedPanels.source ? undefined : { width: sourcePanelWidth, minWidth: sourcePanelWidth, maxWidth: sourcePanelWidth },
        }),
        collapsedPanels.source ? null : h("div", {
          className: "resize-handle resize-handle-source",
          onMouseDown: handleSourceResizeStart,
          title: "Drag to resize source panel",
        }),
        h("div", { className: "panel panel-mapping" + (collapsedPanels.mapping ? " panel-collapsed" : "") },
          h(PanelCollapseHeader, {
            collapsed: collapsedPanels.mapping,
            title: "Mapping Editor",
            shortTitle: "Map",
            onToggle: function () { togglePanel("mapping"); },
          },
            collapsedPanels.mapping ? null : [
              h("button", { type: "button", className: "btn btn-sm btn-secondary", onClick: undoMapping, disabled: !undoStack.length, title: "Undo" }, "Undo"),
              h("button", { type: "button", className: "btn btn-sm btn-secondary", onClick: redoMapping, disabled: !redoStack.length, title: "Redo" }, "Redo"),
              ["visual", "json", "js"].map(function (mode) {
                return h("button", {
                  key: mode,
                  type: "button",
                  className: "btn btn-sm " + (editorMode === mode ? "btn-primary" : "btn-secondary"),
                  onClick: function () { switchMode(mode); },
                }, mode === "visual" ? "Visual" : mode.toUpperCase());
              }),
            ]
          ),
          collapsedPanels.mapping ? null : h("div", { className: "panel-body panel-body-mapping" },
            isLoading ? h("div", { className: "loading-spinner" }, "Processing...") : null,
            h(DataInspector, { inspection: inspection }),
            h("div", { className: "mapping-editor-scroll" },
              editorMode === "visual"
                ? h(VisualMappingEditor, {
                    fields: mappingFields,
                    onChange: setMappingFieldsWithHistory,
                    inspection: inspection,
                    passthrough: passthrough,
                    onPassthroughChange: setPassthrough,
                    sourceData: sourceData,
                    validationErrors: mappingValidationErrors,
                  })
                : h(CodeEditor, {
                    key: editorMode,
                    mode: editorMode,
                    value: codeEditorValue,
                    onChange: handleCodeEditorChange,
                    fieldSummary: mappingFieldSummary,
                    inspection: inspection,
                  })
            )
          )
        ),
        collapsedPanels.preview ? null : h("div", {
          className: "resize-handle resize-handle-preview",
          onMouseDown: handlePreviewResizeStart,
          title: "Drag to resize preview panel",
        }),
        h(PreviewPanel, {
          output: previewOutput,
          errors: previewErrors,
          expectedOutput: expectedOutput,
          previewLimit: previewLimit,
          onPreviewLimitChange: setPreviewLimit,
          onClearPreview: clearPreview,
          onLoadExpected: triggerExpectedLoad,
          collapsed: collapsedPanels.preview,
          onToggleCollapse: function () { togglePanel("preview"); },
          panelStyle: {
            width: previewPanelWidth,
            minWidth: previewPanelWidth,
            maxWidth: previewPanelWidth,
            flexShrink: 0,
          },
        }),
      ),
      h(HelpPanel, {
        open: helpOpen,
        onClose: function () { setHelpOpen(false); },
      }),
      // Schema import modal
      h(SwaggerSchemaModal, {
        open: schemaModalOpen,
        onClose: function () { setSchemaModalOpen(false); },
        onApply: handleSchemaApply,
      }),
      // Wizard modal
      h(WizardModal, {
        open: wizardOpen,
        onClose: function () { setWizardOpen(false); },
        data: sourceData,
        inspection: inspection,
        onComplete: handleWizardComplete,
      }),
      // Toasts
      h(ToastContainer, null)
    );
  }

  // ── Mount ──────────────────────────────────────────────────────────

  setTheme(getTheme());
  preact.render(h(App, null), document.getElementById("app"));

})();
