/* eslint-disable no-mixed-spaces-and-tabs */
/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable @typescript-eslint/no-var-requires */
/* eslint-disable @typescript-eslint/no-unused-vars */
import {
	Notice,
	Plugin,
	TFile,
	WorkspaceLeaf,
	htmlToMarkdown,
	parseYaml,
	stringifyYaml,
} from "obsidian";
import { Chapter, EpubParser } from "./lib/EpubParser";
import { EpubImporterModal } from "./modal";
import { NoteParser } from "./lib/NoteParser";
import { DEFAULT_SETTINGS, EpubImporterSettings } from "./settings/settings";
import { EpubImporterSettingsTab } from "./settings/settingsTab";

import jetpack from "fs-jetpack";
import { getNotesWithTag } from "./utils/obsidianUtils";
import { Path } from "./utils/path";

export default class EpubImporterPlugin extends Plugin {
	vaultPath: string;
	settings: EpubImporterSettings;
	parser: EpubParser;
	BookNote: string;
	assetsPath: string;
	propertys: any;
	activeBook: string;
	activeLeaf: WorkspaceLeaf;
	async onload() {
		//@ts-ignore
		this.vaultPath = this.app.vault.adapter.basePath;
		await this.loadSettings();
		this.addSettingTab(new EpubImporterSettingsTab(this.app, this));
		this.addCommand({
			id: "import-epub",
			name: "Import epub to your vault",
			callback: () => {
				new EpubImporterModal(this.app, this, async (result) => {
					await this.import(result);
				}).open();
			},
		});
		this.addCommand({
			id: "sync-librarys",
			name: "Import all epub from librarys to your vault",
			callback: async () => {
				for (let i = 0; i < this.settings.librarys.length; i++) {
					const results = jetpack.find(this.settings.librarys[i], {
						matching: "**/**.epub",
					});
					for (let j = 0; j < results.length; j++) {
						await this.import(jetpack.path(results[j]));
					}
				}
			},
		});

		this.registerEvent(
			this.app.workspace.on("file-open", (file) => {
				if (!this.settings.autoOpenRightPanel) return;
				const bookNotePath = this.findBookNote(new Path(file.path));
				if (!bookNotePath) return this.activeLeaf.detach();
				const bookName = bookNotePath.split("/")[bookNotePath.split("/").length - 2];
				if (this.activeBook == bookName) return;
				if (this.activeLeaf) this.activeLeaf.detach();
				this.activeBook = bookName;
				this.activeLeaf = this.app.workspace.getRightLeaf(false);
				this.activeLeaf.setViewState({
					type: "markdown",
					state: {
						file: bookNotePath,
						mode: "preview",
						backlinks: false,
						source: false,
					},
				});
				this.activeLeaf.setPinned(true);
				this.app.workspace.revealLeaf(this.activeLeaf);
			})
		);

		this.registerEvent(
			this.app.workspace.on("quit", () => {
				this.activeLeaf.detach();
			})
		);

		this.registerEvent(
			this.app.workspace.on("file-open", () => {
				if (!this.settings.allbooks) return;
				const files_with_tag = getNotesWithTag(this.app, this.settings.tag);
				const allBooks = this.app.vault.getAbstractFileByPath("AllBooks.md");
				if (allBooks && allBooks instanceof TFile) {
					this.app.vault.modify(
						allBooks,
						files_with_tag
							.map((file) => `- [[${file.path}|${file.parent?.name}]]`)
							.join("\n")
					);
				} else {
					this.app.vault.create(
						"AllBooks.md",
						files_with_tag
							.map((file) => `[[${file.path}|${file.parent?.name}]]`)
							.join("\n")
					);
				}
			})
		);
	}
	onunload() {
		this.activeLeaf.detach();
	}

