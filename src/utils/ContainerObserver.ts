import { Env } from "Env";

export interface ContainerObserverOptions {
	selectors: string[];
	onAdded: (container: HTMLElement) => void;
	onRemoved: (container: HTMLElement) => void;
}

/**
 * Watches for containers (elements matching {@link containerSelectors}) being added to and
 * removed from the DOM, and reports them to the caller via the provided callbacks.
 */
export class ContainerObserver {

	private readonly containerObservers = new Map<HTMLElement, MutationObserver>();

	private readonly bodyObserver = new MutationObserver((mutations) => {

		for (const mutation of mutations) {
			for (const node of mutation.addedNodes) {
				if (node.instanceOf(HTMLElement)) {
					const container = this.findContainer(node);
					if (container !== null)
						this.onContainerAdded(container);
				}
			}

			for (const node of mutation.removedNodes) {
				if (node.instanceOf(HTMLElement)) {
					const container = this.findContainer(node);
					if (container !== null)
						this.onContainerRemoved(container);
				}
			}
		}
	});

	private readonly containerSelectors: string[];
	private readonly onAdded: (container: HTMLElement) => void;
	private readonly onRemoved: (container: HTMLElement) => void;

	constructor(options: ContainerObserverOptions) {
		this.containerSelectors = options.selectors;
		this.onAdded = options.onAdded;
		this.onRemoved = options.onRemoved;
	}

	public startObserving() {
		this.bodyObserver.observe(activeDocument.body, {
			childList: true
		});
	}

	public endObserving() {
		this.bodyObserver.disconnect();
		for (const observer of this.containerObservers.values())
			observer.disconnect();
		this.containerObservers.clear();
	}

	private findContainer(container: HTMLElement): HTMLElement | null {
		Env.log.d(Env.dev.icon.OBSERVER, Env.dev.thunkedStr(() => `ContainerObserver:findContainer: ${container.tagName} .${[...container.classList].join('.')}`));
		if (this.containerSelectors.some(s => container.matches(s)))
			return container;

		for (const selector of this.containerSelectors) {
			const found = container.querySelector(selector);
			if (found)
				return found as HTMLElement;
		}

		return null;
	}

	private onContainerAdded(container: HTMLElement) {
		Env.log.d(Env.dev.icon.OBSERVER, Env.dev.thunkedStr(() => `ContainerObserver:onContainerAdded: ${container.tagName} .${[...container.classList].join('.')}`));
		this.onAdded(container);

		const observer = new MutationObserver(() => {
			Env.log.observer(Env.dev.icon.OBSERVER, "Children of container:", container, "changed");
			this.onAdded(container);
		});
		observer.observe(container, {
			childList: true,
			subtree: true
		});
		this.containerObservers.set(container, observer);
	}

	private onContainerRemoved(container: HTMLElement) {
		Env.log.d(Env.dev.icon.OBSERVER, Env.dev.thunkedStr(() => `ContainerObserver:onContainerRemoved: ${container.tagName} .${[...container.classList].join('.')}`));
		this.onRemoved(container);

		const observer = this.containerObservers.get(container);
		if (observer !== undefined) {
			observer.disconnect();
			this.containerObservers.delete(container);
		}
	}
}
