import { exports, env } from "cloudflare:workers";
import "../src/worker.js";
import { handleMatchApi } from "../src/matchapi.js";
import { submitMatchScore } from "../src/matchstore.js";
import { describe, it, expect } from "vitest";

const base = "https://trust.test";
const H = { "content-type": "application/json" };
const req = (path, method, body, ip = "1.1.1.1") =>
	exports.default.fetch(base + path, { method, headers: { ...H, "cf-connecting-ip": ip }, body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body) });
const post = (p, b, ip) => req(p, "POST", b, ip);
const get = (p) => exports.default.fetch(base + p);
const del = (p) => req(p, "DELETE");
const view = async (t) => (await get(`/api/matches/${t}`)).json();
const tok = (url) => url.split("/m/")[1];
const matchBody = (members = ["Bjarni", "Clara"]) => ({ myTeam: "Product", otherTeam: "Sales", creatorName: "Anna", members });
const sc = (g, p) => ({ given: { c: g[0], r: g[1], i: g[2], s: g[3] }, predicted: { c: p[0], r: p[1], i: p[2], s: p[3] } });
const score = (t, s) => post(`/api/matches/${t}/score`, s);

// Side A scores (about B) and predictions; side B scores (about A) and predictions.
const A = { Anna: sc([8, 7, 5, 8], [6, 6, 6, 6]), Bjarni: sc([9, 9, 9, 1], [2, 2, 2, 2]), Clara: sc([4, 6, 6, 2], [4, 4, 4, 4]) };
const B = { Eva: sc([5, 5, 5, 5], [9, 9, 9, 1]), Finnur: sc([6, 6, 6, 6], [3, 3, 3, 3]), Gunnar: sc([7, 7, 7, 7], [6, 6, 6, 6]) };

async function create(members) {
	const res = await post("/api/matches", matchBody(members));
	expect(res.status).toBe(201);
	const { creatorToken } = await res.json();
	const body = await view(creatorToken);
	const a = {}, ids = {};
	for (const l of body.links) a[l.nickname] = tok(l.url);
	for (const m of body.teams.you.members) ids[m.nickname] = m.id;
	return { creatorToken, captainLink: tok(body.captainLink), a, ids, body };
}
async function setup(m, members = ["Finnur", "Gunnar"]) {
	const res = await post(`/api/matches/${m.captainLink}/setup`, { captainName: "Eva", members });
	expect(res.status).toBe(200);
	const body = await view(m.captainLink);
	const b = {}, ids = {};
	for (const l of body.links) b[l.nickname] = tok(l.url);
	for (const x of body.teams.you.members) ids[x.nickname] = x.id;
	return { b, ids, body };
}
async function finish(m, s, skip = []) {
	for (const [n, v] of Object.entries(A)) if (!skip.includes(n)) expect((await score(m.a[n], v)).status).toBe(200);
	for (const [n, v] of Object.entries(B)) if (!skip.includes(n)) expect((await score(s.b[n], v)).status).toBe(200);
}

describe("POST /api/matches and captain views", () => {
	it("creates side a; captain sees links and the captain link; a member sees neither", async () => {
		const m = await create();
		expect(m.body).toMatchObject({ role: "captain", side: "a", state: "needs_your_score" });
		expect(m.body.teams.you.name).toBe("Product");
		expect(m.body.teams.other.name).toBe("Sales");
		expect(m.body.teams.other.members).toBeNull();
		expect(m.body.links.length).toBe(3);
		expect(m.body.captainLink).toMatch(/^https:\/\/trust\.test\/m\/[A-Za-z0-9_-]{22}$/);
		const member = await view(m.a.Bjarni);
		expect(member.role).toBe("member");
		expect(member.links).toBeUndefined();
		expect(member.captainLink).toBeUndefined();
	});
	it("400 on bad bodies, 429 after 20 creations", async () => {
		expect((await post("/api/matches", matchBody(["Bjarni"]))).status).toBe(400);
		expect((await post("/api/matches", "{nope")).status).toBe(400);
		for (let n = 0; n < 20; n++) expect((await post("/api/matches", matchBody(), "6.6.6.6")).status).toBe(201);
		expect((await post("/api/matches", matchBody(), "6.6.6.6")).status).toBe(429);
	});
});

