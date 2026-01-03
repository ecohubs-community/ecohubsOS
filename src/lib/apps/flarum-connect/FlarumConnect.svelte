<script lang="ts">
	import { os } from '$lib/os.svelte';
	import { markSubStepCompletedById } from '$lib/onboarding/stepManager';
	import Icon from '@iconify/svelte';

	// Form fields
	let checkInput = $state(''); // email or username for checking
	let username = $state('');
	let email = $state('');
	let password = $state('');
	let confirmPassword = $state('');

	// UI state - separate booleans to avoid TypeScript narrowing issues in templates
	let showRegisterForm = $state(false);
	let isChecking = $state(false);
	let isRegistering = $state(false);
	let isSuccess = $state(false);
	let errorMessage = $state('');

	async function handleCheck() {
		if (!checkInput.trim()) {
			errorMessage = 'Please enter your email or username';
			return;
		}

		isChecking = true;
		errorMessage = '';

		try {
			const response = await fetch('/api/flarum/check', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ identifier: checkInput.trim() })
			});

			const data = await response.json();

			if (!response.ok) {
				throw new Error(data.error || 'Check failed');
			}

			if (data.exists) {
				// User already registered - mark step complete
				isSuccess = true;
				markSubStepCompletedById('forum-request');
				setTimeout(() => {
					os.closeApp();
				}, 2000);
			} else {
				// User not found - show registration form
				// Pre-fill the field that was entered
				if (checkInput.includes('@')) {
					email = checkInput.trim();
				} else {
					username = checkInput.trim();
				}
				showRegisterForm = true;
			}
		} catch (err) {
			errorMessage = err instanceof Error ? err.message : 'Check failed';
		} finally {
			isChecking = false;
		}
	}

	async function handleRegister() {
		// Validation
		if (!username.trim()) {
			errorMessage = 'Username is required';
			return;
		}
		if (!email.trim()) {
			errorMessage = 'Email is required';
			return;
		}
		if (!password) {
			errorMessage = 'Password is required';
			return;
		}
		if (password !== confirmPassword) {
			errorMessage = 'Passwords do not match';
			return;
		}
		if (password.length < 8) {
			errorMessage = 'Password must be at least 8 characters';
			return;
		}

		isRegistering = true;
		errorMessage = '';

		try {
			const response = await fetch('/api/flarum/register', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					username: username.trim(),
					email: email.trim(),
					password
				})
			});

			const data = await response.json();

			if (!response.ok) {
				throw new Error(data.error || 'Registration failed');
			}

			isSuccess = true;
			markSubStepCompletedById('forum-request');

			setTimeout(() => {
				os.closeApp();
			}, 2000);
		} catch (err) {
			errorMessage = err instanceof Error ? err.message : 'Registration failed';
		} finally {
			isRegistering = false;
		}
	}

	function goBack() {
		showRegisterForm = false;
		errorMessage = '';
	}
</script>

