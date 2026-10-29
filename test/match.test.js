import { describe, it, expect } from "vitest";
import { validateMatch, validateSetup, validateMatchScores, allAnswered, matchState, aggregate, canRemove, SIDE_MIN, SIDE_MAX } from "../src/match.js";
import { ValidationError } from "../src/session.js";

const body = { myTeam: " Product ", otherTeam: "Sales", creatorName: "Anna", members: ["Bjarni", " ", "Clara"] };

describe("validateMatch", () => {
	it("trims, drops blanks, keeps order", () =>
		expect(validateMatch(body)).toEqual({ myTeam: "Product", otherTeam: "Sales", creatorName: "Anna", members: ["Bjarni", "Clara"] }));
	it.each([
		["one other", { ...body, members: ["Bjarni"] }],
		["eight others", { ...body, members: ["a", "b", "c", "d", "e", "f", "g", "h"] }],
		["duplicate of creator", { ...body, members: ["anna", "Bjarni"] }],
		["duplicate member", { ...body, members: ["Bjarni", "bjarni "] }],
		["missing other team", { ...body, otherTeam: " " }],
		["missing my team", { ...body, myTeam: "" }],
	])("rejects %s", (_, v) => expect(() => validateMatch(v)).toThrow(ValidationError));
	it("bounds are 3 and 8", () => { expect(SIDE_MIN).toBe(3); expect(SIDE_MAX).toBe(8); });
});

describe("validateSetup", () => {
	it("accepts captain plus 2–7 others, checking duplicates only within its own list", () =>
		expect(validateSetup({ captainName: "Anna", members: ["Eva", "Finnur"] })).toEqual({ captainName: "Anna", members: ["Eva", "Finnur"] }));
	it("rejects duplicates within the side", () =>
		expect(() => validateSetup({ captainName: "Eva", members: ["eva", "Finnur"] })).toThrow(ValidationError));
	it("rejects one other", () => expect(() => validateSetup({ captainName: "Eva", members: ["Finnur"] })).toThrow(ValidationError));
});

describe("validateMatchScores", () => {
	it("needs both blocks", () => {
		expect(validateMatchScores({ given: { c: 1, r: 2, i: 3, s: 4 }, predicted: { c: 5, r: 6, i: 7, s: 8 } })).toEqual({ given: { c: 1, r: 2, i: 3, s: 4 }, predicted: { c: 5, r: 6, i: 7, s: 8 } });
		expect(() => validateMatchScores({ given: { c: 1, r: 2, i: 3, s: 4 } })).toThrow(ValidationError);
	});
});

const m = (id, g, p, extra = {}) => ({ id, nickname: id, isCaptain: false, scores: g ? { given: { c: g[0], r: g[1], i: g[2], s: g[3] }, predicted: { c: p[0], r: p[1], i: p[2], s: p[3] } } : null, ...extra });
const A = [m("a1", [8, 7, 5, 8], [6, 6, 6, 6]), m("a2", [9, 9, 9, 1], [2, 2, 2, 2]), m("a3", [4, 6, 6, 2], [4, 4, 4, 4])];
const B = [m("b1", [5, 5, 5, 5], [9, 9, 9, 1]), m("b2", [6, 6, 6, 6], [3, 3, 3, 3]), m("b3", [7, 7, 7, 7], [6, 6, 6, 6])];

describe("allAnswered / matchState", () => {
	it("false while side b is missing", () => expect(allAnswered({ a: A, b: null })).toBe(false));
	it("false while anyone on either side is pending", () => expect(allAnswered({ a: A, b: [...B.slice(0, 2), m("b3")] })).toBe(false));
	it("true when both sides have all scores", () => expect(allAnswered({ a: A, b: B })).toBe(true));
	it("setup for an unclaimed captain", () => expect(matchState({ revealedAt: null }, { unclaimedCaptain: true })).toBe("setup"));
	it("revealed wins", () => expect(matchState({ revealedAt: 1 }, m("x"))).toBe("revealed"));
	it("waiting when answered", () => expect(matchState({ revealedAt: null }, A[0])).toBe("waiting"));
	it("needs_your_score when not", () => expect(matchState({ revealedAt: null }, m("x"))).toBe("needs_your_score"));
});

describe("aggregate", () => {
	it("received is what the raters gave; expected is the receivers' own predictions", () => {
		const out = aggregate(A, B); // A rated B; B is the receiver
		expect(out.received.min).toEqual({ c: 4, r: 6, i: 5, s: 1, t: 2.5 });
		expect(out.received.max).toEqual({ c: 9, r: 9, i: 9, s: 8, t: 27 });
		expect(out.received.avg).toEqual({ c: 7, r: 7.3, i: 6.7, s: 3.7, t: 12.5 });
		// B's predictions: (9,9,9,1) T 27; (3,3,3,3) T 3; (6,6,6,6) T 3 → avg c 6, r 6, i 6, s 3.3, t 11
		expect(out.expected).toEqual({ c: 6, r: 6, i: 6, s: 3.3, t: 11 });
	});
	it("ignores members without scores", () => {
		const out = aggregate([...A, m("a4")], [...B, m("b4")]);
		expect(out.received.avg.c).toBe(7);
		expect(out.expected.c).toBe(6);
	});
});

describe("canRemove", () => {
	const side = [m("a", [5, 5, 5, 5], [5, 5, 5, 5], { isCaptain: true }), m("b"), m("c"), m("d", [1, 1, 1, 1], [1, 1, 1, 1])];
	it("pending non-captain in a side of four is removable", () => expect(canRemove(side, "b")).toEqual({ ok: true }));
	it("answered member is not", () => expect(canRemove(side, "d")).toEqual({ ok: false, reason: "answered" }));
	it("captain is not", () => expect(canRemove(side, "a")).toEqual({ ok: false, reason: "captain" }));
	it("unknown id", () => expect(canRemove(side, "zz")).toEqual({ ok: false, reason: "not_found" }));
	it("refuses to drop below three", () => expect(canRemove(side.slice(0, 3), "b")).toEqual({ ok: false, reason: "too_small" }));
});
