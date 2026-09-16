(function (global) {
  function xpathLiteral(value) {
    const s = String(value);
    if (!s.includes("'")) return "'" + s + "'";
    if (!s.includes('"')) return '"' + s + '"';
    return "concat('" + s.replace(/'/g, "',\"'\",'") + "')";
  }

  /** Build-generated class names change on every release, so never anchor on them. */
  function looksHashed(token) {
    return /^css-/.test(token) || token.includes("___") || token.includes("-o_O-") || /[a-zA-Z]\d{4,}/.test(token);
  }

  function dropHashSuffix(token) {
    return token.replace(/_[a-z0-9]{4,}$/, "");
  }

  /**
   * Pick the most meaningful class to anchor on. Frameworks usually ship one
   * hand-written name (internal_fieldValue) next to hashed build output
   * (ObjectFieldLayout-module__valueWrapper___cfUx2); prefer the former.
   */
  function stableClassToken(cls) {
    if (!cls) return "";
    const parts = String(cls).split(/\s+/).filter(Boolean);
    const clean = parts.filter((p) => p.length >= 4 && !looksHashed(p));
    if (clean.length) return clean.slice().sort((a, b) => b.length - a.length)[0];

    for (const part of parts) {
      const mod = part.match(/^([A-Za-z][\w-]*?)___[A-Za-z0-9]+/);
      if (mod && mod[1].length >= 6) return dropHashSuffix(mod[1]);
      const oo = part.match(/^([A-Za-z][\w-]*?)-o_O-/);
      if (oo && oo[1].length >= 4) return dropHashSuffix(oo[1]);
    }
    const first = parts[0] || "";
    const head = first.split(/[-_]/)[0];
    return head.length >= 6 ? head : first;
  }

  function slugKey(label) {
    return String(label || "field")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 48) || "field";
  }

  function controlPrefix(name) {
    const n = String(name || "");
    const m = n.match(/^(.*_DataCard)\d.*$/);
    if (m) return m[1];
    return n;
  }

  function nodeText(el) {
    if (!el) return "";
    if (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT") {
      return (el.getAttribute("value") || el.value || "").trim();
    }
    return (el.textContent || "").replace(/\s+/g, " ").trim();
  }

  function evaluateXPath(doc, xpath) {
    const out = [];
    try {
      const snap = doc.evaluate(xpath, doc, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);
      for (let i = 0; i < snap.snapshotLength; i += 1) out.push(snap.snapshotItem(i));
    } catch (err) {
      return { ok: false, error: String(err && err.message ? err.message : err), nodes: [] };
    }
    return { ok: true, error: null, nodes: out };
  }

  function scorePath(xpath, matchCount, sample, node) {
    let score = 50;
    const risks = [];
    if (matchCount === 1) score += 25;
    if (matchCount === 0) {
      score = 5;
      risks.push("No match in this document");
    }
    if (matchCount > 1) {
      score -= 20 + Math.min(25, matchCount);
      risks.push("Matches " + matchCount + " nodes, so it is not tied to one field");
    }
    if (sample && sample.length > 180) {
      score -= 35;
      risks.push("Extracted text looks like a whole screen, not one field");
    }
    if (/\[\d+\]/.test(xpath.replace(/\[1\]/g, ""))) {
      score -= 8;
      risks.push("Uses a numeric position");
    }
    if (/@id='/.test(xpath) && node && node.id && /\d{4,}/.test(node.id)) {
      score -= 20;
      risks.push("Uses a likely dynamic id");
    }
    if (xpath.includes("starts-with(")) score += 8;
    if (xpath.includes("contains(@class")) score += 4;
    if (xpath.includes("@data-control-name") || xpath.includes("@for=") || xpath.includes("@title=")) score += 10;
    if (xpath.endsWith(")[1]") || xpath.includes(")[1]/")) score += 4;
    score = Math.max(1, Math.min(99, score));
    let confidence = "low";
    if (score >= 75 && matchCount === 1) confidence = "high";
    else if (score >= 50) confidence = "medium";
    return { score, confidence, risks };
  }

  function valueXPath(el) {
    const tag = el.tagName.toLowerCase();
    if (tag === "input") {
      const title = el.getAttribute("title");
      const cls = stableClassToken(el.getAttribute("class"));
      if (title && cls) return `//${tag}[@title=${xpathLiteral(title)} and contains(@class,${xpathLiteral(cls)})]`;
      if (title) return `//${tag}[@title=${xpathLiteral(title)}]`;
      if (cls) return `//${tag}[contains(@class,${xpathLiteral(cls)})]`;
      return `//${tag}`;
    }
    if (tag === "span" || tag === "div" || tag === "a") {
      const cls = stableClassToken(el.getAttribute("class"));
      if (cls) return `//${tag}[contains(@class,${xpathLiteral(cls)})]`;
    }
    return `//${tag}`;
  }

  /**
   * Value for a <label>: the id it points at, else the nearest ancestor that
   * holds both the label and something with text. Covers the Veeva pattern
   * where the value lives in a sibling wrapper, not inside the label's parent.
   */
  const VALUE_WRAPPER = "[class*='ieldValue'],[class*='field-value'],[class*='fieldvalue'],[class*='-value'],[class*='readOnlyValue']";

  /** Deepest element that carries the text, ignoring alignment wrappers. */
  function innermostWithText(root) {
    let node = root;
    for (let i = 0; i < 8; i += 1) {
      const kids = Array.from(node.children).filter((c) => nodeText(c));
      if (kids.length !== 1) break;
      node = kids[0];
    }
    return node;
  }

  function valuesForLabel(lab, doc) {
    const out = [];
    if (lab.htmlFor) {
      const byId = doc.getElementById(lab.htmlFor);
      if (byId) out.push({ value: byId, container: null });
    }
    // Read-only layouts (Veeva and similar) put the value in a wrapper whose
    // class says so; prefer that over a blind scan of the surrounding markup.
    let wrap = lab;
    for (let i = 0; i < 6 && wrap.parentElement; i += 1) {
      wrap = wrap.parentElement;
      const hinted = wrap.querySelector(VALUE_WRAPPER);
      if (hinted && !lab.contains(hinted) && nodeText(hinted)) {
        const leaf = innermostWithText(hinted);
        if (leaf && !out.some((o) => o.value === leaf)) {
          out.push({ value: leaf, container: wrap, wrapper: hinted });
        }
        break;
      }
    }
    if (out.some((o) => o.wrapper)) return out;

    // Widgets such as bootstrap-select hide the real control and paint their
    // own markup next to it, so always look for a visible sibling value too.
    let container = lab;
    for (let i = 0; i < 6 && container.parentElement; i += 1) {
      container = container.parentElement;
      const candidates = container.querySelectorAll("input, textarea, select, a, span, div");
      let found = null;
      for (const c of candidates) {
        if (lab.contains(c) || c.contains(lab)) continue;
        if (c.querySelector("label")) continue;
        if (out.some((o) => o.value === c)) continue;
        const tag = c.tagName;
        if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") { found = c; break; }
        if (nodeText(c) && !c.querySelector("input, textarea, select, a, span, div")) { found = c; break; }
      }
      if (found) {
        out.push({ value: found, container });
        break;
      }
    }
    return out;
  }

  /**
   * Rebuild the label-anchored shape the Task Mining rules use:
   * //label[@for='x']/ancestor::div[contains(@class,'wrapper')][1]//span[...]
   */
  function labelAnchoredPaths(lab, valueEl, container, labelText, wrapper) {
    const paths = [];
    if (!valueEl) return paths;
    const anchors = [];
    if (lab.htmlFor) anchors.push("//label[@for=" + xpathLiteral(lab.htmlFor) + "]");
    if (labelText) anchors.push("//label[normalize-space(.)=" + xpathLiteral(labelText) + "]");
    if (!anchors.length) return paths;

    const tag = valueEl.tagName.toLowerCase();
    const isControl = tag === "input" || tag === "textarea" || tag === "select";
    const valCls = stableClassToken(valueEl.getAttribute("class"));

    // Pin to the innermost element so alignment wrappers cannot win instead.
    let tail;
    if (valCls) tail = `//${tag}[contains(@class,${xpathLiteral(valCls)})]`;
    else if (isControl) tail = `//${tag}`;
    else if (!valueEl.querySelector(tag)) tail = `//${tag}[not(${tag})][normalize-space()]`;
    else tail = `//${tag}[normalize-space()]`;

    const wrapCls = wrapper ? stableClassToken(wrapper.getAttribute("class")) : null;
    if (wrapCls) tail = `//*[contains(@class,${xpathLiteral(wrapCls)})]` + tail;

    const ancCls = container ? stableClassToken(container.getAttribute("class")) : null;

    anchors.forEach((anchor) => {
      if (ancCls) {
        paths.push("(" + anchor + "/ancestor::*[contains(@class," + xpathLiteral(ancCls) + ")][1]" + tail + ")[1]");
      }
      if (isControl) {
        paths.push("(" + anchor + "/following::" + tag + "[1])[1]");
      } else {
        paths.push("(" + anchor + "/following::" + tag + "[normalize-space()][1])[1]");
      }
    });
    return paths;
  }

  /**
   * Web-component layouts caption a field with a title attribute instead of a
   * <label>, then put the value in the next sibling:
   *   <p title="Case Number">Case Number</p><p class="fieldComponent">00449148</p>
   * Only captions whose own text repeats the title qualify, so tooltips on
   * links, images and buttons are left alone.
   */
  function titleCaptions(doc) {
    const out = [];
    doc.querySelectorAll("[title]").forEach((cap) => {
      const title = String(cap.getAttribute("title") || "").replace(/\s+/g, " ").trim();
      if (!title || title.length > 60) return;
      if (cap.querySelector("input, textarea, select")) return;
      const own = nodeText(cap).replace(/[:*]/g, "").trim();
      if (!own || own.toLowerCase() !== title.toLowerCase()) return;
      const value = cap.nextElementSibling;
      if (!value) return;
      out.push({ caption: cap, value, title });
    });
    return out;
  }

  function titleAnchoredPaths(cap, valueEl) {
    const lit = xpathLiteral(cap.getAttribute("title"));
    const ctag = cap.tagName.toLowerCase();
    const vtag = valueEl.tagName.toLowerCase();
    const vcls = stableClassToken(valueEl.getAttribute("class"));
    const anchor = "//" + ctag + "[@title=" + lit + "]";
    const paths = [];
    if (vcls) {
      paths.push("(" + anchor + "/following-sibling::" + vtag + "[contains(@class," + xpathLiteral(vcls) + ")])[1]");
    }
    paths.push("(" + anchor + "/following-sibling::" + vtag + "[normalize-space()])[1]");
    paths.push("(//*[@title=" + lit + "]/following-sibling::*[normalize-space()])[1]");
    return paths;
  }

  /**
   * A component that rendered into a shadow root leaves an empty tag behind in
   * saved HTML. XPath cannot cross a shadow boundary, so the value is out of
   * reach here and in Task Mining itself. Return the component name so the
   * report can say which field was lost and why.
   */
  function unrenderedComponent(el) {
    if (!el || nodeText(el)) return null;
    const nodes = [el].concat(Array.from(el.querySelectorAll("*")));
    const hit = nodes.find((n) => n.tagName.includes("-") && !n.children.length && !nodeText(n));
    return hit ? hit.tagName.toLowerCase() : null;
  }

  /** Fields whose caption is readable but whose value sits behind shadow DOM. */
  function shadowGaps(doc) {
    const gaps = [];
    const seen = new Set();
    function note(label, valueEl) {
      if (!label || seen.has(label)) return;
      const component = unrenderedComponent(valueEl);
      if (!component) return;
      seen.add(label);
      gaps.push({ label, component });
    }
    titleCaptions(doc).forEach((c) => note(c.title, c.value));
    doc.querySelectorAll("label").forEach((lab) => {
      const text = nodeText(lab).replace(/[:*]/g, "").trim();
      if (!text || text.length > 80) return;
      if (valuesForLabel(lab, doc).some((c) => nodeText(c.value))) return;
      note(text, lab.nextElementSibling);
    });
    return gaps;
  }

  /** <strong>Study Codes:</strong><span>DAK539A12303</span> and <dt>/<dd> pairs. */
  function textLabelPaths(labelEl, valueEl) {
    if (!valueEl) return [];
    const tag = labelEl.tagName.toLowerCase();
    const lit = xpathLiteral(nodeText(labelEl));
    const vtag = valueEl.tagName.toLowerCase();
    return [
      `(//${tag}[normalize-space()=${lit}]/following-sibling::${vtag}[1])[1]`,
      `(//${tag}[normalize-space()=${lit}]/following::${vtag}[normalize-space()][1])[1]`
    ];
  }

  const GENERIC_CONTROL = /^DataCard(Value|Key)\d*$/i;

  function controlBase(el) {
    return String(el.getAttribute("data-control-name") || "").replace(/@.*$/, "");
  }

  /** Every [data-control-name] ancestor, named ones first. */
  function controlChain(el) {
    const chain = [];
    let node = el;
    while (node) {
      const c = node.closest ? node.closest("[data-control-name]") : null;
      if (!c) break;
      chain.push(c);
      node = c.parentElement;
    }
    const named = chain.filter((c) => !GENERIC_CONTROL.test(controlBase(c)));
    return named.concat(chain.filter((c) => GENERIC_CONTROL.test(controlBase(c))));
  }

  /** Field name for a value node: the closest ancestor card with a real name. */
  function controlLabel(el) {
    const chain = controlChain(el);
    for (const c of chain) {
      const base = controlBase(c);
      if (!base || GENERIC_CONTROL.test(base)) continue;
      if (/_DataCard/.test(base)) return base.replace(/_DataCard.*$/, "");
      return base.replace(/_\d+$/, "");
    }
    return null;
  }

  function candidatesForElement(el, labelText) {
    const paths = [];
    const inner = valueXPath(el);
    controlChain(el).slice(0, 3).forEach((control) => {
      const raw = control.getAttribute("data-control-name") || "";
      const prefix = controlPrefix(raw);
      if (prefix) {
        paths.push("(" + "//div[starts-with(@data-control-name," + xpathLiteral(prefix) + ")]" + inner + ")[1]");
      }
      paths.push("(" + "//*[@data-control-name=" + xpathLiteral(raw) + "]" + inner + ")[1]");
    });
    if (el.id) {
      paths.push("//*[@id=" + xpathLiteral(el.id) + "]");
    }
    const title = el.getAttribute("title");
    if (title && el.tagName === "INPUT") {
      paths.push("(//input[@title=" + xpathLiteral(title) + "])[1]");
    }
    if (labelText) {
      const lit = xpathLiteral(labelText);
      if (el.tagName === "INPUT") {
        paths.push("//label[contains(normalize-space(.)," + lit + ")]/following::input[1]");
      }
      paths.push("//label[contains(normalize-space(.)," + lit + ")]/following::*[self::span or self::a][normalize-space()][1]");
    }
    paths.push(inner);
    return unique(paths.filter(Boolean));
  }

  function documentLabel(doc, text) {
    const want = String(text || "").replace(/\s+/g, " ").trim();
    if (!want) return null;
    const labels = doc.querySelectorAll("label, strong, th, [aria-label]");
    for (const n of labels) {
      const t = nodeText(n).replace(/[:*]/g, "").trim();
      if (t === want || t.toLowerCase() === want.toLowerCase()) return n;
    }
    return null;
  }

  function unique(list) {
    return Array.from(new Set(list));
  }

  function tablePredicate(table) {
    if (table.id && !/\d{4,}/.test(table.id)) return `[@id=${xpathLiteral(table.id)}]`;
    if (table.className) {
      const token = stableClassToken(table.className) || String(table.className).split(/\s+/)[0];
      if (token) return `[contains(@class,${xpathLiteral(token)})]`;
    }
    if (table.id) return `[@id=${xpathLiteral(table.id)}]`;
    return "";
  }

  function headerIndex(th) {
    const row = th.parentElement;
    if (!row) return -1;
    return Array.prototype.indexOf.call(row.children, th);
  }

  function dataCellFor(th) {
    const table = th.closest("table");
    const idx = headerIndex(th);
    if (!table || idx < 0) return null;
    const rows = Array.from(table.querySelectorAll("tr"));
    for (const row of rows) {
      const tds = row.querySelectorAll("td");
      if (tds.length > idx) return tds[idx];
    }
    return null;
  }

  function tableFieldPaths(th) {
    const name = nodeText(th);
    const table = th.closest("table");
    const idx = headerIndex(th);
    if (!table || !name || idx < 0) return [];
    const pred = tablePredicate(table);
    const minCells = Math.max(1, idx + 1);
    const colExpr = `td[count((//table${pred}//tr)[1]/*[normalize-space()=${xpathLiteral(name)}]/preceding-sibling::*)+1]`;
    const rowSelected = `(//table${pred}//tr[contains(@class,'s4-itm-selected')][count(td)>=${minCells}])[1]`;
    const rowFirst = `(//table${pred}//tr[count(td)>=${minCells}])[1]`;
    const paths = [`${rowSelected}/${colExpr}`, `${rowFirst}/${colExpr}`];

    // Some grids wrap the value in a styled element inside the cell.
    const cell = dataCellFor(th);
    const inner = cell && cell.children.length === 1 ? cell.firstElementChild : null;
    const innerCls = inner && stableClassToken(inner.getAttribute("class"));
    if (innerCls) {
      const tail = `//${inner.tagName.toLowerCase()}[contains(@class,${xpathLiteral(innerCls)})]`;
      paths.push(`${rowSelected}/${colExpr}${tail}`);
      paths.push(`${rowFirst}/${colExpr}${tail}`);
    }
    return paths;
  }

  const LAYOUT_CONTROL = /^(App|Screen|Container|Header|Footer|Group|Gallery|Rectangle|Icon|Image|Separator|Landing|Component|Form|Canvas)/i;

  function collectFields(doc) {
    const fields = [];
    const seen = new Set();
    function add(label, el, extraPaths, kind) {
      if (!el) return;
      const cleanLabel = String(label || "").replace(/\s+/g, " ").trim();
      if (!cleanLabel) return;
      const key = cleanLabel + "|" + (el.getAttribute("data-control-name") || el.id || el.tagName);
      if (seen.has(key)) return;
      seen.add(key);
      const paths = unique((extraPaths || []).concat(candidatesForElement(el, cleanLabel))).slice(0, 8);
      fields.push({
        label: cleanLabel,
        key: slugKey(cleanLabel),
        element: el,
        kind: kind || "text",
        sample: nodeText(el).slice(0, 240),
        paths
      });
    }

    const VALUE_SELECTORS = [
      "input",
      "textarea",
      "select",
      "span[class*='topTagText']",
      ".appmagic-label-text",
      "[title] span",
      "a",
      "span"
    ];

    doc.querySelectorAll("[data-control-name]").forEach((card) => {
      // Take the highest-priority value node this card actually owns; a nested
      // card owns its own value, so leave that one to the nested card.
      let value = null;
      for (const sel of VALUE_SELECTORS) {
        for (const c of card.querySelectorAll(sel)) {
          if (c.closest("[data-control-name]") === card) { value = c; break; }
        }
        if (value) break;
      }
      if (!value) return;
      const label = controlLabel(value) || controlBase(card);
      if (!label || LAYOUT_CONTROL.test(label)) return;
      add(label, value, null, value.tagName === "INPUT" ? "input" : "text");
    });

    doc.querySelectorAll("label").forEach((lab) => {
      const text = nodeText(lab).replace(/[:*]/g, "").trim();
      if (!text || text.length > 80) return;
      const cands = valuesForLabel(lab, doc);
      const extra = [];
      cands.forEach((c) => extra.push.apply(extra, labelAnchoredPaths(lab, c.value, c.container, text, c.wrapper)));
      const primary = cands.find((c) => nodeText(c.value)) || cands[0];
      const target = primary ? primary.value : null;
      add(text, target || lab, extra, target && target.tagName === "INPUT" ? "input" : "text");
    });

    // Values hidden in a shadow root are reported separately by shadowGaps, so
    // only pair a caption with a sibling that actually carries something.
    titleCaptions(doc).forEach((c) => {
      const isControl = /^(INPUT|TEXTAREA|SELECT)$/.test(c.value.tagName) || !!c.value.querySelector("input, textarea, select");
      if (!nodeText(c.value) && !isControl) return;
      add(c.title, c.value, titleAnchoredPaths(c.caption, c.value), isControl ? "input" : "text");
    });

    // Two-column "Label | Value" rows, e.g. eSUB Manager envelope tables.
    doc.querySelectorAll("tr").forEach((row) => {
      if (row.children.length !== 2) return;
      const labelCell = row.children[0];
      const valueCell = row.children[1];
      if (valueCell.tagName !== "TD") return;
      const text = nodeText(labelCell).replace(/[:*]\s*$/, "").trim();
      if (!text || text.length > 60 || !nodeText(valueCell)) return;
      const table = row.closest("table");
      const pred = table ? tablePredicate(table) : "";
      const rowPred = `[td[starts-with(normalize-space(.),${xpathLiteral(text)})]]`;
      add(text, valueCell, [`(//table${pred}//tr${rowPred}/td[2])[1]`], "table");
    });

    doc.querySelectorAll("strong, b, dt, th[scope='row']").forEach((lb) => {
      const text = nodeText(lb).replace(/[:*]/g, "").trim();
      if (!text || text.length > 60) return;
      let sib = lb.nextElementSibling;
      while (sib && !nodeText(sib)) sib = sib.nextElementSibling;
      if (!sib) return;
      add(text, sib, textLabelPaths(lb, sib), "text");
    });

    doc.querySelectorAll("table th").forEach((th) => {
      const name = nodeText(th);
      if (!name || name.length > 60) return;
      add(name, dataCellFor(th) || th, tableFieldPaths(th), "table");
    });

    doc.querySelectorAll("input[title], textarea[title]").forEach((el) => {
      add(el.getAttribute("title"), el, null, "input");
    });

    return fields;
  }

  const GENERIC_LABEL = /^(Label|HtmlText|Text|Rectangle|Box|Item|Value|Field|Control)\s*\d*$/i;

  function rankFields(doc, fields, limit) {
    const max = limit || 400;
    const out = [];
    fields.slice(0, max).forEach((f) => {
      const labelNorm = f.label.toLowerCase();
      let best = null;
      f.paths.forEach((p) => {
        const a = assessPath(doc, p, f.element);
        // A path that returns the field's own caption has latched onto the
        // label instead of the value next to it.
        if (a.sample && a.sample.toLowerCase() === labelNorm) {
          a.score = Math.max(1, a.score - 45);
          a.risks = a.risks.concat("This returns the field label, not its value");
          if (a.confidence === "high") a.confidence = "low";
        }
        if (!best || a.score > best.score) best = a;
      });
      if (!best) return;
      f.best = best;
      f.hasValue = !!(best.sample && best.sample.length);
      f.generic = GENERIC_LABEL.test(f.label);
      f.sample = best.sample || f.sample;
      out.push(f);
    });
    out.sort((a, b) => {
      if (a.hasValue !== b.hasValue) return a.hasValue ? -1 : 1;
      if (a.generic !== b.generic) return a.generic ? 1 : -1;
      return b.best.score - a.best.score;
    });
    const byPath = new Set();
    return out.filter((f) => {
      if (byPath.has(f.best.xpath)) return false;
      byPath.add(f.best.xpath);
      return true;
    });
  }

  function documentRichness(doc) {
    const controls = doc.querySelectorAll("[data-control-name]").length;
    const labels = doc.querySelectorAll("label").length;
    const headers = doc.querySelectorAll("table th").length;
    const titled = doc.querySelectorAll("input[title], textarea[title]").length;
    return controls + labels + headers + titled + titleCaptions(doc).length;
  }

  function assessPath(doc, xpath, hintNode) {
    const result = evaluateXPath(doc, xpath);
    const sample = result.nodes.map(nodeText).filter(Boolean)[0] || (result.nodes[0] ? nodeText(result.nodes[0]) : "");
    const scored = scorePath(xpath, result.nodes.length, sample, result.nodes[0] || hintNode);
    return {
      xpath,
      matchCount: result.nodes.length,
      sample: sample.slice(0, 240),
      error: result.error,
      ...scored
    };
  }

  function inferUrl(sourceUrl, kind) {
    if (!sourceUrl) return "";
    try {
      const u = new URL(sourceUrl);
      if (/powerplatform\.com|powerapps\.com/i.test(u.hostname)) return "runtime-app.powerplatform.com";
      if (/veevavault\.com/i.test(u.hostname)) return u.hostname.replace(/^www\./, "");
      if (/AllItems\.aspx/i.test(u.pathname)) {
        const parts = u.pathname.split("/").filter(Boolean);
        const listIdx = parts.findIndex((p) => /list/i.test(decodeURIComponent(p)));
        if (listIdx >= 0 && parts[listIdx + 1]) {
          return decodeURIComponent(parts[listIdx] + "/" + parts[listIdx + 1] + "/AllItems.aspx");
        }
        return "AllItems.aspx";
      }
      if (u.hostname && u.hostname !== "localhost") return u.hostname.replace(/^www\./, "");
      return u.hostname;
    } catch (e) {
      if (kind === "iframe") return "";
      return String(sourceUrl).slice(0, 80);
    }
  }

  global.WxPath = {
    slugKey,
    nodeText,
    evaluateXPath,
    collectFields,
    rankFields,
    documentRichness,
    shadowGaps,
    assessPath,
    inferUrl,
    unique
  };
})(window);
