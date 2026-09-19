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
    await writeFile(path.join(dir, 'claude'), '#!/bin/sh\nprintf "%s\\n" "$ANTHROPIC_BASE_URL" "$ANTHROPIC_AUTH_TOKEN" "$ANTHROPIC_MODEL" "$ANTHROPIC_DEFAULT_HAIKU_MODEL" "$CLAUDE_CODE_SUBAGENT_MODEL" "$CLAUDE_CONFIG_DIR" "$CLAUDE_CODE_DISABLE_1M_CONTEXT" "$ANTHROPIC_DEFAULT_FABLE_MODEL" "$@"\n', {mode: 0o700});
    const command = claudeCommand('test-account', 'claude-opus-5', 'high', 'http://localhost:9460', "/tmp/claude's $(literal) profile");
    const out = execFileSync('/bin/sh', ['-c', command], {env: {...process.env, PATH: dir, CLIPROXY_API_KEY: 'fake-client-key'}, encoding: 'utf8'});
    assert.deepEqual(out.trim().split('\n'), ['http://localhost:9460/inference/test-account', 'fake-client-key', 'claude-opus-5[1m]', 'claude-opus-5[1m]', 'claude-opus-5[1m]', "/tmp/claude's $(literal) profile", '0', 'claude-opus-5[1m]', '--model', 'claude-opus-5[1m]' , '--effort', 'high']);
    assert(!command.includes('fake-client-key'));
    assert.throws(() => execFileSync('/bin/sh', ['-c', command], {env: {PATH: dir}, stdio: 'pipe'}));
    assert.throws(() => claudeCommand("account'; echo bad", 'claude-opus-5', 'high', 'http://localhost:9460'));
  } finally { await rm(dir, {recursive: true, force: true}); }
});

test('helper and subagent choices are explicit and independently configurable',()=>{
 const command=claudeCommand('a','claude-opus-5','high','http://localhost:8317',undefined,{backgroundModel:'claude-fable-5-1',subagentModel:'claude-opus-5'});
 assert.match(command,/ANTHROPIC_DEFAULT_HAIKU_MODEL='claude-fable-5-1\[1m\]'/);
 assert.match(command,/CLAUDE_CODE_SUBAGENT_MODEL='claude-opus-5\[1m\]'/);
 assert.throws(()=>claudeCommand('a','claude-opus-5','high','http://localhost:8317',undefined,{backgroundModel:"bad';echo x"}));
});
