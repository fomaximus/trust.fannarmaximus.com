import { env } from "cloudflare:workers";
import { describe, it, expect, beforeEach } from "vitest";
import { createTeam, findTeamByToken, submitTeamScore, markRevealed, removeMember, forgetMemberName, anonymiseTeam, deleteTeam, anonymiseExpiredTeams } from "../src/teamstore.js";
import { SESSION_TTL_MS } from "../src/session.js";

const now = Date.UTC(2027, 0, 15, 12);
const scores = (c) => ({ given: { c, r: c, i: c, s: 1 } });
const make = (names = ["Bjarni", "Clara"], at = now) =>
	createTeam(env.DB, { teamName: "Product", creatorName: "Anna", members: names, creatorIpHash: "h", now: at });
const count = async (table) => (await env.DB.prepare(`SELECT COUNT(*) AS n FROM ${table}`).first()).n;
const finish = async (t, at = now) => {
	const { members } = await findTeamByToken(env.DB, t.creatorToken, at);
	for (const [i, m] of members.entries()) await submitTeamScore(env.DB, m.id, scores(i + 4), at + i);
	return members;
};

describe("team store", () => {
	beforeEach(async () => {
		await env.DB.batch(["teams", "members", "team_stats", "creations"].map((t) => env.DB.prepare(`DELETE FROM ${t}`)));
	});

	it("creates a team with creator first and one token per member", async () => {
		const t = await make();
		const found = await findTeamByToken(env.DB, t.creatorToken, now);
		expect(found.team.name).toBe("Product");
		expect(found.team.expiresAt).toBe(now + SESSION_TTL_MS);
		expect(found.members.map((m) => m.nickname)).toEqual(["Anna", "Bjarni", "Clara"]);
		expect(found.members[0].isCreator).toBe(true);
		expect(found.you.id).toBe(found.members[0].id);
		const tokens = found.members.map((m) => m.token);
		expect(new Set(tokens).size).toBe(3);
		tokens.forEach((tok) => expect(tok).toMatch(/^[A-Za-z0-9_-]{22}$/));
		expect(await count("creations")).toBe(1);
	});

	it("finds a member by their own token", async () => {
		const t = await make();
		const { members } = await findTeamByToken(env.DB, t.creatorToken, now);
		const b = await findTeamByToken(env.DB, members[1].token, now);
		expect(b.you.nickname).toBe("Bjarni");
		expect(b.you.isCreator).toBe(false);
	});

	it("unknown and expired tokens are null", async () => {
		const t = await make(["B", "C"], now);
		expect(await findTeamByToken(env.DB, "nope", now)).toBeNull();
		expect(await findTeamByToken(env.DB, t.creatorToken, now + SESSION_TTL_MS)).toBeNull();
	});

	it("a member scores once", async () => {
		const t = await make();
		const { you } = await findTeamByToken(env.DB, t.creatorToken, now);
		expect(await submitTeamScore(env.DB, you.id, scores(7), now)).toBe(true);
		expect(await submitTeamScore(env.DB, you.id, scores(8), now)).toBe(false);
		expect((await findTeamByToken(env.DB, t.creatorToken, now)).you.scores).toEqual(scores(7));
	});

	it("markRevealed is idempotent", async () => {
		const t = await make();
		await markRevealed(env.DB, t.id, now);
		await markRevealed(env.DB, t.id, now + 5);
		expect((await findTeamByToken(env.DB, t.creatorToken, now)).team.revealedAt).toBe(now);
	});

	it("removeMember deletes only unscored members", async () => {
		const t = await make(["Bjarni", "Clara", "Dora"]);
		const { members } = await findTeamByToken(env.DB, t.creatorToken, now);
		await submitTeamScore(env.DB, members[2].id, scores(5), now);
		expect(await removeMember(env.DB, members[2].id)).toBe(false);
		expect(await removeMember(env.DB, members[1].id)).toBe(true);
		expect((await findTeamByToken(env.DB, t.creatorToken, now)).members.map((m) => m.nickname)).toEqual(["Anna", "Clara", "Dora"]);
	});

	it("removeMember refuses to drop a team below three, even when unscored", async () => {
		const t = await make();
		const { members } = await findTeamByToken(env.DB, t.creatorToken, now);
		expect(await removeMember(env.DB, members[1].id)).toBe(false);
		expect((await findTeamByToken(env.DB, t.creatorToken, now)).members.length).toBe(3);
	});

	it("forgetMemberName blanks nickname and token but keeps scores", async () => {
		const t = await make();
		const members = await finish(t);
		expect(await forgetMemberName(env.DB, members[1].id)).toBe(true);
		expect(await findTeamByToken(env.DB, members[1].token, now)).toBeNull();
		const after = (await findTeamByToken(env.DB, t.creatorToken, now)).members[1];
		expect(after.nickname).toBe("");
		expect(after.token).toBeNull();
		expect(after.scores).toEqual(scores(5));
	});

	it("anonymiseTeam refuses before reveal and works after", async () => {
		const t = await make();
		await finish(t);
		expect(await anonymiseTeam(env.DB, t.id, now)).toBe(false);
		await markRevealed(env.DB, t.id, now);
		expect(await anonymiseTeam(env.DB, t.id, now)).toBe(true);
		expect(await findTeamByToken(env.DB, t.creatorToken, now)).toBeNull();
		const { results } = await env.DB.prepare("SELECT * FROM team_stats ORDER BY c").all();
		expect(results.length).toBe(3);
		expect(new Set(results.map((r) => r.team_key)).size).toBe(1);
		expect(results[0]).toMatchObject({ day: "2027-01-15", size: 3, c: 4, r: 4, i: 4, s: 1, t: 12 });
		expect(JSON.stringify(results)).not.toMatch(/Anna|Product/);
	});

	it("deleteTeam removes members and team with no stats", async () => {
		const t = await make();
		expect(await deleteTeam(env.DB, t.id)).toBe(true);
		expect(await findTeamByToken(env.DB, t.creatorToken, now)).toBeNull();
		expect(await count("members")).toBe(0);
		expect(await count("team_stats")).toBe(0);
	});

	it("anonymiseExpiredTeams keeps revealed, drops unrevealed, leaves fresh", async () => {
		const old = now - SESSION_TTL_MS - 1;
		const done = await make(["B", "C"], old);
		await finish(done, old);
		await markRevealed(env.DB, done.id, old + 10);
		const undone = await make(["B", "C"], old);
		const fresh = await make(["B", "C"], now);
		expect(await anonymiseExpiredTeams(env.DB, now)).toEqual({ kept: 1, dropped: 1 });
		expect(await count("team_stats")).toBe(3);
		expect(await findTeamByToken(env.DB, done.creatorToken, 0)).toBeNull();
		expect(await findTeamByToken(env.DB, undone.creatorToken, 0)).toBeNull();
		expect(await findTeamByToken(env.DB, fresh.creatorToken, now)).not.toBeNull();
	});
});
