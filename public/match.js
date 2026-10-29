// Create flow: POST /api/matches, then go to the creator's captain page.
(function () {
	var rows = window.TrustMembers.attach(document.getElementById("members"), document.getElementById("add-row"));
	var error = document.getElementById("error");
	var submit = document.getElementById("submit");
	function showError(msg) { error.textContent = msg; error.hidden = false; }
	document.getElementById("match-form").addEventListener("submit", async function (e) {
		e.preventDefault();
		error.hidden = true;
		var myTeam = document.getElementById("my-team").value.trim();
		var otherTeam = document.getElementById("other-team").value.trim();
		var creatorName = document.getElementById("creator-name").value.trim();
		var members = rows.names();
		if (!myTeam || !otherTeam) { showError("Both teams need a name."); return; }
		var problem = window.TrustMembers.check(creatorName, members);
		if (problem) { showError(problem); return; }
		submit.disabled = true;
		try {
			var res = await fetch("/api/matches", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ myTeam: myTeam, otherTeam: otherTeam, creatorName: creatorName, members: members }) });
			var body = await res.json().catch(function () { return {}; });
			if (res.status === 201) { location.href = "/m/" + body.creatorToken; return; }
			if (res.status === 429) showError("Too many from this connection. Try again in an hour.");
			else showError(body.message || "Something went wrong.");
		} catch (err) { showError("Something went wrong."); }
		submit.disabled = false;
	});
	window.addEventListener("pageshow", function () { submit.disabled = false; });
})();
