<script lang="ts">
	import { obscureEmail } from '$lib/utils/email.utils';

	interface Props {
		/** Parsed `formData` payload of a membership application. */
		formData: Record<string, unknown>;
		aiRecommendation?: string | null;
	}

	let { formData, aiRecommendation = null }: Props = $props();

	function formatFieldName(key: string): string {
		// Convert camelCase to Title Case with spaces
		return key
			.replace(/([A-Z])/g, ' $1')
			.replace(/^./, (str) => str.toUpperCase())
			.trim();
	}

	type FieldRenderer = 'text' | 'email' | 'chips' | 'scale';

	interface FieldSpec {
		label: string;
		renderer: FieldRenderer;
		scale?: { min: string; max: string };
	}

	const APPLICATION_FIELDS: Record<string, FieldSpec> = {
		fullName: { label: 'Full name', renderer: 'text' },
		email: { label: 'Email address', renderer: 'email' },
		location: { label: 'Where are you currently based?', renderer: 'text' },
		timeAvailability: { label: 'Time availability per week', renderer: 'text' },
		languages: { label: 'Languages spoken', renderer: 'text' },
		discovery: { label: 'How did you discover EcoHubs?', renderer: 'text' },

		resonanceCombined: {
			label: 'What resonates with EcoHubs and regenerative living?',
			renderer: 'text'
		},
		natureCommunityMeaning: {
			label: 'What does living well in community and aligned with nature mean to you?',
			renderer: 'text'
		},
		values: { label: 'Values that resonate most', renderer: 'chips' },

		groupWork: { label: 'What helps a group work well together?', renderer: 'text' },
		teamworkMoment: { label: 'A moment when teamwork felt easy', renderer: 'text' },
		disagreementResponse: {
			label: 'When two people strongly disagree, you would…',
			renderer: 'text'
		},
		disagreementResponseOther: { label: 'Disagreement response — other', renderer: 'text' },
		ideaNotChosen: {
			label: 'When your idea is not chosen, your usual response',
			renderer: 'text'
		},
		ideaNotChosenOther: { label: 'Idea-not-chosen — other', renderer: 'text' },
		comfortFeedback: {
			label: 'Comfort receiving constructive feedback',
			renderer: 'scale',
			scale: { min: 'Very uncomfortable', max: 'Very comfortable' }
		},
		comfortAskingHelp: {
			label: 'Comfort asking for help',
			renderer: 'scale',
			scale: { min: 'Very uncomfortable', max: 'Very comfortable' }
		},
		adaptToChange: {
			label: 'Ease adapting when plans change',
			renderer: 'scale',
			scale: { min: 'Very difficult', max: 'Very easy' }
		},
		decisionMakingValue: { label: 'Most valued in group decision-making', renderer: 'text' },

		motivation: { label: 'Motivation to join a project like EcoHubs', renderer: 'text' },
		contribution: { label: 'What would you like to contribute?', renderer: 'text' },
		receiveLearn: { label: 'What would you hope to receive or learn?', renderer: 'text' },
		experienceAreas: { label: 'Areas of experience', renderer: 'chips' },
		experienceAreasOther: { label: 'Other experience areas', renderer: 'text' },
		proudProject: {
			label: 'A project you contributed to that you are proud of',
			renderer: 'text'
		},
		bestWorkEnvironments: {
			label: 'Environments that help you do your best work',
			renderer: 'text'
		},

		manageCommitments: { label: 'How you manage commitments and follow-through', renderer: 'text' },
		collaborationChallengesMerged: {
			label: 'Collaboration challenges and how you handle them',
			renderer: 'text'
		},
		concernsDoubts: { label: 'Concerns or doubts about joining EcoHubs', renderer: 'text' },
		howStartContributing: {
			label: 'If accepted, how would you like to start contributing?',
			renderer: 'text'
		},
		anythingElse: { label: 'Anything else to share', renderer: 'text' }
	};

	// Coerce an unknown value into a display string for the unknown-key fallback.
	// Arrays/objects are dropped here on purpose — the catalogue is the right
	// place to teach the UI about new shapes.
	function formatPrimitiveValue(value: unknown): string | null {
		if (value === null || value === undefined) return null;
		if (typeof value === 'string') {
			const trimmed = value.trim();
			return trimmed === '' ? null : trimmed;
		}
		if (typeof value === 'boolean') return value ? 'Yes' : 'No';
		if (typeof value === 'number') return Number.isFinite(value) ? String(value) : null;
		return null;
	}
