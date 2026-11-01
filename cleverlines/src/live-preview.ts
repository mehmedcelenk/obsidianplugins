import { EditorState, Prec, RangeSetBuilder } from '@codemirror/state';
import {
	Decoration,
	DecorationSet,
	EditorView,
	ViewPlugin,
	ViewUpdate,
	WidgetType,
	keymap
} from '@codemirror/view';
import { App, Notice, Plugin } from 'obsidian';
import { getTaskPriorityWeight, moveAtomicBlock } from './block-mover';
import { CalendarPickerModal, QuestionPromptModal } from './calendar-modal';
import { ensureUrgentTagForShortDeadline, formatControlTimestamp, formatIsoDate } from './dates';
import { computeDocumentLockState, DocumentLockResult, isTaskLineLocked } from './lock-engine';
import { createResolvedTagDOM, isChipVisual, ResolvedTagVisual, resolveTagVisual, sortTaskVisualsForPrefix } from './tag-registry';
import {
	MyTasksSettings,
	TURKISH_DAYS
} from './types';

/**
 * Widget that renders emoji & chips in place of the tag text in Live Preview
 * using the centralized tag-registry Single Source of Truth.
 */
export class EmojiTagWidget extends WidgetType {
	constructor(
		readonly visual: ResolvedTagVisual,
		readonly app?: App,
		readonly isUnlocked?: boolean
	) {
		super();
	}

	eq(other: EmojiTagWidget): boolean {
		const a = this.visual;
		const b = other.visual;
		return (
			a.kind === b.kind &&
			a.rawTag === b.rawTag &&
			a.lowerTag === b.lowerTag &&
			a.emoji === b.emoji &&
			a.labelText === b.labelText &&
			a.status === b.status &&
			a.dateStr === b.dateStr &&
			a.timerMinutes === b.timerMinutes &&
			a.lineText === b.lineText &&
			this.isUnlocked === other.isUnlocked
		);
	}

	toDOM(view: EditorView): HTMLElement {
		return createResolvedTagDOM(this.visual, getSharedDOMHandlers(view, this.isUnlocked, this.app));
	}
}

/**
 * Shared DOM click handlers for chips, deadline picker, lock, and questions
 */
