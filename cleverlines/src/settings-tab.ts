import { App, Notice, Plugin, PluginSettingTab, Setting } from 'obsidian';
import { DEFAULT_SETTINGS, MyTasksSettings } from './types';

export class MyTasksSettingTab extends PluginSettingTab {
	plugin: Plugin & {
		settings: MyTasksSettings;
		saveSettings: () => Promise<void>;
		openAggregatorNote: () => Promise<void>;
		checkDailyRollover: (manual?: boolean) => Promise<number>;
	};

	constructor(app: App, plugin: any) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		containerEl.createEl('h2', { text: 'CleverLines' });

		// 1. Görev Panosu Notu
		new Setting(containerEl)
			.setName('Görev Panosu Notu')
			.setDesc('Tüm kasanızdaki görevlerin toplandığı not.')
			.addText(text => {
				text.setPlaceholder('TÜM GÖREVLER')
					.setValue(this.plugin.settings.aggregatorNote)
					.onChange(async val => {
						this.plugin.settings.aggregatorNote = val.trim() || 'TÜM GÖREVLER';
						await this.plugin.saveSettings();
					});
			})
			.addButton(btn => {
				btn.setButtonText('Panoyu Aç')
					.onClick(() => {
						this.plugin.openAggregatorNote();
					});
			});

		// 2. Otomatik Gün Devri
		new Setting(containerEl)
			.setName('Otomatik Gün Devri')
			.setDesc('Gün değişince etiketleri ilerletir; tekrar görevlerinin tikini kaldırır ve tekrar sayısını korur.')
			.addToggle(toggle => {
				toggle.setValue(this.plugin.settings.autoRollover)
					.onChange(async val => {
						this.plugin.settings.autoRollover = val;
						await this.plugin.saveSettings();
					});
			})
			.addButton(btn => {
				btn.setButtonText('Şimdi Devret')
					.onClick(async () => {
						await this.plugin.checkDailyRollover(true);
					});
			});

		// 3. İleri Tarihlileri Kilitle
		new Setting(containerEl)
			.setName('Gelecek Görevleri Kilitle')
			.setDesc('Tarihi gelmemiş (#yarın, gelecek günler) görevlerin yanlışlıkla işaretlenmesini önler.')
			.addToggle(toggle => {
				toggle.setValue(this.plugin.settings.lockFutureTasks)
					.onChange(async val => {
						this.plugin.settings.lockFutureTasks = val;
						await this.plugin.saveSettings();
						this.app.workspace.updateOptions();
					});
			});

		// 4. Etiket menüsü
		containerEl.createEl('h3', { text: 'Etiket menüsü' });

		new Setting(containerEl)
			.setName('Görünüm')
			.setDesc('# yazıldığında etiketlerin nasıl listeleneceğini seçin.')
			.addDropdown(drop => {
				drop.addOption('nested', 'Kategorili')
					.addOption('flat', 'Düz liste')
					.setValue(this.plugin.settings.dropdownCategoryMode || 'nested')
					.onChange(async val => {
						this.plugin.settings.dropdownCategoryMode = val as any;
						await this.plugin.saveSettings();
					});
			});

		new Setting(containerEl)
			.setName('Günler kategorisi')
			.setDesc('Gün etiketlerini ayrı bir alt menüde gösterir.')
			.addToggle(toggle => {
				toggle.setValue(this.plugin.settings.showDaysDropdown !== false)
					.onChange(async val => {
						this.plugin.settings.showDaysDropdown = val;
						await this.plugin.saveSettings();
					});
			});

		new Setting(containerEl)
			.setName('Tür kategorisi')
			.setDesc('Süreç, tekrar ve benzeri etiketleri ayrı bir alt menüde gösterir.')
			.addToggle(toggle => {
				toggle.setValue(this.plugin.settings.showTurDropdown !== false)
					.onChange(async val => {
						this.plugin.settings.showTurDropdown = val;
						await this.plugin.saveSettings();
					});
			});

		// 5. Özel Etiketler (Katlanabilir - Göz yormayan sade tasarım)
		const details = containerEl.createEl('details', { cls: 'mytasks-settings-tags-details' });
		const count = this.plugin.settings.tags?.length || 0;
		details.createEl('summary', {
			cls: 'mytasks-settings-tags-summary',
			text: `Etiketleri yönet (${count})`
		});

