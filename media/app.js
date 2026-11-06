"use strict";

const NEULADEN_MS = 5 * 60 * 1000;
const ALT_NACH_MIN = 40;

/* ---------- Tabs ---------- */
const knoepfe = [...document.querySelectorAll(".tabs button")];
const panels = [...document.querySelectorAll(".panel")];

function zeige(id) {
  if (!knoepfe.some((b) => b.dataset.tab === id)) id = "rechner";
  knoepfe.forEach((b) => b.setAttribute("aria-selected", String(b.dataset.tab === id)));
  panels.forEach((p) => { p.hidden = p.id !== id; });
}

knoepfe.forEach((b) => b.addEventListener("click", () => {
  history.replaceState(null, "", "#" + b.dataset.tab);
  zeige(b.dataset.tab);
}));
window.addEventListener("hashchange", () => zeige(location.hash.slice(1)));
zeige(location.hash.slice(1));

/* ---------- Titel: verschluesselt in status.json, Klartext nur nach Passwort, nur im Speicher ---------- */
let TITEL = null;   // Kennung -> Name, solange entsperrt
let PASSWORT = null;

function klar(t) {
  if (!TITEL || typeof t !== "string") return t;
  return t.replace(/\S \[\d{3}\]/g, (m) => TITEL[m] || m);
}

async function entschluesseln(b64, passwort) {
  const roh = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  const roh_pw = await crypto.subtle.importKey("raw", new TextEncoder().encode(passwort), "PBKDF2", false, ["deriveKey"]);
  const key = await crypto.subtle.deriveKey(
    { name: "PBKDF2", salt: roh.slice(0, 16), iterations: 600000, hash: "SHA-256" },
    roh_pw, { name: "AES-GCM", length: 256 }, false, ["decrypt"]);
  const klartext = await crypto.subtle.decrypt({ name: "AES-GCM", iv: roh.slice(16, 28) }, key, roh.slice(28));
  return JSON.parse(new TextDecoder().decode(klartext));
}

/* ---------- Bausteine: Text immer per textContent, nie als HTML ---------- */
function el(tag, kl, text) {
  const e = document.createElement(tag);
  if (kl) e.className = kl;
  if (text !== undefined) e.textContent = text;
  return e;
}

function tabelle(kopf, zeilen) {
  const t = el("table", "daten quer");
  const h = t.createTHead().insertRow();
  kopf.forEach((k) => {
    const th = el("th", k.r ? "r" : "", k.t);
    h.appendChild(th);
  });
  const b = t.createTBody();
  zeilen.forEach((z) => {
    const r = b.insertRow();
    if (!Array.isArray(z)) {
      r.className = "gruppe";
      const td = r.insertCell();
      td.colSpan = kopf.length;
      td.textContent = z.gruppe;
      return;
    }
    z.forEach((zelle, i) => {
      const td = r.insertCell();
      const inhalt = zelle && typeof zelle === "object" ? zelle : { t: zelle };
      if (inhalt.knoten) td.appendChild(inhalt.knoten);
      else td.textContent = inhalt.t === undefined || inhalt.t === null ? "–" : klar(inhalt.t);
      const kl = [];
      if (kopf[i].r) kl.push("r");
      if (kopf[i].titel) kl.push("titel");
      if (inhalt.warn) kl.push("warn");
      td.className = kl.join(" ");
    });
  });
  return t;
}

function fuelle(id, inhalt) {
  document.getElementById(id).replaceChildren(inhalt);
}

function statusZelle(text, ok) {
  const s = el("span");
  s.appendChild(el("i", "punkt" + (ok ? "" : " aus")));
  s.appendChild(document.createTextNode(text));
  return { knoten: s };
}

function balken(prozent) {
  const w = el("div");
  w.appendChild(document.createTextNode(prozent + " %"));
  const b = el("div", "balken");
  const i = el("i");
  i.style.width = Math.min(100, prozent) + "%";
  b.appendChild(i);
  w.appendChild(b);
  return { knoten: w };
}

/* ---------- Tab 2 ---------- */
function zeigeServer(s) {
  const a = document.getElementById("server-ampel");
  a.textContent = s.auffaellig.length ? s.auffaellig.length + " Auffälligkeit(en)" : "alles in Ordnung";
  a.className = "pille " + (s.auffaellig.length ? "schlecht" : "gut");

  const box = document.getElementById("auffaellig");
  box.replaceChildren();
  if (s.auffaellig.length) {
    const h = el("div", "hinweis");
    h.appendChild(el("strong", "", "Auffälligkeiten"));
    const ul = el("ul");
    s.auffaellig.forEach((x) => ul.appendChild(el("li", "", klar(x))));
    h.appendChild(ul);
    box.appendChild(h);
  }

  fuelle("systeme", tabelle(
    [{ t: "System" }, { t: "Status" }, { t: "Last" }, { t: "Platte" }],
    s.systeme.map((x) => [x.name, statusZelle(x.status, x.ok), x.last, x.platte])));
  fuelle("bereiche", tabelle(
    [{ t: "Bereich" }, { t: "Zustand" }],
    s.bereiche.map((x) => [x.name, statusZelle(x.zustand, x.ok)])));
  fuelle("jobs", tabelle(
    [{ t: "Job" }, { t: "Zustand" }],
    s.jobs.map((x) => [x.name, statusZelle(x.zustand, x.ok)])));

  fuelle("dl12", s.downloads.length
    ? tabelle(
      [{ t: "Zeit (UTC)" }, { t: "Art" }, { t: "Titel", titel: true }, { t: "Quelle" }, { t: "Auflösung" }, { t: "Größe", r: true }],
      s.downloads.map((d) => [d.zeit, d.art, { t: d.titel, warn: d.warn }, d.quelle, d.aufl, d.groesse]))
    : el("p", "leer", "Keine Downloads in den letzten 12 Stunden."));
}

