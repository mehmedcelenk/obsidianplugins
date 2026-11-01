import * as assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { runManualBackup } from '../git-backup';

function git(cwd: string, ...args: string[]): string {
	return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
}

describe('manual Git backup', () => {
	it('commits and pushes changed vault files, then skips an unchanged vault', async () => {
		const base = mkdtempSync(join(tmpdir(), 'vault backup '));
		const vault = join(base, 'my vault');
		const remote = join(base, 'remote.git');
		try {
			mkdirSync(vault);
			git(base, 'init', '--bare', remote);
			git(vault, 'init', '-b', 'main');
			git(vault, 'config', 'user.email', 'test@example.com');
			git(vault, 'config', 'user.name', 'Test');
			git(vault, 'remote', 'add', 'origin', remote);
			writeFileSync(join(vault, 'note.md'), 'ilk sürüm\n');
			git(vault, 'add', '-A');
			git(vault, 'commit', '-m', 'initial');
			git(vault, 'push', 'origin', 'main');

			writeFileSync(join(vault, 'note.md'), 'değişen sürüm\n');
			assert.equal(await runManualBackup(vault, 'main'), 'backed-up');
			assert.equal(git(vault, 'rev-parse', 'HEAD'), git(remote, 'rev-parse', 'refs/heads/main'));
			assert.equal(await runManualBackup(vault, 'main'), 'unchanged');
		} finally {
			rmSync(base, { recursive: true, force: true });
		}
	});

	it('rejects a parent Git repository and an invalid branch before staging', async () => {
		const base = mkdtempSync(join(tmpdir(), 'vault backup guard '));
		const vault = join(base, 'vault');
		try {
			git(base, 'init', '-b', 'main');
			mkdirSync(vault);
			writeFileSync(join(vault, 'note.md'), 'yerel not\n');
			await assert.rejects(runManualBackup(vault, 'main'), /Kasa kökü/);
			assert.equal(git(base, 'diff', '--cached', '--name-only'), '');

			git(vault, 'init', '-b', 'main');
			await assert.rejects(runManualBackup(vault, 'bad branch'));
			assert.equal(git(vault, 'diff', '--cached', '--name-only'), '');
		} finally {
			rmSync(base, { recursive: true, force: true });
		}
	});

	it('pushes a local commit after an earlier push failure', async () => {
		const base = mkdtempSync(join(tmpdir(), 'vault backup retry '));
		const vault = join(base, 'vault');
		const remote = join(base, 'remote.git');
		try {
			mkdirSync(vault);
			git(base, 'init', '--bare', '-b', 'main', remote);
			git(vault, 'init', '-b', 'main');
			git(vault, 'config', 'user.email', 'test@example.com');
			git(vault, 'config', 'user.name', 'Test');
			git(vault, 'remote', 'add', 'origin', join(base, 'missing.git'));
			writeFileSync(join(vault, 'note.md'), 'yedeklenecek not\n');

			await assert.rejects(runManualBackup(vault, 'main'));
			assert.equal(git(vault, 'status', '--porcelain'), '');
			git(vault, 'remote', 'set-url', 'origin', remote);
			assert.equal(await runManualBackup(vault, 'main'), 'unchanged');
			assert.equal(git(vault, 'rev-parse', 'HEAD'), git(remote, 'rev-parse', 'refs/heads/main'));
		} finally {
			rmSync(base, { recursive: true, force: true });
		}
	});
});
