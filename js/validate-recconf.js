/**
 * Validation harness (developer tool, not shipped in the browser app).
 *
 * Runs every HTML file under the given roots through the assistant's field
 * detector, then replays each <WebPageDataExtraction> rule from a .recconf
 * against the same documents and reports whether the assistant would have
 * suggested a path reaching the same node.
 *
 *   node js/validate-recconf.js <recconf> <root> [root...]
 */
const fs = require("fs");
const path = require("path");
const { JSDOM, VirtualConsole } = require("jsdom");

// Saved enterprise pages carry CSS that jsdom's parser cannot read (nested
// @media for high-contrast mode). It only affects styling, which we never
// look at, so drop the noise instead of printing the whole stylesheet.
const quiet = new VirtualConsole();
const domOpts = { contentType: "text/html", virtualConsole: quiet };

const boot = new JSDOM("<!doctype html><html><body></body></html>", { runScripts: "outside-only" });
boot.window.eval(fs.readFileSync(path.join(__dirname, "xpath.js"), "utf8"));
const WxPath = boot.window.WxPath;

function stripScripts(html) {
  return String(html)
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/\son[a-z]+="[^"]*"/gi, "")
    .replace(/\son[a-z]+='[^']*'/gi, "");
}

function readRules(file) {
  const xml = fs.readFileSync(file, "utf8");
  const rules = [];
  const re = /<WebPageDataExtraction>([\s\S]*?)<\/WebPageDataExtraction>/g;
  let m;
  while ((m = re.exec(xml))) {
    const grab = (tag) => {
      const g = new RegExp("<" + tag + ">([\\s\\S]*?)</" + tag + ">").exec(m[1]);
      return g
        ? g[1].replace(/&gt;/g, ">").replace(/&lt;/g, "<").replace(/&quot;/g, '"').replace(/&amp;/g, "&").trim()
        : "";
    };
    rules.push({ key: grab("Key"), path: grab("Path"), url: grab("Url") });
  }
  return rules;
}

function walkHtml(root) {
  const out = [];
  if (fs.existsSync(root) && fs.statSync(root).isFile()) return [root];
  (function rec(dir) {
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch (e) {
      return;
    }
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) rec(full);
      else if (/\.x?html?$/i.test(e.name)) out.push(full);
    }
  })(root);
  return out;
}

function evalNodes(doc, xpath) {
  try {
    const res = doc.evaluate(xpath, doc, null, 7, null);
    const nodes = [];
    for (let i = 0; i < res.snapshotLength; i += 1) nodes.push(res.snapshotItem(i));
    return nodes;
  } catch (e) {
    return null;
  }
}

const args = process.argv.slice(2);
const maxKbArg = args.find((a) => a.startsWith("--max-kb="));
const maxKb = maxKbArg ? Number(maxKbArg.split("=")[1]) : Infinity;
const positional = args.filter((a) => !a.startsWith("--"));
const recconf = positional[0];
const roots = positional.slice(1);
const rules = readRules(recconf);

const files = [];
roots.forEach((r) => walkHtml(r).forEach((f) => files.push(f)));
const skipped = files.filter((f) => fs.statSync(f).size / 1024 > maxKb).length;
if (skipped) console.log("Skipping " + skipped + " file(s) over " + maxKb + " KB");
files.splice(0, files.length, ...files.filter((f) => fs.statSync(f).size / 1024 <= maxKb));

console.log("Rules in recconf:", rules.length);
console.log("HTML files found:", files.length);
console.log("");

const ruleHits = new Map();
rules.forEach((r) => ruleHits.set(r.key, []));
const docRows = [];

