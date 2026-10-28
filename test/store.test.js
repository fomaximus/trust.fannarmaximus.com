import { env } from "cloudflare:workers";
import { describe, it, expect, beforeEach } from "vitest";
import { createSession, findByToken, submitInviteeScores, countRecentCreations, randomToken } from "../src/store.js";
import { SESSION_TTL_MS } from "../src/session.js";

const scores = { given: { c: 8, r: 7, i: 5, s: 8 }, predicted: { c: 6, r: 6, i: 6, s: 6 } };
const now = Date.UTC(2027, 0, 15, 12);
const make = (ip = "hash-a", at = now) =>
	createSession(env.DB, { creatorName: "Anna", inviteeName: "Bjarni", creatorScores: scores, creatorIpHash: ip, now: at });

describe("store", () => {
	it("randomToken is 22 base64url chars and unique", () => {
		const a = randomToken(), b = randomToken();
		expect(a).toMatch(/^[A-Za-z0-9_-]{22}$/);
		expect(a).not.toBe(b);
	});
	it("creates a session findable by either token with the right role", async () => {
		const s = await make();
		const asCreator = await findByToken(env.DB, s.creatorToken, now);
		const asInvitee = await findByToken(env.DB, s.inviteeToken, now);
		expect(asCreator.role).toBe("creator");
		expect(asInvitee.role).toBe("invitee");
		expect(asCreator.creatorScores).toEqual(scores);
		expect(asCreator.inviteeScores).toBeNull();
		expect(asCreator.expiresAt).toBe(now + SESSION_TTL_MS);
	});
	it("unknown token is null", async () => expect(await findByToken(env.DB, "nope", now)).toBeNull());
	it("expired token is null", async () => {
		const s = await make("h", now);
		expect(await findByToken(env.DB, s.creatorToken, now + SESSION_TTL_MS)).toBeNull();
	});
	it("invitee can submit exactly once", async () => {
		const s = await make();
		expect(await submitInviteeScores(env.DB, s.inviteeToken, scores, now + 1)).toBe(true);
		expect(await submitInviteeScores(env.DB, s.inviteeToken, scores, now + 2)).toBe(false);
		expect((await findByToken(env.DB, s.creatorToken, now)).inviteeScores).toEqual(scores);
	});
	it("invitee may pass a corrected name with the submit", async () => {
		const s = await make();
		await submitInviteeScores(env.DB, s.inviteeToken, scores, now, "Bjarki");
		expect((await findByToken(env.DB, s.creatorToken, now)).inviteeName).toBe("Bjarki");
	});
	it("expired invitee token cannot submit", async () => {
		const s = await make("h", now - SESSION_TTL_MS - 1);
		expect(await submitInviteeScores(env.DB, s.inviteeToken, scores, now)).toBe(false);
	});
	it("creator token cannot be used to submit", async () => {
		const s = await make();
		expect(await submitInviteeScores(env.DB, s.creatorToken, scores, now)).toBe(false);
	});
	it("counts recent creations per ip hash", async () => {
		await make("ip-x", now);
		await make("ip-x", now - 1000);
		await make("ip-x", now - 7_200_000);
		expect(await countRecentCreations(env.DB, "ip-x", now - 3_600_000)).toBe(2);
	});
});

import { anonymiseSession, deleteSession, anonymiseExpired, clearOldIpHashes } from "../src/store.js";

const mine = { given: { c: 9, r: 9, i: 9, s: 1 }, predicted: { c: 5, r: 5, i: 5, s: 5 } };
const statsCount = async () => (await env.DB.prepare("SELECT COUNT(*) AS n FROM stats").first()).n;

describe("anonymisation", () => {
	// D1 rows persist across tests in this file, so start each case from empty tables.
	beforeEach(async () => {
		await env.DB.batch([env.DB.prepare("DELETE FROM sessions"), env.DB.prepare("DELETE FROM stats")]);
	});
	it("moves a completed session into stats without names or tokens", async () => {
		const s = await make();
		await submitInviteeScores(env.DB, s.inviteeToken, mine, now + 1);
		expect(await anonymiseSession(env.DB, s.id, now)).toBe(true);
		expect(await findByToken(env.DB, s.creatorToken, now)).toBeNull();
		expect(await findByToken(env.DB, s.inviteeToken, now)).toBeNull();
		const row = await env.DB.prepare("SELECT * FROM stats").first();
		expect(row).toMatchObject({ day: "2027-01-15", a_c: 8, a_s: 8, a_pc: 6, b_c: 9, b_s: 1, b_ps: 5, a_t: 2.5, a_pt: 3, b_t: 27, b_pt: 3 });
		expect(JSON.stringify(row)).not.toMatch(/Anna|Bjarni|token/);
	});
	it("refuses to anonymise an incomplete session", async () => {
		const s = await make();
		expect(await anonymiseSession(env.DB, s.id, now)).toBe(false);
		expect(await findByToken(env.DB, s.creatorToken, now)).not.toBeNull();
	});
	it("deleteSession removes an incomplete session with no stats row", async () => {
		const s = await make();
		expect(await deleteSession(env.DB, s.id)).toBe(true);
		expect(await findByToken(env.DB, s.creatorToken, now)).toBeNull();
		expect(await statsCount()).toBe(0);
	});
	it("anonymiseExpired keeps completed scores, drops incomplete ones, leaves fresh ones", async () => {
		const old = now - SESSION_TTL_MS - 1;
		const done = await make("h", old);
		await submitInviteeScores(env.DB, done.inviteeToken, mine, old + 1);
		const undone = await make("h", old);
		const fresh = await make("h", now);
		expect(await anonymiseExpired(env.DB, now)).toEqual({ kept: 1, dropped: 1 });
		expect(await statsCount()).toBe(1);
		expect(await findByToken(env.DB, done.creatorToken, 0)).toBeNull();
		expect(await findByToken(env.DB, undone.creatorToken, 0)).toBeNull();
		expect(await findByToken(env.DB, fresh.creatorToken, now)).not.toBeNull();
	});
	it("clearOldIpHashes blanks hashes older than the cutoff only", async () => {
		await make("old-ip", now - 25 * 3_600_000);
		await make("new-ip", now - 1000);
		expect(await clearOldIpHashes(env.DB, now - 24 * 3_600_000)).toBe(1);
		expect(await countRecentCreations(env.DB, "old-ip", 0)).toBe(0);
		expect(await countRecentCreations(env.DB, "new-ip", 0)).toBe(1);
	});
});
