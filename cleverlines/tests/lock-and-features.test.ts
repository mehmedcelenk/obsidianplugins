import * as assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ensureAggregatorBlock, getAggregatorNotePath, isAggregatorNotePath } from '../src/aggregator-note';
import { extractBlockIdsFromContent } from '../src/block-extractor';
import { getTaskPriorityWeight, moveAtomicLineBlock, sortTaskLinesByPriority } from '../src/block-mover';
import { ensureUrgentTagForShortDeadline, evaluateTaskDate, formatDmyDate, formatIsoDate, getDeadlineDisplay, getProcessControlDisplay } from '../src/dates';
import { computeDocumentLockState, isTaskLineLocked } from '../src/lock-engine';
import { extractQuestionText, extractTaskTags, getTaskDisplayText, isChipVisual, mergeTaskDisplayText, resolveTagVisual, sortTaskVisualsForPrefix } from '../src/tag-registry';
import { clearAllTimers, formatTimerSeconds, getActiveRunningTimers, getOrCreateTimer, parseTimerMinutes, stopAllTaskTimers, toggleTaskTimer } from '../src/timer-manager';

describe('Task board note safety', () => {
	it('preserves existing note content when adding the board', () => {
		const original = '# Notlarım\n\nÖnemli metin';
		const updated = ensureAggregatorBlock(original);
		assert.ok(updated.startsWith(original));
		assert.ok(updated.includes('```dash-tasks\n```'));
		assert.equal(ensureAggregatorBlock(updated), updated);
	});

	it('migrates a legacy tasks block in the board note', () => {
		const original = '# Görevler\n\n```tasks\n```\n';
		const updated = ensureAggregatorBlock(original);
		assert.equal(updated, '# Görevler\n\n```dash-tasks\n```\n');
		assert.equal(ensureAggregatorBlock(updated), updated);
	});

	it('matches the configured full path, not a duplicate filename', () => {
		const path = getAggregatorNotePath('Panolar/TÜM GÖREVLER.md');
		assert.equal(path, 'Panolar/TÜM GÖREVLER.md');
		assert.equal(isAggregatorNotePath('Panolar/TÜM GÖREVLER.md', path), true);
		assert.equal(isAggregatorNotePath('Arşiv/TÜM GÖREVLER.md', path), false);
	});
});

