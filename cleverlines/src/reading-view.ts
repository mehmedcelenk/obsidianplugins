import { Notice, Plugin } from 'obsidian';
import { CalendarPickerModal, QuestionPromptModal } from './calendar-modal';
import { ensureUrgentTagForShortDeadline, evaluateTaskDate, formatControlTimestamp } from './dates';
import { createResolvedTagDOM, resolveTagVisual } from './tag-registry';
import { MyTasksSettings } from './types';

function normalizeTaskTextForMatching(text: string): string {
	return text
		.replace(/#[a-zA-Z0-9_\u00C0-\u017F\u0400-\u04FF\-\/:]+/g, '')
		.replace(/\[[ xX/]]/g, '')
		.replace(/^[\s\-*+•\d.)]+/g, '')
		.replace(/\s+/g, ' ')
		.trim()
		.toLowerCase();
}

function findMatchingTaskLineIndex(lines: string[], targetRaw: string, requiredPattern: RegExp): number {
	const cleanTarget = normalizeTaskTextForMatching(targetRaw);
	if (!cleanTarget) return -1;

	// Pass 1: exact normalized match
	for (let i = 0; i < lines.length; i++) {
		if (!requiredPattern.test(lines[i])) continue;
		const cleanLine = normalizeTaskTextForMatching(lines[i]);
		if (cleanLine && cleanLine === cleanTarget) {
			return i;
		}
	}

	// Pass 2: full substring match (DOM text may include child items or badge text)
	for (let i = 0; i < lines.length; i++) {
		if (!requiredPattern.test(lines[i])) continue;
		const cleanLine = normalizeTaskTextForMatching(lines[i]);
		if (cleanLine.length >= 4 && (cleanTarget.startsWith(cleanLine) || cleanTarget.includes(cleanLine))) {
			return i;
		}
	}

	return -1;
}

