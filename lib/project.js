import fs from "node:fs/promises";
import path from "node:path";
import { parseFrontmatter } from "./frontmatter.js";
import { loadState, saveState } from "./state.js";
import {
  ensureDir,
  fileExists,
  hashContent,
  readIfExists,
  stableStringify,
  toPosixPath,
  writeAtomic,
} from "./utils.js";

const DEFAULT_CONFIG = {
  version: 1,
  sources: {
    skills: "skills",
    agents: "agents",
    commands: "commands",
  },
  providers: {
    claude: {
      enabled: true,
      root: ".claude",
    },
    codex: {
      enabled: true,
      root: ".codex",
    },
    agents_runtime: {
      enabled: true,
      root: ".agents",
    },
  },
};

const AGENTS_BLOCK_START = "<!-- skillsync:commands:start -->";
const AGENTS_BLOCK_END = "<!-- skillsync:commands:end -->";

function log(message) {
  const timestamp = new Date().toLocaleTimeString("en-US", {
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  console.log(`[skillsync ${timestamp}] ${message}`);
}

async function loadConfig(projectRoot) {
  const configPath = path.join(projectRoot, "skillsync.config.json");
  const legacyConfigPath = path.join(projectRoot, "omnibind.config.json");
  const raw = (await readIfExists(configPath)) ?? (await readIfExists(legacyConfigPath));
  if (!raw) {
    return { configPath, config: DEFAULT_CONFIG };
  }
  const parsed = JSON.parse(raw);
  return {
    configPath,
    config: {
      ...DEFAULT_CONFIG,
      ...parsed,
      sources: { ...DEFAULT_CONFIG.sources, ...parsed.sources },
      providers: {
        ...DEFAULT_CONFIG.providers,
        ...parsed.providers,
      },
    },
  };
}

async function walkFiles(rootDirectory) {
  const entries = await fs.readdir(rootDirectory, { withFileTypes: true }).catch((error) => {
    if (error.code === "ENOENT") {
      return [];
    }
    throw error;
  });
  const files = [];
  for (const entry of entries) {
    const fullPath = path.join(rootDirectory, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await walkFiles(fullPath)));
      continue;
    }
    files.push(fullPath);
  }
  return files;
}

async function readArtifactFile(filePath) {
  let raw;
  try {
    raw = await fs.readFile(filePath, "utf8");
  } catch (error) {
    if (error.code === "ENOENT") {
      return null;
    }
    throw error;
  }
  const { data, body } = parseFrontmatter(raw);
  return { raw, data, body };
}

async function loadIncludedSections(baseDirectory, includeList = []) {
  const sections = [];
  const warnings = [];
  for (const relativePath of includeList) {
    const absolutePath = path.join(baseDirectory, relativePath);
    let content;
    try {
      content = await fs.readFile(absolutePath, "utf8");
    } catch (error) {
      if (error.code === "ENOENT") {
        warnings.push(`Missing included file: ${toPosixPath(relativePath)}`);
        continue;
      }
      throw error;
    }
    sections.push({
      file: toPosixPath(relativePath),
      content: content.trim(),
    });
  }
  return { sections, warnings };
}

async function discoverArtifacts(projectRoot, config) {
  const artifacts = [];

  const skillsRoot = path.join(projectRoot, config.sources.skills);
  for (const filePath of await walkFiles(skillsRoot)) {
    if (path.basename(filePath) !== "skill.md") {
      continue;
    }
    const packageRoot = path.dirname(filePath);
    const relativePackagePath = toPosixPath(path.relative(skillsRoot, packageRoot));
    const skillName = relativePackagePath;
    const entry = await readArtifactFile(filePath);
    if (!entry) {
      continue;
    }
    artifacts.push({
      id: `skill:${skillName}`,
      kind: "skill",
      name: entry.data.name || skillName,
      sourceRoot: packageRoot,
      entryPath: filePath,
      relativePath: relativePackagePath,
      include: Array.isArray(entry.data.include) ? entry.data.include : [],
      entry,
    });
  }

  const agentsRoot = path.join(projectRoot, config.sources.agents);
  for (const filePath of await walkFiles(agentsRoot)) {
    if (path.basename(filePath) !== "agent.md") {
      continue;
    }
    const packageRoot = path.dirname(filePath);
    const relativePackagePath = toPosixPath(path.relative(agentsRoot, packageRoot));
    const agentName = relativePackagePath;
    const entry = await readArtifactFile(filePath);
    if (!entry) {
      continue;
    }
    artifacts.push({
      id: `agent:${agentName}`,
      kind: "agent",
      name: entry.data.name || agentName,
      sourceRoot: packageRoot,
      entryPath: filePath,
      relativePath: relativePackagePath,
      include: Array.isArray(entry.data.include) ? entry.data.include : [],
      entry,
    });
  }

  const commandsRoot = path.join(projectRoot, config.sources.commands);
  const commandFiles = await fs.readdir(commandsRoot, { withFileTypes: true }).catch((error) => {
    if (error.code === "ENOENT") {
      return [];
    }
    throw error;
  });
  for (const entry of commandFiles) {
    if (!entry.isFile() || path.extname(entry.name) !== ".md") {
      continue;
    }
    const filePath = path.join(commandsRoot, entry.name);
    const command = await readArtifactFile(filePath);
    if (!command) {
      continue;
    }
    const commandName = path.basename(entry.name, ".md");
    artifacts.push({
      id: `command:${commandName}`,
      kind: "command",
      name: command.data.name || commandName,
      sourceRoot: commandsRoot,
      entryPath: filePath,
      relativePath: commandName,
      include: Array.isArray(command.data.include) ? command.data.include : [],
      entry: command,
    });
  }

  return artifacts.sort((left, right) => left.id.localeCompare(right.id));
}

