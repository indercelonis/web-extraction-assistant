const fs = require("fs");
const path = require("path");
const { JSDOM } = require("jsdom");

const boot = new JSDOM("<!doctype html><html><body></body></html>", { runScripts: "outside-only" });
boot.window.eval(fs.readFileSync(path.join(__dirname, "xpath.js"), "utf8"));
boot.window.eval(fs.readFileSync(path.join(__dirname, "ingest.js"), "utf8"));
boot.window.eval(fs.readFileSync(path.join(__dirname, "folder.js"), "utf8"));

const { WxIngest, WxFolder } = boot.window;
let passed = 0;
let failed = 0;

function check(condition, name, detail) {
  if (condition) {
    passed += 1;
    console.log("PASS", name);
  } else {
    failed += 1;
    console.error("FAIL", name, detail || "");
  }
}

function fakeFile(name, contents, options) {
  const opts = options || {};
  return {
    name,
    type: opts.type || "",
    size: opts.size === undefined ? Buffer.byteLength(contents || "") : opts.size,
    webkitRelativePath: opts.relativePath || "",
    lastModified: 1,
    text: opts.readError
      ? async () => { throw new Error(opts.readError); }
      : async () => String(contents || "")
  };
}

function fileEntry(name, file, shouldFail) {
  return {
    name,
    isFile: true,
    isDirectory: false,
    file(resolve, reject) {
      if (shouldFail) reject(new Error("denied"));
      else resolve(file);
    }
  };
}

function directoryEntry(name, children) {
  return {
    name,
    isFile: false,
    isDirectory: true,
    createReader() {
      let delivered = false;
      return {
        readEntries(resolve) {
          if (delivered) resolve([]);
          else {
            delivered = true;
            resolve(children);
          }
        }
      };
    }
  };
}

