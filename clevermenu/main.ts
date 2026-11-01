import { Editor, FuzzySuggestModal, Menu, Notice, Plugin, TFile } from 'obsidian';

export interface BlockItem {
	id: string;
	label: string;
}

/**
 * Extracts ^block-ids using Obsidian's native MetadataCache first,
 * falling back to line scanning for newly typed unsaved blocks.
 */
export function extractBlockIds(plugin: Plugin, file: TFile | null, content: string): BlockItem[] {
	const lines = content.split('\n');
	const items: BlockItem[] = [];
	const seen = new Set<string>();

	const addBlock = (id: string, lineText: string) => {
		if (seen.has(id)) return;
		seen.add(id);
		const snippet = lineText
			.replace(/\^[a-zA-Z0-9_\-\u00C0-\u017F]+/g, '')
			.replace(/<[^>]+>/g, '')
			.replace(/==/g, '')
			.replace(/^[-*+•\d.)\s]+/g, '')
			.trim()
			.slice(0, 60);
		items.push({
			id,
			label: snippet ? `^${id} • ${snippet}` : `^${id}`
		});
	};

	// 1. Native Obsidian MetadataCache blocks
	if (file) {
		const cache = plugin.app.metadataCache.getFileCache(file);
		if (cache?.blocks) {
			for (const [id, blockCache] of Object.entries(cache.blocks)) {
				const lineNo = blockCache.position.start.line;
				addBlock(id, lines[lineNo] || '');
			}
		}
	}

	// 2. Fallback scan for unsaved/unindexed lines in editor
	for (const line of lines) {
		const match = line.match(/\^([a-zA-Z0-9_\-\u00C0-\u017F]+)/);
		if (match) {
			addBlock(match[1], line);
		}
	}

	return items;
}

/**
 * Cycle selected text highlighting:
 * None -> Green -> Yellow -> Underline -> None
 */
export function cycleHighlightSelection(editor: Editor): boolean {
	const selection = editor.getSelection();
	if (!selection) return false;

	const greenMatch = selection.match(/^<mark\s+class="mytasks-hl-green">([\s\S]*?)<\/mark>$/);
	if (greenMatch) {
		editor.replaceSelection(`<mark class="mytasks-hl-yellow">${greenMatch[1]}</mark>`);
		new Notice('🟡 Sarı vurgulandı');
		return true;
	}

	const yellowMatch = selection.match(/^<mark\s+class="mytasks-hl-yellow">([\s\S]*?)<\/mark>$/);
	if (yellowMatch) {
		editor.replaceSelection(`<u class="mytasks-hl-underline">${yellowMatch[1]}</u>`);
		new Notice('✍️ Altı çizildi');
		return true;
	}

	const underMatch = selection.match(/^<u(?:\s+class="mytasks-hl-underline")?>([\s\S]*?)<\/u>$/);
	if (underMatch) {
		editor.replaceSelection(underMatch[1]);
		new Notice('⚪ Vurgu kaldırıldı');
		return true;
	}

	const mdMatch = selection.match(/^==([\s\S]*?)==$/);
	if (mdMatch) {
		editor.replaceSelection(`<u class="mytasks-hl-underline">${mdMatch[1]}</u>`);
		new Notice('✍️ Altı çizildi');
		return true;
	}

	editor.replaceSelection(`<mark class="mytasks-hl-green">${selection}</mark>`);
	new Notice('🟢 Yeşil vurgulandı');
	return true;
}

export class BlockIdSuggestModal extends FuzzySuggestModal<BlockItem> {
	constructor(plugin: Plugin, private items: BlockItem[], private onChoose: (item: BlockItem) => void) {
		super(plugin.app);
		this.setPlaceholder('Sayfadaki ^blok bağlantısını seçin...');
	}
	getItems(): BlockItem[] { return this.items; }
	getItemText(item: BlockItem): string { return item.label; }
	onChooseItem(item: BlockItem): void { this.onChoose(item); }
}

export default class CleverMenuPlugin extends Plugin {
	async onload() {
		// Context Menu in Editor
		this.registerEvent(
			this.app.workspace.on('editor-menu', (menu: Menu, editor: Editor) => {
				const selectedText = editor.getSelection();
				if (!selectedText || !selectedText.trim()) return;

				// 1. "Hemen Vurgula"
				menu.addItem((item) => {
					item.setTitle('✨ Hemen Vurgula')
						.setIcon('highlighter')
						.setSection('action')
						.onClick(() => cycleHighlightSelection(editor));
				});

				// 2. Native hover submenu for [[#^block|selectedText]]
				const activeFile = this.app.workspace.getActiveFile();
				const blocks = extractBlockIds(this, activeFile, editor.getValue());

				menu.addItem((item) => {
					item.setTitle('🔗 Blok Bağlantısı Yap ([[#^...|seçim]])')
						.setIcon('link')
						.setSection('action');

					const sub = (item as any).setSubmenu ? (item as any).setSubmenu() as Menu : null;
					if (sub) {
						if (blocks.length === 0) {
							sub.addItem((subItem) => {
								subItem.setTitle('Bu sayfada ^blok bulunamadı').setDisabled(true);
							});
						} else {
							for (const b of blocks) {
								sub.addItem((subItem) => {
									subItem.setTitle(b.label)
										.setIcon('hash')
										.onClick(() => {
											editor.replaceSelection(`[[#^${b.id}|${selectedText}]]`);
										});
								});
							}
						}
					} else {
						item.onClick(() => {
							if (blocks.length === 0) {
								new Notice('⚠️ Bu sayfada "^" ile başlayan blok kimliği (^id) bulunamadı.');
								return;
							}
							new BlockIdSuggestModal(this, blocks, (chosen) => {
								editor.replaceSelection(`[[#^${chosen.id}|${selectedText}]]`);
							}).open();
						});
					}
				});
			})
		);

		this.addCommand({
			id: 'cycle-highlight-selection',
			name: 'Hemen Vurgula (Yeşil ➔ Sarı ➔ Alt Çizgi)',
			editorCallback: (editor: Editor) => cycleHighlightSelection(editor)
		});

		this.addCommand({
			id: 'link-selection-to-block',
			name: 'Seçili Metni Blok Kimliğine Bağla ([[#^id|seçim]])',
			editorCallback: (editor: Editor) => {
				const selectedText = editor.getSelection();
				if (!selectedText?.trim()) {
					new Notice('⚠️ Önce bir metin seçin.');
					return;
				}
				const blocks = extractBlockIds(this, this.app.workspace.getActiveFile(), editor.getValue());
				if (blocks.length === 0) {
					new Notice('⚠️ Bu sayfada "^" ile başlayan blok kimliği (^id) bulunamadı.');
					return;
				}
				new BlockIdSuggestModal(this, blocks, (chosen) => {
					editor.replaceSelection(`[[#^${chosen.id}|${selectedText}]]`);
				}).open();
			}
		});
	}
}



