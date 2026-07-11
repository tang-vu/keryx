/**
 * Keryx embeddable ask widget — the one-line on-ramp a creator pastes into
 * their own site:
 *
 *   <script src="https://keryx.cc/keryx-widget.js" data-keryx-source="<id>" async></script>
 *
 * Injects a floating "Ask Keryx" button (bottom-right). Clicking it opens a
 * panel iframing keryx.cc/embed, where visitors ask with no wallet — and if
 * the herald cites the hosting creator, they're paid from their own traffic.
 *
 * Zero dependencies, no cookies, nothing loaded until the button is clicked
 * (the iframe is created lazily). All styles are inline so the host page's
 * CSS cannot break it and vice versa.
 *
 * Optional attributes:
 *   data-keryx-source  — source id; names the hosting creator inside the panel
 *   data-keryx-label   — button text (default "Ask Keryx")
 */
(function () {
  "use strict";

  if (window.__keryxWidgetMounted) return; // one widget per page
  var script = document.currentScript;
  if (!script || !script.src) return;
  window.__keryxWidgetMounted = true;

  var origin;
  try {
    origin = new URL(script.src).origin;
  } catch (e) {
    return;
  }
  var source = script.getAttribute("data-keryx-source") || "";
  var label = script.getAttribute("data-keryx-label") || "Ask Keryx";
  var embedUrl = origin + "/embed" + (source ? "?source=" + encodeURIComponent(source) : "");

  // The Mint palette (matches keryx.cc globals.css).
  var INK = "#1b1712";
  var PAPER = "#f1e9d7";
  var SEAL = "#c0381c";
  var MONO = "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace";

  var open = false;
  var frame = null;

  var button = document.createElement("button");
  button.type = "button";
  button.textContent = "✦ " + label;
  button.setAttribute("aria-expanded", "false");
  button.setAttribute("aria-label", label + " — opens a panel");
  button.style.cssText =
    "position:fixed;bottom:20px;right:20px;z-index:2147483000;" +
    "background:" + INK + ";color:" + PAPER + ";border:1px solid " + INK + ";" +
    "padding:11px 18px;font:600 12px/1 " + MONO + ";letter-spacing:0.1em;" +
    "text-transform:uppercase;cursor:pointer;border-radius:2px;" +
    "box-shadow:0 3px 0 " + SEAL + ";transition:transform .15s ease,box-shadow .15s ease;";
  button.onmouseenter = function () {
    button.style.transform = "translateY(-2px)";
  };
  button.onmouseleave = function () {
    button.style.transform = "";
  };

  var panel = document.createElement("div");
  panel.style.cssText =
    "position:fixed;bottom:76px;right:20px;z-index:2147483000;display:none;" +
    "width:min(400px,calc(100vw - 32px));height:min(600px,calc(100vh - 110px));" +
    "background:" + PAPER + ";border:2px solid " + INK + ";" +
    "box-shadow:0 6px 0 rgba(27,23,18,0.35);";

  function toggle(next) {
    open = typeof next === "boolean" ? next : !open;
    // Lazy-create the iframe so the widget costs the host page nothing until used.
    if (open && !frame) {
      frame = document.createElement("iframe");
      frame.src = embedUrl;
      frame.title = "Ask Keryx — a reading agent that pays the writers it cites";
      frame.loading = "lazy";
      frame.style.cssText = "display:block;width:100%;height:100%;border:0;background:" + PAPER + ";";
      panel.appendChild(frame);
    }
    panel.style.display = open ? "block" : "none";
    button.textContent = open ? "× Close" : "✦ " + label;
    button.setAttribute("aria-expanded", String(open));
  }

  button.addEventListener("click", function () {
    toggle();
  });
  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape" && open) toggle(false);
  });

  function mount() {
    document.body.appendChild(panel);
    document.body.appendChild(button);
  }
  if (document.body) mount();
  else document.addEventListener("DOMContentLoaded", mount);
})();
