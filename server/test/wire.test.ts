import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  addressableModel,
  applyWire,
  assertValidPrefix,
  buildEnv,
  mergeSettings,
  planWire,
  settingsFileFor,
  WireError,
  zshSnippet,
} from '../src/wire.ts';

let tmp: string;

beforeEach(async () => {
  // Inside $HOME because the path guard refuses anything outside it.
  tmp = await fs.mkdtemp(path.join(os.homedir(), '.cliproxy-console-test-'));
});

afterEach(async () => {
  await fs.rm(tmp, { recursive: true, force: true });
});

describe('addressableModel', () => {
  test('returns the bare model when there is no prefix', () => {
    assert.equal(addressableModel('claude-opus-5'), 'claude-opus-5');
    assert.equal(addressableModel('claude-opus-5', ''), 'claude-opus-5');
    assert.equal(addressableModel('claude-opus-5', '   '), 'claude-opus-5');
  });

  test('joins prefix and model, tolerating stray slashes', () => {
    assert.equal(addressableModel('claude-opus-5', 'work'), 'work/claude-opus-5');
    assert.equal(addressableModel('claude-opus-5', '/work/'), 'work/claude-opus-5');
  });

  test('rejects an empty model', () => {
    assert.throws(() => addressableModel('  '), WireError);
  });
});

describe('assertValidPrefix', () => {
  test('accepts a single segment', () => {
    assert.doesNotThrow(() => assertValidPrefix('work'));
    assert.doesNotThrow(() => assertValidPrefix('work-2.alt_x'));
    assert.doesNotThrow(() => assertValidPrefix(''));
  });

  test('rejects a slash — the proxy drops such a prefix on reload', () => {
    // sdk/auth/filestore.go:323-329 refuses any prefix containing "/".
    assert.throws(() => assertValidPrefix('a/b'), /cannot contain/);
  });

  test('rejects other punctuation', () => {
    assert.throws(() => assertValidPrefix('a b'), /letters, digits/);
    assert.throws(() => assertValidPrefix('a:b'), /letters, digits/);
  });
});

describe('settingsFileFor', () => {
  test('project targets <dir>/.claude/settings.json', () => {
    assert.equal(settingsFileFor('project', tmp), path.join(tmp, '.claude', 'settings.json'));
  });

  test('profile-global targets <dir>/settings.json', () => {
    assert.equal(settingsFileFor('profile-global', tmp), path.join(tmp, 'settings.json'));
  });

  test('refuses a directory outside $HOME', () => {
    assert.throws(() => settingsFileFor('project', '/etc'), /must be inside/);
  });
});

describe('buildEnv', () => {
  const base = { target: 'project' as const, path: '~', model: 'claude-opus-5', proxyUrl: 'http://127.0.0.1:8317', apiKey: 'k' };

  test('builds the three Claude Code variables', () => {
    assert.deepEqual(buildEnv(base), {
      ANTHROPIC_BASE_URL: 'http://127.0.0.1:8317',
      ANTHROPIC_AUTH_TOKEN: 'k',
      ANTHROPIC_MODEL: 'claude-opus-5',
    });
  });

  test('prefixes the model when the credential has a prefix', () => {
    assert.equal(buildEnv({ ...base, prefix: 'work' }).ANTHROPIC_MODEL, 'work/claude-opus-5');
  });

  test('strips a trailing slash from the base url', () => {
    assert.equal(buildEnv({ ...base, proxyUrl: 'http://127.0.0.1:8317/' }).ANTHROPIC_BASE_URL, 'http://127.0.0.1:8317');
  });

  test('requires an api key', () => {
    assert.throws(() => buildEnv({ ...base, apiKey: '  ' }), /apiKey is required/);
  });
});

describe('mergeSettings', () => {
  const env = {
    ANTHROPIC_BASE_URL: 'http://127.0.0.1:8317',
    ANTHROPIC_AUTH_TOKEN: 'new-key',
    ANTHROPIC_MODEL: 'work/claude-opus-5',
  };

  test('keeps every unrelated top-level key', () => {
    const { merged } = mergeSettings({ permissions: { allow: ['Bash'] }, model: 'opus' }, env);
    assert.deepEqual(merged['permissions'], { allow: ['Bash'] });
    assert.equal(merged['model'], 'opus');
  });

  test('keeps every unrelated env key', () => {
    const { merged } = mergeSettings({ env: { FOO: '1', ANTHROPIC_BASE_URL: 'http://old' } }, env);
    assert.deepEqual(merged['env'], { FOO: '1', ...env });
  });

  test('reports which env keys it overwrites', () => {
    const { overwrites } = mergeSettings(
      { env: { ANTHROPIC_BASE_URL: 'http://old', ANTHROPIC_AUTH_TOKEN: 'new-key' } },
      env,
    );
    assert.deepEqual(overwrites.sort(), ['ANTHROPIC_BASE_URL']);
  });

  test('treats a non-object env as absent rather than crashing', () => {
    const { merged } = mergeSettings({ env: 'nonsense' }, env);
    assert.deepEqual(merged['env'], env);
  });

  test('does not mutate the input', () => {
    const input = { env: { FOO: '1' } };
    mergeSettings(input, env);
    assert.deepEqual(input, { env: { FOO: '1' } });
  });
});

