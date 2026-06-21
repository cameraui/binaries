# @camera.ui/go2rtc

[![go2rtc](https://img.shields.io/npm/v/@camera.ui/go2rtc?label=go2rtc&logo=npm)](https://www.npmjs.com/package/@camera.ui/go2rtc)

Prebuilt [go2rtc](https://github.com/seydx/go2rtc) binary for the camera.ui ecosystem.

```js
import { go2rtcPath, isGo2rtcAvailable } from '@camera.ui/go2rtc';

if (isGo2rtcAvailable()) {
  spawn(go2rtcPath(), ['-config', '...']);
}
```

## Supported platforms

| os     | x64 | arm64 |
| ------ | --- | ----- |
| darwin | ✓   | ✓     |
| linux  | ✓   | ✓     |
| win32  | ✓   | ✓     |

---

_Part of the camera.ui ecosystem._
