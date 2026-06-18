'use strict';

const { dirname, join } = require('node:path');
const { existsSync } = require('node:fs');

const pkg = require('./package.json');

const binaryName = pkg.camerauiBinary.binaryName;
const platformPackage = `${pkg.name}-${process.platform}-${process.arch}`;
const binaryFile = process.platform === 'win32' ? `${binaryName}.exe` : binaryName;

function resolveBinaryPath() {
  try {
    const manifest = require.resolve(`${platformPackage}/package.json`);
    return join(dirname(manifest), binaryFile);
  } catch {
    throw new Error(
      `[${pkg.name}] No prebuilt binary available for ${process.platform}-${process.arch}. ` +
        `Expected the optional dependency "${platformPackage}" to be installed.`,
    );
  }
}

/** Absolute path to the go2rtc binary for the current platform. Throws if unsupported. */
function go2rtcPath() {
  return resolveBinaryPath();
}

/** Whether the go2rtc binary for the current platform is installed and present on disk. */
function isGo2rtcAvailable() {
  try {
    return existsSync(resolveBinaryPath());
  } catch {
    return false;
  }
}

module.exports = { go2rtcPath, isGo2rtcAvailable };
