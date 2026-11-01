import { Text } from '@codemirror/state';
import { EditorView } from '@codemirror/view';

export interface AtomicBlock {
	startLine: number; // 1-based
	endLine: number;   // 1-based
	indent: number;
	isList: boolean;
	isHeader: boolean;
	headerLevel: number;
}

export function getIndentLength(text: string): number {
	const match = text.match(/^(\s*)/);
	return (match ? match[1] : '').replace(/\t/g, '    ').length;
}

export function findAtomicBlock(doc: Text, lineNo: number): AtomicBlock | null {
	if (lineNo < 1 || lineNo > doc.lines) return null;
	const line = doc.line(lineNo);
	const text = line.text;

	// 1. Header Block
	const headerMatch = text.match(/^(#{1,6})\s+(.*)$/);
	if (headerMatch) {
		const headerLevel = headerMatch[1].length;
		let endLine = lineNo;
		for (let i = lineNo + 1; i <= doc.lines; i++) {
			const nextLine = doc.line(i);
			const nextHeaderMatch = nextLine.text.match(/^(#{1,6})\s+(.*)$/);
			if (nextHeaderMatch && nextHeaderMatch[1].length <= headerLevel) {
				break;
			}
			endLine = i;
		}
		return {
			startLine: lineNo,
			endLine,
			indent: -1,
			isList: false,
			isHeader: true,
			headerLevel
		};
	}

	// 2. List or Task Item (including its indented sub-items)
	const listMatch = text.match(/^(\s*)(?:[-*+•]|\d+[.)])\s+(.*)$/);
	if (listMatch) {
		const indent = getIndentLength(text);
		let endLine = lineNo;

		for (let i = lineNo + 1; i <= doc.lines; i++) {
			const nextLine = doc.line(i);
			if (nextLine.text.trim().length === 0) break; // empty line ends block
			if (/^#{1,6}\s+/.test(nextLine.text)) break; // header ends block

			const nextIndent = getIndentLength(nextLine.text);
			if (nextIndent > indent) {
				endLine = i;
			} else {
				break;
			}
		}

		return {
			startLine: lineNo,
			endLine,
			indent,
			isList: true,
			isHeader: false,
			headerLevel: 0
		};
	}

	// 3. Plain line
	return {
		startLine: lineNo,
		endLine: lineNo,
		indent: getIndentLength(text),
		isList: false,
		isHeader: false,
		headerLevel: 0
	};
}

export function swapDocLines(
	lines: string[],
	blockA: { start: number; end: number }, // 0-based inclusive
	blockB: { start: number; end: number }  // 0-based inclusive
): { newLines: string[]; offsetDiff: number } {
	// Ensure blockA comes before blockB
	const first = blockA.start < blockB.start ? blockA : blockB;
	const second = blockA.start < blockB.start ? blockB : blockA;

	const chunkFirst = lines.slice(first.start, first.end + 1);
	const chunkSecond = lines.slice(second.start, second.end + 1);

	// Check if both blocks are numbered tasks, e.g. "- [ ] 3. Task" and "- [ ] 2. Task"
	// In bottom-up ordering: higher position in file gets the higher number!
	const numRegex = /^(\s*(?:[-*+•]|\d+[.)])\s*\[[ xX/]?\]\s*)(\d+)\.\s*(.*)$/;
	const firstMatch = chunkFirst[0].match(numRegex);
	const secondMatch = chunkSecond[0].match(numRegex);

	if (firstMatch && secondMatch) {
		const higherNum = Math.max(parseInt(firstMatch[2], 10), parseInt(secondMatch[2], 10));
		const lowerNum = Math.min(parseInt(firstMatch[2], 10), parseInt(secondMatch[2], 10));

		// When second chunk moves to the top, it gets the higher number!
		chunkSecond[0] = `${secondMatch[1]}${higherNum}. ${secondMatch[3]}`;
		// First chunk moves to the bottom, it gets the lower number!
		chunkFirst[0] = `${firstMatch[1]}${lowerNum}. ${firstMatch[3]}`;
	}

	const middle = lines.slice(first.end + 1, second.start);

	const newLines = [
		...lines.slice(0, first.start),
		...chunkSecond,
		...middle,
		...chunkFirst,
		...lines.slice(second.end + 1)
	];

	return {
		newLines,
		offsetDiff: chunkSecond.join('\n').length - chunkFirst.join('\n').length
	};
}

export type BlockDropPosition = 'before' | 'after';

export interface LineBlockRange {
	start: number;
	end: number;
	indent: number;
}

/**
 * Finds a list item and all of its indented children in a plain string array.
 * Line indexes are zero based so the helper can be shared by the task board.
 */
export function findAtomicLineBlock(lines: string[], lineIndex: number): LineBlockRange | null {
	if (lineIndex < 0 || lineIndex >= lines.length) return null;
	const line = lines[lineIndex];
	if (!/^(\s*)(?:[-*+•]|\d+[.)])\s+/.test(line)) return null;

	const indent = getIndentLength(line);
	let end = lineIndex;
	for (let i = lineIndex + 1; i < lines.length; i++) {
		const nextLine = lines[i];
		if (!nextLine.trim() || /^#{1,6}\s+/.test(nextLine)) break;
		if (getIndentLength(nextLine) <= indent) break;
		end = i;
	}

	return { start: lineIndex, end, indent };
}

/**
 * Moves one sibling list block before or after another while preserving all
 * indented child lines. Returns null when the request would break hierarchy.
 */
export function moveAtomicLineBlock(
	lines: string[],
	sourceLineIndex: number,
	targetLineIndex: number,
	position: BlockDropPosition
): string[] | null {
	const source = findAtomicLineBlock(lines, sourceLineIndex);
	const target = findAtomicLineBlock(lines, targetLineIndex);
	if (!source || !target || source.indent !== target.indent) return null;
	if (target.start >= source.start && target.start <= source.end) return null;

	const sourceChunk = lines.slice(source.start, source.end + 1);
	const remaining = [
		...lines.slice(0, source.start),
		...lines.slice(source.end + 1)
	];

	let insertionIndex = position === 'before' ? target.start : target.end + 1;
	if (source.start < insertionIndex) insertionIndex -= sourceChunk.length;
	insertionIndex = Math.max(0, Math.min(insertionIndex, remaining.length));

	const moved = [...remaining];
	moved.splice(insertionIndex, 0, ...sourceChunk);
	return moved;
}

/**
 * Moves the atomic block at cursor position up or down.
 * - Sibling tasks/bullets with all their indented children move together without breaking hierarchy.
 * - Preserves/adapts bottom-up numbering (e.g. 3., 2., 1.).
 * - Moves cursor along with the moved block.
 */
export function moveAtomicBlock(view: EditorView, direction: 'up' | 'down'): boolean {
	const doc = view.state.doc;
	const sel = view.state.selection.main;
	const currentLine = doc.lineAt(sel.head);
	const currentBlock = findAtomicBlock(doc, currentLine.number);

	if (!currentBlock) return false;

	const lines = doc.toString().split('\n');

	if (direction === 'up') {
		if (currentBlock.startLine <= 1) return false;

		// 1. If list/task item: find preceding sibling with same indent
		if (currentBlock.isList) {
			let prevSiblingStart = -1;
			for (let i = currentBlock.startLine - 1; i >= 1; i--) {
				const checkLine = doc.line(i);
				if (checkLine.text.trim().length === 0) break;
				if (/^#{1,6}\s+/.test(checkLine.text)) break;

				const checkIndent = getIndentLength(checkLine.text);
				if (checkIndent < currentBlock.indent) {
					// Parent reached, cannot move up past parent scope
					break;
				}
				if (checkIndent === currentBlock.indent && /^(\s*)(?:[-*+•]|\d+[.)])\s+/.test(checkLine.text)) {
					prevSiblingStart = i;
					break;
				}
			}

			if (prevSiblingStart === -1) return false;

			const prevBlock = findAtomicBlock(doc, prevSiblingStart);
			if (!prevBlock) return false;

			const cursorOffsetInBlock = sel.head - doc.line(currentBlock.startLine).from;

			const blockA = { start: prevBlock.startLine - 1, end: currentBlock.startLine - 2 };
			const blockB = { start: currentBlock.startLine - 1, end: currentBlock.endLine - 1 };

			const { newLines } = swapDocLines(lines, blockA, blockB);
			const fullNewText = newLines.join('\n');

			const newStartLineNo = prevBlock.startLine;
			// Calculate new cursor pos
			const newDoc = Text.of(newLines);
			const targetLine = newDoc.line(newStartLineNo);
			const newCursorPos = Math.min(targetLine.from + cursorOffsetInBlock, newDoc.length);

			view.dispatch({
				changes: { from: 0, to: doc.length, insert: fullNewText },
				selection: { anchor: newCursorPos }
			});
			return true;
		}

		// 2. If Header: find preceding header of same level
		if (currentBlock.isHeader) {
			let prevHeaderLine = -1;
			for (let i = currentBlock.startLine - 1; i >= 1; i--) {
				const match = doc.line(i).text.match(/^(#{1,6})\s+/);
				if (match && match[1].length === currentBlock.headerLevel) {
					prevHeaderLine = i;
					break;
				}
			}
			if (prevHeaderLine === -1) return false;

			const prevBlock = findAtomicBlock(doc, prevHeaderLine);
			if (!prevBlock) return false;

			const cursorOffsetInBlock = sel.head - doc.line(currentBlock.startLine).from;
			const blockA = { start: prevBlock.startLine - 1, end: currentBlock.startLine - 2 };
			const blockB = { start: currentBlock.startLine - 1, end: currentBlock.endLine - 1 };

			const { newLines } = swapDocLines(lines, blockA, blockB);
			const fullNewText = newLines.join('\n');

			const newDoc = Text.of(newLines);
			const targetLine = newDoc.line(prevBlock.startLine);
			const newCursorPos = Math.min(targetLine.from + cursorOffsetInBlock, newDoc.length);

			view.dispatch({
				changes: { from: 0, to: doc.length, insert: fullNewText },
				selection: { anchor: newCursorPos }
			});
			return true;
		}

		// 3. Plain line: swap with line above
		const prevLineNo = currentBlock.startLine - 1;
		if (prevLineNo < 1) return false;

		const blockA = { start: prevLineNo - 1, end: prevLineNo - 1 };
		const blockB = { start: currentBlock.startLine - 1, end: currentBlock.endLine - 1 };

		const { newLines } = swapDocLines(lines, blockA, blockB);
		const fullNewText = newLines.join('\n');
		const newDoc = Text.of(newLines);
		const newCursorPos = Math.min(newDoc.line(prevLineNo).from + (sel.head - currentLine.from), newDoc.length);

		view.dispatch({
			changes: { from: 0, to: doc.length, insert: fullNewText },
			selection: { anchor: newCursorPos }
		});
		return true;
	} else {
		// Direction: DOWN
		if (currentBlock.endLine >= doc.lines) return false;

		// 1. If list/task item: find next sibling with same indent
		if (currentBlock.isList) {
			const nextSiblingStart = currentBlock.endLine + 1;
			if (nextSiblingStart > doc.lines) return false;

			const nextLine = doc.line(nextSiblingStart);
			if (nextLine.text.trim().length === 0) return false;
			if (/^#{1,6}\s+/.test(nextLine.text)) return false;

			const nextIndent = getIndentLength(nextLine.text);
			if (nextIndent !== currentBlock.indent || !/^(\s*)(?:[-*+•]|\d+[.)])\s+/.test(nextLine.text)) {
				// No next sibling with matching indent
				return false;
			}

			const nextBlock = findAtomicBlock(doc, nextSiblingStart);
			if (!nextBlock) return false;

			const cursorOffsetInBlock = sel.head - doc.line(currentBlock.startLine).from;

			const blockA = { start: currentBlock.startLine - 1, end: currentBlock.endLine - 1 };
			const blockB = { start: nextBlock.startLine - 1, end: nextBlock.endLine - 1 };

			const { newLines } = swapDocLines(lines, blockA, blockB);
			const fullNewText = newLines.join('\n');

			const newDoc = Text.of(newLines);
			// After swap, currentBlock starts at currentBlock.startLine + (nextBlock.endLine - nextBlock.startLine + 1)
			const nextBlockLen = nextBlock.endLine - nextBlock.startLine + 1;
			const newStartLineNo = currentBlock.startLine + nextBlockLen;
			const targetLine = newDoc.line(newStartLineNo);
			const newCursorPos = Math.min(targetLine.from + cursorOffsetInBlock, newDoc.length);

			view.dispatch({
				changes: { from: 0, to: doc.length, insert: fullNewText },
				selection: { anchor: newCursorPos }
			});
			return true;
		}

		// 2. If Header: find next header of same level
		if (currentBlock.isHeader) {
			const nextHeaderLine = currentBlock.endLine + 1;
			if (nextHeaderLine > doc.lines) return false;

			const match = doc.line(nextHeaderLine).text.match(/^(#{1,6})\s+/);
			if (!match || match[1].length !== currentBlock.headerLevel) return false;

			const nextBlock = findAtomicBlock(doc, nextHeaderLine);
			if (!nextBlock) return false;

			const cursorOffsetInBlock = sel.head - doc.line(currentBlock.startLine).from;

			const blockA = { start: currentBlock.startLine - 1, end: currentBlock.endLine - 1 };
			const blockB = { start: nextBlock.startLine - 1, end: nextBlock.endLine - 1 };

			const { newLines } = swapDocLines(lines, blockA, blockB);
			const fullNewText = newLines.join('\n');

			const newDoc = Text.of(newLines);
			const nextBlockLen = nextBlock.endLine - nextBlock.startLine + 1;
			const newStartLineNo = currentBlock.startLine + nextBlockLen;
			const targetLine = newDoc.line(newStartLineNo);
			const newCursorPos = Math.min(targetLine.from + cursorOffsetInBlock, newDoc.length);

			view.dispatch({
				changes: { from: 0, to: doc.length, insert: fullNewText },
				selection: { anchor: newCursorPos }
			});
			return true;
		}

		// 3. Plain line: swap with line below
		const nextLineNo = currentBlock.endLine + 1;
		if (nextLineNo > doc.lines) return false;

		const blockA = { start: currentBlock.startLine - 1, end: currentBlock.endLine - 1 };
		const blockB = { start: nextLineNo - 1, end: nextLineNo - 1 };

		const { newLines } = swapDocLines(lines, blockA, blockB);
		const fullNewText = newLines.join('\n');
		const newDoc = Text.of(newLines);
		const newCursorPos = Math.min(newDoc.line(currentBlock.startLine + 1).from + (sel.head - currentLine.from), newDoc.length);

		view.dispatch({
			changes: { from: 0, to: doc.length, insert: fullNewText },
			selection: { anchor: newCursorPos }
		});
		return true;
	}
}

/**
 * Computes priority weight of a task line for block sorting:
 * - Uncompleted #acil -> +20 (always at the very top of the block)
 * - Uncompleted #acil + #2dk -> +15
 * - Uncompleted normal -> +10 (middle)
 * - Uncompleted #2dk -> +5 (always at the bottom of the active tasks in the block)
 * - Completed tasks -> negative weights (kept at the very bottom of the block)
 */
export function getTaskPriorityWeight(lineText: string): number {
	const isCompleted = /^\s*(?:[-*+•]|\d+[.)])\s*\[[xX]]/.test(lineText);
	const hasAcil = /(?:^|\s)#acil\b/i.test(lineText);
	const has2dk = /(?:^|\s)#2dk\b/i.test(lineText);

	if (!isCompleted) {
		if (hasAcil && !has2dk) return 20;
		if (hasAcil && has2dk) return 15;
		if (!has2dk) return 10;
		return 5;
	}

	// Completed tasks sorted after active tasks
	if (hasAcil && !has2dk) return -5;
	if (hasAcil && has2dk) return -10;
	if (!has2dk) return -15;
	return -20;
}

export interface TaskBlockItem {
	headerText: string;
	childLines: string[];
	weight: number;
}

/**
 * Pure function to group and sort task lines preserving child hierarchies
 */
export function sortTaskLinesByPriority(lines: string[]): string[] {
	const items: TaskBlockItem[] = [];
	let currentItem: TaskBlockItem | null = null;
	const getIndent = (t: string) => (t.match(/^(\s*)/)?.[1] || '').replace(/\t/g, '    ').length;

	for (let i = 0; i < lines.length; i++) {
		const line = lines[i];
		const isTask = /^\s*(?:[-*+•]|\d+[.)])\s*\[[ xX/]?\]/.test(line);

		if (isTask) {
			const indent = getIndent(line);
			if (currentItem && indent > getIndent(currentItem.headerText)) {
				currentItem.childLines.push(line);
			} else {
				currentItem = {
					headerText: line,
					childLines: [],
					weight: getTaskPriorityWeight(line)
				};
				items.push(currentItem);
			}
		} else if (currentItem && line.trim().length > 0 && getIndent(line) > getIndent(currentItem.headerText)) {
			currentItem.childLines.push(line);
		} else {
			currentItem = null;
		}
	}

	const sorted = [...items].sort((a, b) => b.weight - a.weight);
	const result: string[] = [];
	for (const it of sorted) {
		result.push(it.headerText);
		for (const ch of it.childLines) {
			result.push(ch);
		}
	}
	return result;
}
