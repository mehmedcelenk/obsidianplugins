const TASK_BOARD_BLOCK = '```dash-tasks\n```\n';
const TASK_BOARD_FENCE = /^ {0,3}```dash-tasks(?:[ \t].*)?$/m;
const LEGACY_TASKS_FENCE = /^([ \t]{0,3})```tasks([ \t]*)$/m;

export function getAggregatorNotePath(configuredName: string): string {
	const name = configuredName.trim().replace(/\.md$/i, '') || 'TÜM GÖREVLER';
	return `${name}.md`;
}

export function isAggregatorNotePath(filePath: string, aggregatorPath: string): boolean {
	return filePath === aggregatorPath;
}

export function ensureAggregatorBlock(content: string): string {
	if (TASK_BOARD_FENCE.test(content)) return content;
	if (LEGACY_TASKS_FENCE.test(content)) {
		return content.replace(LEGACY_TASKS_FENCE, '$1```dash-tasks$2');
	}
	if (!content) return TASK_BOARD_BLOCK;
	const separator = content.endsWith('\n\n') ? '' : content.endsWith('\n') ? '\n' : '\n\n';
	return `${content}${separator}${TASK_BOARD_BLOCK}`;
}