async function updateProcessDateInActiveFile(plugin: Plugin, parentEl: HTMLElement) {
	const activeFile = plugin.app.workspace.getActiveFile();
	if (!activeFile) return;
	const ts = formatControlTimestamp(new Date());
	const targetRaw = (parentEl.textContent || '').trim();

	await plugin.app.vault.process(activeFile, (content) => {
		const lines = content.split('\n');
		const foundLineIdx = findMatchingTaskLineIndex(lines, targetRaw, /#(?:süreç|surec|takip|kontrol)\b/i);
		if (foundLineIdx !== -1) {
			const currentLine = lines[foundLineIdx];
			const newLine = /#kontrol[\/:]([0-9]{4}-[0-9]{2}-[0-9]{2}(?:[T_\-\s][0-9]{2}[:\-][0-9]{2})?)\b/i.test(currentLine)
				? currentLine.replace(/#kontrol[\/:]([0-9]{4}-[0-9]{2}-[0-9]{2}(?:[T_\-\s][0-9]{2}[:\-][0-9]{2})?)\b/i, `#kontrol/${ts}`)
				: `${currentLine} #kontrol/${ts}`;
			if (newLine !== currentLine) {
				lines[foundLineIdx] = newLine;
				return lines.join('\n');
			}
		}
		return content;
	});
}

async function toggleLockInActiveFile(plugin: Plugin, tagEl: HTMLElement) {
	const activeFile = plugin.app.workspace.getActiveFile();
	if (!activeFile) return;
	const parentEl = tagEl.closest('li, h1, h2, h3, h4, h5, h6, p') || tagEl.parentElement;
	const targetRaw = (parentEl?.textContent || '').trim();
	let unlocked = false;

	await plugin.app.vault.process(activeFile, (content) => {
		const lines = content.split('\n');
		const foundLineIdx = findMatchingTaskLineIndex(lines, targetRaw, /#kilitli\b/i);
		if (foundLineIdx !== -1) {
			const currentLine = lines[foundLineIdx];
			const newLine = currentLine.replace(/#kilitli\b/i, '#kilitsiz');
			if (newLine !== currentLine) {
				lines[foundLineIdx] = newLine;
				unlocked = true;
				return lines.join('\n');
			}
		}
		return content;
	});

	if (unlocked) {
		new Notice('🔓 Kilit açıldı (#kilitsiz)');
	}
}

export function processReadingView(plugin: Plugin, el: HTMLElement, getSettings: () => MyTasksSettings) {
	const settings = getSettings();
	const tagMap = new Map<string, string>();
	for (const t of settings.tags) {
		tagMap.set(t.tag.toLowerCase(), t.emoji);
	}

	const editQuestionInActiveFile = (currentText: string) => {
		const activeFile = plugin.app.workspace.getActiveFile();
		if (!activeFile) return;
		new QuestionPromptModal(plugin.app, currentText, async (newQuestion) => {
			const safeNew = newQuestion.replace(/[\[\]\n\r]/g, ' ').trim();
			const replacementTag = safeNew ? `#?[${safeNew}]` : '#?';
			await plugin.app.vault.process(activeFile, (content) =>
				content.replace(/#\?(\[[^\]]*\]|[a-zA-Z0-9_\u00C0-\u017F\u0400-\u04FF\-\/:]*)/i, replacementTag)
			);
		}).open();
	};

	const tagLinks = el.querySelectorAll('a.tag');
	tagLinks.forEach((node) => {
		const rawText = node.textContent?.toLowerCase() || '';
		const cleanTag = rawText.startsWith('#') ? rawText : '#' + rawText;
		const parentEl = (node.closest('li, h1, h2, h3, h4, h5, h6, p') || node.parentElement) as HTMLElement | null;
		const lineText = parentEl?.textContent || cleanTag;

		const visual = resolveTagVisual(cleanTag, lineText, tagMap);
		if (!visual) return;

		const replacementEl = createResolvedTagDOM(visual, {
			onProcessClick: async () => {
				if (parentEl) {
					await updateProcessDateInActiveFile(plugin, parentEl);
				}
			},
			onDeadlineClick: async (_el, _e, currentDateStr) => {
				const activeFile = plugin.app.workspace.getActiveFile();
				if (activeFile) {
					new CalendarPickerModal(plugin.app, async (newDate: string) => {
						await plugin.app.vault.process(activeFile, (content) =>
							content
								.split('\n')
								.map(line => {
									if (new RegExp(`#deadline[\\/:]${currentDateStr}\\b`, 'i').test(line)) {
										const replaced = line.replace(new RegExp(`#deadline[\\/:]${currentDateStr}\\b`, 'gi'), `#deadline/${newDate}`);
										return ensureUrgentTagForShortDeadline(replaced);
									}
									return line;
								})
								.join('\n')
						);
					}, currentDateStr).open();
				}
			},
			onKilitliClick: async (span) => {
				await toggleLockInActiveFile(plugin, span);
			},
			onQuestionClick: (_span, _e, currentText) => {
				editQuestionInActiveFile(currentText);
			}
		});

		node.replaceWith(replacementEl);
	});

	// Replace plain text #?[...] and #? occurrences that Obsidian didn't turn into a.tag
	const textWalker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
	const textNodesToReplace: Text[] = [];
	let currentNode: Node | null;
	while ((currentNode = textWalker.nextNode())) {
		const text = currentNode.textContent || '';
		if (text.includes('#?')) {
			textNodesToReplace.push(currentNode as Text);
		}
	}

	for (const tNode of textNodesToReplace) {
		const parent = tNode.parentElement;
		if (!parent || parent.closest('.dash-drop-question-tag')) continue;
		const text = tNode.textContent || '';
		const qRegex = /(#\?\[[^\]]*\]|#\?)/g;
		let match;
		let lastIdx = 0;
		const frag = document.createDocumentFragment();
		let hasMatch = false;

		while ((match = qRegex.exec(text)) !== null) {
			hasMatch = true;
			const pre = text.slice(lastIdx, match.index);
			if (pre) frag.appendChild(document.createTextNode(pre));

			const rawTag = match[1];
			const visual = resolveTagVisual(rawTag, parent.textContent || rawTag, tagMap);
			if (visual) {
				const qEl = createResolvedTagDOM(visual, {
					onQuestionClick: (_span, _e, currentText) => {
						editQuestionInActiveFile(currentText);
					}
				});
				frag.appendChild(qEl);
			} else {
				frag.appendChild(document.createTextNode(rawTag));
			}
			lastIdx = qRegex.lastIndex;
		}

		if (hasMatch) {
			const post = text.slice(lastIdx);
			if (post) frag.appendChild(document.createTextNode(post));
			parent.replaceChild(frag, tNode);
		}
	}

	// 2. Tree Lock on Headers (h1-h6 with #kilitli)
	const headers = el.querySelectorAll('h1, h2, h3, h4, h5, h6');
	headers.forEach((header) => {
		const text = header.textContent || '';
		if (text.includes('#kilitli') || header.querySelector('.dash-drop-emoji-tag[title*="kilit"]') || header.querySelector('.dash-drop-emoji-tag[title*="Kilit"]')) {
			checkReadingViewHeaderLock(header as HTMLElement);
		}
	});

	// 3. Tree Lock on List Items (bullets, numbers, todos)
	const listItems = el.querySelectorAll('li');
	listItems.forEach((li) => {
		const text = li.textContent || '';
		if (text.includes('#kilitli') || li.querySelector('.dash-drop-emoji-tag[title*="kilit"]') || li.querySelector('.dash-drop-emoji-tag[title*="Kilit"]')) {
			checkReadingViewListLock(li as HTMLElement);
		}

		// Future Lock on li
		const tags = (text.match(/#[a-zA-Z0-9_\u00C0-\u017F\u0400-\u04FF\-\/:]+/g) || []).map(t => t.toLowerCase());
		if (tags.length > 0) {
			const dateInfo = evaluateTaskDate(text, tags, 0);
			if (settings.lockFutureTasks !== false && dateInfo.isLocked) {
				li.classList.add('mytasks-future-locked');
				const cb = li.querySelector('input[type="checkbox"]') as HTMLInputElement | null;
				if (cb) {
					cb.setAttribute('disabled', 'true');
					cb.title = `🔒 Henüz vakti gelmedi (${dateInfo.badgeLabel})`;
					cb.addEventListener('click', (e) => {
						e.preventDefault();
						e.stopPropagation();
						new Notice(`🔒 Henüz vakti gelmedi (${dateInfo.badgeLabel})`);
					}, { capture: true });
				}
			}
		}

		// Custom checkbox coloring for uncompleted tasks (#acil, #2dk, combo)
		const cbCheck = li.querySelector('input[type="checkbox"]') as HTMLInputElement | null;
		if (cbCheck && !cbCheck.checked) {
			const isAcil = /#(?:acil)\b/i.test(text);
			const is2dk = /#(?:2dk)\b/i.test(text);

			if (isAcil && is2dk) {
				li.classList.add('mytasks-combo-task');
			} else if (isAcil) {
				li.classList.add('mytasks-urgent-task');
			} else if (is2dk) {
				li.classList.add('mytasks-twomin-task');
			}
		}

		// Process / Tracking Checkbox Interception (no Notice popup!)
		const cb = li.querySelector('input[type="checkbox"]') as HTMLInputElement | null;
		if (cb && (text.includes('#süreç') || text.includes('#surec') || text.includes('#takip') || text.includes('#kontrol') || li.querySelector('.dash-drop-process-tag') || li.querySelector('.dash-drop-process-icon-only'))) {
			cb.addEventListener('click', async (e: MouseEvent) => {
				if (e.shiftKey || e.altKey) {
					return;
				}
				e.preventDefault();
				e.stopPropagation();
				cb.checked = false;
				await updateProcessDateInActiveFile(plugin, li);
			}, { capture: true });
		}

		// Repeating task (#tekrar / #rutin) increment on completion
		if (cb && (text.includes('#tekrar') || text.includes('#rutin'))) {
			cb.addEventListener('click', async (e: MouseEvent) => {
				const activeFile = plugin.app.workspace.getActiveFile();
				if (!activeFile) return;
				const targetRaw = (li.textContent || '').trim();
				e.preventDefault();
				e.stopPropagation();

				await plugin.app.vault.process(activeFile, (content) => {
					const lines = content.split('\n');
					const foundLineIdx = findMatchingTaskLineIndex(lines, targetRaw, /#(?:tekrar|rutin)\b/i);
					if (foundLineIdx !== -1) {
						const currentLine = lines[foundLineIdx];
						if (/^\s*(?:[-*+•]|\d+[.)])\s*\[ ]/.test(currentLine)) {
							const match = currentLine.match(/#(tekrar|rutin)(?:[\/:]([0-9]+))?\b/i);
							const tag = match ? match[1] : 'tekrar';
							const nextCount = (match && match[2] ? parseInt(match[2], 10) : 0) + 1;
							lines[foundLineIdx] = currentLine
								.replace(/#(tekrar|rutin)(?:[\/:]([0-9]+))?\b/i, `#${tag}/${nextCount}`)
								.replace(/\[ ]/, '[x]');
							return lines.join('\n');
						}
					}
					return content;
				});
			}, { capture: true });
		}
	});
}

export function checkReadingViewHeaderLock(header: HTMLElement) {
	const currentLevel = parseInt(header.tagName.replace(/^H/i, ''), 10) || 1;
	let sibling = header.nextElementSibling as HTMLElement | null;
	const childTaskElements: HTMLElement[] = [];
	let hasKilitsizChild = false;

	while (sibling) {
		const isHeader = /^H[1-6]$/i.test(sibling.tagName);
		if (isHeader) {
			const sibLevel = parseInt(sibling.tagName.replace(/^H/i, ''), 10) || 1;
			if (sibLevel <= currentLevel) {
				break;
			}
		}

		const tasksInBlock = sibling.querySelectorAll('.task-list-item');
		tasksInBlock.forEach((t) => childTaskElements.push(t as HTMLElement));

		const text = sibling.textContent || '';
		if (text.includes('#kilitsiz') ||
			sibling.querySelector('.dash-drop-emoji-tag[title="#kilitsiz"]') !== null ||
			sibling.querySelector('.dash-drop-hidden-tag[data-tag="#kilitsiz"]') !== null) {
			hasKilitsizChild = true;
		}

		sibling = sibling.nextElementSibling as HTMLElement | null;
	}

	let allDone = false;
	if (childTaskElements.length > 0) {
		allDone = childTaskElements.every((taskEl) => {
			const cb = taskEl.querySelector('input[type="checkbox"]') as HTMLInputElement | null;
			return cb && cb.checked;
		});
	} else if (hasKilitsizChild) {
		allDone = true;
	} else {
		allDone = false;
	}

	const headerText = header.textContent || '';
	const selfKilitsiz = headerText.includes('#kilitsiz') ||
		header.querySelector('.dash-drop-emoji-tag[title="#kilitsiz"]') !== null ||
		header.querySelector('.dash-drop-hidden-tag[data-tag="#kilitsiz"]') !== null;

	const lockTag = header.querySelector('.dash-drop-emoji-tag[title*="kilit"], .dash-drop-emoji-tag[title*="Kilit"]') as HTMLElement | null;

	if (!allDone && !selfKilitsiz) {
		header.classList.add('dash-drop-locked');
		if (lockTag) {
			lockTag.textContent = '🔒';
			lockTag.className = 'dash-drop-emoji-tag dash-drop-locked-tag dash-drop-toggleable';
			lockTag.title = '🔒 Kilitli (Tıkla: Kilidi Aç)';
		}
	} else {
		header.classList.remove('dash-drop-locked');
		if (lockTag) {
			lockTag.textContent = '🔓';
			lockTag.className = 'dash-drop-emoji-tag dash-drop-unlocked-tag dash-drop-toggleable';
			lockTag.title = '🔓 Kilit Açık (Tüm alt görevler tamamlandı)';
		}
	}
}

export function checkReadingViewListLock(parentLi: HTMLElement) {
	const subList = parentLi.querySelector('ul, ol');
	if (!subList) return;

	const directChildTasks = subList.querySelectorAll(':scope > li.task-list-item');
	let allDone = false;

	if (directChildTasks.length > 0) {
		allDone = Array.from(directChildTasks).every((taskEl) => {
			const cb = taskEl.querySelector('input[type="checkbox"]') as HTMLInputElement | null;
			return cb && cb.checked;
		});
	} else {
		const anyChildren = subList.querySelectorAll(':scope > li');
		if (anyChildren.length > 0) {
			allDone = Array.from(anyChildren).some((childLi) => {
				const text = childLi.textContent || '';
				return text.includes('#kilitsiz') ||
					childLi.querySelector('.dash-drop-emoji-tag[title="#kilitsiz"]') !== null ||
					childLi.querySelector('.dash-drop-hidden-tag[data-tag="#kilitsiz"]') !== null;
			});
		} else {
			allDone = false;
		}
	}

	const text = parentLi.textContent || '';
	const hasKilitsiz = text.includes('#kilitsiz') ||
		parentLi.querySelector('.dash-drop-emoji-tag[title="#kilitsiz"]') !== null ||
		parentLi.querySelector('.dash-drop-hidden-tag[data-tag="#kilitsiz"]') !== null;

	const parentCb = parentLi.querySelector(':scope > input[type="checkbox"], :scope > .task-list-item-checkbox') as HTMLInputElement | null;
	const lockTag = parentLi.querySelector('.dash-drop-emoji-tag[title*="kilit"], .dash-drop-emoji-tag[title*="Kilit"]') as HTMLElement | null;

	if (!allDone && !hasKilitsiz) {
		parentLi.classList.add('dash-drop-locked');
		if (parentCb) {
			parentCb.setAttribute('disabled', 'true');
			parentCb.title = '🔒 Alt görevler tamamlanmadan bu görev kilitlidir!';
			parentCb.addEventListener('click', (e) => {
				e.preventDefault();
				e.stopPropagation();
				new Notice('🔒 Alt görevler tamamlanmadan bu görev kilitlidir!');
			}, { capture: true });
		}
		if (lockTag) {
			lockTag.textContent = '🔒';
			lockTag.className = 'dash-drop-emoji-tag dash-drop-locked-tag dash-drop-toggleable';
			lockTag.title = '🔒 Kilitli (Tıkla: Kilidi Aç)';
		}
	} else {
		parentLi.classList.remove('dash-drop-locked');
		if (parentCb) {
			parentCb.removeAttribute('disabled');
			parentCb.title = '';
		}
		if (lockTag) {
			lockTag.textContent = '🔓';
			lockTag.className = 'dash-drop-emoji-tag dash-drop-unlocked-tag dash-drop-toggleable';
			lockTag.title = '🔓 Kilit Açık (Tüm alt görevler tamamlandı)';
		}
	}
}
