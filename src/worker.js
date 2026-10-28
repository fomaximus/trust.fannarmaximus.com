// Serves the static site from ./public, the JSON API under /api/, and
// rewrites /s/<token> to the session page so one HTML file handles every state.

import { handleApi } from "./api.js";
import { deleteExpired } from "./store.js";

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);
const HSTS = "max-age=31536000";

// Anything under /s/ is a session page; the page itself asks the API whether the token is real.
export function isSessionPath(pathname) {
	return pathname.startsWith("/s/");
}

function withHsts(res) {
	const out = new Response(res.body, res);
	out.headers.set("strict-transport-security", HSTS);
	return out;
}

export default {
	async fetch(request, env) {
		const url = new URL(request.url);
		if (url.protocol === "http:" && !LOCAL_HOSTS.has(url.hostname)) {
			url.protocol = "https:";
			return Response.redirect(url.toString(), 301);
		}
		if (url.pathname.startsWith("/api/")) {
			return withHsts(await handleApi(request, env));
		}
		if (isSessionPath(url.pathname)) {
			return withHsts(await env.ASSETS.fetch(new Request(new URL("/session", request.url), request)));
		}
		return withHsts(await env.ASSETS.fetch(request));
	},

	// Nightly: drop sessions past their 90-day expiry.
	async scheduled(controller, env) {
		await deleteExpired(env.DB, Date.now());
	},
};
