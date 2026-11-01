import { App, Editor, EditorPosition, Modal, Setting } from 'obsidian';
import { formatDmyDate, formatIsoDate, getDeadlineDisplay, parseDateString } from './dates';
import { DAY_DISPLAY_NAMES, TagItem, TURKISH_MONTHS, TURKISH_WEEKDAYS_SHORT } from './types';

export class CalendarPickerModal extends Modal {
	currentYear: number;
	currentMonth: number;
	selectedDateStr: string | null = null;
	onSelect: (dateStr: string) => void;

	constructor(app: App, onSelect: (dateStr: string) => void, initialDateStr?: string) {
		super(app);
		this.onSelect = onSelect;
		const initialDate = initialDateStr ? parseDateString(initialDateStr) : null;
		const baseDate = initialDate || new Date();
		this.currentYear = baseDate.getFullYear();
		this.currentMonth = baseDate.getMonth();
		this.selectedDateStr = initialDate ? formatIsoDate(initialDate) : null;
	}

	onOpen() {
		const { contentEl, modalEl } = this;
		contentEl.empty();
		modalEl.addClass('mytasks-calendar-modal');
		this.renderCalendar();
	}

	renderCalendar() {
		const { contentEl } = this;
		contentEl.empty();

		const container = contentEl.createDiv({ cls: 'mytasks-cal-container' });

		// Header: ◀ Ay Yıl ▶
		const header = container.createDiv({ cls: 'mytasks-cal-header' });

		const prevBtn = header.createEl('button', { cls: 'mytasks-cal-nav-btn', text: '◀', attr: { 'aria-label': 'Önceki Ay' } });
		prevBtn.addEventListener('click', (e) => {
			e.preventDefault();
			this.currentMonth--;
			if (this.currentMonth < 0) {
				this.currentMonth = 11;
				this.currentYear--;
			}
			this.renderCalendar();
		});

		header.createDiv({
			cls: 'mytasks-cal-title',
			text: `${TURKISH_MONTHS[this.currentMonth]} ${this.currentYear}`
		});

		const nextBtn = header.createEl('button', { cls: 'mytasks-cal-nav-btn', text: '▶', attr: { 'aria-label': 'Sonraki Ay' } });
		nextBtn.addEventListener('click', (e) => {
			e.preventDefault();
			this.currentMonth++;
			if (this.currentMonth > 11) {
				this.currentMonth = 0;
				this.currentYear++;
			}
			this.renderCalendar();
		});

		// Weekdays Row
		const weekdaysRow = container.createDiv({ cls: 'mytasks-cal-weekdays' });
		for (const day of TURKISH_WEEKDAYS_SHORT) {
			weekdaysRow.createSpan({ text: day });
		}

		// Days Grid
		const grid = container.createDiv({ cls: 'mytasks-cal-grid' });

		const firstDay = new Date(this.currentYear, this.currentMonth, 1);
		const startOffset = (firstDay.getDay() + 6) % 7;
		const daysInMonth = new Date(this.currentYear, this.currentMonth + 1, 0).getDate();

		for (let i = 0; i < startOffset; i++) {
			grid.createDiv({ cls: 'mytasks-cal-day is-empty' });
		}

		const today = new Date();
		const todayIso = formatIsoDate(today);

		for (let dayNum = 1; dayNum <= daysInMonth; dayNum++) {
			const cellDate = new Date(this.currentYear, this.currentMonth, dayNum);
			const cellIso = formatIsoDate(cellDate);

			const dayEl = grid.createDiv({ cls: 'mytasks-cal-day' });
			dayEl.createSpan({ cls: 'mytasks-cal-day-num', text: String(dayNum) });

			if (cellIso === todayIso) {
				dayEl.addClass('is-today');
			}
			if (this.selectedDateStr === cellIso) {
				dayEl.addClass('is-selected');
			}

			const dlInfo = getDeadlineDisplay(cellIso);
			dayEl.title = `${cellIso} (${dlInfo.displayText})`;

			dayEl.addEventListener('click', (e) => {
				e.preventDefault();
				this.onSelect(cellIso);
				this.close();
			});
		}

		// Footer: Quick today button & close
		const footer = container.createDiv({ cls: 'mytasks-cal-footer' });

		const todayBtn = footer.createEl('button', { cls: 'mytasks-cal-quick-btn', text: '☀️ Bugün' });
		todayBtn.addEventListener('click', (e) => {
			e.preventDefault();
			const now = new Date();
			this.currentYear = now.getFullYear();
			this.currentMonth = now.getMonth();
			this.renderCalendar();
		});

		const cancelBtn = footer.createEl('button', { cls: 'mytasks-cal-quick-btn is-cancel', text: 'Kapat' });
		cancelBtn.addEventListener('click', (e) => {
			e.preventDefault();
			this.close();
		});
	}

	onClose() {
		const { contentEl } = this;
		contentEl.empty();
	}
}

