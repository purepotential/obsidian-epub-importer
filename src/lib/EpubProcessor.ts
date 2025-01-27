import { EpubImporterSettings } from "../settings/settings";
import EpubParser, { Chapter } from "./EpubParser";
import * as path from "path";
import { normalize } from "../utils/utils";
import { App, Notice, parseYaml } from "obsidian";
import jetpack from "fs-jetpack";
import beautify from "js-beautify";
import { create } from "./TurndownService";
import { templateWithVariables, tFrontmatter } from "../utils/obsidianUtils";

export default class EpubProcessor {
    private app: App;
    private settings: EpubImporterSettings;
    private vaultPath: string;
    private parser: EpubParser;
    private BookNote = "";
    private assetsPath: string;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    private properties: any;

    constructor(app: App, settings: EpubImporterSettings, vaultPath: string) {
        this.app = app;
        this.settings = settings;
        this.vaultPath = vaultPath;
    }

    async importEpub(epubPath: string) {
        const epubName = normalize(path.basename(epubPath, path.extname(epubPath)).trim());
        const folderPath = this.setupFolderPath(epubName);
        if (!folderPath) return;

        await this.initializeParser(epubPath, epubName);
        await this.createBookFolder(folderPath);

        this.copyImages();

        if (this.settings.granularity === 0) {
            await this.createSingleNote(epubName, folderPath);
        } else {
            await this.createChapterNotes(folderPath, epubName);
        }

        jetpack.remove(this.parser.tmpPath);
        this.showSuccessNotice(epubName);
    }

    private setupFolderPath(epubName: string): string | null {
        const folderPath = path.posix.join(this.settings.savePath, normalize(epubName));

        if (jetpack.exists(path.posix.join(this.vaultPath, folderPath))) {
            if (this.settings.removeDuplicateFolders) {
                jetpack.remove(path.posix.join(this.vaultPath, folderPath));
            } else {
                new Notice("Duplicate folder already exists.");
                return null;
            }
        }
        return folderPath;
    }

    private async createBookFolder(folderPath: string) {
        await this.app.vault.createFolder(folderPath);
    }

    private async initializeParser(epubPath: string, epubName: string) {
        this.assetsPath = templateWithVariables(this.settings.assetsPath, {
            bookName: epubName,
            savePath: this.settings.savePath,
        });

        this.parser = new EpubParser(epubPath, this.settings.moreLog);
        await this.parser.init();
        if (this.settings.moreLog) console.log("toc is: ", this.parser.toc);

        this.properties = parseYaml(templateWithVariables(this.settings.mocPropertysTemplate, this.parser.meta));
        this.properties.tags = (this.properties.tags ?? []).concat([this.settings.tag]);
        this.BookNote = "";
    }

    private async createSingleNote(epubName: string, folderPath: string) {
        this.mergeChapters();
        const content = this.generateSingleNoteContent();

        const notePath = path.posix.join(folderPath, epubName);

        await this.app.vault.create(
            notePath + ".md",
            tFrontmatter(this.properties) + "\n" + content
        );
    }

    private mergeChapters() {
        [...this.parser.chapters]
            .filter(cpt => cpt.level != 0)
            .sort((a, b) => b.level - a.level)
            .forEach(cpt => cpt.parent.sections.push(...cpt.sections));
    }

    private generateSingleNoteContent(): string {
        return this.parser.chapters
            .filter(cpt => cpt.level == 0)
            .map(cpt => cpt.sections.map(st => this.htmlToMD(st.html)).join("\n\n"))
            .join("\n\n");
    }

    private async createChapterNotes(folderPath: string, epubName: string) {
        this.mergeChaptersByGranularity();
        const filteredChapters = this.parser.chapters.filter(cpt => cpt.level <= this.settings.granularity);

        for (const [index, chapter] of filteredChapters.entries()) {
            const notePath = await this.createChapterNote(chapter, folderPath, index, filteredChapters);
            this.BookNote += `${"\t".repeat(chapter.level)}- [[${notePath}|${chapter.name}]]\n`;
        }

        await this.createMocFile(folderPath, epubName);
    }