		const detailsBody = details.createDiv({ cls: 'mytasks-settings-tags-body' });

		// Yeni Etiket Ekle
		let newTag = '';
		let newEmoji = '';
		let newLabel = '';
		let newCategory: 'root' | 'days' | 'tur' = 'root';

		new Setting(detailsBody)
			.setName('Yeni Etiket Ekle')
			.setDesc('#etiket, emoji, açıklama ve kategori')
			.addText(text => {
				text.setPlaceholder('#etiket')
					.onChange(val => { newTag = val.trim(); });
			})
			.addText(text => {
				text.setPlaceholder('Emoji (🎯)')
					.onChange(val => { newEmoji = val.trim(); });
			})
			.addText(text => {
				text.setPlaceholder('Açıklama')
					.onChange(val => { newLabel = val.trim(); });
			})
			.addDropdown(drop => {
				drop.addOption('root', 'Kök (#)')
					.addOption('tur', 'Tür')
					.addOption('days', 'Günler')
					.setValue('root')
					.onChange(val => { newCategory = val as any; });
			})
			.addButton(btn => {
				btn.setButtonText('Ekle')
					.setCta()
					.onClick(async () => {
						if (!newTag) return;
						if (!newTag.startsWith('#')) newTag = '#' + newTag;
						newTag = newTag.replace(/\s+/g, '-');
						if (newTag === '#') {
							new Notice('Geçerli bir etiket yazın.');
							return;
						}
						if (this.plugin.settings.tags.some(item => item.tag.toLowerCase() === newTag.toLowerCase())) {
							new Notice('Bu etiket zaten var.');
							return;
						}
						this.plugin.settings.tags.push({
							tag: newTag,
							emoji: newEmoji || '🏷️',
							label: newLabel || newTag,
							category: newCategory
						});
						if (!this.plugin.settings.tagCategories) {
							this.plugin.settings.tagCategories = {};
						}
						this.plugin.settings.tagCategories[newTag.toLowerCase()] = newCategory;
						await this.plugin.saveSettings();
						this.display();
					});
			});

		// Etiket Listesi (Kompakt ve kaydırılabilir)
		const tagListContainer = detailsBody.createDiv({ cls: 'dash-drop-settings-emoji-list' });

		this.plugin.settings.tags.forEach((item, index) => {
			const tagLower = item.tag.toLowerCase();
			const currentCat = this.plugin.settings.tagCategories?.[tagLower] || item.category || 'root';

			const row = new Setting(tagListContainer)
				.setClass('dash-drop-emoji-setting-row')
				.setName(item.emoji ? `${item.emoji}  ${item.tag}` : item.tag)
				.setDesc(item.label || '');

			row.addDropdown(drop => {
				drop.addOption('root', 'Kök')
					.addOption('tur', 'Tür')
					.addOption('days', 'Günler')
					.setValue(currentCat)
					.onChange(async val => {
						if (!this.plugin.settings.tagCategories) {
							this.plugin.settings.tagCategories = {};
						}
						const cat = val as 'root' | 'days' | 'tur';
						this.plugin.settings.tagCategories[tagLower] = cat;
						item.category = cat;
						await this.plugin.saveSettings();
					});
			});

			row.addExtraButton(btn => {
				btn.setIcon('trash')
					.setTooltip('Sil')
					.onClick(async () => {
						this.plugin.settings.tags.splice(index, 1);
						if (this.plugin.settings.tagCategories) {
							delete this.plugin.settings.tagCategories[tagLower];
						}
						await this.plugin.saveSettings();
						this.display();
					});
			});
		});

		// Varsayılana Sıfırla
		new Setting(detailsBody)
			.setName('Etiketleri Varsayılana Sıfırla')
			.addButton(btn => {
				btn.setButtonText('Sıfırla')
					.setWarning()
					.onClick(async () => {
						this.plugin.settings.tags = [...DEFAULT_SETTINGS.tags];
						await this.plugin.saveSettings();
						this.display();
					});
			});
	}
}
