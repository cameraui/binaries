#!/usr/bin/env tsx

import { execFileSync } from 'node:child_process';
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

interface BinaryConfig {
  binaryName: string;
  releaseBinaryName?: string;
  releaseRepo: string;
  version: string;
  targets: Record<string, string>;
}

const REPO_URL = 'git+https://github.com/cameraui/binaries.git';

function parseArgs(argv: string[]): {
  pkg: string;
  version?: string;
  target?: string;
} {
  const [pkg, ...rest] = argv;
  if (!pkg) {
    throw new Error('Usage: tsx scripts/pack.ts <package> [--version <tag>] [--target <target>]');
  }

  let version: string | undefined;
  let target: string | undefined;

  for (let i = 0; i < rest.length; i++) {
    if (rest[i] === '--version') {
      version = rest[++i];
    } else if (rest[i] === '--target') {
      target = rest[++i];
    } else {
      throw new Error(`Unknown argument: ${rest[i]}`);
    }
  }

  return { pkg, version, target };
}

function readJson<T>(file: string): T {
  return JSON.parse(readFileSync(file, 'utf8')) as T;
}

function writeJson(file: string, data: unknown): void {
  writeFileSync(file, JSON.stringify(data, null, 2) + '\n');
}

async function download(url: string, dest: string): Promise<void> {
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok || !res.body) {
    throw new Error(`Download failed (${res.status}): ${url}`);
  }
  const buffer = Buffer.from(await res.arrayBuffer());
  writeFileSync(dest, buffer);
}

function extract(archive: string, into: string): void {
  if (archive.endsWith('.zip')) {
    execFileSync('unzip', ['-o', '-q', archive, '-d', into], {
      stdio: 'inherit',
    });
  } else if (archive.endsWith('.tar.gz') || archive.endsWith('.tgz')) {
    execFileSync('tar', ['-xzf', archive, '-C', into], { stdio: 'inherit' });
  } else {
    throw new Error(`Unsupported archive type: ${archive}`);
  }
}

/** Recursively find a file whose basename matches one of `names`. */
function findFile(dir: string, names: string[]): string | undefined {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      const found = findFile(full, names);
      if (found) {
        return found;
      }
    } else if (names.includes(entry)) {
      return full;
    }
  }
  return undefined;
}

function osCpu(target: string): { os: string; cpu: string } {
  const idx = target.indexOf('-');
  return { os: target.slice(0, idx), cpu: target.slice(idx + 1) };
}

async function packTarget(pkg: string, config: BinaryConfig, version: string, target: string): Promise<string> {
  const ver = version.replace(/^v/, '');
  const { os, cpu } = osCpu(target);
  const isWin = os === 'win32';

  const outBinary = config.binaryName + (isWin ? '.exe' : '');
  const innerBinary = (config.releaseBinaryName ?? config.binaryName) + (isWin ? '.exe' : '');

  const asset = config.targets[target].replace(/\{tag\}/g, version).replace(/\{ver\}/g, ver);
  const url = `https://github.com/${config.releaseRepo}/releases/download/${version}/${asset}`;

  const tmp = mkdtempSync(join(tmpdir(), `pack-${pkg}-${target}-`));
  try {
    const archivePath = join(tmp, asset);
    const extractDir = join(tmp, 'extracted');
    mkdirSync(extractDir);

    console.log(`  ↓ ${asset}`);
    await download(url, archivePath);
    extract(archivePath, extractDir);

    const binarySrc = findFile(extractDir, [innerBinary]);
    if (!binarySrc) {
      throw new Error(`Binary "${innerBinary}" not found inside ${asset}`);
    }

    const pkgDir = join(ROOT, 'packages', pkg, 'npm', target);
    mkdirSync(pkgDir, { recursive: true });

    const binaryDest = join(pkgDir, outBinary);
    copyFileSync(binarySrc, binaryDest);
    if (!isWin) {
      chmodSync(binaryDest, 0o755);
    }

    const platformPackageName = `@camera.ui/${pkg}-${target}`;
    writeJson(join(pkgDir, 'package.json'), {
      name: platformPackageName,
      version: ver,
      os: [os],
      cpu: [cpu],
      main: outBinary,
      files: [outBinary],
      license: 'MIT',
      repository: {
        type: 'git',
        url: REPO_URL,
        directory: `packages/${pkg}/npm/${target}`,
      },
      engines: { node: '>=22.0.0' },
    });

    console.log(`  ✓ ${platformPackageName}@${ver}`);
    return platformPackageName;
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

async function main(): Promise<void> {
  const { pkg, version: versionOverride, target } = parseArgs(process.argv.slice(2));

  const mainPkgPath = join(ROOT, 'packages', pkg, 'package.json');
  if (!existsSync(mainPkgPath)) {
    throw new Error(`No package at packages/${pkg}`);
  }

  const mainPkg = readJson<{
    camerauiBinary: BinaryConfig;
    optionalDependencies?: Record<string, string>;
    [k: string]: unknown;
  }>(mainPkgPath);
  const config = mainPkg.camerauiBinary;
  if (!config) {
    throw new Error(`packages/${pkg}/package.json is missing the "camerauiBinary" config block`);
  }

  const version = versionOverride ?? config.version;
  const ver = version.replace(/^v/, '');
  const targets = target ? [target] : Object.keys(config.targets);

  console.log(`Packing ${pkg} ${version} for: ${targets.join(', ')}`);

  const optionalDependencies: Record<string, string> = {
    ...mainPkg.optionalDependencies,
  };
  for (const t of targets) {
    if (!config.targets[t]) {
      throw new Error(`No asset configured for target "${t}"`);
    }
    const name = await packTarget(pkg, config, version, t);
    optionalDependencies[name] = ver;
  }

  // Keep main package.json in sync: version + pinned optional deps + config version.
  mainPkg.version = ver;
  mainPkg.camerauiBinary = { ...config, version };
  mainPkg.optionalDependencies = Object.fromEntries(Object.entries(optionalDependencies).sort(([a], [b]) => a.localeCompare(b)));
  writeJson(mainPkgPath, mainPkg);

  console.log(`Done. Main package @camera.ui/${pkg}@${ver} updated.`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
