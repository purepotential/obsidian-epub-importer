/* eslint-disable @typescript-eslint/no-unused-vars */
import TurndownService from "turndown";
import * as path from "path";

export function create(assetsPath: string, imageFormat: string): TurndownService {
  const turndownService = new TurndownService({
    headingStyle: "atx",
    bulletListMarker: "-",
    codeBlockStyle: "fenced",
    emDelimiter: "_",
    strongDelimiter: "**",
    linkStyle: "inlined",
    linkReferenceStyle: "full",
    hr: "---",
    blankReplacement: (content, node) => {
      return node.isBlock ? "\n\n" : "";
    },
    keepReplacement: (content, node) => {
      return node.isBlock ? `\n\n${content}\n\n` : content;
    }
  });

  turndownService.addRule("blockquotes", {
    filter: "blockquote",
    replacement: (content) => {
      return `\n\n> ${content.trim().replace(/\n/g, "\n> ")}\n\n`;
    }
  });

  turndownService.addRule("tables", {
    filter: "table",
    replacement: (content, node) => {
      const rows = node.querySelectorAll("tr");
      if (rows.length === 0) return "";
      return `\n\n${content.trim()}\n\n`;
    }
  });

  turndownService.remove("title");

  turndownService.addRule("img", {
    filter: "img",
    replacement: function (content, node) {
      const alt = node.alt || "";
      const src = node.getAttribute("src") || "";
      if(!src.startsWith("http://") && !src.startsWith("https://")){
        const fileName = path.basename(src);
        const newPath = path.posix.join(assetsPath, fileName);
        if(imageFormat === "![](imagePath)"){
          return `![${alt}](${newPath.replaceAll(" ", "%20")})`;
        }else if(imageFormat === "![[imagePath]]"){
          return `![[${newPath}]]`;
        }
      }
      return content;  
    }
  });

  turndownService.addRule("footnoteLinks", {
    filter: (node) => {
      if (node.nodeName === "A") {
        const text = node.textContent;
        return /^\[?\[?\d+\]?\]?$/.test(text);
      }
      return false;
    },
    replacement: (content, node) => {
      const number = node.textContent.replace(/[[\]]/g, "");
      return `[^${number}]`;
    }
  });

  turndownService.addRule("footnoteReferences", {
    filter: (node) => {
      if (node.nodeName === "P") {
        const aElements = node.getElementsByTagName("a");
        if (aElements.length > 0) {
          const text = aElements[0].textContent;
          return /^\[\d+\]/.test(text);
        }
      }
      return false;
    },
    replacement: (content, node) => {
      const footnoteText = content.trim();
      const footnoteMatch = footnoteText.match(/^\[\^(\d+)\](.*?)$/);
      if (footnoteMatch) {
        const [, number, text] = footnoteMatch;
        return `[^${number}]: ${text.trim()}\n`;
      }
      return content;
    }
  });

  turndownService.addRule("internalLinks", {
    filter: (node, options) => {
      return (
        node.nodeName === "A" && 
        !node.getAttribute("href")?.startsWith("http") &&
        !/^\[?\[?\d+\]?\]?$/.test(node.textContent)
      );
    },
    replacement: (content, node) => {
      const href = node.getAttribute("href");
      const text = node.textContent;
      if (!href) return text;
      if (href.includes("toc.xhtml#")) {
        return text;
      }
      if (href === text) {
        return `[[${href}]]`;
      }
      return `[[${href}|${text}]]`;
    }
  });

  turndownService.addRule("httpLinks", {
    filter: (node, options) => {
      return (
        node.nodeName === "A" &&
        node.getAttribute("href")?.startsWith("http")
      );
    },
    replacement: (content, node) => {
      const href = node.getAttribute("href");
      const text = node.textContent;
      return `[${text}](${href})`;
    }
  });

  return turndownService;
}