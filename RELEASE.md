# Release Checklist

Use this checklist before publishing SkillSync.

## 1. GitHub metadata

Update `package.json` to replace the placeholder values:

- `homepage`
- `repository.url`
- `bugs.url`
- `funding.url`

Expected shape:

```json
"homepage": "https://github.com/alextacho/skillsync#readme",
"repository": {
  "type": "git",
  "url": "git+https://github.com/alextacho/skillsync.git"
},
"bugs": {
  "url": "https://github.com/alextacho/skillsync/issues"
}
```

## 2. Sanity checks

Run:

```bash
node ./bin/skillsync.js --help
npm --cache /tmp/skillsync-npm-cache pack --dry-run
npm run playground:build
npm run playground:diff
npm run playground:doctor
```

Confirm:

- CLI help renders correctly
- tarball contains only intended package files
- playground builds without drift

## 3. Install test

Test local global install:

```bash
npm link
skillsync --help
skillsync build --project ./playground
```

Optional clean-room install test:

```bash
npm pack
mkdir -p /tmp/skillsync-smoke
cd /tmp/skillsync-smoke
npm install /path/to/skillsync-0.1.0.tgz
./node_modules/.bin/skillsync --help
```

## 4. Versioning

Update the version in `package.json`.

Example:

```bash
npm version patch
```

Use:

- `patch` for fixes
- `minor` for backward-compatible features
- `major` for breaking changes

## 5. Publish

If publishing to npm:

```bash
npm publish
```

If publishing from GitHub only:

- push the repo to GitHub
- create a release tag
- install via `npm install -g github:alextacho/skillsync`

## 6. Post-release verification

Verify one of:

```bash
npm install -g skillsync
skillsync --help
```

or:

```bash
npm install -g github:alextacho/skillsync
skillsync --help
```

Then test against a real target repo:

```bash
skillsync init --project /path/to/project
skillsync build --project /path/to/project
skillsync watch --project /path/to/project
```
