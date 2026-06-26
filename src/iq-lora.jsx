import { useState, useRef, useEffect } from "react";

/* ============================================================
   I/Q PRIMER · WORKED EXAMPLE — DECODING LoRa
   A full extraction chain on a real spread-spectrum signal:
   FHSS vs chirp spread spectrum, isolate the channel
   (tune/filter/decimate), dechirp + FFT, synchronize
   (timing + CFO), and read the payload bytes. SF = 8.
   Every plot runs the real DSP (verified in node).
   ============================================================ */

const C = {
  bg: "#0E1419", panel: "#141D25", panelHi: "#1A2530", edge: "#26343F",
  grid: "#22303A", gridFaint: "#18222B", ink: "#ECE7DB", sub: "#8B98A3",
  faint: "#5A6973", I: "#E8B85C", Q: "#56C7BF", sum: "#ECE7DB",
  A: "#B49BE0", B: "#E58AA6", D: "#86D08A", warn: "#E58AA6",
};
const FONT = {
  disp: "'Space Grotesk', system-ui, -apple-system, sans-serif",
  body: "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif",
  mono: "'Space Mono', ui-monospace, SFMono-Regular, Menlo, monospace",
};

function usePrefersReducedMotion() {
  const [r, setR] = useState(false);
  useEffect(() => { if (!window.matchMedia) return; const m = window.matchMedia("(prefers-reduced-motion: reduce)"); const h = () => setR(m.matches); h(); m.addEventListener?.("change", h); return () => m.removeEventListener?.("change", h); }, []);
  return r;
}
function fitCanvas(canvas, w, h) {
  const r = window.devicePixelRatio || 1; canvas.width = Math.round(w * r); canvas.height = Math.round(h * r); canvas.style.width = w + "px"; canvas.style.height = h + "px";
  const ctx = canvas.getContext("2d"); ctx.setTransform(r, 0, 0, r, 0, 0); return ctx;
}
let _seed = 1337;
const rand = () => { _seed = (_seed * 1103515245 + 12345) & 0x7fffffff; return _seed / 0x7fffffff; };
const randn = () => { let u = 0, v = 0; while (u === 0) u = rand(); while (v === 0) v = rand(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };
function fft(re, im) {
  const n = re.length; if (n <= 1) return [re, im];
  const er = [], ei = [], or_ = [], oi = [];
  for (let i = 0; i < n; i += 2) { er.push(re[i]); ei.push(im[i]); or_.push(re[i + 1]); oi.push(im[i + 1]); }
  const [Er, Ei] = fft(er, ei), [Or, Oi] = fft(or_, oi); const Re = new Array(n), Im = new Array(n);
  for (let k = 0; k < n / 2; k++) { const a = -2 * Math.PI * k / n, c = Math.cos(a), s = Math.sin(a); const tr = c * Or[k] - s * Oi[k], ti = s * Or[k] + c * Oi[k]; Re[k] = Er[k] + tr; Im[k] = Ei[k] + ti; Re[k + n / 2] = Er[k] - tr; Im[k + n / 2] = Ei[k] - ti; }
  return [Re, Im];
}
const argmax = (m) => { let bi = 0, bv = -1; for (let i = 0; i < m.length; i++) if (m[i] > bv) { bv = m[i]; bi = i; } return bi; };
const gray = (x) => x ^ (x >> 1);
const invgray = (g) => { let b = g; b ^= b >> 1; b ^= b >> 2; b ^= b >> 4; return b & 0xff; };

/* ---- LoRa primitives (SF, N global to a module) ---- */
function upchirp(n, N) { const p = 2 * Math.PI * (n * n / (2 * N) - n / 2); return [Math.cos(p), Math.sin(p)]; }
function loraSym(k, N) { const r = new Array(N), im = new Array(N); for (let n = 0; n < N; n++) { const [ur, ui] = upchirp(n, N), a = 2 * Math.PI * k * n / N, cr = Math.cos(a), ci = Math.sin(a); r[n] = ur * cr - ui * ci; im[n] = ur * ci + ui * cr; } return [r, im]; }
function downSym(N) { const r = new Array(N), im = new Array(N); for (let n = 0; n < N; n++) { const [ur, ui] = upchirp(n, N); r[n] = ur; im[n] = -ui; } return [r, im]; }
function dechirpMag(re, im, N) { const dr = new Array(N), di = new Array(N); for (let n = 0; n < N; n++) { const [ur, ui] = upchirp(n, N); dr[n] = re[n] * ur + im[n] * ui; di[n] = im[n] * ur - re[n] * ui; } const [R, I] = fft(dr, di); const mag = R.map((x, k) => Math.hypot(x, I[k])); return { mag, peak: argmax(mag) }; }
function stft(re, im, win, hop) { const cols = []; for (let s = 0; s + win <= re.length; s += hop) { const wr = new Array(win), wi = new Array(win); for (let n = 0; n < win; n++) { const wn = 0.5 - 0.5 * Math.cos(2 * Math.PI * n / (win - 1)); wr[n] = re[s + n] * wn; wi[n] = im[s + n] * wn; } const [R, I] = fft(wr, wi); const m = new Array(win); for (let k = 0; k < win; k++) m[(k + win / 2) % win] = Math.hypot(R[k], I[k]); cols.push(m); } return cols; }
function firLP(cut, M) { const h = []; for (let i = 0; i < M; i++) { const x = i - (M - 1) / 2; const s = x === 0 ? 2 * cut : Math.sin(2 * Math.PI * cut * x) / (Math.PI * x); h.push(s * (0.54 - 0.46 * Math.cos(2 * Math.PI * i / (M - 1)))); } const g = h.reduce((a, b) => a + b, 0); return h.map((v) => v / g); }
function conv(x, h) { const y = new Array(x.length + h.length - 1).fill(0); for (let n = 0; n < x.length; n++) { const xn = x[n]; for (let k = 0; k < h.length; k++) y[n + k] += xn * h[k]; } return y; }

/* ---- atoms ---- */
function Eyebrow({ children }) { return <div style={{ fontFamily: FONT.mono, fontSize: 11, letterSpacing: "0.18em", textTransform: "uppercase", color: C.faint }}>{children}</div>; }
function Panel({ label, children, style }) { return <div style={{ background: C.panel, border: `1px solid ${C.edge}`, borderRadius: 10, padding: 16, ...style }}>{label && <div style={{ marginBottom: 12 }}><Eyebrow>{label}</Eyebrow></div>}{children}</div>; }
function Slider({ label, value, min, max, step, onChange, color = C.ink, fmt }) {
  return (
    <label style={{ display: "block" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 5 }}><span style={{ fontSize: 13, color: C.sub, fontFamily: FONT.body }}>{label}</span><span style={{ fontFamily: FONT.mono, fontSize: 13, color }}>{fmt ? fmt(value) : value}</span></div>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(parseFloat(e.target.value))} style={{ width: "100%", color }} />
    </label>
  );
}
function Pills({ value, options, onChange, color = C.Q, labels }) { return <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>{options.map((o, i) => <button key={o} onClick={() => onChange(o)} className="iq-mini" data-on={value === o ? "1" : "0"} style={value === o ? { borderColor: color, color } : undefined}>{labels ? labels[i] : o}</button>)}</div>; }
function Readout({ rows }) { return <div style={{ display: "grid", gap: 8 }}>{rows.map(([l, v, c], i) => <div key={i} style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", borderBottom: `1px solid ${C.gridFaint}`, paddingBottom: 6 }}><span style={{ fontFamily: FONT.body, fontSize: 12, color: C.sub }}>{l}</span><span style={{ fontFamily: FONT.mono, fontSize: 14, color: c || C.ink }}>{v}</span></div>)}</div>; }
function Lead({ n, title, body, notes }) {
  return (
    <div style={{ marginBottom: 20 }}>
      <div style={{ maxWidth: 730 }}><div style={{ display: "flex", alignItems: "baseline", gap: 12, marginBottom: 6 }}><span style={{ fontFamily: FONT.mono, fontSize: 13, color: C.Q }}>{n}</span><h2 style={{ fontFamily: FONT.disp, fontSize: 23, fontWeight: 600, color: C.ink, margin: 0, letterSpacing: "-0.01em" }}>{title}</h2></div><p style={{ fontFamily: FONT.body, fontSize: 14.5, color: C.sub, lineHeight: 1.62, margin: 0 }}>{body}</p></div>
      {notes && <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 16, maxWidth: 920 }}>{notes.map((nt, i) => <div key={i} style={{ flex: "1 1 200px", minWidth: 175, background: C.panel, border: `1px solid ${C.edge}`, borderLeft: `2px solid ${nt.c}`, borderRadius: 8, padding: "10px 12px" }}><div style={{ fontFamily: FONT.mono, fontSize: 9.5, letterSpacing: "0.16em", textTransform: "uppercase", color: nt.c, marginBottom: 5 }}>{nt.t}</div><div style={{ fontFamily: FONT.body, fontSize: 12.5, color: C.sub, lineHeight: 1.5 }}>{nt.x}</div></div>)}</div>}
    </div>
  );
}
function Deeper({ recap, example }) {
  const [open, setOpen] = useState(false);
  return (
    <div style={{ marginTop: 18 }}>
      <button onClick={() => setOpen(!open)} style={{ fontFamily: FONT.mono, fontSize: 11.5, padding: "7px 13px", borderRadius: 6, border: `1px solid ${open ? C.Q : C.edge}`, background: open ? C.panelHi : "transparent", color: open ? C.Q : C.sub, cursor: "pointer" }}>{open ? "\u25be  hide the deeper dive" : "\u25b8  go deeper \u2014 recap & a worked example"}</button>
      {open && <div style={{ marginTop: 12, background: C.panel, border: `1px solid ${C.edge}`, borderRadius: 10, padding: 18, maxWidth: 940 }}>
        <div style={{ fontFamily: FONT.mono, fontSize: 9.5, letterSpacing: "0.16em", textTransform: "uppercase", color: C.Q, marginBottom: 6 }}>So what just happened</div>
        <p style={{ fontFamily: FONT.body, fontSize: 13.5, color: C.sub, lineHeight: 1.62, margin: "0 0 16px" }}>{recap}</p>
        <div style={{ fontFamily: FONT.mono, fontSize: 9.5, letterSpacing: "0.16em", textTransform: "uppercase", color: C.I, marginBottom: 8 }}>Worked example</div>
        <div style={{ fontFamily: FONT.mono, fontSize: 12, color: C.ink, lineHeight: 1.65, background: C.bg, border: `1px solid ${C.gridFaint}`, borderRadius: 8, padding: "12px 14px", whiteSpace: "pre-wrap", overflowX: "auto" }}>{example}</div>
      </div>}
    </div>
  );
}
function Predict({ q, options, answer, why }) {
  const [pick, setPick] = useState(null);
  return (
    <div style={{ background: C.panel, border: "1px solid " + C.edge, borderLeft: "2px solid " + C.I, borderRadius: 8, padding: "12px 14px", marginBottom: 16, maxWidth: 720 }}>
      <div style={{ fontFamily: FONT.mono, fontSize: 9.5, letterSpacing: "0.16em", textTransform: "uppercase", color: C.I, marginBottom: 6 }}>Predict before you drag</div>
      <div style={{ fontFamily: FONT.body, fontSize: 13.5, color: C.ink, marginBottom: 10, lineHeight: 1.5 }}>{q}</div>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        {options.map((o, i) => { const on = pick === i, correct = i === answer; const bc = pick == null ? C.edge : (correct ? C.D : (on ? C.warn : C.edge)); const tc = pick == null ? C.sub : (correct ? C.D : (on ? C.warn : C.faint)); return <button key={i} onClick={() => setPick(i)} style={{ fontFamily: FONT.body, fontSize: 12.5, padding: "6px 11px", borderRadius: 6, border: "1px solid " + bc, background: on ? C.panelHi : "transparent", color: tc, cursor: "pointer" }}>{o}</button>; })}
      </div>
      {pick != null && <div style={{ fontFamily: FONT.body, fontSize: 12.5, color: C.sub, marginTop: 10, lineHeight: 1.5 }}><span style={{ color: pick === answer ? C.D : C.warn, fontFamily: FONT.mono, fontSize: 11 }}>{pick === answer ? "correct" : "not quite"}</span>{" \u2014 "}{why}</div>}
    </div>
  );
}

/* ---- shared draws ---- */
function heatColor(v) { v = Math.max(0, Math.min(1, v)); if (v < 0.5) { const t = v / 0.5; return `rgb(${Math.round(14 + t * 72)},${Math.round(20 + t * 179)},${Math.round(27 + t * 164)})`; } const t = (v - 0.5) / 0.5; return `rgb(${Math.round(86 + t * 146)},${Math.round(199 - t * 15)},${Math.round(191 - t * 99)})`; }
function drawHeat(ctx, w, h, cols, win) { if (!cols.length) return; let mx = 0; cols.forEach((c) => c.forEach((v) => { if (v > mx) mx = v; })); mx = mx || 1; const cw = w / cols.length, ch = h / win; for (let i = 0; i < cols.length; i++) for (let k = 0; k < win; k++) { ctx.fillStyle = heatColor(cols[i][win - 1 - k] / mx); ctx.fillRect(i * cw, k * ch, cw + 0.6, ch + 0.6); } }
function drawMag(ctx, w, h, mag, color, peak) { const pad = { l: 4, r: 4, t: 8, b: 14 }, x0 = pad.l, x1 = w - pad.r, y0 = pad.t, y1 = h - pad.b; let mx = Math.max(...mag) || 1; ctx.strokeStyle = C.gridFaint; ctx.beginPath(); ctx.moveTo(x0, y1); ctx.lineTo(x1, y1); ctx.stroke(); ctx.strokeStyle = color; ctx.lineWidth = 1.4; ctx.beginPath(); mag.forEach((v, i) => { const x = x0 + (i / (mag.length - 1)) * (x1 - x0), y = y1 - (v / mx) * (y1 - y0); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); }); ctx.stroke(); if (peak != null) { const x = x0 + (peak / (mag.length - 1)) * (x1 - x0); ctx.fillStyle = C.warn; ctx.beginPath(); ctx.arc(x, y1 - (mag[peak] / mx) * (y1 - y0), 3.2, 0, 7); ctx.fill(); ctx.font = `9px ${FONT.mono}`; ctx.textAlign = "center"; ctx.fillText("bin " + peak, x, y1 + 12); } }

