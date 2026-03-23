import fs from "node:fs/promises";
import path from "node:path";
import { ensureDir, readIfExists } from "./utils.js";

export async function loadState(projectRoot) {
  const statePath = path.join(projectRoot, ".skillsync", "state.json");
  const rawState = await readIfExists(statePath);
  if (!rawState) {
    return { statePath, data: { artifacts: {}, generatedFiles: {} } };
  }
  return { statePath, data: JSON.parse(rawState) };
}

export async function saveState(statePath, data) {
  await ensureDir(path.dirname(statePath));
  await fs.writeFile(statePath, JSON.stringify(data, null, 2), "utf8");
}