async function normalizeArtifact(artifact) {
  const { sections: includedSections, warnings } = await loadIncludedSections(
    artifact.sourceRoot,
    artifact.include,
  );
  const metadata = {
    name: artifact.name,
    description: artifact.entry.data.description || "",
    include: artifact.include,
  };
  if (artifact.kind === "command") {
    metadata.slash = artifact.entry.data.slash || `/${artifact.name}`;
  }

  return {
    id: artifact.id,
    kind: artifact.kind,
    name: artifact.name,
    relativePath: artifact.relativePath,
    metadata,
    body: artifact.entry.body,
    includedSections,
    warnings,
  };
}

function renderCanonicalDocument(artifact) {
  const lines = [];
  if (artifact.kind === "command") {
    lines.push(`# ${artifact.metadata.slash}`);
  } else {
    lines.push(`# ${artifact.name}`);
  }
  if (artifact.metadata.description) {
    lines.push("", artifact.metadata.description);
  }
  lines.push("", artifact.body);

  for (const section of artifact.includedSections) {
    lines.push("", `## Included: ${section.file}`, "", section.content);
  }

  return `${lines.join("\n").trim()}\n`;
}

function renderIncludedSections(artifact, options = {}) {
  const { heading = "Included Context", itemHeadingLevel = "###" } = options;
  if (!artifact.includedSections.length) {
    return [];
  }

  const lines = [`## ${heading}`];
  for (const section of artifact.includedSections) {
    lines.push("", `${itemHeadingLevel} ${section.file}`, "", section.content);
  }
  return lines;
}

function renderClaudeDocument(artifact) {
  if (artifact.kind === "command") {
    const lines = [
      `# ${artifact.metadata.slash}`,
      "",
      artifact.metadata.description,
      "",
      "## Command Behavior",
      "",
      artifact.body,
    ];
    lines.push("", ...renderIncludedSections(artifact, { heading: "Additional Context" }));
    return `${lines.join("\n").trim()}\n`;
  }

  if (artifact.kind === "agent") {
    const lines = [
      `# ${artifact.name}`,
      "",
      artifact.metadata.description,
      "",
      "## Role",
      "",
      `You are the ${artifact.name} agent.`,
      "",
      "## Instructions",
      "",
      artifact.body,
    ];
    lines.push("", ...renderIncludedSections(artifact, { heading: "Reference Material" }));
    return `${lines.join("\n").trim()}\n`;
  }

  const lines = [
    `# ${artifact.name}`,
    "",
    artifact.metadata.description,
    "",
    "## When To Use",
    "",
    `Use this skill when the task matches ${artifact.name}.`,
    "",
    "## Instructions",
    "",
    artifact.body,
  ];
  lines.push("", ...renderIncludedSections(artifact, { heading: "Supporting Notes" }));
  return `${lines.join("\n").trim()}\n`;
}

