import { App, FileSystemAdapter, Notice, Platform, Plugin, PluginSettingTab, Setting, setIcon } from 'obsidian';
import { runManualBackup } from './git-backup';

interface VaultSyncSettings {
	branch: string;
	lastBackupTimestamp: number;
}

const DEFAULT_SETTINGS: VaultSyncSettings = {
	branch: 'main',
	lastBackupTimestamp: 0
};

export default class VaultSyncPlugin extends Plugin {
	settings: VaultSyncSettings;
	private isBackingUp = false;
	private statusBarItem: HTMLElement | null = null;

	async onload() {
		// Obsidian Sync handles mobile and device-to-device synchronization.
		if (Platform.isMobile) return;

		await this.loadSettings();
		this.statusBarItem = this.addStatusBarItem();
		this.statusBarItem.addClass('vault-sync-status');
		this.setStatus('upload-cloud', 'GitHub\'a manuel yedekle');
		this.registerDomEvent(this.statusBarItem, 'click', () => void this.backup());

		this.addCommand({
			id: 'push-to-github',
			name: 'GitHub\'a Manuel Yedekle',
			callback: () => void this.backup()
		});

		this.addSettingTab(new VaultSyncSettingTab(this.app, this));
	}

	private async loadSettings() {
		const stored = (await this.loadData()) as Record<string, unknown> | null;
		const branch = typeof stored?.branch === 'string' ? stored.branch.trim() : '';
		const lastBackup = stored?.lastBackupTimestamp ?? stored?.lastSyncTimestamp;
		this.settings = {
			branch: branch || DEFAULT_SETTINGS.branch,
			lastBackupTimestamp: typeof lastBackup === 'number' && Number.isFinite(lastBackup) ? lastBackup : 0
		};
		// Persist only the fields still in use. This also removes legacy GitHub tokens.
		if (!stored || Object.keys(stored).some(key => key !== 'branch' && key !== 'lastBackupTimestamp')
			|| stored.branch !== this.settings.branch || stored.lastBackupTimestamp !== this.settings.lastBackupTimestamp) {
			await this.saveSettings();
		}
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}

	private setStatus(icon: string, title: string) {
		if (!this.statusBarItem) return;
		this.statusBarItem.empty();
		setIcon(this.statusBarItem, icon);
		this.statusBarItem.setAttribute('aria-label', title);
		this.statusBarItem.title = title;
	}

	async backup(): Promise<boolean> {
		if (Platform.isMobile || this.isBackingUp) return false;

		const adapter = this.app.vault.adapter;
		if (!(adapter instanceof FileSystemAdapter)) {
			new Notice('Git yedeği için masaüstü dosya kasası gerekli.');
			return false;
		}

		const vaultPath = adapter.getBasePath();
		this.isBackingUp = true;
		this.setStatus('refresh-cw', 'GitHub yedeği hazırlanıyor');

		try {
			const result = await runManualBackup(vaultPath, this.settings.branch);
			if (result === 'unchanged') {
				this.setStatus('check', 'GitHub yedeği güncel');
				new Notice('GitHub yedeği güncel.');
				return true;
			}

			this.settings.lastBackupTimestamp = Date.now();
			await this.saveSettings();
			this.setStatus('check', 'GitHub yedeği tamamlandı');
			new Notice('GitHub yedeği tamamlandı.');
			return true;
		} catch (error) {
			console.error('Vault Sync: Git yedeği başarısız', error);
			this.setStatus('alert-circle', 'GitHub yedeği başarısız');
			new Notice(error instanceof Error && error.message === 'Kasa kökü Git deposunun kökü olmalı.'
				? error.message
				: 'GitHub yedeği başarısız. Ayrıntılar için geliştirici konsoluna bakın.');
			return false;
		} finally {
			this.isBackingUp = false;
		}
	}
}

class VaultSyncSettingTab extends PluginSettingTab {
	constructor(app: App, private plugin: VaultSyncPlugin) {
		super(app, plugin);
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();
		containerEl.createEl('h2', { text: 'Manuel GitHub Yedeği' });
		containerEl.createEl('p', {
			text: 'Notlar cihazlar arasında Obsidian Sync ile eşitlenir. Bu eklenti yalnızca masaüstündeki Git deposunu isteğinizle GitHub\'a yedekler.'
		});

		new Setting(containerEl)
			.setName('Hedef dal')
			.setDesc('GitHub origin deposundaki dal adı')
			.addText(text => text
				.setValue(this.plugin.settings.branch)
				.onChange(async value => {
					this.plugin.settings.branch = value.trim() || DEFAULT_SETTINGS.branch;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('Şimdi yedekle')
			.setDesc(this.plugin.settings.lastBackupTimestamp
				? `Son yedek: ${new Date(this.plugin.settings.lastBackupTimestamp).toLocaleString()}`
				: 'Henüz yedek yapılmadı')
			.addButton(button => button
				.setButtonText('GitHub\'a yedekle')
				.setCta()
				.onClick(() => void this.plugin.backup()));
	}
}
