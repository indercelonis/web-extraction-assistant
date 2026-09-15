(function (global) {
  const MAX_DIRECTORY_DEPTH = 32;
  const MAX_DIRECTORY_FILES = 5000;

  function safeSegment(value) {
    return String(value || "").replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
  }

  function isHtmlName(name) {
    return /\.(?:html?|xhtml)$/i.test(String(name || ""));
  }

  /* A file dropped on its own is "loose": it was chosen deliberately, so it keeps
     its type. Files found by walking into a folder are filtered down to HTML. */
  function tagFile(file, relativePath, loose) {
    const clean = safeSegment(relativePath) || file.name;
    const set = (key, value) => {
      try {
        Object.defineProperty(file, key, { configurable: true, value });
      } catch (_) {
        file[key] = value;
      }
    };
    set("_relativePath", clean);
    if (loose) set("_loose", true);
    return file;
  }

  function readEntryBatch(reader) {
    return new Promise((resolve, reject) => reader.readEntries(resolve, reject));
  }

  function entryFile(entry) {
    return new Promise((resolve, reject) => entry.file(resolve, reject));
  }

  async function walkEntry(entry, prefix, result, depth, inDirectory) {
    if (result.files.length >= MAX_DIRECTORY_FILES) {
      result.truncated = true;
      return;
    }
    if (depth > MAX_DIRECTORY_DEPTH) {
      result.errors.push("A folder was nested more than " + MAX_DIRECTORY_DEPTH + " levels deep and was skipped.");
      return;
    }

    const current = [safeSegment(prefix), safeSegment(entry.name)].filter(Boolean).join("/");
    if (entry.isFile) {
      result.totalFiles += 1;
      if (inDirectory && !isHtmlName(entry.name)) {
        result.ignoredFiles += 1;
        return;
      }
      try {
        result.files.push(tagFile(await entryFile(entry), current, !inDirectory));
      } catch (err) {
        result.errors.push(current + " could not be read: " + (err.message || String(err)));
      }
      return;
    }
    if (!entry.isDirectory) return;

    result.hadDirectory = true;
    const reader = entry.createReader();
    try {
      // Chromium returns large directories in batches, not in one call.
      while (result.files.length < MAX_DIRECTORY_FILES) {
        const entries = await readEntryBatch(reader);
        if (!entries.length) break;
        for (const child of entries) {
          await walkEntry(child, current, result, depth + 1, true);
          if (result.files.length >= MAX_DIRECTORY_FILES) break;
        }
      }
    } catch (err) {
      result.errors.push(current + " could not be opened: " + (err.message || String(err)));
    }
  }

  async function walkHandle(handle, prefix, result, depth, inDirectory) {
    if (result.files.length >= MAX_DIRECTORY_FILES) {
      result.truncated = true;
      return;
    }
    if (depth > MAX_DIRECTORY_DEPTH) {
      result.errors.push("A folder was nested more than " + MAX_DIRECTORY_DEPTH + " levels deep and was skipped.");
      return;
    }

    const current = [safeSegment(prefix), safeSegment(handle.name)].filter(Boolean).join("/");
    if (handle.kind === "file") {
      result.totalFiles += 1;
      if (inDirectory && !isHtmlName(handle.name)) {
        result.ignoredFiles += 1;
        return;
      }
      try {
        result.files.push(tagFile(await handle.getFile(), current, !inDirectory));
      } catch (err) {
        result.errors.push(current + " could not be read: " + (err.message || String(err)));
      }
      return;
    }
    if (handle.kind !== "directory") return;

    result.hadDirectory = true;
    try {
      for await (const child of handle.values()) {
        await walkHandle(child, current, result, depth + 1, true);
        if (result.files.length >= MAX_DIRECTORY_FILES) {
          result.truncated = true;
          break;
        }
      }
    } catch (err) {
      result.errors.push(current + " could not be opened: " + (err.message || String(err)));
    }
  }

  async function collectDroppedFiles(dataTransfer) {
    const result = {
      files: [],
      hadDirectory: false,
      errors: [],
      truncated: false,
      ignoredFiles: 0,
      totalFiles: 0
    };
    const items = Array.from((dataTransfer && dataTransfer.items) || []);

    for (const item of items) {
      if (item.kind && item.kind !== "file") continue;
      try {
        if (typeof item.webkitGetAsEntry === "function") {
          const entry = item.webkitGetAsEntry();
          if (entry) {
            await walkEntry(entry, "", result, 0, false);
            continue;
          }
        }
        if (typeof item.getAsFileSystemHandle === "function") {
          const handle = await item.getAsFileSystemHandle();
          if (handle) {
            await walkHandle(handle, "", result, 0, false);
            continue;
          }
        }
        const file = item.getAsFile && item.getAsFile();
        if (file) {
          result.totalFiles += 1;
          result.files.push(tagFile(file, file.name, true));
        }
      } catch (err) {
        result.errors.push("A dropped item could not be read: " + (err.message || String(err)));
      }
    }

    // Some browsers expose files but not item traversal.
    if (!result.files.length && !result.hadDirectory && dataTransfer && dataTransfer.files) {
      result.files = Array.from(dataTransfer.files).map((f) => tagFile(f, f.name, true));
      result.totalFiles = result.files.length;
    }
    if (result.files.length >= MAX_DIRECTORY_FILES) result.truncated = true;
    return result;
  }

  global.WxFolder = {
    collectDroppedFiles,
    tagFile,
    MAX_DIRECTORY_DEPTH,
    MAX_DIRECTORY_FILES
  };
})(window);
