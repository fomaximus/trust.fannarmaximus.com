// Create flow: validate, POST /api/sessions, go to the creator's own session page.
(function () {
	var F = window.TrustForm;
	var given = document.getElementById("given");
	var predicted = document.getElementById("predicted");
	var creatorName = document.getElementById("creator-name");
	var inviteeName = document.getElementById("invitee-name");
	var error = document.getElementById("error");
	var submit = document.getElementById("submit");

	F.renderScoreBlock(given, { prefix: "given", labels: { s: "1 = all about you, 10 = all about them" } });
	F.renderScoreBlock(predicted, { prefix: "predicted", labels: { s: "1 = all about them, 10 = all about you" } });

	function them() { return inviteeName.value.trim() || "them"; }
	function headings() {
		F.setHeading(given, "How you rate " + them());
		F.setHeading(predicted, "How you think " + (inviteeName.value.trim() || "they") + " will rate you");
	}
	inviteeName.addEventListener("input", headings);
	headings();

	function showError(msg) { error.textContent = msg; error.hidden = false; }

	document.getElementById("new-form").addEventListener("submit", async function (e) {
		e.preventDefault();
		error.hidden = true;
		var cn = creatorName.value.trim();
		var inn = inviteeName.value.trim();
		var g = F.readScoreBlock(given, "given");
		var p = F.readScoreBlock(predicted, "predicted");
		if (!cn || !inn) { showError("Both names are needed."); (cn ? inviteeName : creatorName).focus(); return; }
		if (!g || !p) {
			showError("A few rows are still unanswered.");
			var first = document.querySelector("fieldset.unanswered");
			if (first) first.scrollIntoView({ behavior: "smooth", block: "center" });
			return;
		}
		submit.disabled = true;
		try {
			var res = await fetch("/api/sessions", {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ creatorName: cn, inviteeName: inn, given: g, predicted: p }),
			});
			var body = await res.json().catch(function () { return {}; });
			if (res.status === 201) { location.href = "/s/" + body.creatorToken; return; }
			if (res.status === 429) showError("Too many sessions from this connection. Try again in an hour.");
			else showError(body.message || "Something went wrong.");
		} catch (err) {
			showError("Something went wrong.");
		}
		submit.disabled = false;
	});
})();
