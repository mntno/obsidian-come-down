import { describe, expect, it } from "vitest";
import { Url } from "./Url";

describe("Url.extractFilenameAndExtension", () => {

	it("extracts filename and extension", () => {
		expect(Url.extractFilenameAndExtension("https://example.com/image.png"))
			.toEqual({ filename: "image", extension: "png" });
	});

	it("returns empty extension for filenames without a dot", () => {
		expect(Url.extractFilenameAndExtension("https://example.com/image"))
			.toEqual({ filename: "image", extension: "" });
	});

	it("uses the last path segment only", () => {
		expect(Url.extractFilenameAndExtension("https://example.com/a/b/c/photo.jpeg"))
			.toEqual({ filename: "photo", extension: "jpeg" });
	});

	it("splits at the last dot only", () => {
		expect(Url.extractFilenameAndExtension("https://example.com/archive.tar.gz"))
			.toEqual({ filename: "archive.tar", extension: "gz" });
	});

	it("ignores dots in ancestor path segments", () => {
		expect(Url.extractFilenameAndExtension("https://example.com/v1.2/image"))
			.toEqual({ filename: "image", extension: "" });
	});

	it("ignores query parameters", () => {
		expect(Url.extractFilenameAndExtension("https://example.com/image.png?w=100&h=200"))
			.toEqual({ filename: "image", extension: "png" });
	});

	it("ignores fragments", () => {
		expect(Url.extractFilenameAndExtension("https://example.com/image.png#section"))
			.toEqual({ filename: "image", extension: "png" });
	});

	it("preserves character case", () => {
		expect(Url.extractFilenameAndExtension("https://example.com/Photo.PNG"))
			.toEqual({ filename: "Photo", extension: "PNG" });
	});

	it("decodes percent-encoded characters", () => {
		expect(Url.extractFilenameAndExtension("https://example.com/my%20image.png"))
			.toEqual({ filename: "my image", extension: "png" });
	});

	it("decodes encoded dots before splitting the extension", () => {
		expect(Url.extractFilenameAndExtension("https://example.com/report%2Epdf"))
			.toEqual({ filename: "report", extension: "pdf" });
	});

	it("falls back to the raw segment on malformed percent-encoding", () => {
		expect(Url.extractFilenameAndExtension("https://example.com/a%zzb.png"))
			.toEqual({ filename: "a%zzb", extension: "png" });
	});

	it("falls back to the raw segment when decoding introduces path separators", () => {
		expect(Url.extractFilenameAndExtension("https://example.com/file.a%2Fb"))
			.toEqual({ filename: "file", extension: "a%2Fb" });
	});

	it("falls back to the raw segment when decoding leaves a trailing space", () => {
		expect(Url.extractFilenameAndExtension("https://example.com/file.png%20"))
			.toEqual({ filename: "file", extension: "png%20" });
	});

	it("decodes internal spaces in the extension", () => {
		expect(Url.extractFilenameAndExtension("https://example.com/file.p%20g"))
			.toEqual({ filename: "file", extension: "p g" });
	});

	it("treats leading-dot filenames as having no extension", () => {
		expect(Url.extractFilenameAndExtension("https://example.com/.gitignore"))
			.toEqual({ filename: ".gitignore", extension: "" });
	});

	it("keeps the extension for hidden files with an extension", () => {
		expect(Url.extractFilenameAndExtension("https://example.com/.hidden.jpg"))
			.toEqual({ filename: ".hidden", extension: "jpg" });
	});

	it("treats a trailing dot as having no extension", () => {
		expect(Url.extractFilenameAndExtension("https://example.com/image."))
			.toEqual({ filename: "image", extension: "" });
	});

	it("strips all trailing dots from the filename", () => {
		expect(Url.extractFilenameAndExtension("https://example.com/image.."))
			.toEqual({ filename: "image", extension: "" });
	});

	it("keeps the extension when stripping trailing dots", () => {
		expect(Url.extractFilenameAndExtension("https://example.com/archive.tar.."))
			.toEqual({ filename: "archive", extension: "tar" });
	});

	it("returns null when only dots remain after stripping", () => {
		expect(Url.extractFilenameAndExtension("https://example.com/...")).toBeNull();
	});

	it("returns null for the root path", () => {
		expect(Url.extractFilenameAndExtension("https://example.com/")).toBeNull();
	});

	it("returns null for a bare origin", () => {
		expect(Url.extractFilenameAndExtension("https://example.com")).toBeNull();
	});

	it("returns null when the path ends in a slash", () => {
		expect(Url.extractFilenameAndExtension("https://example.com/images/")).toBeNull();
	});

	it("returns null for an invalid url", () => {
		expect(Url.extractFilenameAndExtension("not a url")).toBeNull();
	});

	it("returns null for an empty string", () => {
		expect(Url.extractFilenameAndExtension("")).toBeNull();
	});

	it("returns null for whitespace-only input", () => {
		expect(Url.extractFilenameAndExtension("   ")).toBeNull();
	});

	it("returns null for a protocol-relative url", () => {
		expect(Url.extractFilenameAndExtension("//example.com/image.png")).toBeNull();
	});

	it("falls back to the raw segment when decoding introduces control characters", () => {
		expect(Url.extractFilenameAndExtension("https://example.com/file%09name.png"))
			.toEqual({ filename: "file%09name", extension: "png" });
	});

	it("decodes non-ascii characters", () => {
		expect(Url.extractFilenameAndExtension("https://example.com/%E4%BD%A0%E5%A5%BD.png"))
			.toEqual({ filename: "你好", extension: "png" });
	});

	it("treats backslashes as separators", () => {
		expect(Url.extractFilenameAndExtension("https://x.com\\image.png"))
			.toEqual({ filename: "image", extension: "png" });
	});

	it("ignores encoded slashes in ancestor segments", () => {
		expect(Url.extractFilenameAndExtension("https://example.com/a%2Fb/image.png"))
			.toEqual({ filename: "image", extension: "png" });
	});

	it("ignores leading dots in ancestor segments", () => {
		expect(Url.extractFilenameAndExtension("https://example.com/.hidden/image"))
			.toEqual({ filename: "image", extension: "" });
	});

	it("keeps leading spaces in the filename", () => {
		expect(Url.extractFilenameAndExtension("https://example.com/%20image.png"))
			.toEqual({ filename: " image", extension: "png" });
	});

	it("ignores combined query parameters and fragments", () => {
		expect(Url.extractFilenameAndExtension("https://example.com/image.png?a=1&b=2#frag"))
			.toEqual({ filename: "image", extension: "png" });
	});

	it("keeps matrix parameters as part of the extension", () => {
		expect(Url.extractFilenameAndExtension("https://example.com/image.png;a=1"))
			.toEqual({ filename: "image", extension: "png;a=1" });
	});

	it("keeps cdn modifier suffixes as part of the extension", () => {
		expect(Url.extractFilenameAndExtension("https://example.com/photo.jpg!webp"))
			.toEqual({ filename: "photo", extension: "jpg!webp" });
	});

	it("is scheme-agnostic", () => {
		expect(Url.extractFilenameAndExtension("ftp://x.com/file.zip"))
			.toEqual({ filename: "file", extension: "zip" });
		expect(Url.extractFilenameAndExtension("file:///pics/a.png"))
			.toEqual({ filename: "a", extension: "png" });
	});
});
