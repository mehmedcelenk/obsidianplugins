import { EditorView } from '@codemirror/view';
import {
	Notice,
	Plugin,
	TFile,
	normalizePath
} from 'obsidian';
import { ensureAggregatorBlock, getAggregatorNotePath, isAggregatorNotePath } from './src/aggregator-note';
import { moveAtomicBlock } from './src/block-mover';
import { ensureUrgentTagForShortDeadline } from './src/dates';
import {
	createDashGhostHintPlugin,
	createDashKeymapPlugin,
	createRepeatingTaskTransactionFilter,
	createTagEmojiViewPlugin,
	createTaskInteractionPlugin,
	createTaskLockDecorationsPlugin,
	createTaskNumberingPlugin,
	sortContiguousTodoBlockByPriority
} from './src/live-preview';
import { processReadingView } from './src/reading-view';
import { MyTasksSettingTab } from './src/settings-tab';
import { HashTagSuggester } from './src/suggesters';
import { renderTaskBoard } from './src/task-board';
import {
	TaskTimerState,
	formatTimerSeconds,
	getActiveRunningTimers,
	loadTimersFromStorage,
	registerTimerChangeCallback,
	registerTimerCompleteCallback,
	stopAllTaskTimers,
	toggleTaskTimer,
	unregisterTimerChangeCallback,
	unregisterTimerCompleteCallback
} from './src/timer-manager';
import {
	DAY_DISPLAY_NAMES,
	DEFAULT_SETTINGS,
	MyTasksSettings
} from './src/types';

export default class MyTasksPlugin extends Plugin {
	settings: MyTasksSettings;
	rolloverTimer: number | null = null;
	timerStatusBarEl: HTMLElement | null = null;
	onTimerChangeBound: (() => void) | null = null;
	onTimerCompleteBound: ((state: TaskTimerState) => void) | null = null;