describe('Lock Engine & # Features Test Suite', () => {

	describe('1. Tree Lock Hierarchy (#kilitli & #kilitsiz)', () => {
		it('should disable only future-date locks when the setting is off', () => {
			const doc = [
				'- [ ] Yarın yapılacak #yarın',
				'- [ ] Alt görevleri bekleyen #kilitli',
				'    - [ ] Alt görev'
			];

			const state = computeDocumentLockState(doc, false);
			assert.equal(state.lockedLines.has(0), false, 'Future task should be actionable');
			assert.equal(state.lockedLines.get(1)?.lockType, 'tree', 'Tree lock should remain active');
		});
		it('should lock parent task when child tasks are incomplete', () => {
			const doc = [
				'- [ ] Ana Görev #kilitli',
				'    - [ ] Alt görev 1',
				'    - [ ] Alt görev 2'
			];

			const state = computeDocumentLockState(doc);
			assert.equal(state.lockedLines.has(0), true, 'Parent line 0 should be locked');
			const lockInfo = state.lockedLines.get(0)!;
			assert.equal(lockInfo.isLocked, true);
			assert.equal(lockInfo.lockType, 'tree');
			assert.match(lockInfo.reason, /Alt görevler tamamlanmadan/);

			assert.equal(state.lockedLines.has(1), false, 'Child 1 should be unlocked and actionable');
			assert.equal(state.lockedLines.has(2), false, 'Child 2 should be unlocked and actionable');
		});

		it('should keep parent locked when only 1 of 2 child tasks is completed', () => {
			const doc = [
				'- [ ] Ana Görev #kilitli',
				'    - [x] Alt görev 1',
				'    - [ ] Alt görev 2'
			];

			const state = computeDocumentLockState(doc);
			assert.equal(state.lockedLines.has(0), true, 'Parent should remain locked');
			assert.match(state.lockedLines.get(0)!.reason, /1 görev kaldı/);
		});

		it('should automatically UNLOCK parent when ALL child tasks are completed', () => {
			const doc = [
				'- [ ] Ana Görev #kilitli',
				'    - [x] Alt görev 1',
				'    - [x] Alt görev 2'
			];

			const state = computeDocumentLockState(doc);
			assert.equal(state.lockedLines.has(0), false, 'Parent should be unlocked');
			assert.equal(state.unlockedKilitliLines.has(0), true, 'Parent should be marked in unlockedKilitliLines');
		});

		it('should explicitly unlock any node containing #kilitsiz', () => {
			const doc = [
				'- [ ] Ana Görev #kilitli #kilitsiz',
				'    - [ ] Alt görev 1',
				'    - [ ] Alt görev 2'
			];

			const state = computeDocumentLockState(doc);
			assert.equal(state.lockedLines.has(0), false, 'Parent with #kilitsiz should never be locked');
			assert.equal(state.unlockedKilitliLines.has(0), true);
		});

		it('should count a child with #kilitsiz as resolved for parent', () => {
			const doc = [
				'- [ ] Ana Görev #kilitli',
				'    - [x] Alt görev 1',
				'    - [ ] Alt görev 2 #kilitsiz'
			];

			const state = computeDocumentLockState(doc);
			assert.equal(state.lockedLines.has(0), false, 'Parent should be unlocked because remaining child is #kilitsiz');
		});

		it('should handle multi-tier cascade (Grandparent -> Parent -> Child)', () => {
			const doc = [
				'- [ ] Büyük Proje #kilitli',
				'    - [ ] Aşama 1 #kilitli',
				'        - [ ] Alt Adım 1.1',
				'        - [ ] Alt Adım 1.2',
				'    - [ ] Aşama 2'
			];

			let state = computeDocumentLockState(doc);
			assert.equal(state.lockedLines.has(0), true, 'Grandparent locked');
			assert.equal(state.lockedLines.has(1), true, 'Aşama 1 locked');
			assert.equal(state.lockedLines.has(2), false, 'Leaf 1.1 actionable');
			assert.equal(state.lockedLines.has(3), false, 'Leaf 1.2 actionable');

			doc[2] = '        - [x] Alt Adım 1.1';
			doc[3] = '        - [x] Alt Adım 1.2';
			state = computeDocumentLockState(doc);
			assert.equal(state.lockedLines.has(1), false, 'Aşama 1 should now be unlocked!');
			assert.equal(state.lockedLines.has(0), true, 'Grandparent still locked (Aşama 1 & 2 not yet checked)');

			doc[1] = '    - [x] Aşama 1 #kilitli';
			doc[4] = '    - [x] Aşama 2';
			state = computeDocumentLockState(doc);
			assert.equal(state.lockedLines.has(0), false, 'Grandparent should now be fully unlocked!');
			assert.equal(state.unlockedKilitliLines.has(0), true);
		});

		it('should lock header sections with #kilitli until all section tasks are done', () => {
			const doc = [
				'## Aşama 1 #kilitli',
				'- [ ] Görev A',
				'- [ ] Görev B',
				'## Aşama 2',
				'- [ ] Başka Görev'
			];

			let state = computeDocumentLockState(doc);
			assert.equal(state.lockedLines.has(0), true, 'Header 0 should be locked');

			doc[1] = '- [x] Görev A';
			doc[2] = '- [x] Görev B';
			state = computeDocumentLockState(doc);
			assert.equal(state.lockedLines.has(0), false, 'Header 0 should be unlocked when section tasks are completed');
			assert.equal(state.unlockedKilitliLines.has(0), true);
		});

		it('should lock standalone #kilitli task with no children until completed or unlocked', () => {
			const doc = [
				'- [ ] Tek Başına Görev #kilitli'
			];

			let state = computeDocumentLockState(doc);
			assert.equal(state.lockedLines.has(0), true);

			doc[0] = '- [x] Tek Başına Görev #kilitli';
			state = computeDocumentLockState(doc);
			assert.equal(state.lockedLines.has(0), false);
		});

		it('isTaskLineLocked helper should return correct lock status and reason', () => {
			const doc = [
				'- [ ] Ana Görev #kilitli',
				'    - [ ] Alt görev'
			];

			const res0 = isTaskLineLocked(doc, 0);
			assert.equal(res0.isLocked, true);
			assert.equal(res0.lockType, 'tree');

			const res1 = isTaskLineLocked(doc, 1);
			assert.equal(res1.isLocked, false);
		});
	});

	describe('2. Date & Future Lock Evaluation', () => {
		it('should mark #bugün as today and NOT locked', () => {
			const info = evaluateTaskDate('İş yap #bugün', ['#bugün'], 0);
			assert.equal(info.category, 'today');
			assert.equal(info.isLocked, false);
			assert.equal(info.badgeLabel, 'Bugün');
		});

		it('should mark #dün as yesterday and NOT locked', () => {
			const info = evaluateTaskDate('Dünden kalan #dün', ['#dün'], 0);
			assert.equal(info.category, 'yesterday');
			assert.equal(info.isLocked, false);
			assert.equal(info.badgeLabel, 'Dün');
		});

		it('should mark #yarın as tomorrow and LOCKED', () => {
			const info = evaluateTaskDate('Yarın yapılacak #yarın', ['#yarın'], 0);
			assert.equal(info.category, 'tomorrow');
			assert.equal(info.isLocked, true);
			assert.equal(info.badgeLabel, 'Yarın');
		});

		it('should lock future Turkish weekday tags', () => {
			const info = evaluateTaskDate('Salı günü işi #salı', ['#salı'], 0);
			assert.equal(info.isLocked, true);
		});

		it('should unlock future task if it explicitly contains #kilitsiz', () => {
			const doc = [
				'- [ ] Yarın yapılacak iş #yarın #kilitsiz'
			];
			const state = computeDocumentLockState(doc);
			assert.equal(state.lockedLines.has(0), false, 'Should be unlocked because of #kilitsiz');
		});

		it('should compute deadline displays accurately and format DMY dates', () => {
			const now = new Date();
			const todayStr = formatIsoDate(now);
			const todayDl = getDeadlineDisplay(todayStr);
			assert.equal(todayDl.status, 'today');
			assert.equal(todayDl.icon, '');
			assert.equal(todayDl.displayText, '0g');

			const dmy = formatDmyDate(new Date(2026, 9, 20));
			assert.equal(dmy, '20.10.2026');

			const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);
			const tomorrowDl = getDeadlineDisplay(formatIsoDate(tomorrow));
			assert.equal(tomorrowDl.status, 'tomorrow');
			assert.equal(tomorrowDl.icon, '');
			assert.equal(tomorrowDl.displayText, '1g');

			const past = new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000);
			const pastDl = getDeadlineDisplay(formatIsoDate(past));
			assert.equal(pastDl.status, 'overdue');
			assert.equal(pastDl.icon, '');
			assert.equal(pastDl.displayText, '-2g');
		});

		it('should compute process control display with SKT and relative time', () => {
			const now = new Date(2026, 9, 19, 14, 35, 0); // 2026-10-19 14:35
			// Checked 5 minutes ago today at 14:30
			const pToday = getProcessControlDisplay('2026-10-19-14-30', now);
			assert.equal(pToday.status, 'today');
			assert.equal(pToday.displayText, '14:30');
			assert.equal(pToday.icon, 'eye');

			// Checked yesterday
			const pYesterday = getProcessControlDisplay('2026-10-18', now);
			assert.equal(pYesterday.status, 'yesterday');
			assert.equal(pYesterday.displayText, 'dün');
			assert.equal(pYesterday.icon, 'eye');

			// Checked 2 days ago
			const pPast = getProcessControlDisplay('2026-10-17', now);
			assert.equal(pPast.status, 'warning');
			assert.equal(pPast.displayText, '2g');
			assert.equal(pPast.icon, 'eye');

			const pNone = getProcessControlDisplay(undefined);
			assert.equal(pNone.status, 'pending');
			assert.equal(pNone.displayText, '');
			assert.equal(pNone.icon, 'eye-off');
		});

		it('should automatically append #acil when deadline is 3 days or less (<= 3 days)', () => {
			const now = new Date();
			const tomorrowStr = formatIsoDate(new Date(now.getTime() + 24 * 60 * 60 * 1000));
			const in3DaysStr = formatIsoDate(new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000));
			const in5DaysStr = formatIsoDate(new Date(now.getTime() + 5 * 24 * 60 * 60 * 1000));

			const lineTomorrow = `- [ ] Raporu gönder #deadline/${tomorrowStr}`;
			assert.equal(ensureUrgentTagForShortDeadline(lineTomorrow), `- [ ] Raporu gönder #deadline/${tomorrowStr} #acil`);

			// 3 days left should ALSO get #acil
			const line3Days = `- [ ] Raporu gönder #deadline/${in3DaysStr}`;
			assert.equal(ensureUrgentTagForShortDeadline(line3Days), `- [ ] Raporu gönder #deadline/${in3DaysStr} #acil`);

			// Should not duplicate #acil if already present
			const alreadyUrgent = `- [ ] Raporu gönder #deadline/${in3DaysStr} #acil`;
			assert.equal(ensureUrgentTagForShortDeadline(alreadyUrgent), alreadyUrgent);

			// Should NOT add #acil if 4+ days left (e.g. 5 days)
			const line5Days = `- [ ] Raporu gönder #deadline/${in5DaysStr}`;
			assert.equal(ensureUrgentTagForShortDeadline(line5Days), line5Days);
		});
	});

	describe('3. Daily Rollover Transformation Rules (#tekrar & #rutin)', () => {
		it('should roll #bugün to #dün on uncompleted tasks', () => {
			const content = '- [ ] Yapılacak iş #bugün\n- [x] Tamamlanan iş #bugün';
			const bugunRegex = /^(\s*(?:[-*+•]|\d+[.)])\s*\[ ])(.*?)(#(?:bugün|bugun)\b)(.*)$/gim;
			const updated = content.replace(bugunRegex, '$1$2#dün$4');

			assert.match(updated, /- \[ ] Yapılacak iş #dün/);
			assert.match(updated, /- \[x] Tamamlanan iş #bugün/, 'Completed task should not be touched');
		});

		it('should roll #yarın to #bugün on uncompleted tasks', () => {
			const content = '- [ ] Gelecek iş #yarın';
			const yarinRegex = /^(\s*(?:[-*+•]|\d+[.)])\s*\[ ])(.*?)(#(?:yarın|yarin)\b)(.*)$/gim;
			const updated = content.replace(yarinRegex, '$1$2#bugün$4');

			assert.match(updated, /- \[ ] Gelecek iş #bugün/);
		});

		it('should reset completed #tekrar and #rutin tasks back to unchecked', () => {
			const content = '- [x] Günlük su iç #tekrar\n- [x] Kitap oku #rutin';
			const tekrarRegex = /^(\s*(?:[-*+•]|\d+[.)])\s*)\[[xX]](.*?)(#(?:tekrar|rutin)\b)(.*)$/gim;
			const updated = content.replace(tekrarRegex, '$1[ ]$2$3$4');

			assert.match(updated, /- \[ ] Günlük su iç #tekrar/);
			assert.match(updated, /- \[ ] Kitap oku #rutin/);
		});
	});

	describe('4. Block Priority Sorting (#acil top, #2dk bottom) & Single-line #1', () => {
		it('should sort #acil to the top and #2dk to the bottom of a block', () => {
			const getWeight = (line: string) => {
				const hasAcil = /(?:^|\s)#acil\b/i.test(line);
				const has2dk = /(?:^|\s)#2dk\b/i.test(line);
				if (hasAcil && !has2dk) return 2;
				if (hasAcil && has2dk) return 1;
				if (has2dk) return -1;
				return 0;
			};

			const lines = [
				'- [ ] Normal görev A',
				'- [ ] Hızlı görev #2dk',
				'- [ ] Normal görev B',
				'- [ ] Çok önemli #acil'
			];

			const sorted = [...lines].sort((a, b) => getWeight(b) - getWeight(a));
			assert.equal(sorted[0], '- [ ] Çok önemli #acil', '#acil must be at the top');
			assert.equal(sorted[1], '- [ ] Normal görev A', 'Normal A stays in middle');
			assert.equal(sorted[2], '- [ ] Normal görev B', 'Normal B stays in middle');
			assert.equal(sorted[3], '- [ ] Hızlı görev #2dk', '#2dk must be at the bottom');
		});

		it('should extract #number from any position on a single line', () => {
			const line1 = '- [ ] #3 Başta numara';
			const line2 = '- [ ] Ortada #2 numara iş';
			const line3 = '- [ ] Sonda numara #1';

			const extract = (t: string) => {
				const match = t.match(/(?:^|\s+)#([0-9]+)(?:\.|\s+|$)/);
				return match ? parseInt(match[1], 10) : 0;
			};

			assert.equal(extract(line1), 3);
			assert.equal(extract(line2), 2);
			assert.equal(extract(line3), 1);
		});
	});

	describe('5. Task Countdown Timer (#120dk -> start -> pause -> resume -> kafi)', () => {
		it('should parse #<N>dk timer tags and ignore #2dk', () => {
			assert.equal(parseTimerMinutes('#120dk'), 120);
			assert.equal(parseTimerMinutes('#45dk'), 45);
			assert.equal(parseTimerMinutes('#2dk'), null, '#2dk is quick task tag, not timer');
			assert.equal(parseTimerMinutes('#acil'), null);
		});

		it('should format timer seconds and cycle states (idle -> running -> paused -> running)', () => {
			assert.equal(formatTimerSeconds(120 * 60), '120:00');
			assert.equal(formatTimerSeconds(65), '01:05');

			const key = 'test-study::120dk';
			const initial = getOrCreateTimer(key, 120);
			assert.equal(initial.status, 'idle');
			assert.equal(initial.remainingSeconds, 7200);

			// Click 1: Start
			const s1 = toggleTaskTimer(key, 120);
			assert.equal(s1.status, 'running');

			// Click 2: Pause
			const s2 = toggleTaskTimer(key, 120);
			assert.equal(s2.status, 'paused');

			// Click 3: Resume
			const s3 = toggleTaskTimer(key, 120);
			assert.equal(s3.status, 'running');

			stopAllTaskTimers();
		});
	});

	describe('6. Hierarchical Atomic Block Moving (Alt+Up / Alt+Down)', () => {
		it('should identify task with its indented children as a single atomic block', async () => {
			const { Text } = await import('@codemirror/state');
			const { findAtomicBlock } = await import('../src/block-mover');

			const text = [
				'- [ ] Ana Görev',
				'    - [ ] Alt görev 1',
				'    - [ ] Alt görev 2',
				'- [ ] Diğer Görev'
			].join('\n');
			const doc = Text.of(text.split('\n'));

			const block1 = findAtomicBlock(doc, 1);
			assert.ok(block1);
			assert.equal(block1.startLine, 1);
			assert.equal(block1.endLine, 3, 'End line must include indented children lines 2 and 3');

			const block2 = findAtomicBlock(doc, 4);
			assert.ok(block2);
			assert.equal(block2.startLine, 4);
			assert.equal(block2.endLine, 4);
		});

		it('should swap atomic blocks and keep children attached', async () => {
			const { swapDocLines } = await import('../src/block-mover');

			const lines = [
				'- [ ] Görev A',
				'    - [ ] Alt A1',
				'    - [ ] Alt A2',
				'- [ ] Görev B'
			];

			const { newLines } = swapDocLines(lines, { start: 0, end: 2 }, { start: 3, end: 3 });

			assert.equal(newLines[0], '- [ ] Görev B', 'Görev B should now be at top');
			assert.equal(newLines[1], '- [ ] Görev A', 'Görev A should follow Görev B');
			assert.equal(newLines[2], '    - [ ] Alt A1', 'Alt A1 must remain attached to Görev A');
			assert.equal(newLines[3], '    - [ ] Alt A2', 'Alt A2 must remain attached to Görev A');
		});

		it('should drag a task block after a sibling without detaching children', () => {
			const lines = [
				'- [ ] Görev A',
				'    - [ ] Alt A1',
				'- [ ] Görev B',
				'- [ ] Görev C'
			];

			const moved = moveAtomicLineBlock(lines, 0, 2, 'after');
			assert.deepEqual(moved, [
				'- [ ] Görev B',
				'- [ ] Görev A',
				'    - [ ] Alt A1',
				'- [ ] Görev C'
			]);
		});

		it('should reject dragging across hierarchy levels', () => {
			const lines = [
				'- [ ] Ana görev',
				'    - [ ] Alt görev',
				'- [ ] Diğer görev'
			];

			assert.equal(moveAtomicLineBlock(lines, 1, 2, 'before'), null);
		});
	});

	describe('7. Centralized Tag Registry SSOT (resolveTagVisual)', () => {
		it('should resolve all tag kinds from a single source of truth', () => {
			assert.equal(resolveTagVisual('#120dk', '- [ ] Ders çalış #120dk')?.kind, 'timer');
			assert.equal(resolveTagVisual('#acil', '- [ ] Acil iş #acil')?.kind, 'urgent');
			assert.equal(resolveTagVisual('#tekrar', '- [ ] Su iç #tekrar')?.labelText, '1. Tekrar');
			assert.equal(resolveTagVisual('#tekrar/2', '- [ ] Su iç #tekrar/2')?.labelText, '3. Tekrar');
			assert.equal(resolveTagVisual('#rutin/5', '- [ ] Su iç #rutin/5')?.labelText, '6. Tekrar');
			assert.equal(resolveTagVisual('#yakında', '- [ ] Yakında yapılacak #yakında')?.labelText, 'Yakında');
			assert.equal(resolveTagVisual('#bugün', '- [ ] Bugün #bugün')?.kind, 'today');
			assert.equal(resolveTagVisual('#bugün', '- [ ] Bugün #bugün')?.labelText, 'Bugün');
			assert.equal(resolveTagVisual('#dışarda', '- [ ] Alışveriş #dışarda')?.emoji, '🚗');
			assert.equal(resolveTagVisual('#disarda', '- [ ] Alışveriş #disarda')?.emoji, '🚗');
			assert.equal(resolveTagVisual('#evde', '- [ ] Temizlik #evde')?.emoji, '🏠');
			assert.equal(resolveTagVisual('#yarın', '- [ ] Yarın #yarın')?.kind, 'day-lock');
			assert.equal(resolveTagVisual('#yarın', '- [ ] Yarın #yarın')?.labelText, 'Yarın');
			assert.equal(resolveTagVisual('#çarşamba', '- [ ] Çarşamba #çarşamba')?.labelText, 'Çarşamba');
			assert.equal(resolveTagVisual('#kilitli', '- [ ] Ana görev #kilitli')?.kind, 'kilitli');
			assert.equal(resolveTagVisual('#kilitli', '- [ ] Ana görev #kilitli')?.emoji, '');
			assert.equal(resolveTagVisual('#kilitsiz', '- [ ] Açık #kilitsiz')?.kind, 'hidden');
		});

		it('should sort task prefix visuals: 1. #2dk, 2. #acil, 3. other emojis, 4. chips', () => {
			const v2dk = resolveTagVisual('#2dk', '- [ ] test #2dk')!;
			const vAcil = resolveTagVisual('#acil', '- [ ] test #acil')!;
			const vEvde = resolveTagVisual('#evde', '- [ ] test #evde')!;
			const vDeadline = resolveTagVisual('#deadline/2026-10-30', '- [ ] test #deadline/2026-10-30')!;

			// Scrambled input: deadline first, then evde, then acil, then 2dk
			const input = [vDeadline, vEvde, vAcil, v2dk];
			const sorted = sortTaskVisualsForPrefix(input);

			assert.equal(sorted[0].rawTag, '#2dk', '#2dk must be first');
			assert.equal(sorted[1].rawTag, '#acil', '#acil must be second');
			assert.equal(sorted[2].rawTag, '#evde', 'other emojis must be third');
			assert.equal(sorted[3].rawTag, '#deadline/2026-10-30', 'chips must be last');
		});
	});

	describe('8. Question Tag (#? & #?[...]) Resolution & Extraction', () => {
		it('should parse question tags and keep tags outside the editable board title', () => {
			const text = 'Yapay zekâya sor #?[OpenAI] #bugün #deadline/2026-10-30';
			assert.deepEqual(extractTaskTags(text), ['#?[openai]', '#bugün', '#deadline/2026-10-30']);
			assert.equal(getTaskDisplayText(text), 'Yapay zekâya sor');
			assert.equal(
				mergeTaskDisplayText(text, 'Yanıtı düzenle #acil'),
				'Yanıtı düzenle #acil #?[OpenAI] #bugün #deadline/2026-10-30'
			);
		});
		it('should extract question text correctly', () => {
			assert.equal(extractQuestionText('#?[Hangi kitap okunacak?]'), 'Hangi kitap okunacak?');
			assert.equal(extractQuestionText('#?neden_boyle'), 'neden boyle');
			assert.equal(extractQuestionText('#?'), '');
		});

		it('should resolve #? tags to question chip kind', () => {
			const tag1 = resolveTagVisual('#?[Hangi ayet?]', '- [ ] Fıkıh usulü #?[Hangi ayet?]');
			assert.ok(tag1);
			assert.equal(tag1.kind, 'question');
			assert.equal(tag1.questionText, 'Hangi ayet?');
			assert.equal(tag1.labelText, '? Hangi ayet?');

			const tag2 = resolveTagVisual('#?', '- [ ] Soru işareti #?');
			assert.ok(tag2);
			assert.equal(tag2.kind, 'question');
			assert.equal(tag2.labelText, '? soru');
		});
	});

	describe('9. Active Running Timers Listing for Control Panel', () => {
		it('should list running and paused timers accurately and parse #2dksonra', () => {
			clearAllTimers();
			const key1 = 'matematik::60dk';
			toggleTaskTimer(key1, 60);

			const active = getActiveRunningTimers();
			assert.equal(active.length, 1);
			assert.equal(active[0].status, 'running');
			assert.equal(active[0].minutes, 60);

			clearAllTimers();
			assert.equal(getActiveRunningTimers().length, 0);

			// Test timer parsing
			assert.equal(parseTimerMinutes('#2dksonra'), 2);
			assert.equal(parseTimerMinutes('#15dksonra'), 15);
			assert.equal(parseTimerMinutes('#45dk'), 45);
			assert.equal(parseTimerMinutes('#2dk'), null); // Plain #2dk is category, not timer
		});

		it('should identify chip visuals vs pure emoji visuals', () => {
			const dlVisual = resolveTagVisual('#deadline/2026-11-09', '- [ ] Görev #deadline/2026-11-09')!;
			assert.equal(isChipVisual(dlVisual), true);

			const routineVisual = resolveTagVisual('#tekrar', '- [ ] Görev #tekrar')!;
			assert.equal(isChipVisual(routineVisual), true);

			const acilVisual = resolveTagVisual('#acil', '- [ ] Görev #acil')!;
			assert.equal(isChipVisual(acilVisual), false);

			const twoMinVisual = resolveTagVisual('#2dk', '- [ ] Görev #2dk')!;
			assert.equal(isChipVisual(twoMinVisual), false);
		});
	});

	describe('11. Block Priority Sorting (#acil top, #2dk bottom of active, completed at end)', () => {
		it('should calculate priority weights correctly', () => {
			assert.equal(getTaskPriorityWeight('- [ ] ÖZETLER FİYAT Al #acil'), 20);
			assert.equal(getTaskPriorityWeight('- [ ] GÜLAL KIZILBULUT #acil #2dk'), 15);
			assert.equal(getTaskPriorityWeight('- [ ] 12 sınıflar kac sınava girebiliyor'), 10);
			assert.equal(getTaskPriorityWeight('- [ ] İŞKUR HATIRLAT #2dk'), 5);
			assert.equal(getTaskPriorityWeight('- [x] FASİKÜLLER SİPARİŞ VER #acil'), -5);
			assert.equal(getTaskPriorityWeight('- [x] BİTEN GÖREV'), -15);
			assert.equal(getTaskPriorityWeight('- [x] BİTEN 2DK #2dk'), -20);
		});

		it('should sort an entire section preserving subtasks under their parent', () => {
			const input = [
				'- [ ] Normal görev 1',
				'- [ ] İŞKUR HATIRLAT #2dk',
				'- [ ] ÖZETLER FİYAT Al #acil',
				'- [x] FASİKÜLLER SİPARİŞ VER #acil',
				'\t- E 2 3 4 5 6',
				'\t- T 3',
				'- [ ] HOCALAR YOKLAMASı #acil',
				'- [ ] BİYOMETRİK FOTO #2dk'
			];

			const sorted = sortTaskLinesByPriority(input);

			// Expected order:
			// 1. #acil tasks at the very top:
			assert.equal(sorted[0], '- [ ] ÖZETLER FİYAT Al #acil');
			assert.equal(sorted[1], '- [ ] HOCALAR YOKLAMASı #acil');
			// 2. Normal tasks in middle:
			assert.equal(sorted[2], '- [ ] Normal görev 1');
			// 3. #2dk tasks at bottom of active:
			assert.equal(sorted[3], '- [ ] İŞKUR HATIRLAT #2dk');
			assert.equal(sorted[4], '- [ ] BİYOMETRİK FOTO #2dk');
			// 4. Completed task at bottom WITH child lines glued:
			assert.equal(sorted[5], '- [x] FASİKÜLLER SİPARİŞ VER #acil');
			assert.equal(sorted[6], '\t- E 2 3 4 5 6');
			assert.equal(sorted[7], '\t- T 3');
		});
	});
});