/**
 * Returns the inner "Günler" list for #deadline:
 * Main title is directly the day name ("Yarın", "Çarşamba", etc.),
 * small subtitle underneath is the formatted date ("20.10.2026").
 */
export function getDeadlineDaySuggestions(): TagItem[] {
	const now = new Date();
	const addDays = (days: number) => {
		const target = new Date(now.getFullYear(), now.getMonth(), now.getDate());
		target.setDate(target.getDate() + days);
		return target;
	};

	const getDayName = (d: Date) => DAY_DISPLAY_NAMES[d.getDay()] || '';

	const items: TagItem[] = [];

	// 1. Yarın
	const tomorrow = addDays(1);
	items.push({
		tag: `#deadline/${formatIsoDate(tomorrow)}`,
		displayTitle: 'Yarın',
		emoji: '⏳',
		label: `${formatDmyDate(tomorrow)} • ${getDayName(tomorrow)}`
	});

	// 2. Next 5 days by their day name
	for (let dOffset = 2; dOffset <= 6; dOffset++) {
		const target = addDays(dOffset);
		items.push({
			tag: `#deadline/${formatIsoDate(target)}`,
			displayTitle: getDayName(target),
			emoji: '📅',
			label: `${formatDmyDate(target)} • ${dOffset} gün sonra`
		});
	}

	// 3. 1 week later
	const in1Week = addDays(7);
	items.push({
		tag: `#deadline/${formatIsoDate(in1Week)}`,
		displayTitle: `Haftaya ${getDayName(in1Week)}`,
		emoji: '📅',
		label: `${formatDmyDate(in1Week)} • 1 hafta sonra`
	});

	return items;
}

/**
 * Returns the 2 root options for #deadline:
 * 1) Günler (inner dropdown)
 * 2) Takvim (calendar picker modal)
 */
export function getDeadlineRootSuggestions(
	app: App,
	openDeadlineDaysDropdown: () => void,
	recordUsage?: (tag: string) => void
): TagItem[] {
	return [
		{
			tag: '#deadline/gunler',
			displayTitle: 'Günler',
			emoji: '📅',
			label: 'Yarın ve önümüzdeki günler',
			isAction: true,
			keepOpen: true,
			isSubmenuTrigger: true,
			action: () => {
				openDeadlineDaysDropdown();
			}
		},
		{
			tag: '#deadline/takvim',
			displayTitle: 'Takvim',
			emoji: '🗓️',
			label: 'Takvimden tarih seç...',
			isAction: true,
			action: (editor: Editor, start: EditorPosition, end: EditorPosition) => {
				recordUsage?.('#deadline');
				new CalendarPickerModal(app, (selectedDate: string) => {
					const currentLine = editor.getLine(start.line);
					const dlInfo = getDeadlineDisplay(selectedDate);
					const needsAcil = dlInfo.daysDiff < 2 && !/(?:^|\s)#acil\b/i.test(currentLine);
					const insertText = needsAcil ? `#deadline/${selectedDate} #acil ` : `#deadline/${selectedDate} `;
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

// Backward-compatible export
export function getDeadlineSuggestions(app: App): TagItem[] {
	return getDeadlineDaySuggestions();
}

/**
 * Interactive prompt modal for editing or creating a #?[soru] tag
 */
export class QuestionPromptModal extends Modal {
	initialValue: string;
	onSubmit: (value: string) => void;

	constructor(app: App, initialValue: string, onSubmit: (value: string) => void) {
		super(app);
		this.initialValue = initialValue;
		this.onSubmit = onSubmit;
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.empty();
		this.titleEl.setText('❓ Soru / Not Ekle veya Düzenle');

		let value = this.initialValue;
		const handleSave = () => {
			this.onSubmit(value.trim());
			this.close();
		};

		new Setting(contentEl)
			.setName('Soru veya Not Metni')
			.setDesc('Bu alan için soru metnini yazın. Metin soru işareti emojisi üzerine gelindiğinde görüntülenecektir.')
			.addTextArea(text => {
				text.setPlaceholder('Sorunuzu veya notunuzu buraya yazın...')
					.setValue(this.initialValue)
					.onChange(val => { value = val; });
				text.inputEl.rows = 4;
				text.inputEl.style.width = '100%';
				text.inputEl.addEventListener('keydown', (e: KeyboardEvent) => {
					if (e.key === 'Enter' && !e.shiftKey) {
						e.preventDefault();
						handleSave();
					}
				});
				setTimeout(() => {
					text.inputEl.focus();
					text.inputEl.select();
				}, 50);
			});

		new Setting(contentEl)
			.addButton(btn => btn.setButtonText('Vazgeç').onClick(() => this.close()))
			.addButton(btn => btn.setButtonText('Kaydet (Enter)').setCta().onClick(handleSave));
	}

	onClose() {
		this.contentEl.empty();
	}
}
