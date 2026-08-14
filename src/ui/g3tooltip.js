const tooltip = document.createElement("div");
tooltip.className = "g3-tooltip-popup"; tooltip.setAttribute("role", "tooltip"); tooltip.hidden = true; document.body.appendChild(tooltip);
let active = null;
function show(target) { active = target; tooltip.textContent = target.getAttribute("data-g3tooltip") || target.getAttribute("title") || ""; if (!tooltip.textContent) return; target.removeAttribute("title"); tooltip.hidden = false; const rect = target.getBoundingClientRect(), own = tooltip.getBoundingClientRect(); tooltip.style.left = `${Math.max(8, Math.min(innerWidth - own.width - 8, rect.left + rect.width / 2 - own.width / 2))}px`; tooltip.style.top = `${Math.max(8, rect.top - own.height - 8)}px`; }
function hide() { tooltip.hidden = true; active = null; }
function bind(target) { if (target.dataset.g3Bound) return; target.dataset.g3Bound = "1"; if (target.title) target.dataset.g3tooltip = target.title; target.addEventListener("mouseenter", () => show(target)); target.addEventListener("mouseleave", hide); target.addEventListener("focus", () => show(target)); target.addEventListener("blur", hide); }
window.G3Tooltip = { refresh(nodes = document.querySelectorAll(".g3-title[title], .g3-title[data-g3tooltip]")) { Array.from(nodes).forEach(bind); }, hide };
window.G3Tooltip.refresh();
