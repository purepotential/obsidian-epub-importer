/* eslint-disable @typescript-eslint/no-unused-vars */
export class NoteParser {
	content: string;
	static parse(originNote: string, assetsPath: string, imageFormat: string) {
		const parser = new NoteParser(originNote);
		parser.parseImagePath(assetsPath, imageFormat);
		parser.parseFontNote();
		return parser.content;
	}

	constructor(originNote: string) {
		this.content = originNote;
	}

	parseImagePath(assetsPath: string, imageFormat: string) {
		// TODO: Avoid accidentally damaging the text content
		// TODO: Identify links first, then convert.
		// this.content = this.content
		// 	.replace(/Images/g, "images")
		// 	.replace(/\.\.\/images/g, "images")
		// 	.replace(/Image/g, "images/Image")
		// 	.replace(/images/g, assetsPath);
		this.content = this.content.replace(
			/!\[\].*?\(.*?([^\\/]*)\.(jpg|jpeg|png)\)/g,
			"![](images/$1.$2)"
		);
		if (imageFormat == "![](imagePath)") {
			assetsPath = assetsPath.replaceAll(" ", "%20");
		}
		this.content = this.content.replace(/images/g, assetsPath);
		if (imageFormat == "![[imagePath]]") {
			this.content = this.content.replace(/!\[\]\((.*images.*)\)/g, "![[$1]]");
		}
		if (imageFormat == "![[imagePath|caption]]") {
			this.content = this.content.replace(/!\[\]\((.*images.*)\)/g, "![[$1]]");
			this.content = this.content.replace(
				/!\[\[(.*images.*)\]\]\n+(\**图.*)\n/g,
				"![[$1|$2]]\n"
			);
		}
	}

	parseFontNote() {
		// example: [[2]](ab0c_defg.html#hi_j0kl) -> [^2]
		this.content = this.content.replace(/\[\[(\d+)\]\]\(.*\)/g, "[^$1]");

		// example: [2](ab0c_defg.html#hi_j0kl) -> [^2]
		this.content = this.content.replace(/\[(\d+)\]\(.*\)/g, "[^$1]");

		// example: [^2]something is good.00264qed你说对吧 -> [^2]: something is good.00264qed你说对吧
		// and, the string is from the begging of the line
		this.content = this.content.replace(/^(\[\^\d+\])(.*)$/gm, "$1: $2");
	}
}
