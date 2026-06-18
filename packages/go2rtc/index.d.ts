/**
 * Absolute path to the go2rtc binary for the current platform.
 *
 * @throws if no prebuilt binary is available for the current platform/arch
 * (i.e. the matching optional dependency was not installed).
 */
export function go2rtcPath(): string;

/** Whether the go2rtc binary for the current platform is installed and present on disk. */
export function isGo2rtcAvailable(): boolean;
