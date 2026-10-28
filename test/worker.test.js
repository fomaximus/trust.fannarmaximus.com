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
