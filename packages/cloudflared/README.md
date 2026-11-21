# @camera.ui/cloudflared

[![cloudflared](https://img.shields.io/npm/v/@camera.ui/cloudflared?label=cloudflared&logo=npm)](https://www.npmjs.com/package/@camera.ui/cloudflared)

Prebuilt [cloudflared](https://github.com/cloudflare/cloudflared) binary for the camera.ui ecosystem, packed from the [camera.ui build](https://github.com/seydx/cloudflared/releases): Cloudflare's own assets, plus the Windows arm64 build they do not ship.

```js
import { cloudflaredPath, isCloudflaredAvailable } from '@camera.ui/cloudflared';

if (isCloudflaredAvailable()) {
  spawn(cloudflaredPath(), ['tunnel', '--url', '...']);
}
```

## Supported platforms

| os     | x64 | arm64 |
| ------ | --- | ----- |
| darwin | ✓   | ✓     |
| linux  | ✓   | ✓     |
| win32  | ✓   | ✓     |

macOS, Linux and Windows x64 are Cloudflare's own binaries, mirrored unchanged, so the macOS builds keep their signature. Windows arm64 is built from the same source, because Cloudflare ships none.

The binary is Apache-2.0, see [cloudflare/cloudflared](https://github.com/cloudflare/cloudflared/blob/master/LICENSE). The wrapper in this package is MIT.

---

_Part of camera.ui, the local-first camera and NVR platform._
