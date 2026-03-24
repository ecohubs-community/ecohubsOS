import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/server/db';
import { user } from '$lib/server/db/schema';
import { eq } from 'drizzle-orm';
import { createHash } from 'crypto';
import { writeFile, unlink, mkdir } from 'fs/promises';
import { join } from 'path';
import { existsSync } from 'fs';

const AVATAR_DIR = join(process.cwd(), 'data', 'avatars');
const MAX_FILE_SIZE = 2 * 1024 * 1024; // 2MB
const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

function getAvatarPath(filename: string): string {
	return join(AVATAR_DIR, filename);
}

function generateFilename(userId: string): string {
	const hash = createHash('sha256')
		.update(userId + Date.now().toString())
		.digest('hex')
		.slice(0, 16);
	return `${hash}.webp`;
}

export const POST: RequestHandler = async ({ request, locals }) => {
	if (!locals.user) {
		error(401, 'Unauthorized');
	}

	const formData = await request.formData();
	const file = formData.get('avatar');

	if (!file || !(file instanceof File)) {
		error(400, 'No avatar file provided');
	}

	if (!ALLOWED_TYPES.includes(file.type)) {
		error(400, 'Invalid file type. Allowed: JPEG, PNG, WebP');
	}

	if (file.size > MAX_FILE_SIZE) {
		error(400, 'File too large. Maximum size is 2MB');
	}

	try {
		// Ensure avatar directory exists
		if (!existsSync(AVATAR_DIR)) {
			await mkdir(AVATAR_DIR, { recursive: true });
		}

		// Delete old avatar if exists
		const dbUser = await db.query.user.findFirst({
			where: eq(user.id, locals.user.id)
		});

		if (dbUser?.avatar) {
			const oldFilename = dbUser.avatar.split('/').pop();
			if (oldFilename) {
				const oldPath = getAvatarPath(oldFilename);
				try {
					await unlink(oldPath);
				} catch {
					// Old file may not exist
				}
			}
		}

		// Save new avatar
		const filename = generateFilename(locals.user.id);
		const buffer = Buffer.from(await file.arrayBuffer());
		await writeFile(getAvatarPath(filename), buffer);

		// Update DB with serving path
		const avatarUrl = `/api/profile/avatar/${filename}`;
		await db
			.update(user)
			.set({ avatar: avatarUrl, updatedAt: new Date() })
			.where(eq(user.id, locals.user.id));

		return json({ success: true, avatarUrl });
	} catch (err) {
		console.error('Error uploading avatar:', err);
		if (err && typeof err === 'object' && 'status' in err) {
			throw err;
		}
		error(500, 'Failed to upload avatar');
	}
};

export const DELETE: RequestHandler = async ({ locals }) => {
	if (!locals.user) {
		error(401, 'Unauthorized');
	}

	try {
		const dbUser = await db.query.user.findFirst({
			where: eq(user.id, locals.user.id)
		});

		if (dbUser?.avatar) {
			const filename = dbUser.avatar.split('/').pop();
			if (filename) {
				try {
					await unlink(getAvatarPath(filename));
				} catch {
					// File may not exist
				}
			}
		}

		await db
			.update(user)
			.set({ avatar: null, updatedAt: new Date() })
			.where(eq(user.id, locals.user.id));

		return json({ success: true });
	} catch (err) {
		console.error('Error deleting avatar:', err);
		error(500, 'Failed to delete avatar');
	}
};
