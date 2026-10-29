// Team page: one HTML file, driven by GET /api/teams/:token. Roster is always shown once loaded.
(function () {
	var F = window.TrustForm;
	var token = (location.pathname.split("/").filter(Boolean).pop() || "").replace(/[^A-Za-z0-9_-]/g, "");
	var api = "/api/teams/" + token;
	var pollTimer = null;
	var scoreRendered = false;
	var FACTORS = [["c", "Credibility"], ["r", "Reliability"], ["i", "Intimacy"], ["s", "Self-orientation"], ["t", "T"]];

	function $(id) { return document.getElementById(id); }
	function el(tag, cls, text) {
		var n = document.createElement(tag);
		if (cls) n.className = cls;
		if (text !== undefined) n.textContent = text;
		return n;
	}
	function setHidden(id, hidden) { $(id).hidden = hidden; }
	function showOnly(id) {
		["loading", "head", "links", "score", "waiting", "reveal", "roster-section", "controls", "deleted", "gone"].forEach(function (s) { setHidden(s, s !== id); });
	}
	function fmt(n) { return Number.isInteger(n) ? String(n) : n.toFixed(1); }

	// Two-tap confirm shared by every destructive control. No modal dialogs.
	function twoTap(btn, label, action) {
		var armed = null;
		btn.textContent = label;
		btn.onclick = async function () {
			if (!armed) {
				btn.textContent = "Tap again to confirm";
				armed = setTimeout(function () { armed = null; btn.textContent = label; }, 5000);
				return;
			}
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
		setHidden("loading", true);
		setHidden("gone", true);
		setHidden("deleted", true);
		document.querySelectorAll(".n.team").forEach(function (n) { n.textContent = d.teamName; });
		document.title = d.teamName + " — Trust";
		setHidden("head", false);
		var pending = d.members.filter(function (m) { return !m.answered; }).length;
		var isCreator = d.role === "creator";

		if (d.state === "revealed") {
			clearInterval(pollTimer); pollTimer = null;
			$("headline").textContent = "Everyone has answered.";
			setHidden("links", true);
			setHidden("score", true);
			setHidden("waiting", true);
			renderReveal(d);
			setHidden("reveal", false);
		} else {
			$("headline").textContent = isCreator
				? "Your team. Send the links, then rate the team yourself."
				: d.creatorName + " set up this team on the Trust Equation. Rate the team; nothing is shown until everyone has.";
			setHidden("reveal", true);
			if (isCreator && d.links) { renderLinks(d.links, d.you.id); setHidden("links", false); } else setHidden("links", true);
			if (d.state === "needs_your_score") { renderScore(d); setHidden("score", false); setHidden("waiting", true); }
			else {
				setHidden("score", true);
				$("waiting-line").textContent = "Answered. Waiting for " + pending + " more.";
				setHidden("waiting", false);
			}
			if (!pollTimer) pollTimer = setInterval(load, 10000);
		}
		// Rebuild roster and controls only when they would change, so a poll never resets an armed two-tap.
		var key = JSON.stringify([d.state, d.you.answered, d.members.map(function (m) { return [m.id, m.nickname, m.answered]; })]);
		if (key !== lastKey) {
			lastKey = key;
			renderRoster(d, isCreator);
			renderControls(d, isCreator);
		}
		setHidden("roster-section", false);
		setHidden("controls", false);
	}
	var lastKey = null;

	function renderLinks(links, youId) {
		var list = $("links-list");
		list.innerHTML = "";
		links.forEach(function (l) {
			// Rebuild on the page's own origin so dev ports and proxies don't leak into the link.
			l = { id: l.id, nickname: l.nickname, url: location.origin + l.url.slice(l.url.indexOf("/t/")) };
			var li = el("li");
			var who = el("div", "who", l.nickname);
			if (l.id === youId) who.appendChild(el("small", null, "you"));
			li.appendChild(who);
			var share = el("div", "share");
			var input = document.createElement("input");
			input.type = "text"; input.readOnly = true; input.value = l.url;
			var copy = el("button", "button", "Copy");
			copy.type = "button";
			copy.addEventListener("click", async function () {
				try { await navigator.clipboard.writeText(l.url); copy.textContent = "Copied"; }
				catch (e) { input.select(); copy.textContent = "Select and copy"; }
				setTimeout(function () { copy.textContent = "Copy"; }, 2000);
			});
			share.appendChild(input); share.appendChild(copy);
			li.appendChild(share);
			list.appendChild(li);
		});
	}

	function renderScore(d) {
		if (scoreRendered) return;
		scoreRendered = true;
		var given = $("given");
		var error = $("error");
		var submit = $("submit");
		F.renderScoreBlock(given, { prefix: "given", heading: "How you rate " + d.teamName, labels: { s: "1 = all about the work and each other, 10 = all about itself" } });
		$("score-form").addEventListener("submit", async function (e) {
			e.preventDefault();
			error.hidden = true;
			var g = F.readScoreBlock(given, "given");
			if (!g) {
				error.textContent = "A row is still unanswered."; error.hidden = false;
				var first = document.querySelector("fieldset.unanswered");
				if (first) first.scrollIntoView({ behavior: "smooth", block: "center" });
				return;
			}
			submit.disabled = true;
			try {
				var res = await fetch(api + "/score", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ given: g }) });
				if (res.status === 200) {
					var out = await res.json().catch(function () { return {}; });
					if (out.you) try { localStorage.setItem("team-you:" + token, JSON.stringify(out.you)); } catch (e2) {}
				}
				if (res.status === 200 || res.status === 409) { window.scrollTo(0, 0); if (!(await load())) location.reload(); return; }
				if (res.status === 404) { showOnly("gone"); return; }
				var body = await res.json().catch(function () { return {}; });
				error.textContent = body.message || "Something went wrong."; error.hidden = false;
			} catch (err) {
				error.textContent = "Something went wrong."; error.hidden = false;
			}
			submit.disabled = false;
		});
	}

	function renderRoster(d, isCreator) {
		var list = $("roster");
		list.innerHTML = "";
		var canRemoveAny = isCreator && d.state !== "revealed";
		var tooSmall = d.members.length <= 3;
		d.members.forEach(function (m) {
			var li = el("li", m.answered ? "done" : "");
			var who = el("span", "who", m.nickname || "—");
			if (m.id === d.you.id) who.appendChild(el("small", null, "you"));
			li.appendChild(who);
			if (canRemoveAny && !m.answered && !m.isCreator) {
				var rm = el("button", "remove-member", "Remove");
				rm.type = "button";
				if (tooSmall) { rm.disabled = true; rm.title = "A team needs at least three people"; }
				else twoTap(rm, "Remove", async function () {
					var res = await fetch(api + "/remove", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ memberId: m.id }) });
					if (res.ok || res.status === 409) { await load(); return true; }
					return false;
				});
				li.appendChild(rm);
			}
			li.appendChild(el("span", "mark"));
			list.appendChild(li);
		});
		$("roster-caption").textContent = d.state === "revealed" ? "Who answered" : "Who has answered";
	}

	function ownNumbers() {
		try { return JSON.parse(localStorage.getItem("team-you:" + token) || "null"); } catch (e) { return null; }
	}

	function renderReveal(d) {
		var r = d.reveal;
		var you = ownNumbers();
		$("answered-line").textContent = r.size + " of you answered." + (you ? "" : " Your own numbers are kept only on the device you answered from.");
		var body = $("reveal-body");
		body.innerHTML = "";
		FACTORS.forEach(function (f) {
			var k = f[0];
			var tr = el("tr", k === "t" ? "total" : "");
			tr.appendChild(el("td", null, f[1]));
			tr.appendChild(el("td", null, fmt(r.min[k])));
			tr.appendChild(el("td", "avg", fmt(r.avg[k])));
			tr.appendChild(el("td", null, fmt(r.max[k])));
			tr.appendChild(el("td", "you", you ? fmt(you[k]) : "—"));
			body.appendChild(tr);
		});
	}

	function renderControls(d, isCreator) {
		var del = $("delete"), leave = $("leave"), forget = $("forget"), note = $("controls-note");
		del.hidden = leave.hidden = forget.hidden = note.hidden = true;
		if (isCreator) {
			del.hidden = false;
			twoTap(del, "Delete names and links", async function () {
				var res = await fetch(api, { method: "DELETE" });
				if (!res.ok && res.status !== 404) return false;
				finish("Deleted.", d.state === "revealed" ? "The names and links are gone. The numbers stay, without names, in the statistics." : "The team and its links are gone.");
				return true;
			});
			note.textContent = d.state === "revealed" ? "The numbers stay, without names, in the statistics." : "";
			note.hidden = !note.textContent;
			return;
		}
		if (d.state === "revealed") {
			forget.hidden = false;
			twoTap(forget, "Remove my name", async function () {
				var res = await fetch(api, { method: "DELETE" });
				if (!res.ok && res.status !== 404) return false;
				finish("Your name is gone.", "Your link is dead. Your numbers stay in the team's averages, without your name.");
				return true;
			});
			return;
		}
		if (!d.you.answered) {
			if (d.members.length <= 3) { note.textContent = "Ask " + d.creatorName + " to delete the team if you don't want to take part."; note.hidden = false; return; }
			leave.hidden = false;
			twoTap(leave, "Leave", async function () {
				var res = await fetch(api, { method: "DELETE" });
				if (res.status === 409) { await load(); return true; }
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
