import { lstat, readFile } from 'node:fs/promises';
import { createLesson06DirectoryAuthService } from './directory-auth-service.mjs';
import { HttpRequestError, readJson, requestPath, sendJson, sendRequestError } from '../../http.mjs';
import {
  createScenario,
  deleteScenario,
  scenarioFromRequest,
  sendScenarioMissing,
} from '../scenario-http.mjs';

const LESSON_ID = '06';
const CONTROL_ROOT = '/__course/lessons/06';

async function readBindPassword(config) {
  const stats = await lstat(config.bindPasswordFile);
  if (!stats.isFile() || stats.isSymbolicLink() || (stats.mode & 0o777) !== 0o600 || stats.size > 256) {
    throw new TypeError('Lesson 06 bind password file is unsafe');
  }
  const value = await readFile(config.bindPasswordFile, 'utf8');
  if (value.length < 12 || /[\u0000\r\n]/u.test(value)) {
    throw new TypeError('Lesson 06 bind password is invalid');
  }
  return value;
}

export function createLesson06ScenarioFactory(config) {
  if (!config || typeof config !== 'object') {
    return async () => {
      throw new TypeError('Lesson 06 LDAP runtime is not configured');
    };
  }
  return async function createLesson06Scenario() {
    const bindPassword = await readBindPassword(config);
    return Object.freeze({
      service: createLesson06DirectoryAuthService({
        config: {
          url: config.url,
          baseDn: config.baseDn,
          peopleBaseDn: config.peopleBaseDn,
          groupsBaseDn: config.groupsBaseDn,
          bindDn: config.bindDn,
          bindPassword,
        },
      }),
    });
  };
}

function requireScenario(request, response, registry) {
  const scenario = scenarioFromRequest(request, registry, LESSON_ID);
  if (!scenario) sendScenarioMissing(response);
  return scenario?.value ?? null;
}

export function createLesson06HttpHandler({ registry, scenarioFactory } = {}) {
  if (!registry || typeof registry.create !== 'function') throw new TypeError('registry is required');
  if (typeof scenarioFactory !== 'function') throw new TypeError('scenarioFactory is required');

  return async function handleLesson06(request, response) {
    const path = requestPath(request);
    if (request.method === 'POST' && path === `${CONTROL_ROOT}/scenarios`) {
      await createScenario({ response, registry, lessonId: LESSON_ID, factory: scenarioFactory });
      return true;
    }
    if (request.method === 'DELETE' && path === `${CONTROL_ROOT}/scenarios`) {
      deleteScenario({ request, response, registry, lessonId: LESSON_ID });
      return true;
    }
    if (![`${CONTROL_ROOT}/observe`, '/api/lessons/06/directory/authenticate'].includes(path)) return false;

    const scenario = requireScenario(request, response, registry);
    if (!scenario) return true;
    try {
      if (request.method === 'GET' && path === `${CONTROL_ROOT}/observe`) {
        sendJson(response, 200, scenario.service.observe());
        return true;
      }
      if (request.method === 'POST' && path === '/api/lessons/06/directory/authenticate') {
        const input = await readJson(request);
        const result = await scenario.service.authenticate(input?.identifier, input?.password);
        const { headers = {}, ...body } = result;
        sendJson(response, result.status, body, headers);
        return true;
      }
      return false;
    } catch (error) {
      if (error instanceof HttpRequestError) sendRequestError(response, error);
      else if (error instanceof TypeError) sendJson(response, 400, { error: { code: 'REQUEST_INVALID' } });
      else throw error;
      return true;
    }
  };
}
