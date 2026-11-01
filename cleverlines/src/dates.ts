import {
	DAY_DISPLAY_NAMES,
	TaskDateInfo,
	TURKISH_DAYS
} from './types';

export function formatIsoDate(d: Date): string {
	const year = d.getFullYear();
	const month = String(d.getMonth() + 1).padStart(2, '0');
	const day = String(d.getDate()).padStart(2, '0');
	return `${year}-${month}-${day}`;
}

export function formatDmyDate(d: Date): string {
	const year = d.getFullYear();
	const month = String(d.getMonth() + 1).padStart(2, '0');
	const day = String(d.getDate()).padStart(2, '0');
	return `${day}.${month}.${year}`;
}

export function parseDateString(str: string): Date | null {
	if (!str) return null;
	const isoMatch = str.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
	if (isoMatch) {
		return new Date(parseInt(isoMatch[1], 10), parseInt(isoMatch[2], 10) - 1, parseInt(isoMatch[3], 10));
	}
	const dmyMatch = str.match(/^(\d{1,2})[-.](\d{1,2})[-.](\d{4})$/);
	if (dmyMatch) {
		return new Date(parseInt(dmyMatch[3], 10), parseInt(dmyMatch[2], 10) - 1, parseInt(dmyMatch[1], 10));
	}
	return null;
}

export function getDeadlineDisplay(dateStr: string): {
	daysDiff: number;
	displayText: string;
	status: 'today' | 'tomorrow' | 'upcoming' | 'overdue';
	icon: string;
	formattedDate: string;
} {
	const target = parseDateString(dateStr);
	if (!target) {
		return {
			daysDiff: 0,
			displayText: dateStr,
			status: 'upcoming',
			icon: '📅',
			formattedDate: dateStr
		};
	}

	const now = new Date();
	const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
	const targetTime = new Date(target.getFullYear(), target.getMonth(), target.getDate()).getTime();
	const oneDayMs = 24 * 60 * 60 * 1000;
	const diffDays = Math.round((targetTime - today) / oneDayMs);

	if (diffDays < 0) {
		const absDiff = Math.abs(diffDays);
		return {
			daysDiff: diffDays,
			displayText: `-${absDiff}g`,
			status: 'overdue',
			icon: '',
			formattedDate: formatIsoDate(target)
		};
	} else if (diffDays === 0) {
		return {
			daysDiff: 0,
			displayText: '0g',
			status: 'today',
			icon: '',
			formattedDate: formatIsoDate(target)
		};
	} else {
		return {
			daysDiff: diffDays,
			displayText: `${diffDays}g`,
			status: diffDays === 1 ? 'tomorrow' : 'upcoming',
			icon: '',
			formattedDate: formatIsoDate(target)
		};
	}
}

/**
 * Checks whether a deadline date string has 3 or fewer days remaining (daysDiff <= 3, i.e. 3 days left, today, or overdue).
 */
export function isUrgentDeadline(dateStr: string): boolean {
	const info = getDeadlineDisplay(dateStr);
	return info.daysDiff <= 3;
}

/**
 * Automatically appends #acil to a line if it contains a #deadline/<date> with <= 3 days remaining
 * and does not already have #acil.
 */
