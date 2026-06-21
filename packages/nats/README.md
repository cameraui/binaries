# @camera.ui/nats

[![nats](https://img.shields.io/npm/v/@camera.ui/nats?label=nats&logo=npm)](https://www.npmjs.com/package/@camera.ui/nats)

Prebuilt [nats-server](https://github.com/nats-io/nats-server) binary for the camera.ui ecosystem.

```js
import { natsServerPath, isNatsServerAvailable } from '@camera.ui/nats';

if (isNatsServerAvailable()) {
  spawn(natsServerPath(), ['-c', '...']);
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
