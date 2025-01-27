/* eslint-disable @typescript-eslint/no-explicit-any */

import * as path from "path";
import jetpack from "fs-jetpack";
import { Chapter } from "./types";
import { findProperty } from "./utils";

export class NCXParser {
    filePath: string;
    content: any;

    constructor(filePath: string, content: any) {
        this.filePath = filePath;
        this.content = content;
    }

    getToc(): Chapter[] {
        console.log(this.content);
        const navPoints = findProperty(this.content, ["navPoint", "navpoint"]);

        const getToc = (navPoint, level) => {
            let title = navPoint.navLabel?.[0]?.text?.[0];
            let src = findProperty(navPoint,"content")[0].$["src"];

            // If title is not directly available, try to extract it
            if (!title) {
                const cleanSrc = src.replace(/toc\.xhtml(#.*)?/g, "").replace(/%20/g, " ");
                const filePath = cleanSrc ? path.posix.join(path.dirname(this.filePath), cleanSrc) : "";
                if (!filePath || !jetpack.exists(filePath)) {
                    title = path.basename(src, path.extname(src)) || "";
                } else {
                    const html = jetpack.read(filePath);
                    title = new DOMParser().parseFromString(html, "text/html").title ||
                        path.basename(filePath, path.extname(filePath)) || "";
                }
            }

            // Handle toc.xhtml links specially - remove them and just use the title
            if (src.includes("toc.xhtml#")) {
                src = src.replace(/toc\.xhtml#.*/, "");
            }

            if (!title) return null;

            const cleanSrc = src.replace(/toc\.xhtml(#.*)?/g, "").replace(/%20/g, " ");
                const filePath = cleanSrc ? path.posix.join(path.dirname(this.filePath), cleanSrc) : "";
                if (!filePath || !jetpack.exists(filePath)) return null;
            const subItems = (navPoint["navPoint"]?.map(pt => getToc(pt, level + 1)) || []).filter(Boolean);
            const chapter = new Chapter(title, filePath, subItems, level);
            subItems.forEach(sub => {
                if (sub) {
                    sub.parent = chapter;
                }
            });

            return chapter;
        };

        return navPoints.map(pt => getToc(pt, 0)).filter(Boolean);
    }
}