<div class="flex h-full flex-col p-6">
	<!-- Header -->
	<div class="mb-6 text-center">
		<div
			class="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-linear-to-br from-blue-400 to-blue-500"
		>
			<Icon icon="tabler:messages" class="h-8 w-8 text-white" />
		</div>
		<h2 class="text-xl font-bold text-white">Connect to Forum</h2>
		<p class="text-solar-300 mt-2 text-sm">
			{#if showRegisterForm}
				Create your account on the ecohubs Discussions Forum.
			{:else}
				Check if you already have a forum account or create a new one.
			{/if}
		</p>
	</div>

	{#if isSuccess}
		<!-- Success state -->
		<div class="flex flex-1 flex-col items-center justify-center">
			<Icon icon="tabler:check-circle" class="mb-4 h-16 w-16 text-green-400" />
			<h3 class="text-lg font-bold text-white">Connected!</h3>
			<p class="text-solar-300 mt-2 text-center text-sm">
				Your forum account is ready. You can now participate in discussions.
			</p>
		</div>
	{:else if showRegisterForm}
		<!-- Registration form -->
		<div class="flex-1 space-y-4">
			<div>
				<label for="username" class="text-solar-200 mb-2 block text-sm font-medium">
					Username
				</label>
				<input
					id="username"
					type="text"
					bind:value={username}
					placeholder="Choose a username"
					disabled={isRegistering}
					class="focus:border-solar-400 focus:ring-solar-400 w-full rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-white placeholder-white/30 focus:outline-none focus:ring-1 disabled:opacity-50"
				/>
			</div>

			<div>
				<label for="email" class="text-solar-200 mb-2 block text-sm font-medium"> Email </label>
				<input
					id="email"
					type="email"
					bind:value={email}
					placeholder="your@email.com"
					disabled={isRegistering}
					class="focus:border-solar-400 focus:ring-solar-400 w-full rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-white placeholder-white/30 focus:outline-none focus:ring-1 disabled:opacity-50"
				/>
			</div>

			<div>
				<label for="password" class="text-solar-200 mb-2 block text-sm font-medium">
					Password
				</label>
				<input
					id="password"
					type="password"
					bind:value={password}
					placeholder="At least 8 characters"
					disabled={isRegistering}
					class="focus:border-solar-400 focus:ring-solar-400 w-full rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-white placeholder-white/30 focus:outline-none focus:ring-1 disabled:opacity-50"
				/>
			</div>

			<div>
				<label for="confirm-password" class="text-solar-200 mb-2 block text-sm font-medium">
					Confirm Password
				</label>
				<input
					id="confirm-password"
					type="password"
					bind:value={confirmPassword}
					placeholder="Repeat your password"
					disabled={isRegistering}
					class="focus:border-solar-400 focus:ring-solar-400 w-full rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-white placeholder-white/30 focus:outline-none focus:ring-1 disabled:opacity-50"
				/>
			</div>

			{#if errorMessage}
				<div
					class="flex items-start gap-2 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200"
				>
					<Icon icon="tabler:alert-circle" class="mt-0.5 h-4 w-4 shrink-0" />
					<span>{errorMessage}</span>
				</div>
			{/if}
		</div>

		<div class="mt-6 flex gap-3">
			<button
				onclick={goBack}
				disabled={isRegistering}
				class="flex h-12 flex-1 items-center justify-center gap-2 rounded-xl border border-white/10 bg-white/5 font-medium text-white transition-all hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-50"
			>
				<Icon icon="tabler:arrow-left" class="h-5 w-5" />
				Back
			</button>
			<button
				onclick={handleRegister}
				disabled={isRegistering || !username.trim() || !email.trim() || !password}
				class="bg-yellow-500 hover:bg-yellow-400 text-solar-900 flex h-12 flex-[2] items-center justify-center gap-2 rounded-xl font-medium transition-all active:scale-95 disabled:cursor-not-allowed disabled:opacity-50"
			>
				{#if isRegistering}
					<Icon icon="tabler:loader" class="h-5 w-5 animate-spin" />
					Creating Account...
				{:else}
					<Icon icon="tabler:user-plus" class="h-5 w-5" />
					Create Account
				{/if}
			</button>
		</div>
	{:else}
		<!-- Step 1: Check if user exists -->
		<div class="flex-1 space-y-4">
			<div>
				<label for="check-input" class="text-solar-200 mb-2 block text-sm font-medium">
					Email or Username
				</label>
				<input
					id="check-input"
					type="text"
					bind:value={checkInput}
					placeholder="Enter your email or username"
					disabled={isChecking}
					class="focus:border-solar-400 focus:ring-solar-400 w-full rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-white placeholder-white/30 focus:outline-none focus:ring-1 disabled:opacity-50"
				/>
				<p class="text-solar-400 mt-2 text-xs">
					We'll check if you already have an account on the forum.
				</p>
			</div>

			{#if errorMessage}
				<div
					class="flex items-start gap-2 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200"
				>
					<Icon icon="tabler:alert-circle" class="mt-0.5 h-4 w-4 shrink-0" />
					<span>{errorMessage}</span>
				</div>
			{/if}

			<div class="rounded-xl bg-white/5 p-4">
				<h4 class="text-solar-200 mb-2 text-sm font-medium">What happens next?</h4>
				<ul class="text-solar-300 space-y-1 text-xs">
					<li class="flex items-start gap-2">
						<Icon icon="tabler:check" class="mt-0.5 h-3 w-3 text-green-400" />
						If you have an account, you're all set!
					</li>
					<li class="flex items-start gap-2">
						<Icon icon="tabler:plus" class="mt-0.5 h-3 w-3 text-blue-400" />
						If not, we'll help you create one.
					</li>
				</ul>
			</div>
		</div>

		<button
			onclick={handleCheck}
			disabled={isChecking || !checkInput.trim()}
			class="bg-yellow-500 hover:bg-solar-300 text-solar-900 mt-6 flex h-12 w-full items-center justify-center gap-2 rounded-xl font-medium transition-all active:scale-95 disabled:cursor-not-allowed disabled:opacity-50"
		>
			{#if isChecking}
				<Icon icon="tabler:loader" class="h-5 w-5 animate-spin" />
				Checking...
			{:else}
				<Icon icon="tabler:search" class="h-5 w-5" />
				Check Account
			{/if}
		</button>
	{/if}
</div>
