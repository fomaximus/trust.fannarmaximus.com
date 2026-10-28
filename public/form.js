// Shared score-form pieces: four 1–10 rows per block. Classic script, exposes window.TrustForm.
(function () {
	var FACTORS = [
		{ key: "c", name: "Credibility", meaning: "Words. Can I believe what they say?" },
		{ key: "r", name: "Reliability", meaning: "Actions. Can I depend on them?" },
		{ key: "i", name: "Intimacy", meaning: "Safety. Can I tell them something that matters?" },
		{ key: "s", name: "Self-orientation", meaning: "" },
	];

	function el(tag, cls, text) {
		var n = document.createElement(tag);
		if (cls) n.className = cls;
		if (text !== undefined) n.textContent = text;
		return n;
	}

	// labels: optional { c, r, i, s } one-liners; s is required by callers because its direction differs.
	function renderScoreBlock(container, opts) {
		container.innerHTML = "";
		container.classList.add("block");
		var h = el("h3", "heading", opts.heading || "");
		container.appendChild(h);
		if (opts.lead) container.appendChild(el("p", "lead", opts.lead));
		FACTORS.forEach(function (f) {
			var fs = el("fieldset", "factor-row");
			fs.dataset.factor = f.key;
			var legend = el("legend");
			legend.appendChild(el("span", "name", f.name));
			var meaning = (opts.labels && opts.labels[f.key]) || f.meaning;
			if (meaning) legend.appendChild(el("span", "meaning", meaning));
			fs.appendChild(legend);
			var scale = el("div", "scale");
			for (var v = 1; v <= 10; v++) {
				var label = el("label");
				var input = document.createElement("input");
				input.type = "radio";
				input.name = opts.prefix + "-" + f.key;
				input.value = String(v);
				input.addEventListener("change", function () { fs.classList.remove("unanswered"); });
				label.appendChild(input);
				label.appendChild(el("span", null, String(v)));
				scale.appendChild(label);
			}
			fs.appendChild(scale);
			container.appendChild(fs);
		});
	}

	function setHeading(container, text) {
		var h = container.querySelector("h3.heading");
		if (h) h.textContent = text;
	}

	// Returns {c,r,i,s} or null; marks unanswered rows when incomplete.
	function readScoreBlock(container, prefix) {
		var out = {};
		var complete = true;
		FACTORS.forEach(function (f) {
			var checked = container.querySelector('input[name="' + prefix + "-" + f.key + '"]:checked');
			var row = container.querySelector('fieldset[data-factor="' + f.key + '"]');
			if (checked) {
				out[f.key] = Number(checked.value);
				row.classList.remove("unanswered");
			} else {
				complete = false;
				row.classList.add("unanswered");
			}
		});
		return complete ? out : null;
	}

	window.TrustForm = { renderScoreBlock: renderScoreBlock, readScoreBlock: readScoreBlock, setHeading: setHeading };
})();
