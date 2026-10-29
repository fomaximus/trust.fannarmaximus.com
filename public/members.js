// Shared member-row editor for the create and setup forms. Exposes window.TrustMembers.
(function () {
	var MIN_OTHERS = 2, MAX_OTHERS = 7;
	function attach(list, addBtn) {
		function addRow(focus) {
			if (list.children.length >= MAX_OTHERS) return;
			var row = document.createElement("div");
			row.className = "member-row";
			var input = document.createElement("input");
			input.type = "text"; input.maxLength = 40; input.placeholder = "Nickname"; input.autocomplete = "off";
			row.appendChild(input);
			if (list.children.length >= MIN_OTHERS) {
				var rm = document.createElement("button");
				rm.type = "button"; rm.className = "remove-row"; rm.textContent = "remove";
				rm.addEventListener("click", function () { row.remove(); addBtn.hidden = false; });
				row.appendChild(rm);
			}
			list.appendChild(row);
			addBtn.hidden = list.children.length >= MAX_OTHERS;
			if (focus) input.focus();
		}
		addRow(); addRow();
		addBtn.addEventListener("click", function () { addRow(true); });
		return {
			names: function () { return [].map.call(list.querySelectorAll("input"), function (i) { return i.value.trim(); }).filter(Boolean); },
		};
	}
	// Returns an error message or null.
	function check(captainName, names) {
		if (!captainName) return "Your nickname is needed.";
		if (names.length < MIN_OTHERS) return "A team needs at least three people.";
		var seen = {}; seen[captainName.toLowerCase()] = true;
		for (var i = 0; i < names.length; i++) {
			var k = names[i].toLowerCase();
			if (seen[k]) return '"' + names[i] + '" appears twice; nicknames must differ.';
			seen[k] = true;
		}
		return null;
	}
	window.TrustMembers = { attach: attach, check: check };
})();