describe("captain link for side b", () => {
	it("unclaimed: GET is setup with team names and no links; other calls are 409", async () => {
		const m = await create();
		const b = await view(m.captainLink);
		expect(b).toMatchObject({ role: "captain", side: "b", state: "setup" });
		expect(b.teams.you.name).toBe("Sales");
		expect(b.teams.other.name).toBe("Product");
		expect(b.links).toBeUndefined();
		expect(JSON.stringify(b)).not.toMatch(/"url"|"token"/);
		expect((await score(m.captainLink, A.Anna)).status).toBe(409);
		expect((await post(`/api/matches/${m.captainLink}/remove`, { memberId: m.ids.Bjarni })).status).toBe(409);
		expect((await del(`/api/matches/${m.captainLink}`)).status).toBe(409);
	});
	it("setup once; then the token is b's captain with links; a's captain loses the captainLink", async () => {
		const m = await create();
		const s = await setup(m);
		expect(s.body).toMatchObject({ role: "captain", side: "b", state: "needs_your_score" });
		expect(s.body.links.length).toBe(3);
		expect(s.body.captainLink).toBeUndefined();
		expect(s.body.teams.you.members.map((x) => x.nickname)).toEqual(["Eva", "Finnur", "Gunnar"]);
		expect((await post(`/api/matches/${m.captainLink}/setup`, { captainName: "Eva", members: ["X", "Y"] })).status).toBe(409);
		expect((await view(m.creatorToken)).captainLink).toBeUndefined();
	});
	it("setup rejects a side with duplicates but allows names also used on side a", async () => {
		const m = await create();
		expect((await post(`/api/matches/${m.captainLink}/setup`, { captainName: "Eva", members: ["eva", "Y"] })).status).toBe(400);
		expect((await post(`/api/matches/${m.captainLink}/setup`, { captainName: "Anna", members: ["Bjarni", "Clara"] })).status).toBe(200);
	});
});

describe("scoring and reveal", () => {
	it("a members can answer before b exists; no reveal until all six; then everyone sees the mirror", async () => {
		const m = await create();
		await score(m.a.Anna, A.Anna);
		expect((await view(m.a.Anna)).state).toBe("waiting");
		expect((await view(m.creatorToken)).teams.you.members[0].answered).toBe(true);
		const s = await setup(m);
		await score(m.a.Bjarni, A.Bjarni);
		await score(m.a.Clara, A.Clara);
		await score(s.b.Eva, B.Eva);
		await score(s.b.Finnur, B.Finnur);
		const pending = await view(m.creatorToken);
		expect(pending.state).toBe("waiting");
		expect(pending.reveal).toBeUndefined();
		expect(pending.teams.other.members.map((x) => x.answered)).toEqual([true, true, false]);
		await score(s.b.Gunnar, B.Gunnar);
		const fromA = await view(m.a.Clara);
		expect(fromA.state).toBe("revealed");
		// A received what B gave: 5s, 6s, 7s; A expected (its own predictions): 6,2,4 → avg 4, T (3,3,3) → 3
		expect(fromA.reveal.you.received.min).toEqual({ c: 5, r: 5, i: 5, s: 5, t: 3 });
		expect(fromA.reveal.you.received.max).toEqual({ c: 7, r: 7, i: 7, s: 7, t: 3 });
		expect(fromA.reveal.you.received.avg).toEqual({ c: 6, r: 6, i: 6, s: 6, t: 3 });
		expect(fromA.reveal.you.expected).toEqual({ c: 4, r: 4, i: 4, s: 4, t: 3 });
		// B received what A gave
		expect(fromA.reveal.other.received.avg).toEqual({ c: 7, r: 7.3, i: 6.7, s: 3.7, t: 12.5 });
		expect(fromA.reveal.other.expected).toEqual({ c: 6, r: 6, i: 6, s: 3.3, t: 11 });
		const fromB = await view(s.b.Eva);
		expect(fromB.reveal.you).toEqual(fromA.reveal.other);
		expect(fromB.reveal.other).toEqual(fromA.reveal.you);
		for (const body of [fromA, fromB]) expect(JSON.stringify(body)).not.toMatch(/"given"|"predicted"|"token"|"url"/);
	});
	it("409 on second score, 400 on a missing block", async () => {
		const m = await create();
		expect((await score(m.a.Anna, { given: A.Anna.given })).status).toBe(400);
		expect((await score(m.a.Anna, A.Anna)).status).toBe(200);
		expect((await score(m.a.Anna, A.Anna)).status).toBe(409);
	});
});

