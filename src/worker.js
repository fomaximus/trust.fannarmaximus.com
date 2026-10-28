// Serves the static site from ./public, the JSON API under /api/, and
// rewrites /s/<token> to the session page so one HTML file handles every state.

import { handleApi } from "./api.js";
import { deleteExpired } from "./store.js";

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);
const SECURITY_HEADERS = {
	"strict-transport-security": "max-age=31536000",
	"x-frame-options": "DENY",
	"x-content-type-options": "nosniff",
	"referrer-policy": "no-referrer",
	"content-security-policy":
		"default-src 'none'; script-src 'self'; style-src 'self'; font-src 'self'; img-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
};

// Anything under /s/ is a session page; the page itself asks the API whether the token is real.
export function isSessionPath(pathname) {
	return pathname.startsWith("/s/");
}

function secure(res) {
	const out = new Response(res.body, res);
	for (const [k, v] of Object.entries(SECURITY_HEADERS)) out.headers.set(k, v);
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
			return secure(await handleApi(request, env));
		}
		if (isSessionPath(url.pathname)) {
			return secure(await env.ASSETS.fetch(new Request(new URL("/session", request.url), request)));
		}
		return secure(await env.ASSETS.fetch(request));
	},

	// Nightly: drop sessions past their 90-day expiry.
	async scheduled(controller, env) {
		await deleteExpired(env.DB, Date.now());
	},
};
