import { createAuthorizationServer } from './authorization-server.mjs';
import { createClientServer } from './client-server.mjs';
import { createLabConfig } from './config.mjs';
import { randomOpaque } from './crypto.mjs';
import { createResourceOwnerAuthenticator } from './resource-owner.mjs';
import { createResourceServer } from './resource-server.mjs';
import { createLabScenarioRegistry } from './scenario-registry.mjs';

async function listen(server, port, host) {
  await new Promise((resolve, reject) => {
    const cleanup = () => {
      server.off('listening', onListening);
      server.off('error', onError);
    };
    const onListening = () => {
      cleanup();
      resolve();
    };
    const onError = (error) => {
      cleanup();
      reject(error);
    };
    server.once('listening', onListening);
    server.once('error', onError);
    server.listen(port, host);
  });
}

async function close(server) {
  if (!server.listening) return;
  await new Promise((resolve) => server.close(resolve));
}

export async function createOAuthLab(options = {}) {
  const config = createLabConfig(options);
  const scenarioRegistry = createLabScenarioRegistry();
  const resourceSecret = randomOpaque();
  const authenticate = options.authenticate ?? await createResourceOwnerAuthenticator();
  const authorization = await createAuthorizationServer({
    config,
    authenticate,
    resourceSecret,
    now: options.now,
    idTokenFaultQueue: options.idTokenFaultQueue,
    control: options.control,
    scenarioRegistry,
  });
  const client = createClientServer({
    config,
    now: options.now,
    oauthClientFaultQueue: options.oauthClientFaultQueue,
    scenarioRegistry,
    control: options.control,
  });
  const resource = createResourceServer({
    config, resourceSecret, scenarioRegistry, control: options.control, now: options.now,
  });
  const servers = [authorization.server, client.server, resource.server];
  let started = false;

  async function start() {
    if (started) return snapshot();
    const opened = [];
    try {
      await listen(authorization.server, config.asPort, config.host);
      opened.push(authorization.server);
      await listen(client.server, config.clientPort, config.host);
      opened.push(client.server);
      await listen(resource.server, config.apiPort, config.host);
      opened.push(resource.server);
      started = true;
      return snapshot();
    } catch (error) {
      await Promise.allSettled(opened.map(close));
      throw Object.assign(new Error('OAuth lab could not bind its configured loopback origins'), {
        cause: error,
        reasonCode: 'OAUTH_LAB_PORT_UNAVAILABLE',
      });
    }
  }

  async function stop() {
    await Promise.allSettled(servers.map(close));
    started = false;
  }

  function snapshot() {
    return Object.freeze({
      started,
      origins: Object.freeze({
        authorizationServer: config.issuer,
        client: config.clientOrigin,
        resourceApi: config.apiOrigin,
      }),
      transportContext: config.transportContext,
      productionRequirement: config.productionRequirement,
    });
  }

  return Object.freeze({
    config,
    start,
    stop,
    snapshot,
    evidence: scenarioRegistry.defaultScenario.evidence.snapshot,
  });
}
