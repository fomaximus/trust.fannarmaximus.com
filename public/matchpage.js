// Match page: one HTML file, driven by GET /api/matches/:token.
(function () {
	var F = window.TrustForm;
	var token = (location.pathname.split("/").filter(Boolean).pop() || "").replace(/[^A-Za-z0-9_-]/g, "");
	var api = "/api/matches/" + token;
	var pollTimer = null;
	var scoreRendered = false, setupRendered = false;
	var lastKey = null;
	var SECTIONS = ["loading", "head", "setup", "links", "score", "waiting", "reveal", "roster-section", "controls", "deleted", "gone"];
	var FACTORS = [["c", "Credibility"], ["r", "Reliability"], ["i", "Intimacy"], ["s", "Self-orientation"], ["t", "T"]];

	function $(id) { return document.getElementById(id); }
	function el(tag, cls, text) { var n = document.createElement(tag); if (cls) n.className = cls; if (text !== undefined) n.textContent = text; return n; }
	function setHidden(id, hidden) { $(id).hidden = hidden; }
	function showOnly(id) { SECTIONS.forEach(function (s) { setHidden(s, s !== id); }); }
	function fmt(n) { return Number.isInteger(n) ? String(n) : n.toFixed(1); }
	function localUrl(url) { return location.origin + url.slice(url.indexOf("/m/")); }

	function twoTap(btn, label, action) {
		var armed = null;
		btn.textContent = label;
		btn.disabled = false;
		btn.onclick = async function () {
			if (!armed) { btn.textContent = "Tap again to confirm"; armed = setTimeout(function () { armed = null; btn.textContent = label; }, 5000); return; }
			clearTimeout(armed); armed = null;
			btn.disabled = true;
			var ok = false;
			try { ok = await action(); } catch (e) {}
			if (!ok) { btn.disabled = false; btn.textContent = "Couldn't do that. Try again."; setTimeout(function () { btn.textContent = label; }, 3000); }
		};
	}

	function showRetry() {
		var box = $("loading");
		box.innerHTML = "";
		var btn = el("button", "button", "Couldn't load. Tap to retry.");
		btn.type = "button";
		btn.addEventListener("click", function () { box.textContent = "…"; load(); });
		box.appendChild(btn);
		showOnly("loading");
	}

	async function load() {
		var res;
		try { res = await fetch(api, { cache: "no-store" }); } catch (e) { showRetry(); return false; }
		if (res.status === 404) { clearInterval(pollTimer); showOnly("gone"); return true; }
		if (!res.ok) { showRetry(); return false; }
		render(await res.json());
		return true;
	}

	function render(d) {
		["loading", "gone", "deleted"].forEach(function (s) { setHidden(s, true); });
		var you = d.teams.you.name, other = d.teams.other.name;
		$("title").textContent = you + " & " + other;
		document.title = you + " & " + other + " — Trust";
		setHidden("head", false);
		var isCaptain = d.role === "captain";

		if (d.state === "setup") {
			$("headline").textContent = other + " has set up a match with " + you + " on the Trust Equation. Name your team to get everyone's links.";
			renderSetup(d);
			setHidden("setup", false);
			["links", "score", "waiting", "reveal", "roster-section", "controls"].forEach(function (s) { setHidden(s, true); });
			return;
		}
		setHidden("setup", true);

		if (d.state === "revealed") {
			clearInterval(pollTimer); pollTimer = null;
			$("headline").textContent = "Everyone has answered.";
			setHidden("links", true); setHidden("score", true); setHidden("waiting", true);
			renderReveal(d);
			setHidden("reveal", false);
		} else {
			var otherReady = !!d.teams.other.members;
			$("headline").textContent = isCaptain
				? (otherReady ? "Send the links, then rate " + other + " yourself." : "Send your team their links, and the captain link to whoever leads " + other + ".")
				: you + " and " + other + " are scoring each other on the Trust Equation. Rate " + other + "; nothing is shown until everyone has.";
			setHidden("reveal", true);
			if (isCaptain && d.links) { renderLinks(d, other); setHidden("links", false); } else setHidden("links", true);
			if (d.state === "needs_your_score") { renderScore(d); setHidden("score", false); setHidden("waiting", true); }
			else {
				setHidden("score", true);
				var pending = [].concat(d.teams.you.members, d.teams.other.members || []).filter(function (m) { return !m.answered; }).length;
				$("waiting-line").textContent = otherReady ? "Answered. Waiting for " + pending + " more." : "Answered. Waiting for " + other + " to be set up.";
				setHidden("waiting", false);
			}
			if (!pollTimer) pollTimer = setInterval(load, 10000);
		}
		var key = JSON.stringify([d.state, d.you && d.you.answered, d.teams.you.members, d.teams.other.members]);
		if (key !== lastKey) { lastKey = key; renderRosters(d, isCaptain); renderControls(d, isCaptain); }
		setHidden("roster-section", false);
		setHidden("controls", false);
	}

	function renderSetup(d) {
		if (setupRendered) return;
		setupRendered = true;
		var rows = window.TrustMembers.attach($("setup-members"), $("setup-add"));
		var error = $("setup-error"), submit = $("setup-submit");
		$("setup-form").addEventListener("submit", async function (e) {
			e.preventDefault();
			error.hidden = true;
			var captainName = $("captain-name").value.trim();
			var members = rows.names();
			var problem = window.TrustMembers.check(captainName, members);
			if (problem) { error.textContent = problem; error.hidden = false; return; }
			submit.disabled = true;
			try {
				var res = await fetch(api + "/setup", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ captainName: captainName, members: members }) });
				if (res.ok) {
					// Your own link is a fresh one; the link you were sent is now retired.
					var out = await res.json().catch(function () { return {}; });
					if (out.yourLink) { location.replace(localUrl(out.yourLink)); return; }
				}
				if (res.status === 409) { window.scrollTo(0, 0); if (!(await load())) location.reload(); return; }
				var body = await res.json().catch(function () { return {}; });
				error.textContent = body.message || "Something went wrong."; error.hidden = false;
			} catch (err) { error.textContent = "Something went wrong."; error.hidden = false; }
			submit.disabled = false;
		});
	}

	function linkRow(nickname, url, mark) {
		var li = el("li");
		var who = el("div", "who", nickname);
		if (mark) who.appendChild(el("small", null, mark));
		li.appendChild(who);
		var share = el("div", "share");
		var input = document.createElement("input");
		input.type = "text"; input.readOnly = true; input.value = url;
		var copy = el("button", "button", "Copy");
		copy.type = "button";
		copy.addEventListener("click", async function () {
			try { await navigator.clipboard.writeText(url); copy.textContent = "Copied"; }
			catch (e) { input.select(); copy.textContent = "Select and copy"; }
			setTimeout(function () { copy.textContent = "Copy"; }, 2000);
		});
		share.appendChild(input); share.appendChild(copy);
		li.appendChild(share);
		return li;
	}

	function renderLinks(d, other) {
		var list = $("links-list");
		list.innerHTML = "";
		d.links.forEach(function (l) { list.appendChild(linkRow(l.nickname, localUrl(l.url), l.id === d.you.id ? "you" : null)); });
		if (d.captainLink) {
			var li = linkRow("Captain link for " + other, localUrl(d.captainLink), "send to whoever leads them");
			li.className = "captain-link";
			list.appendChild(li);
		}
	}

	function renderScore(d) {
		if (scoreRendered) return;
		scoreRendered = true;
		var other = d.teams.other.name, you = d.teams.you.name;
		var given = $("given"), predicted = $("predicted"), error = $("error"), submit = $("submit");
		F.renderScoreBlock(given, { prefix: "given", heading: "How you rate " + other, labels: { s: "1 = all about the work and the people they serve, 10 = all about themselves" } });
		F.renderScoreBlock(predicted, { prefix: "predicted", heading: "How you think " + other + " will rate " + you, labels: { s: "1 = they'd say we're all about the work, 10 = they'd say we're all about ourselves" } });
		$("score-form").addEventListener("submit", async function (e) {
			e.preventDefault();
			error.hidden = true;
			var g = F.readScoreBlock(given, "given"), p = F.readScoreBlock(predicted, "predicted");
			if (!g || !p) {
				error.textContent = "A few rows are still unanswered."; error.hidden = false;
				var first = document.querySelector("fieldset.unanswered");
				if (first) first.scrollIntoView({ behavior: "smooth", block: "center" });
				return;
			}
			submit.disabled = true;
			try {
				var res = await fetch(api + "/score", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ given: g, predicted: p }) });
				if (res.status === 200 || res.status === 409) { window.scrollTo(0, 0); if (!(await load())) location.reload(); return; }
				if (res.status === 404) { showOnly("gone"); return; }
				var body = await res.json().catch(function () { return {}; });
				error.textContent = body.message || "Something went wrong."; error.hidden = false;
			} catch (err) { error.textContent = "Something went wrong."; error.hidden = false; }
			submit.disabled = false;
		});
	}

	function renderRoster(listId, team, d, canRemove) {
		var list = $(listId);
		list.innerHTML = "";
		if (!team.members) { list.appendChild(el("li", "pending-side", "Not set up yet")); return; }
		var tooSmall = team.members.length <= 3;
		team.members.forEach(function (m) {
			var li = el("li", m.answered ? "done" : "");
			var who = el("span", "who", m.nickname || "—");
			if (d.you && m.id === d.you.id) who.appendChild(el("small", null, "you"));
			li.appendChild(who);
			if (canRemove && !m.answered && !m.isCaptain) {
				var rm = el("button", "remove-member", "Remove");
				rm.type = "button";
				if (tooSmall) { rm.disabled = true; rm.title = "A team needs at least three people"; }
				else twoTap(rm, "Remove", async function () {
					var res = await fetch(api + "/remove", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ memberId: m.id }) });
					if (res.ok || res.status === 409) { lastKey = null; await load(); return true; }
					return false;
				});
				li.appendChild(rm);
			}
			li.appendChild(el("span", "mark"));
			list.appendChild(li);
		});
	}

	function renderRosters(d, isCaptain) {
		$("roster-you-title").textContent = d.teams.you.name;
		$("roster-other-title").textContent = d.teams.other.name;
		renderRoster("roster-you", d.teams.you, d, isCaptain && d.state !== "revealed");
		renderRoster("roster-other", d.teams.other, d, false);
		$("roster-caption").textContent = d.state === "revealed" ? "Who answered" : "Who has answered";
	}

	function fillTable(bodyId, agg) {
		var body = $(bodyId);
		body.innerHTML = "";
		FACTORS.forEach(function (f) {
			var k = f[0];
			var tr = el("tr", k === "t" ? "total" : "");
			tr.appendChild(el("td", null, f[1]));
			tr.appendChild(el("td", null, fmt(agg.received.min[k])));
			tr.appendChild(el("td", "avg", fmt(agg.received.avg[k])));
			tr.appendChild(el("td", null, fmt(agg.received.max[k])));
			tr.appendChild(el("td", "exp", fmt(agg.expected[k])));
			body.appendChild(tr);
		});
	}

	function renderReveal(d) {
		var you = d.teams.you.name, other = d.teams.other.name;
		$("reveal-you-title").textContent = "What " + other + " gave " + you;
		$("reveal-other-title").textContent = "What " + you + " gave " + other;
		fillTable("reveal-you", d.reveal.you);
		fillTable("reveal-other", d.reveal.other);
	}

	function renderControls(d, isCaptain) {
		var del = $("delete"), leave = $("leave"), forget = $("forget"), note = $("controls-note");
		del.hidden = leave.hidden = forget.hidden = note.hidden = true;
		if (isCaptain) {
			del.hidden = false;
			twoTap(del, "Delete names and links", async function () {
				var res = await fetch(api, { method: "DELETE" });
				if (!res.ok && res.status !== 404) return false;
				finish("Deleted.", d.state === "revealed" ? "The names and links are gone. The numbers stay, without names, in the statistics." : "The match and its links are gone.");
				return true;
			});
			if (d.state === "revealed") { note.textContent = "The numbers stay, without names, in the statistics."; note.hidden = false; }
			return;
		}
		if (d.state === "revealed") {
			forget.hidden = false;
			twoTap(forget, "Remove my name", async function () {
				var res = await fetch(api, { method: "DELETE" });
				if (!res.ok && res.status !== 404) return false;
				finish("Your name is gone.", "Your link is dead. Your numbers stay in your team's averages, without your name.");
				return true;
			});
			return;
		}
		if (d.you && !d.you.answered) {
			if (d.teams.you.members.length <= 3) { note.textContent = "Ask your team's captain to delete the match if you don't want to take part."; note.hidden = false; return; }
			leave.hidden = false;
			twoTap(leave, "Leave", async function () {
				var res = await fetch(api, { method: "DELETE" });
				if (res.status === 409) { lastKey = null; await load(); return true; }
				if (!res.ok && res.status !== 404) return false;
				finish("You've left.", "Your link is dead and nothing of yours was kept.");
				return true;
			});
		}
	}

	function finish(title, line) {
		clearInterval(pollTimer); pollTimer = null;
		$("deleted-title").textContent = title;
		$("deleted-line").textContent = line;
		window.scrollTo(0, 0);
		showOnly("deleted");
	}

	load();
})();
