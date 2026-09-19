import {test} from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdtemp, writeFile, rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {claudeCommand} from '../../web/src/lib/claude-command.ts';

test('portable launch uses the selected route and pins all model roles without a custom wrapper', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'claude-command-'));
  try {
    await writeFile(path.join(dir, 'claude'), '#!/bin/sh\nprintf "%s\\n" "$ANTHROPIC_BASE_URL" "$ANTHROPIC_AUTH_TOKEN" "$ANTHROPIC_MODEL" "$ANTHROPIC_DEFAULT_HAIKU_MODEL" "$CLAUDE_CODE_SUBAGENT_MODEL" "$@"\n', {mode: 0o700});
    const command = claudeCommand('test-account', 'claude-opus-5', 'high');
    const out = execFileSync('/bin/sh', ['-c', command], {env: {...process.env, PATH: dir, CLIPROXY_API_KEY: 'fake-client-key'}, encoding: 'utf8'});
    assert.deepEqual(out.trim().split('\n'), ['http://127.0.0.1:8320/inference/test-account', 'fake-client-key', 'claude-opus-5[1m]', 'claude-opus-5[1m]', 'claude-opus-5[1m]', '--model', 'claude-opus-5[1m]', '--effort', 'high']);
    assert(!command.includes('fake-client-key'));
    assert.throws(() => execFileSync('/bin/sh', ['-c', command], {env: {PATH: dir}, stdio: 'pipe'}));
    assert.throws(() => claudeCommand("account'; echo bad", 'claude-opus-5', 'high'));
  } finally { await rm(dir, {recursive: true, force: true}); }
});