	async onload() {
		await this.loadSettings();

		// Bottom Status Bar (kontrol paneli / alt çubuk) for active running/paused timers
		loadTimersFromStorage();
		this.timerStatusBarEl = this.addStatusBarItem();
		this.timerStatusBarEl.addClass('mytasks-statusbar-timers');
		this.updateTimerStatusBar();

		this.onTimerChangeBound = () => this.updateTimerStatusBar();
		registerTimerChangeCallback(this.onTimerChangeBound);

		this.onTimerCompleteBound = (state: TaskTimerState) => {
			const rawName = state.key.split('::')[0] || 'Görev';
			const shortName = rawName.length > 28 ? rawName.slice(0, 28) + '…' : rawName;
			new Notice(`⏱️ ${shortName}: kafi (${state.minutes} dk)`, 4000);
		};
		registerTimerCompleteCallback(this.onTimerCompleteBound);

		// Automatically stop all timers when Obsidian window is closed
		this.registerDomEvent(window, 'beforeunload', () => {
			stopAllTaskTimers();
		});

		// Ribbon icon to open Task Board
		this.addRibbonIcon('check-square', 'CleverLines Görev Panosu', () => {
			this.openAggregatorNote();
		});

		// Command to open Task Board
		this.addCommand({
			id: 'open-task-board',
			name: 'Görev Panosunu Aç',
			callback: () => this.openAggregatorNote()
		});

		// Command to move current atomic block up
		this.addCommand({
			id: 'move-block-up',
			name: 'Maddeyi / Bloğu Yukarı Taşı (Alt+Yukarı)',
			hotkeys: [{ modifiers: ['Alt'], key: 'ArrowUp' }],
			editorCallback: (editor) => {
				const cmView = (editor as any)?.cm as EditorView | undefined;
				if (cmView) {
					moveAtomicBlock(cmView, 'up');
				}
			}
		});

		// Command to move current atomic block down
		this.addCommand({
			id: 'move-block-down',
			name: 'Maddeyi / Bloğu Aşağı Taşı (Alt+Aşağı)',
			hotkeys: [{ modifiers: ['Alt'], key: 'ArrowDown' }],
			editorCallback: (editor) => {
				const cmView = (editor as any)?.cm as EditorView | undefined;
				if (cmView) {
					moveAtomicBlock(cmView, 'down');
				}
			}
		});

		// Command to manually trigger day rollover
		this.addCommand({
			id: 'trigger-day-rollover',
			name: 'Gün Devrini Manuel Çalıştır (#bugün -> #dün, tekrar görevlerinin tikini kaldır)',
			callback: async () => {
				await this.checkDailyRollover(true);
			}
		});

		// Command to sort current section/block by priority (#acil at top, #2dk at bottom)
		this.addCommand({
			id: 'sort-block-priority',
			name: 'Mevcut Bloğu / Başlığı Önceliğe Göre Sırala (#acil en üstte, #2dk en altta)',
			editorCallback: (editor) => {
				const cmView = (editor as any)?.cm as EditorView | undefined;
				if (cmView) {
					const cursor = editor.getCursor();
					const changed = sortContiguousTodoBlockByPriority(cmView, cursor.line + 1);
					if (changed) {
						new Notice('✅ Blok önceliğe göre sıralandı (#acil en üstte, #2dk en altta)');
					} else {
						new Notice('ℹ️ Blok zaten önceliğe göre sıralı.');
					}
				}
			}
		});

		// Register Suggester: '#' for tags & deadline presets with usage frequency
		const hashSuggester = new HashTagSuggester(this, () => this.settings);
		this.registerEditorSuggest(hashSuggester);

		const prioritizeSuggesters = () => {
			try {
				const ws = this.app.workspace as any;
				const editorSuggest = ws?.editorSuggest;
				if (editorSuggest && Array.isArray(editorSuggest.suggests)) {
					// 1. Move hashSuggester to the very front so '#' triggers our suggester
					const hashIdx = editorSuggest.suggests.indexOf(hashSuggester);
					if (hashIdx > 0) {
						editorSuggest.suggests.splice(hashIdx, 1);
						editorSuggest.suggests.unshift(hashSuggester);
					}

					// 2. Intercept Obsidian's built-in TagSuggest so it yields to HashTagSuggester
					for (const s of editorSuggest.suggests) {
						if (s !== hashSuggester) {
							const name = s.constructor?.name || '';
							if (name === 'TagSuggest' || name.toLowerCase().includes('tag')) {
								if (!s._mytasksWrapped) {
									s._mytasksWrapped = true;
									const origTrigger = s.onTrigger.bind(s);
									s.onTrigger = (cursor: any, editor: any, file: any) => {
										if (hashSuggester.onTrigger(cursor, editor, file)) {
											return null;
										}
										return origTrigger(cursor, editor, file);
									};
								}
							}
						}
					}
				}
			} catch (e) {
				console.error('MyTasks: Error prioritizing suggesters', e);
			}
		};

		prioritizeSuggesters();
		this.app.workspace.onLayoutReady(() => {
			prioritizeSuggesters();
			this.ensureAggregatorNoteContent();
		});
		this.registerEvent(
			this.app.workspace.on('active-leaf-change', () => {
				prioritizeSuggesters();
			})
		);

		// Register CodeMirror 6 Plugins for Live Preview
		this.registerEditorExtension([
			createTagEmojiViewPlugin(this, () => this.settings),
			createTaskInteractionPlugin(() => this.settings),
			createRepeatingTaskTransactionFilter(),
			createDashGhostHintPlugin(),
			createDashKeymapPlugin(),
			createTaskNumberingPlugin(),
			createTaskLockDecorationsPlugin(() => this.settings)
		]);

		// Code block processor for `dash-tasks` (works in BOTH Live Preview and Reading View!)
		this.registerMarkdownCodeBlockProcessor('dash-tasks', (source, el, ctx) => {
			renderTaskBoard(this, el, ctx.sourcePath, (path) => this.isAggregatorFile(path));
		});

		// Markdown Post Processor for Reading View
		this.registerMarkdownPostProcessor((el, ctx) => {
			processReadingView(this, el, () => this.settings);
		});

		// When any file is opened:
		// 1) Ensure aggregator note has dash-tasks block
		// 2) Auto-tag uncompleted tasks with <= 3 day deadlines as #acil
		this.registerEvent(
			this.app.workspace.on('file-open', (file) => {
				if (file instanceof TFile && file.extension === 'md') {
					if (this.isAggregatorFile(file.path)) {
						this.ensureAggregatorNoteContent(file);
					} else {
						this.ensureFileShortDeadlinesUrgent(file);
					}
				}
			})
		);

		// Command to manually audit and tag urgent deadlines (≤ 3 gün)
		this.addCommand({
			id: 'auto-tag-urgent-deadlines',
			name: 'Yaklaşan Bitiş Tarihlerine #acil Etiketi Ekle (≤ 3 gün)',
			callback: async () => {
				const activeFile = this.app.workspace.getActiveFile();
				if (activeFile) {
					await this.ensureFileShortDeadlinesUrgent(activeFile);
					new Notice('Yaklaşan bitiş tarihleri kontrol edildi (≤ 3 gün).');
				}
			}
		});

		// Daily rollover on startup
		this.app.workspace.onLayoutReady(() => {
			setTimeout(() => {
				this.checkDailyRollover();
			}, 1500);
		});

		// Periodically check for day rollover (every 20 minutes)
		this.rolloverTimer = window.setInterval(() => {
			this.checkDailyRollover();
		}, 20 * 60 * 1000);
		this.registerInterval(this.rolloverTimer);

		// Settings Tab
		this.addSettingTab(new MyTasksSettingTab(this.app, this));
	}

