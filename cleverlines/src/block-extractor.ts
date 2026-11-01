export interface BlockItem {
	id: string; // e.g. "k-asl"
	label: string; // e.g. "^k-asl • Kıyas-ı Asl: 10 ayet..."
	fullLine: string;
}

/**
 * Scans note lines for block IDs formatted as `^id`
 * Independent of Obsidian runtime so it can be tested directly in Node.js test suites.
 */
export function extractBlockIdsFromContent(content: string): BlockItem[] {
	const lines = content.split('\n');
	const items: BlockItem[] = [];
	const seen = new Set<string>();

	for (let i = 0; i < lines.length; i++) {
		const line = lines[i];
		// Match block IDs: e.g. ^k-asl
		const match = line.match(/\^([a-zA-Z0-9_\-\u00C0-\u017F]+)/);
		if (match) {
			const id = match[1];
			if (!seen.has(id)) {
				seen.add(id);
				const cleanLine = line
					.replace(/\^[a-zA-Z0-9_\-\u00C0-\u017F]+/g, '')
					.replace(/<[^>]+>/g, '')
					.replace(/==/g, '')
					.replace(/^[-*+•\d.)\s]+/g, '')
					.trim();
				const snippet = cleanLine.slice(0, 60);
				items.push({
					id,
					label: snippet ? `^${id} • ${snippet}` : `^${id}`,
					fullLine: line
				});
			}
		}
	}

	return items;
}