function getSharedDOMHandlers(view: EditorView, isUnlocked?: boolean, app?: App) {
	return {
		isUnlocked,
		onProcessClick: (span: HTMLElement) => {
			try {
				const pos = view.posAtDOM(span);
				const line = view.state.doc.lineAt(pos);
				const text = line.text;
				const ts = formatControlTimestamp(new Date());

				let newText = text;
				if (/#kontrol[\/:]([0-9]{4}-[0-9]{2}-[0-9]{2}(?:[T_\-\s][0-9]{2}[:\-][0-9]{2})?)\b/i.test(newText)) {
					newText = newText.replace(/#kontrol[\/:]([0-9]{4}-[0-9]{2}-[0-9]{2}(?:[T_\-\s][0-9]{2}[:\-][0-9]{2})?)\b/i, `#kontrol/${ts}`);
				} else {
					newText = newText + ` #kontrol/${ts}`;
				}

				if (newText !== text) {
					view.dispatch({
						changes: { from: line.from, to: line.to, insert: newText }
					});
				}
			} catch (err) {
				console.error('MyTasks: Error updating process control date', err);
			}
		},
		onDeadlineClick: (span: HTMLElement, _e: MouseEvent, currentDateStr: string) => {
			try {
				const pos = view.posAtDOM(span);
				const line = view.state.doc.lineAt(pos);
				const text = line.text;
				const targetApp = app || (window as any).app;
				new CalendarPickerModal(
					targetApp,
					(newDate: string) => {
						const replaced = text.replace(/#deadline[\/:][0-9]{4}-[0-9]{2}-[0-9]{2}\b/i, `#deadline/${newDate}`);
						const newText = ensureUrgentTagForShortDeadline(replaced);
						if (newText !== text) {
							view.dispatch({
								changes: { from: line.from, to: line.to, insert: newText }
							});
							if (newText !== replaced) {
								setTimeout(() => {
									sortContiguousTodoBlockByPriority(view, line.number);
								}, 10);
							}
						}
					},
					currentDateStr
				).open();
			} catch (err) {
				console.error('MyTasks: Error opening calendar picker', err);
			}
		},
		onKilitliClick: (span: HTMLElement) => {
			try {
				const pos = view.posAtDOM(span);
				const line = view.state.doc.lineAt(pos);
				const text = line.text;

				const newText = text.replace(/#kilitli\b/i, '#kilitsiz');
				if (newText !== text) {
					view.dispatch({
						changes: { from: line.from, to: line.to, insert: newText }
					});
					new Notice('🔓 Kilit açıldı (#kilitsiz)');
				}
			} catch (err) {
				console.error('MyTasks: Error toggling lock tag', err);
			}
		},
		onQuestionClick: (span: HTMLElement, _e: MouseEvent, currentText: string) => {
			try {
				const pos = view.posAtDOM(span);
				const line = view.state.doc.lineAt(pos);
				const text = line.text;
				const targetApp = app || (window as any).app;

				new QuestionPromptModal(targetApp, currentText, (newQuestion) => {
					const safeNew = newQuestion.replace(/[\[\]\n\r]/g, ' ').trim();
					const replacementTag = safeNew ? `#?[${safeNew}]` : '#?';
					const newText = text.replace(/#\?(\[[^\]]*\]|[a-zA-Z0-9_\u00C0-\u017F\u0400-\u04FF\-\/:]*)/i, replacementTag);

					if (newText !== text) {
						view.dispatch({
							changes: { from: line.from, to: line.to, insert: newText }
						});
					}
				}).open();
			} catch (err) {
				console.error('MyTasks: Error editing question tag', err);
			}
		}
	};
}

/**
 * Task Prefix Group Widget: Renders all task tags grouped at the beginning of the task line:
 * 1. #2dk (⚡) comes FIRST
 * 2. #acil (⚠️) comes SECOND
 * 3. Other pure emojis (🚗, 🏠, ☀️, ⏳, ❓, etc.) come THIRD
 * 4. Written chips (deadline, routine, process, yakında, day-lock, timer) come LAST
 * Rendered inside a unified inline-flex container ensuring pixel-perfect vertical alignment!
 */
export class TaskPrefixGroupWidget extends WidgetType {
	constructor(
		readonly visuals: ResolvedTagVisual[],
		readonly app?: App,
		readonly isUnlocked?: boolean
	) {
		super();
	}

	eq(other: TaskPrefixGroupWidget): boolean {
		if (this.visuals.length !== other.visuals.length) return false;
		if (this.isUnlocked !== other.isUnlocked) return false;
		return this.visuals.every((v, i) =>
			v.rawTag === other.visuals[i].rawTag &&
			v.labelText === other.visuals[i].labelText &&
			v.status === other.visuals[i].status
		);
	}

	toDOM(view: EditorView): HTMLElement {
		const group = document.createElement('span');
		group.className = 'mytasks-task-prefix-group';

		const handlers = getSharedDOMHandlers(view, this.isUnlocked, this.app);
		for (const visual of this.visuals) {
			const el = createResolvedTagDOM(visual, handlers);
			group.appendChild(el);
		}
		return group;
	}
}

/**
 * Zero-width hidden replacement for tags when visually moved to prefix
 */
export class HiddenTagWidget extends WidgetType {
	eq(): boolean {
		return true;
	}

	toDOM(): HTMLElement {
		const span = document.createElement('span');
		span.className = 'dash-drop-hidden-tag';
		return span;
	}
}

/**
 * Interactive Fallback Checkbox Widget for tasks that Obsidian didn't parse as checkboxes
 * (such as tasks indented 2x or more, e.g. 2 tabs or 4+ spaces, which Markdown treats as code blocks).
 */
export class FallbackTaskCheckboxWidget extends WidgetType {
	constructor(
		readonly completed: boolean,
		readonly lineNo: number,
		readonly isUrgent?: boolean,
		readonly isTwoMin?: boolean
	) {
		super();
	}

	eq(other: FallbackTaskCheckboxWidget): boolean {
		return (
			other.completed === this.completed &&
			other.lineNo === this.lineNo &&
			other.isUrgent === this.isUrgent &&
			other.isTwoMin === this.isTwoMin
		);
	}

	toDOM(view: EditorView): HTMLElement {
		const cb = document.createElement('input');
		cb.type = 'checkbox';
		cb.className = 'task-list-item-checkbox mytasks-fallback-checkbox';
		cb.checked = this.completed;

		if (this.isUrgent && this.isTwoMin) {
			cb.classList.add('is-combo');
		} else if (this.isUrgent) {
			cb.classList.add('is-urgent');
		} else if (this.isTwoMin) {
			cb.classList.add('is-twomin');
		}

		cb.addEventListener('click', (e) => {
			e.preventDefault();
			e.stopPropagation();

			const doc = view.state.doc;
			if (this.lineNo > doc.lines) return;
			const line = doc.line(this.lineNo);
			const text = line.text;

			const match = text.match(/^(\s*(?:[-*+•]|\d+[.)])\s*)\[([ xX/]?)]/);
			if (!match) return;

			const isCurrentlyChecked = match[2].trim().toLowerCase() === 'x';
			const newChecked = !isCurrentlyChecked;

			let newText = text;
			if (newChecked) {
				// Transition to checked: check if repeating task
				const routineMatch = text.match(/#(tekrar|rutin)(?:[\/:]([0-9]+))?\b/i);
				if (routineMatch) {
					const tag = routineMatch[1];
					const curCount = routineMatch[2] ? parseInt(routineMatch[2], 10) : 0;
					const nextCount = curCount + 1;
					newText = text.replace(/#(tekrar|rutin)(?:[\/:]([0-9]+))?\b/i, `#${tag}/${nextCount}`);
				}
				newText = newText.replace(/\[([ xX/]?)]/, '[x]');
			} else {
				newText = newText.replace(/\[([ xX/]?)]/, '[ ]');
			}

			view.dispatch({
				changes: { from: line.from, to: line.to, insert: newText }
			});
			view.focus();
		});

		return cb;
	}
}

/**
 * CodeMirror 6 plugin to replace configured tags with emojis, chips, & timers in Live Preview.
 * Caches document lock state so cursor movement (selectionSet) does NOT re-parse the entire document.
 */
export function createTagEmojiViewPlugin(plugin: Plugin, getSettings: () => MyTasksSettings) {
	return ViewPlugin.fromClass(
		class {
			decorations: DecorationSet;
			cachedLockState: DocumentLockResult;

			constructor(view: EditorView) {
				this.cachedLockState = this.computeLock(view);
				this.decorations = this.buildDecorations(view);
			}

			computeLock(view: EditorView): DocumentLockResult {
				const docText = view.state.doc.toString();
				if (!docText.includes('#kilitli') && !docText.includes('#yarın') && !docText.includes('#yarin')) {
					return { lockedLines: new Map(), unlockedKilitliLines: new Set() };
				}
				return computeDocumentLockState(docText.split('\n'), getSettings().lockFutureTasks !== false);
			}

			update(update: ViewUpdate) {
				if (update.docChanged) {
					this.cachedLockState = this.computeLock(update.view);
				}
				if (update.docChanged || update.viewportChanged || update.selectionSet) {
					this.decorations = this.buildDecorations(update.view);
				}
			}

			buildDecorations(view: EditorView): DecorationSet {
				const builder = new RangeSetBuilder<Decoration>();
				const tagMap = new Map<string, string>();
				for (const t of getSettings().tags) {
					tagMap.set(t.tag.toLowerCase(), t.emoji);
				}

				const lockState = this.cachedLockState;
				const selection = view.state.selection.main;
				const cursor = selection.head;

				for (const { from, to } of view.visibleRanges) {
					const startLine = view.state.doc.lineAt(from);
					const endLine = view.state.doc.lineAt(to);

					for (let lineNo = startLine.number; lineNo <= endLine.number; lineNo++) {
						const currentLineObj = view.state.doc.line(lineNo);
						const lineText = currentLineObj.text;
						const regex = /(^|\s)(#\?\[[^\]]*\]|#[a-zA-Z0-9_\u00C0-\u017F\u0400-\u04FF\-\/:]+|#\?)/g;

						const isTask = /^\s*(?:[-*+•]|\d+[.)])\s*\[[ xX/]?\]/.test(lineText);

						if (isTask) {
							const prefixMatch = lineText.match(/^(\s*(?:[-*+•]|\d+[.)])\s*\[[ xX/]?\]\s*)/);
							const prefixLen = prefixMatch ? prefixMatch[1].length : 0;
							const prefixPos = currentLineObj.from + prefixLen;

							// Render fallback interactive checkbox widget for deeply indented tasks
							// (tasks indented 2x or more, where CommonMark/Obsidian treats the line as code block)
							const isDeepIndent = /^(?:\t{2,}|\t\s+|\s{4,})/.test(lineText);
							const taskCheckboxMatch = lineText.match(/^(\s*(?:[-*+•]|\d+[.)])\s*)(\[[ xX/]?\])/);
							if (isDeepIndent && taskCheckboxMatch) {
								const cbFrom = currentLineObj.from + taskCheckboxMatch[1].length;
								const cbTo = cbFrom + taskCheckboxMatch[2].length;
								const isChecked = taskCheckboxMatch[2].toLowerCase().includes('x');
								const isAcil = /#(?:acil)\b/i.test(lineText);
								const is2dk = /#(?:2dk)\b/i.test(lineText);

								builder.add(
									cbFrom,
									cbTo,
									Decoration.replace({
										widget: new FallbackTaskCheckboxWidget(
											isChecked,
											lineNo,
											isAcil,
											is2dk
										)
									})
								);
							}

							interface TagItemMatch {
								tagFrom: number;
								tagTo: number;
								hasLeadingSpace: boolean;
								visual: ResolvedTagVisual;
								cursorInside: boolean;
							}
							const matches: TagItemMatch[] = [];
							const tagRegex = /(#\?\[[^\]]*\]|#[a-zA-Z0-9_\u00C0-\u017F\u0400-\u04FF\-\/:]+|#\?)/g;
							let match;

							while ((match = tagRegex.exec(lineText)) !== null) {
								const tagWithHash = match[1];
								const tagFrom = currentLineObj.from + match.index;
								const tagTo = tagFrom + tagWithHash.length;
								const cursorInside = cursor >= tagFrom && cursor <= tagTo;
								const visual = resolveTagVisual(tagWithHash, lineText, tagMap);

								if (visual && visual.kind !== 'hidden') {
									matches.push({
										tagFrom,
										tagTo,
										hasLeadingSpace: match.index > 0 && lineText.charAt(match.index - 1) === ' ',
										visual,
										cursorInside
									});
								}
							}

							if (matches.length > 0) {
								// Deduplicate multiple repeating tags on the same line, keeping only the highest count
								let maxRoutineCount = -1;
								let primaryRoutineTag = 'tekrar';
								for (const m of matches) {
									const rMatch = m.visual.rawTag.match(/^#(tekrar|rutin)(?:[\/:]([0-9]+))?$/i);
									if (rMatch) {
										const c = rMatch[2] ? parseInt(rMatch[2], 10) : 0;
										if (c > maxRoutineCount) {
											maxRoutineCount = c;
											primaryRoutineTag = rMatch[1];
										}
									}
								}

								let seenRoutine = false;
								const dedupedVisuals: ResolvedTagVisual[] = [];
								for (const m of matches) {
									if (m.visual.kind === 'routine') {
										if (!seenRoutine) {
											seenRoutine = true;
											const displayTag = maxRoutineCount > 0 ? `#${primaryRoutineTag}/${maxRoutineCount}` : `#${primaryRoutineTag}`;
											dedupedVisuals.push({
												...m.visual,
												rawTag: displayTag,
												labelText: `${maxRoutineCount + 1}. Tekrar`
											});
										}
									} else {
										dedupedVisuals.push(m.visual);
									}
								}

								// Strict tag order at prefix: 1. #2dk, 2. #acil, 3. Other emojis, 4. Chips
								const orderedVisuals = sortTaskVisualsForPrefix(dedupedVisuals);

								let isUnlocked = false;
								if (orderedVisuals.some(v => v.kind === 'kilitli')) {
									isUnlocked = lockState.unlockedKilitliLines.has(lineNo - 1);
								}

								if (matches[0].tagFrom === prefixPos) {
									builder.add(
										prefixPos,
										matches[0].tagTo,
										Decoration.replace({
											widget: new TaskPrefixGroupWidget(
												orderedVisuals,
												plugin.app,
												isUnlocked
											)
										})
									);
									for (let i = 1; i < matches.length; i++) {
										const m = matches[i];
										if (!m.cursorInside) {
											let hideStart = m.tagFrom;
											if (m.hasLeadingSpace && hideStart > prefixPos && lineText.charAt(hideStart - currentLineObj.from - 1) === ' ') {
												hideStart--;
											}
											builder.add(
												hideStart,
												m.tagTo,
												Decoration.replace({
													widget: new HiddenTagWidget()
												})
											);
										}
									}
								} else {
									builder.add(
										prefixPos,
										prefixPos,
										Decoration.widget({
											widget: new TaskPrefixGroupWidget(
												orderedVisuals,
												plugin.app,
												isUnlocked
											),
											side: 1
										})
									);
									for (const m of matches) {
										if (!m.cursorInside) {
											let hideStart = m.tagFrom;
											if (m.hasLeadingSpace && hideStart > prefixPos && lineText.charAt(hideStart - currentLineObj.from - 1) === ' ') {
												hideStart--;
											}
											builder.add(
												hideStart,
												m.tagTo,
												Decoration.replace({
													widget: new HiddenTagWidget()
												})
											);
										}
									}
								}
							}
						} else {
							// Non-task lines: render in-place as normal
							let match;
							while ((match = regex.exec(lineText)) !== null) {
								const tagWithHash = match[2];
								const tagFrom = currentLineObj.from + match.index + match[1].length;
								const tagTo = tagFrom + tagWithHash.length;

								const cursorInside = cursor >= tagFrom && cursor <= tagTo;
								if (cursorInside) continue;

								const visual = resolveTagVisual(tagWithHash, lineText, tagMap);
								if (visual) {
									let isUnlocked = false;
									if (visual.kind === 'kilitli') {
										isUnlocked = lockState.unlockedKilitliLines.has(lineNo - 1);
									}

									builder.add(
										tagFrom,
										tagTo,
										Decoration.replace({
											widget: new EmojiTagWidget(
												visual,
												plugin.app,
												isUnlocked
											)
										})
									);
								}
							}
						}
					}
				}

				return builder.finish();
			}
		},
		{
			decorations: v => v.decorations
		}
	);
}

/**
 * CodeMirror 6 plugin to intercept checkbox clicks:
 * 1. #süreç / #takip tasks: updates #kontrol/YYYY-MM-DD on regular click (no notice popup), Shift+Click completes.
 * 2. Locked tasks (#kilitli tree or future dates): BLOCKS checking and shows friendly Notice!
 */
export function createTaskInteractionPlugin(getSettings: () => MyTasksSettings) {
	return ViewPlugin.fromClass(
		class {
			constructor(readonly view: EditorView) {}
		},
		{
			eventHandlers: {
				click(e: MouseEvent, view: EditorView) {
					const target = e.target as HTMLElement;
					if (!target) return false;

					const isCheckbox =
						target.classList.contains('task-list-item-checkbox') ||
						target.classList.contains('cm-formatting-task') ||
						target.closest('.task-list-item-checkbox') !== null ||
						(target.tagName === 'INPUT' && (target as HTMLInputElement).type === 'checkbox');

					if (!isCheckbox) return false;

					try {
						const pos = view.posAtDOM(target);
						const line = view.state.doc.lineAt(pos);
						const text = line.text;
						const lines = view.state.doc.toString().split('\n');
						const lineIndex = line.number - 1;

						// 1. Process / Tracking Tasks (#süreç / #takip / #kontrol)
						if (/#(?:süreç|surec|takip|kontrol)\b/i.test(text)) {
							if (e.shiftKey || e.altKey) {
								return false;
							}

							e.preventDefault();
							e.stopPropagation();

							const ts = formatControlTimestamp(new Date());
							let newText = text;
							if (/#kontrol[\/:]([0-9]{4}-[0-9]{2}-[0-9]{2}(?:[T_\-\s][0-9]{2}[:\-][0-9]{2})?)\b/i.test(newText)) {
								newText = newText.replace(/#kontrol[\/:]([0-9]{4}-[0-9]{2}-[0-9]{2}(?:[T_\-\s][0-9]{2}[:\-][0-9]{2})?)\b/i, `#kontrol/${ts}`);
							} else {
								newText = newText + ` #kontrol/${ts}`;
							}

							newText = newText.replace(/\[[xX/]]/, '[ ]');

							view.dispatch({
								changes: { from: line.from, to: line.to, insert: newText }
							});
							return true;
						}

						// 2. Repeating Tasks (#tekrar / #rutin)
						if (/#(?:tekrar|rutin)(?:[\/:]([0-9]+))?\b/i.test(text)) {
							const isUnchecked = /^\s*(?:[-*+•]|\d+[.)])\s*\[ ]/.test(text);
							if (isUnchecked) {
								e.preventDefault();
								e.stopPropagation();
								
								// Find all occurrences and pick the highest count to cleanly consolidate
								const matches = [...text.matchAll(/#(tekrar|rutin)(?:[\/:]([0-9]+))?\b/gi)];
								let maxCount = 0;
								let tag = 'tekrar';
								for (const m of matches) {
									tag = m[1];
									const c = m[2] ? parseInt(m[2], 10) : 0;
									if (c > maxCount) maxCount = c;
								}
								const nextCount = maxCount + 1;
								const newTag = `#${tag}/${nextCount}`;
								let replaced = false;
								let newText = text.replace(/#(?:tekrar|rutin)(?:[\/:]([0-9]+))?\b/gi, () => {
									if (!replaced) {
										replaced = true;
										return newTag;
									}
									return '';
								});
								newText = newText.replace(/\[ ]/, '[x]').replace(/ {2,}/g, ' ').replace(/\s+$/, '');

								view.dispatch({
									changes: { from: line.from, to: line.to, insert: newText }
								});
								return true;
							}
						}

						// 2. Locked Tasks Check (#kilitli tree or future dates)
						const isUnchecked = /^\s*(?:[-*+•]|\d+[.)])\s*\[ ]/.test(text);
						if (isUnchecked) {
							const lockInfo = isTaskLineLocked(lines, lineIndex, getSettings().lockFutureTasks !== false);
							if (lockInfo.isLocked) {
								e.preventDefault();
								e.stopPropagation();
								new Notice(`🔒 ${lockInfo.reason}`);
								return true;
							}
						}
					} catch (err) {
						console.error('MyTasks: Error in task click interaction', err);
					}

					return false;
				}
			}
		}
	);
}

// Backward-compatible alias
export const createProcessTaskHandlerPlugin = createTaskInteractionPlugin;

/**
 * Bulletproof CodeMirror 6 transaction filter that automatically increments
 * #tekrar / #rutin repeating task counter whenever a task line transitions
 * from unchecked (- [ ]) to checked (- [x]), whether via mouse click,
 * keyboard shortcut (Ctrl+Enter / Cmd+Enter), or Obsidian commands.
 */
export function createRepeatingTaskTransactionFilter() {
	return EditorState.transactionFilter.of((tr) => {
		if (!tr.docChanged) return tr;

		const docBefore = tr.startState.doc;
		const newDoc = tr.newDoc;
		const changes: Array<{ from: number; to: number; insert: string }> = [];

		tr.changes.iterChanges((fromA, toA, fromB, toB, inserted) => {
			const insertedText = inserted.toString();
			if (/\[[xX]\]/.test(insertedText)) {
				const line = newDoc.lineAt(fromB);
				const text = line.text;
				const matches = [...text.matchAll(/#(tekrar|rutin)(?:[\/:]([0-9]+))?\b/gi)];
				if (matches.length > 0) {
					const lineBefore = docBefore.lineAt(Math.min(fromA, docBefore.length));
					const textBefore = lineBefore.text;
					// If the transaction itself already updated/incremented the tag (e.g. from taskInteractionPlugin),
					// docBefore might not have had the new tag or it was already handled.
					// Check if lineBefore was unchecked:
					if (/^\s*(?:[-*+•]|\d+[.)])\s*\[ \]/.test(textBefore)) {
						let maxCountBefore = 0;
						for (const m of textBefore.matchAll(/#(?:tekrar|rutin)(?:[\/:]([0-9]+))?\b/gi)) {
							const c = m[1] ? parseInt(m[1], 10) : 0;
							if (c > maxCountBefore) maxCountBefore = c;
						}
						let maxCountNow = 0;
						let tag = 'tekrar';
						for (const m of matches) {
							tag = m[1];
							const c = m[2] ? parseInt(m[2], 10) : 0;
							if (c > maxCountNow) maxCountNow = c;
						}

						// If count was already incremented by the click transaction, do NOT increment again!
						if (maxCountNow > maxCountBefore) {
							return;
						}

						const nextCount = maxCountNow + 1;
						const newTag = `#${tag}/${nextCount}`;
						
						// Replace all repeating tags on the line with the single new tag
						let replaced = false;
						const cleanedLineText = text.replace(/#(?:tekrar|rutin)(?:[\/:]([0-9]+))?\b/gi, () => {
							if (!replaced) {
								replaced = true;
								return newTag;
							}
							return '';
						}).replace(/ {2,}/g, ' ').replace(/\s+$/, '');

						if (cleanedLineText !== text) {
							changes.push({
								from: line.from,
								to: line.to,
								insert: cleanedLineText
							});
						}
					}
				}
			}
		});

		if (changes.length > 0) {
			return [tr, { changes }];
		}
		return tr;
	});
}

/**
 * Unified high-performance CodeMirror 6 plugin to render line lock decorations:
 * - Dims #kilitli parent items whose children are incomplete (class: 'dash-drop-locked')
 * - Dims future-dated tasks whose date has not arrived (class: 'mytasks-future-locked')
 */
export function createTaskLockDecorationsPlugin(getSettings: () => MyTasksSettings) {
	return ViewPlugin.fromClass(
		class {
			decorations: DecorationSet;

			constructor(view: EditorView) {
				this.decorations = this.buildDecorations(view);
			}

			update(update: ViewUpdate) {
				if (update.docChanged) {
					this.decorations = this.buildDecorations(update.view);
				}
			}

			buildDecorations(view: EditorView): DecorationSet {
				const builder = new RangeSetBuilder<Decoration>();
				const doc = view.state.doc;
				const text = doc.toString();

				if (!text.includes('#kilitli') && !text.includes('#yarın') && !text.includes('#yarin') && !text.includes('#deadline') && !text.includes('#due') && !text.includes('#acil') && !text.includes('#2dk') && !text.includes('#tekrar') && !text.includes('#rutin')) {
					let hasAnyDay = false;
					for (const day of Object.keys(TURKISH_DAYS)) {
						if (text.includes('#' + day)) {
							hasAnyDay = true;
							break;
						}
					}
					if (!hasAnyDay && !/\d{4}-\d{2}-\d{2}/.test(text)) {
						return builder.finish();
					}
				}

				const lines = text.split('\n');
				const lockState = computeDocumentLockState(lines, getSettings().lockFutureTasks !== false);

				for (let lineNo = 0; lineNo < lines.length; lineNo++) {
					if (lineNo + 1 > doc.lines) continue;
					const rawLine = lines[lineNo];
					const cmLine = doc.line(lineNo + 1);

					const info = lockState.lockedLines.get(lineNo);
					if (info && info.isLocked) {
						const cls = info.lockType === 'tree' ? 'dash-drop-locked' : 'mytasks-future-locked';
						builder.add(cmLine.from, cmLine.from, Decoration.line({ class: cls }));
						continue;
					}

					// Deeply indented task lines (2x or more indent) styling fix
					if (/^(?:\t{2,}|\t\s+|\s{4,})\s*(?:[-*+•]|\d+[.)])\s*\[[ xX/]?\]/.test(rawLine)) {
						builder.add(cmLine.from, cmLine.from, Decoration.line({
							class: 'mytasks-deep-task-line'
						}));
					}

					// Custom checkbox coloring for uncompleted tasks
					if (/^\s*(?:[-*+•]|\d+[.)])\s*\[ ]/.test(rawLine)) {
						const isAcil = /#(?:acil)\b/i.test(rawLine);
						const is2dk = /#(?:2dk)\b/i.test(rawLine);

						if (isAcil && is2dk) {
							builder.add(cmLine.from, cmLine.from, Decoration.line({ class: 'mytasks-combo-task' }));
						} else if (isAcil) {
							builder.add(cmLine.from, cmLine.from, Decoration.line({ class: 'mytasks-urgent-task' }));
						} else if (is2dk) {
							builder.add(cmLine.from, cmLine.from, Decoration.line({ class: 'mytasks-twomin-task' }));
						}
					}
				}

				return builder.finish();
			}
		},
		{
			decorations: v => v.decorations
		}
	);
}

/**
 * Ghost Hint Widget shown when '-' is typed on an empty/new line
 */
export class DashGhostHintWidget extends WidgetType {
	constructor(readonly indent: string) {
		super();
	}

	eq(other: DashGhostHintWidget): boolean {
		return other.indent === this.indent;
	}

	toDOM(view: EditorView): HTMLElement {
		const span = document.createElement('span');
		span.className = 'mytasks-dash-ghost-hint';

		const todoBtn = document.createElement('span');
		todoBtn.className = 'mytasks-ghost-btn mytasks-ghost-tab';
		todoBtn.innerHTML = `<kbd>Tab</kbd> ☑️ Todo`;
		todoBtn.addEventListener('mousedown', (e: MouseEvent) => {
			e.preventDefault();
			e.stopPropagation();
			const pos = view.posAtDOM(span);
			const line = view.state.doc.lineAt(pos);
			const newText = `${this.indent}- [ ] `;
			view.dispatch({
				changes: { from: line.from, to: line.to, insert: newText },
				selection: { anchor: line.from + newText.length }
			});
			view.focus();
		});

		const sep = document.createElement('span');
		sep.className = 'mytasks-ghost-sep';
		sep.textContent = '•';

		const bulletBtn = document.createElement('span');
		bulletBtn.className = 'mytasks-ghost-btn mytasks-ghost-space';
		bulletBtn.innerHTML = `<kbd>Space</kbd> • Liste`;
		bulletBtn.addEventListener('mousedown', (e: MouseEvent) => {
			e.preventDefault();
			e.stopPropagation();
			const pos = view.posAtDOM(span);
			const line = view.state.doc.lineAt(pos);
			const newText = `${this.indent}- `;
			view.dispatch({
				changes: { from: line.from, to: line.to, insert: newText },
				selection: { anchor: line.from + newText.length }
			});
			view.focus();
		});

		span.appendChild(todoBtn);
		span.appendChild(sep);
		span.appendChild(bulletBtn);

		return span;
	}
}

/**
 * ViewPlugin that renders the inline ghost hint right next to '-'
 */
export function createDashGhostHintPlugin() {
	return ViewPlugin.fromClass(
		class {
			decorations: DecorationSet;

			constructor(view: EditorView) {
				this.decorations = this.buildDecorations(view);
			}

			update(update: ViewUpdate) {
				if (update.docChanged || update.selectionSet || update.viewportChanged) {
					this.decorations = this.buildDecorations(update.view);
				}
			}

			buildDecorations(view: EditorView): DecorationSet {
				const builder = new RangeSetBuilder<Decoration>();
				// Ghost hint display suppressed per user request ("bullet attığımda yazmasına gerek yok tab vs")
				return builder.finish();
			}
		},
		{
			decorations: v => v.decorations
		}
	);
}

export { getTaskPriorityWeight };

/**
 * Requirement 3:
 * Numbers ONLY the target task line where #<number> was typed (e.g. #1 -> "1. "),
 * WITHOUT numbering all other unnumbered tasks in the block!
 * Also runs block priority sorting if needed.
 */
export function numberSingleTodoLine(view: EditorView, targetLineNo: number, explicitNum?: number): boolean {
	const doc = view.state.doc;
	if (targetLineNo < 1 || targetLineNo > doc.lines) return false;

	const line = doc.line(targetLineNo);
	const match = line.text.match(/^(\s*-\s*\[[ xX/]?\]\s*)(.*)$/);
	if (!match) return false;

	const prefix = match[1];
	let rawContent = match[2];

	let num = explicitNum || 0;
	const hashMatch = rawContent.match(/(?:^|\s+)#([0-9]+)(?:\.|\s+|$)/);
	if (hashMatch) {
		num = parseInt(hashMatch[1], 10);
		rawContent = rawContent.replace(/(?:^|\s+)#[0-9]+(?:\.|\s+|$)/g, ' ');
	}

	if (num <= 0) return false;

	const wasAtEnd = /#[0-9]+\s*$/.test(line.text);
	const cleanContent = rawContent.replace(/^\s*\d+[\.\)]\s*/, '').trim();

	const newLineText = cleanContent
		? `${prefix}${num}. ${cleanContent}`
		: `${prefix}${num}. `;

	const newCursorPos = wasAtEnd && cleanContent
		? line.from + newLineText.length
		: line.from + `${prefix}${num}. `.length;

	view.dispatch({
		changes: {
			from: line.from,
			to: line.to,
			insert: newLineText
		},
		selection: { anchor: newCursorPos }
	});

	return true;
}

/**
 * Requirement 10:
 * Sorts an entire section/block of tasks (e.g. all tasks under a ## Heading or list block) so that:
 * - #acil tasks are always at the TOP of the block
 * - Normal tasks are in the MIDDLE of the block
 * - #2dk tasks are always at the BOTTOM of the active tasks in the block
 * - Indented children/subtasks stay glued to their parent task
 * - Completed tasks are neatly grouped at the bottom
 */
export function sortContiguousTodoBlockByPriority(view: EditorView, targetLineNo: number): boolean {
	const doc = view.state.doc;
	if (targetLineNo < 1 || targetLineNo > doc.lines) return false;

	// 1. Scan upwards to find the block boundary (heading ##, '---', or start of file)
	let startLineNo = targetLineNo;
	while (startLineNo > 1) {
		const prev = doc.line(startLineNo - 1);
		const prevTrim = prev.text.trim();
		if (/^#{1,6}\s+/.test(prevTrim) || prevTrim === '---') {
			break;
		}
		if (prevTrim.length === 0 && startLineNo < targetLineNo) {
			break;
		}
		startLineNo--;
	}

	// 2. Scan downwards to find the block boundary (next heading ##, '---', or end of file)
	let endLineNo = targetLineNo;
	while (endLineNo < doc.lines) {
		const next = doc.line(endLineNo + 1);
		const nextTrim = next.text.trim();
		if (/^#{1,6}\s+/.test(nextTrim) || nextTrim === '---') {
			break;
		}
		if (nextTrim.length === 0 && endLineNo > targetLineNo) {
			break;
		}
		endLineNo++;
	}

	// 3. Trim non-task lines from start
	while (startLineNo <= endLineNo) {
		const lineText = doc.line(startLineNo).text;
		if (/^\s*(?:[-*+•]|\d+[.)])\s*\[[ xX/]?\]/.test(lineText)) break;
		startLineNo++;
	}

	// 4. Trim empty lines from end
	while (endLineNo >= startLineNo) {
		const lineText = doc.line(endLineNo).text;
		if (lineText.trim().length > 0) break;
		endLineNo--;
	}

	if (startLineNo >= endLineNo) return false;

	interface BlockTaskItem {
		headerLineNo: number;
		fullText: string;
		weight: number;
		isTarget: boolean;
		cursorOffsetInItem: number;
	}

	const selHead = view.state.selection.main.head;
	const items: BlockTaskItem[] = [];
	let lineIdx = startLineNo;

	const getIndent = (t: string) => (t.match(/^(\s*)/)?.[1] || '').replace(/\t/g, '    ').length;

	while (lineIdx <= endLineNo) {
		const line = doc.line(lineIdx);
		if (/^\s*(?:[-*+•]|\d+[.)])\s*\[[ xX/]?\]/.test(line.text)) {
			const headerLineNo = lineIdx;
			const itemLines: string[] = [line.text];
			let itemEndPos = line.to;

			const parentIndent = getIndent(line.text);

			let childIdx = lineIdx + 1;
			while (childIdx <= endLineNo) {
				const cLine = doc.line(childIdx);
				const cText = cLine.text;
				if (cText.trim().length > 0 && getIndent(cText) > parentIndent) {
					itemLines.push(cText);
					itemEndPos = cLine.to;
					childIdx++;
				} else {
					break;
				}
			}

			const fullText = itemLines.join('\n');
			const isTarget = (selHead >= line.from && selHead <= itemEndPos) || headerLineNo === targetLineNo;
			const cursorOffsetInItem = isTarget ? Math.max(0, Math.min(fullText.length, selHead - line.from)) : 0;

			items.push({
				headerLineNo,
				fullText,
				weight: getTaskPriorityWeight(line.text),
				isTarget,
				cursorOffsetInItem
			});

			lineIdx = childIdx;
		} else {
			break;
		}
	}

	if (items.length <= 1) return false;

	const sortedItems = [...items].sort((a, b) => b.weight - a.weight);

	// Check if order actually changed
	const orderChanged = sortedItems.some((item, idx) => item !== items[idx]);
	if (!orderChanged) return false;

	const actualStartLineNo = items[0].headerLineNo;
	const lastItem = items[items.length - 1];
	const actualEndLineNo = actualStartLineNo + items.reduce((acc, i) => acc + i.fullText.split('\n').length, 0) - 1;

	const blockFrom = doc.line(actualStartLineNo).from;
	const blockTo = doc.line(actualEndLineNo).to;
	const newBlockText = sortedItems.map(i => i.fullText).join('\n');

	let newCursorPos = selHead;
	let runningOffset = blockFrom;
	for (const item of sortedItems) {
		if (item.isTarget) {
			newCursorPos = runningOffset + item.cursorOffsetInItem;
			break;
		}
		runningOffset += item.fullText.length + 1;
	}

	view.dispatch({
		changes: {
			from: blockFrom,
			to: blockTo,
			insert: newBlockText
		},
		selection: { anchor: newCursorPos }
	});

	return true;
}

// Backward-compatible export: numbers ONLY the target line (Requirement 3)
export function numberContiguousTodoBlock(view: EditorView, targetLineNo: number, startNum: number = 1): boolean {
	return numberSingleTodoLine(view, targetLineNo, startNum);
}

/**
 * Keymap plugin with highest precedence:
 * - 'Tab' when line is '-' -> inserts '- [ ] ' (Todo)
 * - 'Space' when line is '-' -> inserts '- ' (Bullet list)
 * - 'Space' / 'Enter' when typing '#<number>' on task line -> numbers ONLY that task line
 * - 'Space' / 'Enter' when task line has #acil or #2dk -> sorts block (#acil top, #2dk bottom)
 */
export function createDashKeymapPlugin() {
	return Prec.highest(
		keymap.of([
			{
				key: 'Tab',
				run: (view: EditorView) => {
					const sel = view.state.selection.main;
					if (!sel.empty) return false;
					const line = view.state.doc.lineAt(sel.head);
					const match = line.text.match(/^(\s*)(-)\s*$/);
					if (match && sel.head <= line.to) {
						const indent = match[1];
						const newText = `${indent}- [ ] `;
						view.dispatch({
							changes: { from: line.from, to: line.to, insert: newText },
							selection: { anchor: line.from + newText.length }
						});
						return true;
					}
					return false;
				}
			},
			{
				key: 'Space',
				run: (view: EditorView) => {
					const sel = view.state.selection.main;
					if (!sel.empty) return false;
					const line = view.state.doc.lineAt(sel.head);

					// 1. Dash replacement: '-' -> '- '
					const match = line.text.match(/^(\s*)(-)\s*$/);
					if (match && sel.head <= line.to) {
						const indent = match[1];
						const newText = `${indent}- `;
						view.dispatch({
							changes: { from: line.from, to: line.to, insert: newText },
							selection: { anchor: line.from + newText.length }
						});
						return true;
					}

					// 2. Single-line numbering trigger when Space is pressed right after '#<number>'
					if (/^\s*-\s*\[[ xX/]?\]/.test(line.text)) {
						const beforeCursor = line.text.slice(0, sel.head - line.from);
						const hashMatch = beforeCursor.match(/(?:^|\s+)#([0-9]+)$/);
						if (hashMatch) {
							const startNum = parseInt(hashMatch[1], 10);
							return numberSingleTodoLine(view, line.number, startNum);
						}
					}

					return false;
				}
			},
			{
				key: 'Enter',
				run: (view: EditorView) => {
					const sel = view.state.selection.main;
					if (!sel.empty) return false;
					const line = view.state.doc.lineAt(sel.head);
					const beforeCursor = line.text.slice(0, sel.head - line.from);

					// Requirement: #? enter -> opens field modal, user writes and submits -> becomes #?[soru]
					if (/(?:^|\s+)#\?$/i.test(beforeCursor)) {
						const targetApp = (window as any).app;
						const match = beforeCursor.match(/(?:^|\s+)(#\?)$/);
						if (match) {
							const tagFrom = sel.head - match[1].length;
							const tagTo = sel.head;
							new QuestionPromptModal(targetApp, '', (question) => {
								const safeText = question.replace(/[\[\]\n\r]/g, ' ').trim();
								const replacement = safeText ? `#?[${safeText}] ` : '#? ';
								view.dispatch({
									changes: { from: tagFrom, to: tagTo, insert: replacement },
									selection: { anchor: tagFrom + replacement.length }
								});
								view.focus();
							}).open();
							return true;
						}
					}

					if (/^\s*-\s*\[[ xX/]?\]/.test(line.text)) {
						const hashMatch = beforeCursor.match(/(?:^|\s+)#([0-9]+)$/);
						if (hashMatch) {
							const startNum = parseInt(hashMatch[1], 10);
							return numberSingleTodoLine(view, line.number, startNum);
						}

						if (/(?:^|\s+)#(?:acil|2dk)$/i.test(beforeCursor)) {
							setTimeout(() => {
								sortContiguousTodoBlockByPriority(view, line.number);
							}, 10);
						}
					}

					return false;
				}
			},
			{
				key: 'Alt-ArrowUp',
				run: (view: EditorView) => moveAtomicBlock(view, 'up')
			},
			{
				key: 'Alt-ArrowDown',
				run: (view: EditorView) => moveAtomicBlock(view, 'down')
			}
		])
	);
}

let isApplyingNumbering = false;

/**
 * ViewPlugin that observes text changes on mobile/desktop:
 * - Triggers single-task numbering when '- [ ] #1 ' is entered
 * - Triggers priority sorting ONLY when '#acil ' or '#2dk ' is newly completed at the edit position
 */
export function createTaskNumberingPlugin() {
	return ViewPlugin.fromClass(
		class {
			update(update: ViewUpdate) {
				if (!update.docChanged || isApplyingNumbering) return;

				const doc = update.state.doc;
				let triggerLineNo = -1;
				let startNum = 1;
				let sortPriorityLineNo = -1;
				let autoUrgentLineNo = -1;

				update.changes.iterChangedRanges((fromA, toA, fromB, toB) => {
					const inserted = doc.sliceString(fromB, toB);
					if (!inserted) return;

					const line = doc.lineAt(toB);
					if (!/^\s*-\s*\[[ xX/]?\]/.test(line.text)) return;

					const recentWindow = doc.sliceString(Math.max(line.from, toB - 28), toB);

					// Single-line #<number> followed by space at cursor
					if (triggerLineNo < 0 && /(?:^|\s)#([0-9]+)\s$/.test(recentWindow)) {
						const match = recentWindow.match(/(?:^|\s)#([0-9]+)\s$/);
						if (match) {
							triggerLineNo = line.number;
							startNum = parseInt(match[1], 10);
						}
					}

					// Auto-add #acil when #deadline/YYYY-MM-DD (< 2 days) is typed
					if (autoUrgentLineNo < 0 && /#deadline[\/:][0-9]{4}-[0-9]{2}-[0-9]{2}\s$/i.test(recentWindow)) {
						const ensured = ensureUrgentTagForShortDeadline(line.text);
						if (ensured !== line.text) {
							autoUrgentLineNo = line.number;
						}
					}

					// Priority sort ONLY when #acil or #2dk was just completed at toB
					if (sortPriorityLineNo < 0 && /(?:^|\s)#(?:acil|2dk)\s$/i.test(recentWindow)) {
						sortPriorityLineNo = line.number;
					}
				});

				if (triggerLineNo > 0 || sortPriorityLineNo > 0 || autoUrgentLineNo > 0) {
					isApplyingNumbering = true;
					queueMicrotask(() => {
						try {
							if (autoUrgentLineNo > 0 && autoUrgentLineNo <= update.view.state.doc.lines) {
								const dLine = update.view.state.doc.line(autoUrgentLineNo);
								const updatedText = ensureUrgentTagForShortDeadline(dLine.text);
								if (updatedText !== dLine.text) {
									update.view.dispatch({
										changes: { from: dLine.from, to: dLine.to, insert: updatedText }
									});
									sortPriorityLineNo = autoUrgentLineNo;
								}
							}
							if (triggerLineNo > 0) {
								numberSingleTodoLine(update.view, triggerLineNo, startNum);
							}
							if (sortPriorityLineNo > 0) {
								sortContiguousTodoBlockByPriority(update.view, sortPriorityLineNo);
							}
						} finally {
							isApplyingNumbering = false;
						}
					});
				}
			}
		}
	);
}
