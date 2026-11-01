import { App, Notice, Plugin, setIcon } from 'obsidian';
import {
	ensureUrgentTagForShortDeadline,
	evaluateTaskDate,
	formatControlTimestamp,
	formatIsoDate,
	getDeadlineDisplay,
	getProcessControlDisplay
} from './dates';
import { BlockDropPosition, getTaskPriorityWeight, moveAtomicLineBlock } from './block-mover';
import { computeDocumentLockState } from './lock-engine';
import {
	createTimerChipElement,
	formatTimerSeconds,
	getActiveRunningTimers,
	parseTimerMinutes,
	registerTimerChangeCallback,
	toggleTaskTimer,
	unregisterTimerChangeCallback
} from './timer-manager';
import {
	createResolvedTagDOM,
	extractQuestionText,
	extractTaskTags,
	getTaskDisplayText,
	mergeTaskDisplayText,
	resolveTagVisual
} from './tag-registry';
import {
	DAY_TAGS_SET,
	LUCIDE_CLOCK_SVG,
	LUCIDE_EYE_OFF_SVG,
	LUCIDE_EYE_SVG,
	LUCIDE_FLAG_SVG,
	LUCIDE_LOCK_SVG,
	TaskRecord,
	TURKISH_DAYS,
	URGENT_TRIANGLE_SVG
} from './types';

export async function collectVaultTasks(
	app: App,
	excludePath?: string,
	isAggregatorFn?: (path: string) => boolean,
	lockFutureTasks: boolean = true
): Promise<TaskRecord[]> {
	const files = app.vault.getMarkdownFiles();
	const tasks: TaskRecord[] = [];

	for (const file of files) {
		if (file.path.startsWith('.obsidian/')) continue;
		if (excludePath && file.path === excludePath) continue;
		if (isAggregatorFn?.(file.path)) continue;

		const content = await app.vault.cachedRead(file);
		// Check if file has either checkboxes or #tags
		if (!content.includes('[') && !content.includes('#')) continue;

		const lines = content.split('\n');
		const docLock = computeDocumentLockState(lines, lockFutureTasks);

		for (let i = 0; i < lines.length; i++) {
			const line = lines[i];

			// 1. Checkbox tasks: - [ ] or - [x]
			const cbMatch = line.match(/^(\s*)(?:[-*+•]|\d+[.)])\s*\[([ xX/])]\s*(.*)$/);
			if (cbMatch) {
				const checked = cbMatch[2].toLowerCase() === 'x';
				const rawText = checked ? cbMatch[3].trim() : ensureUrgentTagForShortDeadline(cbMatch[3].trim());
				const tags = extractTaskTags(rawText);
				const dateInfo = evaluateTaskDate(rawText, tags, file.stat.mtime);
				if (!lockFutureTasks) dateInfo.isLocked = false;

				const lockInfo = docLock.lockedLines.get(i);
				if (lockInfo && lockInfo.isLocked) {
					dateInfo.isLocked = true;
					if (lockInfo.lockType === 'tree') {
						dateInfo.badgeLabel = 'Alt Görevler Bekleniyor';
					}
				}

				tasks.push({
					id: `${file.path}:${i}`,
					file,
					lineNo: i,
					text: rawText,
					completed: checked,
					tags,
					originalLine: line,
					dateInfo,
					isBullet: false
				});
				continue;
			}

			// 2. Normal bullet items containing #tags: - Bullet item #2dk
			const bulletMatch = line.match(/^(\s*)(?:[-*+•]|\d+[.)])\s+(.*)$/);
			if (bulletMatch) {
				const rawText = ensureUrgentTagForShortDeadline(bulletMatch[2].trim());
				const tags = extractTaskTags(rawText);
				if (tags.length > 0) {
					const dateInfo = evaluateTaskDate(rawText, tags, file.stat.mtime);
					if (!lockFutureTasks) dateInfo.isLocked = false;

					tasks.push({
						id: `${file.path}:${i}`,
						file,
						lineNo: i,
						text: rawText,
						completed: false,
						tags,
						originalLine: line,
						dateInfo,
						isBullet: true
					});
				}
			}
		}
	}

	return tasks;
}

async function modifyTaskLine(
	app: App,
	task: TaskRecord,
	transform: (line: string) => string
): Promise<boolean> {
	let changed = false;
	try {
		await app.vault.process(task.file, (content) => {
			const lines = content.split('\n');
			if (task.lineNo < lines.length) {
				const currentLine = lines[task.lineNo];
				const updatedLine = transform(currentLine);
				if (updatedLine !== currentLine) {
					lines[task.lineNo] = updatedLine;
					task.originalLine = updatedLine;
					changed = true;
					return lines.join('\n');
				}
			}
			return content;
		});
	} catch (err) {
		console.error('CleverLines: Error modifying task line', err);
	}
	return changed;
}

export async function toggleTaskCompletion(app: App, task: TaskRecord, newCompleted: boolean): Promise<boolean> {
	const ok = await modifyTaskLine(app, task, (currentLine) => {
		if (task.isBullet) {
			return newCompleted
				? currentLine.replace(/^(\s*)(?:[-*+•]|\d+[.)])\s+/, '$1- [x] ')
				: currentLine.replace(/^(\s*)(?:[-*+•]|\d+[.)])\s*\[[ xX/]?]\s*/, '$1- ');
		}
		let updated = currentLine.replace(/\[([ xX/])]/, newCompleted ? '[x]' : '[ ]');
		if (newCompleted && /#(?:tekrar|rutin)(?:[\/:]([0-9]+))?\b/i.test(updated)) {
			const match = updated.match(/#(tekrar|rutin)(?:[\/:]([0-9]+))?\b/i);
			const tag = match ? match[1] : 'tekrar';
			const nextCount = (match && match[2] ? parseInt(match[2], 10) : 0) + 1;
			updated = updated.replace(/#(tekrar|rutin)(?:[\/:]([0-9]+))?\b/i, `#${tag}/${nextCount}`);
		}
		return updated;
	});
	if (ok) task.completed = newCompleted;
	return ok;
}

