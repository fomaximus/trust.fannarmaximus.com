// Serves the static site from ./public, the JSON API under /api/, and
// rewrites /s/<token> to the session page so one HTML file handles every state.

import { handleApi } from "./api.js";

const SESSION_PATH = /^\/s\/[A-Za-z0-9_-]+$/;

export default {
	async fetch(request, env) {
		const url = new URL(request.url);
		if (url.pathname.startsWith("/api/")) {
			return handleApi(request, env);
		}
		if (SESSION_PATH.test(url.pathname)) {
			return env.ASSETS.fetch(new Request(new URL("/session", request.url), request));
		}
		return env.ASSETS.fetch(request);
	},
};