describe("remove", () => {
	it("captains remove only on their own side; floor; 403 across sides; reveal can unlock", async () => {
		const m = await create(["Bjarni", "Clara", "Dora"]);
		const s = await setup(m);
		const remove = (t, id) => post(`/api/matches/${t}/remove`, { memberId: id });
		expect((await remove(m.a.Bjarni, m.ids.Dora)).status).toBe(403);
		expect((await remove(m.captainLink, m.ids.Dora)).status).toBe(403);
		expect((await remove(m.creatorToken, s.ids.Finnur)).status).toBe(403);
		await finish(m, s);
		expect((await remove(m.creatorToken, m.ids.Clara)).status).toBe(409);
		expect((await view(m.creatorToken)).state).toBe("waiting");
		const res = await remove(m.creatorToken, m.ids.Dora);
		expect(res.status).toBe(200);
		expect((await res.json()).state).toBe("revealed");
		const small = await create();
		expect((await remove(small.creatorToken, small.ids.Bjarni)).status).toBe(409);
	});
	it("a remove that loses the race to the target's score is 409", async () => {
		const m = await create(["Bjarni", "Clara", "Dora"]);
		const real = env.DB;
		const db = new Proxy(real, {
			get(target, prop) {
				if (prop !== "prepare") { const v = Reflect.get(target, prop); return typeof v === "function" ? v.bind(target) : v; }
				return (sql) => {
					const stmt = target.prepare(sql);
					if (!/DELETE FROM members WHERE id/.test(sql)) return stmt;
					return { bind: (...args) => { const bound = stmt.bind(...args); return { run: async () => { await submitMatchScore(real, args[0], A.Anna, Date.now()); return bound.run(); } }; } };
				};
			},
		});
		const r = new Request(`${base}/api/matches/${m.creatorToken}/remove`, { method: "POST", headers: H, body: JSON.stringify({ memberId: m.ids.Dora }) });
		expect((await handleMatchApi(r, { DB: db, IP_SALT: env.IP_SALT })).status).toBe(409);
	});
});

describe("DELETE", () => {
	const stats = async () => (await env.DB.prepare("SELECT COUNT(*) AS n FROM match_stats").first()).n;
	it("either captain: removes before reveal, anonymises after", async () => {
		const m1 = await create();
		const s1 = await setup(m1);
		expect((await del(`/api/matches/${s1.b.Eva}`)).status).toBe(200);
		expect((await get(`/api/matches/${m1.creatorToken}`)).status).toBe(404);
		const before = await stats();
		const m2 = await create();
		const s2 = await setup(m2);
		await finish(m2, s2);
		expect((await del(`/api/matches/${m2.creatorToken}`)).status).toBe(200);
		expect((await get(`/api/matches/${s2.b.Gunnar}`)).status).toBe(404);
		expect(await stats()).toBe(before + 6);
	});
	it("members: leave before answering (floor), 409 once answered, forget name after reveal", async () => {
		const m = await create(["Bjarni", "Clara", "Dora"]);
		const s = await setup(m);
		expect((await del(`/api/matches/${m.a.Dora}`)).status).toBe(200);
		expect((await view(m.creatorToken)).teams.you.members.length).toBe(3);
		expect((await del(`/api/matches/${m.a.Clara}`)).status).toBe(409);
		await score(m.a.Bjarni, A.Bjarni);
		expect((await del(`/api/matches/${m.a.Bjarni}`)).status).toBe(409);
		await finish(m, s, ["Bjarni"]);
		const before = (await view(m.creatorToken)).reveal;
		expect((await del(`/api/matches/${s.b.Finnur}`)).status).toBe(200);
		expect((await get(`/api/matches/${s.b.Finnur}`)).status).toBe(404);
		const after = await view(m.creatorToken);
		expect(after.teams.other.members[1].nickname).toBe("");
		expect(after.reveal).toEqual(before);
	});
	it("unknown token is 404 everywhere", async () => {
		const z = "zzzzzzzzzzzzzzzzzzzzzz";
		for (const r of [get(`/api/matches/${z}`), del(`/api/matches/${z}`), score(z, A.Anna), post(`/api/matches/${z}/setup`, {}), post(`/api/matches/${z}/remove`, {})]) expect((await r).status).toBe(404);
	});
});
