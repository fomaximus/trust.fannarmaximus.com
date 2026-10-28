// Theme: follow the system unless the visitor chose; remember the choice.
(function () {
	var root = document.documentElement;
	try {
		var saved = localStorage.getItem("theme");
		if (saved === "light" || saved === "dark") root.setAttribute("data-theme", saved);
	} catch (e) {}

	function current() {
		var set = root.getAttribute("data-theme");
		if (set) return set;
		return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
	}
	function label(btn) { btn.textContent = current() === "dark" ? "light" : "dark"; }
	function toggle() {
		var next = current() === "dark" ? "light" : "dark";
		root.setAttribute("data-theme", next);
		try { localStorage.setItem("theme", next); } catch (e) {}
		document.querySelectorAll(".mode-toggle").forEach(label);
	}
	document.addEventListener("DOMContentLoaded", function () {
		document.querySelectorAll(".mode-toggle").forEach(function (btn) {
			label(btn);
			btn.addEventListener("click", toggle);
		});
	});
	window.TrustTheme = { toggle: toggle, current: current };
})();
