import { env } from "cloudflare:workers";
import { describe, it, expect, beforeEach } from "vitest";
import { createMatch, findByToken, setupSideB, submitMatchScore, markRevealed, removeMember, forgetMemberName, anonymiseMatch, deleteMatch, anonymiseExpiredMatches } from "../src/matchstore.js";
import { SESSION_TTL_MS } from "../src/session.js";

const now = Date.UTC(2027, 0, 15, 12);
const sc = (c) => ({ given: { c, r: c, i: c, s: 1 }, predicted: { c: 5, r: 5, i: 5, s: 5 } });
const make = (at = now, members = ["Bjarni", "Clara"]) =>
	createMatch(env.DB, { myTeam: "Product", otherTeam: "Sales", creatorName: "Anna", members, creatorIpHash: "h", now: at });
const count = async (table) => (await env.DB.prepare(`SELECT COUNT(*) AS n FROM ${table}`).first()).n;
const setup = (mt, members = ["Finnur", "Gunnar"]) => setupSideB(env.DB, mt.id, mt.bCaptainToken, { captainName: "Eva", members });
const finish = async (mt, at = now) => {
	await setup(mt);
	const { sides } = await findByToken(env.DB, mt.creatorToken, at);
	let i = 0;
	for (const m of [...sides.a.members, ...sides.b.members]) await submitMatchScore(env.DB, m.id, sc(4 + i++), at + i);
	return sides;
};