	async loadSettings(): Promise<void> {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings(): Promise<void> {
		await this.saveData(this.settings);
	}

	async import(epubPath: string) {
		const epubName = new Path(epubPath).stem;

		const { assetsPath, propertysTemplate, savePath, tag, granularity, imageFormat } =
			this.settings;

		this.assetsPath = assetsPath
			.replace("{{bookName}}", epubName)
			.replace("{{savePath}}", savePath);

		this.parser = new EpubParser(epubPath);
		await this.parser.init();

		this.propertys = parseYaml(
			Array.from(this.parser.meta).reduce(
				(template, [key, value]) => template.replace(`{{${key}}}`, value),
				propertysTemplate
			)
		);
		this.propertys.tags = (this.propertys.tags ?? []).concat([tag]);

		const savePathP = new Path(savePath);

		this.BookNote = "";

		const folder = savePathP.join(epubName);
		if (jetpack.exists(folder.string)) {
			if (this.settings.removeDuplicateFolders) {
				jetpack.remove(folder.string);
			} else {
				new Notice("Duplicate folder already exists.");
				return;
			}
		}
		await this.app.vault.createFolder(folder.string);

		this.copyImages();

		if (granularity != 0) {
			// when granularity>0, The entire book will be converted into a structured folder.
			for (const [i, cpt] of this.parser.chapters.entries()) {
				await this.Chapter2MD(cpt, folder.join(cpt.name), [i + 1]);
			}
			this.BookNote = "---\n" + stringifyYaml(this.propertys) + "\n---\n" + this.BookNote;
			await this.app.vault.create(folder.join(epubName + ".md").string, this.BookNote);
		} else {
			// when granularity=0, the The entire book will be converted into a note.
			let content = "";
			const Chapter2MD2 = (chapter: Chapter) => {
				content +=
					"\n\n" +
					NoteParser.parse(
						this.htmlToMarkdown(chapter.html),
						this.assetsPath,
						imageFormat
					);
				chapter.subItems.forEach(Chapter2MD2);
			};
			this.parser.chapters.forEach(Chapter2MD2);

			content = "---\n" + stringifyYaml(this.propertys) + "\n---\n" + content;
			await this.app.vault.create(
				Path.join(savePath, epubName, epubName + ".md", "/"),
				content
			);
		}

		jetpack.remove(this.parser.tmpPath);
	}

	copyImages() {
		const imagesPath = new Path("/", this.vaultPath, this.assetsPath);
		jetpack
			.find(this.parser.tmpPath, { matching: ["*.jpg", "*.jpeg", "*.png"] })
			.forEach((file) => {
				jetpack.copy(file, imagesPath.join(new Path(file).name).string, {
					overwrite: true,
				});
			});
		if (this.parser.coverPath) {
			this.propertys.cover = new Path(
				this.assetsPath,
				new Path(this.parser.coverPath).name
			).string;
		}
	}

	htmlToMarkdown(html: string): string {
		let content = htmlToMarkdown(html ? html : "");
		if (html && !content) {
			content = html.replace(/<[^>]+>/g, "");
		}
		return content;
	}

	async Chapter2MD(cpt: Chapter, notePath: Path, serialNumber: number[]) {
		if (this.settings.serialNumber) {
			notePath.data = notePath.data.map((item, index, array) => {
				if (index === array.length - 1) {
					const serialNumber2 = [...serialNumber];
					serialNumber2[0] -= this.settings.serialNumberDelta;
					return serialNumber2[0] >= 1 ? serialNumber2.join(".") + " " + item : item;
				}
				return item;
			});
		}

		const level = serialNumber.length;
		// restricted means that the file corresponding to the chapter will not be created.
		const restricted = level > this.settings.granularity;
		const noteName = notePath.name;
		const folderPath = notePath;
		if (level < this.settings.granularity && cpt.subItems.length) {
			await this.app.vault.createFolder(notePath.string);
			notePath = notePath.join(noteName);
		}

		const content = NoteParser.parse(
			this.htmlToMarkdown(cpt.html),
			this.assetsPath,
			this.settings.imageFormat
		);
		if (!restricted) {
			const notePathS = notePath.string + ".md";
			if (!this.app.vault.getAbstractFileByPath(notePathS)) {
				await this.app.vault.create(notePathS, content);
				this.BookNote += `${"\t".repeat(level - 1)}- [[${notePath.string.replace(
					/\\/g,
					"/"
				)}|${noteName}]]\n`;
			}
		} else {
			// for restricted chapters, their content will be appended to the notes of their parent chapter.
			let parentPath = notePath;
			const delta = level - this.settings.granularity;
			parentPath = parentPath.getParent(delta);
			const parentFile = this.app.vault.getAbstractFileByPath(
				parentPath.string + ".md"
			) as TFile;
			await this.app.vault.process(parentFile, (data) => {
				return data + "\n\n" + content;
			});
		}

		for (const [i, item] of cpt.subItems.entries()) {
			await this.Chapter2MD(item, folderPath.join(item.name), serialNumber.concat([i + 1]));
		}
	}

	findBookNote(notePath: Path): string {
		const epubName = notePath.getParent(
			notePath.length - new Path(this.settings.savePath).length - 1
		).name;

		const bookNotePath = new Path(this.settings.savePath).join(
			epubName,
			epubName + ".md"
		).string;
		const bookNote = this.app.vault.getAbstractFileByPath(bookNotePath);
		if (!bookNote) return;
		return bookNotePath;
	}
}
