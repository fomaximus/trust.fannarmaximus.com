// Session page: one HTML file, four states, driven by GET /api/sessions/:token.
(function () {
	var F = window.TrustForm;
	// Tolerate a trailing slash or punctuation a chat app may have glued on.
	var token = (location.pathname.split("/").filter(Boolean).pop() || "").replace(/[^A-Za-z0-9_-]/g, "");
	var api = "/api/sessions/" + token;
	var sections = ["loading", "waiting", "score", "reveal", "gone", "deleted"];
	var pollTimer = null;
	var FACTORS = [["c", "Credibility"], ["r", "Reliability"], ["i", "Intimacy"], ["s", "Self-orientation"]];

	function show(id) {
		sections.forEach(function (s) { document.getElementById(s).hidden = s !== id; });
	}
	function setNames(creator, invitee) {
		document.querySelectorAll(".n.creator").forEach(function (n) { n.textContent = creator; });
		document.querySelectorAll(".n.invitee").forEach(function (n) { n.textContent = invitee; });
		document.title = creator + " & " + invitee + " — Trust";
	}
	function el(tag, cls, text) {
		var n = document.createElement(tag);
		if (cls) n.className = cls;
		if (text !== undefined) n.textContent = text;
		return n;
	}

	function showRetry() {
		var box = document.getElementById("loading");
		box.innerHTML = "";
		var btn = el("button", "button", "Couldn't load. Tap to retry.");
		btn.type = "button";
		btn.addEventListener("click", function () { box.textContent = "…"; load(); });
		box.appendChild(btn);
		show("loading");
	}

	// Resolves true when a state was rendered, false otherwise.
	async function load() {
		var res;
		try { res = await fetch(api, { cache: "no-store" }); } catch (e) { showRetry(); return false; }
		if (res.status === 404) { clearInterval(pollTimer); show("gone"); return true; }
		if (!res.ok) { showRetry(); return false; }
		render(await res.json());
		return true;
	}

	function render(d) {
		setNames(d.creatorName, d.inviteeName);
		if (d.state === "revealed") { clearInterval(pollTimer); renderReveal(d); show("reveal"); return; }
		if (d.state === "waiting") { renderWaiting(d); show("waiting"); if (!pollTimer) pollTimer = setInterval(load, 10000); return; }
		if (d.state === "needs_your_score") { renderScore(d); show("score"); }
	}

	function renderWaiting(d) {
		var url = location.origin + "/s/" + d.inviteeToken;
		var input = document.getElementById("share-url");
		input.value = url;
		var copy = document.getElementById("copy");
		copy.onclick = async function () {
			try { await navigator.clipboard.writeText(url); copy.textContent = "Copied"; }
			catch (e) { input.select(); copy.textContent = "Select and copy"; }
			setTimeout(function () { copy.textContent = "Copy"; }, 2000);
		};
	}

	var scoreRendered = false;
	function renderScore(d) {
		if (scoreRendered) return;
		scoreRendered = true;
		var given = document.getElementById("given");
		var predicted = document.getElementById("predicted");
		var myName = document.getElementById("my-name");
		var error = document.getElementById("error");
		var submit = document.getElementById("submit");
		myName.value = d.inviteeName;
		F.renderScoreBlock(given, { prefix: "given", heading: "How you rate " + d.creatorName, labels: { s: "1 = all about you, 10 = all about them" } });
		F.renderScoreBlock(predicted, { prefix: "predicted", heading: "How you think " + d.creatorName + " rated you", labels: { s: "1 = all about them, 10 = all about you" } });

		function showError(msg) { error.textContent = msg; error.hidden = false; }

		document.getElementById("score-form").addEventListener("submit", async function (e) {
			e.preventDefault();
			error.hidden = true;
			var name = myName.value.trim();
			var g = F.readScoreBlock(given, "given");
			var p = F.readScoreBlock(predicted, "predicted");
			if (!name) { showError("Your name is needed."); myName.focus(); return; }
			if (!g || !p) {
				showError("A few rows are still unanswered.");
				var first = document.querySelector("fieldset.unanswered");
				if (first) first.scrollIntoView({ behavior: "smooth", block: "center" });
				return;
			}
			submit.disabled = true;
			try {
				var res = await fetch(api + "/score", {
					method: "POST",
					headers: { "content-type": "application/json" },
					body: JSON.stringify({ name: name, given: g, predicted: p }),
				});
				if (res.status === 200 || res.status === 409) {
					// Scores are saved either way; if the follow-up read fails, a reload shows the reveal.
					window.scrollTo(0, 0);
					if (!(await load())) location.reload();
					return;
				}
				if (res.status === 404) { show("gone"); return; }
				var body = await res.json().catch(function () { return {}; });
				showError(body.message || "Something went wrong.");
			} catch (err) {
				showError("Something went wrong.");
			}
			submit.disabled = false;
		});
	}

	// One column: what `from` gave `to`, with `to`'s prediction beside each number.
	function column(container, fromName, toName, gave, predictedByTo) {
		container.innerHTML = "";
		container.appendChild(el("h3", null, "What " + fromName + " gave " + toName));
		var table = el("table");
		FACTORS.forEach(function (f) {
			var tr = el("tr");
			tr.appendChild(el("td", "k", f[1]));
			tr.appendChild(el("td", "v", String(gave.given[f[0]])));
			tr.appendChild(el("td", "p", toName + " thought " + predictedByTo.predicted[f[0]]));
			table.appendChild(tr);
		});
		container.appendChild(table);
		var total = el("div", "total");
		total.appendChild(el("div", "t", formatT(gave.givenT)));
		total.appendChild(el("div", "pt", toName + " predicted " + formatT(predictedByTo.predictedT)));
		container.appendChild(total);
	}
	function formatT(n) { return Number.isInteger(n) ? String(n) : n.toFixed(1); }

	function renderReveal(d) {
		var r = d.reveal;
		column(document.getElementById("col-creator"), d.creatorName, d.inviteeName, r.creator, r.invitee);
		column(document.getElementById("col-invitee"), d.inviteeName, d.creatorName, r.invitee, r.creator);
	}

	// Delete: first tap asks, second tap within 5 s does it. No modal dialogs.
	document.querySelectorAll("button.delete").forEach(function (btn) {
		var armed = null;
		btn.addEventListener("click", async function () {
			if (!armed) {
				btn.textContent = "Tap again to delete";
				armed = setTimeout(function () { armed = null; btn.textContent = "Delete names and links"; }, 5000);
				return;
			}
			clearTimeout(armed);
			btn.disabled = true;
			try {
				var res = await fetch(api, { method: "DELETE" });
				if (res.ok || res.status === 404) { clearInterval(pollTimer); window.scrollTo(0, 0); show("deleted"); return; }
			} catch (e) {}
			btn.disabled = false;
			btn.textContent = "Couldn't delete. Try again.";
			armed = null;
		});
	});

	load();
})();