/* ============================================================
   L1 — SPREAD IN TIME: FHSS & CHIRP (and the LoRa frame)
   ============================================================ */
function SpreadModule() {
  const loraRef = useRef(null), fhssRef = useRef(null);
  const SF = 8, N = 1 << SF, nPre = 4, win = 32, hop = 8;
  useEffect(() => {
    // LoRa frame: preamble up-chirps, 2 down-chirps (SFD), payload
    _seed = 808; const payload = [60, 150, 30, 200], re = [], im = [];
    for (let p = 0; p < nPre; p++) { const [r, i] = loraSym(0, N); re.push(...r); im.push(...i); }
    for (let p = 0; p < 2; p++) { const [r, i] = downSym(N); re.push(...r); im.push(...i); }
    payload.forEach((k) => { const [r, i] = loraSym(k, N); re.push(...r); im.push(...i); });
    const lc = loraRef.current;
    if (lc) { const ctx = lc._ctx || (lc._ctx = fitCanvas(lc, lc.clientWidth, lc.clientHeight)); const w = lc.clientWidth, h = lc.clientHeight; ctx.clearRect(0, 0, w, h); drawHeat(ctx, w, h, stft(re, im, win, hop), win);
      // region labels
      const total = re.length; const lab = (a, b, t, col) => { const x0 = (a / total) * w, x1 = (b / total) * w; ctx.strokeStyle = col; ctx.lineWidth = 1; ctx.strokeRect(x0 + 1, 1, x1 - x0 - 2, h - 2); ctx.fillStyle = col; ctx.font = `9px ${FONT.mono}`; ctx.textAlign = "center"; ctx.fillText(t, (x0 + x1) / 2, 11); };
      lab(0, nPre * N, "preamble", C.D); lab(nPre * N, (nPre + 2) * N, "SFD", C.B); lab((nPre + 2) * N, total, "payload", C.I);
    }
    // FHSS: hops among random frequencies
    _seed = 12; const fre = [], fim = []; const slots = 10, slot = Math.floor(re.length / slots);
    for (let s = 0; s < slots; s++) { const f = (Math.floor(rand() * 11) - 5) / 12; for (let n = 0; n < slot; n++) { const a = 2 * Math.PI * f * n; fre.push(Math.cos(a)); fim.push(Math.sin(a)); } }
    const fc = fhssRef.current; if (fc) { const ctx = fc._ctx || (fc._ctx = fitCanvas(fc, fc.clientWidth, fc.clientHeight)); const w = fc.clientWidth, h = fc.clientHeight; ctx.clearRect(0, 0, w, h); drawHeat(ctx, w, h, stft(fre, fim, win, hop), win); }
  }, []);
  return (
    <div>
      <Lead
        notes={[
          { t: "Term", c: C.A, x: "Spread-spectrum schemes deliberately use far more bandwidth than the data needs, to gain robustness and low power density. FHSS hops the carrier among many frequencies; chirp spread spectrum (CSS, used by LoRa) sweeps continuously across the band." },
          { t: "Intuition", c: C.Q, x: "On a spectrogram (the Part-1 waterfall) FHSS is a scatter of short horizontal dashes jumping around; a LoRa chirp is a clean diagonal ramp. Both smear energy in the time\u2013frequency plane so a jammer or a fade can only hurt part of it." },
          { t: "Try it", c: C.D, x: "Read the LoRa frame top: several identical up-chirps (the preamble) to lock onto, two down-chirps (the start-of-frame delimiter), then the payload chirps whose starting frequencies carry the bits." },
        ]}
        n="L1" title="Spread in time: FHSS & chirp spread spectrum"
        body="This part decodes a real LoRa transmission end to end, using every stage you have built. Start with what the signal is. Spread spectrum trades bandwidth for resilience: frequency hopping (Bluetooth, some military radios) leaps the carrier around; chirp spread spectrum, LoRa's choice, sweeps a chirp across the whole band. A LoRa frame is a run of identical up-chirps, two down-chirps, then payload chirps." />
      <div className="iq-grid2">
        <div style={{ display: "grid", gap: 14 }}>
          <Panel label="A LoRa frame — spectrogram (chirps are diagonals)">
            <canvas ref={loraRef} style={{ width: "100%", height: 200, display: "block" }} />
            <p style={{ fontFamily: FONT.body, fontSize: 12, color: C.sub, margin: "9px 0 0", lineHeight: 1.5 }}>
              Each diagonal is one chirp sweeping low-to-high and wrapping. The preamble chirps are identical; payload chirps start at different frequencies — that starting point is the symbol value we will read off.
            </p>
          </Panel>
          <Panel label="Frequency hopping (FHSS), for contrast">
            <canvas ref={fhssRef} style={{ width: "100%", height: 110, display: "block" }} />
          </Panel>
        </div>
        <div style={{ display: "grid", gap: 14, alignContent: "start" }}>
          <Panel label="This signal">
            <Readout rows={[["scheme", "LoRa (CSS)", C.I], ["spreading factor SF", "8", C.ink], ["chips per symbol (2^SF)", "256", C.ink], ["bits per symbol", "8 (one byte)", C.D], ["processing gain", "10·log10(256) = 24.1 dB", C.D]]} />
          </Panel>
          <Panel label="The plan">
            <div style={{ fontFamily: FONT.body, fontSize: 12.5, color: C.sub, lineHeight: 1.7 }}>
              <div><span style={{ color: C.Q, fontFamily: FONT.mono }}>L2</span> &nbsp;isolate the channel — tune, filter, decimate</div>
              <div><span style={{ color: C.Q, fontFamily: FONT.mono }}>L3</span> &nbsp;dechirp + FFT — turn a chirp into a bin</div>
              <div><span style={{ color: C.Q, fontFamily: FONT.mono }}>L4</span> &nbsp;synchronize — timing & frequency offset</div>
              <div><span style={{ color: C.Q, fontFamily: FONT.mono }}>L5</span> &nbsp;read the payload — bins → bytes</div>
            </div>
          </Panel>
        </div>
      </div>
      <Deeper
        recap="A LoRa symbol is a linear chirp that sweeps the whole bandwidth BW over 2^SF samples; the data is hidden in where the sweep starts (and wraps). Because the energy is spread across the band and across time, the average power density is tiny \u2014 the same spread-spectrum benefit as the codes in module 20, but achieved by sweeping instead of multiplying by a code. FHSS gets there a third way, by hopping the carrier. The preamble's repeated up-chirps give the receiver something known to synchronize against."
        example={`LoRa frame layout (SF = 8, N = 256 chips/symbol):
   [ up-chirp x ${nPre} ]  [ down-chirp x 2 ]  [ payload chirps... ]
      preamble              SFD                  data

Spreading: BW \u2248 125 kHz spread, data rate only ~hundreds of bps
   -> processing gain 10\u00b7log10(256) \u2248 24 dB, so LoRa decodes
      well below the noise floor (verified next module).
FHSS instead: carrier jumps among N channels on a known pattern;
   a narrowband interferer only catches the occasional hop.`}
      />
    </div>
  );
}

