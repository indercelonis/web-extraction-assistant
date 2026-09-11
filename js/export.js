(function (global) {
  function xmlEscape(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function pathForXml(xpath) {
    return xmlEscape(xpath).replace(/&gt;=/g, "&gt;=");
  }

  function extractionXml(rule) {
    return [
      "    <WebPageDataExtraction>",
      "      <Key>" + xmlEscape(rule.key) + "</Key>",
      "      <Path>" + pathForXml(rule.path) + "</Path>",
      "      <Url>" + xmlEscape(rule.url) + "</Url>",
      "    </WebPageDataExtraction>"
    ].join("\n");
  }

  function blockXml(rules) {
    return "  <WebPageDataExtractions>\n" + rules.map(extractionXml).join("\n") + "\n  </WebPageDataExtractions>";
  }

  function mergeRecconf(raw, rules) {
    const block = blockXml(rules);
    if (!raw) {
      return '<?xml version="1.0"?>\n<ConfigurationTransport>\n' + block + "\n</ConfigurationTransport>\n";
    }
    if (/<WebPageDataExtractions>[\s\S]*<\/WebPageDataExtractions>/.test(raw)) {
      return raw.replace(/<WebPageDataExtractions>[\s\S]*<\/WebPageDataExtractions>/, block.trim());
    }
    return raw.replace(/<\/ConfigurationTransport>/, block + "\n</ConfigurationTransport>");
  }

  function csv(rules) {
    const rows = [["key", "url", "path", "confidence", "matches", "sample"].join(",")];
    rules.forEach((r) => {
      const cells = [r.key, r.url, r.path, r.confidence, r.matchCount, r.sample].map((c) => '"' + String(c || "").replace(/"/g, '""') + '"');
      rows.push(cells.join(","));
    });
    return rows.join("\n");
  }

  function download(filename, text, mime) {
    const blob = new Blob([text], { type: mime || "text/plain" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  global.WxExport = { xmlEscape, extractionXml, blockXml, mergeRecconf, csv, download };
})(window);