export function ensureUrgentTagForShortDeadline(lineText: string): string {
	const dlMatch = lineText.match(/#deadline[\/:]([0-9]{4}-[0-9]{2}-[0-9]{2})\b/i);
	if (!dlMatch) return lineText;
	if (!isUrgentDeadline(dlMatch[1])) return lineText;
	if (/(?:^|\s)#acil\b/i.test(lineText)) return lineText;
	const trimmed = lineText.replace(/\s+$/, '');
	const trailingSpace = lineText.endsWith(' ') ? ' ' : '';
	return `${trimmed} #acil${trailingSpace}`;
}

export function parseDateTimeString(str: string): { date: Date; hasTime: boolean } | null {
	if (!str) return null;
	// Match YYYY-MM-DD-HH-mm or YYYY-MM-DDTHH:mm or YYYY-MM-DD_HH:mm or YYYY-MM-DD-HH:mm
	const dtMatch = str.match(/^(\d{4})-(\d{1,2})-(\d{1,2})[T_\-\s](\d{1,2})[:\-](\d{1,2})$/);
	if (dtMatch) {
		return {
			date: new Date(
				parseInt(dtMatch[1], 10),
				parseInt(dtMatch[2], 10) - 1,
				parseInt(dtMatch[3], 10),
				parseInt(dtMatch[4], 10),
				parseInt(dtMatch[5], 10)
			),
			hasTime: true
		};
	}
	const dOnly = parseDateString(str);
	if (dOnly) {
		return { date: dOnly, hasTime: false };
	}
	return null;
}

export function formatControlTimestamp(d: Date = new Date()): string {
	const year = d.getFullYear();
	const month = String(d.getMonth() + 1).padStart(2, '0');
	const day = String(d.getDate()).padStart(2, '0');
	const hours = String(d.getHours()).padStart(2, '0');
	const minutes = String(d.getMinutes()).padStart(2, '0');
	return `${year}-${month}-${day}-${hours}-${minutes}`;
}

export function getProcessControlDisplay(controlDateStr?: string, customNow?: Date): {
	daysDiff: number;
	displayText: string;
	status: 'today' | 'yesterday' | 'warning' | 'pending';
	icon: 'eye' | 'eye-off';
	formattedDate?: string;
} {
	if (!controlDateStr) {
		return {
			daysDiff: -1,
			displayText: '',
			status: 'pending',
			icon: 'eye-off'
		};
	}

	const parsed = parseDateTimeString(controlDateStr);
	if (!parsed) {
		return {
			daysDiff: -1,
			displayText: '',
			status: 'pending',
			icon: 'eye-off'
		};
	}

	const now = customNow || new Date();
	const target = parsed.date;
	const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
	const targetDayStart = new Date(target.getFullYear(), target.getMonth(), target.getDate()).getTime();
	const oneDayMs = 24 * 60 * 60 * 1000;
	const diffDays = Math.round((todayStart - targetDayStart) / oneDayMs);

	if (diffDays <= 0) {
		const hh = String(target.getHours()).padStart(2, '0');
		const mm = String(target.getMinutes()).padStart(2, '0');
		const timeText = parsed.hasTime ? `${hh}:${mm}` : 'bugün';
		return {
			daysDiff: 0,
			displayText: timeText,
			status: 'today',
			icon: 'eye',
			formattedDate: formatIsoDate(target)
		};
	} else if (diffDays === 1) {
		return {
			daysDiff: 1,
			displayText: 'dün',
			status: 'yesterday',
			icon: 'eye',
			formattedDate: formatIsoDate(target)
		};
	} else {
		return {
			daysDiff: diffDays,
			displayText: `${diffDays}g`,
			status: 'warning',
			icon: 'eye',
			formattedDate: formatIsoDate(target)
		};
	}
}

export function evaluateTaskDate(text: string, tags: string[], fileMtime: number): TaskDateInfo {
	const now = new Date();
	const todayDay = now.getDay();
	const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
	const oneDayMs = 24 * 60 * 60 * 1000;
	const startOfYesterday = startOfToday - oneDayMs;

	// 0. Explicit Deadline format (#deadline/YYYY-MM-DD or #deadline:YYYY-MM-DD)
	const deadlineMatch = text.match(/#deadline[\/:]([0-9]{4}-[0-9]{2}-[0-9]{2})\b/i);
	if (deadlineMatch) {
		const targetDate = new Date(deadlineMatch[1] + 'T00:00:00').getTime();
		const dlInfo = getDeadlineDisplay(deadlineMatch[1]);
		if (targetDate < startOfYesterday) {
			return { category: 'older', isLocked: false, badgeLabel: dlInfo.displayText };
		} else if (targetDate < startOfToday) {
			return { category: 'yesterday', isLocked: false, badgeLabel: dlInfo.displayText };
		} else if (targetDate === startOfToday) {
			return { category: 'today', isLocked: false, badgeLabel: dlInfo.displayText };
		} else if (targetDate === startOfToday + oneDayMs) {
			return { category: 'tomorrow', isLocked: false, badgeLabel: dlInfo.displayText };
		} else {
			return { category: 'future', isLocked: false, badgeLabel: dlInfo.displayText };
		}
	}

	const lowerTags = tags.map(t => t.toLowerCase().replace(/^#/, ''));

	// 1. Explicit date format (e.g. 2026-10-18 or 📅 2026-10-18)
	const dateMatch = text.match(/(?:📅\s*|☀️\s*|due:\s*|#)?(\d{4}-\d{2}-\d{2})\b/);
	if (dateMatch) {
		const targetDate = new Date(dateMatch[1] + 'T00:00:00').getTime();
		if (targetDate < startOfYesterday) {
			return { category: 'older', isLocked: false, badgeLabel: `Geçmiş (${dateMatch[1]})` };
		} else if (targetDate < startOfToday) {
			return { category: 'yesterday', isLocked: false, badgeLabel: 'Dün' };
		} else if (targetDate === startOfToday) {
			return { category: 'today', isLocked: false, badgeLabel: 'Bugün' };
		} else if (targetDate === startOfToday + oneDayMs) {
			return { category: 'tomorrow', isLocked: true, badgeLabel: 'Yarın' };
		} else {
			return { category: 'future', isLocked: true, badgeLabel: `İleri Tarih (${dateMatch[1]})` };
		}
	}

	// 2. Relative Bornline Tags: #bugün, #dün, #yarın
	if (lowerTags.includes('bugün') || lowerTags.includes('bugun')) {
		return { category: 'today', isLocked: false, badgeLabel: 'Bugün' };
	}

	if (lowerTags.includes('dün') || lowerTags.includes('dun')) {
		if (fileMtime && fileMtime < startOfYesterday) {
			return { category: 'older', isLocked: false, badgeLabel: 'Dünden Eski' };
		}
		return { category: 'yesterday', isLocked: false, badgeLabel: 'Dün' };
	}

	if (lowerTags.includes('yarın') || lowerTags.includes('yarin')) {
		return { category: 'tomorrow', isLocked: true, badgeLabel: 'Yarın' };
	}

	// 3. Day of week tags: #pazartesi, #salı, etc.
	for (const tag of lowerTags) {
		if (TURKISH_DAYS[tag] !== undefined) {
			const targetDay = TURKISH_DAYS[tag];
			const dayDisplayName = DAY_DISPLAY_NAMES[targetDay];

			let daysDiff = targetDay - todayDay;
			if (daysDiff <= 0) {
				daysDiff += 7; // If same day as today, it means next week!
			}

			if (daysDiff === 1) {
				return { category: 'tomorrow', isLocked: true, badgeLabel: 'Yarın', dayName: tag };
			} else if (daysDiff === 7) {
				return { category: 'future', isLocked: true, badgeLabel: `Haftaya ${dayDisplayName}`, dayName: tag };
			} else {
				return { category: 'future', isLocked: true, badgeLabel: dayDisplayName, dayName: tag };
			}
		}
	}

	return { category: 'none', isLocked: false, badgeLabel: '' };
}
