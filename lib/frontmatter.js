function parseScalar(rawValue) {
  const value = rawValue.trim();
  if (value === "true") {
    return true;
  }
  if (value === "false") {
    return false;
  }
  if (/^-?\d+$/.test(value)) {
    return Number(value);
  }
  return value.replace(/^['"]|['"]$/g, "");
}

export function parseFrontmatter(contents) {
  if (!contents.startsWith("---\n")) {
    return { data: {}, body: contents.trim() };
  }

  const closingIndex = contents.indexOf("\n---\n", 4);
  if (closingIndex === -1) {
    throw new Error("Invalid frontmatter block");
  }

  const rawFrontmatter = contents.slice(4, closingIndex);
  const body = contents.slice(closingIndex + 5).trim();
  const lines = rawFrontmatter.split("\n");
  const data = {};
  let currentKey = null;

  for (const line of lines) {
    if (!line.trim()) {
      continue;
    }

    if (line.startsWith("  - ") || line.startsWith("- ")) {
      if (!currentKey) {
        throw new Error(`Invalid list item without key: ${line}`);
      }
      data[currentKey] ??= [];
      data[currentKey].push(parseScalar(line.replace(/^(\s*)-\s*/, "")));
      continue;
    }

    const separatorIndex = line.indexOf(":");
    if (separatorIndex === -1) {
      throw new Error(`Invalid frontmatter line: ${line}`);
    }

    const key = line.slice(0, separatorIndex).trim();
    const value = line.slice(separatorIndex + 1).trim();
    currentKey = key;
    data[key] = value ? parseScalar(value) : [];
  }

  return { data, body };
}
