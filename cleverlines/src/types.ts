import { Editor, EditorPosition, TFile } from 'obsidian';

export interface TagItem {
	tag: string;
	emoji: string;
	label: string;
	displayTitle?: string;
	category?: 'root' | 'days' | 'tur';
	isAction?: boolean;
	keepOpen?: boolean;
	isBackButton?: boolean;
	isSubmenuTrigger?: boolean;
	action?: (editor: Editor, start: EditorPosition, end: EditorPosition) => void;
}

export interface MyTasksSettings {
	tags: TagItem[];
	aggregatorNote: string;
	autoRollover: boolean;
	lockFutureTasks: boolean;
	lastRolloverDate: string;
	tagUsageCounts?: Record<string, number>;
	boardOpenGroups?: Record<string, boolean>;
	boardGroupOrder?: string[];
	dropdownCategoryMode?: 'nested' | 'flat';
	showDaysDropdown?: boolean;
	showTurDropdown?: boolean;
	tagCategories?: Record<string, 'root' | 'days' | 'tur'>;
}

export type DateCategory = 'today' | 'yesterday' | 'older' | 'tomorrow' | 'future' | 'none';

export interface TaskDateInfo {
	category: DateCategory;
	isLocked: boolean;
	badgeLabel: string;
	dayName?: string;
}

export interface TaskRecord {
	id: string;
	file: TFile;
	lineNo: number;
	text: string;
	completed: boolean;
	tags: string[];
	originalLine: string;
	dateInfo: TaskDateInfo;
	isBullet?: boolean;
}

export const TURKISH_DAYS: Record<string, number> = {
	'pazar': 0,
	'pazartesi': 1,
	'salı': 2,
	'sali': 2,
	'çarşamba': 3,
	'carsamba': 3,
	'perşembe': 4,
	'persembe': 4,
	'cuma': 5,
	'cumartesi': 6
};

export const DAY_DISPLAY_NAMES: Record<number, string> = {
	0: 'Pazar',
	1: 'Pazartesi',
	2: 'Salı',
	3: 'Çarşamba',
	4: 'Perşembe',
	5: 'Cuma',
	6: 'Cumartesi'
};

export const TURKISH_MONTHS: string[] = [
	'Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran',
	'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık'
];

export const TURKISH_WEEKDAYS_SHORT: string[] = ['Pt', 'Sa', 'Ça', 'Pe', 'Cu', 'Ct', 'Pz'];

export const DAY_TAGS_SET = new Set([
	'#bugün', '#bugun',
	'#dün', '#dun',
	'#yarın', '#yarin',
	'#pazartesi',
	'#salı', '#sali',
	'#çarşamba', '#carsamba',
	'#perşembe', '#persembe',
	'#cuma',
	'#cumartesi',
	'#pazar'
]);

export const TUR_TAGS_SET = new Set([
	'#süreç', '#surec',
	'#tekrar', '#rutin',
	'#yakında', '#yakinda',
	'#dışarda', '#disarda',
	'#evde',
	'#sonra',
	'#kilitli',
	'#kilitsiz'
]);

/**
 * Red warning triangle with white exclamation mark SVG for #acil
 */
export const URGENT_TRIANGLE_SVG = `<svg class="mytasks-urgent-svg" viewBox="0 0 24 24" width="1.15em" height="1.15em" aria-hidden="true"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" fill="#ef4444" stroke="#dc2626" stroke-width="1.5" stroke-linejoin="round"/><line x1="12" y1="8.8" x2="12" y2="13.6" stroke="#ffffff" stroke-width="2.4" stroke-linecap="round"/><circle cx="12" cy="17.2" r="1.35" fill="#ffffff"/></svg>`;

export const LUCIDE_FLAG_SVG = `<svg class="mytasks-lucide-svg" viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/><line x1="4" x2="4" y1="22" y2="15"/></svg>`;

export const LUCIDE_CALENDAR_SVG = `<svg class="mytasks-lucide-svg" viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect width="18" height="18" x="3" y="4" rx="2" ry="2"/><line x1="16" x2="16" y1="2" y2="6"/><line x1="8" x2="8" y1="2" y2="6"/><line x1="3" x2="21" y1="10" y2="10"/></svg>`;

export const LUCIDE_REPEAT_SVG = `<svg class="mytasks-lucide-svg" viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m17 2 4 4-4 4"/><path d="M3 11v-1a4 4 0 0 1 4-4h14"/><path d="m7 22-4-4 4-4"/><path d="M21 13v1a4 4 0 0 1-4 4H3"/></svg>`;

export const LUCIDE_EYE_SVG = `<svg class="mytasks-lucide-svg" viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/></svg>`;