	onunload() {
		if (this.rolloverTimer) {
			window.clearInterval(this.rolloverTimer);
			this.rolloverTimer = null;
		}
		if (this.onTimerChangeBound) {
			unregisterTimerChangeCallback(this.onTimerChangeBound);
			this.onTimerChangeBound = null;
		}
		if (this.onTimerCompleteBound) {
			unregisterTimerCompleteCallback(this.onTimerCompleteBound);
			this.onTimerCompleteBound = null;
		}
		stopAllTaskTimers();
	}

	updateTimerStatusBar() {
		if (!this.timerStatusBarEl) return;
		const active = getActiveRunningTimers();
		this.timerStatusBarEl.empty();

		if (active.length === 0) {
			this.timerStatusBarEl.style.display = 'none';
			return;
		}

		this.timerStatusBarEl.style.display = 'inline-flex';
		for (const t of active) {
			const chip = this.timerStatusBarEl.createEl('button', {
				cls: `mytasks-statusbar-timer-chip status-${t.status}`,
				attr: { type: 'button' }
			});
			const icon = t.status === 'running' ? '⏱️' : '⏸️';
			const timeStr = formatTimerSeconds(t.remainingSeconds);
			const rawName = t.key.split('::')[0] || '';
			chip.setText(`${icon} ${timeStr}`);
			chip.setAttribute('aria-label', `${rawName ? rawName + ' • ' : ''}${timeStr} • Tıkla: Duraklat / Devam Et`);
			chip.setAttribute('aria-pressed', String(t.status === 'running'));
			chip.setAttribute('data-tooltip-position', 'top');
			chip.addEventListener('click', (e) => {
				e.stopPropagation();
				toggleTaskTimer(t.key, t.minutes);
			});
		}
	}

