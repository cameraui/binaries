/**
 * Absolute path to the tunnel binary for the current platform.
 *
 * @throws if no prebuilt binary is available for the current platform/arch
 * (i.e. the matching optional dependency was not installed).
 */
export function tunnelPath(): string;

/** Whether the tunnel binary for the current platform is installed and present on disk. */
export function isTunnelAvailable(): boolean;
