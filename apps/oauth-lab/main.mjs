import { createOAuthLab } from './lab.mjs';
import { readManagedLabRuntime } from './runtime.mjs';

const managed = process.env.COURSE_INSTALL_ID ? readManagedLabRuntime() : null;
let lab;
lab = await createOAuthLab({
  control: managed ? {
    identity: managed.identity,
    shutdownToken: managed.shutdownToken,
    onShutdown: async () => {
      await lab.stop();
    },
  } : null,
});
await lab.start();

async function shutdown() {
  await lab.stop();
  process.exitCode = 0;
}

process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);