function renderCodexDocument(artifact) {
  const headerLines = [
    "---",
    `name: ${artifact.name}`,
    `kind: ${artifact.kind}`,
    `description: ${artifact.metadata.description}`,
  ];
  if (artifact.kind === "command") {
    headerLines.push(`slash: ${artifact.metadata.slash}`);
  }
  headerLines.push("---", "");

  if (artifact.kind === "command") {
    headerLines.push(
      `# ${artifact.metadata.slash}`,
      "",
      "## Purpose",
      "",
      artifact.metadata.description,
      "",
      "## Execution",
      "",
      artifact.body,
    );
  } else if (artifact.kind === "agent") {
    headerLines.push(
      `# ${artifact.name}`,
      "",
      "## Responsibility",
      "",
      artifact.metadata.description,
      "",
      "## Behavior",
      "",
      artifact.body,
    );
  } else {
    headerLines.push(
      `# ${artifact.name}`,
      "",
      "## Description",
      "",
      artifact.metadata.description,
      "",
      "## Instructions",
      "",
      artifact.body,
    );
  }

  headerLines.push("", ...renderIncludedSections(artifact, { heading: "Context Files" }));
  return `${headerLines.join("\n").trim()}\n`;
}

function renderAgentsRuntimeDocument(artifact) {
  if (artifact.kind === "skill") {
    return renderCodexDocument(artifact);
  }

  const lines = [
    `# ${artifact.kind.toUpperCase()}: ${artifact.kind === "command" ? artifact.metadata.slash : artifact.name}`,
    "",
    `Name: ${artifact.name}`,
    `Description: ${artifact.metadata.description}`,
  ];
  if (artifact.kind === "command") {
    lines.push(`Slash: ${artifact.metadata.slash}`);
  }
  lines.push(
    "",
    "## Runtime Instructions",
    "",
    artifact.body,
  );
  lines.push("", ...renderIncludedSections(artifact, { heading: "Loaded Context", itemHeadingLevel: "####" }));
  return `${lines.join("\n").trim()}\n`;
}

function renderCodexCommandIndex(commands) {
  const lines = [
    "# Codex Command Index",
    "",
    "This file is generated by SkillSync. Use it as the source of truth for project command aliases.",
  ];

  for (const command of commands) {
    lines.push(
      "",
      `## ${command.metadata.slash}`,
      "",
      `${command.metadata.description}`,
      "",
      `File: .codex/commands/${command.name}.md`,
    );
  }

  return `${lines.join("\n").trim()}\n`;
}

function renderManagedAgentsBlock(commands) {
  const lines = [
    AGENTS_BLOCK_START,
    "## SkillSync Commands",
    "",
    "This section is generated by SkillSync.",
    "If the user message is exactly one of the slash commands listed below, treat it as a command invocation.",
    "Before responding, read the mapped file under `.codex/commands/` and follow its instructions.",
    "",
    "Available commands:",
  ];

  for (const command of commands) {
    lines.push(`- \`${command.metadata.slash}\` -> \`.codex/commands/${command.name}.md\``);
  }

  lines.push(AGENTS_BLOCK_END);
  return `${lines.join("\n").trim()}\n`;
}

async function syncCodexAgentsFile(projectRoot, commands) {
  const absolutePath = path.join(projectRoot, "AGENTS.md");
  const block = renderManagedAgentsBlock(commands);
  const existing = await readIfExists(absolutePath);
  let nextContent;
  const cleanedExisting = existing
    ? existing
        .replace(/<!-- omnibind:commands:start -->[\s\S]*?<!-- omnibind:commands:end -->\n?/g, "")
        .replace(
          /<!-- skillsync:commands:start -->[\s\S]*?<!-- skillsync:commands:end -->\n?/g,
          "",
        )
        .trimEnd()
    : existing;

  if (!cleanedExisting) {
    nextContent = `${block}\n`;
  } else {
    nextContent = `${cleanedExisting.trimEnd()}\n\n${block}\n`;
  }

  if (existing === nextContent) {
    return { wrote: false, relativePath: "AGENTS.md" };
  }

  await writeAtomic(absolutePath, nextContent);
  return { wrote: true, relativePath: "AGENTS.md" };
}

function renderProviderDocument(providerId, artifact) {
  switch (providerId) {
    case "claude":
      return renderClaudeDocument(artifact);
    case "codex":
      return renderCodexDocument(artifact);
    case "agents_runtime":
      return renderAgentsRuntimeDocument(artifact);
    default:
      return renderCanonicalDocument(artifact);
  }
}

