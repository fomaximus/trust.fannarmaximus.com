import { exports, env } from "cloudflare:workers";
import "../src/worker.js";
import { handleTeamApi } from "../src/teamapi.js";
import { submitTeamScore } from "../src/teamstore.js";
import { describe, it, expect } from "vitest";

const base = "https://trust.test";
const req = (path, method, body, ip = "1.1.1.1") =>
	exports.default.fetch(base + path, {
		method,
		headers: { "content-type": "application/json", "cf-connecting-ip": ip },
		body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body),
	});
const post = (p, b, ip) => req(p, "POST", b, ip);
const get = (p) => exports.default.fetch(base + p);
const del = (p) => req(p, "DELETE");
const teamBody = (members = ["Bjarni", "Clara"]) => ({ teamName: "Product", creatorName: "Anna", members });
const g = (c, r, i, s) => ({ given: { c, r, i, s } });

// Creates a team and returns { creatorToken, tokens: { Anna, Bjarni, ... }, ids: { Anna, ... } }
async function create(members) {
	const res = await post("/api/teams", teamBody(members));
	expect(res.status).toBe(201);
	const { creatorToken } = await res.json();
	const body = await (await get(`/api/teams/${creatorToken}`)).json();
	const tokens = {}, ids = {};
	for (const l of body.links) tokens[l.nickname] = l.url.split("/t/")[1];
	for (const m of body.members) ids[m.nickname] = m.id;
	return { creatorToken, tokens, ids, body };
}
const score = (token, s) => post(`/api/teams/${token}/score`, s);
const view = async (token) => (await get(`/api/teams/${token}`)).json();
const SCORES = { Anna: g(8, 7, 5, 8), Bjarni: g(9, 9, 9, 1), Clara: g(4, 6, 6, 2) };
async function finish(t) {
	for (const [name, s] of Object.entries(SCORES)) expect((await score(t.tokens[name], s)).status).toBe(200);
}

describe("POST /api/teams", () => {
	it("creates a team and the creator sees links for every member", async () => {
		const t = await create();
		expect(t.body).toMatchObject({ role: "creator", state: "needs_your_score", teamName: "Product", creatorName: "Anna" });
		expect(t.body.members.length).toBe(3);
		expect(t.body.links.length).toBe(3);
		expect(t.body.links[0].nickname).toBe("Anna");
		for (const l of t.body.links) expect(l.url).toMatch(/^https:\/\/trust\.test\/t\/[A-Za-z0-9_-]{22}$/);
	});
	it("400 on one other member and on duplicates", async () => {
		expect((await post("/api/teams", teamBody(["Bjarni"]))).status).toBe(400);
		expect((await post("/api/teams", teamBody(["anna", "Bjarni"]))).status).toBe(400);
	});
	it("400 on malformed json", async () => expect((await post("/api/teams", "{nope")).status).toBe(400));
	it("429 after 20 creations from one ip", async () => {
		for (let n = 0; n < 20; n++) expect((await post("/api/teams", teamBody(), "8.8.8.8")).status).toBe(201);
		expect((await post("/api/teams", teamBody(), "8.8.8.8")).status).toBe(429);
	});
});

