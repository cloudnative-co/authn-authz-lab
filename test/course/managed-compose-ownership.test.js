import assert from 'node:assert/strict';
import { cp, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { test } from 'node:test';

import {
  ensureManagedComposeProject,
  inspectManagedComposeProject,
  ManagedComposeError,
  stopManagedComposeProjects,
} from '../../course/runner/managed-compose.mjs';
import { createStateRoot } from '../../course/runner/state.mjs';

const repositoryRoot = resolve(import.meta.dirname, '../..');
const INSTALL_ID = '1'.repeat(32);

function result(code, stdout = '', stderr = '') {
  return { code, signal: null, stdout, stderr };
}

class FakeDocker {
  constructor() {
    this.calls = [];
    this.projects = new Map();
    this.fileResources = new Map();
    this.counter = 1;
    this.configVersion = 1;
    this.failDiscoveryAfterUp = false;
    this.failedDiscovery = false;
  }

  register(composeFile, resourceId, { services = ['app'], networks = ['default'], volumes = [] } = {}) {
    this.fileResources.set(composeFile, { resourceId, services, networks, volumes });
  }

  id() {
    const value = this.counter.toString(16).padStart(64, '0');
    this.counter += 1;
    return value;
  }

  projectForContainer(id) {
    return [...this.projects.values()].find(({ containers }) => containers.some((entry) => entry.id === id));
  }

  projectForNetwork(id) {
    return [...this.projects.values()].find(({ networks }) => networks.some((entry) => entry.id === id));
  }

  projectForVolume(name) {
    return [...this.projects.values()].find(({ volumes }) => volumes.some((entry) => entry.name === name));
  }

  createProject(projectName, composeFile, env) {
    const definition = this.fileResources.get(composeFile);
    assert.ok(definition, `unregistered fake Compose file: ${composeFile}`);
    const labels = {
      'io.cloudnative.course.id': 'auth-authz',
      'io.cloudnative.course.install-id': env.COURSE_INSTALL_ID,
      'io.cloudnative.course.resource-id': definition.resourceId,
      'com.docker.compose.project': projectName,
    };
    const volumes = definition.volumes.map((key) => ({
      key,
      name: `${projectName}_${key}`,
      labels: { ...labels, 'com.docker.compose.volume': key },
    }));
    const project = {
      projectName,
      resourceId: definition.resourceId,
      containers: definition.services.map((serviceName) => ({
        id: this.id(),
        serviceName,
        running: true,
        labels: {
          ...labels,
          'com.docker.compose.service': serviceName,
          'com.docker.compose.config-hash': 'a'.repeat(64),
        },
        mounts: volumes.map(({ name }) => ({ Type: 'volume', Name: name })),
      })),
      networks: definition.networks.map((key) => ({
        key,
        id: this.id(),
        name: `${projectName}_${key}`,
        labels: { ...labels, 'com.docker.compose.network': key },
      })),
      volumes,
    };
    this.projects.set(projectName, project);
    return project;
  }

  run = async (_executable, args, options) => {
    this.calls.push([...args]);
    if (args[0] === '--version') return result(0, 'Docker version 29.0.0');
    if (args[0] === 'version') return result(0, '"29.0.0"');
    if (args[0] === 'compose' && args[1] === 'version') return result(0, '5.0.0');

    if (args[0] === 'compose') {
      const projectName = args[2];
      const composeFile = args[4];
      const command = args[5];
      const definition = this.fileResources.get(composeFile);
      if (command === 'config') {
        return result(0, JSON.stringify({
          version: this.configVersion,
          services: Object.fromEntries(definition.services.map((name) => [name, { image: `${name}:test` }])),
          networks: Object.fromEntries(definition.networks.map((name) => [name, {}])),
          volumes: Object.fromEntries(definition.volumes.map((name) => [name, {}])),
        }));
      }
      if (command === 'build') return result(0);
      if (command === 'up') {
        this.createProject(projectName, composeFile, options.env);
        return result(0);
      }
    }

    if (args[0] === 'ps') {
      const projectName = args.find((value) => value.startsWith('label=com.docker.compose.project='))
        ?.split('=').at(-1);
      if (this.failDiscoveryAfterUp && !this.failedDiscovery && this.projects.has(projectName)) {
        this.failedDiscovery = true;
        return result(1, '', 'interrupted discovery');
      }
      const project = this.projects.get(projectName);
      return result(0, project ? `${project.containers.map(({ id }) => id).join('\n')}\n` : '');
    }

    if (args[0] === 'inspect') {
      const id = args.at(-1);
      const project = this.projectForContainer(id);
      const container = project?.containers.find((entry) => entry.id === id);
      if (!container) return result(1, '', 'not found');
      return result(0, JSON.stringify([{
        Id: id,
        Config: { Labels: container.labels },
        State: { Running: container.running, Health: { Status: container.running ? 'healthy' : 'none' } },
        HostConfig: { PortBindings: {} },
        Mounts: container.mounts,
      }]));
    }

    if (args[0] === 'network' && args[1] === 'ls') {
      const projectName = args.find((value) => value.startsWith('label=com.docker.compose.project='))
        ?.split('=').at(-1);
      const project = this.projects.get(projectName);
      return result(0, project ? `${project.networks.map(({ id }) => id).join('\n')}\n` : '');
    }
    if (args[0] === 'network' && args[1] === 'inspect') {
      const id = args[2];
      const project = this.projectForNetwork(id);
      const network = project?.networks.find((entry) => entry.id === id);
      if (!network) return result(1, '', 'not found');
      return result(0, JSON.stringify([{ Id: id, Name: network.name, Labels: network.labels }]));
    }
    if (args[0] === 'network' && args[1] === 'rm') {
      const id = args[2];
      const project = this.projectForNetwork(id);
      project.networks = project.networks.filter((entry) => entry.id !== id);
      this.dropEmptyProject(project);
      return result(0);
    }

    if (args[0] === 'volume' && args[1] === 'ls') {
      const projectName = args.find((value) => value.startsWith('label=com.docker.compose.project='))
        ?.split('=').at(-1);
      const project = this.projects.get(projectName);
      return result(0, project ? `${project.volumes.map(({ name }) => name).join('\n')}\n` : '');
    }
    if (args[0] === 'volume' && args[1] === 'inspect') {
      const name = args[2];
      const project = this.projectForVolume(name);
      const volume = project?.volumes.find((entry) => entry.name === name);
      if (!volume) return result(1, '', 'not found');
      return result(0, JSON.stringify([{ Name: name, Labels: volume.labels }]));
    }
    if (args[0] === 'volume' && args[1] === 'rm') {
      const name = args[2];
      const project = this.projectForVolume(name);
      project.volumes = project.volumes.filter((entry) => entry.name !== name);
      this.dropEmptyProject(project);
      return result(0);
    }

    if (args[0] === 'stop') {
      const project = this.projectForContainer(args.at(-1));
      project.containers.find((entry) => entry.id === args.at(-1)).running = false;
      return result(0);
    }
    if (args[0] === 'rm') {
      const id = args.at(-1);
      const project = this.projectForContainer(id);
      project.containers = project.containers.filter((entry) => entry.id !== id);
      this.dropEmptyProject(project);
      return result(0);
    }
    throw new Error(`unexpected fake Docker command: ${args.join(' ')}`);
  };

  dropEmptyProject(project) {
    if (project.containers.length === 0 && project.networks.length === 0 && project.volumes.length === 0) {
      this.projects.delete(project.projectName);
    }
  }
}

function spec(composeFile, resourceId, { volume = false, port = null } = {}) {
  return {
    resourceId,
    composeFile,
    buildServices: ['app'],
    targetServices: ['app'],
    expectedServices: ['app'],
    expectedNetworks: ['default'],
    expectedVolumes: volume ? ['data'] : [],
    noDependencies: true,
    publishedPorts: port === null ? [] : [{
      serviceName: 'app', host: '127.0.0.1', hostPort: port, containerPort: 389, protocol: 'tcp',
    }],
    composeEnvironment: { LAB_CONFIG_DIR: '.lab/config' },
    supplementalFiles: [],
  };
}

async function fixture(definitions) {
  const root = await mkdtemp(resolve(tmpdir(), 'managed-compose-test-'));
  await mkdir(resolve(root, 'curriculum'));
  await cp(resolve(repositoryRoot, 'curriculum/schemas'), resolve(root, 'curriculum/schemas'), { recursive: true });
  const fake = new FakeDocker();
  for (const definition of definitions) {
    await writeFile(resolve(root, definition.file), 'services: {}\n');
    fake.register(definition.file, definition.resourceId, definition);
  }
  const context = await createStateRoot({
    repoRoot: root,
    stateRoot: '.lab',
    courseId: 'auth-authz',
    sourceDigest: 'b'.repeat(64),
    installId: INSTALL_ID,
  });
  return {
    root,
    stateRoot: context.stateRoot,
    fake,
    dependencies: { runCommand: fake.run, probePort: async () => ({ available: true }) },
  };
}

async function cleanup(value) {
  await rm(value.root, { recursive: true, force: true });
}

test('pending intent adopts one exact orphan with owned network and volume', async () => {
  const value = await fixture([{ file: 'compose.yml', resourceId: 'alpha-lab', volumes: ['data'] }]);
  const projectSpec = spec('compose.yml', 'alpha-lab', { volume: true });
  value.fake.failDiscoveryAfterUp = true;
  try {
    await assert.rejects(
      ensureManagedComposeProject({ ...value, repoRoot: value.root, spec: projectSpec }),
      (error) => error.reasonCode === 'CONTAINER_DISCOVERY_FAILED',
    );
    const adopted = await ensureManagedComposeProject({ ...value, repoRoot: value.root, spec: projectSpec });
    assert.equal(adopted.adopted, true);
    assert.equal(adopted.started, false);
    assert.equal(adopted.serviceCount, 1);
  } finally {
    await stopManagedComposeProjects({ ...value, repoRoot: value.root, remove: true }).catch(() => {});
    await cleanup(value);
  }
});

test('foreign label drift fails closed and never reaches stop or rm', async () => {
  const value = await fixture([{ file: 'compose.yml', resourceId: 'alpha-lab' }]);
  try {
    await ensureManagedComposeProject({ ...value, repoRoot: value.root, spec: spec('compose.yml', 'alpha-lab') });
    const project = [...value.fake.projects.values()][0];
    project.containers[0].labels['io.cloudnative.course.resource-id'] = 'foreign-lab';
    const before = value.fake.calls.length;
    await assert.rejects(
      stopManagedComposeProjects({ ...value, repoRoot: value.root, remove: true }),
      (error) => error.reasonCode === 'CONTAINER_OWNERSHIP_MISMATCH',
    );
    assert.equal(
      value.fake.calls.slice(before).some((args) => ['stop', 'rm'].includes(args[0])),
      false,
    );
  } finally {
    await cleanup(value);
  }
});

test('cleanup ignores current config drift and resumes after an external partial deletion', async () => {
  const value = await fixture([{ file: 'compose.yml', resourceId: 'alpha-lab', volumes: ['data'] }]);
  const projectSpec = spec('compose.yml', 'alpha-lab', { volume: true });
  try {
    await ensureManagedComposeProject({ ...value, repoRoot: value.root, spec: projectSpec });
    value.fake.configVersion += 1;
    await assert.rejects(
      inspectManagedComposeProject({ ...value, repoRoot: value.root, spec: projectSpec }),
      (error) => error.reasonCode === 'CONTAINER_CONFIG_DRIFT',
    );
    const project = [...value.fake.projects.values()][0];
    project.containers = [];
    const [removed] = await stopManagedComposeProjects({ ...value, repoRoot: value.root, remove: true });
    assert.equal(removed.reasonCode, 'CONTAINER_NOT_FOUND');
    assert.equal(value.fake.projects.size, 0);
  } finally {
    await cleanup(value);
  }
});

test('port conflicts block before build and resource-specific projects clean up independently', async () => {
  const value = await fixture([
    { file: 'alpha.yml', resourceId: 'alpha-lab' },
    { file: 'bravo.yml', resourceId: 'bravo-lab' },
    { file: 'port.yml', resourceId: 'port-lab' },
  ]);
  try {
    await assert.rejects(ensureManagedComposeProject({
      ...value,
      repoRoot: value.root,
      spec: spec('port.yml', 'port-lab', { port: 1389 }),
      dependencies: { ...value.dependencies, probePort: async () => ({ available: false }) },
    }), (error) => error.reasonCode === 'PREREQUISITE_CONTAINER_PORT_IN_USE');
    assert.equal(value.fake.calls.some((args) => args.includes('build') && args.includes('port.yml')), false);

    await ensureManagedComposeProject({ ...value, repoRoot: value.root, spec: spec('alpha.yml', 'alpha-lab') });
    await ensureManagedComposeProject({ ...value, repoRoot: value.root, spec: spec('bravo.yml', 'bravo-lab') });
    assert.equal(value.fake.projects.size, 2);
    await stopManagedComposeProjects({
      ...value,
      repoRoot: value.root,
      resourceIds: ['alpha-lab'],
      remove: true,
    });
    assert.equal(value.fake.projects.size, 1);
    const bravo = await inspectManagedComposeProject({
      ...value,
      repoRoot: value.root,
      spec: spec('bravo.yml', 'bravo-lab'),
    });
    assert.equal(bravo.status, 'running');
  } finally {
    await stopManagedComposeProjects({ ...value, repoRoot: value.root, remove: true }).catch(() => {});
    await cleanup(value);
  }
});
