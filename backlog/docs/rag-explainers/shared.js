/* eslint-env browser */
/* RAG Explainers — shared runtime.
   Injects a consistent top nav across every page and exposes tiny helpers.
   Each explainer keeps its own interactive demo logic inline. */

(function () {
  // Canonical page order. `short` is the nav chip; `phase` is the roadmap phase.
  var PAGES = [
    { file: "index.html",                    short: "Map",        phase: "·",  title: "RAG Explainers" },
    { file: "01-evaluation-harness.html",    short: "Eval",       phase: "A",  title: "Evaluation harness" },
    { file: "02-hybrid-search.html",         short: "Hybrid",     phase: "D",  title: "Hybrid search (dense + BM25 + RRF)" },
    { file: "03-contextual-chunking.html",   short: "Chunking",   phase: "C",  title: "Chunking + Contextual Retrieval" },
    { file: "04-reranking.html",             short: "Rerank",     phase: "E",  title: "Reranking" },
    { file: "05-clean-ingestion.html",       short: "Ingest",     phase: "B",  title: "Clean ingestion" },
    { file: "06-embedding-selection.html",   short: "Embeddings", phase: "G",  title: "Embedding model selection" },
    { file: "07-query-transformation.html",  short: "Query",      phase: "F",  title: "Query transformation (HyDE)" },
    { file: "08-mcp-generation-surface.html",short: "Generation", phase: "H",  title: "Generation surface" },
    { file: "10-time-aware-retrieval.html",  short: "Time",       phase: "I",  title: "Time-aware retrieval" },
    { file: "09-deferred-architectures.html",short: "Advanced",   phase: "—",  title: "Deferred architectures" }
  ];

  window.RAG_PAGES = PAGES;

  function currentFile() {
    var p = location.pathname.split("/").pop();
    return p && p.length ? p : "index.html";
  }

  function buildNav() {
    var cur = currentFile();
    var nav = document.createElement("nav");
    nav.className = "topnav";
    var inner = document.createElement("div");
    inner.className = "topnav-inner";

    var brand = document.createElement("a");
    brand.className = "topnav-brand";
    brand.href = "index.html";
    brand.innerHTML = '<span class="dot"></span> BERGAMOT · RAG';
    inner.appendChild(brand);

    var links = document.createElement("div");
    links.className = "topnav-links";
    PAGES.forEach(function (pg) {
      if (pg.file === "index.html") return; // brand already links to the map
      var a = document.createElement("a");
      a.className = "navlink" + (pg.file === cur ? " active" : "");
      a.href = pg.file;
      a.textContent = pg.phase === "—" || pg.phase === "·"
        ? pg.short
        : pg.phase + " · " + pg.short;
      a.title = pg.title;
      links.appendChild(a);
    });
    inner.appendChild(links);
    nav.appendChild(inner);
    document.body.insertBefore(nav, document.body.firstChild);
  }

  function buildPrevNext() {
    var host = document.querySelector("[data-prevnext]");
    if (!host) return;
    var cur = currentFile();
    var idx = PAGES.findIndex(function (p) { return p.file === cur; });
    if (idx < 0) return;
    var prev = PAGES[idx - 1], next = PAGES[idx + 1];
    var html = "";
    if (prev) html += '<a class="prev" href="' + prev.file + '"><small>← Previous</small>' + (prev.phase !== "·" && prev.phase !== "—" ? "Phase " + prev.phase + " · " : "") + prev.title + "</a>";
    else html += "<span></span>";
    if (next) html += '<a class="next" href="' + next.file + '"><small>Next →</small>' + (next.phase !== "·" && next.phase !== "—" ? "Phase " + next.phase + " · " : "") + next.title + "</a>";
    host.innerHTML = html;
  }

  // tiny DOM helpers for inline demo scripts
  window.$  = function (sel, root) { return (root || document).querySelector(sel); };
  window.$$ = function (sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); };
  window.clamp = function (v, lo, hi) { return Math.max(lo, Math.min(hi, v)); };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", function () { buildNav(); buildPrevNext(); });
  } else { buildNav(); buildPrevNext(); }
})();