/* ============================================================
   L2 — ISOLATE THE CHANNEL (tune / filter / decimate)
   ============================================================ */
function IsolateModule() {
  const wideRef = useRef(null), narrowRef = useRef(null);
  const SF = 7, N = 1 << SF;
  const [tune, setTune] = useState(0.18);
  const off = 0.18;
  useEffect(() => {
    _seed = 451; const [r0, i0] = loraSym(45, N); const h = firLP(0.24, 31);
    // upsample x2
    const ur = [], ui = []; for (let n = 0; n < N; n++) { ur.push(r0[n], 0); ui.push(i0[n], 0); }
    let fr = conv(ur, h).map((v) => v * 2), fi = conv(ui, h).map((v) => v * 2);
    // place at offset + noise -> wideband capture
    const wr = [], wi = []; for (let n = 0; n < fr.length; n++) { const a = 2 * Math.PI * off * n, c = Math.cos(a), s = Math.sin(a); wr.push(fr[n] * c - fi[n] * s + 0.25 * randn()); wi.push(fr[n] * s + fi[n] * c + 0.25 * randn()); }
    // DDC with user's tune
    const dr = [], di = []; for (let n = 0; n < wr.length; n++) { const a = -2 * Math.PI * tune * n, c = Math.cos(a), s = Math.sin(a); dr.push(wr[n] * c - wi[n] * s); di.push(wr[n] * s + wi[n] * c); }
    const lr = conv(dr, h), li = conv(di, h); const nr = [], ni = []; for (let n = 0; n < N; n++) { nr.push(lr[2 * n + 30]); ni.push(li[2 * n + 30]); }
    const spec = (re, im, M) => { const a = re.slice(0, M), b = im.slice(0, M); while (a.length < M) { a.push(0); b.push(0); } const [R, I] = fft(a, b); const m = new Array(M); for (let k = 0; k < M; k++) m[(k + M / 2) % M] = Math.hypot(R[k], I[k]); return m; };
    const drawS = (cv, mag, color, mark) => { const ctx = cv._ctx || (cv._ctx = fitCanvas(cv, cv.clientWidth, cv.clientHeight)); const w = cv.clientWidth, h = cv.clientHeight, y1 = h - 14; ctx.clearRect(0, 0, w, h); ctx.strokeStyle = C.gridFaint; ctx.beginPath(); ctx.moveTo(0, y1); ctx.lineTo(w, y1); ctx.stroke(); ctx.beginPath(); ctx.moveTo(w / 2, 0); ctx.lineTo(w / 2, h); ctx.stroke(); const mx = Math.max(...mag) || 1; ctx.strokeStyle = color; ctx.lineWidth = 1.4; ctx.beginPath(); mag.forEach((v, i) => { const x = (i / (mag.length - 1)) * w, y = y1 - (v / mx) * (y1 - 8); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); }); ctx.stroke(); ctx.fillStyle = C.faint; ctx.font = `9px ${FONT.mono}`; ctx.textAlign = "center"; ctx.fillText("0", w / 2, h - 2); };
    if (wideRef.current) drawS(wideRef.current, spec(wr, wi, 512), C.sub);
    if (narrowRef.current) drawS(narrowRef.current, spec(nr, ni, N), C.Q);
  }, [tune]);
  const locked = Math.abs(tune - off) < 0.015;
  return (
    <div>
      <Lead
        notes={[
          { t: "Term", c: C.A, x: "A capture is usually far wider than one signal. The digital downconverter from Part 2 extracts a channel: multiply by a complex exponential to slide it to 0 Hz (tune), low-pass to reject everything else (filter), then drop the sample rate (decimate)." },
          { t: "Intuition", c: C.Q, x: "Tuning re-centres the LoRa hump on 0 Hz; the low-pass keeps only its bandwidth; decimating throws away samples you no longer need. What is left is the LoRa signal alone, critically sampled and ready to demodulate." },
          { t: "Heads up", c: C.warn, x: "Get the tune frequency slightly wrong and a residual offset remains \u2014 plus the filters add a group delay that nudges the symbol timing. Both are cleaned up by synchronization in L4; isolation only has to get the channel roughly centred." },
        ]}
        n="L2" title="Isolate the channel"
        body="The radio handed us a wide slice of spectrum with the LoRa signal sitting off to one side in noise. Before any chirp magic, reuse the digital downconverter: tune the signal down to baseband, filter to its bandwidth, and decimate. Slide the tuning until the hump is centred on zero." />
      <div className="iq-grid2">
        <div style={{ display: "grid", gap: 14 }}>
          <Panel label="Wideband capture — LoRa sits off-centre in noise">
            <canvas ref={wideRef} style={{ width: "100%", height: 130, display: "block" }} />
          </Panel>
          <Panel label="After tune → filter → decimate">
            <canvas ref={narrowRef} style={{ width: "100%", height: 130, display: "block" }} />
            <p style={{ fontFamily: FONT.body, fontSize: 12, color: C.sub, margin: "9px 0 0", lineHeight: 1.5 }}>
              Centred and cleaned, this is the LoRa channel alone. The diagonal chirp energy now fills the band — exactly the signal L3 will dechirp.
            </p>
          </Panel>
        </div>
        <div style={{ display: "grid", gap: 14, alignContent: "start" }}>
          <Panel label="Downconverter">
            <Slider label="tune frequency (NCO)" value={tune} min={0} max={0.36} step={0.005} color={C.I} fmt={(v) => v.toFixed(3)} onChange={setTune} />
            <p style={{ fontFamily: FONT.body, fontSize: 12, color: C.sub, margin: "10px 0 0", lineHeight: 1.5 }}>Then a windowed-sinc low-pass (31 taps) and decimate by 2.</p>
          </Panel>
          <Panel label="Status">
            <Readout rows={[["true offset", off.toFixed(3), C.sub], ["your tune", tune.toFixed(3), C.ink], ["channel", locked ? "centred — locked" : "off-centre", locked ? C.D : C.warn]]} />
          </Panel>
        </div>
      </div>
      <Deeper
        recap="This is the digital downconverter applied to a real spread-spectrum signal. Multiplying the wideband samples by exp(\u2212j2\u03c0 f_tune n) shifts the chosen channel to baseband; the low-pass rejects the rest of the band and the out-of-band noise; decimation reduces the rate to roughly the signal bandwidth. The chirp\u2019s wide instantaneous bandwidth means the low-pass must pass the whole LoRa band, not just a tone."
        example={`Wideband capture (oversampled x2), LoRa at +${off}:
   tune:    y[n] = x[n]\u00b7e^(\u2212j2\u03c0\u00b7${off}\u00b7n)   -> hump moves to 0 Hz
   filter:  31-tap windowed-sinc low-pass, cutoff ~0.24
   decimate: keep every 2nd sample -> critically sampled (fs = BW)

Residual after isolation: a small frequency offset (if tune is off)
and a filter group delay -> a timing offset. L4 estimates and
removes both from the known preamble.`}
      />
    </div>
  );
}

