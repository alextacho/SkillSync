import path from "node:path";
import {
  buildProject,
  diffProject,
  doctorProject,
  initializeProject,
  watchProject,
} from "./project.js";

function parseArgs(argv) {
  const options = {
    command: "build",
    projectRoot: process.cwd(),
    sourceRoot: null,
  };

  let rest = [...argv];
  const command = rest[0];
  if (command && !command.startsWith("-")) {
    options.command = command;
    rest = rest.slice(1);
  }

  for (let index = 0; index < rest.length; index += 1) {
    const token = rest[index];
    if (token === "--project" || token === "-p") {
      options.projectRoot = path.resolve(rest[index + 1]);
      index += 1;
      continue;
    }
    if (token === "--source" || token === "-s") {
      options.sourceRoot = path.resolve(rest[index + 1]);
      index += 1;
      continue;
    }
    if (token === "--help" || token === "-h") {
      options.help = true;
      continue;
    }
    throw new Error(`Unknown argument: ${token}`);
  }

  return options;
}

function printHelp() {
  console.log(`skillsync <command> [--project <path>] [--source <path>]

Commands:
  init      Create skillsync.config.json and source folders
  build     Generate provider runtime files
  watch     Poll source folders and rebuild on change
  diff      Detect drift in generated files
  doctor    Validate configuration and folder health
`);
}

export async function runCli(argv) {
  const options = parseArgs(argv);
  if (options.help) {
    printHelp();
    return;
  }

  switch (options.command) {
    case "init":
      await initializeProject(options.projectRoot);
      return;
    case "build":
      await buildProject(options.projectRoot, {
        verbose: true,
        sourceRoot: options.sourceRoot,
      });
      return;
    case "watch":
      await watchProject(options.projectRoot, { sourceRoot: options.sourceRoot });
      return;
    case "diff":
      await diffProject(options.projectRoot);
      return;
    case "doctor":
      await doctorProject(options.projectRoot, { sourceRoot: options.sourceRoot });
      return;
    default:
      throw new Error(`Unknown command: ${options.command}`);
  }
}
