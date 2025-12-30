import { describe, it, expect, beforeEach } from 'vitest';
import {
	createDefaultSteps,
	isSubStepEnabled,
	markSubStepCompleted,
	loadSteps,
	saveSteps
} from './stepManager';

// Polyfill localStorage for tests
class MemoryStorage {
	store = new Map<string, string>();
	getItem(key: string) {
		return this.store.get(key) ?? null;
	}
	setItem(key: string, value: string) {
		this.store.set(key, value);
	}
	removeItem(key: string) {
		this.store.delete(key);
	}
	clear() {
		this.store.clear();
	}
}

// @ts-expect-error - assign global
globalThis.localStorage = new MemoryStorage();

describe('stepManager', () => {
	beforeEach(() => {
		// reset storage between tests
		(globalThis.localStorage as unknown as MemoryStorage).clear();
	});

	it('enables only the first sub-step initially', () => {
		const steps = createDefaultSteps();
		const step = steps[0];
		expect(isSubStepEnabled(step, 0)).toBe(true);
		expect(isSubStepEnabled(step, 1)).toBe(false);
	});

	it('enables next sub-step after completion', () => {
		let steps = createDefaultSteps();
		const stepId = steps[0].id;
		const subId = steps[0].subSteps![0].id;
		steps = markSubStepCompleted(steps, stepId, subId);
		const updated = steps.find((s) => s.id === stepId)!;
		expect(updated.subSteps![0].completed).toBe(true);
		expect(isSubStepEnabled(updated, 1)).toBe(true);
	});

	it('persists and loads state from localStorage', () => {
		let steps = createDefaultSteps();
		const stepId = steps[1].id;
		const subId = steps[1].subSteps![0].id;
		steps = markSubStepCompleted(steps, stepId, subId);
		saveSteps(steps);
		const loaded = loadSteps();
		const step = loaded.find((s) => s.id === stepId)!;
		expect(step.subSteps![0].completed).toBe(true);
	});
});