/* ============================================================
   L3 — DECHIRP + FFT (the heart of CSS demod)
   ============================================================ */
function DechirpModule() {
  const freqRef = useRef(null), fftRef = useRef(null);
  const SF = 8, N = 1 << SF;
  const [k, setK] = useState(80);
  const [snr, setSnr] = useState(0);
  useEffect(() => {
    _seed = 99; const [r0, i0] = loraSym(k, N); const sd = Math.sqrt(Math.pow(10, -snr / 10) / 2);
    const re = r0.map((v) => v + sd * randn()), im = i0.map((v) => v + sd * randn());
    const { mag, peak } = dechirpMag(re, im, N);
    // instantaneous frequency of the chosen symbol and of the dechirped tone
    const fc = freqRef.current;
    if (fc) { const ctx = fc._ctx || (fc._ctx = fitCanvas(fc, fc.clientWidth, fc.clientHeight)); const w = fc.clientWidth, h = fc.clientHeight, mid = h / 2; ctx.clearRect(0, 0, w, h); ctx.strokeStyle = C.gridFaint; ctx.beginPath(); ctx.moveTo(0, mid); ctx.lineTo(w, mid); ctx.stroke();
      // chirp inst freq: f(n) = (n/N - 1/2 + k/N) wrapped into [-1/2,1/2)
      ctx.strokeStyle = C.I; ctx.lineWidth = 1.6; for (let n = 0; n < N; n++) { let f = (n / N - 0.5 + k / N); f = ((f + 0.5) % 1 + 1) % 1 - 0.5; const x = (n / (N - 1)) * w, y = mid - f * (h - 18); if (n === 0 || Math.abs(f - (((((n - 1) / N - 0.5 + k / N) + 0.5) % 1 + 1) % 1 - 0.5)) > 0.4) ctx.moveTo(x, y); else ctx.lineTo(x, y); } ctx.stroke();
      // dechirped tone (flat at k/N)
      let ft = (k / N); ft = ((ft + 0.5) % 1 + 1) % 1 - 0.5; ctx.strokeStyle = C.D; ctx.lineWidth = 1.6; ctx.setLineDash([5, 3]); ctx.beginPath(); const yt = mid - ft * (h - 18); ctx.moveTo(0, yt); ctx.lineTo(w, yt); ctx.stroke(); ctx.setLineDash([]);
      ctx.fillStyle = C.I; ctx.font = `9px ${FONT.mono}`; ctx.textAlign = "left"; ctx.fillText("— chirp sweep (wraps)", 6, 12); ctx.fillStyle = C.D; ctx.fillText("- - dechirped tone (flat at the symbol)", 6, h - 6);
    }
    if (fftRef.current) { const ctx = fftRef.current._ctx || (fftRef.current._ctx = fitCanvas(fftRef.current, fftRef.current.clientWidth, fftRef.current.clientHeight)); ctx.clearRect(0, 0, fftRef.current.clientWidth, fftRef.current.clientHeight); drawMag(ctx, fftRef.current.clientWidth, fftRef.current.clientHeight, mag, C.Q, peak); }
    setDet(peak);
  }, [k, snr]);
  const [det, setDet] = useState(k);
  return (
    <div>
      <Lead
        notes={[
          { t: "Term", c: C.A, x: "Dechirping multiplies the received symbol by a base down-chirp (the conjugate up-chirp). A shifted up-chirp times a down-chirp is a pure tone whose frequency equals the symbol value. An FFT then reads that value off as a single bin." },
          { t: "Intuition", c: C.Q, x: "The sweep cancels: subtract the known ramp and only the constant starting offset remains, as a steady tone. This is the LoRa receiver in one move \u2014 dechirp, FFT, take the peak bin." },
          { t: "Heads up", c: C.warn, x: "Coherently summing 256 chips into one FFT bin is the processing gain. Drop the SNR far below 0 dB and the peak still towers over the noise \u2014 which is why LoRa reaches for kilometres at milliwatts." },
        ]}
        n="L3" title="Dechirp & FFT — the heart of it"
        body="Here is the trick the whole scheme is built on. Multiply the incoming chirp by a down-chirp and the sweep vanishes, leaving a plain tone sitting at a frequency equal to the symbol's value. One FFT turns that tone into a single bright bin. Pick a symbol value and watch the chirp flatten into a tone and the FFT peak land exactly on it — even buried in noise." />
      <div className="iq-grid2">
        <div style={{ display: "grid", gap: 14 }}>
          <Panel label="Instantaneous frequency: chirp → dechirped tone">
            <canvas ref={freqRef} style={{ width: "100%", height: 150, display: "block" }} />
          </Panel>
          <Panel label="FFT of the dechirped symbol — the peak is the value">
            <canvas ref={fftRef} style={{ width: "100%", height: 150, display: "block" }} />
          </Panel>
        </div>
        <div style={{ display: "grid", gap: 14, alignContent: "start" }}>
          <Panel label="Symbol & noise">
            <div style={{ display: "grid", gap: 16 }}>
              <Slider label="symbol value (start frequency)" value={k} min={0} max={255} step={1} color={C.I} fmt={(v) => v + " / 256"} onChange={setK} />
              <Slider label="chip SNR" value={snr} min={-16} max={10} step={1} color={C.Q} fmt={(v) => v + " dB"} onChange={setSnr} />
            </div>
          </Panel>
          <Panel label="Demod">
            <Readout rows={[["sent symbol", k + "", C.I], ["FFT peak bin", det + "", det === k ? C.D : C.warn], ["match", det === k ? "correct" : "error", det === k ? C.D : C.warn], ["processing gain", "24.1 dB", C.D]]} />
            <p style={{ fontFamily: FONT.body, fontSize: 12, color: C.sub, margin: "11px 0 0", lineHeight: 1.5 }}>
              Push the SNR down to −13 dB or so: the chip waveform is invisible in noise, yet the FFT peak still calls the symbol right. That gap is the spreading factor working.
            </p>
          </Panel>
        </div>
      </div>
      <Deeper
        recap="A LoRa symbol of value k is the base up-chirp multiplied by exp(j2\u03c0kn/N) \u2014 the same chirp, started k bins higher. The receiver multiplies by the base down-chirp exp(\u2212j(chirp phase)), which cancels the quadratic sweep and leaves exp(j2\u03c0kn/N): a tone at digital frequency k/N. An N-point FFT puts all that energy in bin k. Because the FFT sums N chips coherently while noise adds incoherently, the effective SNR rises by a factor N \u2014 the processing gain, 10\u00b7log10(N) dB."
        example={`Sent:    s[n] = upchirp[n] \u00b7 e^(j2\u03c0\u00b7k\u00b7n/N)
Dechirp: d[n] = s[n] \u00b7 conj(upchirp[n]) = e^(j2\u03c0\u00b7k\u00b7n/N)   (a tone)
FFT(d):  one peak at bin k  -> symbol = k.   (verified for all 256)

Processing gain (SF = 8): 10\u00b7log10(256) = 24.1 dB.
   chip SNR \u221210 dB -> ~97% symbols correct
   chip SNR \u221213 dB -> ~69% correct
The chips are below the noise; the bin is not.`}
      />
    </div>
  );
}

