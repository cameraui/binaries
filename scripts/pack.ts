#!/usr/bin/env tsx

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
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
  /** upstream tag prefix, "v" unless the project tags without one (cloudflared) */
  tagPrefix?: string;
  license?: string;
  targets: Record<string, string>;
}

interface ReleaseAssets {
  /** asset name -> sha256 GitHub computed for the uploaded file */
  digests: Map<string, string>;
  /** asset name -> sha256 the maintainers list in the release notes */
  noted: Map<string, string>;
}

interface LicenseFile {
  name: string;
  content: Buffer;
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

function sha256(file: string): string {
  return createHash('sha256').update(readFileSync(file)).digest('hex');
}

function githubHeaders(): Record<string, string> {
  const headers: Record<string, string> = { accept: 'application/vnd.github+json' };
  if (process.env.GITHUB_TOKEN) {
    headers.authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  }
  return headers;
}

async function fetchReleaseAssets(repo: string, version: string): Promise<ReleaseAssets> {
  const res = await fetch(`https://api.github.com/repos/${repo}/releases/tags/${version}`, { headers: githubHeaders() });
  if (!res.ok) {
    throw new Error(`Release lookup failed (${res.status}): ${repo}@${version}`);
  }

  const release = (await res.json()) as { body?: string; assets?: { name: string; digest?: string | null }[] };

  const digests = new Map<string, string>();
  for (const asset of release.assets ?? []) {
    const digest = asset.digest?.replace(/^sha256:/, '');
    if (digest) {
      digests.set(asset.name, digest.toLowerCase());
    }
  }

  const noted = new Map<string, string>();
  for (const line of (release.body ?? '').split('\n')) {
    const match = /^\s*([\w.+-]+):\s*([a-f0-9]{64})\s*$/i.exec(line);
    if (match) {
      noted.set(match[1], match[2].toLowerCase());
    }
  }

  return { digests, noted };
}

async function fetchLicense(repo: string, tag: string, expected: string): Promise<LicenseFile> {
  const res = await fetch(`https://api.github.com/repos/${repo}/license?ref=${encodeURIComponent(tag)}`, { headers: githubHeaders() });
  if (!res.ok) {
    throw new Error(`License lookup failed (${res.status}): ${repo}@${tag}`);
  }

  const license = (await res.json()) as { name: string; content: string; license?: { spdx_id?: string } };
  const spdx = license.license?.spdx_id;
  if (spdx !== expected) {
    throw new Error(`${repo}@${tag} is licensed ${spdx ?? 'unknown'}, but camerauiBinary.license says ${expected}`);
  }

  return { name: license.name, content: Buffer.from(license.content, 'base64') };
}

function isArchive(asset: string): boolean {
  return asset.endsWith('.zip') || asset.endsWith('.tar.gz') || asset.endsWith('.tgz');
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

// Two independent sources: the digest GitHub computed for the upload, and the
// hash the maintainers publish in the release notes. The notes may describe the
// binary inside an archive instead of the archive itself (cloudflared on macOS).
function verifyChecksums(asset: string, assets: ReleaseAssets, archivePath: string, binaryPath: string): void {
  const digest = assets.digests.get(asset);
  if (!digest) {
    throw new Error(`No sha256 digest published for ${asset}`);
  }

  const downloaded = sha256(archivePath);
  if (downloaded !== digest) {
    throw new Error(`Checksum mismatch for ${asset}: expected ${digest}, got ${downloaded}`);
  }

  const noted = assets.noted.get(asset);
  if (noted && noted !== downloaded && noted !== sha256(binaryPath)) {
    throw new Error(`Release notes checksum for ${asset} matches neither the download nor the extracted binary`);
  }
}

async function packTarget(pkg: string, config: BinaryConfig, tag: string, ver: string, target: string, assets: ReleaseAssets, license: LicenseFile): Promise<string> {
  const { os, cpu } = osCpu(target);
  const isWin = os === 'win32';

  const outBinary = config.binaryName + (isWin ? '.exe' : '');
  const innerBinary = (config.releaseBinaryName ?? config.binaryName) + (isWin ? '.exe' : '');

  const asset = config.targets[target].replace(/\{tag\}/g, tag).replace(/\{ver\}/g, ver);
  const url = `https://github.com/${config.releaseRepo}/releases/download/${tag}/${asset}`;

  const tmp = mkdtempSync(join(tmpdir(), `pack-${pkg}-${target}-`));
  try {
    const archivePath = join(tmp, asset);
    const extractDir = join(tmp, 'extracted');
    mkdirSync(extractDir);

    console.log(`  ↓ ${asset}`);
    await download(url, archivePath);

    let binarySrc: string | undefined = archivePath;
    if (isArchive(asset)) {
      extract(archivePath, extractDir);
      binarySrc = findFile(extractDir, [innerBinary]);
      if (!binarySrc) {
        throw new Error(`Binary "${innerBinary}" not found inside ${asset}`);
      }
    }

    verifyChecksums(asset, assets, archivePath, binarySrc);

    const pkgDir = join(ROOT, 'packages', pkg, 'npm', target);
    mkdirSync(pkgDir, { recursive: true });

    const binaryDest = join(pkgDir, outBinary);
    copyFileSync(binarySrc, binaryDest);
    if (!isWin) {
      chmodSync(binaryDest, 0o755);
    }
    writeFileSync(join(pkgDir, license.name), license.content);

    const platformPackageName = `@camera.ui/${pkg}-${target}`;
    writeJson(join(pkgDir, 'package.json'), {
      name: platformPackageName,
      version: ver,
      os: [os],
      cpu: [cpu],
      main: outBinary,
      files: [outBinary, license.name],
      license: config.license ?? 'MIT',
      repository: {
        type: 'git',
        url: REPO_URL,
        directory: `packages/${pkg}/npm/${target}`,
      },
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

  const ver = (versionOverride ?? config.version).replace(/^v/, '');
  const tag = `${config.tagPrefix ?? 'v'}${ver}`;
  const targets = target ? [target] : Object.keys(config.targets);

  console.log(`Packing ${pkg} ${tag} for: ${targets.join(', ')}`);

  const assets = await fetchReleaseAssets(config.releaseRepo, tag);
  const license = await fetchLicense(config.releaseRepo, tag, config.license ?? 'MIT');

  const optionalDependencies: Record<string, string> = {
    ...mainPkg.optionalDependencies,
  };
  for (const t of targets) {
    if (!config.targets[t]) {
      throw new Error(`No asset configured for target "${t}"`);
    }
    const name = await packTarget(pkg, config, tag, ver, t, assets, license);
    optionalDependencies[name] = ver;
  }

  // Keep main package.json in sync: version + pinned optional deps + config version.
  mainPkg.version = ver;
  mainPkg.camerauiBinary = { ...config, version: tag };
  mainPkg.optionalDependencies = Object.fromEntries(Object.entries(optionalDependencies).sort(([a], [b]) => a.localeCompare(b)));
  writeJson(mainPkgPath, mainPkg);

  console.log(`Done. Main package @camera.ui/${pkg}@${ver} updated.`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
