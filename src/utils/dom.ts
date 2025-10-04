

export function firstParentEl(childEl: HTMLElement, selectors: string): HTMLElement | null {
	return childEl.closest<HTMLElement>(selectors);
}

export function firstChildEl(parentEl: HTMLElement, selectors: string): HTMLElement | null {
	return parentEl.querySelector<HTMLElement>(selectors);
}

export function childEl(parentEl: HTMLElement, selectors: string): HTMLElement[] {
	return Array.from(parentEl.querySelectorAll<HTMLElement>(selectors));
}

/**
	* Checks if a {@link element} is equal to or a descendant of {@link parent}.
	*
	* @remarks Traverses from the {@link element}'s position to see if the {@link parent} exists in its chain of ancestors.
	*
	* @param parent The potential parent node.
	* @param element The potential child node. If `null`, `false` is returned.
	* @returns True if child is a descendant of parent or is the same node.
	*/
export function isDescendantOrEqual(parent: Element, element: Element | null): boolean {
	return parent.contains(element);
}

let serialQueue: Promise<unknown> = Promise.resolve();

export function queueAsync<T = void>(operation: () => Promise<T>): void {
	serialQueue = serialQueue
		.then(() => operation())
		.catch(err => {
			console.error('Queue operation failed:', err);
		});
}

export function queueAsyncMicrotask<T = void>(operation: () => Promise<T>): void {
	queueMicrotask(() => {
		serialQueue = serialQueue
			.then(operation)
			.catch(err => {
				console.error('Microtask failed:', err);
			});
	});
}

export function sleep(milliseconds: number): Promise<void> {
	return new Promise(resolve => setTimeout(resolve, milliseconds));
}

/**
	* Asynchronously waits for an element to be attached to the DOM.
	* @param element The element to check.
	* @param timeoutMs The maximum time to wait in milliseconds.
	* @returns A promise that resolves when the element has a parent, or rejects on timeout.
	*/
export function waitForElementAttachment(element: HTMLElement, timeoutMs = 500, delay = 1, throwOnError = false): Promise<void | Error> {
	return new Promise((resolve, reject) => {
		const startTime = Date.now();
		const check = () => {
			if (element.parentElement) {
				resolve();
			} else if (Date.now() - startTime > timeoutMs) {
				const err = new Error(`Element was not attached to the DOM within ${timeoutMs}ms.`);
				if (throwOnError)
					reject(err);
				else
					resolve(err);
			} else {
				setTimeout(check, delay);
			}
		};
		check();
	});
}
