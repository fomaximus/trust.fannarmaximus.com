import { exports } from "cloudflare:workers";
import "../src/worker.js";
import { it, expect } from "vitest";

it("unknown api path is a JSON 404", async () => {
	const res = await exports.default.fetch("https://trust.test/api/nope");
	expect(res.status).toBe(404);
	expect(await res.json()).toEqual({ error: "not_found" });
});
