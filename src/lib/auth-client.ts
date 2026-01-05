import { createAuthClient } from 'better-auth/svelte';
import { genericOAuthClient } from 'better-auth/client/plugins';

export const authClient = createAuthClient({
	baseURL: import.meta.env.VITE_PUBLIC_APP_URL || 'http://localhost:5173',
	plugins: [genericOAuthClient()]
});
