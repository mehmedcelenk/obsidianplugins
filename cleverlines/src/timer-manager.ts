import { LUCIDE_TIMER_SVG } from './types';

export type TaskTimerStatus = 'idle' | 'running' | 'paused' | 'completed';

export interface TaskTimerState {
	key: string;
	minutes: number;
	totalSeconds: number;
	remainingSeconds: number;
	status: TaskTimerStatus;
}

const timers = new Map<string, TaskTimerState>();
const mountedElements = new Map<string, Set<HTMLElement>>();
let globalInterval: ReturnType<typeof setInterval> | null = null;
const STORAGE_KEY = 'mytasks_active_timers';

/**
 * Parses #<N>dk and #<N>dksonra timer tags.
 * Example: "#120dk" -> 120, "#2dksonra" -> 2, "#2dk" -> null (plain #2dk is the quick task category tag).
 */
export function parseTimerMinutes(tag: string): number | null {
	const clean = tag.trim().toLowerCase();
	const match = clean.match(/^#?(\d+)dk(?:sonra)?$/i);
	if (!match) return null;
	const mins = parseInt(match[1], 10);
	if (isNaN(mins) || mins <= 0) return null;
	// Plain '#2dk' is the quick 2-minute task category tag; '#2dksonra' is an explicit countdown timer!
	if (mins === 2 && !clean.includes('sonra')) return null;
	return mins;
}

export function buildTimerKey(lineText: string, minutes: number): string {
	const cleanLine = lineText
		.replace(/^(\s*(?:[-*+•]|\d+[.)])\s*\[[ xX/]?\]\s*)/, '')
		.replace(/#[a-zA-Z0-9_\u00C0-\u017F\u0400-\u04FF\-\/:]+/g, '')
		.trim()
		.toLowerCase();
	return `${cleanLine || 'task'}::${minutes}dk`;
}

export function formatTimerSeconds(totalSeconds: number): string {
	const clamped = Math.max(0, Math.floor(totalSeconds));
	const m = Math.floor(clamped / 60);
	const s = clamped % 60;
	const mm = m < 10 ? `0${m}` : `${m}`;
	const ss = s < 10 ? `0${s}` : `${s}`;
	return `${mm}:${ss}`;
}

export function getOrCreateTimer(key: string, minutes: number): TaskTimerState {
	let state = timers.get(key);
	if (!state || state.minutes !== minutes) {
		state = {
			key,
			minutes,
			totalSeconds: minutes * 60,
			remainingSeconds: minutes * 60,
			status: 'idle'
		};
		timers.set(key, state);
	}
	return state;
}

const changeCallbacks = new Set<() => void>();
const completeCallbacks = new Set<(state: TaskTimerState) => void>();

function notifyChangeCallbacks() {
	for (const cb of changeCallbacks) {
		try {
			cb();
		} catch (e) {
			console.error('MyTasks: Error in timer change callback', e);
		}
	}
}

function notifyCompleteCallbacks(state: TaskTimerState) {
	for (const cb of completeCallbacks) {
		try {
			cb(state);
		} catch (e) {
			console.error('MyTasks: Error in timer complete callback', e);
		}
	}
}

export function registerTimerChangeCallback(cb: () => void) {
	changeCallbacks.add(cb);
}

export function unregisterTimerChangeCallback(cb: () => void) {
	changeCallbacks.delete(cb);
}

export function registerTimerCompleteCallback(cb: (state: TaskTimerState) => void) {
	completeCallbacks.add(cb);
}

export function unregisterTimerCompleteCallback(cb: (state: TaskTimerState) => void) {
	completeCallbacks.delete(cb);
}

/**
 * Plays a very soft, minimal two-note chime using Web Audio API when a timer finishes.
 * Safe in headless/Node test environments (no-op if AudioContext is unavailable).
 */
export function playSoftTimerChime() {
	try {
		if (typeof window === 'undefined') return;
		const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
		if (!AudioCtx) return;

		const ctx = new AudioCtx();
		const now = ctx.currentTime;

		// Soft two-tone chime (C5 -> E5) at low volume (0.08 gain)
		const freqs = [523.25, 659.25];
		freqs.forEach((freq, idx) => {
			const osc = ctx.createOscillator();
			const gain = ctx.createGain();
			osc.type = 'sine';
			osc.frequency.setValueAtTime(freq, now + idx * 0.14);

			gain.gain.setValueAtTime(0.0001, now + idx * 0.14);
			gain.gain.exponentialRampToValueAtTime(0.08, now + idx * 0.14 + 0.02);
			gain.gain.exponentialRampToValueAtTime(0.0001, now + idx * 0.14 + 0.35);

			osc.connect(gain);
			gain.connect(ctx.destination);
			osc.start(now + idx * 0.14);
			osc.stop(now + idx * 0.14 + 0.36);
		});

		setTimeout(() => {
			ctx.close().catch(() => {});
		}, 900);
	} catch (e) {
		// Ignore audio errors
	}
}

export function getActiveRunningTimers(): TaskTimerState[] {
	const list: TaskTimerState[] = [];
	for (const state of timers.values()) {
		if (state.status === 'running' || state.status === 'paused') {
			list.push(state);
		}
	}
	return list;
}

function renderTimerElementContent(el: HTMLElement, state: TaskTimerState) {
	el.className = `dash-drop-date-lock-tag dash-drop-timer-tag status-${state.status}`;

	const timeStr = formatTimerSeconds(state.remainingSeconds);
	if (state.status === 'completed') {
		el.innerHTML = `<span class="mytasks-chip-icon">${LUCIDE_TIMER_SVG}</span><span class="dash-drop-date-text">kafi</span>`;
		el.title = `Süre tamamlandı (${state.minutes} dk) • Tıkla: Yeniden Başlat`;
	} else if (state.status === 'running') {
		el.innerHTML = `<span class="mytasks-chip-icon">${LUCIDE_TIMER_SVG}</span><span class="dash-drop-date-text">${timeStr}</span>`;
		el.title = `Geri sayım çalışıyor (${timeStr}) • Tıkla: Duraklat`;
	} else if (state.status === 'paused') {
		el.innerHTML = `<span class="mytasks-chip-icon">${LUCIDE_TIMER_SVG}</span><span class="dash-drop-date-text">${timeStr}</span>`;
		el.title = `Duraklatıldı (${timeStr}) • Tıkla: Devam Et`;
	} else {
		el.innerHTML = `<span class="mytasks-chip-icon">${LUCIDE_TIMER_SVG}</span><span class="dash-drop-date-text">${timeStr}</span>`;
		el.title = `${state.minutes} dk zamanlayıcı • Tıkla: Başlat`;
	}
	el.setAttribute('aria-label', el.title);
	el.setAttribute('aria-pressed', String(state.status === 'running'));
}

export function saveTimersToStorage() {
	try {
		if (typeof window === 'undefined' || !window.localStorage) return;
		const list: TaskTimerState[] = [];
		for (const state of timers.values()) {
			if (state.status === 'running' || state.status === 'paused') {
				list.push({
					key: state.key,
					minutes: state.minutes,
					totalSeconds: state.totalSeconds,
					remainingSeconds: state.remainingSeconds,
					status: 'paused' // Saved as paused so Obsidian doesn't run automatically on startup!
				});
			}
		}
		window.localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
	} catch (e) {
		console.error('MyTasks: Error saving timers to storage', e);
	}
}

export function loadTimersFromStorage() {
	try {
		if (typeof window === 'undefined' || !window.localStorage) return;
		const raw = window.localStorage.getItem(STORAGE_KEY);
		if (!raw) return;
		const list = JSON.parse(raw);
		if (Array.isArray(list)) {
			for (const item of list) {
				if (item && item.key && item.remainingSeconds > 0) {
					timers.set(item.key, {
						key: item.key,
						minutes: item.minutes,
						totalSeconds: item.totalSeconds || item.minutes * 60,
						remainingSeconds: item.remainingSeconds,
						status: 'paused' // Memory preserved, paused!
					});
				}
			}
			notifyChangeCallbacks();
		}
	} catch (e) {
		console.error('MyTasks: Error loading timers from storage', e);
	}
}

function pruneDisconnectedElements(set: Set<HTMLElement>) {
	for (const el of Array.from(set)) {
		if (el.isConnected === false) {
			set.delete(el);
		}
	}
}

function notifySubscribers(key: string) {
	const state = timers.get(key);
	const set = mountedElements.get(key);
	if (set && state) {
		for (const el of Array.from(set)) {
			if (el.isConnected === false && set.size > 1) {
				set.delete(el);
				continue;
			}
			renderTimerElementContent(el, state);
		}
	}
	notifyChangeCallbacks();
}

function ensureGlobalInterval() {
	if (globalInterval !== null) return;

	globalInterval = setInterval(() => {
		let anyRunning = false;

		for (const [key, state] of timers.entries()) {
			if (state.status === 'running') {
				anyRunning = true;
				state.remainingSeconds = Math.max(0, state.remainingSeconds - 1);

				if (state.remainingSeconds <= 0) {
					state.remainingSeconds = 0;
					state.status = 'completed';
					playSoftTimerChime();
					notifySubscribers(key);
					notifyCompleteCallbacks(state);
					saveTimersToStorage();
				} else {
					notifySubscribers(key);
					if (state.remainingSeconds % 5 === 0) {
						saveTimersToStorage();
					}
				}
			}
		}

		if (!anyRunning && globalInterval !== null) {
			clearInterval(globalInterval);
			globalInterval = null;
		}
	}, 1000);
}

export function toggleTaskTimer(key: string, minutes: number): TaskTimerState {
	const state = getOrCreateTimer(key, minutes);

	if (state.status === 'idle') {
		state.status = 'running';
		ensureGlobalInterval();
	} else if (state.status === 'running') {
		state.status = 'paused';
	} else if (state.status === 'paused') {
		state.status = 'running';
		ensureGlobalInterval();
	} else if (state.status === 'completed') {
		state.remainingSeconds = state.totalSeconds;
		state.status = 'running';
		ensureGlobalInterval();
	}

	saveTimersToStorage();
	notifySubscribers(key);
	return state;
}

export function createTimerChipElement(lineText: string, minutes: number): HTMLButtonElement {
	const key = buildTimerKey(lineText, minutes);
	const state = getOrCreateTimer(key, minutes);

	const button = document.createElement('button');
	button.type = 'button';
	renderTimerElementContent(button, state);

	let set = mountedElements.get(key);
	if (!set) {
		set = new Set();
		mountedElements.set(key, set);
	} else {
		pruneDisconnectedElements(set);
	}
	set.add(button);

	button.addEventListener('click', (e: MouseEvent) => {
		e.preventDefault();
		e.stopPropagation();
		toggleTaskTimer(key, minutes);
	});

	return button;
}

export function stopAllTaskTimers() {
	if (globalInterval !== null) {
		clearInterval(globalInterval);
		globalInterval = null;
	}
	saveTimersToStorage();
	for (const state of timers.values()) {
		if (state.status === 'running') {
			state.status = 'paused';
		}
	}
	notifyChangeCallbacks();
}

export function clearAllTimers() {
	if (globalInterval !== null) {
		clearInterval(globalInterval);
		globalInterval = null;
	}
	timers.clear();
	mountedElements.clear();
	changeCallbacks.clear();
	completeCallbacks.clear();
	if (typeof window !== 'undefined' && window.localStorage) {
		window.localStorage.removeItem(STORAGE_KEY);
	}
}
