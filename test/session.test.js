import { describe, it, expect } from "vitest";
import { validateName, validateScores, computeT, visibleState, ValidationError } from "../src/session.js";

describe("validateName", () => {
	it("trims and accepts 1–40 chars", () => expect(validateName("  Anna ")).toBe("Anna"));
	it.each(["", "   ", "x".repeat(41), 42, null])("rejects %p", (v) =>
		expect(() => validateName(v)).toThrow(ValidationError));
});

describe("validateScores", () => {
	const ok = { given: { c: 8, r: 7, i: 5, s: 8 }, predicted: { c: 1, r: 10, i: 10, s: 1 } };
	it("accepts integers 1–10", () => expect(validateScores(ok)).toEqual(ok));
	it.each([
		["string digit", { ...ok, given: { ...ok.given, c: "7" } }],
		["float", { ...ok, given: { ...ok.given, c: 7.5 } }],
		["zero", { ...ok, given: { ...ok.given, s: 0 } }],
		["eleven", { ...ok, predicted: { ...ok.predicted, r: 11 } }],
		["missing key", { given: { c: 1, r: 1, i: 1 }, predicted: ok.predicted }],
		["missing block", { given: ok.given }],
		["not an object", "nope"],
	])("rejects %s", (_, v) => expect(() => validateScores(v)).toThrow(ValidationError));
	it("drops extra keys", () =>
		expect(validateScores({ ...ok, extra: 1, given: { ...ok.given, x: 9 } })).toEqual(ok));
});

describe("computeT", () => {
	it("matches the Imperial worked example", () => expect(computeT({ c: 8, r: 7, i: 5, s: 8 })).toBe(2.5));
	it("minimum is 0.3", () => expect(computeT({ c: 1, r: 1, i: 1, s: 10 })).toBe(0.3));
	it("maximum is 30", () => expect(computeT({ c: 10, r: 10, i: 10, s: 1 })).toBe(30));
});

describe("visibleState", () => {
	const open = { inviteeScores: null };
	const done = { inviteeScores: { given: {}, predicted: {} } };
	it("creator waits until invitee submits", () => expect(visibleState(open, "creator")).toBe("waiting"));
	it("invitee is asked to score", () => expect(visibleState(open, "invitee")).toBe("needs_your_score"));
	it("both see revealed after submit", () => {
		expect(visibleState(done, "creator")).toBe("revealed");
		expect(visibleState(done, "invitee")).toBe("revealed");
	});
});
