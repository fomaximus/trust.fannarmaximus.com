// Team create flow: member rows, client checks mirroring the server, POST /api/teams.
(function () {
	var MIN_OTHERS = 2, MAX_OTHERS = 7;
	var list = document.getElementById("members");
	var addBtn = document.getElementById("add-row");
	var error = document.getElementById("error");
	var submit = document.getElementById("submit");

	function addRow(focus) {
		if (list.children.length >= MAX_OTHERS) return;
		var row = document.createElement("div");
		row.className = "member-row";
		var input = document.createElement("input");
		input.type = "text";
		input.maxLength = 40;
		input.placeholder = "Nickname";
		input.autocomplete = "off";
		row.appendChild(input);
		if (list.children.length >= MIN_OTHERS) {
			var rm = document.createElement("button");
			rm.type = "button";
			rm.className = "remove-row";
			rm.textContent = "remove";
			rm.addEventListener("click", function () { row.remove(); addBtn.hidden = false; });
			row.appendChild(rm);
		}
		list.appendChild(row);
		addBtn.hidden = list.children.length >= MAX_OTHERS;
		if (focus) input.focus();
	}
	addRow(); addRow();
	addBtn.addEventListener("click", function () { addRow(true); });

	function showError(msg) { error.textContent = msg; error.hidden = false; }

	document.getElementById("team-form").addEventListener("submit", async function (e) {
		e.preventDefault();
		error.hidden = true;
		var teamName = document.getElementById("team-name").value.trim();
		var creatorName = document.getElementById("creator-name").value.trim();
		var members = [].map.call(list.querySelectorAll("input"), function (i) { return i.value.trim(); }).filter(Boolean);
		if (!teamName) { showError("The team needs a name."); return; }
		if (!creatorName) { showError("Your nickname is needed."); return; }
		if (members.length < MIN_OTHERS) { showError("A team needs at least three people."); return; }
		var seen = {}; seen[creatorName.toLowerCase()] = true;
		for (var i = 0; i < members.length; i++) {
			var k = members[i].toLowerCase();
			if (seen[k]) { showError('"' + members[i] + '" appears twice; nicknames must differ.'); return; }
			seen[k] = true;
		}
		submit.disabled = true;
		try {
			var res = await fetch("/api/teams", {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ teamName: teamName, creatorName: creatorName, members: members }),
			});
			var body = await res.json().catch(function () { return {}; });
			if (res.status === 201) { location.href = "/t/" + body.creatorToken; return; }
			if (res.status === 429) showError("Too many teams from this connection. Try again in an hour.");
			else showError(body.message || "Something went wrong.");
		} catch (err) {
			showError("Something went wrong.");
		}
		submit.disabled = false;
	});
	window.addEventListener("pageshow", function () { submit.disabled = false; });
})();
