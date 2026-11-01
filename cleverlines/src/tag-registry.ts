import { getDeadlineDisplay, getProcessControlDisplay } from './dates';
import { createTimerChipElement, parseTimerMinutes } from './timer-manager';
import {
	DAY_DISPLAY_NAMES,
	LUCIDE_CALENDAR_SVG,
	LUCIDE_CLOCK_SVG,
	LUCIDE_EYE_OFF_SVG,
	LUCIDE_EYE_SVG,
	LUCIDE_FLAG_SVG,
	LUCIDE_HELP_CIRCLE_SVG,
	LUCIDE_LOCK_SVG,
	LUCIDE_REPEAT_SVG,
	LUCIDE_TIMER_SVG,
	TURKISH_DAYS,
	URGENT_TRIANGLE_SVG
} from './types';

export type ResolvedTagKind =
	| 'timer'
	| 'urgent'
	| 'routine'
	| 'yakinda'
	| 'process'
	| 'deadline'
	| 'day-lock'
	| 'hidden'
	| 'kilitli'
	| 'question'
	| 'today'
	| 'emoji';

export interface ResolvedTagVisual {
	kind: ResolvedTagKind;
	rawTag: string;
	lowerTag: string;
	emoji: string;
	labelText?: string;
	status?: string;
	dateStr?: string;
	timerMinutes?: number;
	questionText?: string;
	lineText: string;
}

const TASK_TAG_PATTERN = /#\?(?:\[[^\]\r\n]*\]|[a-zA-Z0-9_\u00C0-\u017F\u0400-\u04FF\-]*)|#[a-zA-Z0-9_\u00C0-\u017F\u0400-\u04FF\-\/:]+/g;

function extractRawTaskTags(text: string): string[] {
	return text.match(TASK_TAG_PATTERN) || [];
}

export function extractTaskTags(text: string): string[] {
	return extractRawTaskTags(text).map(tag => tag.toLowerCase());
}

export function getTaskDisplayText(text: string): string {
	return text.replace(TASK_TAG_PATTERN, ' ').replace(/\s+/g, ' ').trim();
}

export function mergeTaskDisplayText(originalText: string, editedDisplayText: string): string {
	const tags: string[] = [];
	const seen = new Set<string>();
	for (const tag of [...extractRawTaskTags(editedDisplayText), ...extractRawTaskTags(originalText)]) {
		const key = tag.toLowerCase();
		if (seen.has(key)) continue;
		seen.add(key);
		tags.push(tag);
	}
	const title = getTaskDisplayText(editedDisplayText);
	return [title, ...tags].filter(Boolean).join(' ');
}

/**
 * Decodes URL-encoded or raw question text from `#?[...]` or `#?...`
 */
