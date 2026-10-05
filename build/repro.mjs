#!/usr/bin/env node
// Reproducible build and local quality gate for the Claudestra maintenance fork.
// Node stdlib only. Every step runs in a fresh directory unpacked from `git archive`, never in
// the working tree, so a dirty node_modules or dist/ cannot leak into a result. One snapshot of
// the tree is taken per run and every step uses it; the run fails if the tree changed meanwhile.
//
//   node build/repro.mjs repro        two independent clean builds, byte-compared
//   node build/repro.mjs test         typecheck + upstream unit tests (no e2e, no Codex binary)
//   node build/repro.mjs check        test + repro (the pre-commit gate)
//   node build/repro.mjs npm-compare  one clean build vs dist/index.js in the pinned npm tarball
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {mkdtempSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname, join, relative, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const BUILD_DIR = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(BUILD_DIR, '..');
const manifest = readJson(join(BUILD_DIR, 'package.json'));
const provenance = readJson(join(REPO, 'PROVENANCE.json'));
const binaryTests = readJson(join(BUILD_DIR, 'binary-tests.json'));
const ESBUILD = manifest.dependencies.esbuild;
const NPM_CI = ['ci', '--include=dev', '--include=optional', '--no-audit', '--no-fund'];
const E2E_TESTS = 'src/__tests__/CodexACPAgent/e2e/**'; // drives a live model, needs OPENAI_API_KEY

// The entire environment of everything that runs code from the tree (esbuild, typecheck, tests):
// nothing is inherited, so INITIAL_AGENT_MODE, CI, API keys, NODE_OPTIONS and the like cannot leak
// in. `npm ci` keeps the caller's environment, which carries the registry and proxy settings.
function cleanEnv(home) {
    return {
        PATH: [dirname(process.execPath), '/usr/bin', '/bin', '/usr/sbin', '/sbin'].join(':'),
        HOME: home,
        TMPDIR: tmpdir(),
        LANG: 'en_US.UTF-8',
        TZ: 'UTC',
    };
}
// Added for tests: skip the binary tests (local patch test-skip-binary), never record baselines.
const TEST_ENV = {CODEX_ACP_SKIP_BINARY_TESTS: '1', RECORD_SCENARIO_BASELINE: '0'};

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

// HEAD's tree when clean; otherwise a snapshot of tracked files incl. the index (`git stash create`
// changes nothing). Untracked files are never included: `git add` new files first.
function snapshot() {
    const stash = capture('git', ['stash', 'create'], REPO);
    const head = capture('git', ['rev-parse', 'HEAD'], REPO);
    const tree = capture('git', ['rev-parse', `${stash || head}^{tree}`], REPO);
    return {tree, head, headTree: capture('git', ['rev-parse', 'HEAD^{tree}'], REPO)};
}

function unpack(tree, label) {
    const dir = mkdtempSync(join(tmpdir(), `codex-acp-${label}-`));
    const tar = execFileSync('git', ['archive', '--format=tar', tree], {cwd: REPO, maxBuffer: 1 << 30});
    execFileSync('tar', ['-x', '-C', dir], {input: tar});
    return realpathSync(dir);
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
    run('node', ['build.mjs'], dir, {env: cleanEnv(dir)});
    const bytes = readFileSync(join(dir, 'dist/index.js'));
    return {dir, esbuild, bytes, sha256: sha256(bytes), size: bytes.length};
}

function repro(tree) {
    const a = cleanBuild(tree, 'repro-a');
    const b = cleanBuild(tree, 'repro-b');
    const identical = a.bytes.equals(b.bytes);
    report('repro', {tree, esbuild: a.esbuild, a: a.sha256, b: b.sha256, size: a.size, identical});
    if (!identical) throw new Error(`repro: builds differ, kept ${a.dir} and ${b.dir}`);
    rmSync(a.dir, {recursive: true});
    rmSync(b.dir, {recursive: true});
}

function npmCompare(tree) {
    const {package: name, version, integrity} = provenance.npm;
    const built = cleanBuild(tree, 'npm-built');
    const dl = mkdtempSync(join(tmpdir(), 'codex-acp-npm-'));
    const [{filename}] = JSON.parse(capture('npm', ['pack', `${name}@${version}`, '--json', '--ignore-scripts', '--pack-destination', dl], dl));
    const tgz = readFileSync(join(dl, filename));
    const actual = `sha512-${createHash('sha512').update(tgz).digest('base64')}`;
    if (actual !== integrity) throw new Error(`npm tarball integrity ${actual} != pinned ${integrity}`);
    run('tar', ['-xzf', filename, 'package/dist/index.js'], dl);
    const published = readFileSync(join(dl, 'package/dist/index.js'));
    const identical = published.equals(built.bytes);
    report('npm-compare', {tree, npm: `${name}@${version}`, integrity: 'ok', npmDist: sha256(published), built: built.sha256, identical});
    if (!identical) throw new Error(`npm-compare: differs, kept ${built.dir} and ${dl}`);
    rmSync(built.dir, {recursive: true});
    rmSync(dl, {recursive: true});
}

// Root deps minus @openai/codex (333 MB, only needed by the binary tests), in a throwaway tree.
function test(tree) {
    const dir = unpack(tree, 'test');
    const pkg = readJson(join(dir, 'package.json'));
    const lock = readJson(join(dir, 'package-lock.json'));
    delete pkg.dependencies['@openai/codex'];
    delete lock.packages[''].dependencies['@openai/codex'];
    for (const key of Object.keys(lock.packages)) if (key.startsWith('node_modules/@openai/codex')) delete lock.packages[key];
    writeFileSync(join(dir, 'package.json'), JSON.stringify(pkg, null, 2));
    writeFileSync(join(dir, 'package-lock.json'), JSON.stringify(lock, null, 2));
    run('npm', NPM_CI, dir);
    const home = mkdtempSync(join(tmpdir(), 'codex-acp-home-'));
    const env = {...cleanEnv(home), CODEX_HOME: home, ...TEST_ENV};
    report('test-env', env);
    run('npm', ['run', 'typecheck'], dir, {env});
    const results = join(dir, 'vitest-results.json');
    run(join(dir, 'node_modules/.bin/vitest'), ['run', '--no-file-parallelism', '--retry=2', '--update=none', '--allowOnly=false',
        '--exclude', E2E_TESTS, '--reporter=default', '--reporter=json', `--outputFile.json=${results}`], dir, {env});
    const summary = checkSkips(readJson(results), dir);
    report('test', {tree, ...summary});
    rmSync(dir, {recursive: true});
    rmSync(home, {recursive: true});
}

// A test that skips without being declared (an env switch, `.only`, a new skipIf) fails the gate,
// and so does a declared binary test that suddenly runs.
function checkSkips(results, dir) {
    const declared = {...binaryTests.binaryTests, ...binaryTests.expectedUpstreamSkips};
    const expected = Object.entries(declared).flatMap(([file, titles]) => titles.map((title) => `${file} > ${title}`));
    const skipped = results.testResults.flatMap((file) => file.assertionResults
        .filter((test) => test.status !== 'passed')
        .map((test) => `${relative(dir, file.name)} > ${test.title}`));
    const unexpected = skipped.filter((t) => !expected.includes(t)).map((t) => `skipped but not declared: ${t}`);
    const missing = expected.filter((t) => !skipped.includes(t)).map((t) => `declared but not skipped: ${t}`);
    if (unexpected.length || missing.length) throw new Error(['skips differ from build/binary-tests.json:', ...unexpected, ...missing].join('\n'));
    return {files: results.testResults.length, passed: results.numPassedTests, skipped: skipped.length, failed: results.numFailedTests};
}

function report(step, data) {
    console.log(`\n[cs:${step}] ${JSON.stringify(data, null, 2)}`);
}

const commands = {repro, test, 'npm-compare': npmCompare, check: (tree) => { test(tree); repro(tree); }};
const command = commands[process.argv[2]];
if (!command) {
    console.error(`usage: node build/repro.mjs <${Object.keys(commands).join('|')}>`);
    process.exit(2);
}
report('toolchain', toolchain());
const source = snapshot();
report('source', {...source, clean: source.tree === source.headTree});
command(source.tree);
const after = snapshot().tree;
if (after !== source.tree) throw new Error(`working tree changed during the run: checked ${source.tree}, now ${after}`);
report('result', {command: process.argv[2], tree: source.tree, matchesHead: source.tree === source.headTree});
