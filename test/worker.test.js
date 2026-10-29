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

it("scheduled run clears ip hashes older than a day", async () => {
	const scores = { given: { c: 1, r: 1, i: 1, s: 1 }, predicted: { c: 1, r: 1, i: 1, s: 1 } };
	await createSession(env.DB, { creatorName: "A", inviteeName: "B", creatorScores: scores, creatorIpHash: "stale", now: Date.now() - 25 * 3_600_000 });
	await exports.default.scheduled({ scheduledTime: Date.now(), cron: "0 * * * *" }, env, { waitUntil() {} });
	const row = await env.DB.prepare("SELECT 1 AS x FROM creations WHERE ip_hash = 'stale'").first();
	expect(row).toBeNull();
});

it("scheduled run deletes expired sessions", async () => {
	const old = Date.now() - SESSION_TTL_MS - 1;
	const scores = { given: { c: 1, r: 1, i: 1, s: 1 }, predicted: { c: 1, r: 1, i: 1, s: 1 } };
	const s = await createSession(env.DB, { creatorName: "A", inviteeName: "B", creatorScores: scores, creatorIpHash: "h", now: old });
	await exports.default.scheduled({ scheduledTime: Date.now(), cron: "0 3 * * *" }, env, { waitUntil() {} });
	expect(await findByToken(env.DB, s.creatorToken, 0)).toBeNull();
});

import { isSessionPath, isMatchPath } from "../src/worker.js";

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

it.each(["/m/abc", "/m/abc/", "/m/"])("%s is a match path", (p) => expect(isMatchPath(p)).toBe(true));
it.each(["/match", "/m", "/s/abc"])("%s is not a match path", (p) => expect(isMatchPath(p)).toBe(false));

import { createMatch, findByToken as findMatch, setupSideB, submitMatchScore, markRevealed as markMatchRevealed } from "../src/matchstore.js";

it("scheduled run anonymises expired revealed matches", async () => {
	const old = Date.now() - SESSION_TTL_MS - 1;
	const mt = await createMatch(env.DB, { myTeam: "A", otherTeam: "B", creatorName: "a1", members: ["a2", "a3"], creatorIpHash: "h", now: old });
	await setupSideB(env.DB, mt.id, mt.bCaptainToken, { captainName: "b1", members: ["b2", "b3"] });
	const { sides } = await findMatch(env.DB, mt.creatorToken, old);
	const sc = { given: { c: 5, r: 5, i: 5, s: 5 }, predicted: { c: 5, r: 5, i: 5, s: 5 } };
	for (const m of [...sides.a.members, ...sides.b.members]) await submitMatchScore(env.DB, m.id, sc, old + 1);
	await markMatchRevealed(env.DB, mt.id, old + 2);
	const before = (await env.DB.prepare("SELECT COUNT(*) AS n FROM match_stats").first()).n;
	await exports.default.scheduled({ scheduledTime: Date.now(), cron: "0 * * * *" }, env, { waitUntil() {} });
	expect(await findMatch(env.DB, mt.creatorToken, 0)).toBeNull();
	expect((await env.DB.prepare("SELECT COUNT(*) AS n FROM match_stats").first()).n).toBe(before + 6);
});
