import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const learnerReadmes = [
  'README.md',
  ...readdirSync(resolve(repositoryRoot, 'course/lessons'), { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => `course/lessons/${entry.name}/README.md`)
    .filter((relativePath) => existsSync(resolve(repositoryRoot, relativePath)))
    .sort(),
];

function parseMarkdown(source) {
  const nodes = [];
  const lines = source.split(/\r?\n/u);
  let paragraph = [];

  const flushParagraph = () => {
    if (paragraph.length === 0) return;
    nodes.push({ type: 'text', value: paragraph.join('\n') });
    paragraph = [];
  };

  for (let index = 0; index < lines.length; index += 1) {
    const opening = lines[index].match(/^\s*(`{3,}|~{3,})\s*([^\s]*)\s*$/u);
    if (opening) {
      flushParagraph();
      const fence = opening[1];
      const marker = fence[0];
      const minimumLength = fence.length;
      const value = [];
      const startLine = index + 1;
      let closed = false;

      for (index += 1; index < lines.length; index += 1) {
        const closing = lines[index].match(/^\s*(`{3,}|~{3,})\s*$/u);
        if (closing && closing[1][0] === marker && closing[1].length >= minimumLength) {
          closed = true;
          break;
        }
        value.push(lines[index]);
      }

      assert.equal(closed, true, `unclosed Markdown fence at line ${startLine}`);
      nodes.push({
        type: 'code',
        lang: opening[2].toLowerCase(),
        value: value.join('\n'),
        line: startLine,
      });
    } else if (lines[index].trim() === '') {
      flushParagraph();
    } else {
      paragraph.push(lines[index]);
    }
  }

  flushParagraph();
  return nodes;
}

function read(relativePath) {
  return readFileSync(resolve(repositoryRoot, relativePath), 'utf8');
}

function courseCommands(node) {
  if (node.type !== 'code' || !['bash', 'sh'].includes(node.lang)) return [];
  return node.value.split(/\r?\n/u).filter((line) => /\bnode course\.mjs(?:\s|$)/u.test(line));
}

test('learner-facing shell fences contain at most one course command', () => {
  for (const relativePath of learnerReadmes) {
    const nodes = parseMarkdown(read(relativePath));
    for (const node of nodes) {
      const commands = courseCommands(node);
      assert.ok(
        commands.length <= 1,
        `${relativePath}:${node.line} combines course commands: ${commands.join(' | ')}`,
      );
      assert.equal(
        commands.some((command) => /\scheck(?:\s|$)/u.test(command))
          && commands.some((command) => /\sstop(?:\s|$)/u.test(command)),
        false,
        `${relativePath}:${node.line} combines check and stop`,
      );
    }
  }
});

test('Lesson phases require a successful result before the next command', () => {
  const phasePattern = /\s(?:doctor|setup|demo|observe|check)(?:\s|$)/u;
  const successPattern = /\[PASS\]|safe-noop|終了code 0|`pass`|成功|合格/u;

  for (const relativePath of learnerReadmes) {
    const nodes = parseMarkdown(read(relativePath));
    const phases = nodes
      .map((node, index) => ({ command: courseCommands(node)[0], index }))
      .filter(({ command }) => command && phasePattern.test(command));

    for (let position = 0; position < phases.length - 1; position += 1) {
      const current = phases[position];
      const next = phases[position + 1];
      const guidance = nodes.slice(current.index + 1, next.index)
        .filter((node) => node.type === 'text')
        .map((node) => node.value)
        .join('\n');
      assert.match(
        guidance,
        successPattern,
        `${relativePath} does not confirm success between "${current.command}" and "${next.command}"`,
      );
    }
  }
});

test('fenced recovery commands explain their effect without combining alternatives', () => {
  const effectByAction = new Map([
    ['diagnose', /diagnose|診断|読み取り専用|stateを変更しない|原因/u],
    ['reset', /回答.*破棄|初期状態|初期化|やり直|作り直/u],
    ['stop', /停止|止め|終了|保持/u],
    ['purge', /course全体|course-wide|全state|全Lesson|削除/u],
  ]);

  for (const relativePath of learnerReadmes) {
    const nodes = parseMarkdown(read(relativePath));
    for (let index = 0; index < nodes.length; index += 1) {
      const [command] = courseCommands(nodes[index]);
      if (!command) continue;
      const action = command.match(/\s(diagnose|reset|stop|purge)(?:\s|$)/u)?.[1];
      if (!action) continue;

      const neighboringGuidance = nodes.slice(Math.max(0, index - 2), index + 3)
        .filter((node) => node.type === 'text')
        .map((node) => node.value)
        .join('\n');
      assert.match(
        neighboringGuidance,
        effectByAction.get(action),
        `${relativePath}:${nodes[index].line} does not explain ${action}`,
      );
    }
  }
});

test('every Lesson keeps its runtime until all required checks pass', () => {
  for (const relativePath of learnerReadmes.filter((path) => (
    path.startsWith('course/lessons/') && !path.includes('/setup/')
  ))) {
    const nodes = parseMarkdown(read(relativePath));
    const checkAt = nodes.findIndex((node) => (
      courseCommands(node).some((command) => /\scheck(?:\s|$)/u.test(command))
    ));
    const stopAt = nodes.findIndex((node) => (
      courseCommands(node).some((command) => /\sstop(?:\s|$)/u.test(command))
    ));

    assert.ok(checkAt >= 0, `${relativePath} has no fenced check command`);
    assert.ok(stopAt > checkAt, `${relativePath} stops before its fenced check command`);
    const guidance = nodes.slice(checkAt + 1, stopAt)
      .filter((node) => node.type === 'text')
      .map((node) => node.value)
      .join('\n');
    assert.match(guidance, /全required check[^\n]*`pass`/u, `${relativePath} omits the all-pass gate`);
    assert.match(guidance, /保持/u, `${relativePath} does not retain the process or state on failure`);
    assert.match(
      guidance,
      /`observe`→回答修正→`check`/u,
      `${relativePath} omits the observe-fix-check retry loop`,
    );
    assert.match(
      guidance,
      /`pass`[^\n]*後だけ[^\n]*`stop`/u,
      `${relativePath} does not gate stop on required-check pass`,
    );
  }
});