</script>

{#snippet textRow(label: string, text: string)}
	<div class="border-b border-white/5 pb-4 last:border-0">
		<h3 class="text-solar-300/60 mb-2 text-xs font-semibold tracking-wider uppercase">
			{label}
		</h3>
		<div class="text-solar-100/90 text-sm leading-relaxed whitespace-pre-wrap">{text}</div>
	</div>
{/snippet}

{#snippet chipsRow(label: string, items: string[])}
	<div class="border-b border-white/5 pb-4 last:border-0">
		<h3 class="text-solar-300/60 mb-2 text-xs font-semibold tracking-wider uppercase">
			{label}
		</h3>
		<div class="flex flex-wrap gap-1.5">
			{#each items as item (item)}
				<span
					class="text-solar-100/90 inline-flex items-center rounded-full bg-white/10 px-2.5 py-0.5 text-xs"
				>
					{item}
				</span>
			{/each}
		</div>
	</div>
{/snippet}

{#snippet scaleRow(label: string, value: number, scale: { min: string; max: string })}
	{@const clamped = Math.max(1, Math.min(10, value))}
	<div class="border-b border-white/5 pb-4 last:border-0">
		<div class="mb-2 flex items-baseline justify-between gap-3">
			<h3 class="text-solar-300/60 text-xs font-semibold tracking-wider uppercase">{label}</h3>
			<span class="text-base font-semibold text-white"
				>{value}<span class="text-solar-300/60 text-xs font-normal">/10</span></span
			>
		</div>
		<div class="h-2 w-full overflow-hidden rounded-full bg-white/10">
			<div
				class="h-full rounded-full bg-linear-to-r from-emerald-500 to-amber-500"
				style="width: {clamped * 10}%"
			></div>
		</div>
		<div class="text-solar-300/60 mt-1.5 flex justify-between text-xs">
			<span>{scale.min}</span>
			<span>{scale.max}</span>
		</div>
	</div>
{/snippet}

<div class="space-y-6">
	{#each Object.entries(formData) as [key, value] (key)}
		{@const spec = APPLICATION_FIELDS[key]}
		{#if spec?.renderer === 'email' && typeof value === 'string' && value.trim()}
			{@render textRow(spec.label, obscureEmail(value))}
		{:else if spec?.renderer === 'chips' && Array.isArray(value) && value.length > 0}
			{@render chipsRow(spec.label, value as string[])}
		{:else if spec?.renderer === 'scale' && typeof value === 'number' && Number.isFinite(value) && spec.scale}
			{@render scaleRow(spec.label, value, spec.scale)}
		{:else if spec?.renderer === 'text'}
			{@const display = formatPrimitiveValue(value)}
			{#if display !== null}
				{@render textRow(spec.label, display)}
			{/if}
		{:else if !spec}
			{@const display = formatPrimitiveValue(value)}
			{#if display !== null}
				{@render textRow(formatFieldName(key), display)}
			{/if}
		{/if}
	{/each}

	{#if aiRecommendation}
		<div class="border-b border-white/5 pb-4 last:border-0">
			<h3 class="text-solar-300/60 mb-2 text-xs font-semibold tracking-wider uppercase">
				AI Recommendation
			</h3>
			<div
				class="rounded-lg bg-blue-500/10 p-3 text-sm leading-relaxed whitespace-pre-wrap text-blue-200"
			>
				{aiRecommendation}
			</div>
		</div>
	{/if}
</div>
