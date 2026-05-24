/**
 * Svelte action that relocates the node to `document.body` (or a given
 * target) for its lifetime, then removes it on destroy.
 *
 * Why: `position: fixed` elements are positioned relative to the nearest
 * ancestor that establishes a containing block — which includes any
 * ancestor with `transform`, `filter`, or `backdrop-filter`. The OS
 * window chrome uses `backdrop-filter` + a scale transition + `overflow:
 * hidden`, so a fixed modal rendered inside it gets trapped and clipped
 * (notably breaking modals on iOS Safari). Teleporting the modal to
 * <body> restores true viewport-relative fixed positioning.
 *
 * Usage:
 *   <div class="modal-backdrop" use:portal> … </div>
 */
export function portal(node: HTMLElement, target: HTMLElement | string = 'body') {
	let destination: HTMLElement | null = null;

	function mount() {
		if (typeof document === 'undefined') return;
		destination =
			typeof target === 'string' ? document.querySelector<HTMLElement>(target) : target;
		if (destination) destination.appendChild(node);
	}

	mount();

	return {
		destroy() {
			if (node.parentNode) node.parentNode.removeChild(node);
		}
	};
}
