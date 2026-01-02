declare module '@tryghost/content-api' {
	interface GhostContentAPIOptions {
		url: string;
		key: string;
		version: string;
	}

	interface BrowseOptions {
		limit: string;
		include: string[];
		filter: string;
	}

	interface ReadOptions {
		slug?: string;
		id?: string;
	}

	interface IncludeOptions {
		include: string[];
	}

	interface PostsAPI {
		browse(options: BrowseOptions): Promise<unknown[]>;
		read(options: ReadOptions, include?: IncludeOptions): Promise<unknown>;
	}

	class GhostContentAPI {
		posts: PostsAPI;
		constructor(options: GhostContentAPIOptions);
	}

	export default GhostContentAPI;
}

declare module '@tryghost/admin-api' {
	interface GhostAdminAPIOptions {
		url: string;
		key: string;
		version: string;
	}

	interface BrowseOptions {
		limit: string;
		include: string[];
		filter: string;
	}

	interface ReadOptions {
		id: string;
	}

	interface EditOptions {
		id: string;
		status?: string;
		custom_fields?: Record<string, unknown>;
	}

	interface IncludeOptions {
		include: string[];
	}

	interface PostsAPI {
		browse(options: BrowseOptions): Promise<unknown[]>;
		read(options: ReadOptions, include?: IncludeOptions): Promise<unknown>;
		edit(options: EditOptions, include?: IncludeOptions): Promise<unknown>;
	}

	class GhostAdminAPI {
		posts: PostsAPI;
		constructor(options: GhostAdminAPIOptions);
	}

	export default GhostAdminAPI;
}