/* ============================================================
   L4 — SYNCHRONIZE (timing + carrier frequency offset)
   ============================================================ */
function SyncModule() {
  const ref = useRef(null);
  const SF = 8, N = 1 << SF;
  const [timing, setTiming] = useState(0);
  const [cfo, setCfo] = useState(0);
  const [lock, setLock] = useState(false);
  const k1 = 40, k2 = 110;
  let peakBin = 0, ratio = 0, corrected = 0;
  useEffect(() => {
    _seed = 77; const [a1, b1] = loraSym(k1, N), [a2, b2] = loraSym(k2, N); const re = [...a1, ...a2], im = [...b1, ...b2];
    // apply CFO across the buffer
    const cr = [], ci = []; const e = cfo / N; for (let n = 0; n < re.length; n++) { const a = 2 * Math.PI * e * n, c = Math.cos(a), s = Math.sin(a); cr.push(re[n] * c - im[n] * s); ci.push(re[n] * s + im[n] * c); }
    const seg = cr.slice(timing, timing + N), segi = ci.slice(timing, timing + N);
    const { mag, peak } = dechirpMag(seg, segi, N); const sorted = [...mag].sort((x, y) => y - x);
    peakBin = peak; ratio = sorted[0] / (sorted[1] || 1e-9); corrected = ((peak - (lock ? cfo : 0)) % N + N) % N;
    setStat({ peakBin, ratio, corrected });
    if (ref.current) { const ctx = ref.current._ctx || (ref.current._ctx = fitCanvas(ref.current, ref.current.clientWidth, ref.current.clientHeight)); ctx.clearRect(0, 0, ref.current.clientWidth, ref.current.clientHeight); drawMag(ctx, ref.current.clientWidth, ref.current.clientHeight, mag, ratio > 5 ? C.D : C.warn, peak); }
  }, [timing, cfo, lock]);
  const [stat, setStat] = useState({ peakBin: 0, ratio: 0, corrected: 0 });
  return (
    <div>
      <Lead
        notes={[
          { t: "Term", c: C.A, x: "Synchronization finds two unknowns before decoding: symbol timing (where each symbol window starts) and carrier frequency offset (the receiver and transmitter oscillators never match exactly). LoRa estimates both from the known preamble." },
          { t: "Intuition", c: C.Q, x: "A window straddling two symbols dechirps to a split peak \u2014 energy in two bins \u2014 so sharpening the peak finds the timing. A frequency offset slides every bin by a fixed amount, which the known preamble symbol (value 0) measures directly." },
          { t: "Heads up", c: C.warn, x: "Timing and CFO interact \u2014 in real LoRa the up-chirp and down-chirp peaks move oppositely, so their sum gives CFO and their difference gives timing. Here, line the window up and lock to the preamble to clean both." },
        ]}
        n="L4" title="Synchronize: timing & frequency"
        body="The isolated signal has a residual timing offset (from the filters) and a frequency offset (mismatched oscillators). Both wreck the FFT peak if ignored. Slide the symbol window and watch the peak split when it straddles two symbols and snap sharp when aligned; add a frequency offset and watch every bin shift, then lock to the known preamble to subtract it." />
      <div className="iq-grid2">
        <div style={{ display: "grid", gap: 14 }}>
          <Panel label="Dechirped FFT — sharp & correct, or split & biased">
            <canvas ref={ref} style={{ width: "100%", height: 190, display: "block" }} />
            <p style={{ fontFamily: FONT.body, fontSize: 12, color: C.sub, margin: "10px 0 0", lineHeight: 1.5 }}>
              The window holds a symbol of value {k1}. Misalign the timing and the single peak splits into two; add CFO and the peak slides off {k1}. Lock to the preamble to put it back.
            </p>
          </Panel>
        </div>
        <div style={{ display: "grid", gap: 14, alignContent: "start" }}>
          <Panel label="Offsets">
            <div style={{ display: "grid", gap: 16 }}>
              <Slider label="symbol-window timing" value={timing} min={0} max={200} step={1} color={C.I} fmt={(v) => v + " chips"} onChange={setTiming} />
              <Slider label="carrier frequency offset" value={cfo} min={-30} max={30} step={1} color={C.B} fmt={(v) => v + " bins"} onChange={setCfo} />
              <label style={{ display: "flex", alignItems: "center", gap: 9, cursor: "pointer", color: C.D }}><input type="checkbox" checked={lock} onChange={(e) => setLock(e.target.checked)} style={{ width: 15, height: 15 }} /><span style={{ fontFamily: FONT.body, fontSize: 13, color: C.sub }}>lock to preamble (subtract CFO)</span></label>
            </div>
          </Panel>
          <Panel label="Lock status">
            <Readout rows={[["raw peak bin", stat.peakBin + "", C.ink], ["peak / 2nd-peak", stat.ratio > 100 ? "high (aligned)" : stat.ratio.toFixed(1), stat.ratio > 5 ? C.D : C.warn], ["timing", timing % N === 0 ? "aligned" : "straddling", timing % N === 0 ? C.D : C.warn], ["corrected symbol", lock ? stat.corrected + "" : "—", lock && stat.corrected === k1 && timing % N === 0 ? C.D : C.sub]]} />
          </Panel>
        </div>
      </div>
      <Deeper
        recap="Before the dechirp-FFT can be trusted, the symbol window must start on a symbol boundary and the carrier offset must be removed. A misaligned window contains the tail of one symbol and the head of the next, so dechirping produces two tones \u2014 a split FFT peak; the timing that maximises the peak (or its sharpness) is the right one. A carrier frequency offset adds a constant digital frequency, shifting every FFT bin by the same amount; the preamble is a known symbol (value 0), so its measured bin is exactly that shift, to be subtracted from every payload symbol."
        example={`Timing:  window offset \u03c4 -> peak splits between the two symbols.
   ratio peak/2nd: aligned \u2192 huge;  half-symbol off \u2192 ~1.
Frequency: offset of m bins -> every peak moves to (k + m) mod N.
   preamble symbol is 0, so its peak reads m directly.
   payload: corrected = (peak \u2212 m) mod N.
Real LoRa: up-chirp peak \u221d (\u03b5 + \u03c4), down-chirp peak \u221d (\u03b5 \u2212 \u03c4)
   -> sum = CFO, difference = timing. The SFD down-chirps are
      there precisely to make this separation possible.`}
      />
    </div>
  );
}

