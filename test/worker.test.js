import { exports } from "cloudflare:workers";
import "../src/worker.js";
import { it, expect } from "vitest";

it("unknown api path is a JSON 404", async () => {
	const res = await exports.default.fetch("https://trust.test/api/nope");
	expect(res.status).toBe(404);
	expect(await res.json()).toEqual({ error: "not_found" });
});

import { env } from "cloudflare:workers";
import { createSession, findByToken } from "../src/store.js";
import { SESSION_TTL_MS } from "../src/session.js";

it("scheduled run deletes expired sessions", async () => {
	const old = Date.now() - SESSION_TTL_MS - 1;
	const scores = { given: { c: 1, r: 1, i: 1, s: 1 }, predicted: { c: 1, r: 1, i: 1, s: 1 } };
	const s = await createSession(env.DB, { creatorName: "A", inviteeName: "B", creatorScores: scores, creatorIpHash: "h", now: old });
	await exports.default.scheduled({ scheduledTime: Date.now(), cron: "0 3 * * *" }, env, { waitUntil() {} });
	expect(await findByToken(env.DB, s.creatorToken, 0)).toBeNull();
});

import { isSessionPath } from "../src/worker.js";

it("plain http on the public host redirects to https", async () => {
	const res = await exports.default.fetch("http://trust.fannarmaximus.com/s/abc?x=1", { redirect: "manual" });
	expect(res.status).toBe(301);
	expect(res.headers.get("location")).toBe("https://trust.fannarmaximus.com/s/abc?x=1");
});

it("plain http on localhost is not redirected (dev)", async () => {
	const res = await exports.default.fetch("http://localhost:8787/api/nope");
	expect(res.status).toBe(404);
});

it("https responses carry HSTS and the security headers", async () => {
	const res = await exports.default.fetch("https://trust.test/api/nope");
	expect(res.headers.get("strict-transport-security")).toBe("max-age=31536000");
	expect(res.headers.get("x-frame-options")).toBe("DENY");
	expect(res.headers.get("x-content-type-options")).toBe("nosniff");
	expect(res.headers.get("referrer-policy")).toBe("no-referrer");
	expect(res.headers.get("content-security-policy")).toBe(
		"default-src 'none'; script-src 'self'; style-src 'self'; font-src 'self'; img-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
	);
});

it.each(["/s/abc", "/s/abc/", "/s/abc.", "/s/", "/s/a/b"])("%s is a session path", (p) =>
	expect(isSessionPath(p)).toBe(true));
it.each(["/", "/sx", "/new", "/api/sessions/abc"])("%s is not a session path", (p) =>
	expect(isSessionPath(p)).toBe(false));