function renderProviderOutputs(config, normalizedArtifact) {
  const outputs = [];

  for (const [providerId, providerConfig] of Object.entries(config.providers)) {
    if (!providerConfig.enabled) {
      continue;
    }

    if (normalizedArtifact.kind === "skill") {
      const fileName = providerId === "claude" ? "CLAUDE.md" : "SKILL.md";
      outputs.push({
        providerId,
        targetPath: path.join(
          providerConfig.root,
          "skills",
          normalizedArtifact.relativePath,
          fileName,
        ),
        content: renderProviderDocument(providerId, normalizedArtifact),
      });
      continue;
    }

    if (normalizedArtifact.kind === "agent") {
      const fileName = providerId === "claude" ? "AGENT.md" : "AGENT.md";
      outputs.push({
        providerId,
        targetPath: path.join(
          providerConfig.root,
          "agents",
          normalizedArtifact.relativePath,
          fileName,
        ),
        content: renderProviderDocument(providerId, normalizedArtifact),
      });
      continue;
    }

    outputs.push({
      providerId,
      targetPath: path.join(providerConfig.root, "commands", `${normalizedArtifact.name}.md`),
      content: renderProviderDocument(providerId, normalizedArtifact),
    });
  }

  return outputs;
}

function computeSemanticHash(normalizedArtifact) {
  return hashContent(
    stableStringify({
      kind: normalizedArtifact.kind,
      name: normalizedArtifact.name,
      metadata: normalizedArtifact.metadata,
      body: normalizedArtifact.body.trim(),
      includedSections: normalizedArtifact.includedSections.map((section) => ({
        file: section.file,
        content: section.content.trim(),
      })),
    }),
  );
}

async function buildArtifacts(projectRoot, config, options = {}) {
  const { statePath, data: state } = await loadState(projectRoot);
  const artifacts = await discoverArtifacts(projectRoot, config);
  const warnings = [];
  let writes = 0;
  let deletes = 0;
  const nextArtifacts = {};
  const nextGeneratedFiles = {};

  for (const artifact of artifacts) {
    const normalized = await normalizeArtifact(artifact);
    const semanticHash = computeSemanticHash(normalized);
    const outputs = renderProviderOutputs(config, normalized);
    for (const warning of normalized.warnings) {
      warnings.push(`${artifact.id}: ${warning}`);
    }

    nextArtifacts[artifact.id] = {
      kind: artifact.kind,
      name: artifact.name,
      semanticHash,
      outputs: outputs.map((output) => output.targetPath),
    };

    for (const output of outputs) {
      const absoluteTargetPath = path.join(projectRoot, output.targetPath);
      const existingContent = await readIfExists(absoluteTargetPath);
      const existingHash = existingContent ? hashContent(existingContent) : null;
      const nextHash = hashContent(output.content);
      const previousRecordedHash = state.generatedFiles[output.targetPath]?.contentHash;

      if (
        existingContent !== null &&
        previousRecordedHash &&
        existingHash !== previousRecordedHash &&
        existingHash !== nextHash
      ) {
        warnings.push(`Manual edit detected in generated file: ${output.targetPath}`);
      }

      if (existingHash !== nextHash) {
        await writeAtomic(absoluteTargetPath, output.content);
        writes += 1;
        if (options.verbose) {
          log(`wrote ${output.targetPath}`);
        }
      }

      nextGeneratedFiles[output.targetPath] = {
        artifactId: artifact.id,
        contentHash: nextHash,
      };
    }
  }

  const commandArtifacts = artifacts
    .filter((artifact) => artifact.kind === "command")
    .map((artifact) => ({
      name: artifact.name,
      metadata: {
        description: artifact.entry.data.description || "",
        slash: artifact.entry.data.slash || `/${artifact.name}`,
      },
    }))
    .sort((left, right) => left.name.localeCompare(right.name));

  const codexCommandsEnabled = Boolean(config.providers.codex?.enabled);
  if (codexCommandsEnabled) {
    const commandIndexPath = path.join(projectRoot, config.providers.codex.root, "COMMANDS.md");
    const commandIndexContent = renderCodexCommandIndex(commandArtifacts);
    const existingCommandIndex = await readIfExists(commandIndexPath);
    if (existingCommandIndex !== commandIndexContent) {
      await writeAtomic(commandIndexPath, commandIndexContent);
      writes += 1;
      if (options.verbose) {
        log(`wrote ${path.relative(projectRoot, commandIndexPath)}`);
      }
    }

    const agentsResult = await syncCodexAgentsFile(projectRoot, commandArtifacts);
    if (agentsResult.wrote) {
      writes += 1;
      if (options.verbose) {
        log(`wrote ${agentsResult.relativePath}`);
      }
    }
  }

  for (const trackedPath of Object.keys(state.generatedFiles)) {
    if (nextGeneratedFiles[trackedPath]) {
      continue;
    }
    const absoluteTrackedPath = path.join(projectRoot, trackedPath);
    try {
      await fs.unlink(absoluteTrackedPath);
      deletes += 1;
      if (options.verbose) {
        log(`deleted ${trackedPath}`);
      }
    } catch (error) {
      if (error.code !== "ENOENT") {
        throw error;
      }
    }
  }

  state.artifacts = nextArtifacts;
  state.generatedFiles = nextGeneratedFiles;
  await saveState(statePath, state);
  return { artifacts, writes, deletes, warnings };
}