export async function updateTaskText(app: App, task: TaskRecord, newText: string): Promise<boolean> {
	const finalText = ensureUrgentTagForShortDeadline(newText);
	const ok = await modifyTaskLine(app, task, (currentLine) =>
		task.isBullet
			? currentLine.replace(/^(\s*(?:[-*+•]|\d+[.)])\s+)(.*)$/, `$1${finalText}`)
			: currentLine.replace(/^(\s*(?:[-*+•]|\d+[.)])\s*\[[ xX/]?]\s*)(.*)$/, `$1${finalText}`)
	);
	if (ok) {
		task.text = finalText;
		task.tags = extractTaskTags(finalText);
		task.dateInfo = evaluateTaskDate(finalText, task.tags, task.file.stat.mtime);
	}
	return ok;
}

export async function updateTaskProcessControl(app: App, task: TaskRecord): Promise<boolean> {
	const ts = formatControlTimestamp(new Date());
	return modifyTaskLine(app, task, (currentLine) =>
		/#kontrol[\/:]([0-9]{4}-[0-9]{2}-[0-9]{2}(?:[T_\-\s][0-9]{2}[:\-][0-9]{2})?)\b/i.test(currentLine)
			? currentLine.replace(/#kontrol[\/:]([0-9]{4}-[0-9]{2}-[0-9]{2}(?:[T_\-\s][0-9]{2}[:\-][0-9]{2})?)\b/i, `#kontrol/${ts}`)
			: `${currentLine} #kontrol/${ts}`
	);
}

async function moveTaskBlock(
	app: App,
	sourceTask: TaskRecord,
	targetTask: TaskRecord,
	position: BlockDropPosition
): Promise<boolean> {
	if (sourceTask.file.path !== targetTask.file.path || sourceTask.id === targetTask.id) return false;

	let changed = false;
	try {
		await app.vault.process(sourceTask.file, (content) => {
			const lines = content.split('\n');
			if (
				lines[sourceTask.lineNo] !== sourceTask.originalLine ||
				lines[targetTask.lineNo] !== targetTask.originalLine
			) {
				return content;
			}

			const moved = moveAtomicLineBlock(lines, sourceTask.lineNo, targetTask.lineNo, position);
			if (!moved) return content;

			const updated = moved.join('\n');
			changed = updated !== content;
			return changed ? updated : content;
		});
	} catch (error) {
		console.error('CleverLines: Görev bloğu taşınamadı', error);
	}
	return changed;
}

interface BoardGroup {
	id: string;
	title: string;
	iconHtml: string;
	defaultOpen: boolean;
	tasks: TaskRecord[];
}

function buildTaskGroups(tasks: TaskRecord[]): BoardGroup[] {
	const uncompleted = tasks.filter(t => !t.completed);
	const completed = tasks.filter(t => t.completed);

	const hasTag = (t: TaskRecord, ...names: string[]) =>
		t.tags.some(tag => names.includes(tag));

	const hasDeadline = (t: TaskRecord) =>
		t.tags.some(tag => tag.startsWith('#deadline')) || /#deadline[\/:]/i.test(t.originalLine);

	const hasTimer = (t: TaskRecord) =>
		t.tags.some(tag => parseTimerMinutes(tag) !== null);

	const hasWeekday = (t: TaskRecord) =>
		t.tags.some(tag => TURKISH_DAYS[tag.replace(/^#/, '')] !== undefined);

	const knownStandardPrefixes = [
		'#acil', '#bugün', '#bugun', '#dün', '#dun', '#deadline',
		'#yakında', '#yakinda', '#tekrar', '#rutin', '#süreç', '#surec', '#takip',
		'#kontrol', '#yarın', '#yarin', '#2dk', '#dışarda', '#disarda', '#evde',
		'#sonra', '#kilitli', '#kilitsiz', '#?'
	];

	const isKnownTag = (tag: string): boolean => {
		if (DAY_TAGS_SET.has(tag)) return true;
		if (parseTimerMinutes(tag) !== null) return true;
		if (tag.startsWith('#?')) return true;
		return knownStandardPrefixes.some(p => tag === p || tag.startsWith(p + '/') || tag.startsWith(p + ':'));
	};

	const groups: BoardGroup[] = [
		{
			id: 'acil',
			title: 'Acil',
			iconHtml: `<span class="mytasks-urgent-icon">${URGENT_TRIANGLE_SVG}</span>`,
			defaultOpen: true,
			tasks: uncompleted.filter(t => hasTag(t, '#acil'))
		},
		{
			id: 'bugun',
			title: 'Bugün',
			iconHtml: '☀️',
			defaultOpen: true,
			tasks: uncompleted.filter(t => hasTag(t, '#bugün', '#bugun') || t.dateInfo.category === 'today')
		},
		{
			id: 'yarin',
			title: 'Yarın',
			iconHtml: '🔒',
			defaultOpen: true,
			tasks: uncompleted.filter(t => hasTag(t, '#yarın', '#yarin') || t.dateInfo.category === 'tomorrow')
		},
		{
			id: 'dun',
			title: 'Dün & Geçmiş',
			iconHtml: '⏳',
			defaultOpen: true,
			tasks: uncompleted.filter(t => hasTag(t, '#dün', '#dun') || t.dateInfo.category === 'yesterday' || t.dateInfo.category === 'older')
		},
		{
			id: 'tekrar',
			title: 'Tekrar',
			iconHtml: '🔄',
			defaultOpen: true,
			tasks: uncompleted.filter(t => t.tags.some(tag => tag.startsWith('#tekrar') || tag.startsWith('#rutin')))
		},
		{
			id: '2dk',
			title: '2 Dakikalık',
			iconHtml: '2dk',
			defaultOpen: true,
			tasks: uncompleted.filter(t => hasTag(t, '#2dk'))
		},
		{
			id: 'soru',
			title: 'Soru & Notlar',
			iconHtml: '❓',
			defaultOpen: true,
			tasks: uncompleted.filter(t => t.tags.some(tag => tag.startsWith('#?')))
		},
		{
			id: 'deadline',
			title: 'Bitiş Tarihleri',
			iconHtml: '⏳',
			defaultOpen: true,
			tasks: uncompleted.filter(t => hasDeadline(t))
		},
		{
			id: 'disarda',
			title: 'Dışarda',
			iconHtml: '🚗',
			defaultOpen: true,
			tasks: uncompleted.filter(t => hasTag(t, '#dışarda', '#disarda'))
		},
		{
			id: 'evde',
			title: 'Evde',
			iconHtml: '🏠',
			defaultOpen: true,
			tasks: uncompleted.filter(t => hasTag(t, '#evde'))
		},
		{
			id: 'yakinda',
			title: 'Yakında',
			iconHtml: '🔜',
			defaultOpen: true,
			tasks: uncompleted.filter(t => hasTag(t, '#yakında', '#yakinda'))
		},
		{
			id: 'surec',
			title: 'Süreç & Takip',
			iconHtml: '👁️',
			defaultOpen: true,
			tasks: uncompleted.filter(t => hasTag(t, '#süreç', '#surec', '#takip', '#kontrol') || t.tags.some(tag => tag.startsWith('#kontrol/')))
		},
		{
			id: 'timer',
			title: 'Zamanlayıcılı Görevler',
			iconHtml: '⏱️',
			defaultOpen: true,
			tasks: uncompleted.filter(t => hasTimer(t))
		},
		{
			id: 'gunler',
			title: 'Günler (Pazartesi - Pazar)',
			iconHtml: '🔒',
			defaultOpen: true,
			tasks: uncompleted.filter(t => hasWeekday(t))
		},
		{
			id: 'sonra',
			title: 'Sonra',
			iconHtml: '🕒',
			defaultOpen: true,
			tasks: uncompleted.filter(t => hasTag(t, '#sonra'))
		},
		{
			id: 'kilitli',
			title: 'Kilitliler',
			iconHtml: `<span class="mytasks-chip-icon">${LUCIDE_LOCK_SVG}</span>`,
			defaultOpen: true,
			tasks: uncompleted.filter(t => hasTag(t, '#kilitli') || t.dateInfo.badgeLabel === 'Alt Görevler Bekleniyor')
		},
		{
			id: 'kilitsiz',
			title: 'Kilitsizler / Açık',
			iconHtml: '',
			defaultOpen: true,
			tasks: uncompleted.filter(t => hasTag(t, '#kilitsiz'))
		}
	];

	// Collect any custom #tags not in standard groups
	const customTagMap = new Map<string, TaskRecord[]>();
	for (const t of uncompleted) {
		for (const tag of t.tags) {
			if (!isKnownTag(tag)) {
				const list = customTagMap.get(tag) || [];
				list.push(t);
				customTagMap.set(tag, list);
			}
		}
	}

	for (const [customTag, list] of customTagMap.entries()) {
		const cleanName = customTag.replace(/^#/, '');
		groups.push({
			id: `custom-${cleanName}`,
			title: cleanName.charAt(0).toUpperCase() + cleanName.slice(1),
			iconHtml: '🏷️',
			defaultOpen: true,
			tasks: list
		});
	}

	// Untagged tasks (tasks with no #tags at all so nothing is ever hidden!)
	const untaggedTasks = uncompleted.filter(t => {
		const visibleTags = t.tags.filter(tag => !tag.startsWith('#kontrol'));
		return visibleTags.length === 0 && t.dateInfo.category === 'none';
	});

	if (untaggedTasks.length > 0) {
		groups.push({
			id: 'untagged',
			title: 'Etiketsiz / Genel Görevler',
			iconHtml: '📝',
			defaultOpen: true,
			tasks: untaggedTasks
		});
	}

	// Completed tasks group at the bottom
	if (completed.length > 0) {
		groups.push({
			id: 'completed',
			title: 'Tamamlanan Görevler',
			iconHtml: '✅',
			defaultOpen: false,
			tasks: completed
		});
	}

	// Sort tasks inside each group: #acil at top, normal in middle, #2dk at bottom!
	for (const g of groups) {
		g.tasks.sort((a, b) => getTaskPriorityWeight(b.originalLine) - getTaskPriorityWeight(a.originalLine));
	}

	// Keep the first view calm: only immediate groups start open.
	const defaultOpenGroups = new Set(['acil', 'bugun']);
	for (const group of groups) {
		group.defaultOpen = defaultOpenGroups.has(group.id);
	}

	return groups.filter(g => g.tasks.length > 0);
}

export async function renderTaskBoard(
	plugin: Plugin,
	containerEl: HTMLElement,
	currentPath?: string,
	isAggregatorFn?: (path: string) => boolean
) {
	containerEl.empty();

	const pluginSettings = (plugin as any).settings || {};
	if (!pluginSettings.boardOpenGroups) {
		pluginSettings.boardOpenGroups = {};
	}
	if (!pluginSettings.boardGroupOrder) {
		pluginSettings.boardGroupOrder = [];
	}

	const board = containerEl.createDiv({ cls: 'mytasks-board' });

	// Compact header: actionable statistics and native icon buttons.
	const header = board.createDiv({ cls: 'mytasks-header' });
	const headerLeft = header.createDiv({ cls: 'mytasks-header-left' });

	const statsContainer = headerLeft.createDiv({ cls: 'mytasks-stats-pills' });
	const createStatPill = (className: string, label: string) => statsContainer.createEl('button', {
		cls: `mytasks-stat-pill ${className}`,
		attr: { type: 'button', title: `${label} grubunu göster`, 'aria-label': `${label} grubunu göster` }
	});
	const pillAcil = createStatPill('pill-acil', 'Acil');
	const pillToday = createStatPill('pill-today', 'Bugün');
	const pillTomorrow = createStatPill('pill-future', 'Yarın');
	const pillYesterday = createStatPill('pill-yesterday', 'Geçmiş');
	const pillTekrar = createStatPill('pill-tekrar', 'Tekrar');
	const pill2dk = createStatPill('pill-2dk', '2 dakikalık');
	const pillQuestion = createStatPill('pill-question', 'Soru');
	const pillDeadline = createStatPill('pill-deadline', 'Yaklaşan bitiş tarihleri');

	// Active running/paused timers banner in control panel
	const activeTimersBanner = board.createDiv({ cls: 'mytasks-active-timers-banner' });
	const renderActiveTimersBanner = () => {
		activeTimersBanner.empty();
		const activeTimers = getActiveRunningTimers();
		if (activeTimers.length === 0) {
			activeTimersBanner.style.display = 'none';
			return;
		}
		activeTimersBanner.style.display = 'flex';
		const timerTitle = activeTimersBanner.createSpan({ cls: 'mytasks-active-timers-title' });
		const timerTitleIcon = timerTitle.createSpan({ cls: 'mytasks-active-timers-title-icon' });
		setIcon(timerTitleIcon, 'timer');
		timerTitle.createSpan({ text: 'Aktif sayaçlar' });

		for (const t of activeTimers) {
			const chip = activeTimersBanner.createEl('button', {
				cls: `dash-drop-date-lock-tag dash-drop-timer-tag status-${t.status} mytasks-active-banner-chip`,
				attr: { type: 'button' }
			});
			const timeStr = formatTimerSeconds(t.remainingSeconds);
			const taskName = t.key.split('::')[0];
			chip.innerHTML = `<span class="mytasks-chip-icon">${LUCIDE_CLOCK_SVG}</span> <span class="dash-drop-date-text"><b>${taskName}</b>: ${timeStr}</span>`;
			chip.title = `${taskName} (${timeStr}) • Tıkla: Durdur / Devam Et`;
			chip.setAttribute('aria-label', chip.title);
			chip.addEventListener('click', (e) => {
				e.stopPropagation();
				toggleTaskTimer(t.key, t.minutes);
				renderActiveTimersBanner();
			});
		}
	};
	renderActiveTimersBanner();

	const onTimerTick = () => {
		if (!containerEl.isConnected) {
			unregisterTimerChangeCallback(onTimerTick);
			return;
		}
		renderActiveTimersBanner();
	};
	registerTimerChangeCallback(onTimerTick);

	const headerRight = header.createDiv({ cls: 'mytasks-header-right' });
	const toggleAllBtn = headerRight.createEl('button', {
		cls: 'mytasks-refresh-btn mytasks-icon-only-btn',
		attr: { type: 'button', title: 'Tüm grupları kapat', 'aria-label': 'Tüm grupları kapat' }
	});
	setIcon(toggleAllBtn, 'chevrons-up-down');

	const refreshBtn = headerRight.createEl('button', {
		cls: 'mytasks-refresh-btn mytasks-icon-only-btn',
		attr: { type: 'button', title: 'Görevleri yenile', 'aria-label': 'Görevleri yenile' }
	});
	setIcon(refreshBtn, 'refresh-cw');

	// Search Bar
	const controlsBar = board.createDiv({ cls: 'mytasks-controls-bar' });
	const searchWrap = controlsBar.createDiv({ cls: 'mytasks-search-wrap' });
	const searchIcon = searchWrap.createSpan({ cls: 'mytasks-search-icon' });
	setIcon(searchIcon, 'search');
	const searchInput = searchWrap.createEl('input', {
		cls: 'mytasks-search-input',
		type: 'search',
		attr: {
			placeholder: 'Görev veya dosya ara',
			'aria-label': 'Görev veya dosya ara',
			autocomplete: 'off'
		}
	});

	let searchQuery = '';
	let allTasks: TaskRecord[] = [];
	let allExpanded = true;

	// Groups list container
	const listContainer = board.createDiv({ cls: 'mytasks-list mytasks-grouped-board' });
	const tagEmojiMap = new Map<string, string>(
		(pluginSettings.tags || []).map((tag: { tag: string; emoji: string }) => [tag.tag.toLowerCase(), tag.emoji])
	);
	let draggedTask: TaskRecord | null = null;

	const clearTaskDropMarkers = () => {
		listContainer.querySelectorAll('.mytasks-item.is-dragging, .mytasks-item.drag-over-before, .mytasks-item.drag-over-after')
			.forEach(el => el.removeClass('is-dragging', 'drag-over-before', 'drag-over-after'));
	};

	const tryMoveTask = async (
		sourceTask: TaskRecord,
		targetTask: TaskRecord,
		position: BlockDropPosition
	) => {
		if (sourceTask.id === targetTask.id) return;
		if (sourceTask.file.path !== targetTask.file.path) {
			new Notice('Görevler yalnızca aynı not içinde sıralanabilir.');
			return;
		}
		if (getTaskPriorityWeight(sourceTask.originalLine) !== getTaskPriorityWeight(targetTask.originalLine)) {
			new Notice('#acil ve #2dk öncelik sırası korunur.');
			return;
		}

		const moved = await moveTaskBlock(plugin.app, sourceTask, targetTask, position);
		if (!moved) {
			new Notice('Görev taşınamadı; not değişmiş veya görevler farklı girinti düzeyinde olabilir.');
			return;
		}
		await loadTasks();
	};

	const renderSingleTaskRow = (parentEl: HTMLElement, task: TaskRecord) => {
		const item = parentEl.createDiv({ cls: 'mytasks-item' });
		item.dataset.taskId = task.id;
		if (task.completed) {
			item.addClass('is-completed');
		}
		if (!task.completed && task.dateInfo.isLocked) {
			item.addClass('is-locked');
		}

		item.addEventListener('dragover', (event) => {
			if (!draggedTask || draggedTask.id === task.id) return;
			event.preventDefault();
			event.stopPropagation();
			if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
			const rect = item.getBoundingClientRect();
			const position: BlockDropPosition = event.clientY < rect.top + rect.height / 2 ? 'before' : 'after';
			item.removeClass('drag-over-before', 'drag-over-after');
			item.addClass(position === 'before' ? 'drag-over-before' : 'drag-over-after');
		});
		item.addEventListener('dragleave', (event) => {
			const nextTarget = event.relatedTarget as Node | null;
			if (!nextTarget || !item.contains(nextTarget)) {
				item.removeClass('drag-over-before', 'drag-over-after');
			}
		});
		item.addEventListener('drop', async (event) => {
			event.preventDefault();
			event.stopPropagation();
			const sourceTask = draggedTask;
			const position: BlockDropPosition = item.hasClass('drag-over-after') ? 'after' : 'before';
			draggedTask = null;
			clearTaskDropMarkers();
			if (sourceTask) await tryMoveTask(sourceTask, task, position);
		});

		const isProcessTask = task.tags.some(t => t === '#süreç' || t === '#surec' || t === '#takip' || t === '#kontrol' || t.startsWith('#kontrol/'));

		const itemLeft = item.createDiv({ cls: 'mytasks-item-left' });
		const itemPrefix = itemLeft.createDiv({ cls: 'mytasks-item-prefix' });

		// Checkbox or Bullet symbol
		const cb = itemPrefix.createEl('button', {
			cls: 'mytasks-checkbox',
			attr: {
				type: 'button',
				'aria-pressed': String(task.completed),
				'aria-label': task.completed ? 'Görevi yeniden aç' : 'Görevi tamamla'
			}
		});
		if (!task.completed) {
			const hasAcil = task.tags.includes('#acil');
			const has2dk = task.tags.includes('#2dk');

			if (hasAcil && has2dk) {
				cb.addClass('is-combo');
				cb.title = 'Acil ve 2 dakikalık görev';
			} else if (hasAcil) {
				cb.addClass('is-urgent');
				cb.title = 'Acil görev';
			} else if (has2dk) {
				cb.addClass('is-twomin');
				cb.title = '2 dakikalık görev';
			}
		}
		if (task.isBullet) {
			cb.addClass('is-bullet');
			cb.innerHTML = '•';
			cb.title = 'Madde (Tıkla: Tamamlandı olarak işaretle)';
			cb.setAttribute('aria-label', 'Maddeyi tamamlandı olarak işaretle');
		} else if (task.completed) {
			cb.addClass('is-checked');
		} else if (task.dateInfo.isLocked) {
			cb.addClass('is-locked');
			cb.title = `🔒 Kilitli: Vakti gelmedi (${task.dateInfo.badgeLabel})`;
			cb.setAttribute('aria-disabled', 'true');
			cb.setAttribute('aria-label', `Kilitli görev: ${task.dateInfo.badgeLabel}`);
		}
		if (isProcessTask && !task.completed) {
			cb.setAttribute('aria-label', 'Kontrol zamanını güncelle; tamamlamak için Shift ile tıkla');
		}

		cb.addEventListener('click', async (e) => {
			e.stopPropagation();

			if (!task.completed && task.dateInfo.isLocked) {
				new Notice(`🔒 ${task.dateInfo.badgeLabel}`);
				return;
			}

			if (isProcessTask && !task.completed) {
				if (e.shiftKey || e.altKey) {
					const ok = await toggleTaskCompletion(plugin.app, task, true);
					if (ok) {
						task.completed = true;
						cb.addClass('is-checked');
						item.addClass('is-completed');
						cb.setAttribute('aria-pressed', 'true');
						cb.setAttribute('aria-label', 'Görevi yeniden aç');
						setTimeout(loadTasks, 250);
					}
				} else {
					await updateTaskProcessControl(plugin.app, task);
					loadTasks();
				}
				return;
			}

			const newState = !task.completed;
			const ok = await toggleTaskCompletion(plugin.app, task, newState);
			if (ok) {
				task.completed = newState;
				cb.toggleClass('is-checked', newState);
				item.toggleClass('is-completed', newState);
				cb.setAttribute('aria-pressed', String(newState));
				cb.setAttribute('aria-label', newState ? 'Görevi yeniden aç' : 'Görevi tamamla');
				setTimeout(loadTasks, 250);
			}
		});

		// Context emojis stay directly after the checkbox; chips follow them.
		const seenContextTags = new Set<string>();
		for (const tag of task.tags) {
			const visual = resolveTagVisual(tag, task.originalLine, tagEmojiMap);
			if (!visual || visual.kind !== 'emoji' || visual.lowerTag === '#dün' || visual.lowerTag === '#dun') continue;
			if (seenContextTags.has(visual.lowerTag)) continue;
			seenContextTags.add(visual.lowerTag);
			itemPrefix.appendChild(createResolvedTagDOM(visual));
		}

		// 3. Written Chips (Deadline, Day-lock, Routine, Process, Yakında, Timers)
		const deadlineMatch = task.originalLine.match(/#deadline[\/:]([0-9]{4}-[0-9]{2}-[0-9]{2})\b/i);
		if (!task.completed && deadlineMatch) {
			const dlInfo = getDeadlineDisplay(deadlineMatch[1]);
			const dlBadge = itemPrefix.createSpan({ cls: 'mytasks-badge mytasks-badge-deadline status-deadline-red' });
			dlBadge.innerHTML = `<span class="mytasks-chip-icon">${LUCIDE_FLAG_SVG}</span><span class="dash-drop-date-text">${dlInfo.displayText}</span>`;
		} else if (!task.completed && task.dateInfo.category !== 'none') {
			if (task.dateInfo.category === 'today') {
				const dateBadge = itemPrefix.createSpan({ cls: 'mytasks-badge mytasks-badge-today' });
				dateBadge.innerHTML = `<span class="dash-drop-date-text">Bugün</span>`;
			} else if (task.dateInfo.category === 'yesterday') {
				const dateBadge = itemPrefix.createSpan({ cls: 'mytasks-badge mytasks-badge-yesterday' });
				dateBadge.innerHTML = `<span class="mytasks-chip-icon">${LUCIDE_CLOCK_SVG}</span><span class="dash-drop-date-text">Dün</span>`;
			} else if (task.dateInfo.category === 'older') {
				const dateBadge = itemPrefix.createSpan({ cls: 'mytasks-badge mytasks-badge-older' });
				dateBadge.innerHTML = `<span class="mytasks-chip-icon">${LUCIDE_CLOCK_SVG}</span><span class="dash-drop-date-text">Dünden Eski</span>`;
			} else {
				const lockChip = itemPrefix.createSpan({ cls: 'dash-drop-date-lock-tag mytasks-day-lock-tag' });
				lockChip.innerHTML = `<span class="mytasks-chip-icon">${LUCIDE_LOCK_SVG}</span><span class="dash-drop-date-text">${task.dateInfo.badgeLabel}</span>`;
			}
		}

		// Question Badge (#?)
		const questionTag = task.tags.find(t => t.startsWith('#?'));
		if (questionTag) {
			const qText = extractQuestionText(questionTag);
			const qBadge = itemPrefix.createSpan({ cls: 'mytasks-badge mytasks-badge-question' });
			const label = qText ? `? ${qText}` : '? soru';
			qBadge.innerHTML = `<span class="dash-drop-date-text">${label}</span>`;
			qBadge.title = qText ? `Soru: ${qText}` : 'Soru';
		}

		// Tekrar Badge (#tekrar / #rutin) - İkonsuz "N. Tekrar"
		const routineTag = task.tags.find(t => t.startsWith('#tekrar') || t.startsWith('#rutin'));
		if (routineTag) {
			const routineMatch = routineTag.match(/^#(?:tekrar|rutin)(?:[\/:]([0-9]+))?$/i);
			const curCount = routineMatch && routineMatch[1] ? parseInt(routineMatch[1], 10) : 0;
			const label = `${curCount + 1}. Tekrar`;
			const routineBadge = itemPrefix.createSpan({ cls: 'mytasks-badge mytasks-badge-routine' });
			routineBadge.innerHTML = `<span class="dash-drop-date-text">${label}</span>`;
			routineBadge.title = `${label} • Her tamamlamada sayaç 1 artar; gün devrinde sayaç korunur`;
		}

		// Process Badge (#süreç / #kontrol) with exact relative time
		if (isProcessTask) {
			const controlMatch = task.originalLine.match(/#kontrol[\/:]([0-9]{4}-[0-9]{2}-[0-9]{2}(?:[T_\-\s][0-9]{2}[:\-][0-9]{2})?)\b/i);
			const controlInfo = getProcessControlDisplay(controlMatch ? controlMatch[1] : undefined);
			const processBadge = itemPrefix.createEl('button', {
				cls: `mytasks-badge mytasks-badge-process status-${controlInfo.status}`,
				attr: { type: 'button' }
			});
			const iconSvg = controlInfo.icon === 'eye-off' ? LUCIDE_EYE_OFF_SVG : LUCIDE_EYE_SVG;
			if (controlInfo.displayText) {
				processBadge.innerHTML = `<span class="mytasks-chip-icon">${iconSvg}</span><span class="dash-drop-date-text">${controlInfo.displayText}</span>`;
				processBadge.title = `Son Kontrol: ${controlInfo.displayText} • Tıkla: Şimdi Yeniden Kontrol Et`;
			} else {
				processBadge.innerHTML = `<span class="mytasks-chip-icon">${iconSvg}</span>`;
				processBadge.title = 'Kontrol Edilmedi • Tıkla: Şimdi Kontrol Et';
			}
			processBadge.setAttribute('aria-label', processBadge.title);
			processBadge.addEventListener('click', async (e) => {
				e.stopPropagation();
				await updateTaskProcessControl(plugin.app, task);
				loadTasks();
			});
		}

		// Yakında Badge (#yakında)
		if (task.tags.includes('#yakında') || task.tags.includes('#yakinda')) {
			const yakindaBadge = itemPrefix.createSpan({ cls: 'mytasks-badge mytasks-badge-yakinda' });
			yakindaBadge.innerHTML = `<span class="mytasks-chip-icon">${LUCIDE_CLOCK_SVG}</span><span class="dash-drop-date-text">Yakında</span>`;
		}

		// Timer Badges (#120dk, etc.)
		for (const tag of task.tags) {
			const mins = parseTimerMinutes(tag);
			if (mins !== null) {
				const timerEl = createTimerChipElement(task.originalLine, mins);
				itemPrefix.appendChild(timerEl);
			}
		}


		// 3. Editable task text input
		const textInput = itemLeft.createEl('input', {
			cls: 'mytasks-item-text-input',
			type: 'text',
			value: getTaskDisplayText(task.text),
			attr: { 'aria-label': 'Görev başlığını düzenle' }
		});

		textInput.addEventListener('click', (e) => {
			e.stopPropagation();
		});

		textInput.addEventListener('keydown', async (e) => {
			if (e.key === 'Enter') {
				textInput.blur();
			} else if (e.key === 'Escape') {
				textInput.value = getTaskDisplayText(task.text);
				textInput.blur();
			}
		});

		textInput.addEventListener('blur', async () => {
			const trimmed = textInput.value.trim();
			const updatedText = mergeTaskDisplayText(task.text, trimmed);
			if (trimmed && updatedText !== task.text) {
				const ok = await updateTaskText(plugin.app, task, updatedText);
				if (ok) {
					loadTasks();
				}
			} else if (!trimmed) {
				textInput.value = getTaskDisplayText(task.text);
			}
		});

		// Right side: Source note badge only (Quick actions removed per user specification)
		const itemRight = item.createDiv({ cls: 'mytasks-item-right' });
		const dragHandle = itemRight.createEl('button', {
			cls: 'mytasks-drag-handle',
			attr: {
				type: 'button',
				draggable: 'true',
				title: 'Görevi taşı',
				'aria-label': 'Görevi sürükleyerek taşı'
			}
		});
		setIcon(dragHandle, 'grip-vertical');
		dragHandle.addEventListener('click', event => event.stopPropagation());
		dragHandle.addEventListener('dragstart', (event) => {
			event.stopPropagation();
			draggedTask = task;
			item.addClass('is-dragging');
			if (event.dataTransfer) {
				event.dataTransfer.effectAllowed = 'move';
				event.dataTransfer.setData('text/plain', task.id);
			}
		});
		dragHandle.addEventListener('dragend', () => {
			draggedTask = null;
			clearTaskDropMarkers();
		});

		const fileBadge = itemRight.createEl('button', {
			cls: 'mytasks-file-badge',
			text: task.file.basename,
			attr: {
				type: 'button',
				title: `${task.file.path} dosyasında aç`,
				'aria-label': `${task.file.basename} dosyasında aç`
			}
		});
		fileBadge.addEventListener('click', async (e) => {
			e.stopPropagation();
			const leaf = plugin.app.workspace.getLeaf(false);
			await leaf.openFile(task.file);
		});
	};

	const saveSettings = async () => {
		try {
			await (plugin as any).saveData(pluginSettings);
		} catch (err) {
			console.error('MyTasks: Error saving board settings', err);
		}
	};

	const syncToggleAllState = () => {
		const details = Array.from(listContainer.querySelectorAll<HTMLDetailsElement>('details.mytasks-group-dropdown'));
		allExpanded = details.length > 0 && details.every(detail => detail.open);
		const label = allExpanded ? 'Tüm grupları kapat' : 'Tüm grupları aç';
		toggleAllBtn.title = label;
		toggleAllBtn.setAttribute('aria-label', label);
		toggleAllBtn.setAttribute('aria-pressed', String(allExpanded));
	};

	const renderList = () => {
		listContainer.empty();

		let filtered = allTasks;
		if (searchQuery) {
			filtered = filtered.filter(t =>
				t.text.toLowerCase().includes(searchQuery) ||
				t.file.basename.toLowerCase().includes(searchQuery) ||
				t.tags.some(tag => tag.includes(searchQuery))
			);
		}

		const groups = buildTaskGroups(filtered);

		if (groups.length === 0) {
			const empty = listContainer.createDiv({ cls: 'mytasks-empty' });
			const emptyIcon = empty.createDiv({ cls: 'mytasks-empty-icon' });
			setIcon(emptyIcon, searchQuery ? 'search-x' : 'circle-check');
			empty.createDiv({ text: searchQuery ? 'Aramayla eşleşen görev yok.' : 'Gösterilecek görev yok.' });
			syncToggleAllState();
			return;
		}

		// Reorder groups according to persisted boardGroupOrder
		const customOrder: string[] = pluginSettings.boardGroupOrder || [];
		if (customOrder.length > 0) {
			groups.sort((a, b) => {
				const idxA = customOrder.indexOf(a.id);
				const idxB = customOrder.indexOf(b.id);
				if (idxA !== -1 && idxB !== -1) return idxA - idxB;
				if (idxA !== -1) return -1;
				if (idxB !== -1) return 1;
				return 0;
			});
		}

		for (let gIdx = 0; gIdx < groups.length; gIdx++) {
			const group = groups[gIdx];
			const detailsEl = listContainer.createEl('details', { cls: `mytasks-group-dropdown group-${group.id}` });
			detailsEl.dataset.groupId = group.id;

			const savedOpen = pluginSettings.boardOpenGroups?.[group.id];
			const isOpen = savedOpen !== undefined ? savedOpen : group.defaultOpen;
			if (isOpen) {
				detailsEl.setAttribute('open', '');
			}

			detailsEl.addEventListener('toggle', () => {
				pluginSettings.boardOpenGroups[group.id] = detailsEl.open;
				saveSettings();
				syncToggleAllState();
			});

			// Drag and drop reordering
			detailsEl.addEventListener('dragstart', (e) => {
				e.dataTransfer?.setData('text/plain', group.id);
				detailsEl.classList.add('is-dragging');
			});
			detailsEl.addEventListener('dragend', () => {
				detailsEl.classList.remove('is-dragging');
			});
			detailsEl.addEventListener('dragover', (e) => {
				e.preventDefault();
				detailsEl.classList.add('drag-over');
			});
			detailsEl.addEventListener('dragleave', () => {
				detailsEl.classList.remove('drag-over');
			});
			detailsEl.addEventListener('drop', async (e) => {
				e.preventDefault();
				detailsEl.classList.remove('drag-over');
				const draggedId = e.dataTransfer?.getData('text/plain');
				if (!draggedId || draggedId === group.id) return;

				const currentOrder = groups.map(g => g.id);
				const fromIdx = currentOrder.indexOf(draggedId);
				const toIdx = currentOrder.indexOf(group.id);
				if (fromIdx !== -1 && toIdx !== -1) {
					currentOrder.splice(fromIdx, 1);
					currentOrder.splice(toIdx, 0, draggedId);
					pluginSettings.boardGroupOrder = currentOrder;
					await saveSettings();
					renderList();
				}
			});

			const summaryEl = detailsEl.createEl('summary', { cls: 'mytasks-group-summary' });
			summaryEl.setAttribute('draggable', 'true');
			const summaryLeft = summaryEl.createDiv({ cls: 'mytasks-group-summary-left' });
			const iconWrap = summaryLeft.createSpan({ cls: 'mytasks-group-icon' });
			iconWrap.innerHTML = group.iconHtml;
			summaryLeft.createSpan({ cls: 'mytasks-group-title', text: group.title });

			const summaryRight = summaryEl.createDiv({ cls: 'mytasks-group-summary-right' });
			summaryRight.createSpan({ cls: 'mytasks-group-count', text: `${group.tasks.length}` });

			const groupBody = detailsEl.createDiv({ cls: 'mytasks-group-body' });
			for (const task of group.tasks) {
				renderSingleTaskRow(groupBody, task);
			}
		}
		syncToggleAllState();
	};

	const loadTasks = async () => {
		board.setAttribute('aria-busy', 'true');
		refreshBtn.disabled = true;
		try {
			allTasks = await collectVaultTasks(
				plugin.app,
				currentPath,
				isAggregatorFn,
				pluginSettings.lockFutureTasks !== false
			);

			const uncompleted = allTasks.filter(t => !t.completed);

			const urgentCount = uncompleted.filter(t => t.tags.includes('#acil')).length;
			const todayCount = uncompleted.filter(t => t.tags.includes('#bugün') || t.tags.includes('#bugun') || t.dateInfo.category === 'today').length;
			const tomorrowCount = uncompleted.filter(t => t.tags.includes('#yarın') || t.tags.includes('#yarin') || t.dateInfo.category === 'tomorrow').length;
			const pastCount = uncompleted.filter(t => t.tags.includes('#dün') || t.tags.includes('#dun') || t.dateInfo.category === 'yesterday' || t.dateInfo.category === 'older').length;
			const routineCount = uncompleted.filter(t => t.tags.some(tag => tag.startsWith('#tekrar') || tag.startsWith('#rutin'))).length;
			const twoMinCount = uncompleted.filter(t => t.tags.includes('#2dk')).length;
			const questionCount = uncompleted.filter(t => t.tags.some(tag => tag.startsWith('#?'))).length;
			const dlUnder3Count = uncompleted.filter(t => {
				const dl = t.originalLine.match(/#deadline[\/:]([0-9]{4}-[0-9]{2}-[0-9]{2})\b/i);
				if (!dl) return false;
				const info = getDeadlineDisplay(dl[1]);
				return info.daysDiff <= 3;
			}).length;

			const updateStatPill = (pill: HTMLButtonElement, symbol: string, count: number, label: string) => {
				pill.setText(`${symbol} ${count}`);
				pill.hidden = count === 0;
				pill.title = `${label}: ${count} • Grubu göster`;
				pill.setAttribute('aria-label', `${label}: ${count}. Grubu göster`);
			};

			updateStatPill(pillAcil, '⚠️', urgentCount, 'Acil');
			updateStatPill(pillToday, '☀️', todayCount, 'Bugün');
			updateStatPill(pillTomorrow, '🔒', tomorrowCount, 'Yarın');
			updateStatPill(pillYesterday, '⏳', pastCount, 'Geçmiş');
			updateStatPill(pillTekrar, '↻', routineCount, 'Tekrar');
			updateStatPill(pill2dk, '2dk', twoMinCount, '2 dakikalık');
			updateStatPill(pillQuestion, '?', questionCount, 'Soru');
			updateStatPill(pillDeadline, '⚑', dlUnder3Count, 'Kritik bitiş tarihi');

			renderList();
		} catch (error) {
			console.error('CleverLines: Görev panosu yenilenemedi', error);
			new Notice('Görev panosu yenilenemedi.');
		} finally {
			board.setAttribute('aria-busy', 'false');
			refreshBtn.disabled = false;
		}
	};

	const focusAndReorderGroup = async (targetGroupId: string) => {
		searchQuery = '';
		searchInput.value = '';
		const groups = buildTaskGroups(allTasks);
		const openMap: Record<string, boolean> = {};
		for (const g of groups) {
			openMap[g.id] = (g.id === targetGroupId);
		}
		pluginSettings.boardOpenGroups = openMap;

		const currentOrder: string[] = (pluginSettings.boardGroupOrder || []).filter((id: string) => id !== targetGroupId);
		pluginSettings.boardGroupOrder = [targetGroupId, ...currentOrder];

		await saveSettings();
		renderList();
		requestAnimationFrame(() => {
			const target = Array.from(listContainer.querySelectorAll<HTMLDetailsElement>('details.mytasks-group-dropdown'))
				.find(detail => detail.dataset.groupId === targetGroupId);
			if (!target) return;
			target.scrollIntoView({ behavior: 'smooth', block: 'start' });
			target.querySelector<HTMLElement>('summary')?.focus();
		});
	};

	pillAcil.addEventListener('click', () => focusAndReorderGroup('acil'));
	pillToday.addEventListener('click', () => focusAndReorderGroup('bugun'));
	pillTomorrow.addEventListener('click', () => focusAndReorderGroup('yarin'));
	pillYesterday.addEventListener('click', () => focusAndReorderGroup('dun'));
	pillTekrar.addEventListener('click', () => focusAndReorderGroup('tekrar'));
	pill2dk.addEventListener('click', () => focusAndReorderGroup('2dk'));
	pillQuestion.addEventListener('click', () => focusAndReorderGroup('soru'));
	pillDeadline.addEventListener('click', () => focusAndReorderGroup('deadline'));

	searchInput.addEventListener('input', () => {
		searchQuery = searchInput.value.toLowerCase().trim();
		renderList();
	});
	searchInput.addEventListener('keydown', (event) => {
		if (event.key !== 'Escape' || !searchInput.value) return;
		searchInput.value = '';
		searchQuery = '';
		renderList();
	});

	toggleAllBtn.addEventListener('click', () => {
		const nextOpen = !allExpanded;
		const detailsList = listContainer.querySelectorAll('details.mytasks-group-dropdown');
		detailsList.forEach((d) => {
			const det = d as HTMLDetailsElement;
			det.open = nextOpen;
			const gid = det.dataset.groupId;
			if (gid) {
				pluginSettings.boardOpenGroups[gid] = nextOpen;
			}
		});
		syncToggleAllState();
		saveSettings();
	});

	refreshBtn.addEventListener('click', () => {
		loadTasks();
	});

	await loadTasks();
}
