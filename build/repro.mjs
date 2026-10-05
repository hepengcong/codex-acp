#!/usr/bin/env node
// Reproducible build and local quality gate for the Claudestra maintenance fork.
// Node stdlib only. Every step runs in a fresh directory unpacked from `git archive`, never in
// the working tree, so a dirty node_modules or dist/ cannot leak into a result.
//
//   node build/repro.mjs repro        two independent clean builds, byte-compared
//   node build/repro.mjs test         typecheck + upstream unit tests (no e2e, no Codex binary)
//   node build/repro.mjs check        test + repro (the pre-commit gate)
//   node build/repro.mjs npm-compare  one clean build vs dist/index.js in the pinned npm tarball
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const BUILD_DIR = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(BUILD_DIR, '..');
const manifest = readJson(join(BUILD_DIR, 'package.json'));
const provenance = readJson(join(REPO, 'PROVENANCE.json'));
const ESBUILD = manifest.dependencies.esbuild;
const NPM_CI = ['ci', '--include=optional', '--no-audit', '--no-fund'];

// Tests left out of the gate, and why. Everything else in `npm test` runs.
const EXCLUDED_TESTS = [
    'src/__tests__/CodexACPAgent/e2e/**',                   // drives a live model, needs OPENAI_API_KEY
    'src/__tests__/CodexACPAgent/CodexAcpClient.test.ts',   // beforeEach spawns node_modules/.bin/codex
    'src/__tests__/CodexACPAgent/mcp-session.test.ts',      // beforeEach spawns node_modules/.bin/codex
    'src/__tests__/CodexACPAgent/mcp-config-merge.test.ts', // spawns the bundled @openai/codex
];
// Environment the unit tests must not see: credentials, the e2e switch, a foreign Codex binary.
const SCRUBBED_ENV = ['OPENAI_API_KEY', 'CODEX_API_KEY', 'RUN_E2E_TESTS', 'CODEX_PATH', 'CODEX_CONFIG'];

function readJson(file) {
    return JSON.parse(readFileSync(file, 'utf8'));
}

function run(cmd, args, cwd, opts = {}) {
    return execFileSync(cmd, args, {cwd, stdio: 'inherit', maxBuffer: 1 << 30, ...opts});
}

function capture(cmd, args, cwd) {
    return run(cmd, args, cwd, {stdio: ['ignore', 'pipe', 'inherit']}).toString().trim();
}

const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');

// Builds are only claimed reproducible on the pinned toolchain; refuse anything else.
function toolchain() {
    const node = process.versions.node;
    const npm = capture('npm', ['--version'], BUILD_DIR);
    const pinnedNode = readFileSync(join(BUILD_DIR, '.nvmrc'), 'utf8').trim();
    if (node !== pinnedNode || npm !== manifest.engines.npm) {
        throw new Error(`toolchain mismatch: node ${node} / npm ${npm}, pinned node ${pinnedNode} / npm ${manifest.engines.npm}` +
            ' (see build/.nvmrc and "engines" in build/package.json)');
    }
    return {node, npm, platform: process.platform, arch: process.arch};
}

// HEAD when clean; otherwise a snapshot of tracked files incl. the index (`git stash create`
// changes nothing). Untracked files are never included: `git add` new files first.
function sourceTree() {
    const snapshot = capture('git', ['stash', 'create'], REPO);
    const commit = snapshot || capture('git', ['rev-parse', 'HEAD'], REPO);
    const tree = capture('git', ['rev-parse', `${commit}^{tree}`], REPO);
    return {commit: snapshot ? null : commit, tree, dirty: Boolean(snapshot)};
}

function unpack(tree, label) {
    const dir = mkdtempSync(join(tmpdir(), `codex-acp-${label}-`));
    const tar = execFileSync('git', ['archive', '--format=tar', tree], {cwd: REPO, maxBuffer: 1 << 30});
    execFileSync('tar', ['-x', '-C', dir], {input: tar});
    return dir;
}