    private mergeChaptersByGranularity() {
        [...this.parser.chapters]
            .filter(cpt => cpt.level > this.settings.granularity)
            .sort((a, b) => b.level - a.level)
            .forEach(cpt => cpt.parent.sections.push(...cpt.sections));
    }

    private async createChapterNote(chapter: Chapter, folderPath: string, index: number, allChapters: Chapter[]): Promise<string> {
        if (chapter.name.startsWith("... ")) {
            chapter.sections[0].name = chapter.name.replace("... ", "");
        }

        const paths = this.getChapterPaths(chapter);
        const notePath = path.posix.join(folderPath, ...paths.map(normalize));

        // Skip creating files for chapters without content
        const content = this.generateChapterContent(chapter, index, allChapters);
        if (!content.trim()) {
            return notePath;
        }

        await this.app.vault.createFolder(path.dirname(notePath)).catch(() => {/**/ });

        try {
            await this.app.vault.create(notePath + ".md", content);
        } catch (error) {
            console.warn(`Failed to create file at ${notePath}.md: ${error}`);
            console.warn(
                "If such errors are few in this parsing process, it could be because the epub contains some repeated or wrong navPoints. If this is the case, it will not cause any damage to the content of the book."
            );
        }

        return notePath;
    }

    private getChapterPaths(chapter: Chapter): string[] {
        if (this.settings.granularity === 0) {
            return [chapter.name];
        }
        const paths = [chapter.name];
        const getPaths = (cpt: Chapter) => {
            if (cpt.parent) {
                paths.unshift(cpt.parent.name);
                getPaths(cpt.parent);
            }
        };
        getPaths(chapter);
        return paths;
    }

    private generateChapterContent(chapter: Chapter, index: number, allChapters: Chapter[]): string {
        let content = "";

        if (this.settings.noteTemplate) {
            const chapterContent = chapter.sections.map(st => this.htmlToMD(st.html)).join("\n\n");
            content = templateWithVariables(this.settings.noteTemplate, {
                created_time: Date.now().toString(),
                content: chapterContent,
                prev: index > 0 ? allChapters[index - 1].name : "",
                next: index < allChapters.length - 1 ? allChapters[index + 1].name : "",
                chapter_name: chapter.name,
                chapter_level: chapter.level.toString(),
                chapter_index: (index + 1).toString(),
                book_name: this.parser.meta["title"] || "",
                book_author: this.parser.meta["author"] || "",
                book_publisher: this.parser.meta["publisher"] || "",
                book_language: this.parser.meta["language"] || "",
                book_rights: this.parser.meta["rights"] || "",
                book_description: this.parser.meta["description"] || "",
                total_chars: chapterContent.length.toString()
            });
        }

        return content;
    }

    private async createMocFile(folderPath: string, epubName: string) {
        const mocPath = path.posix.join(
            folderPath,
            templateWithVariables(this.settings.mocName, { bookName: epubName })
        ) + ".md";

        await this.app.vault.create(
            mocPath,
            tFrontmatter(this.properties) + "\n" + this.BookNote
        );
    }

    private showSuccessNotice(epubName: string) {
        console.log(`Successfully imported ${epubName}`);
        new Notice(`Successfully imported ${epubName}`);
    }

    copyImages() {
        const imagesPath = path.posix.join(this.vaultPath, this.assetsPath);
        const imageFiles = jetpack.find(this.parser.tmpPath, {
            matching: ["*.jpg", "*.jpeg", "*.png"]
        });

        imageFiles.forEach(file => {
            const destPath = path.posix.join(imagesPath, path.basename(file));
            jetpack.copy(file, destPath, { overwrite: true });
        });

        if (this.parser.coverPath) {
            this.properties.cover = path.posix.join(
                this.assetsPath,
                path.basename(this.parser.coverPath)
            );
        }
    }

