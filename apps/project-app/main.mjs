import { createProjectAppServer } from './server.mjs';
import { readProjectAppRuntime } from './runtime.mjs';
import { createLesson06ScenarioFactory } from './lessons/06/http-handler.mjs';

async function main() {
  const runtime = readProjectAppRuntime();
  const server = createProjectAppServer({
    ...runtime,
    lesson06ScenarioFactory: createLesson06ScenarioFactory(runtime.lesson06Directory),
  });
  await new Promise((resolvePromise, rejectPromise) => {
    server.once('error', rejectPromise);
    server.listen(runtime.listen.port, runtime.listen.host, resolvePromise);
  });
}

main().catch((error) => {
  process.exitCode = 1;
  process.stderr.write(`${JSON.stringify({
    error: 'PROJECT_APP_START_FAILED',
    message: error instanceof Error ? error.message : 'unknown startup error',
  })}\n`);
});
