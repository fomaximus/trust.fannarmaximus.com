import { exports } from "cloudflare:workers";
import "../src/worker.js";
import { describe, it, expect } from "vitest";

const base = "https://trust.test";
const good = { creatorName: "Anna", inviteeName: "Bjarni", given: { c: 8, r: 7, i: 5, s: 8 }, predicted: { c: 6, r: 6, i: 6, s: 6 } };
const post = (path, body, ip = "1.1.1.1") =>
	exports.default.fetch(base + path, {
		method: "POST",
		headers: { "content-type": "application/json", "cf-connecting-ip": ip },
		body: typeof body === "string" ? body : JSON.stringify(body),
	});
const get = (path) => exports.default.fetch(base + path);
const create = async (ip) => (await post("/api/sessions", good, ip)).json();

describe("POST /api/sessions", () => {
	it("creates and returns two distinct tokens", async () => {
		const res = await post("/api/sessions", good);
		expect(res.status).toBe(201);
		const { creatorToken, inviteeToken } = await res.json();
		expect(creatorToken).toMatch(/^[A-Za-z0-9_-]{22}$/);
		expect(inviteeToken).not.toBe(creatorToken);
	});
	it("400 on bad scores", async () =>
		expect((await post("/api/sessions", { ...good, given: { ...good.given, c: 0 } })).status).toBe(400));
	it("400 on malformed json", async () => {
		const res = await post("/api/sessions", "{not json");
		expect(res.status).toBe(400);
		expect((await res.json()).error).toBe("invalid");
	});
	it("429 after 20 creations from one ip in an hour", async () => {
		for (let n = 0; n < 20; n++) expect((await post("/api/sessions", good, "9.9.9.9")).status).toBe(201);
		expect((await post("/api/sessions", good, "9.9.9.9")).status).toBe(429);
	});
});

describe("GET /api/sessions/:token", () => {
	it("creator sees waiting, invitee link, and no numbers", async () => {
		const { creatorToken, inviteeToken } = await create();
		const body = await (await get(`/api/sessions/${creatorToken}`)).json();
		expect(body).toMatchObject({ role: "creator", state: "waiting", creatorName: "Anna", inviteeName: "Bjarni", inviteeToken });
		expect(JSON.stringify(body)).not.toMatch(/"given"|"predicted"/);
	});
	it("invitee sees needs_your_score and no creator token", async () => {
		const { inviteeToken } = await create();
		const body = await (await get(`/api/sessions/${inviteeToken}`)).json();
		expect(body.state).toBe("needs_your_score");
		expect(body.inviteeToken).toBeUndefined();
		expect(body.creatorToken).toBeUndefined();
	});
	it("404 for unknown token", async () =>
		expect((await get("/api/sessions/zzzzzzzzzzzzzzzzzzzzzz")).status).toBe(404));
});

describe("POST /api/sessions/:token/score", () => {
	const mine = { given: { c: 9, r: 9, i: 9, s: 1 }, predicted: { c: 5, r: 5, i: 5, s: 5 } };
	it("reveals to both with totals", async () => {
		const { creatorToken, inviteeToken } = await create();
		expect((await post(`/api/sessions/${inviteeToken}/score`, mine)).status).toBe(200);
		for (const t of [creatorToken, inviteeToken]) {
			const body = await (await get(`/api/sessions/${t}`)).json();
			expect(body.state).toBe("revealed");
			expect(body.reveal.creator).toEqual({ given: good.given, predicted: good.predicted, givenT: 2.5, predictedT: 3 });
			expect(body.reveal.invitee).toEqual({ given: mine.given, predicted: mine.predicted, givenT: 27, predictedT: 3 });
		}
	});
	it("invitee may correct their name", async () => {
		const { creatorToken, inviteeToken } = await create();
		await post(`/api/sessions/${inviteeToken}/score`, { ...mine, name: "Bjarki" });
		expect((await (await get(`/api/sessions/${creatorToken}`)).json()).inviteeName).toBe("Bjarki");
	});
	it("403 for creator token", async () => {
		const { creatorToken } = await create();
		expect((await post(`/api/sessions/${creatorToken}/score`, mine)).status).toBe(403);
	});
	it("409 on second submit", async () => {
		const { inviteeToken } = await create();
		await post(`/api/sessions/${inviteeToken}/score`, mine);
		expect((await post(`/api/sessions/${inviteeToken}/score`, mine)).status).toBe(409);
	});
	it("404 unknown token", async () =>
		expect((await post("/api/sessions/zzzzzzzzzzzzzzzzzzzzzz/score", mine)).status).toBe(404));
});

import { hashIp } from "../src/api.js";

describe("DELETE /api/sessions/:token", () => {
	const mine = { given: { c: 9, r: 9, i: 9, s: 1 }, predicted: { c: 5, r: 5, i: 5, s: 5 } };
	const del = (t) => exports.default.fetch(`${base}/api/sessions/${t}`, { method: "DELETE" });
	it("either party can delete; both links die", async () => {
		for (const who of ["creatorToken", "inviteeToken"]) {
			const made = await create();
			await post(`/api/sessions/${made.inviteeToken}/score`, mine);
			const res = await del(made[who]);
			expect(res.status).toBe(200);
			expect(await res.json()).toEqual({ deleted: true });
			expect((await get(`/api/sessions/${made.creatorToken}`)).status).toBe(404);
			expect((await get(`/api/sessions/${made.inviteeToken}`)).status).toBe(404);
		}
	});
	it("an unfinished session can be deleted too", async () => {
		const made = await create();
		expect((await del(made.creatorToken)).status).toBe(200);
		expect((await get(`/api/sessions/${made.inviteeToken}`)).status).toBe(404);
	});
	it("404 for unknown token", async () => expect((await del("zzzzzzzzzzzzzzzzzzzzzz")).status).toBe(404));
	it("deleting sessions does not reset the rate limit", async () => {
		for (let n = 0; n < 20; n++) {
			const res = await post("/api/sessions", good, "7.7.7.7");
			expect(res.status).toBe(201);
			expect((await del((await res.json()).creatorToken)).status).toBe(200);
		}
		expect((await post("/api/sessions", good, "7.7.7.7")).status).toBe(429);
	});
});

describe("hashIp", () => {
	it("is 64 hex chars and depends on the salt", async () => {
		const a = await hashIp("1.2.3.4", "salt-a");
		const b = await hashIp("1.2.3.4", "salt-b");
		expect(a).toMatch(/^[0-9a-f]{64}$/);
		expect(a).not.toBe(b);
	});
});
