import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { readFile } from 'fs/promises';
import { join } from 'path';
import { existsSync } from 'fs';

const AVATAR_DIR = join(process.cwd(), 'data', 'avatars');

const MIME_TYPES: Record<string, string> = {
	'.webp': 'image/webp',
	'.png': 'image/png',
	'.jpg': 'image/jpeg',
	'.jpeg': 'image/jpeg'
};

export const GET: RequestHandler = async ({ params }) => {
	const { filename } = params;

	// Validate filename format (hex + extension, no path traversal)
	if (!/^[a-f0-9]{16}\.(webp|png|jpg|jpeg)$/.test(filename)) {
		error(400, 'Invalid filename');
	}

	const filePath = join(AVATAR_DIR, filename);

	if (!existsSync(filePath)) {
		error(404, 'Avatar not found');
	}

	try {
		const buffer = await readFile(filePath);
		const ext = '.' + filename.split('.').pop();
		const contentType = MIME_TYPES[ext] ?? 'application/octet-stream';

		return new Response(buffer, {
			headers: {
				'Content-Type': contentType,
				'Cache-Control': 'public, max-age=86400, immutable'
			}
		});
	} catch {
		error(500, 'Failed to read avatar');
	}
};
