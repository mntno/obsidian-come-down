import { Env } from "Env";
import { HtmlAssistant } from "processing/HtmlAssistant";
import { log } from "utils/log";
import { BlobUrl, Url } from "utils/Url";


export class BlobUrlManager {

	private blobUrlToSourceUrl = new Map<BlobUrl, string>();
	private containerBlobs = new Map<HTMLElement, Set<BlobUrl>>();

	public registerInitialBlob(blobUrl: BlobUrl, originalSrc: string): void {
		log.proc.t(Env.dev.thunkedStr(() => `BlobUrlManager:registerInitialBlob: \n\tblob: ${blobUrl}, \n\toriginal: ${originalSrc}`));

		this.blobUrlToSourceUrl.set(blobUrl, originalSrc);
	}

	public registerFreshBlob(container: HTMLElement, blobUrl: BlobUrl, originalSrc: string): void {
		Env.log.d(Env.dev.icon.DEBUG, Env.dev.thunkedStr(() => `BlobUrlManager:registerFreshBlob: ${container.tagName} .${[...container.classList].join('.')}\n\tblob: ${blobUrl}, \n\toriginal: ${originalSrc}`));

		this.blobUrlToSourceUrl.set(blobUrl, originalSrc);

		let blobs = this.containerBlobs.get(container);
		if (blobs === undefined) {
			blobs = new Set();
			this.containerBlobs.set(container, blobs);
		}
		blobs.add(blobUrl);
	}

	public async createContainerBlobs(container: HTMLElement, resolveBlobUrl: (source: string) => Promise<BlobUrl | Error>): Promise<void> {
		log.proc.d(Env.dev.thunkedStr(() => `${container.tagName} .${[...container.classList].join('.')}`));

		const imgs = HtmlAssistant.findAllImageElements(container);

		log.proc.d(Env.dev.thunkedStr(() => {
			const lines = [`${imgs.length} images found`];
			imgs.forEach(img => lines.push(`\t\t${img.src}`));
			return lines.join('\n');
		}));

		// Group images per unique source so one blob URL can be shared by all of them.
		const imagesBySource = new Map<string, HTMLImageElement[]>();

		for (const img of imgs) {
			let source: string | undefined;

			if (Url.isBlob(img.src))
				source = this.blobUrlToSourceUrl.get(img.src as BlobUrl);
			else if (Url.isValidExternalUrl(img.src))
				source = img.src;

			if (source === undefined)
				continue;

			const images = imagesBySource.get(source);
			if (images)
				images.push(img);
			else
				imagesBySource.set(source, [img]);
		}

		for (const [source, images] of imagesBySource) {
			for (const img of images)
				HtmlAssistant.setCanceled(img); // At this point, a request has already started. But this will cancel it. In dev-tools the "Status" is set to "(canceled)".

			const freshBlobUrl = await resolveBlobUrl(source);
			if (freshBlobUrl instanceof Error)
				continue;

			this.registerFreshBlob(container, freshBlobUrl, source);
			HtmlAssistant.setSrcAndRevokeOnLoad(freshBlobUrl, images);
		}
	}

	public revokeContainerBlobs(container: HTMLElement): void {
		log.proc.t(Env.dev.thunkedStr(() => `BlobUrlManager:revokeContainerBlobs: ${container.tagName} .${[...container.classList].join('.')}`));
		const blobs = this.containerBlobs.get(container);
		if (blobs !== undefined) {
			for (const blobUrl of blobs)
				URL.revokeObjectURL(blobUrl);
			this.containerBlobs.delete(container);
		}
	}

	/**
	 * Revokes all blob URLs managed by this instance using {@link URL.revokeObjectURL}.
	 * This is per spec safe even if url has already been revoked:
	 * > "If the objectURL argument passed is not a currently-active object URL — for example if it is an invalid URL, non-object URL, or is already revoked — then calling this method does nothing." — [URL: revokeObjectURL() static method - Web APIs \| MDN](https://developer.mozilla.org/en-US/docs/Web/API/URL/revokeObjectURL_static)
	 */
	public revokeAll(): void {
		for (const blobs of this.containerBlobs.values()) {
			for (const blobUrl of blobs)
				URL.revokeObjectURL(blobUrl);
		}
		this.containerBlobs.clear();
	}
}
