import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { expandHome, resolveUserDir, tildify, PathError, HOME } from '../src/paths.ts';

describe('expandHome', () => {
  test('expands a bare tilde', () => {
    assert.equal(expandHome('~'), os.homedir());
  });
  test('expands ~/', () => {
    assert.equal(expandHome('~/code'), path.join(os.homedir(), 'code'));
  });
  test('leaves an absolute path alone but normalises it', () => {
    assert.equal(expandHome('/usr//local/../local'), '/usr/local');
  });
});

describe('resolveUserDir', () => {
  test('accepts a directory under $HOME', () => {
    assert.equal(resolveUserDir('~/code/project'), path.join(HOME, 'code/project'));
  });

  test('accepts $HOME itself', () => {
    assert.equal(resolveUserDir('~'), HOME);
  });

  test('rejects an empty path', () => {
    assert.throws(() => resolveUserDir('   '), PathError);
  });

  test('rejects paths outside $HOME', () => {
    for (const bad of ['/etc', '/tmp/x', '/', '/usr/local/bin']) {
      assert.throws(() => resolveUserDir(bad), /must be inside/, bad);
    }
  });

  test('rejects traversal that escapes $HOME', () => {
    assert.throws(() => resolveUserDir('~/../../etc'), /must be inside/);
  });

  test('rejects a sibling directory whose name merely starts with $HOME', () => {
    assert.throws(() => resolveUserDir(`${HOME}-evil/x`), /must be inside/);
  });

  test('rejects the proxy auth directory even though it is under $HOME', () => {
    assert.throws(() => resolveUserDir('~/.cli-proxy-api'), /off limits/);
    assert.throws(() => resolveUserDir('~/.cli-proxy-api/sub'), /off limits/);
  });

  test('rejects a null byte', () => {
    const withNull = ['~/code', '/x'].join(String.fromCharCode(0));
    assert.throws(() => resolveUserDir(withNull), /null byte/);
  });
});

describe('tildify', () => {
  test('shortens paths under $HOME', () => {
    assert.equal(tildify(path.join(HOME, 'code/x')), '~/code/x');
    assert.equal(tildify(HOME), '~');
  });
  test('leaves outside paths untouched', () => {
    assert.equal(tildify('/etc/hosts'), '/etc/hosts');
  });
});