	async loadSettings() {
		const loadedData = await this.loadData();
		this.settings = Object.assign({}, DEFAULT_SETTINGS, loadedData);

		if (this.settings.tags && Array.isArray(this.settings.tags)) {
			// Migrate #rutin -> #tekrar
			for (const tagItem of this.settings.tags) {
				const lower = tagItem.tag.toLowerCase();
				if (lower === '#rutin') {
					tagItem.tag = '#tekrar';
					tagItem.emoji = '🔄';
					tagItem.label = 'Günlük Tekrar (Sayaç Korunur)';
				} else if (lower === '#bugün' || lower === '#bugun') {
					tagItem.emoji = '☀️';
				} else if (lower === '#perşembe' || lower === '#persembe') {
					tagItem.emoji = '🔒';
				} else if (lower === '#acil' || lower === '#2dk' || lower === '#kilitli') {
					tagItem.emoji = '';
				}
			}

			// Deduplicate in case both #rutin and #tekrar existed
			const seen = new Set<string>();
			this.settings.tags = this.settings.tags.filter(t => {
				const k = t.tag.toLowerCase();
				if (seen.has(k)) return false;
				seen.add(k);
				return true;
			});

			// Ensure all default tags exist
			for (const defTag of DEFAULT_SETTINGS.tags) {
				const existing = this.settings.tags.find(t => t.tag.toLowerCase() === defTag.tag.toLowerCase());
				if (!existing) {
					this.settings.tags.push({ ...defTag });
				} else {
					if (!existing.label) existing.label = defTag.label;
					if (existing.tag.toLowerCase() !== '#kilitsiz' && !existing.emoji) existing.emoji = defTag.emoji;
				}
			}
		} else {
			this.settings.tags = [...DEFAULT_SETTINGS.tags];
		}

		const emojiFreeTags = new Set(['#acil', '#2dk', '#kilitli', '#kilitsiz']);
		for (const tagItem of this.settings.tags || []) {
			if (emojiFreeTags.has(tagItem.tag.toLowerCase())) tagItem.emoji = '';
		}

		if (!this.settings.tagUsageCounts) {
			this.settings.tagUsageCounts = Object.assign({}, DEFAULT_SETTINGS.tagUsageCounts);
		}

		await this.saveSettings();
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}

	async recordTagUsage(tag: string) {
		const cleanTag = tag.split('/')[0].split(':')[0].toLowerCase();
		if (!this.settings.tagUsageCounts) {
			this.settings.tagUsageCounts = Object.assign({}, DEFAULT_SETTINGS.tagUsageCounts);
		}
		this.settings.tagUsageCounts[cleanTag] = (this.settings.tagUsageCounts[cleanTag] || 0) + 1;
		await this.saveSettings();
	}

	isAggregatorFile(filePath: string): boolean {
		if (!filePath) return false;
		const targetPath = normalizePath(getAggregatorNotePath(this.settings.aggregatorNote || ''));
		return isAggregatorNotePath(filePath, targetPath);
	}

	async ensureAggregatorNoteContent(targetFile?: TFile) {
		try {
			const targetPath = normalizePath(getAggregatorNotePath(this.settings.aggregatorNote || ''));
			const file = targetFile?.path === targetPath ? targetFile : this.app.vault.getAbstractFileByPath(targetPath);
			if (file instanceof TFile) {
				await this.app.vault.process(file, ensureAggregatorBlock);
			}
		} catch (e) {
			console.error('MyTasks: Error ensuring aggregator note content', e);
		}
	}