// Installs build/ (esbuild + the runtime deps it bundles, never @openai/codex) and moves its
// node_modules to the tree root, so esbuild resolves and labels modules exactly like upstream.
// The root package.json stays upstream's: src/ imports it and esbuild bundles all of it.
function cleanBuild(tree, label) {
    const dir = unpack(tree, label);
    run('npm', NPM_CI, join(dir, 'build'));
    renameSync(join(dir, 'build', 'node_modules'), join(dir, 'node_modules'));
    const platformPkg = `@esbuild/${process.platform}-${process.arch}`;
    const esbuild = {
        package: readJson(join(dir, 'node_modules/esbuild/package.json')).version,
        [platformPkg]: readJson(join(dir, 'node_modules', platformPkg, 'package.json')).version,
        binary: capture(join(dir, 'node_modules/.bin/esbuild'), ['--version'], dir),
    };
    for (const [what, version] of Object.entries(esbuild)) {
        if (version !== ESBUILD) throw new Error(`${label}: ${what} is ${version}, pinned ${ESBUILD}`);
    }
    run('node', ['build.mjs'], dir);
    const bytes = readFileSync(join(dir, 'dist/index.js'));
    return {dir, esbuild, bytes, sha256: sha256(bytes), size: bytes.length};
}

function repro() {
    const source = sourceTree();
    const a = cleanBuild(source.tree, 'repro-a');
    const b = cleanBuild(source.tree, 'repro-b');
    const identical = a.bytes.equals(b.bytes);
    report('repro', {source, esbuild: a.esbuild, a: a.sha256, b: b.sha256, size: a.size, identical});
    if (!identical) throw new Error(`repro: builds differ, kept ${a.dir} and ${b.dir}`);
    rmSync(a.dir, {recursive: true});
    rmSync(b.dir, {recursive: true});
    return a.sha256;
}

function npmCompare() {
    const {package: name, version, integrity} = provenance.npm;
    const built = cleanBuild(sourceTree().tree, 'npm-built');
    const dl = mkdtempSync(join(tmpdir(), 'codex-acp-npm-'));
    const [{filename}] = JSON.parse(capture('npm', ['pack', `${name}@${version}`, '--json', '--ignore-scripts', '--pack-destination', dl], dl));
    const tgz = readFileSync(join(dl, filename));
    const actual = `sha512-${createHash('sha512').update(tgz).digest('base64')}`;
    if (actual !== integrity) throw new Error(`npm tarball integrity ${actual} != pinned ${integrity}`);
    run('tar', ['-xzf', filename, 'package/dist/index.js'], dl);
    const published = readFileSync(join(dl, 'package/dist/index.js'));
    const identical = published.equals(built.bytes);
    report('npm-compare', {npm: `${name}@${version}`, integrity: 'ok', npmDist: sha256(published), built: built.sha256, identical});
    if (!identical) throw new Error(`npm-compare: differs, kept ${built.dir} and ${dl}`);
    rmSync(built.dir, {recursive: true});
    rmSync(dl, {recursive: true});
}

// Root deps minus @openai/codex (333 MB, only needed by the excluded tests), in a throwaway tree.
function test() {
    const dir = unpack(sourceTree().tree, 'test');
    const pkg = readJson(join(dir, 'package.json'));
    const lock = readJson(join(dir, 'package-lock.json'));
    delete pkg.dependencies['@openai/codex'];
    delete lock.packages[''].dependencies['@openai/codex'];
    for (const key of Object.keys(lock.packages)) if (key.startsWith('node_modules/@openai/codex')) delete lock.packages[key];
    writeFileSync(join(dir, 'package.json'), JSON.stringify(pkg, null, 2));
    writeFileSync(join(dir, 'package-lock.json'), JSON.stringify(lock, null, 2));
    run('npm', NPM_CI, dir);
    const home = mkdtempSync(join(tmpdir(), 'codex-acp-home-'));
    const env = {...process.env, HOME: home, CODEX_HOME: home};
    for (const key of SCRUBBED_ENV) delete env[key];
    run('npm', ['run', 'typecheck'], dir, {env});
    const exclude = EXCLUDED_TESTS.flatMap((glob) => ['--exclude', glob]);
    run(join(dir, 'node_modules/.bin/vitest'), ['run', '--no-file-parallelism', '--retry=2', ...exclude], dir, {env});
    rmSync(dir, {recursive: true});
    rmSync(home, {recursive: true});
}

function report(step, data) {
    console.log(`\n[cs:${step}] ${JSON.stringify(data, null, 2)}`);
}

const commands = {repro, test, 'npm-compare': npmCompare, check: () => { test(); repro(); }};
const command = commands[process.argv[2]];
if (!command) {
    console.error(`usage: node build/repro.mjs <${Object.keys(commands).join('|')}>`);
    process.exit(2);
}
report('toolchain', toolchain());
command();
