import { EditorView } from '@codemirror/view';
import {
	Editor,
	EditorPosition,
	EditorSuggest,
	EditorSuggestContext,
	EditorSuggestTriggerInfo,
	Plugin,
	TFile
} from 'obsidian';
import { getDeadlineDaySuggestions, getDeadlineRootSuggestions, QuestionPromptModal } from './calendar-modal';
import { sortContiguousTodoBlockByPriority } from './live-preview';
import {
	DAY_TAGS_SET,
	MyTasksSettings,
	TUR_TAGS_SET,
	TagItem,
	URGENT_TRIANGLE_SVG
} from './types';

export type SuggesterSubmenu = null | 'days' | 'tur' | 'deadline' | 'deadline-days';

/**
 * Suggester that triggers when user types "#" to pick quick tags, inner "Günler" dropdown, & deadlines
 */
export class HashTagSuggester extends EditorSuggest<TagItem> {
	plugin: any;
	getSettings: () => MyTasksSettings;
	submenu: SuggesterSubmenu = null;
	lastQuery: string = '';
	lastTriggerKey: string = '';

	constructor(plugin: Plugin, getSettings: () => MyTasksSettings) {
		super(plugin.app);
		this.plugin = plugin;
		this.getSettings = getSettings;
	}

	open(): void {
		super.open();
		const suggestEl = (this as any).suggestEl as HTMLElement | undefined;
		if (suggestEl) {
			suggestEl.addClass('dash-drop-suggest-container');
		}
	}

	close(): void {
		this.submenu = null;
		this.lastQuery = '';
		this.lastTriggerKey = '';
		const suggestEl = (this as any).suggestEl as HTMLElement | undefined;
		if (suggestEl && suggestEl.parentElement && suggestEl.innerHTML.trim().length > 0 && suggestEl.style.display !== 'none') {
			try {
				const clone = suggestEl.cloneNode(true) as HTMLElement;
				clone.removeAttribute('id');
				clone.addClass('dash-drop-closing');
				suggestEl.parentElement.appendChild(clone);
				setTimeout(() => {
					clone.remove();
				}, 100);
			} catch (e) {
				// Ignore
			}
		}
		super.close();
	}

	private refreshSuggestionsInPlace() {
		const suggestionsObj = (this as any).suggestions;
		if (suggestionsObj && typeof suggestionsObj.setSuggestions === 'function' && this.context) {
			const updated = this.getSuggestions(this.context);
			suggestionsObj.setSuggestions(updated);
		}
	}