describe("match store", () => {
	beforeEach(async () => {
		await env.DB.batch(["matches", "sides", "members", "match_stats", "creations"].map((t) => env.DB.prepare(`DELETE FROM ${t}`)));
	});

	it("creates side a with captain first, an unclaimed captain token for b, one creation row", async () => {
		const mt = await make();
		expect(mt.bCaptainToken).toMatch(/^[A-Za-z0-9_-]{22}$/);
		const f = await findByToken(env.DB, mt.creatorToken, now);
		expect(f.match.expiresAt).toBe(now + SESSION_TTL_MS);
		expect(f.sides.a.name).toBe("Product");
		expect(f.sides.a.members.map((m) => m.nickname)).toEqual(["Anna", "Bjarni", "Clara"]);
		expect(f.sides.a.members[0].isCaptain).toBe(true);
		expect(f.sides.b.name).toBe("Sales");
		expect(f.sides.b.members).toEqual([]);
		expect(f.you.id).toBe(f.sides.a.members[0].id);
		expect(f.you.side).toBe("a");
		expect(await count("creations")).toBe(1);
	});

	it("the unclaimed captain token resolves to a setup placeholder", async () => {
		const mt = await make();
		const f = await findByToken(env.DB, mt.bCaptainToken, now);
		expect(f.you).toEqual({ unclaimedCaptain: true, side: "b" });
		expect(f.match.bCaptainToken).toBe(mt.bCaptainToken);
	});

	it("setupSideB works once; afterwards the token is b's captain", async () => {
		const mt = await make();
		expect(await setup(mt)).toBe(true);
		expect(await setup(mt)).toBe(false);
		const f = await findByToken(env.DB, mt.bCaptainToken, now);
		expect(f.you.nickname).toBe("Eva");
		expect(f.you.isCaptain).toBe(true);
		expect(f.you.side).toBe("b");
		expect(f.match.bCaptainToken).toBeNull();
		expect(f.sides.b.members.map((m) => m.nickname)).toEqual(["Eva", "Finnur", "Gunnar"]);
		expect(new Set([...f.sides.a.members, ...f.sides.b.members].map((m) => m.token)).size).toBe(6);
	});

	it("unknown and expired tokens are null", async () => {
		const mt = await make();
		expect(await findByToken(env.DB, "nope", now)).toBeNull();
		expect(await findByToken(env.DB, mt.creatorToken, now + SESSION_TTL_MS)).toBeNull();
	});

	it("a member scores once", async () => {
		const mt = await make();
		const { you } = await findByToken(env.DB, mt.creatorToken, now);
		expect(await submitMatchScore(env.DB, you.id, sc(7), now)).toBe(true);
		expect(await submitMatchScore(env.DB, you.id, sc(8), now)).toBe(false);
		expect((await findByToken(env.DB, mt.creatorToken, now)).you.scores).toEqual(sc(7));
	});

	it("markRevealed is idempotent", async () => {
		const mt = await make();
		await markRevealed(env.DB, mt.id, now);
		await markRevealed(env.DB, mt.id, now + 5);
		expect((await findByToken(env.DB, mt.creatorToken, now)).match.revealedAt).toBe(now);
	});

	it("removeMember deletes only unscored members and never below three per side", async () => {
		const mt = await make(now, ["Bjarni", "Clara", "Dora"]);
		const { sides } = await findByToken(env.DB, mt.creatorToken, now);
		const [, b, c, d] = sides.a.members;
		await submitMatchScore(env.DB, d.id, sc(5), now);
		expect(await removeMember(env.DB, d.id)).toBe(false);
		expect(await removeMember(env.DB, b.id)).toBe(true);
		expect(await removeMember(env.DB, c.id)).toBe(false);
		expect((await findByToken(env.DB, mt.creatorToken, now)).sides.a.members.map((m) => m.nickname)).toEqual(["Anna", "Clara", "Dora"]);
	});

	it("forgetMemberName blanks nickname and token but keeps scores", async () => {
		const mt = await make();
		const sides = await finish(mt);
		const b1 = sides.a.members[1];
		expect(await forgetMemberName(env.DB, b1.id)).toBe(true);
		expect(await findByToken(env.DB, b1.token, now)).toBeNull();
		const after = (await findByToken(env.DB, mt.creatorToken, now)).sides.a.members[1];
		expect(after.nickname).toBe("");
		expect(after.token).toBeNull();
		expect(after.scores).toEqual(sc(5));
	});

	it("anonymiseMatch refuses before reveal and works after, tagging the rater's side", async () => {
		const mt = await make();
		await finish(mt);
		expect(await anonymiseMatch(env.DB, mt.id, now)).toBe(false);
		await markRevealed(env.DB, mt.id, now);
		expect(await anonymiseMatch(env.DB, mt.id, now)).toBe(true);
		expect(await findByToken(env.DB, mt.creatorToken, now)).toBeNull();
		const { results } = await env.DB.prepare("SELECT * FROM match_stats ORDER BY c").all();
		expect(results.length).toBe(6);
		expect(new Set(results.map((r) => r.match_key)).size).toBe(1);
		expect(results.map((r) => r.side).sort()).toEqual(["a", "a", "a", "b", "b", "b"]);
		expect(results[0]).toMatchObject({ day: "2027-01-15", size: 3, c: 4, s: 1, t: 12, pc: 5, pt: 3 });
		expect(JSON.stringify(results)).not.toMatch(/Anna|Product|Sales/);
		expect(await count("sides")).toBe(0);
	});

	it("deleteMatch removes sides, members and match with no stats", async () => {
		const mt = await make();
		await setup(mt);
		expect(await deleteMatch(env.DB, mt.id)).toBe(true);
		expect(await count("members")).toBe(0);
		expect(await count("sides")).toBe(0);
		expect(await count("match_stats")).toBe(0);
	});

	it("anonymiseExpiredMatches keeps revealed, drops unrevealed, leaves fresh", async () => {
		const old = now - SESSION_TTL_MS - 1;
		const done = await make(old);
		await finish(done, old);
		await markRevealed(env.DB, done.id, old + 10);
		const undone = await make(old);
		const fresh = await make(now);
		expect(await anonymiseExpiredMatches(env.DB, now)).toEqual({ kept: 1, dropped: 1 });
		expect(await count("match_stats")).toBe(6);
		expect(await findByToken(env.DB, done.creatorToken, 0)).toBeNull();
		expect(await findByToken(env.DB, undone.creatorToken, 0)).toBeNull();
		expect(await findByToken(env.DB, fresh.creatorToken, now)).not.toBeNull();
	});
});
