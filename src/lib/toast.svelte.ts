/**
 * Transient notifications.
 *
 * A toast is for something that just happened *to* the member as a result of
 * what they did — a reward landing, a save going through, a sync failing. It is
 * not a notification centre (see `os.notifications` for that) and not a place
 * to put anything the member must act on: toasts disappear, so anything that
 * still needs a decision belongs in the UI that owns it.
 *
 * Any app can use it:
 *
 *     import { toast } from '$lib/toast.svelte';
 *     toast.success('Profile saved');
 *     toast.reward('You earned 20 ECO', '+30 XP for finishing the intro');
 */

export type ToastVariant = 'info' | 'success' | 'reward' | 'error';

export interface Toast {
	id: string;
	variant: ToastVariant;
	title: string;
	/** Optional second line. Keep it to a clause — this is not a dialog. */
	message?: string;
	/** Iconify name. Falls back to the variant's own icon. */
	icon?: string;
	/** Milliseconds on screen. 0 pins it until the member dismisses it. */
	durationMs: number;
}

export interface ToastInput {
	variant?: ToastVariant;
	title: string;
	message?: string;
	icon?: string;
	durationMs?: number;
}

/**
 * How long each kind stays up. Errors linger because a member who missed one
 * has no other way to find out; the rest are confirmations of something they
 * just did and can afford to be brief.
 */
const DEFAULT_DURATION: Record<ToastVariant, number> = {
	info: 4000,
	success: 4000,
	reward: 7000,
	error: 9000
};

/** Beyond this the stack stops being glanceable; the oldest drops off. */
const MAX_VISIBLE = 4;

class ToastState {
	toasts = $state<Toast[]>([]);

	private timers = new Map<string, ReturnType<typeof setTimeout>>();

	show(input: ToastInput): string {
		const variant = input.variant ?? 'info';
		const id = crypto.randomUUID();
		const durationMs = input.durationMs ?? DEFAULT_DURATION[variant];

		const toast: Toast = {
			id,
			variant,
			title: input.title,
			message: input.message,
			icon: input.icon,
			durationMs
		};

		// Anything pushed off the end is gone from the screen, so its timer has
		// nothing left to dismiss — drop it now rather than leaving it to fire
		// against an array that no longer contains it.
		const next = [...this.toasts, toast];
		for (const evicted of next.slice(0, -MAX_VISIBLE)) {
			const timer = this.timers.get(evicted.id);
			if (timer) clearTimeout(timer);
			this.timers.delete(evicted.id);
		}
		this.toasts = next.slice(-MAX_VISIBLE);

		if (durationMs > 0) {
			this.timers.set(
				id,
				setTimeout(() => this.dismiss(id), durationMs)
			);
		}

		return id;
	}

	dismiss(id: string) {
		const timer = this.timers.get(id);
		if (timer) {
			clearTimeout(timer);
			this.timers.delete(id);
		}
		this.toasts = this.toasts.filter((t) => t.id !== id);
	}

	clear() {
		for (const timer of this.timers.values()) clearTimeout(timer);
		this.timers.clear();
		this.toasts = [];
	}

	// Shorthands for the common cases.
	info = (title: string, message?: string) => this.show({ variant: 'info', title, message });
	success = (title: string, message?: string) => this.show({ variant: 'success', title, message });
	reward = (title: string, message?: string) => this.show({ variant: 'reward', title, message });
	error = (title: string, message?: string) => this.show({ variant: 'error', title, message });
}

export const toast = new ToastState();
