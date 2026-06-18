# @camera.ui/tunnel

[![tunnel](https://img.shields.io/npm/v/@camera.ui/tunnel?label=tunnel&logo=npm)](https://www.npmjs.com/package/@camera.ui/tunnel)

Prebuilt [tunnel](https://github.com/cameraui/tunnel) client binary for the camera.ui ecosystem.

```js
import { tunnelPath, isTunnelAvailable } from '@camera.ui/tunnel';

if (isTunnelAvailable()) {
  spawn(tunnelPath(), ['--config', '...']);
}
```

## Supported platforms

| os      | x64 | arm64 |
| ------- | --- | ----- |
| darwin  | ✓   | ✓     |
| linux   | ✓   | ✓     |
| win32   | ✓   | ✓     |

---

_Part of the camera.ui ecosystem._