    htmlToMD(htmlString: string): string {
        if (this.settings.reformatting) {
            htmlString = beautify.html(htmlString, { indent_size: 0 });
        }

        // Fix DOMParser already declared error by using a different variable name
        const parser = new DOMParser();
        const doc = parser.parseFromString(htmlString, "text/html");

        console.log('Starting footnote processing...');

        // Extract footnotes with content using a broader set of selectors to handle different EPUB formats
        const footnotes = doc.querySelectorAll([
            '[id^="footnote"]', '[id*="footnote"]', '.footnote', 
            '[id^="-"]', '[id$="-backlink"]', '[class*="footnote"]',
            '[role="doc-noteref"]', '[role="doc-note"]', 
            'aside[epub\\:type="footnote"]', '.footnotes li',
            '[epub\\:type="footnote"]', '[epub\\:type="note"]',
            '[class*="note"]', '[class*="annotation"]',
            '.references li', '.endnote', '.endnotes li'
        ].join(','));

        const processedIds = new Set();
        const footnoteMap = new Map();
        const footnoteLinks = new Map();

        // First pass - collect all footnote content and links
        Array.from(doc.querySelectorAll('[id], [role="doc-note"], aside[epub\\:type="footnote"], .footnotes li')).forEach(element => {
            const id = element.getAttribute('id');
            const noteContent = element.innerHTML;
            if (id) {
                footnoteMap.set(id, noteContent);
                // Store links in the footnote for later processing
                const links = element.getElementsByTagName('a');
                if (links.length > 0) {
                    footnoteLinks.set(id, Array.from(links));
                }
            }
        });

        // Second pass - collect footnote content from linked elements
        footnoteLinks.forEach((links, id) => {
            links.forEach(link => {
                const href = link.getAttribute('href')?.replace(/^#/, '');
                if (!href) return;

                // Try to find content in both current document and footnoteMap
                const linkedElement = doc.getElementById(href);
                if (linkedElement && (!footnoteMap.has(id) || linkedElement.textContent.length > footnoteMap.get(id).length)) {
                    footnoteMap.set(id, linkedElement.innerHTML);
                }
            });
        });

        console.log('Found footnotes:', footnotes.length);
        console.log('Footnote map size:', footnoteMap.size);
        console.log('Footnote map keys:', Array.from(footnoteMap.keys()));
        console.log('Footnotes HTML:', Array.from(footnotes).map(f => f.outerHTML).slice(0, 3));

        const footnoteContent = Array.from(footnotes).map(footnote => {
            let id = footnote.getAttribute('id') || '';
            let href = footnote.getAttribute('href')?.replace(/^#/, '') || '';
            let content = '';

            // Clean up ID
            id = id.replace(/^footnote[-_]?/i, '')
                  .replace(/-?backlink$/i, '')
                  .replace(/^note[-_]?/i, '')
                  .replace(/^fn[-_]?/i, '')
                  .replace(/^-+|-+$/g, '');

            // If no valid ID found, try to use href
            if (!id && href) {
                id = href.replace(/^footnote[-_]?/i, '')
                       .replace(/^note[-_]?/i, '')
                       .replace(/^fn[-_]?/i, '')
                       .replace(/^-+|-+$/g, '');
            }

            // Skip if we've already processed this ID
            if (!id || processedIds.has(id)) {
                console.log('Skipping footnote - no ID or already processed:', { id, hasId: !!id, alreadyProcessed: processedIds.has(id) });
                return '';
            }
            processedIds.add(id);
            console.log('Processing footnote:', { id, href, contentLength: content?.length });

            // Try to get content from the footnote itself or its target
            content = footnote.textContent?.trim() || '';

            // If footnote is a reference, try to get content from the target
            if (href) {
                console.log('Attempting to fetch footnote content for href:', href);
                // Clean up href and try different variations to find content
                const cleanHref = href.replace(/^.*#/, '').replace(/-backlink$/, '');
                const targetId = cleanHref.replace(/^footnote-?/i, '');

                if (targetId && footnoteMap.has(targetId)) {
                    const targetContent = footnoteMap.get(targetId);
                    console.log('Found target content:', { targetId, contentLength: targetContent?.length });
                    if (targetContent && targetContent.length > content.length) {
                        content = targetContent;
                    }
                }
                // Try other variations
                const variations = [href, cleanHref, `footnote-${targetId}`];
                for (const variant of variations) {
                    if (footnoteMap.has(variant)) {
                        const targetContent = footnoteMap.get(variant);
                        console.log('Found target content with variant:', { variant, contentLength: targetContent?.length });
                        if (targetContent && targetContent.length > content.length) {
                            content = targetContent;
                        }
                    }
                }
            }

            // If still no content, try to find content by ID
            if (!content && footnoteMap.has(id)) {
                content = footnoteMap.get(id);
            }

            if (!content) return '';

            // Clean up the content
            content = content
                .replace(/<a[^>]*>.*?<\/a>/g, '') // Remove reference links
                .replace(/<sup[^>]*>.*?<\/sup>/g, '') // Remove sup elements
                .replace(/<[^>]+>/g, '') // Remove remaining HTML tags
                .replace(/^[\d\s.]+/, '') // Remove leading numbers
                .replace(/\s+/g, ' ') // Normalize whitespace
                .replace(/^\[.*?\]/, '') // Remove reference brackets
                .replace(/^[\d]+\.?\s*/, '') // Remove leading numbers with dots
                .trim();

            if (!content) return '';

            // Add proper markdown footnote format with two spaces for line break
            return `[^${id}]: ${content}  `;
        }).filter(note => note).join('\n\n');

        // Remove empty tables
        doc.querySelectorAll("table").forEach(table => {
            const isEmpty = !Array.from(table.children).some(child => child.childElementCount > 0);
            if (isEmpty) table.remove();
        });

        // Process footnotes in the document before converting to markdown
        doc.querySelectorAll('a').forEach(ref => {
            const href = ref.getAttribute('href');
            if (href) {
                const cleanId = href.replace(/^.*?#/, '').replace(/^footnote-?/i, '').replace(/-?backlink$/i, '');
                if (/^\d+$/.test(cleanId) || footnoteMap.has(cleanId)) {
                    ref.textContent = `[^${cleanId}]`;
                }
            }
        });

        // Convert to markdown
        const turndownService = create(this.assetsPath, this.settings.imageFormat);
        let markdown = turndownService.turndown(htmlString) || htmlString.replace(/<[^>]+>/g, "");

        // Normalize heading levels
        const hasH1 = /^# [^\n]+/m.test(markdown);
        if (!hasH1) {
            const headingMatch = markdown.match(/^(#{1,6}) [^\n]+/m);
            if (headingMatch) {
                const levelDiff = headingMatch[1].length - 1;
                markdown = markdown.replace(
                    /^(#{1,6}) /gm,
                    (_, hashes) => "#".repeat(Math.max(1, hashes.length - levelDiff)) + " "
                );
            }
        }

        // Find all footnote references in this section's markdown
        const footnoteRefs = markdown.match(/\[\^([^\]]+)\]/g) || [];
        const usedFootnotes = new Set(footnoteRefs.map(ref => ref.slice(2, -1)));

        // Filter footnote content to only include footnotes referenced in this section
        const sectionFootnotes = footnoteContent.split('\n\n')
            .filter(note => {
                const match = note.match(/\[\^([^\]]+)\]:/);
                return match && usedFootnotes.has(match[1]);
            })
            .join('\n\n');

        // Clean up footnotes from main content to avoid duplicates
        markdown = markdown.replace(/\[\^\d+\]:.+?\n\n/g, '');

        // Ensure there's always two newlines before footnotes
        if (sectionFootnotes) {
            console.log('Generated section footnote content:', sectionFootnotes);
            markdown = markdown.trim();
            // Force append footnotes with double newline
            markdown = markdown + '\n\n' + sectionFootnotes.trim() + '\n';
        } else {
            console.log('No footnote content generated for this section');
        }

        return markdown.trim();
    }
}