	async ensureFileShortDeadlinesUrgent(file: TFile) {
		try {
			await this.app.vault.process(file, (content) => {
				if (!content.includes('#deadline')) return content;
				const lines = content.split('\n');
				let changed = false;
				for (let i = 0; i < lines.length; i++) {
					const line = lines[i];
					if (/^\s*(?:[-*+•]|\d+[.)])\s*\[ ]/.test(line) && line.includes('#deadline')) {
						const updated = ensureUrgentTagForShortDeadline(line);
						if (updated !== line) {
							lines[i] = updated;
							changed = true;
						}
					}
				}
				return changed ? lines.join('\n') : content;
			});
		} catch (e) {
			console.error('CleverLines: Error ensuring short deadlines urgent in file', e);
		}
	}

	async openAggregatorNote() {
		const targetPath = normalizePath(getAggregatorNotePath(this.settings.aggregatorNote || ''));
		let file = this.app.vault.getAbstractFileByPath(targetPath);

		if (!file) {
			try {
				file = await this.app.vault.create(targetPath, ensureAggregatorBlock(''));
			} catch (e) {
				console.error('MyTasks: Error creating aggregator note', e);
			}
		} else if (file instanceof TFile) {
			await this.ensureAggregatorNoteContent(file);
		}

		if (file instanceof TFile) {
			const leaf = this.app.workspace.getLeaf(false);
			await leaf.openFile(file);
		}
	}

	/* ---------------------------------------------------- */
	/*      #bugün -> #dün / #yarın -> #bugün / #tekrar     */
	/* ---------------------------------------------------- */
	async checkDailyRollover(manual: boolean = false): Promise<number> {
		if (!this.settings.autoRollover && !manual) return 0;

		const now = new Date();
		const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
		const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
		const todayDayIndex = now.getDay();
		const todayDayName = DAY_DISPLAY_NAMES[todayDayIndex].toLowerCase();

		if (!manual && this.settings.lastRolloverDate === todayStr) {
			return 0;
		}

		let rolledCount = 0;
		const files = this.app.vault.getMarkdownFiles();

		const todayDayVariants = [todayDayName];
		if (todayDayName === 'salı') todayDayVariants.push('sali');
		if (todayDayName === 'çarşamba') todayDayVariants.push('carsamba');
		if (todayDayName === 'perşembe') todayDayVariants.push('persembe');

		for (const file of files) {
			if (file.path.startsWith('.obsidian/')) continue;
			if (this.isAggregatorFile(file.path)) continue;

			if (file.stat.mtime < startOfToday || manual) {
				const isOlderThanToday = file.stat.mtime < startOfToday;
				await this.app.vault.process(file, (content) => {
					let updated = content;

					// 1. #bugün -> #dün
					updated = updated.replace(/^(\s*(?:[-*+•]|\d+[.)])\s*\[ ])(.*?)(#(?:bugün|bugun)\b)(.*)$/gim, '$1$2#dün$4');

					// 2. #yarın -> #bugün
					updated = updated.replace(/^(\s*(?:[-*+•]|\d+[.)])\s*\[ ])(.*?)(#(?:yarın|yarin)\b)(.*)$/gim, '$1$2#bugün$4');

					// 3. Today's Day tag -> #bugün (only for tasks written before today)
					if (isOlderThanToday) {
						for (const dayVariant of todayDayVariants) {
							const dayRegex = new RegExp(`^(\\s*(?:[-*+•]|\\d+[.)])\\s*\\[ ])(.*?)(#${dayVariant}\\b)(.*)$`, 'gim');
							updated = updated.replace(dayRegex, '$1$2#bugün$4');
						}
					}

					// 4. #tekrar / #rutin: Reset completed repeating tasks back to unchecked (- [ ])
					updated = updated.replace(/^(\s*(?:[-*+•]|\d+[.)])\s*)\[[xX]](.*?)(#(?:tekrar|rutin)\b)(.*)$/gim, '$1[ ]$2$3$4');

					// 5. #deadline/<date> with <= 3 days left: Automatically append #acil to uncompleted tasks
					if (updated.includes('#deadline')) {
						updated = updated
							.split('\n')
							.map(line => (/^\s*(?:[-*+•]|\d+[.)])\s*\[ ]/.test(line) ? ensureUrgentTagForShortDeadline(line) : line))
							.join('\n');
					}

					if (updated !== content) {
						rolledCount++;
					}
					return updated;
				});
			}
		}

		this.settings.lastRolloverDate = todayStr;
		await this.saveSettings();

		if (rolledCount > 0) {
			new Notice(`🔄 📅 Güncellendi (${rolledCount})`);
		} else if (manual) {
			new Notice('✅ ✨ Güncel');
		}

		return rolledCount;
	}
}