async function run() {
  check(WxIngest.kindOf("PAGE.HTML") === "html", "HTML extension is case-insensitive");
  check(WxIngest.kindOf("page.xhtml") === "html", "XHTML is accepted");
  check(WxIngest.kindOf("without-extension", "text/html") === "html", "HTML MIME type is accepted");
  check(WxIngest.kindOf("photo.png") === "image", "Non-HTML type is classified");

  const mixed = [
    fakeFile("page.html", "<title>Main</title><label>Name</label><span>Ada</span>", { relativePath: "case/page.html" }),
    fakeFile("inner.HTM", "<title>Inner</title><table><tr><th>ID</th></tr><tr><td>42</td></tr></table>", { relativePath: "case/sub/inner.HTM" }),
    fakeFile("data.xhtml", "<title>XHTML</title><label>Status</label><span>Done</span>", { relativePath: "case/data.xhtml" }),
    fakeFile("image.png", "not-an-image", { relativePath: "case/image.png", type: "image/png" }),
    fakeFile(".DS_Store", "metadata", { relativePath: "case/.DS_Store" }),
    fakeFile("notes.txt", "ignore me", { relativePath: "case/notes.txt" })
  ];
  const report = await WxIngest.ingestFiles(mixed, { mode: "folder" });
  check(report.docs.length === 3, "Mixed folder processes only its three HTML files", report.docs.length);
  check(report.input.ignoredFiles === 3, "Mixed folder counts ignored non-HTML files", report.input.ignoredFiles);
  check(report.images.length === 0, "Folder images are not sent to OCR");
  check(report.docs.some((d) => d.name === "case/sub/inner.HTM"), "Nested relative path is preserved");
  check(report.errors.length === 0, "Valid mixed folder has no errors", report.errors.join(" | "));

  const noHtml = await WxIngest.ingestFiles([
    fakeFile("photo.jpg", "x", { type: "image/jpeg", relativePath: "images/photo.jpg" }),
    fakeFile("readme.txt", "x", { relativePath: "images/readme.txt" })
  ], { mode: "folder" });
  check(noHtml.docs.length === 0, "Folder without HTML creates no documents");
  check(noHtml.errors.some((e) => /does not contain any HTML/i.test(e)), "Folder without HTML gets a clear error", noHtml.errors);
  check(noHtml.input.ignoredFiles === 2, "Folder without HTML reports ignored count");

  const empty = await WxIngest.ingestFiles([], { mode: "folder" });
  check(empty.errors.some((e) => /empty|could not be read/i.test(e)), "Empty folder gets a clear error", empty.errors);

  const duplicate = await WxIngest.ingestFiles([
    fakeFile("a.html", "<p>one</p>", { relativePath: "root/a.html" }),
    fakeFile("A.HTML", "<p>two</p>", { relativePath: "ROOT/A.HTML" })
  ], { mode: "folder" });
  check(duplicate.docs.length === 1, "Duplicate relative path is processed once", duplicate.docs.length);
  check(duplicate.input.duplicateFiles === 1, "Duplicate relative path is reported");

  const tooLarge = await WxIngest.ingestFiles([
    fakeFile("huge.html", "", { relativePath: "root/huge.html", size: WxIngest.MAX_BYTES + 1 })
  ], { mode: "folder" });
  check(tooLarge.docs.length === 0, "Oversized HTML is skipped");
  check(tooLarge.input.oversizedFiles === 1, "Oversized HTML is counted");
  check(tooLarge.errors.some((e) => /larger than 60 MB/i.test(e)), "Oversized HTML explains its limit", tooLarge.errors);

  // A ZIP is a container, not a document: only the HTML inside it is parsed, so
  // it must not be judged by the assets it carries.
  const bigArchive = await WxIngest.ingestFiles([
    fakeFile("save.zip", "", { size: WxIngest.MAX_BYTES + 1 })
  ], { mode: "files" });
  check(bigArchive.input.oversizedFiles === 0,
    "An archive above the document limit is still opened", bigArchive.errors);
  check(!bigArchive.errors.some((e) => /larger than/i.test(e)),
    "An archive above the document limit is not refused for its size", bigArchive.errors);

  const hugeArchive = await WxIngest.ingestFiles([
    fakeFile("save.zip", "", { size: WxIngest.MAX_ARCHIVE_BYTES + 1 })
  ], { mode: "files" });
  check(hugeArchive.input.oversizedFiles === 1, "An archive above the archive limit is skipped");
  check(hugeArchive.errors.some((e) => /larger than 500 MB/i.test(e)),
    "The archive limit is explained in its own terms", hugeArchive.errors);

  const unreadable = await WxIngest.ingestFiles([
    fakeFile("locked.html", "", { relativePath: "root/locked.html", readError: "permission denied" })
  ], { mode: "folder" });
  check(unreadable.docs.length === 0, "Unreadable HTML is skipped");
  check(unreadable.errors.some((e) => /permission denied/i.test(e)), "Unreadable HTML reports the read failure");

  const malformed = await WxIngest.ingestFiles([
    fakeFile("broken.html", "<html><title>Broken<label>Name<div>Value")
  ], { mode: "folder" });
  check(malformed.docs.length === 1, "Malformed but parseable HTML is recovered");
  check(/Broken/i.test(malformed.docs[0].title), "Recovered HTML has a usable document", malformed.docs[0].title);

  const normalFiles = await WxIngest.ingestFiles([
    fakeFile("photo.png", "x", { type: "image/png" }),
    fakeFile("page.html", "<title>Page</title>")
  ], { mode: "files" });
  check(normalFiles.images.length === 1 && normalFiles.docs.length === 1, "Regular file mode still accepts HTML and images");

  const nested = directoryEntry("customer-save", [
    fileEntry("outer.html", fakeFile("outer.html", "<title>Outer</title>")),
    directoryEntry("outer_files", [
      fileEntry("V1.html", fakeFile("V1.html", "<title>Inner</title>")),
      fileEntry("logo.png", fakeFile("logo.png", "x", { type: "image/png" })),
      fileEntry("locked.html", fakeFile("locked.html", ""), true)
    ])
  ]);
  const dropped = await WxFolder.collectDroppedFiles({
    items: [{ kind: "file", webkitGetAsEntry: () => nested }]
  });
  check(dropped.hadDirectory, "Dropped directory is recognized as a folder");
  check(dropped.files.length === 2, "Dropped nested directory keeps only HTML files", dropped.files.length);
  check(dropped.ignoredFiles === 1, "Dropped nested directory counts ignored assets", dropped.ignoredFiles);
  check(dropped.files.some((f) => f._relativePath === "customer-save/outer_files/V1.html"), "Dropped nested path is preserved");
  check(dropped.errors.some((e) => /locked\.html.*denied/i.test(e)), "Unreadable dropped entry is reported", dropped.errors.join(" | "));

  // Dragging a page and its _files folder together is the only way a browser lets
  // you mix the two in one action, so it has to survive the folder-mode filter.
  const looseHtml = fakeFile("Pulse-Creation date.html", "<title>Shell</title>");
  const looseZip = fakeFile("extra.zip", "x", { type: "application/zip" });
  const assetFolder = directoryEntry("Pulse-Creation date_files", [
    fileEntry("global_actions_list.html", fakeFile("global_actions_list.html", "<title>Grid</title>")),
    fileEntry("main.css", fakeFile("main.css", "body{}"))
  ]);
  const mixedDrop = await WxFolder.collectDroppedFiles({
    items: [
      { kind: "file", webkitGetAsEntry: () => fileEntry("Pulse-Creation date.html", looseHtml) },
      { kind: "file", webkitGetAsEntry: () => fileEntry("extra.zip", looseZip) },
      { kind: "file", webkitGetAsEntry: () => assetFolder }
    ]
  });
  check(mixedDrop.hadDirectory, "A mixed drop is treated as a folder drop");
  check(mixedDrop.files.length === 3, "A mixed drop keeps both loose files and the folder page", mixedDrop.files.length);
  check(mixedDrop.ignoredFiles === 1, "Only assets inside the folder are ignored", mixedDrop.ignoredFiles);
  check(mixedDrop.files.filter((f) => f._loose).length === 2, "Loose files are marked as deliberately chosen");

  const mixedReport = await WxIngest.ingestFiles(mixedDrop.files, {
    mode: "folder",
    ignoredFiles: mixedDrop.ignoredFiles
  });
  check(mixedReport.docs.length === 2, "A mixed drop loads the page and its iframe", mixedReport.docs.length);
  check(
    mixedReport.docs.some((d) => /Pulse-Creation date\.html$/.test(d.name)) &&
      mixedReport.docs.some((d) => /global_actions_list\.html$/.test(d.name)),
    "Both the dropped file and the folder page are present",
    mixedReport.docs.map((d) => d.name).join(", ")
  );
  check(mixedReport.missingFrames.length === 0 || !mixedReport.missingFrames.includes("global_actions_list.html"),
    "The frame supplied by the folder is not reported missing");

  // Helper-frame names must match on a token boundary, or real pages vanish.
  const realPage = "<html><body><table><tr><th>Ticket</th><td>TIC-3904</td></tr></table></body></html>";
  const helperNames = await WxIngest.ingestFiles([
    fakeFile("upload.html", realPage),
    fakeFile("download.html", realPage),
    fakeFile("dashboard.html", realPage),
    fakeFile("blanket.html", realPage),
    fakeFile("authorize(1).html", realPage),
    fakeFile("TokenFactoryIframe.html", realPage),
    fakeFile("blank.html", realPage)
  ], { mode: "files" });
  const helperOf = (n) => (helperNames.docs.find((d) => d.name === n) || {}).isHelper;
  check(helperOf("upload.html") === false, "upload.html is a real page", helperOf("upload.html"));
  check(helperOf("download.html") === false, "download.html is a real page", helperOf("download.html"));
  check(helperOf("dashboard.html") === false, "dashboard.html is a real page", helperOf("dashboard.html"));
  check(helperOf("blanket.html") === false, "blanket.html is a real page", helperOf("blanket.html"));
  check(helperOf("authorize(1).html") === true, "authorize(1).html is still a helper");
  check(helperOf("TokenFactoryIframe.html") === true, "TokenFactoryIframe.html is still a helper");
  check(helperOf("blank.html") === true, "blank.html is still a helper");

  // An empty selection still has to produce a fully formed report.
  const emptyFolder = await WxIngest.ingestFiles([], { mode: "folder", ignoredFiles: 3 });
  check(Array.isArray(emptyFolder.pendingImages), "An empty folder report still has pendingImages");
  check(Array.isArray(emptyFolder.pendingPdfs), "An empty folder report still has pendingPdfs");
  check(Array.isArray(emptyFolder.missingFrames), "An empty folder report still has missingFrames");
  check(emptyFolder.errors.some((e) => /does not contain any HTML/i.test(e)), "An empty folder still reports why");

  const assetsOnly = directoryEntry("assets", [
    fileEntry("one.png", fakeFile("one.png", "x")),
    fileEntry("two.css", fakeFile("two.css", "x"))
  ]);
  const droppedAssets = await WxFolder.collectDroppedFiles({
    items: [{ kind: "file", webkitGetAsEntry: () => assetsOnly }],
    files: []
  });
  const assetsReport = await WxIngest.ingestFiles(droppedAssets.files, {
    mode: "folder",
    ignoredFiles: droppedAssets.ignoredFiles
  });
  check(droppedAssets.files.length === 0 && droppedAssets.ignoredFiles === 2, "Asset-only dropped folder is scanned without retaining assets");
  check(assetsReport.errors.some((e) => /does not contain any HTML/i.test(e)), "Asset-only dropped folder gets the no-HTML error");

  const fallbackFile = fakeFile("fallback.html", "<title>Fallback</title>");
  const fallback = await WxFolder.collectDroppedFiles({
    items: [{ kind: "file", getAsFile: () => fallbackFile }],
    files: [fallbackFile]
  });
  check(fallback.files.length === 1, "Plain-file drag fallback works");

  const handleFile = {
    kind: "file",
    name: "handle.html",
    getFile: async () => fakeFile("handle.html", "<title>Handle</title>")
  };
  const handleFolder = {
    kind: "directory",
    name: "handle-folder",
    async *values() {
      yield { kind: "file", name: "style.css", getFile: async () => fakeFile("style.css", "x") };
      yield handleFile;
    }
  };
  const handleDrop = await WxFolder.collectDroppedFiles({
    items: [{ kind: "file", getAsFileSystemHandle: async () => handleFolder }]
  });
  check(handleDrop.hadDirectory && handleDrop.files.length === 1, "File System Access folder fallback works");
  check(handleDrop.ignoredFiles === 1, "File System Access folder ignores non-HTML assets");
  check(handleDrop.files[0]._relativePath === "handle-folder/handle.html", "File System Access path is preserved");

  console.log("\n" + passed + " passed, " + failed + " failed");
  if (failed) process.exit(1);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