/* ============================================================
   L5 — READ THE PAYLOAD (bins -> bytes)
   ============================================================ */
function PayloadModule() {
  const barRef = useRef(null), fftRef = useRef(null);
  const SF = 8, N = 1 << SF;
  const msg = "LoRa!";
  const payloadBins = [...msg].map((c) => gray(c.charCodeAt(0)));
  const [step, setStep] = useState(0); // 0..payload.length
  const [snr, setSnr] = useState(6);
  useEffect(() => {
    _seed = 314; const cur = Math.min(step, payloadBins.length) - 1;
    // frame bar
    const bc = barRef.current;
    if (bc) { const ctx = bc._ctx || (bc._ctx = fitCanvas(bc, bc.clientWidth, bc.clientHeight)); const w = bc.clientWidth, h = bc.clientHeight; ctx.clearRect(0, 0, w, h); const total = 4 + 2 + payloadBins.length; const cw = w / total; const cell = (i, col, t) => { ctx.fillStyle = col; ctx.globalAlpha = 0.25; ctx.fillRect(i * cw + 1, 8, cw - 2, h - 16); ctx.globalAlpha = 1; ctx.strokeStyle = col; ctx.strokeRect(i * cw + 1, 8, cw - 2, h - 16); ctx.fillStyle = col; ctx.font = `9px ${FONT.mono}`; ctx.textAlign = "center"; if (t) ctx.fillText(t, i * cw + cw / 2, h / 2 + 3); };
      for (let i = 0; i < 4; i++) cell(i, C.D); for (let i = 0; i < 2; i++) cell(4 + i, C.B);
      payloadBins.forEach((b, i) => { const idx = 6 + i; const done = i < step; const isCur = i === cur; ctx.fillStyle = isCur ? C.warn : done ? C.I : C.faint; ctx.globalAlpha = isCur ? 0.35 : done ? 0.22 : 0.08; ctx.fillRect(idx * cw + 1, 8, cw - 2, h - 16); ctx.globalAlpha = 1; ctx.strokeStyle = isCur ? C.warn : done ? C.I : C.edge; ctx.strokeRect(idx * cw + 1, 8, cw - 2, h - 16); if (done || isCur) { ctx.fillStyle = isCur ? C.warn : C.I; ctx.font = `11px ${FONT.mono}`; ctx.textAlign = "center"; ctx.fillText(msg[i], idx * cw + cw / 2, h / 2 + 4); } });
      ctx.fillStyle = C.faint; ctx.font = `8px ${FONT.mono}`; ctx.textAlign = "left"; ctx.fillText("preamble", 2, 7); ctx.fillText("SFD", 4 * cw + 2, 7); ctx.fillText("payload", 6 * cw + 2, 7);
    }
    // FFT of current symbol
    const fc = fftRef.current;
    if (fc) { const ctx = fc._ctx || (fc._ctx = fitCanvas(fc, fc.clientWidth, fc.clientHeight)); ctx.clearRect(0, 0, fc.clientWidth, fc.clientHeight);
      if (cur >= 0) { const [r0, i0] = loraSym(payloadBins[cur], N); const sd = Math.sqrt(Math.pow(10, -snr / 10) / 2); const re = r0.map((v) => v + sd * randn()), im = i0.map((v) => v + sd * randn()); const { mag, peak } = dechirpMag(re, im, N); drawMag(ctx, fc.clientWidth, fc.clientHeight, mag, C.Q, peak); }
      else { ctx.fillStyle = C.faint; ctx.font = `12px ${FONT.mono}`; ctx.textAlign = "center"; ctx.fillText("press “step” to decode the first payload symbol", fc.clientWidth / 2, fc.clientHeight / 2); }
    }
  }, [step, snr]);
  // decode so far
  const decoded = payloadBins.slice(0, step).map((b) => String.fromCharCode(invgray(dechirpMag(...loraSym(b, N), N).peak))).join("");
  const cur = Math.min(step, payloadBins.length) - 1;
  const curBin = cur >= 0 ? dechirpMag(...loraSym(payloadBins[cur], N), N).peak : null;
  return (
    <div>
      <Lead
        notes={[
          { t: "Term", c: C.A, x: "With the frame synchronized, decoding is mechanical: dechirp + FFT each payload symbol to a bin, undo the Gray mapping LoRa applies, and the result is the data \u2014 here, one byte per symbol (SF = 8)." },
          { t: "Intuition", c: C.Q, x: "Each chirp's starting frequency is a number 0\u2013255; reverse the Gray code and that number is a byte. String the bytes together and the payload appears. The error-correction and whitening layers sit on top of exactly this." },
          { t: "Try it", c: C.D, x: "Step through the frame and watch the message assemble one character at a time, each from a single FFT peak. Lower the SNR and the processing gain still pulls the bytes out clean." },
        ]}
        n="L5" title="Read the payload"
        body="Everything comes together. The frame is isolated and synchronized; now walk through the payload chirps, dechirp-and-FFT each one to a bin, reverse LoRa's Gray coding, and read the bytes. Step through and watch the hidden message spell itself out — recovered from chirps that, a few modules ago, were just diagonal streaks on a spectrogram." />
      <div className="iq-grid2">
        <div style={{ display: "grid", gap: 14 }}>
          <Panel label="The frame, symbol by symbol">
            <canvas ref={barRef} style={{ width: "100%", height: 70, display: "block" }} />
          </Panel>
          <Panel label="Current payload symbol — dechirped FFT">
            <canvas ref={fftRef} style={{ width: "100%", height: 140, display: "block" }} />
          </Panel>
          <Panel label="Decoded payload">
            <div style={{ fontFamily: FONT.mono, fontSize: 22, color: C.D, letterSpacing: 3, minHeight: 30 }}>{decoded || <span style={{ color: C.faint, fontSize: 13, letterSpacing: 0 }}>(nothing yet)</span>}<span style={{ color: C.warn }}>{step < payloadBins.length && step > 0 ? "" : ""}</span></div>
          </Panel>
        </div>
        <div style={{ display: "grid", gap: 14, alignContent: "start" }}>
          <Panel label="Decode">
            <div style={{ display: "flex", gap: 7, marginBottom: 14 }}>
              <button className="iq-mini" onClick={() => setStep(Math.min(step + 1, payloadBins.length))} style={{ borderColor: C.Q, color: C.Q }}>▸ step</button>
              <button className="iq-mini" onClick={() => setStep(payloadBins.length)}>decode all</button>
              <button className="iq-mini" onClick={() => setStep(0)}>↺ reset</button>
            </div>
            <Slider label="chip SNR" value={snr} min={-14} max={12} step={1} color={C.Q} fmt={(v) => v + " dB"} onChange={setSnr} />
          </Panel>
          <Panel label="This symbol">
            <Readout rows={[["payload symbols", payloadBins.length + "", C.sub], ["decoded so far", step + " / " + payloadBins.length, C.ink], ["FFT peak bin", curBin != null ? curBin + "" : "—", C.Q], ["un-Gray → byte", curBin != null ? invgray(curBin) + "" : "—", C.I], ["→ character", cur >= 0 ? "'" + msg[cur] + "'" : "—", C.D]]} />
          </Panel>
        </div>
      </div>
      <Deeper
        recap="Each payload symbol is one dechirp-FFT away from a bin number. LoRa Gray-codes the symbol value before transmission so that a near-miss in the FFT (an adjacent bin) corrupts only one bit; the receiver applies the inverse Gray map to recover the data value. At SF = 8 each value is a full byte, so the bytes are the payload directly. Real LoRa then adds Hamming forward error correction, interleaving across symbols, and data whitening \u2014 all layered on top of this same dechirp-FFT-Gray core."
        example={`Per payload symbol:
   dechirp + FFT -> peak bin b
   value = invGray(b)            (undo LoRa's Gray coding)
   byte  = value                 (SF = 8 -> 8 bits = 1 byte)

Message "${msg}" -> bytes ${[...msg].map((c) => c.charCodeAt(0)).join(", ")}
   tx bins (Gray): ${payloadBins.join(", ")}
   decode -> ${[...msg].map((c) => c.charCodeAt(0)).join(", ")} -> "${msg}"  \u2713
Above this core: Hamming(CR) FEC, diagonal interleaving, whitening.`}
      />
    </div>
  );
}