describe("GET /api/teams/:token", () => {
	it("a member's GET has no links and no numbers at any state", async () => {
		const t = await create();
		let b = await view(t.tokens.Bjarni);
		expect(b.role).toBe("member");
		expect(b.links).toBeUndefined();
		await finish(t);
		b = await view(t.tokens.Bjarni);
		expect(b.state).toBe("revealed");
		expect(b.links).toBeUndefined();
		expect(JSON.stringify(b)).not.toMatch(/"given"|"token"|"you":\{"c"/);
		expect(b.reveal.you).toBeUndefined();
	});
	it("who-answered list updates as people score", async () => {
		const t = await create();
		expect((await view(t.creatorToken)).members.map((m) => m.answered)).toEqual([false, false, false]);
		await score(t.tokens.Clara, SCORES.Clara);
		expect((await view(t.creatorToken)).members.map((m) => m.answered)).toEqual([false, false, true]);
	});
	it("no reveal while one member is pending", async () => {
		const t = await create();
		await score(t.tokens.Anna, SCORES.Anna);
		await score(t.tokens.Bjarni, SCORES.Bjarni);
		const b = await view(t.creatorToken);
		expect(b.state).toBe("waiting");
		expect(b.reveal).toBeUndefined();
		expect(b.links.length).toBe(3);
	});
	it("reveal appears for everyone once the last member scores, with min/avg/max/you", async () => {
		const t = await create();
		await finish(t);
		for (const name of ["Anna", "Bjarni", "Clara"]) {
			const b = await view(t.tokens[name]);
			expect(b.state).toBe("revealed");
			expect(b.links).toBeUndefined();
			expect(b.reveal.size).toBe(3);
			expect(b.reveal.min).toEqual({ c: 4, r: 6, i: 5, s: 1, t: 2.5 });
			expect(b.reveal.max).toEqual({ c: 9, r: 9, i: 9, s: 8, t: 27 });
			expect(b.reveal.avg).toEqual({ c: 7, r: 7.3, i: 6.7, s: 3.7, t: 12.5 });
			expect(b.reveal.you).toBeUndefined();
		}
	});
	it("404 for unknown token", async () => expect((await get("/api/teams/zzzzzzzzzzzzzzzzzzzzzz")).status).toBe(404));
});

describe("POST /api/teams/:token/score", () => {
	it("returns your own numbers once, with T, and never again via GET", async () => {
		const t = await create();
		const res = await score(t.tokens.Bjarni, SCORES.Bjarni);
		expect(await res.json()).toEqual({ state: "waiting", you: { c: 9, r: 9, i: 9, s: 1, t: 27 } });
		await score(t.tokens.Anna, SCORES.Anna);
		await score(t.tokens.Clara, SCORES.Clara);
		// the creator holds Bjarni's link; opening it must not show Bjarni's numbers
		const asBjarni = await view(t.tokens.Bjarni);
		expect(asBjarni.state).toBe("revealed");
		expect(JSON.stringify(asBjarni)).not.toMatch(/"given"|"you":\{"c"/);
	});
	it("409 on second score, 400 on bad scores", async () => {
		const t = await create();
		expect((await score(t.tokens.Anna, g(0, 1, 1, 1))).status).toBe(400);
		expect((await score(t.tokens.Anna, SCORES.Anna)).status).toBe(200);
		expect((await score(t.tokens.Anna, SCORES.Anna)).status).toBe(409);
	});
});

describe("POST /api/teams/:token/remove", () => {
	it("403 for a member, 409 for answered target or too small, 200 otherwise and reveal can unlock", async () => {
		const t = await create(["Bjarni", "Clara", "Dora"]);
		const remove = (token, id) => post(`/api/teams/${token}/remove`, { memberId: id });
		expect((await remove(t.tokens.Bjarni, t.ids.Dora)).status).toBe(403);
		await finish(t);
		expect((await remove(t.creatorToken, t.ids.Clara)).status).toBe(409);
		expect((await view(t.creatorToken)).state).toBe("waiting");
		const res = await remove(t.creatorToken, t.ids.Dora);
		expect(res.status).toBe(200);
		expect((await res.json()).state).toBe("revealed");
		expect((await view(t.tokens.Bjarni)).reveal.size).toBe(3);
		const small = await create();
		expect((await post(`/api/teams/${small.creatorToken}/remove`, { memberId: small.ids.Bjarni })).status).toBe(409);
	});
});

describe("DELETE /api/teams/:token", () => {
	const statsCount = async () => (await env.DB.prepare("SELECT COUNT(*) AS n FROM team_stats").first()).n;
	it("by creator before reveal removes everything; after reveal anonymises", async () => {
		const a = await create();
		expect((await del(`/api/teams/${a.creatorToken}`)).status).toBe(200);
		for (const tok of Object.values(a.tokens)) expect((await get(`/api/teams/${tok}`)).status).toBe(404);
		const before = await statsCount();
		const b = await create();
		await finish(b);
		expect(await (await del(`/api/teams/${b.creatorToken}`)).json()).toEqual({ deleted: true });
		expect((await get(`/api/teams/${b.tokens.Clara}`)).status).toBe(404);
		expect(await statsCount()).toBe(before + 3);
	});
	it("by an unanswered member leaves", async () => {
		const t = await create(["Bjarni", "Clara", "Dora"]);
		expect(await (await del(`/api/teams/${t.tokens.Dora}`)).json()).toEqual({ deleted: true });
		expect((await view(t.creatorToken)).members.map((m) => m.nickname)).toEqual(["Anna", "Bjarni", "Clara"]);
		expect((await get(`/api/teams/${t.tokens.Dora}`)).status).toBe(404);
	});
	it("answered member before reveal is 409; leaving below three is 409", async () => {
		const t = await create();
		await score(t.tokens.Bjarni, SCORES.Bjarni);
		expect((await del(`/api/teams/${t.tokens.Bjarni}`)).status).toBe(409);
		expect((await del(`/api/teams/${t.tokens.Clara}`)).status).toBe(409);
	});
	it("after reveal a member can remove their name; aggregate unchanged", async () => {
		const t = await create();
		await finish(t);
		const before = (await view(t.creatorToken)).reveal;
		expect((await del(`/api/teams/${t.tokens.Bjarni}`)).status).toBe(200);
		expect((await get(`/api/teams/${t.tokens.Bjarni}`)).status).toBe(404);
		const after = await view(t.creatorToken);
		expect(after.members[1].nickname).toBe("");
		expect(after.members[1].answered).toBe(true);
		expect(after.reveal).toEqual(before);
	});
	it("a remove that loses the race to the target's score is 409, not success", async () => {
		const t = await create(["Bjarni", "Clara", "Dora"]);
		// Wrap the DB so the target answers between the API's read and its DELETE.
		const real = env.DB;
		const db = new Proxy(real, {
			get(target, prop) {
				if (prop !== "prepare") {
					const v = Reflect.get(target, prop);
					return typeof v === "function" ? v.bind(target) : v;
				}
				return (sql) => {
					const stmt = target.prepare(sql);
					if (!/DELETE FROM members WHERE id/.test(sql)) return stmt;
					return {
						bind: (...args) => {
							const bound = stmt.bind(...args);
							return { run: async () => { await submitTeamScore(real, args[0], { given: { c: 1, r: 1, i: 1, s: 1 } }, Date.now()); return bound.run(); } };
						},
					};
				};
			},
		});
		const req = new Request(`${base}/api/teams/${t.creatorToken}/remove`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ memberId: t.ids.Dora }) });
		const res = await handleTeamApi(req, { DB: db, IP_SALT: env.IP_SALT });
		expect(res.status).toBe(409);
		expect((await view(t.creatorToken)).members.length).toBe(4);
	});
	it("unknown token is 404 on every route", async () => {
		const z = "zzzzzzzzzzzzzzzzzzzzzz";
		expect((await del(`/api/teams/${z}`)).status).toBe(404);
		expect((await score(z, SCORES.Anna)).status).toBe(404);
		expect((await post(`/api/teams/${z}/remove`, { memberId: "x" })).status).toBe(404);
	});
});
