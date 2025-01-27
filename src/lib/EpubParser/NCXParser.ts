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
            const title = navPoint.navLabel?.[0]?.text?.[0] || (() => {
                const src = findProperty(navPoint,"content")[0].$["src"];
                // Remove toc.xhtml references
                const cleanSrc = src.split("#")[0].replace(/%20/g, " ");
                const filePath = path.posix.join(path.dirname(this.filePath), cleanSrc);
                const html = jetpack.read(filePath);
                return new DOMParser().parseFromString(html, "text/html").title ||
                    path.basename(filePath, path.extname(filePath)) || "";
            })();

            if (!title) return null;

            const src = findProperty(navPoint,"content")[0].$["src"];
                // Remove toc.xhtml references and anchors
                const cleanSrc = src.split("#")[0].replace(/%20/g, " ").replace(/toc\.xhtml/g, "");
                const filePath = path.posix.join(path.dirname(this.filePath), cleanSrc);
            const subItems = navPoint["navPoint"]?.map(pt => getToc(pt, level + 1)) || [];
            const chapter = new Chapter(title, filePath, subItems, level);
            subItems.forEach(sub => sub.parent = chapter);

            return chapter;
        };

        return navPoints.map(pt => getToc(pt, 0)).filter(Boolean);
    }
}