/* ---------- Tab 3 ---------- */
const DL_KOPF = [{ t: "Titel", titel: true }, { t: "Größe", r: true }, { t: "Fertig", r: true }, { t: "Seeds", r: true },
  { t: "Rate", r: true }, { t: "ETA", r: true }, { t: "In Queue seit", r: true }];

function dlZeilen(liste) {
  const anzahl = {};
  liste.forEach((t) => { anzahl[t.gruppe] = (anzahl[t.gruppe] || 0) + 1; });
  const zeilen = [];
  let davor = null;
  liste.forEach((t) => {
    if (t.gruppe !== davor) {
      zeilen.push({ gruppe: t.gruppe + " (" + anzahl[t.gruppe] + ")" });
      davor = t.gruppe;
    }
    zeilen.push([t.titel, t.groesse, t.fertig, { t: t.seeds, warn: t.warnSeeds },
      { t: t.rate, warn: t.warnRate }, { t: t.eta, warn: t.warnEta }, t.alter]);
  });
  return zeilen;
}

function zeigeDownloads(d) {
  document.getElementById("dl-kopf").textContent = d.kopf;
  document.getElementById("n-film").textContent = "(" + d.film.length + ")";
  document.getElementById("n-tv").textContent = "(" + d.tv.length + ")";
  fuelle("dl-film", d.film.length ? tabelle(DL_KOPF, dlZeilen(d.film)) : el("p", "leer", "keine"));
  fuelle("dl-tv", d.tv.length ? tabelle(DL_KOPF, dlZeilen(d.tv)) : el("p", "leer", "keine"));
  fuelle("dl-sonst", tabelle(
    [{ t: "Dienst" }, { t: "Größe", r: true }, { t: "Zustand" }, { t: "Rate", r: true }, { t: "Info" }],
    d.sonstige.map((x) => [x.name, x.groesse, statusZelle(x.zustand, x.ok), x.rate, x.info])));
  fuelle("speicher", tabelle(
    [{ t: "Ort" }, { t: "Gesamt", r: true }, { t: "Belegt", r: true }, { t: "Frei", r: true }, { t: "Auslastung" }],
    d.speicher.map((x) => [x.name, x.gesamt, x.belegt, x.frei, balken(x.prozent)])));
}

/* ---------- Daten laden ---------- */
let LETZTE = null;

async function lade() {
  const stand = document.getElementById("stand");
  try {
    const r = await fetch("data/status.json?t=" + Date.now(), { cache: "no-store" });
    if (!r.ok) throw new Error(r.status);
    const d = await r.json();
    LETZTE = d;
    if (PASSWORT && d.titel_enc) {
      try { TITEL = await entschluesseln(d.titel_enc, PASSWORT); } catch (e) { TITEL = null; }
    }
    zeigeServer(d.server);
    zeigeDownloads(d.downloads);
    const zeit = new Date(d.zeit);
    const alter = (Date.now() - zeit.getTime()) / 60000;
    stand.textContent = "Stand: " + zeit.toLocaleString("de-DE", { dateStyle: "short", timeStyle: "short" });
    stand.classList.toggle("alt", alter > ALT_NACH_MIN);
  } catch (e) {
    stand.textContent = "Stand: Daten nicht verfügbar";
    stand.classList.add("alt");
  }
}

/* ---------- Schloss ---------- */
const schloss = document.getElementById("schloss");

function neuZeichnen() {
  if (!LETZTE) return;
  zeigeServer(LETZTE.server);
  zeigeDownloads(LETZTE.downloads);
}

function sperren() {
  TITEL = null;
  PASSWORT = null;
  schloss.textContent = "🔒 Titel";
  schloss.title = "Titel";
  neuZeichnen();
}

schloss.addEventListener("click", () => {
  if (TITEL) { sperren(); return; }
  if (!LETZTE || !LETZTE.titel_enc) return;
  const f = document.createElement("input");
  f.type = "password";
  f.className = "pw";
  f.autocomplete = "off";
  f.setAttribute("aria-label", "Passwort");
  schloss.replaceWith(f);
  f.focus();
  const zurueck = () => { if (f.isConnected) f.replaceWith(schloss); };
  f.addEventListener("blur", () => setTimeout(zurueck, 150));
  f.addEventListener("keydown", async (ev) => {
    if (ev.key === "Escape") { zurueck(); return; }
    if (ev.key !== "Enter") return;
    try {
      TITEL = await entschluesseln(LETZTE.titel_enc, f.value);
      PASSWORT = f.value;
      schloss.textContent = "🔓 Titel";
      schloss.title = "wieder sperren";
      zurueck();
      neuZeichnen();
    } catch (e) {
      f.value = "";
      f.classList.add("falsch");
      setTimeout(() => f.classList.remove("falsch"), 700);
    }
  });
});

lade();
setInterval(lade, NEULADEN_MS);
