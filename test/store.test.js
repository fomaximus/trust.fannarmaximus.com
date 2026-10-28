import { env } from "cloudflare:workers";
import { describe, it, expect } from "vitest";
import { createSession, findByToken, submitInviteeScores, countRecentCreations, deleteExpired, randomToken } from "../src/store.js";
import { SESSION_TTL_MS } from "../src/session.js";

const scores = { given: { c: 8, r: 7, i: 5, s: 8 }, predicted: { c: 6, r: 6, i: 6, s: 6 } };
const now = 1_800_000_000_000;
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
	it("deletes expired rows", async () => {
		const s = await make("ip-z", now - SESSION_TTL_MS - 1);
		expect(await deleteExpired(env.DB, now)).toBeGreaterThanOrEqual(1);
		expect(await findByToken(env.DB, s.creatorToken, 0)).toBeNull();
	});
});
