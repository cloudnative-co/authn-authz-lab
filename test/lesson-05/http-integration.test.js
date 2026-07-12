import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createProjectAppServer } from '../../apps/project-app/server.mjs';
import { LESSON_05_BASIC_CHALLENGE } from '../../apps/project-app/lessons/05/basic-auth-service.mjs';

const identity = Object.freeze({
  pid: process.pid,
  installId: 'install-lesson05-http',
  runId: 'run-lesson05-http',
  instanceId: 'install-lesson05-http.run-lesson05-http',
});

function basic(userPass) {
  return `Basic ${Buffer.from(userPass, 'utf8').toString('base64')}`;
}

test('Lesson 05 performs a real Basic challenge-response exchange on every request', async () => {
  const server = createProjectAppServer({
    identity,
    shutdownToken: 'A'.repeat(43),
  });
  await new Promise((resolvePromise, rejectPromise) => {
    server.once('error', rejectPromise);
    server.listen(0, '127.0.0.1', resolvePromise);
  });
  const origin = `http://127.0.0.1:${server.address().port}`;
  try {
    const created = await fetch(`${origin}/__course/lessons/05/scenarios`, { method: 'POST' });
    assert.equal(created.status, 201);
    const scenarioId = created.headers.get('x-course-scenario-id');
    const request = (authorization) => fetch(`${origin}/api/lessons/05/basic/me`, {
      headers: {
        'x-course-scenario-id': scenarioId,
        ...(authorization === undefined ? {} : { authorization }),
      },
    });

    const absent = await request();
    assert.equal(absent.status, 401);
    assert.equal(absent.headers.get('www-authenticate'), LESSON_05_BASIC_CHALLENGE);
    const challengeBody = await absent.json();

    const correctHeader = basic('basic.alice@example.test:basic-password-for-lesson-05');
    const success = await request(correctHeader);
    assert.equal(success.status, 200);
    assert.equal(success.headers.get('www-authenticate'), null);
    assert.equal(success.headers.get('set-cookie'), null);
    assert.deepEqual(await success.json(), {
      ok: true, status: 200, code: 'BASIC_AUTHENTICATED', principal: { id: 'user-500' },
    });

    const absentAgain = await request();
    assert.equal(absentAgain.status, 401);
    assert.deepEqual(await absentAgain.json(), challengeBody);

    const wrong = await request(basic('basic.alice@example.test:wrong-password'));
    assert.equal(wrong.status, 401);
    assert.equal(wrong.headers.get('www-authenticate'), LESSON_05_BASIC_CHALLENGE);
    assert.deepEqual(await wrong.json(), challengeBody);

    const observedResponse = await fetch(`${origin}/__course/lessons/05/observe`, {
      headers: { 'x-course-scenario-id': scenarioId },
    });
    const observedText = await observedResponse.text();
    const observed = JSON.parse(observedText);
    assert.equal(observed.implementation.transportContext, 'loopback-http-training-deviation');
    assert.equal(observed.implementation.productionRequirement, 'tls-required');
    for (const secret of [
      correctHeader,
      'basic.alice@example.test',
      'basic-password-for-lesson-05',
      Buffer.from('basic.alice@example.test:basic-password-for-lesson-05').toString('base64'),
    ]) assert.equal(observedText.includes(secret), false);

    assert.equal((await fetch(`${origin}/__course/lessons/05/scenarios`, {
      method: 'DELETE', headers: { 'x-course-scenario-id': scenarioId },
    })).status, 204);
  } finally {
    await new Promise((resolvePromise) => server.close(resolvePromise));
  }
});
