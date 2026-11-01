import { evaluateTaskDate } from './dates';

export interface TaskLineMeta {
	lineNo: number; // 0-based
	text: string;
	isHeader: boolean;
	headerLevel: number;
	isTask: boolean;
	isList: boolean;
	indent: number;
	checked: boolean;
	hasKilitli: boolean;
	hasKilitsiz: boolean;
}

export interface LineLockInfo {
	isLocked: boolean;
	reason: string;
	lockType: 'tree' | 'future' | 'none';
}

export interface DocumentLockResult {
	lockedLines: Map<number, LineLockInfo>; // lineNo -> lock info
	unlockedKilitliLines: Set<number>;      // lineNo of #kilitli lines whose children are all completed
}

export function parseLineMeta(text: string, lineNo: number): TaskLineMeta {
	const headerMatch = text.match(/^(#{1,6})\s+(.*)$/);
	const taskMatch = text.match(/^(\s*)(?:[-*+•]|\d+[.)])\s*\[([ xX/])] (.*)$/);
	const listMatch = text.match(/^(\s*)(?:[-*+•]|\d+[.)])\s+(.*)$/);

	const hasKilitli = /#kilitli\b/i.test(text);
	const hasKilitsiz = /#kilitsiz\b/i.test(text);

	if (headerMatch) {
		return {
			lineNo,
			text,
			isHeader: true,
			headerLevel: headerMatch[1].length,
			isTask: false,
			isList: false,
			indent: -1,
			checked: false,
			hasKilitli,
			hasKilitsiz
		};
	}

	if (taskMatch) {
		const indent = taskMatch[1].replace(/\t/g, '    ').length;
		const checked = taskMatch[2].toLowerCase() === 'x';
		return {
			lineNo,
			text,
			isHeader: false,
			headerLevel: 0,
			isTask: true,
			isList: true,
			indent,
			checked,
			hasKilitli,
			hasKilitsiz
		};
	}

	if (listMatch) {
		const indent = listMatch[1].replace(/\t/g, '    ').length;
		return {
			lineNo,
			text,
			isHeader: false,
			headerLevel: 0,
			isTask: false,
			isList: true,
			indent,
			checked: false,
			hasKilitli,
			hasKilitsiz
		};
	}

	const indent = (text.match(/^(\s*)/)?.[1] || '').replace(/\t/g, '    ').length;
	return {
		lineNo,
		text,
		isHeader: false,
		headerLevel: 0,
		isTask: false,
		isList: false,
		indent,
		checked: false,
		hasKilitli,
		hasKilitsiz
	};
}

/**
 * Computes lock states for the entire document:
 * 1. Tree locks:
 *    - #kilitli on Header: locks until all tasks in that section are completed.
 *    - #kilitli on List/Todo: locks until all indented child tasks are completed.
 *    - If all child tasks are completed, the parent becomes unlocked.
 *    - Any node with #kilitsiz is explicitly unlocked.
 * 2. Future date locks:
 *    - Uncompleted tasks scheduled for future dates/days are locked unless marked #kilitsiz.
 */
export function computeDocumentLockState(lines: string[], lockFutureTasks: boolean = true): DocumentLockResult {
	const lockedLines = new Map<number, LineLockInfo>();
	const unlockedKilitliLines = new Set<number>();

	const parsedLines: TaskLineMeta[] = [];
	for (let i = 0; i < lines.length; i++) {
		parsedLines.push(parseLineMeta(lines[i], i));
	}

	// 1. Evaluate Tree Locks (#kilitli & #kilitsiz)
	for (let i = 0; i < parsedLines.length; i++) {
		const root = parsedLines[i];
		if (!root.hasKilitli) continue;

		// Explicit #kilitsiz overrides lock on this specific node
		if (root.hasKilitsiz) {
			unlockedKilitliLines.add(i);
			continue;
		}

		const children: TaskLineMeta[] = [];

		if (root.isHeader) {
			for (let j = i + 1; j < parsedLines.length; j++) {
				const next = parsedLines[j];
				if (next.isHeader && next.headerLevel <= root.headerLevel) {
					break;
				}
				children.push(next);
			}
		} else {
			const rootIndent = root.indent >= 0 ? root.indent : 0;
			for (let j = i + 1; j < parsedLines.length; j++) {
				const next = parsedLines[j];
				if (next.text.trim() === '') continue;
				if (next.isHeader) break;
				if (next.indent <= rootIndent) break;
				children.push(next);
			}
		}

		const taskChildren = children.filter(c => c.isTask);

		if (taskChildren.length > 0) {
			// All child tasks must be checked (or have explicit #kilitsiz)
			const allDone = taskChildren.every(c => c.checked || c.hasKilitsiz);
			if (!allDone) {
				const remaining = taskChildren.filter(c => !c.checked && !c.hasKilitsiz).length;
				lockedLines.set(i, {
					isLocked: true,
					reason: `Alt görevler tamamlanmadan bu görev kilitlidir! (${remaining} görev kaldı)`,
					lockType: 'tree'
				});
			} else {
				unlockedKilitliLines.add(i);
			}
		} else if (children.length > 0) {
			// Has non-task child bullets: unlocked only if one child is marked #kilitsiz
			const anyUnlocked = children.some(c => c.hasKilitsiz);
			if (!anyUnlocked) {
				lockedLines.set(i, {
					isLocked: true,
					reason: 'Alt maddeler tamamlanmadan kilitlidir!',
					lockType: 'tree'
				});
			} else {
				unlockedKilitliLines.add(i);
			}
		} else {
			// Standalone task with #kilitli (no children)
			if (!root.checked) {
				lockedLines.set(i, {
					isLocked: true,
					reason: 'Kilitli görev (#kilitli)',
					lockType: 'tree'
				});
			} else {
				unlockedKilitliLines.add(i);
			}
		}
	}

	// 2. Evaluate Future Date Locks for uncompleted tasks (unless #kilitsiz)
	if (!lockFutureTasks) {
		return { lockedLines, unlockedKilitliLines };
	}

	for (let i = 0; i < parsedLines.length; i++) {
		const item = parsedLines[i];
		if (!item.isTask || item.checked || item.hasKilitsiz) continue;
		if (lockedLines.has(i)) continue; // Already locked by tree lock

		const tagMatches = item.text.match(/#[a-zA-Z0-9_\u00C0-\u017F\u0400-\u04FF\-\/:]+/g) || [];
		if (tagMatches.length === 0) continue;

		const dateInfo = evaluateTaskDate(item.text, tagMatches.map(t => t.toLowerCase()), 0);
		if (dateInfo.isLocked) {
			lockedLines.set(i, {
				isLocked: true,
				reason: `Henüz vakti gelmedi (${dateInfo.badgeLabel})`,
				lockType: 'future'
			});
		}
	}

	return { lockedLines, unlockedKilitliLines };
}

/**
 * Checks if a specific task line in the document is currently locked
 */
export function isTaskLineLocked(lines: string[], lineIndex: number, lockFutureTasks: boolean = true): LineLockInfo {
	if (lineIndex < 0 || lineIndex >= lines.length) {
		return { isLocked: false, reason: '', lockType: 'none' };
	}
	const text = lines[lineIndex];
	if (/#kilitsiz\b/i.test(text)) {
		return { isLocked: false, reason: '', lockType: 'none' };
	}

	const docState = computeDocumentLockState(lines, lockFutureTasks);
	const lockInfo = docState.lockedLines.get(lineIndex);
	if (lockInfo) {
		return lockInfo;
	}

	return { isLocked: false, reason: '', lockType: 'none' };
}