async function computeWatchFingerprint(projectRoot, config) {
  const watchRoots = Object.values(config.sources).map((relativePath) =>
    path.join(projectRoot, relativePath),
  );
  const files = [];
  for (const watchRoot of watchRoots) {
    files.push(...(await walkFiles(watchRoot)));
  }
  files.sort();

  const descriptors = [];
  for (const filePath of files) {
    let stats;
    try {
      stats = await fs.stat(filePath);
    } catch (error) {
      if (error.code === "ENOENT") {
        continue;
      }
      throw error;
    }
    descriptors.push({
      file: toPosixPath(path.relative(projectRoot, filePath)),
      size: stats.size,
      mtimeMs: Math.trunc(stats.mtimeMs),
    });
  }
  return hashContent(stableStringify(descriptors));
}

export async function initializeProject(projectRoot) {
  const configPath = path.join(projectRoot, "skillsync.config.json");
  if (!(await fileExists(configPath))) {
    await fs.writeFile(configPath, `${JSON.stringify(DEFAULT_CONFIG, null, 2)}\n`, "utf8");
    log(`created ${path.relative(projectRoot, configPath)}`);
  }

  for (const sourceRoot of Object.values(DEFAULT_CONFIG.sources)) {
    await ensureDir(path.join(projectRoot, sourceRoot));
  }

  log("project initialized");
}

export async function buildProject(projectRoot, options = {}) {
  const { config } = await loadConfig(projectRoot);
  const result = await buildArtifacts(projectRoot, config, options);
  for (const warning of result.warnings) {
    log(`warning: ${warning}`);
  }
  log(
    `built ${result.artifacts.length} artifacts, wrote ${result.writes} files, deleted ${result.deletes} files`,
  );
}

export async function watchProject(projectRoot) {
  const { config } = await loadConfig(projectRoot);
  let fingerprint = await computeWatchFingerprint(projectRoot, config);
  await buildProject(projectRoot, { verbose: true });
  log("watching for changes");

  setInterval(async () => {
    try {
      const nextFingerprint = await computeWatchFingerprint(projectRoot, config);
      if (nextFingerprint === fingerprint) {
        return;
      }
      fingerprint = nextFingerprint;
      await buildProject(projectRoot, { verbose: true });
    } catch (error) {
      log(`watch error: ${error.message}`);
    }
  }, 250);
}

export async function diffProject(projectRoot) {
  const { statePath, data: state } = await loadState(projectRoot);
  const entries = Object.entries(state.generatedFiles);
  if (!entries.length) {
    log("no generated files tracked yet");
    return;
  }

  let driftCount = 0;
  for (const [relativePath, fileState] of entries) {
    const absolutePath = path.join(projectRoot, relativePath);
    const content = await readIfExists(absolutePath);
    if (content === null) {
      driftCount += 1;
      log(`missing: ${relativePath}`);
      continue;
    }
    const currentHash = hashContent(content);
    if (currentHash !== fileState.contentHash) {
      driftCount += 1;
      log(`drift: ${relativePath}`);
    }
  }

  if (!driftCount) {
    log(`no drift detected (${path.relative(projectRoot, statePath)})`);
    return;
  }

  log(`detected ${driftCount} drifted generated file(s)`);
}

export async function doctorProject(projectRoot) {
  const { configPath, config } = await loadConfig(projectRoot);
  const issues = [];

  if (
    !(await fileExists(configPath)) &&
    !(await fileExists(path.join(projectRoot, "omnibind.config.json")))
  ) {
    issues.push("missing skillsync.config.json");
  }

  for (const [sourceType, relativePath] of Object.entries(config.sources)) {
    if (!(await fileExists(path.join(projectRoot, relativePath)))) {
      issues.push(`missing source directory: ${sourceType} -> ${relativePath}`);
    }
  }

  if (issues.length) {
    for (const issue of issues) {
      log(`issue: ${issue}`);
    }
    log(`doctor found ${issues.length} issue(s)`);
    return;
  }

  log("doctor passed");
}
