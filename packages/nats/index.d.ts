/**
 * Absolute path to the nats-server binary for the current platform.
 *
 * @throws if no prebuilt binary is available for the current platform/arch
 * (i.e. the matching optional dependency was not installed).
 */
export function natsServerPath(): string;

/** Whether the nats-server binary for the current platform is installed and present on disk. */
export function isNatsServerAvailable(): boolean;