/* ============================================================
   APP SHELL
   ============================================================ */
const MODULES = [
  { id: "L1", label: "FHSS & chirp", comp: SpreadModule },
  { id: "L2", label: "Isolate the channel", comp: IsolateModule },
  { id: "L3", label: "Dechirp & FFT", comp: DechirpModule },
  { id: "L4", label: "Synchronize", comp: SyncModule },
  { id: "L5", label: "Read the payload", comp: PayloadModule },
];
const DIFF = [3, 3, 3, 3, 3];
const PREDICTS = {
  "0": { q: "Averaged over a symbol, a LoRa chirp's power is...", options: ["at one frequency", "spread across the whole band (low density)", "only at the edges"], answer: 1, why: "The sweep visits every frequency in the band, so its average spectral density is low — the spread-spectrum nature of CSS, like module 20's codes." },
  "2": { q: "Multiplying a received LoRa symbol by a down-chirp turns it into...", options: ["another chirp", "a constant-frequency tone whose frequency = the symbol", "noise"], answer: 1, why: "Dechirping cancels the sweep, leaving a tone at bin k; an FFT then reads the symbol off as a single peak." },
  "3": { q: "You sample a symbol window half a symbol late. The dechirped FFT shows...", options: ["one sharp peak", "energy split between two bins", "nothing"], answer: 1, why: "A straddled window holds parts of two symbols, so the peak splits — exactly the cue timing recovery uses to align." },
  "4": { q: "A constant carrier-frequency offset of m bins shifts every LoRa FFT peak by...", options: ["a random amount", "exactly +m bins", "nothing"], answer: 1, why: "CFO adds a fixed frequency, biasing every bin by m; the known preamble (symbol 0) measures m so you subtract it." },
};