export const LUCIDE_EYE_OFF_SVG = `<svg class="mytasks-lucide-svg" viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9.88 9.88a3 3 0 1 0 4.24 4.24"/><path d="M10.73 5.08A10.43 10.43 0 0 1 12 5c7 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68"/><path d="M6.61 6.61A13.526 13.526 0 0 0 2 12s3 7 10 7a9.74 9.74 0 0 0 5.39-1.61"/><line x1="2" x2="22" y1="2" y2="22"/></svg>`;

export const LUCIDE_CLOCK_SVG = `<svg class="mytasks-lucide-svg" viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>`;

export const LUCIDE_TIMER_SVG = `<svg class="mytasks-lucide-svg" viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="10" x2="14" y1="2" y2="2"/><line x1="12" x2="15" y1="14" y2="11"/><circle cx="12" cy="14" r="8"/></svg>`;

export const LUCIDE_HELP_CIRCLE_SVG = `<svg class="mytasks-lucide-svg" viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><path d="M12 17h.01"/></svg>`;

export const LUCIDE_LOCK_SVG = `<svg class="mytasks-lucide-svg" viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect width="18" height="11" x="3" y="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>`;

export const LUCIDE_CHEVRONS_UP_DOWN_SVG = `<svg class="mytasks-lucide-svg" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m7 15 5 5 5-5"/><path d="m7 9 5-5 5 5"/></svg>`;

export const LUCIDE_REFRESH_CW_SVG = `<svg class="mytasks-lucide-svg" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/><path d="M8 16H3v5"/></svg>`;

export function createUrgentIconSpan(extraClass: string = ''): HTMLSpanElement {
	const span = document.createElement('span');
	span.className = `dash-drop-emoji-tag mytasks-urgent-icon ${extraClass}`.trim();
	span.innerHTML = URGENT_TRIANGLE_SVG;
	span.title = '#acil';
	return span;
}

export const DEFAULT_SETTINGS: MyTasksSettings = {
	aggregatorNote: 'TÜM GÖREVLER',
	autoRollover: true,
	lockFutureTasks: true,
	lastRolloverDate: '',
	dropdownCategoryMode: 'nested',
	showDaysDropdown: true,
	showTurDropdown: true,
	tagCategories: {},
	tagUsageCounts: {
		'#bugün': 100,
		'#yarın': 90,
		'#deadline': 80,
		'#tekrar': 75,
		'#rutin': 75,
		'#süreç': 70,
		'#acil': 65,
		'#yakında': 60,
		'#2dk': 50,
		'#dışarda': 45,
		'#evde': 45,
		'#sonra': 40,
		'#kilitli': 30,
		'#kilitsiz': 20,
		'#dün': 15
	},
	tags: [
		{ tag: '#bugün', emoji: '☀️', label: 'Bugün Yapılacak' },
		{ tag: '#dün', emoji: '⏳', label: 'Dünden Kalan' },
		{ tag: '#yarın', emoji: '🔒', label: 'Yarın' },
		{ tag: '#pazartesi', emoji: '🔒', label: 'Pazartesi' },
		{ tag: '#salı', emoji: '🔒', label: 'Salı' },
		{ tag: '#çarşamba', emoji: '🔒', label: 'Çarşamba' },
		{ tag: '#perşembe', emoji: '🔒', label: 'Perşembe' },
		{ tag: '#cuma', emoji: '🔒', label: 'Cuma' },
		{ tag: '#cumartesi', emoji: '🔒', label: 'Cumartesi' },
		{ tag: '#pazar', emoji: '🔒', label: 'Pazar' },
		{ tag: '#acil', emoji: '', label: 'Acil (Blok Başında Sıralanır)' },
		{ tag: '#yakında', emoji: '🔜', label: 'Yakında Yapılacak' },
		{ tag: '#2dk', emoji: '', label: '2 Dakikalık (Blok Sonunda Sıralanır)' },
		{ tag: '#dışarda', emoji: '🚗', label: 'Dışarda Yapılacak' },
		{ tag: '#evde', emoji: '🏠', label: 'Evde Yapılacak' },
		{ tag: '#sonra', emoji: '🕒', label: 'Sonraya Bırak' },
		{ tag: '#kilitli', emoji: '', label: 'Kilitli Ağaç' },
		{ tag: '#kilitsiz', emoji: '', label: 'Kilitsiz / Açık' },
		{ tag: '#deadline', emoji: '⏳', label: 'Bitiş Tarihi (Deadline)' },
		{ tag: '#tekrar', emoji: '🔄', label: 'Günlük Tekrar (Sayaç Korunur)' },
		{ tag: '#süreç', emoji: '👁️', label: 'Süreç & Takip (Son Kontrol Sayacı)' }
	]
};
