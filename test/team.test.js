import { describe, it, expect } from "vitest";
import { validateTeam, validateTeamScores, allAnswered, teamState, aggregate, canRemove, TEAM_MIN, TEAM_MAX } from "../src/team.js";
import { ValidationError } from "../src/session.js";

const body = { teamName: " Product ", creatorName: "Anna", members: ["Bjarni", " ", "Clara"] };

describe("validateTeam", () => {
	it("trims, drops blanks, keeps order", () =>
		expect(validateTeam(body)).toEqual({ teamName: "Product", creatorName: "Anna", members: ["Bjarni", "Clara"] }));
	it.each([
		["one other", { ...body, members: ["Bjarni"] }],
		["eight others", { ...body, members: ["a", "b", "c", "d", "e", "f", "g", "h"] }],
		["duplicate of creator", { ...body, members: ["anna", "Bjarni"] }],
		["duplicate member", { ...body, members: ["Bjarni", "bjarni "] }],
		["members not an array", { ...body, members: "Bjarni" }],
		["missing team name", { ...body, teamName: "" }],
	])("rejects %s", (_, v) => expect(() => validateTeam(v)).toThrow(ValidationError));
	it("bounds are 3 and 8", () => {
		expect(TEAM_MIN).toBe(3);
		expect(TEAM_MAX).toBe(8);
	});
});

describe("validateTeamScores", () => {
	it("accepts given only and drops predicted", () =>
		expect(validateTeamScores({ given: { c: 1, r: 2, i: 3, s: 4 }, predicted: { c: 1, r: 1, i: 1, s: 1 } })).toEqual({ given: { c: 1, r: 2, i: 3, s: 4 } }));
	it("rejects out of range", () => expect(() => validateTeamScores({ given: { c: 0, r: 2, i: 3, s: 4 } })).toThrow(ValidationError));
});

const m = (id, c, r, i, s, extra = {}) => ({ id, nickname: id, isCreator: false, scores: c == null ? null : { given: { c, r, i, s } }, ...extra });

describe("allAnswered / teamState", () => {
	it("false while anyone is pending", () => expect(allAnswered([m("a", 5, 5, 5, 5), m("b")])).toBe(false));
	it("true when all have scores", () => expect(allAnswered([m("a", 5, 5, 5, 5), m("b", 6, 6, 6, 6)])).toBe(true));
	it("revealed wins", () => expect(teamState({ revealedAt: 1 }, m("a"))).toBe("revealed"));
	it("answered but not revealed is waiting", () => expect(teamState({ revealedAt: null }, m("a", 5, 5, 5, 5))).toBe("waiting"));
	it("unanswered is needs_your_score", () => expect(teamState({ revealedAt: null }, m("a"))).toBe("needs_your_score"));
});

describe("aggregate", () => {
	it("min, avg, max per factor and over individual T", () => {
		const out = aggregate([m("a", 8, 7, 5, 8), m("b", 9, 9, 9, 1), m("c"), m("d", 4, 6, 6, 2)]);
		expect(out.size).toBe(3);
		expect(out.min).toEqual({ c: 4, r: 6, i: 5, s: 1, t: 2.5 });
		expect(out.max).toEqual({ c: 9, r: 9, i: 9, s: 8, t: 27 });
		expect(out.avg).toEqual({ c: 7, r: 7.3, i: 6.7, s: 3.7, t: 12.5 });
	});
});

describe("canRemove", () => {
	const team = [m("a", 5, 5, 5, 5, { isCreator: true }), m("b"), m("c"), m("d", 1, 1, 1, 1)];
	it("pending non-creator in a team of four is removable", () => expect(canRemove(team, "b")).toEqual({ ok: true }));
	it("answered member is not", () => expect(canRemove(team, "d")).toEqual({ ok: false, reason: "answered" }));
	it("creator is not", () => expect(canRemove(team, "a")).toEqual({ ok: false, reason: "creator" }));
	it("unknown id", () => expect(canRemove(team, "zz")).toEqual({ ok: false, reason: "not_found" }));
	it("refuses to drop below three", () => expect(canRemove(team.slice(0, 3), "b")).toEqual({ ok: false, reason: "too_small" }));
});