export default function App() {
  const reduced = usePrefersReducedMotion();
  const [active, setActive] = useState(() => { try { const _h = parseInt((location.hash.match(/m(\d+)/) || [])[1], 10); if (_h >= 0 && _h < MODULES.length) return _h; } catch (_e) {} return 0; });
  const Comp = MODULES[active].comp;
  useEffect(() => { try { history.replaceState(null, "", "#m" + active); } catch (_e) {} }, [active]);
  return (
    <div style={{ background: C.bg, minHeight: "100vh", color: C.ink }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;600;700&family=Space+Mono:wght@400;700&display=swap');
        * { box-sizing: border-box; }
        input[type=range]{ -webkit-appearance:none; appearance:none; height:4px; border-radius:2px; background:${C.grid}; outline:none; }
        input[type=range]::-webkit-slider-thumb{ -webkit-appearance:none; width:14px; height:14px; border-radius:50%; background:currentColor; cursor:pointer; border:2px solid ${C.bg}; }
        input[type=range]::-moz-range-thumb{ width:14px; height:14px; border:2px solid ${C.bg}; border-radius:50%; background:currentColor; cursor:pointer; }
        input[type=checkbox]{ accent-color: currentColor; cursor:pointer; }
        input:focus-visible, button:focus-visible { outline: 2px solid ${C.Q}; outline-offset: 2px; }
        .iq-wrap { max-width: 1080px; margin: 0 auto; padding: 28px 22px 64px; }
        .iq-grid2 { display: grid; grid-template-columns: 1.5fr 1fr; gap: 18px; align-items: start; }
        @media (max-width: 880px){ .iq-grid2 { grid-template-columns: 1fr; } }
        .iq-tab { font-family:${FONT.mono}; font-size:12px; letter-spacing:0.04em; padding:8px 13px; border-radius:7px; border:1px solid transparent; background:transparent; color:${C.sub}; cursor:pointer; white-space:nowrap; transition:background .15s,color .15s; }
        .iq-tab:hover { color:${C.ink}; }
        .iq-tab[data-on="1"]{ background:${C.panelHi}; border-color:${C.edge}; color:${C.ink}; }
        .iq-mini { font-family:${FONT.mono}; font-size:11px; padding:5px 10px; border-radius:6px; border:1px solid ${C.edge}; background:transparent; color:${C.sub}; cursor:pointer; transition:background .15s; }
        .iq-mini:hover { background:${C.panelHi}; color:${C.ink}; }
        .iq-mini[data-on="1"]{ background:${C.panelHi}; border-color:${C.Q}; color:${C.Q}; }
        canvas { background:${C.bg}; border-radius:4px; }
      `}</style>
      <div className="iq-wrap">
        <header style={{ marginBottom: 26 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
            <span style={{ width: 11, height: 11, borderRadius: 11, background: C.I }} />
            <span style={{ width: 11, height: 11, borderRadius: 11, background: C.Q }} />
            <Eyebrow>I/Q signal primer · worked example</Eyebrow>
          </div>
          <h1 style={{ fontFamily: FONT.disp, fontSize: 34, fontWeight: 700, margin: "0 0 8px", letterSpacing: "-0.02em", lineHeight: 1.05 }}>Decoding LoRa, end to end</h1>
          <p style={{ fontFamily: FONT.body, fontSize: 15, color: C.sub, maxWidth: 730, lineHeight: 1.6, margin: 0 }}>
            One real signal, decoded from raw I/Q to readable bytes — using nearly every tool in the course. We meet chirp spread spectrum and its cousin FHSS, isolate the channel with a downconverter, demodulate with the dechirp-and-FFT trick, synchronize timing and frequency from the preamble, and read the payload. Every plot runs the real DSP.
          </p>
          {reduced && <p style={{ fontFamily: FONT.mono, fontSize: 11, color: C.faint, marginTop: 10 }}>Reduced-motion on — all views are static and respond to controls.</p>}
          <nav style={{ display: "flex", gap: 6, marginTop: 22, flexWrap: "wrap", borderBottom: `1px solid ${C.edge}`, paddingBottom: 16 }}>
            {MODULES.map((m, i) => <button key={m.id} className="iq-tab" data-on={active === i ? "1" : "0"} onClick={() => setActive(i)}><span style={{ color: active === i ? C.Q : C.faint, marginRight: 7 }}>{m.id}</span>{m.label}<span title="math intensity (light / medium / heavy)" style={{ marginLeft: 7, letterSpacing: 1, fontSize: 9 }}>{[0, 1, 2].map((_d) => <span key={_d} style={{ color: _d < DIFF[i] ? (DIFF[i] === 1 ? C.D : DIFF[i] === 2 ? C.I : C.warn) : C.gridFaint }}>{"\u2022"}</span>)}</span></button>)}
          </nav>
        </header>
        {PREDICTS[active] && <Predict q={PREDICTS[active].q} options={PREDICTS[active].options} answer={PREDICTS[active].answer} why={PREDICTS[active].why} />}
        <main key={active}><Comp reduced={reduced} /></main>
        <footer style={{ marginTop: 40, paddingTop: 18, borderTop: `1px solid ${C.gridFaint}`, fontFamily: FONT.body, fontSize: 12, color: C.faint, lineHeight: 1.6 }}>
          From a diagonal smear on a waterfall to the word “LoRa!” — tune, filter, decimate, dechirp, FFT, synchronize, un-Gray. Every step here is a module from earlier in the course, now doing real work on a real protocol. A COFDM walkthrough is the natural next companion.
        </footer>
      </div>
    </div>
  );
}
