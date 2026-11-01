import { execFile } from 'child_process';
import { resolve } from 'path';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

async function git(vaultPath: string, ...args: string[]): Promise<string> {
	const { stdout } = await execFileAsync('git', args, {
		cwd: vaultPath,
		timeout: 30000,
		windowsHide: true
	});
	return stdout.trim();
}

export async function runManualBackup(vaultPath: string, branch: string): Promise<'backed-up' | 'unchanged'> {
	const repositoryRoot = await git(vaultPath, 'rev-parse', '--show-toplevel');
	if (resolve(repositoryRoot) !== resolve(vaultPath)) {
		throw new Error('Kasa kökü Git deposunun kökü olmalı.');
	}

	await git(vaultPath, 'check-ref-format', '--branch', branch);
	await git(vaultPath, 'add', '-A');
	const stagedFiles = await git(vaultPath, 'diff', '--cached', '--name-only');
	if (stagedFiles) {
		await git(vaultPath, 'commit', '-m', `Manual backup: ${new Date().toISOString()}`);
	}
	// Push even without new file changes: a previous attempt may have committed but failed to reach GitHub.
	await git(vaultPath, 'push', 'origin', `HEAD:refs/heads/${branch}`);
	return stagedFiles ? 'backed-up' : 'unchanged';
}