files.forEach((file) => {
  const stat = fs.statSync(file);
  let raw;
  try {
    raw = fs.readFileSync(file, "utf8");
  } catch (e) {
    return;
  }
  let doc;
  try {
    doc = new JSDOM(stripScripts(raw), domOpts).window.document;
  } catch (e) {
    docRows.push({ file, kb: stat.size / 1024, error: e.message });
    return;
  }

  const richness = WxPath.documentRichness(doc);
  let ranked = [];
  try {
    ranked = WxPath.rankFields(doc, WxPath.collectFields(doc));
  } catch (e) {
    docRows.push({ file, kb: stat.size / 1024, richness, error: e.message });
    return;
  }

  // Which nodes can the assistant reach with its top suggestion per field?
  const reachable = new Map();
  ranked.forEach((f) => {
    const nodes = evalNodes(doc, f.best.xpath);
    if (nodes) nodes.forEach((n) => reachable.set(n, f));
  });
  // ...and with any suggestion, not just the top one.
  const reachableAny = new Map();
  ranked.forEach((f) => {
    f.paths.forEach((p) => {
      const nodes = evalNodes(doc, p);
      if (nodes) nodes.forEach((n) => { if (!reachableAny.has(n)) reachableAny.set(n, { field: f, path: p }); });
    });
  });

  const matchedRules = [];
  rules.forEach((r) => {
    const nodes = evalNodes(doc, r.path);
    if (nodes === null) {
      ruleHits.get(r.key).push({ file, status: "INVALID XPATH" });
      return;
    }
    if (!nodes.length) return;
    const target = nodes[0];
    const text = (target.textContent || target.value || target.getAttribute("value") || "").replace(/\s+/g, " ").trim();
    const top = reachable.get(target);
    const any = reachableAny.get(target);
    matchedRules.push(r.key);
    ruleHits.get(r.key).push({
      file,
      matchCount: nodes.length,
      value: text.slice(0, 70),
      valueLen: text.length,
      suggestedTop: top ? top.label : null,
      suggestedAny: any ? any.field.label : null,
      suggestedPath: any ? any.path : null
    });
  });

  docRows.push({
    file,
    kb: stat.size / 1024,
    richness,
    fields: ranked.length,
    withValue: ranked.filter((f) => f.hasValue).length,
    matchedRules
  });
});

console.log("=".repeat(100));
console.log("PART 1 - every HTML file, what the assistant finds");
console.log("=".repeat(100));
docRows
  .slice()
  .sort((a, b) => (b.fields || 0) - (a.fields || 0))
  .forEach((d) => {
    const name = path.relative(process.cwd(), d.file).replace(/^.*\/T\//, "");
    if (d.error) {
      console.log("  ERR   " + name + "  -> " + d.error);
      return;
    }
    const flag = d.fields === 0 ? "EMPTY " : "  ok  ";
    console.log(
      flag +
        String(d.fields).padStart(3) +
        " fields (" +
        String(d.withValue).padStart(3) +
        " with value)  " +
        String(Math.round(d.kb)).padStart(6) +
        " KB  " +
        path.basename(path.dirname(d.file)) + "/" + path.basename(d.file) +
        (d.matchedRules.length ? "   rules: " + d.matchedRules.join(", ") : "")
    );
  });

console.log("");
console.log("=".repeat(100));
console.log("PART 2 - each deployed rule, replayed against the saved pages");
console.log("=".repeat(100));
rules.forEach((r) => {
  const hits = ruleHits.get(r.key);
  if (!hits.length) {
    console.log("\n" + r.key + "   [url: " + r.url + "]");
    console.log("   NO SAVED PAGE MATCHES THIS RULE");
    return;
  }
  console.log("\n" + r.key + "   [url: " + r.url + "]");
  hits.forEach((h) => {
    if (h.status) {
      console.log("   " + h.status + "  " + path.basename(h.file));
      return;
    }
    const where = path.basename(path.dirname(h.file)) + "/" + path.basename(h.file);
    console.log(
      "   " + (h.matchCount === 1 ? "1 node " : h.matchCount + " nodes") +
        "  " + where +
        "  value=" + JSON.stringify(h.value) + (h.valueLen > 70 ? " (" + h.valueLen + " chars)" : "")
    );
    if (h.suggestedTop) console.log("        assistant top suggestion for that node: " + h.suggestedTop);
    else if (h.suggestedAny) console.log("        assistant reaches it only via alternative: " + h.suggestedAny + "  ->  " + h.suggestedPath);
    else console.log("        ASSISTANT DOES NOT SUGGEST ANY PATH TO THIS NODE");
  });
});