	onTrigger(cursor: EditorPosition, editor: Editor, file: TFile | null): EditorSuggestTriggerInfo | null {
		const line = editor.getLine(cursor.line);
		const beforeCursor = line.slice(0, cursor.ch);

		const match = beforeCursor.match(/(^|[\s(\[{])#([^\s#]*)$/);
		if (match) {
			const query = match[2];
			// Pure numbers like #1, #2, #3 are for single-task numbering (unless typing 'dk' like #2dk or #120dk)
			if (/^[0-9]+$/.test(query)) {
				return null;
			}
			const startCh = cursor.ch - query.length - 1;
			const triggerKey = `${cursor.line}:${startCh}`;
			if (triggerKey !== this.lastTriggerKey) {
				this.submenu = null;
				this.lastTriggerKey = triggerKey;
			}
			return {
				start: { line: cursor.line, ch: startCh },
				end: cursor,
				query: query.toLowerCase()
			};
		}
		return null;
	}

	private getTagCategory(tag: string, defaultCategory?: 'root' | 'days' | 'tur'): 'root' | 'days' | 'tur' {
		const low = tag.toLowerCase();
		const configured = this.getSettings().tagCategories?.[low];
		if (configured) return configured;
		if (defaultCategory) return defaultCategory;
		if (DAY_TAGS_SET.has(low)) return 'days';
		if (TUR_TAGS_SET.has(low)) return 'tur';
		return 'root';
	}

	private getDayTagItems(): TagItem[] {
		const defaultDays: TagItem[] = [
			{ tag: '#bugün', displayTitle: 'Bugün', emoji: '☀️', label: '#bugün • Bugün Yapılacak' },
			{ tag: '#yarın', displayTitle: 'Yarın', emoji: '🔒', label: '#yarın • Yarın Yapılacak' },
			{ tag: '#dün', displayTitle: 'Dün', emoji: '⏳', label: '#dün • Dünden Kalan' },
			{ tag: '#pazartesi', displayTitle: 'Pazartesi', emoji: '🔒', label: '#pazartesi' },
			{ tag: '#salı', displayTitle: 'Salı', emoji: '🔒', label: '#salı' },
			{ tag: '#çarşamba', displayTitle: 'Çarşamba', emoji: '🔒', label: '#çarşamba' },
			{ tag: '#perşembe', displayTitle: 'Perşembe', emoji: '🔒', label: '#perşembe' },
			{ tag: '#cuma', displayTitle: 'Cuma', emoji: '🔒', label: '#cuma' },
			{ tag: '#cumartesi', displayTitle: 'Cumartesi', emoji: '🔒', label: '#cumartesi' },
			{ tag: '#pazar', displayTitle: 'Pazar', emoji: '🔒', label: '#pazar' }
		];

		// Include custom tags configured to belong to 'days'
		const customDays = (this.getSettings().tags || []).filter(item => {
			const cat = this.getTagCategory(item.tag, item.category);
			return cat === 'days' && !defaultDays.some(d => d.tag.toLowerCase() === item.tag.toLowerCase());
		});

		return [...defaultDays, ...customDays];
	}

	private getTurTagItems(): TagItem[] {
		const defaultTur: TagItem[] = [
			{ tag: '#süreç', displayTitle: '#süreç', emoji: '👁️', label: '#süreç • Süreç & Takip' },
			{ tag: '#tekrar', displayTitle: '#tekrar', emoji: '🔄', label: '#tekrar • Günlük Tekrar (Sayaç Korunur)' },
			{ tag: '#yakında', displayTitle: '#yakında', emoji: '🔜', label: '#yakında • Yakında Yapılacak' },
			{ tag: '#dışarda', displayTitle: '#dışarda', emoji: '🚗', label: '#dışarda • Dışarıda Yapılacak' },
			{ tag: '#evde', displayTitle: '#evde', emoji: '🏠', label: '#evde • Evde Yapılacak' },
			{ tag: '#sonra', displayTitle: '#sonra', emoji: '⏳', label: '#sonra • Sonraya Bırak' },
			{ tag: '#kilitli', displayTitle: '#kilitli', emoji: '', label: '#kilitli • Alt Görevler Bitene Kadar Kilitli' },
			{
				tag: '#kilitsiz',
				displayTitle: 'Kilidi Kaldır',
				emoji: '',
				label: 'Kilidi Kaldır • Sadece bu satırın kilidini kaldırır',
				isAction: true,
				action: (editor: Editor, start: EditorPosition, end: EditorPosition) => {
					const curLine = editor.getLine(start.line);
					if (/#kilitli\b/i.test(curLine)) {
						editor.replaceRange('', start, end);
						const afterQuery = editor.getLine(start.line);
						const cleaned = afterQuery.replace(/\s*#kilitli\b/gi, '');
						editor.setLine(start.line, cleaned);
					} else {
						editor.replaceRange('#kilitsiz ', start, end);
						editor.setCursor({ line: start.line, ch: start.ch + '#kilitsiz '.length });
					}
					editor.focus();
				}
			}
		];

		// Include custom tags configured to belong to 'tur'
		const customTur = (this.getSettings().tags || []).filter(item => {
			const cat = this.getTagCategory(item.tag, item.category);
			return cat === 'tur' && !defaultTur.some(d => d.tag.toLowerCase() === item.tag.toLowerCase());
		});

		return [...defaultTur, ...customTur];
	}

	private createBackItem(targetSubmenu: SuggesterSubmenu): TagItem {
		return {
			tag: '#geri',
			displayTitle: 'Geri',
			emoji: '⬅️',
			label: 'Önceki menüye dön',
			isAction: true,
			keepOpen: true,
			isBackButton: true,
			action: () => {
				this.submenu = targetSubmenu;
				this.refreshSuggestionsInPlace();
			}
		};
	}

	getSuggestions(context: EditorSuggestContext): TagItem[] {
		const q = context.query.toLowerCase();
		if (q !== this.lastQuery) {
			this.submenu = null;
			this.lastQuery = q;
		}

		// Pure digits -> no dropdown
		if (/^[0-9]+$/.test(q)) {
			return [];
		}

		// Check if user is typing a timer tag like #120dk, #45dk, #60d, etc.
		const timerTypedMatch = q.match(/^(\d+)d?k?$/i);
		if (timerTypedMatch) {
			const mins = parseInt(timerTypedMatch[1], 10);
			if (mins === 2) {
				return [
					{ tag: '#2dk', emoji: '', label: '2 Dakikalık (Blok Sonunda Sıralanır)' }
				];
			} else if (mins > 0) {
				return [
					{
						tag: `#${mins}dk`,
						displayTitle: `#${mins}dk`,
						emoji: '⏱️',
						label: `${mins} Dakika Geri Sayım Zamanlayıcısı (Bitince "kafi" yazar)`
					}
				];
			}
		}

		const rawPresets = this.getSettings().tags;
		const usageCounts = this.getSettings().tagUsageCounts || {};
		const getUsage = (t: string) => {
			const clean = t.split('/')[0].split(':')[0].toLowerCase();
			return usageCounts[clean] || 0;
		};

		// Active Submenu: 'days' (Günler iç dropdown)
		if (this.submenu === 'days') {
			return [
				this.createBackItem(null),
				...this.getDayTagItems()
			];
		}

		// Active Submenu: 'deadline' (2 options: Günler dropdown & Takvim button)
		if (this.submenu === 'deadline') {
			return [
				this.createBackItem(null),
				...getDeadlineRootSuggestions(
					this.app,
					() => {
						this.submenu = 'deadline-days';
						this.refreshSuggestionsInPlace();
					},
					(tag) => this.plugin?.recordTagUsage?.(tag)
				)
			];
		}

		// Active Submenu: 'deadline-days' (Yarın, Çarşamba, etc. with date below)
		if (this.submenu === 'deadline-days') {
			const backTarget: SuggesterSubmenu = q ? null : 'deadline';
			return [
				this.createBackItem(backTarget),
				...getDeadlineDaySuggestions()
			];
		}

		// Active Submenu: 'tur' (Tür iç dropdown: süreç, tekrar, yakında, dışarda, evde, sonra, kilitli, kilitsiz)
		if (this.submenu === 'tur') {
			return [
				this.createBackItem(null),
				...this.getTurTagItems()
			];
		}

		const settings = this.getSettings();
		const isFlatMode = settings.dropdownCategoryMode === 'flat';
		const showDays = !isFlatMode && settings.showDaysDropdown !== false;
		const showTur = !isFlatMode && settings.showTurDropdown !== false;

		// Build root presets
		const rootPresets: TagItem[] = rawPresets
			.filter(item => {
				if (isFlatMode) return true;
				const cat = this.getTagCategory(item.tag, item.category);
				if (cat === 'days' && showDays) return false;
				if (cat === 'tur' && showTur) return false;
				return true;
			})
			.map(item => {
				const lower = item.tag.toLowerCase();
				if (lower === '#deadline') {
					return {
						...item,
						displayTitle: '#deadline',
						label: 'Bitiş Tarihi (Günler / Takvim) ▸',
						isAction: true,
						keepOpen: true,
						isSubmenuTrigger: true,
						action: () => {
							this.submenu = 'deadline';
							this.refreshSuggestionsInPlace();
						}
					};
				}
				return item;
			});

		const rootDropdownItems: TagItem[] = [];

		if (showDays) {
			rootDropdownItems.push({
				tag: '#günler',
				displayTitle: 'Günler',
				emoji: '📅',
				label: 'Bugün, Yarın, Dün, Pazartesi - Pazar ▸',
				isAction: true,
				keepOpen: true,
				isSubmenuTrigger: true,
				action: () => {
					this.submenu = 'days';
					this.refreshSuggestionsInPlace();
				}
			});
		}

		if (showTur) {
			rootDropdownItems.push({
				tag: '#tür',
				displayTitle: 'Tür',
				emoji: '🏷️',
				label: 'Süreç, Tekrar, Yakında, Dışarda, Evde, Sonra, Kilitli, Kilidi Kaldır ▸',
				isAction: true,
				keepOpen: true,
				isSubmenuTrigger: true,
				action: () => {
					this.submenu = 'tur';
					this.refreshSuggestionsInPlace();
				}
			});
		}

		// Dynamic sorting by usage
		const sortedRootPresets = [...rootPresets].sort((a, b) => {
			return getUsage(b.tag) - getUsage(a.tag);
		});

		if (!q) {
			return [...rootDropdownItems, ...sortedRootPresets];
		}

		// Check if query is targeting deadline
		const isDeadlineQuery =
			q === 'deadline' ||
			q.startsWith('dead') ||
			('deadline'.startsWith(q) && q.length >= 2) ||
			q.startsWith('dl') ||
			q === 'vade' ||
			q === 'tarih' ||
			q === 'bitis' ||
			q === 'bitiş';

		if (isDeadlineQuery) {
			// Requirement 7: first option is "Günler" dropdown, second option is "Takvim" button!
			return getDeadlineRootSuggestions(
				this.app,
				() => {
					this.submenu = 'deadline-days';
					this.refreshSuggestionsInPlace();
				},
				(tag) => this.plugin?.recordTagUsage?.(tag)
			);
		}

		// Check if query is targeting #? (soru/not)
		if (q.startsWith('?') || q.startsWith('soru') || q.startsWith('not')) {
			return [
				{
					tag: '#?',
					displayTitle: '#? Soru / Not',
					emoji: '❓',
					label: 'İmleç üzerine gelince görünen soru/not ekle...',
					isAction: true,
					action: (editor: Editor, start: EditorPosition, end: EditorPosition) => {
						new QuestionPromptModal(this.app, '', (question) => {
							const safeText = question.replace(/[\[\]\n\r]/g, ' ').trim();
							const insertText = safeText ? `#?[${safeText}] ` : '#? ';
							editor.replaceRange(insertText, start, end);
							editor.setCursor({
								line: start.line,
								ch: start.ch + insertText.length
							});
							editor.focus();
						}).open();
					}
				}
			];
		}

		// Check if query is targeting "Tür"
		if (q.startsWith('tür') || q.startsWith('tur')) {
			return this.getTurTagItems();
		}

		// Check if query is targeting "Günler"
		if (q.startsWith('gün') || q.startsWith('gun')) {
			return this.getDayTagItems();
		}

		// When user types a query, search across day tags, tur tags, and root presets
		const allSearchable: TagItem[] = [
			...this.getDayTagItems(),
			...this.getTurTagItems(),
			...sortedRootPresets
		];

		const getScore = (item: TagItem): number => {
			const tagLower = item.tag.toLowerCase();
			const labelLower = item.label.toLowerCase();
			const titleLower = (item.displayTitle || '').toLowerCase();
			const usage = getUsage(item.tag);

			// Tekrar / Rutin keywords
			if ((q === 't' || q.startsWith('tek') || q === 'r' || q.startsWith('ru') || q === 'rutin') && (tagLower === '#tekrar' || tagLower === '#rutin')) return 200 + usage;
			// Yakında keywords
			if ((q.startsWith('yak')) && (tagLower === '#yakında' || tagLower === '#yakinda')) return 210 + usage;
			// Process & tracking keywords
			if ((q === 's' || q.startsWith('su') || q.startsWith('sür') || q === 'takip' || q === 'surec' || q === 'süreç' || q.startsWith('kont')) && (tagLower === '#süreç' || tagLower === '#surec')) return 200 + usage;
			// Dışarda keywords
			if ((q === 'd' || q.startsWith('dış') || q.startsWith('dis')) && (tagLower === '#dışarda' || tagLower === '#disarda')) return 220 + usage;
			// Evde keywords
			if ((q === 'e' || q.startsWith('ev')) && tagLower === '#evde') return 220 + usage;
			// Today keywords
			if ((q === 'b' || q.startsWith('bug')) && tagLower === '#bugün') return 200 + usage;
			// Tomorrow keywords
			if ((q === 'y' || q.startsWith('yar')) && tagLower === '#yarın') return 200 + usage;
			// Yesterday keywords
			if ((q === 'd' || q.startsWith('dün') || q.startsWith('dun')) && tagLower === '#dün') return 200 + usage;
			// Priority keywords
			if ((q === 'a' || q.startsWith('ac')) && tagLower === '#acil') return 210 + usage;
			if ((q === '2' || q === '2dk') && tagLower === '#2dk') return 200 + usage;
			if ((q === 'sonra' || q === 'son') && tagLower === '#sonra') return 180 + usage;
			// Lock keywords
			if (q === 'kilit' || q.startsWith('kilit') || q.startsWith('kaldır') || q.startsWith('kaldir') || q.startsWith('kilidi')) {
				if (tagLower === '#kilitsiz') return 230 + usage;
				if (tagLower === '#kilitli') return 220 + usage;
			}

			// Exact tag match (without hash)
			if (tagLower.replace(/^#/, '') === q || titleLower === q) return 140 + usage;
			// Prefix match on tag or displayTitle
			if (tagLower.replace(/^#/, '').startsWith(q) || titleLower.startsWith(q)) return 110 + usage;
			// Substring match on tag
			if (tagLower.includes(q) || titleLower.includes(q)) return 60 + usage;
			// Substring match on label
			if (labelLower.includes(q)) return 40 + usage;

			return 0;
		};

		const matchedPresets = allSearchable
			.map(item => ({ item, score: getScore(item) }))
			.filter(entry => entry.score > 0)
			.sort((a, b) => b.score - a.score)
			.map(entry => entry.item);

		try {
			const vaultTagsMap = (this.app.metadataCache as any)?.getTags?.() || {};
			const extraTags: TagItem[] = [];
			for (const tag of Object.keys(vaultTagsMap)) {
				const cleanTag = tag.startsWith('#') ? tag : '#' + tag;
				if (!allSearchable.some(p => p.tag.toLowerCase() === cleanTag.toLowerCase())) {
					if (cleanTag.toLowerCase().includes(q)) {
						extraTags.push({
							tag: cleanTag,
							emoji: '🏷️',
							label: 'Etiket'
						});
					}
				}
			}
			return [...matchedPresets, ...extraTags];
		} catch (e) {
			return matchedPresets;
		}
	}

	renderSuggestion(item: TagItem, el: HTMLElement): void {
		const container = el.closest('.suggestion-container') as HTMLElement | null;
		if (container) {
			container.addClass('dash-drop-suggest-container');
		}

		el.addClass('dash-drop-item');
		if (item.isAction) {
			el.addClass('is-action-item');
		}
		if (item.isBackButton) {
			el.addClass('is-back-item');
		}
		if (item.isSubmenuTrigger) {
			el.addClass('is-submenu-trigger');
		}

		const content = el.createDiv({ cls: 'dash-drop-content' });
		if (item.tag.toLowerCase() === '#acil') {
			const iconSpan = content.createSpan({ cls: 'dash-drop-icon mytasks-urgent-icon' });
			iconSpan.innerHTML = URGENT_TRIANGLE_SVG;
		} else if (item.emoji) {
			content.createSpan({ cls: 'dash-drop-icon', text: item.emoji });
		} else {
			content.createSpan({ cls: 'dash-drop-icon dash-drop-icon-empty' });
		}

		const texts = content.createDiv({ cls: 'dash-drop-texts' });
		const titleRow = texts.createDiv({ cls: 'dash-drop-title-row' });
		titleRow.createSpan({ cls: 'dash-drop-title', text: item.displayTitle || item.tag });
		if (item.isSubmenuTrigger) {
			titleRow.createSpan({ cls: 'dash-drop-submenu-arrow', text: '▸' });
		}

		if (item.label && item.label !== (item.displayTitle || item.tag)) {
			texts.createDiv({ cls: 'dash-drop-desc', text: item.label });
		}
	}

	selectSuggestion(item: TagItem, evt: MouseEvent | KeyboardEvent): void {
		if (!this.context) return;
		const editor = this.context.editor;
		const start = this.context.start;
		const end = this.context.end;

		if (item.keepOpen && item.action) {
			item.action(editor, start, end);
			return;
		}

		this.plugin?.recordTagUsage?.(item.tag);

		if (item.action) {
			item.action(editor, start, end);
			this.close();
			return;
		}

		const lowerTag = item.tag.toLowerCase();
		let insertText = item.tag + ' ';
		let addedAutoUrgent = false;

		const dlMatch = item.tag.match(/^#deadline[\/:]([0-9]{4}-[0-9]{2}-[0-9]{2})$/i);
		if (dlMatch) {
			const currentLine = editor.getLine(start.line);
			const dlDate = new Date(dlMatch[1] + 'T00:00:00');
			const now = new Date();
			const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
			const diffDays = Math.round((dlDate.getTime() - today.getTime()) / (24 * 60 * 60 * 1000));
			if (diffDays <= 3 && !/(?:^|\s)#acil\b/i.test(currentLine)) {
				insertText = `${item.tag} #acil `;
				addedAutoUrgent = true;
			}
		}

		editor.replaceRange(insertText, start, end);
		editor.setCursor({
			line: start.line,
			ch: start.ch + insertText.length
		});

		// Requirement 10: If #acil or #2dk was inserted, sort the contiguous task block (#acil at top, #2dk at bottom)
		if (lowerTag === '#acil' || lowerTag === '#2dk' || addedAutoUrgent) {
			const cmView = (editor as any)?.cm as EditorView | undefined;
			if (cmView) {
				const lineNo = start.line + 1;
				setTimeout(() => {
					sortContiguousTodoBlockByPriority(cmView, lineNo);
				}, 10);
			}
		}

		this.close();
	}
}
