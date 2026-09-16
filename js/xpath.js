(function (global) {
  function xpathLiteral(value) {
    const s = String(value);
    if (!s.includes("'")) return "'" + s + "'";
    if (!s.includes('"')) return '"' + s + '"';
    return "concat('" + s.replace(/'/g, "',\"'\",'") + "')";
  }

  /** Build-generated class names change on every release, so never anchor on them. */
  function looksHashed(token) {
    if (/^css-/.test(token) || token.includes("___") || token.includes("-o_O-")) return true;
    if (/[a-zA-Z]\d{4,}/.test(token)) return true;
    // Compiled atomic CSS, as shipped by Atlassian and similar: a short
    // underscore-prefixed jumble of letters and digits such as _1reo15vq.
    if (/^_+[a-z0-9]{4,12}$/i.test(token) && /\d/.test(token)) return true;
    return false;
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

  /**
   * Test hooks are the one attribute a component library commits to keeping:
   * they are written by hand, referenced by the app's own test suite, and
   * survive the restyling that destroys class names. Prefer them over anything
   * else when anchoring a path.
   */
  const STABLE_ATTRS = ["data-testid", "data-test-id", "data-test", "data-qa", "data-automation-id", "data-cy"];

  function stableAttr(el) {
    if (!el || !el.getAttribute) return null;
    for (const name of STABLE_ATTRS) {
      const value = el.getAttribute(name);
      if (value && value.length <= 200) return { name, value };
    }
    return null;
  }

  /** A hook shared by several elements cannot identify one of them. */
  function hookIsUnique(el, attr) {
    const doc = el.ownerDocument;
    if (!doc) return false;
    let count = 0;
    const all = doc.querySelectorAll("[" + attr.name + "]");
    for (const node of all) {
      if (node.getAttribute(attr.name) === attr.value) {
        count += 1;
        if (count > 1) return false;
      }
    }
    return count === 1;
  }

  /**
   * The element's own test hook, else the nearest ancestor's within reach.
   * Skip a hook that the page repeats: Jira gives every person on the screen
   * the same profile-card hook, so anchoring on it reads the wrong person.
   */
  function stableAttrNear(el, depth) {
    let node = el;
    for (let i = 0; node && i <= (depth === undefined ? 4 : depth); i += 1) {
      const hit = stableAttr(node);
      if (hit && hookIsUnique(node, hit)) return { attr: hit, host: node, distance: i };
      node = node.parentElement;
    }
    return null;
  }

  /*
   * Words that describe where a thing sits in the widget tree rather than what
   * it holds. A test hook like issue-field-status.ui.status-view.status-button
   * is mostly scaffolding; "status" is the part a person would recognise.
   */
  const ID_NOISE = new RegExp("^(ui|views?|read|readview|full|inline|edit|editable|container|wrapper|wrap|item|items|" +
    "text|content|button|btn|field|fields|label|value|root|main|next|new|common|styled|heading|layout|base|" +
    "foundation|link|icon|group|list|cell|row|col|column|trigger|menu|dropdown|tooltip|spotlight|target|ref|lazy|" +
    "div|span|box|inner|outer|primary|secondary|default|chevron|wrapper2|ak|css|compiled|ui2|panel|section|" +
    "component|element|node|display|render|show|hidden|visible|active|selected|title|header|body|block|" +
    "area|region|slot|frame|stack|grid|flex)$", "i");

  function splitIdWords(segment) {
    return String(segment)
      .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
      .split(/[^A-Za-z0-9]+/)
      .filter(Boolean);
  }

  /**
   * Turn a test hook into something a person would recognise, reading from the
   * right because the specific part is written last. Returns null when nothing
   * but scaffolding is left, so the caller can fall back to a real caption.
   */
  function testIdLabel(id) {
    const segments = String(id || "").split(".").filter(Boolean);
    for (let i = segments.length - 1; i >= 0; i -= 1) {
      const words = splitIdWords(segments[i]).filter((w) => !ID_NOISE.test(w));
      if (!words.length) continue;
      const name = words.join(" ").trim();
      if (name.length >= 3 && /[A-Za-z]/.test(name)) return name;
    }
    return null;
  }

  /** Paths anchored on a test hook, which outlive the surrounding markup. */
  function stableAttrPaths(el) {
    const paths = [];
    const own = stableAttr(el);
    const tag = el.tagName.toLowerCase();
    if (own && hookIsUnique(el, own)) {
      const lit = xpathLiteral(own.value);
      const leaf = deepestTextLeaf(el);
      if (leaf) {
        paths.push("(//" + tag + "[@" + own.name + "=" + lit + "]//" +
          leaf.tagName.toLowerCase() + "[not(*)][normalize-space()])[1]");
      }
      paths.push("//" + tag + "[@" + own.name + "=" + lit + "]");
      paths.push("//*[@" + own.name + "=" + lit + "]");
    }
    const near = stableAttrNear(el, 4);
    if (near && near.distance > 0) {
      const lit = xpathLiteral(near.attr.value);
      const host = "//*[@" + near.attr.name + "=" + lit + "]";
      const cls = safeClassToken(el.getAttribute("class"));
      if (cls) {
        paths.push("(" + host + "//" + tag + "[contains(@class," + xpathLiteral(cls) + ")])[1]");
      }
      paths.push("(" + host + "//" + tag + "[normalize-space()])[1]");
    }
    return paths;
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

  /*
   * A path like //*[@data-testid='x'] walks the whole document, which on a
   * page the size of a Jira work item is tens of thousands of elements. The
   * same paths are asked for repeatedly while a field list is built and again
   * when a field is opened, and a saved page never changes, so the answer is
   * worth keeping. Without this the browser tab stops responding.
   */
  const EVAL_CACHE = new WeakMap();

  function evaluateXPath(doc, xpath) {
    let perDoc = EVAL_CACHE.get(doc);
    if (perDoc) {
      const hit = perDoc.get(xpath);
      if (hit) return hit;
    } else {
      perDoc = new Map();
      EVAL_CACHE.set(doc, perDoc);
    }

    let result;
    const out = [];
    try {
      const snap = doc.evaluate(xpath, doc, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);
      for (let i = 0; i < snap.snapshotLength; i += 1) out.push(snap.snapshotItem(i));
      result = { ok: true, error: null, nodes: out };
    } catch (err) {
      result = { ok: false, error: String(err && err.message ? err.message : err), nodes: [] };
    }
    perDoc.set(xpath, result);
    return result;
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
    // Screen-reader markup often repeats a value beside the visible copy, so a
    // doubled reading means the path sits above both of them.
    if (sample && sample.length >= 8 && sample.length % 2 === 0) {
      const half = sample.length / 2;
      if (sample.slice(0, half) === sample.slice(half)) {
        score -= 15;
        risks.push("Returns the same text twice, so the path is above the value");
      }
    }
    // "Mahendra Joshi Assign to me" is the value plus the label of a button
    // that happens to live inside the same box. Prefer the tighter path.
    if (node && node.querySelector) {
      const control = Array.from(node.querySelectorAll("a, button, [role='button']"))
        .find((c) => nodeText(c));
      if (control) {
        score -= 14;
        risks.push("Includes the text of a control inside the field, such as " +
          JSON.stringify(nodeText(control).slice(0, 24)));
      }
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
    // A generated class name is rewritten by the next release, so a path built
    // on one reads correctly today and silently stops matching later.
    const classTokens = (xpath.match(/contains\(@class,\s*'([^']+)'/g) || [])
      .map((m) => m.replace(/^contains\(@class,\s*'/, ""));
    if (classTokens.some(looksHashed)) {
      score -= 18;
      risks.push("Anchors on a generated class name that changes when the site is next released");
    }
    if (xpath.includes("@data-control-name") || xpath.includes("@for=") || xpath.includes("@title=")) score += 10;
    // A test hook is maintained on purpose, so it outlives class names.
    if (STABLE_ATTRS.some((a) => xpath.includes("@" + a + "="))) score += 12;
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

  /* A caption is a caption because of where it sits, not which tag it uses. */
  const INTERACTIVE = "a,button,input,textarea,select,[role='button'],[role='link'],[role='menuitem'],[role='tab'],[onclick]";
  const FILE_NAME = /\.[a-z0-9]{2,8}$/i;
  /* Captions belonging to a disclosure control, which reveal nothing. */
  const DISCLOSURE = /^(collapse|expand|show|hide|toggle|open|close)\b/i;

  /** The element that actually holds the text, with nothing nested below it. */
  function deepestTextLeaf(root) {
    if (!root) return null;
    const leaves = Array.from(root.querySelectorAll("*")).filter((n) => !n.children.length && nodeText(n));
    return leaves.length ? leaves[0] : null;
  }

  function isInteractive(el) {
    if (!el) return false;
    const tag = el.tagName.toLowerCase();
    if (/^(a|button|input|textarea|select)$/.test(tag)) return true;
    const role = el.getAttribute("role");
    if (role && /^(button|link|menuitem|tab)$/.test(role)) return true;
    return !!el.querySelector(INTERACTIVE);
  }

  /**
   * "Add object" and "More actions for SLA Panel" are buttons sitting where a
   * value would sit. If every piece of text in here belongs to something
   * clickable then this row offers an action, not data.
   */
  function textIsAllInteractive(el) {
    const holders = Array.from(el.querySelectorAll("*")).filter((n) => !n.children.length && nodeText(n));
    if (!holders.length) return isInteractive(el);
    return holders.every((n) => {
      let node = n;
      while (node && node !== el.parentElement) {
        const tag = node.tagName.toLowerCase();
        const role = node.getAttribute && node.getAttribute("role");
        if (/^(a|button)$/.test(tag) || (role && /^(button|link|menuitem|tab)$/.test(role))) return true;
        node = node.parentElement;
      }
      return false;
    });
  }

  /**
   * A caption is a control only when its own text belongs to one. Field
   * headings often carry an empty edit button beside the words, which says
   * nothing about the caption itself.
   */
  function captionIsControl(el) {
    const tag = el.tagName.toLowerCase();
    if (/^(a|button|input|textarea|select)$/.test(tag)) return true;
    const role = el.getAttribute("role");
    if (role && /^(button|link|menuitem|tab)$/.test(role)) return true;
    return textIsAllInteractive(el);
  }

  /** Never anchor on a class name a build tool invented. */
  function safeClassToken(cls) {
    const token = stableClassToken(cls);
    return token && !looksHashed(token) ? token : "";
  }

  /* A hook that says "field heading" is the library declaring a field outright. */
  const CAPTION_DECLARED = /(field|heading|label|caption)/i;
  /* Hooks that name a piece of page furniture rather than a field. */
  const LAYOUT_HOOK = /(collapsible|group|section|panel|sidebar|nav|menu|dialog|modal|toolbar|breadcrumb|tab|popup)/i;

  function hookText(el) {
    const hit = stableAttr(el);
    return hit ? hit.value : "";
  }

  /**
   * React apps rarely use <label>. They draw a field as a row holding a caption
   * next to its value, both plain divs. Match on that shape: a container with
   * exactly two element children, one a short piece of static text, the other
   * holding the value.
   *
   * Where the library declares the caption a field heading, take its word for
   * it. Where the shape is all we have, be strict, because on a large page this
   * pattern also matches nav sections and truncated file names.
   */
  function captionRows(doc) {
    const out = [];
    doc.querySelectorAll("*").forEach((row) => {
      if (row.children.length !== 2) return;
      const cap = row.children[0];
      const val = row.children[1];
      const label = nodeText(cap).replace(/[:*]\s*$/, "").trim();
      const value = nodeText(val);
      if (!label || !value) return;
      if (label.length > 40 || label.split(" ").length > 4) return;
      if (!/[A-Za-z]/.test(label) || DISCLOSURE.test(label)) return;
      if (value === label || value.startsWith(label)) return;
      if (captionIsControl(cap)) return;

      const hooks = hookText(cap) + " " + hookText(row);
      if (LAYOUT_HOOK.test(hooks)) return;
      const declared = CAPTION_DECLARED.test(hooks);

      // A caption and value that join into one file name are a truncated file
      // name, not a field. Jira splits "logs-2026.zip" across two spans.
      if (FILE_NAME.test(label) || FILE_NAME.test(label + value)) return;
      // A value that opens with punctuation is a fragment, not a reading.
      if (!/[A-Za-z0-9]{2}/.test(value) || /^[^A-Za-z0-9]/.test(value)) return;
      // Only guess that clickable text is a value when nothing declared it one.
      // A person's name inside a profile-card button is still the value.
      if (!declared && textIsAllInteractive(val)) return;

      // The row must hold nothing but the caption and the value. Compare
      // without spaces, since the gap between two children is not meaningful.
      const bare = (s) => s.replace(/\s+/g, "");
      if (bare(nodeText(row)) !== bare(label) + bare(value)) return;
      out.push({ row, caption: cap, value: val, label, declared });
    });
    return out;
  }

  /**
   * Anchor on the row's test hook when there is one, because that names the
   * field and survives restyling. Otherwise anchor on the caption's text,
   * which is what a person reads off the screen.
   */
  function captionRowPaths(row, cap, valueEl, label) {
    const paths = [];
    const lit = xpathLiteral(label);
    const vtag = valueEl.tagName.toLowerCase();
    const host = stableAttrNear(row, 2);
    if (host) {
      const hostPath = "//*[@" + host.attr.name + "=" + xpathLiteral(host.attr.value) + "]";
      // The deepest element holding the text reads the value on its own. An
      // outer wrapper picks up whatever else shares the box, such as an
      // avatar's hidden copy of the name or an "Assign to me" button.
      const leaf = deepestTextLeaf(valueEl);
      if (leaf) {
        const ltag = leaf.tagName.toLowerCase();
        // not(*) keeps to an element that holds text and nothing else, so a
        // wrapper carrying both the avatar's hidden copy of a name and the
        // visible one cannot match.
        paths.push("(" + hostPath + "/*[2]//" + ltag + "[not(*)][normalize-space()])[1]");
        paths.push("(" + hostPath + "/*[2]//" + ltag + "[normalize-space()])[1]");
      }
      const inner = innermostWithText(valueEl);
      const itag = inner ? inner.tagName.toLowerCase() : vtag;
      paths.push("(" + hostPath + "/*[2]//" + itag + "[normalize-space()])[1]");
      paths.push("(" + hostPath + "/*[2])[1]");
    }
    paths.push("(//*[normalize-space(text())=" + lit + "]/following::" + vtag + "[normalize-space()])[1]");
    paths.push("(//*[normalize-space(text())=" + lit + "]/ancestor::*[2]/*[2])[1]");
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

  /*
   * A hook that says "field" in it is the component library telling us this is
   * a field, which is a much safer signal than guessing from every test hook on
   * the page. Jira's status button is the case this exists for: nothing
   * captions it, so without the hook the value has no name at all.
   */
  const FIELD_MARKER = /(^|[^a-z])fields?([^a-z]|$)/i;

  function attrFields(doc) {
    const out = [];
    const taken = new Set();
    doc.querySelectorAll("[data-testid], [data-test-id], [data-qa], [data-automation-id]").forEach((el) => {
      const attr = stableAttr(el);
      if (!attr || !FIELD_MARKER.test(attr.value)) return;
      const value = nodeText(el);
      if (!value || value.length > 80) return;
      // Keep the innermost holder: an outer wrapper repeats its child's text.
      if (el.querySelector("[data-testid], [data-test-id], [data-qa], [data-automation-id]")) return;
      // Text that belongs to a control is an action such as "Add object",
      // offered where a value would sit because the field is empty.
      if (textIsAllInteractive(el)) return;
      const label = testIdLabel(attr.value);
      if (!label || taken.has(label.toLowerCase())) return;
      taken.add(label.toLowerCase());
      out.push({ element: el, label, attr });
    });
    return out;
  }

  /**
   * The record's own identifier is the field Task Mining needs most and the one
   * least likely to be captioned: it is drawn as a heading or a breadcrumb. The
   * page URL names it, so text matching the last identifier-looking segment of
   * the path is that identifier. Read from the right, since that is where the
   * record sits in a path like /browse/CBE-55689.
   */
  const ROUTE_WORD = /^(view|edit|list|new|index|home|detail|details|page|tab|browse|issues?|records?|item)$/i;

  function recordKeyField(doc, url) {
    if (!url) return null;
    let path = "";
    try {
      path = decodeURIComponent(String(url).replace(/[?#].*$/, ""));
    } catch (err) {
      path = String(url).replace(/[?#].*$/, "");
    }
    const segments = path.split("/").filter(Boolean).slice(1);
    for (let i = segments.length - 1; i >= 0; i -= 1) {
      const seg = segments[i];
      if (seg.length < 3 || seg.length > 40) continue;
      if (ROUTE_WORD.test(seg) || FILE_NAME.test(seg)) continue;
      if (!/\d/.test(seg) || !/[A-Za-z0-9]/.test(seg)) continue;
      const holder = Array.from(doc.querySelectorAll("a, span, h1, h2, h3, div, td"))
        .find((el) => !el.children.length && nodeText(el) === seg);
      if (holder) return { element: holder, label: "Record key", value: seg };
    }
    return null;
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
    const paths = stableAttrPaths(el);
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

  function collectFields(doc, opts) {
    const fields = [];
    const seen = new Set();
    const claimed = new Map();
    function add(label, el, extraPaths, kind) {
      if (!el) return;
      const cleanLabel = String(label || "").replace(/\s+/g, " ").trim();
      if (!cleanLabel) return;
      const key = cleanLabel + "|" + (el.getAttribute("data-control-name") || el.id || el.tagName);
      if (seen.has(key)) return;
      seen.add(key);
      const text = nodeText(el);
      if (text && !claimed.has(text)) claimed.set(text, el);
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

    // A caption drawn as a plain div, which is how React apps render a field.
    // These run after the <label> pass so a real label always wins the name.
    captionRows(doc).forEach((r) => {
      const target = innermostWithText(r.value) || r.value;
      add(r.label, target, captionRowPaths(r.row, r.caption, r.value, r.label), "text");
    });

    /*
     * A heading is a value nobody captions: the page prints the record's title
     * as an <h1> and expects you to read it. Take the name from the hook, since
     * the heading's own text is the value. A heading whose hook merely repeats
     * its text is a section caption, not a field, and page furniture such as a
     * collapsible group names itself in the hook too.
     */
    const headings = doc.querySelectorAll("h1, h2, h3, [role='heading']");
    let mainHeading = true;
    headings.forEach((h) => {
      const text = nodeText(h);
      if (!text || text.length > 200 || DISCLOSURE.test(text)) return;
      const hook = stableAttr(h);
      if (hook && LAYOUT_HOOK.test(hook.value)) return;
      const named = hook ? testIdLabel(hook.value) : null;
      if (named && named.toLowerCase() === text.toLowerCase()) return;
      const label = named || (mainHeading && h.tagName === "H1" ? "Page heading" : null);
      if (!label) return;
      if (h.tagName === "H1") mainHeading = false;
      add(label, h, stableAttrPaths(h), "text");
    });

    // Values the component library marks as a field but nothing captions.
    attrFields(doc).forEach((f) => {
      // A caption already named this value, and a name a person wrote beats one
      // read off a hook, so do not offer the same reading twice.
      const twin = claimed.get(nodeText(f.element));
      if (twin && (twin === f.element || f.element.contains(twin))) return;
      add(f.label, f.element, stableAttrPaths(f.element), "text");
    });

    const record = recordKeyField(doc, opts && opts.url);
    if (record) add(record.label, record.element, stableAttrPaths(record.element), "text");

    return fields;
  }

  const GENERIC_LABEL = /^(Label|HtmlText|Text|Rectangle|Box|Item|Value|Field|Control)\s*\d*$/i;

  /*
   * Each candidate costs a walk of the whole document, and a field carries up
   * to eight. Ranking only needs the best path per field, because the full
   * table of candidates is worked out again when a field is opened. So stop as
   * soon as a path is clearly right, and once the page has taken long enough,
   * settle for the first candidate of each remaining field rather than leaving
   * the user in front of a frozen tab.
   */
  const GOOD_ENOUGH = 85;
  const RANK_BUDGET_MS = 2000;

  function rankFields(doc, fields, limit) {
    const max = limit || 400;
    const out = [];
    const started = Date.now();
    fields.slice(0, max).forEach((f) => {
      const labelNorm = f.label.toLowerCase();
      const hurried = Date.now() - started > RANK_BUDGET_MS;
      let best = null;
      for (const p of f.paths) {
        const a = assessPath(doc, p, f.element);
        // A path that returns the field's own caption has latched onto the
        // label instead of the value next to it.
        if (a.sample && a.sample.toLowerCase() === labelNorm) {
          a.score = Math.max(1, a.score - 45);
          a.risks = a.risks.concat("This returns the field label, not its value");
          if (a.confidence === "high") a.confidence = "low";
        }
        if (!best || a.score > best.score) best = a;
        if (best.matchCount === 1 && best.score >= GOOD_ENOUGH) break;
        if (hurried && best.matchCount === 1) break;
      }
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
    // A key becomes the name of a Task Mining rule, so two fields cannot share
    // one. The list is sorted by score, so the first of a name is the best of it.
    const byPath = new Set();
    const byKey = new Set();
    return out.filter((f) => {
      if (byPath.has(f.best.xpath) || byKey.has(f.key)) return false;
      byPath.add(f.best.xpath);
      byKey.add(f.key);
      return true;
    });
  }

  function documentRichness(doc) {
    const controls = doc.querySelectorAll("[data-control-name]").length;
    const labels = doc.querySelectorAll("label").length;
    const headers = doc.querySelectorAll("table th").length;
    const titled = doc.querySelectorAll("input[title], textarea[title]").length;
    return controls + labels + headers + titled + titleCaptions(doc).length +
      captionRows(doc).length + attrFields(doc).length;
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
    captionRows,
    attrFields,
    testIdLabel,
    recordKeyField,
    assessPath,
    inferUrl,
    unique
  };
})(window);