export function extractQuestionText(tag: string): string {
	let text = tag.replace(/^#\?[\/:_]?/i, '');
	if (text.startsWith('[') && text.endsWith(']')) {
		text = text.slice(1, -1);
	}
	try {
		text = decodeURIComponent(text.replace(/_/g, ' '));
	} catch (e) {
		text = text.replace(/_/g, ' ');
	}
	return text.trim();
}

/**
 * Single Source of Truth (SSOT) resolver for any #tag in a task or note line.
 * Adding a new tag type to MyTasks only requires updating this function.
 */
export function resolveTagVisual(
	rawTag: string,
	lineText: string,
	customTagEmojiMap?: Map<string, string>
): ResolvedTagVisual | null {
	const lower = rawTag.toLowerCase();
	const tagWord = lower.replace(/^#/, '');

	// 0. Question tag: #? or #?[soru] or #?soru_metni
	if (rawTag === '#?' || rawTag.startsWith('#?[') || rawTag.startsWith('#?/') || rawTag.startsWith('#?:') || (rawTag.startsWith('#?') && rawTag.length > 2)) {
		const qText = extractQuestionText(rawTag);
		return {
			kind: 'question',
			rawTag,
			lowerTag: lower,
			emoji: '',
			questionText: qText,
			labelText: qText ? `? ${qText}` : '? soru',
			lineText
		};
	}

	// 1. Countdown Timer (#120dk, #45dk, etc. - excluding #2dk)
	const timerMinutes = parseTimerMinutes(lower);
	if (timerMinutes !== null) {
		return {
			kind: 'timer',
			rawTag,
			lowerTag: lower,
			emoji: '⏱️',
			timerMinutes,
			lineText
		};
	}

	// 2. Urgent (#acil) - Red todo checkbox instead of emoji
	if (lower === '#acil') {
		return {
			kind: 'urgent',
			rawTag,
			lowerTag: lower,
			emoji: '',
			lineText
		};
	}

	// 3. Deadline (#deadline/YYYY-MM-DD)
	if (lower.startsWith('#deadline/') || lower.startsWith('#deadline:')) {
		const dateStr = lower.replace(/^#deadline[\/:]/, '');
		const dlInfo = getDeadlineDisplay(dateStr);
		return {
			kind: 'deadline',
			rawTag,
			lowerTag: lower,
			emoji: dlInfo.icon,
			labelText: dlInfo.displayText,
			status: dlInfo.status,
			dateStr,
			lineText
		};
	}

	// 4. Repeating task (#tekrar / #rutin or #tekrar/N)
	const routineMatch = lower.match(/^#(tekrar|rutin)(?:[\/:]([0-9]+))?$/i);
	if (routineMatch) {
		const count = routineMatch[2] ? parseInt(routineMatch[2], 10) : 0;
		return {
			kind: 'routine',
			rawTag,
			lowerTag: lower,
			emoji: '',
			labelText: `${count + 1}. Tekrar`,
			lineText
		};
	}

	// 5. Upcoming / Soon (#yakında / #yakinda)
	if (lower === '#yakında' || lower === '#yakinda') {
		return {
			kind: 'yakinda',
			rawTag,
			lowerTag: lower,
			emoji: '🔜',
			labelText: 'Yakında',
			lineText
		};
	}

	// 5. Process & Tracking (#süreç / #surec / #takip / #kontrol)
	const hasExplicitProcessTag = /#(?:süreç|surec|takip)\b/i.test(lineText);
	const isProcessTag = lower === '#süreç' || lower === '#surec' || lower === '#takip';
	const isControlTag = lower.startsWith('#kontrol/') || lower.startsWith('#kontrol:');

	if (isControlTag && hasExplicitProcessTag) {
		// Hide secondary #kontrol tag because #süreç will display the full status chip
		return {
			kind: 'hidden',
			rawTag,
			lowerTag: lower,
			emoji: '',
			lineText
		};
	}

	if (isProcessTag || isControlTag) {
		const controlMatch = lineText.match(/#kontrol[\/:]([0-9]{4}-[0-9]{2}-[0-9]{2}(?:[T_\-\s][0-9]{2}[:\-][0-9]{2})?)\b/i);
		const controlDate = controlMatch ? controlMatch[1] : undefined;
		const controlInfo = getProcessControlDisplay(controlDate);
		return {
			kind: 'process',
			rawTag,
			lowerTag: lower,
			emoji: controlInfo.icon,
			labelText: controlInfo.displayText,
			status: controlInfo.status,
			dateStr: controlDate || '',
			lineText
		};
	}

	// 6. Dışarda (#dışarda / #disarda) -> 🚗
	if (lower === '#dışarda' || lower === '#disarda') {
		return {
			kind: 'emoji',
			rawTag,
			lowerTag: lower,
			emoji: '🚗',
			lineText
		};
	}

	// 7. Evde (#evde) -> 🏠
	if (lower === '#evde') {
		return {
			kind: 'emoji',
			rawTag,
			lowerTag: lower,
			emoji: '🏠',
			lineText
		};
	}

	// 7b. 2 Dakikalık Görev (#2dk) -> Checkbox açık sarıdır, emoji gösterilmez (gizlenir)
	if (lower === '#2dk') {
		return {
			kind: 'hidden',
			rawTag,
			lowerTag: lower,
			emoji: '',
			lineText
		};
	}

	// 8. Tomorrow & Weekday Lock Tags (#yarın, #pazartesi..#pazar)
	if (tagWord === 'yarın' || tagWord === 'yarin' || TURKISH_DAYS[tagWord] !== undefined) {
		const labelText = tagWord === 'yarın' || tagWord === 'yarin'
			? 'Yarın'
			: (DAY_DISPLAY_NAMES[TURKISH_DAYS[tagWord]] || tagWord);
		return {
			kind: 'day-lock',
			rawTag,
			lowerTag: lower,
			emoji: '🔒',
			labelText,
			lineText
		};
	}

	// 9. Today (#bugün) -> Soft Yellow Chip "Bugün"
	if (lower === '#bugün' || lower === '#bugun') {
		return {
			kind: 'today',
			rawTag,
			lowerTag: lower,
			emoji: '',
			labelText: 'Bugün',
			lineText
		};
	}

	// 10. Yesterday (#dün) -> ⏳
	if (lower === '#dün' || lower === '#dun') {
		return {
			kind: 'emoji',
			rawTag,
			lowerTag: lower,
			emoji: '⏳',
			lineText
		};
	}

	// 11. Tree Lock (#kilitli) -> Hidden tag (no emoji, row line is dimmed)
	if (lower === '#kilitli') {
		return {
			kind: 'kilitli',
			rawTag,
			lowerTag: lower,
			emoji: '',
			lineText
		};
	}

	// 12. Explicit Unlock (#kilitsiz) -> hidden
	if (lower === '#kilitsiz') {
		return {
			kind: 'hidden',
			rawTag,
			lowerTag: lower,
			emoji: '',
			lineText
		};
	}

	// 13. Configured custom tags from settings (#2dk, #sonra, user-added tags)
	if (customTagEmojiMap && customTagEmojiMap.has(lower)) {
		const emoji = customTagEmojiMap.get(lower) ?? '';
		if (!emoji) {
			return {
				kind: 'hidden',
				rawTag,
				lowerTag: lower,
				emoji: '',
				lineText
			};
		}
		return {
			kind: 'emoji',
			rawTag,
			lowerTag: lower,
			emoji,
			lineText
		};
	}

	return null;
}

export function isChipVisual(visual?: ResolvedTagVisual | null): boolean {
	if (!visual) return false;
	return visual.kind === 'deadline' ||
		visual.kind === 'routine' ||
		visual.kind === 'process' ||
		visual.kind === 'yakinda' ||
		visual.kind === 'day-lock' ||
		visual.kind === 'question' ||
		visual.kind === 'today' ||
		visual.kind === 'timer';
}

export interface TagDOMHandlers {
	isUnlocked?: boolean;
	onProcessClick?: (el: HTMLElement, e: MouseEvent) => void;
	onDeadlineClick?: (el: HTMLElement, e: MouseEvent, currentDateStr: string) => void;
	onKilitliClick?: (el: HTMLElement, e: MouseEvent) => void;
	onQuestionClick?: (el: HTMLElement, e: MouseEvent, currentQuestionText: string) => void;
}

/**
 * Shared DOM renderer used by both Live Preview and Reading View.
 */
export function createResolvedTagDOM(
	visual: ResolvedTagVisual,
	handlers: TagDOMHandlers = {}
): HTMLElement {
	if (visual.kind === 'timer' && visual.timerMinutes) {
		return createTimerChipElement(visual.lineText || visual.rawTag, visual.timerMinutes);
	}

	const span = document.createElement('span');

	if (visual.kind === 'hidden' || visual.kind === 'urgent' || visual.kind === 'kilitli') {
		span.className = 'dash-drop-hidden-tag';
		span.dataset.tag = visual.lowerTag;
		return span;
	}

	if (visual.kind === 'today') {
		span.className = 'dash-drop-date-lock-tag dash-drop-today-chip status-today';
		span.innerHTML = `<span class="dash-drop-date-text">Bugün</span>`;
		span.title = '☀️ Bugün yapılacak görev';
		return span;
	}

	if (visual.kind === 'question') {
		span.className = 'dash-drop-date-lock-tag dash-drop-question-chip';
		const label = visual.labelText || '? soru';
		span.innerHTML = `<span class="dash-drop-date-text">${label}</span>`;
		span.title = visual.questionText ? `Soru: ${visual.questionText} • Tıkla: Düzenle` : 'Soru Görevi • Tıkla: Düzenle';
		if (handlers.onQuestionClick) {
			span.addEventListener('click', (e: MouseEvent) => {
				e.preventDefault();
				e.stopPropagation();
				handlers.onQuestionClick!(span, e, visual.questionText || '');
			});
		}
		return span;
	}

	if (visual.kind === 'routine') {
		span.className = 'dash-drop-date-lock-tag dash-drop-routine-tag';
		const label = visual.labelText || '1. Tekrar';
		span.innerHTML = `<span class="dash-drop-date-text">${label}</span>`;
		span.title = `${label} • Her tamamlamada sayaç 1 artar; gün devrinde sayaç korunur`;
		return span;
	}

	if (visual.kind === 'yakinda') {
		span.className = 'dash-drop-date-lock-tag dash-drop-yakinda-tag';
		span.innerHTML = `<span class="mytasks-chip-icon">${LUCIDE_CLOCK_SVG}</span><span class="dash-drop-date-text">Yakında</span>`;
		span.title = '🔜 Yakında Yapılacak';
		return span;
	}

	if (visual.kind === 'process') {
		const iconSvg = visual.emoji === 'eye-off' ? LUCIDE_EYE_OFF_SVG : LUCIDE_EYE_SVG;
		span.className = `dash-drop-date-lock-tag dash-drop-process-tag status-${visual.status || 'pending'}`;
		if (visual.labelText) {
			span.innerHTML = `<span class="mytasks-chip-icon">${iconSvg}</span><span class="dash-drop-date-text">${visual.labelText}</span>`;
			span.title = `Son Kontrol: ${visual.labelText} • Tıkla: Şimdi Yeniden Kontrol Et`;
		} else {
			span.innerHTML = `<span class="mytasks-chip-icon">${iconSvg}</span>`;
			span.title = 'Kontrol Edilmedi • Tıkla: Şimdi Kontrol Et';
		}
		if (handlers.onProcessClick) {
			span.addEventListener('click', (e: MouseEvent) => {
				e.preventDefault();
				e.stopPropagation();
				handlers.onProcessClick!(span, e);
			});
		}
		return span;
	}

	if (visual.kind === 'deadline' && visual.labelText) {
		span.className = `dash-drop-date-lock-tag dash-drop-deadline-tag status-deadline-red status-${visual.status || 'upcoming'}`;
		span.innerHTML = `<span class="mytasks-chip-icon">${LUCIDE_FLAG_SVG}</span><span class="dash-drop-date-text">${visual.labelText}</span>`;
		span.title = `Deadline: ${visual.dateStr || ''} (${visual.labelText}) • Tıkla: Tarihi Değiştir`;
		if (handlers.onDeadlineClick) {
			span.addEventListener('click', (e: MouseEvent) => {
				e.preventDefault();
				e.stopPropagation();
				handlers.onDeadlineClick!(span, e, visual.dateStr || '');
			});
		}
		return span;
	}

	if (visual.kind === 'day-lock' && visual.labelText) {
		span.className = 'dash-drop-date-lock-tag mytasks-day-lock-tag';
		span.innerHTML = `<span class="mytasks-chip-icon">${LUCIDE_LOCK_SVG}</span><span class="dash-drop-date-text">${visual.labelText}</span>`;
		span.title = `🔒 ${visual.labelText}`;
		return span;
	}

	span.className = 'dash-drop-emoji-tag';
	span.textContent = visual.emoji;
	span.title = visual.rawTag;
	return span;
}

/**
 * Sorts task prefix visuals according to the strict priority rule:
 * 1. #2dk (⚡) comes first
 * 2. #acil (⚠️) comes second
 * 3. Other pure emojis (🚗, 🏠, ☀️, ⏳, ❓, 🔒 etc.) come third
 * 4. Chips (deadline, routine, process, yakında, day-lock, timer chips) come last
 */
export function sortTaskVisualsForPrefix(visuals: ResolvedTagVisual[]): ResolvedTagVisual[] {
	return [...visuals].sort((a, b) => {
		const getOrder = (v: ResolvedTagVisual): number => {
			const lower = v.lowerTag || v.rawTag.toLowerCase();
			if (lower === '#2dk') return 1;
			if (v.kind === 'urgent' || lower === '#acil') return 2;
			if (!isChipVisual(v)) return 3;
			return 4;
		};
		return getOrder(a) - getOrder(b);
	});
}