describe('planWire / applyWire', () => {
  const input = (over: Partial<Parameters<typeof planWire>[0]> = {}) => ({
    target: 'project' as const,
    path: tmp,
    model: 'claude-opus-5',
    prefix: 'work',
    proxyUrl: 'http://127.0.0.1:8317',
    apiKey: 'sk-test',
    ...over,
  });

  test('plan touches nothing on disk', async () => {
    const plan = await planWire(input());
    assert.equal(plan.fileExists, false);
    assert.equal(plan.env.ANTHROPIC_MODEL, 'work/claude-opus-5');
    await assert.rejects(fs.stat(plan.file));
  });

  test('writes a new settings.json and reports no backup', async () => {
    const result = await applyWire(input());
    assert.equal(result.backupFile, null);
    const written = JSON.parse(await fs.readFile(result.file, 'utf8'));
    assert.deepEqual(written, { env: result.env });
    assert.equal(result.displayFile.startsWith('~/'), true);
  });

  test('backs up an existing file before merging into it', async () => {
    const file = path.join(tmp, '.claude', 'settings.json');
    await fs.mkdir(path.dirname(file), { recursive: true });
    const before = { permissions: { allow: ['Bash(ls:*)'] }, env: { FOO: 'keep' } };
    await fs.writeFile(file, JSON.stringify(before, null, 2));

    const result = await applyWire(input(), new Date('2026-01-02T03:04:05.678Z'));
    assert.equal(result.backupFile, `${file}.bak-2026-01-02T03-04-05-678Z`);
    assert.deepEqual(JSON.parse(await fs.readFile(result.backupFile as string, 'utf8')), before);

    const after = JSON.parse(await fs.readFile(file, 'utf8'));
    assert.deepEqual(after['permissions'], before.permissions);
    assert.equal((after['env'] as Record<string, string>)['FOO'], 'keep');
    assert.equal((after['env'] as Record<string, string>)['ANTHROPIC_MODEL'], 'work/claude-opus-5');
  });

  test('a second write backs up the already-wired file again', async () => {
    await applyWire(input(), new Date('2026-01-02T03:04:05.678Z'));
    const second = await applyWire(input({ model: 'claude-sonnet-5' }), new Date('2026-01-02T03:05:00.000Z'));
    assert.equal(second.backupFile, path.join(tmp, '.claude', 'settings.json.bak-2026-01-02T03-05-00-000Z'));
    const backup = JSON.parse(await fs.readFile(second.backupFile as string, 'utf8'));
    assert.equal(backup.env.ANTHROPIC_MODEL, 'work/claude-opus-5');
  });

  test('refuses to touch a settings.json that is not valid JSON', async () => {
    const file = path.join(tmp, 'settings.json');
    await fs.writeFile(file, '{ not json');
    await assert.rejects(applyWire(input({ target: 'profile-global' })), /not valid JSON/);
    assert.equal(await fs.readFile(file, 'utf8'), '{ not json');
  });

  test('refuses a path outside $HOME', async () => {
    await assert.rejects(applyWire(input({ path: '/tmp' })), /must be inside/);
  });
});

describe('zshSnippet', () => {
  test('emits a pasteable function with the prefixed model', () => {
    const snippet = zshSnippet({
      functionName: 'work claude',
      proxyUrl: 'http://127.0.0.1:8317/',
      model: 'claude-opus-5',
      prefix: 'work',
    });
    assert.match(snippet, /^work-claude\(\) \{$/m);
    assert.match(snippet, /ANTHROPIC_MODEL='work\/claude-opus-5'/);
    assert.match(snippet, /ANTHROPIC_BASE_URL='http:\/\/127\.0\.0\.1:8317'/);
    assert.match(snippet, /CLIPROXY_API_KEY:\?Set/);
  });

  test('scopes the proxy vars to the claude call instead of exporting them', () => {
    const snippet = zshSnippet({
      functionName: 'personal',
      proxyUrl: 'http://127.0.0.1:8317',
      model: 'claude-opus-5',
    });
    assert.doesNotMatch(snippet, /\bexport\b/);
    // Each assignment is a line continuation feeding the final `claude "$@"`.
    assert.match(snippet, /ANTHROPIC_BASE_URL='[^']+' \\\n\s+ANTHROPIC_AUTH_TOKEN="[^"]+" \\\n\s+ANTHROPIC_MODEL='[^']+' \\\n\s+claude "\$@"/);
  });
});
