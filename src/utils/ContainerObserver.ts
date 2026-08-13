import { Env } from "Env";
import { log } from "utils/log";
import { Bln } from "utils/ts";

export interface ContainerObserverOptions {
	selectors: string[];
	onAdded: (container: HTMLElement) => void;
	onRemoved: (container: HTMLElement) => void;
	/**
	 * When `true`, the body observer also watches descendants, not just direct children.
	 * Defaults to `false`, i.e. only direct children of the target are observed.
	 */
	observeSubtree?: boolean;
	/** The target node to observe for added/removed containers. */
	target: HTMLElement;
}

/**
 * Watches for containers (elements matching {@link ContainerObserverOptions.selectors}) being added to and
 * removed from the DOM, and reports them to the caller via the provided callbacks.
 *
 * ---
 * ### MutationObserver API Reference & Caveats
 *
 * 1. Mutation Types (`childList`, `attributes`, `characterData`):
 *    These act as feature switches for what type of mutations to observe.
 *    At least one of these three must be set to `true`, or `observe()` throws an error.
 *
 * 2. Depth Scope (`subtree`):
 *    Determines how far down the tree the feature switches reach.
 *
 * Scope behavior when `subtree: false` (default):
 * | Option | Target Node Itself | Direct Children | Deeper Descendants |
 * | :--- | :--- | :--- | :--- |
 * | `childList` | — | **Observed** *(added/removed nodes)* | Ignored |
 * | `attributes` | **Observed** *(class, id, style, etc.)* | Ignored | Ignored |
 * | `characterData` | **Observed** *(if target is TextNode)* | Ignored | Ignored |
 *
 * Scope behavior when `subtree: true`:
 * Expands all active switches (`childList`, `attributes`, `characterData`) to monitor
 * the target node and all descendants throughout the entire DOM subtree.
 */
export class ContainerObserver {

	private readonly containerObservers = new Map<HTMLElement, MutationObserver>();
	private readonly bodyObserver: MutationObserver;
	/** When selectors are joined with a comma, `matches` and `querySelector` matches any element that satisfies at least one of those selectors. */
	private readonly combinedSelector: string;

	private readonly onMutation = (mutations: MutationRecord[]) => {
		for (const mutation of mutations) {
			for (const node of mutation.addedNodes)
				this.processNode(node, (el) => this.onContainerAdded(el));
			for (const node of mutation.removedNodes)
				this.processNode(node, (el) => this.onContainerRemoved(el));
		}
	};

	private processNode(node: Node, onContainer: (container: HTMLElement) => void) {
		log.util.t(node.nodeName);

		if (node.nodeType === Node.ELEMENT_NODE && node.instanceOf(HTMLElement)) {
			const container = this.findContainer(node);
			log.util.d("Found", node.nodeName, container !== null);
			if (container !== null)
				onContainer(container);
		}
		else {
			log.util.d("Not an Html element");
		}
	};

	private findContainer(container: HTMLElement): HTMLElement | null {
		log.util.t(Env.dev.thunkedStr(() => `${container.tagName} .${[...container.classList].join(" ")}`));

		if (container.matches(this.combinedSelector))
			return container;

		if (container.childElementCount > 0) {
			const found = container.querySelector<HTMLElement>(this.combinedSelector);
			if (found !== null)
				return found;
		}

		return null;
	}


	private readonly options: ContainerObserverOptions;

	constructor(options: ContainerObserverOptions) {
		this.options = options;
		this.combinedSelector = options.selectors.join(", ");
		this.bodyObserver = new MutationObserver(this.onMutation);
		this.bodyObserver.observe(this.options.target, {
			childList: true,
			subtree: Bln.isTrue(this.options.observeSubtree),
		});
	}

	public endObserving() {
		this.bodyObserver.disconnect();
		for (const observer of this.containerObservers.values())
			observer.disconnect();
		this.containerObservers.clear();
	}

	private onContainerAdded(container: HTMLElement) {
		log.util.t(Env.dev.thunkedStr(() => `${container.tagName} .${[...container.classList].join(".")}`));
		this.options.onAdded(container);

		const observer = new MutationObserver(() => {
			log.util.d("Children of container:", container, "changed");
			this.options.onAdded(container);
		});

		log.util.d("Start observing child container:", container);
		observer.observe(container, {
			childList: true,
			subtree: true
		});
		this.containerObservers.set(container, observer);
	}

	private onContainerRemoved(container: HTMLElement) {
		log.util.t(Env.dev.thunkedStr(() => `${container.tagName} .${[...container.classList].join(".")}`));
		this.options.onRemoved(container);

		const observer = this.containerObservers.get(container);
		if (observer !== undefined) {
			observer.disconnect();
			this.containerObservers.delete(container);
		}
	}
}
