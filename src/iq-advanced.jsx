import { useState, useRef, useEffect } from "react";

/* ============================================================
   I/Q PRIMER · ADVANCED  (Part 5 — when the channel fights back)
   FEC & coding gain, multipath/delay-spread/ISI -> the cyclic
   prefix, channel equalization (ZF vs MMSE), and spread
   spectrum / CDMA. Every plot runs the real algorithm.
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
let _seed = 7777;
const rand = () => { _seed = (_seed * 1103515245 + 12345) & 0x7fffffff; return _seed / 0x7fffffff; };
const randn = () => { let u = 0, v = 0; while (u === 0) u = rand(); while (v === 0) v = rand(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };
function erfc(x) { const z = Math.abs(x), t = 1 / (1 + 0.3275911 * z); const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-z * z); return 1 - (x >= 0 ? y : -y); }
const Qf = (x) => 0.5 * erfc(x / Math.SQRT2);
// radix-2 FFT (n power of 2)
function fft(re, im) {
  const n = re.length; if (n <= 1) return [re, im];
  const er = [], ei = [], or_ = [], oi = [];
  for (let i = 0; i < n; i += 2) { er.push(re[i]); ei.push(im[i]); or_.push(re[i + 1]); oi.push(im[i + 1]); }
  const [Er, Ei] = fft(er, ei), [Or, Oi] = fft(or_, oi); const Re = new Array(n), Im = new Array(n);
  for (let k = 0; k < n / 2; k++) { const a = -2 * Math.PI * k / n, c = Math.cos(a), s = Math.sin(a); const tr = c * Or[k] - s * Oi[k], ti = s * Or[k] + c * Oi[k]; Re[k] = Er[k] + tr; Im[k] = Ei[k] + ti; Re[k + n / 2] = Er[k] - tr; Im[k + n / 2] = Ei[k] - ti; }
  return [Re, Im];
}
function freqResp(taps, N) { const re = Array(N).fill(0), im = Array(N).fill(0); taps.forEach((v, i) => { if (i < N) re[i] = v; }); return fft(re, im); }
// Hamming(7,4)
const henc = (m) => { const [a, b, c, d] = m; return [a, b, c, d, a ^ b ^ d, a ^ c ^ d, b ^ c ^ d]; };
const HSYN = { 6: 0, 5: 1, 3: 2, 7: 3, 4: 4, 2: 5, 1: 6 };
function hdec(r) { const s1 = r[0] ^ r[1] ^ r[3] ^ r[4], s2 = r[0] ^ r[2] ^ r[3] ^ r[5], s3 = r[1] ^ r[2] ^ r[3] ^ r[6]; const s = s1 * 4 + s2 * 2 + s3; let rr = r.slice(); if (s && HSYN[s] !== undefined) rr[HSYN[s]] ^= 1; return [rr[0], rr[1], rr[2], rr[3]]; }
function hadamard(n) { if (n === 1) return [[1]]; const h = hadamard(n / 2), H = []; for (let i = 0; i < n; i++) { H[i] = []; for (let j = 0; j < n; j++) { const a = h[i % (n / 2)][j % (n / 2)]; H[i][j] = (i >= n / 2 && j >= n / 2) ? -a : a; } } return H; }

/* ---------- atoms ---------- */
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

/* shared draw helpers */
function axes(ctx, w, h, pad) { ctx.strokeStyle = C.gridFaint; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(pad.l, h - pad.b); ctx.lineTo(w - pad.r, h - pad.b); ctx.stroke(); }
function drawCurve(ctx, w, h, arr, color, pad, vmin, vmax, fill) {
  const x0 = pad.l, x1 = w - pad.r, y0 = pad.t, y1 = h - pad.b; ctx.strokeStyle = color; ctx.lineWidth = 1.8; ctx.beginPath();
  arr.forEach((v, i) => { const x = x0 + (i / (arr.length - 1)) * (x1 - x0), y = y1 - ((v - vmin) / (vmax - vmin)) * (y1 - y0); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); }); ctx.stroke();
  if (fill) { ctx.lineTo(x1, y1); ctx.lineTo(x0, y1); ctx.closePath(); ctx.globalAlpha = 0.08; ctx.fillStyle = color; ctx.fill(); ctx.globalAlpha = 1; }
}

/* ============================================================
   MODULE 17 — FEC & CODING GAIN
   ============================================================ */
function berHamming(ebnoDb, T) { const R = 4 / 7, sd = Math.sqrt(1 / (2 * R * Math.pow(10, ebnoDb / 10))); let be = 0, nb = 0; for (let i = 0; i < T; i++) { const m = [rand() < .5 ? 1 : 0, rand() < .5 ? 1 : 0, rand() < .5 ? 1 : 0, rand() < .5 ? 1 : 0]; const r = henc(m).map((b) => ((b ? 1 : -1) + sd * randn() > 0 ? 1 : 0)); const dd = hdec(r); for (let k = 0; k < 4; k++) if (dd[k] !== m[k]) be++; nb += 4; } return be / nb; }
const uncoded = (e) => Qf(Math.sqrt(2 * Math.pow(10, e / 10)));
function FECModule() {
  const ref = useRef(null);
  const [cursor, setCursor] = useState(8);
  const [msg, setMsg] = useState([1, 0, 1, 1]);
  const [flip, setFlip] = useState(-1);
  const data = useRef(null); const [ver, setVer] = useState(0);
  useEffect(() => { _seed = 4242; const snrs = []; for (let e = 0; e <= 12; e++) snrs.push(e); const mc = snrs.map((e) => berHamming(e, 40000)); data.current = { snrs, mc }; setVer((v) => v + 1); }, []);
  useEffect(() => {
    const d = data.current; if (!d) return; const cv = ref.current; if (!cv) return; const ctx = cv._ctx || (cv._ctx = fitCanvas(cv, cv.clientWidth, cv.clientHeight));
    const w = cv.clientWidth, h = cv.clientHeight, pl = 38, pr = 10, pt = 10, pb = 26, x0 = pl, x1 = w - pr, y0 = pt, y1 = h - pb, EMAX = 12, top = 0, bot = -5;
    ctx.clearRect(0, 0, w, h); const xOf = (e) => x0 + (e / EMAX) * (x1 - x0), yOf = (b) => { const L = Math.log10(Math.max(b, 1e-6)); return y0 + (top - L) / (top - bot) * (y1 - y0); };
    ctx.strokeStyle = C.gridFaint; ctx.fillStyle = C.faint; ctx.font = `9px ${FONT.mono}`; ctx.textAlign = "right";
    for (let dec = 0; dec >= -5; dec--) { const y = yOf(Math.pow(10, dec)); ctx.beginPath(); ctx.moveTo(x0, y); ctx.lineTo(x1, y); ctx.stroke(); ctx.fillText("1e" + dec, x0 - 4, y + 3); }
    ctx.textAlign = "center"; for (let e = 0; e <= EMAX; e += 2) { const x = xOf(e); ctx.beginPath(); ctx.moveTo(x, y0); ctx.lineTo(x, y1); ctx.stroke(); ctx.fillText(e + "", x, y1 + 13); }
    ctx.fillText("Eb/N0 (dB) \u2192", (x0 + x1) / 2, h - 3);
    const xc = xOf(cursor); ctx.strokeStyle = C.edge; ctx.setLineDash([4, 3]); ctx.beginPath(); ctx.moveTo(xc, y0); ctx.lineTo(xc, y1); ctx.stroke(); ctx.setLineDash([]);
    ctx.strokeStyle = C.sub; ctx.lineWidth = 1.8; ctx.beginPath(); for (let e = 0; e <= EMAX; e += 0.25) { const x = xOf(e), y = yOf(uncoded(e)); e ? ctx.lineTo(x, y) : ctx.moveTo(x, y); } ctx.stroke();
    ctx.fillStyle = C.D; d.snrs.forEach((e, i) => { const b = d.mc[i]; if (b > 0) { ctx.beginPath(); ctx.arc(xOf(e), yOf(b), 2.6, 0, 7); ctx.fill(); } });
    ctx.font = `10px ${FONT.mono}`; ctx.textAlign = "left"; ctx.fillStyle = C.sub; ctx.fillText("— uncoded BPSK", x1 - 120, y0 + 11); ctx.fillStyle = C.D; ctx.fillText("● Hamming(7,4)", x1 - 120, y0 + 24);
  }, [cursor, ver]);
  const cw = henc(msg), r = cw.map((b, i) => (i === flip ? b ^ 1 : b));
  const s1 = r[0] ^ r[1] ^ r[3] ^ r[4], s2 = r[0] ^ r[2] ^ r[3] ^ r[5], s3 = r[1] ^ r[2] ^ r[3] ^ r[6], syn = s1 * 4 + s2 * 2 + s3, pos = syn ? HSYN[syn] : -1;
  const di = data.current; const ci = di ? di.mc[Math.round(cursor)] : 0;
  return (
    <div>
      <Lead
        notes={[
          { t: "Term", c: C.A, x: "Forward error correction adds structured redundancy (parity bits) so the receiver can detect and fix some errors with no retransmission. Hamming(7,4) sends 4 data bits as 7 and fixes any single-bit error in the block." },
          { t: "Intuition", c: C.Q, x: "Coding gain is the SNR you save: the horizontal gap between the coded and uncoded BER curves at a target error rate. It buys reliability for the price of rate and a little complexity." },
          { t: "Heads up", c: C.warn, x: "Spending energy on parity only pays off below a crossover BER. Above it the rate penalty makes simple codes worse \u2014 which is why real systems use far stronger codes (convolutional, LDPC, turbo) that approach the Shannon limit." },
        ]}
        n="17" title="Forward error correction & coding gain"
        body="The BER curve from Foundations sets the cost of reliability in raw SNR. Coding changes the deal: add parity bits and the receiver can repair errors, shifting the whole curve left. Watch a real Hamming(7,4) code locate and fix a bit error from its syndrome, and see the coding gain it earns against the uncoded curve." />
      <div className="iq-grid2">
        <div style={{ display: "grid", gap: 14 }}>
          <Panel label="Coded vs uncoded BER — live Monte-Carlo">
            <canvas ref={ref} style={{ width: "100%", height: 280, display: "block" }} />
            <p style={{ fontFamily: FONT.body, fontSize: 12.5, color: C.sub, margin: "10px 0 0", lineHeight: 1.5 }}>
              The green dots are a real Hamming(7,4) link decoded by syndrome. They cross under the uncoded curve around 6 dB; below that the parity overhead costs more than it saves.
            </p>
          </Panel>
        </div>
        <div style={{ display: "grid", gap: 14, alignContent: "start" }}>
          <Panel label="Hamming(7,4): break it, watch it heal">
            <div style={{ display: "flex", gap: 6, justifyContent: "center", marginBottom: 10 }}>
              {r.map((b, i) => { const isMsg = i < 4, err = i === flip, fixed = i === pos; return (
                <button key={i} onClick={() => setFlip(flip === i ? -1 : i)} title="click to inject / clear a bit error" style={{ width: 34, height: 40, borderRadius: 7, border: `1.5px solid ${err ? C.warn : fixed ? C.D : C.edge}`, background: err ? "#2a1820" : fixed ? "#15241c" : C.bg, color: isMsg ? C.I : C.A, fontFamily: FONT.mono, fontSize: 16, cursor: "pointer", position: "relative" }}>{b}<span style={{ position: "absolute", bottom: 2, left: 0, right: 0, fontSize: 7, color: C.faint }}>{isMsg ? "d" + (i + 1) : "p" + (i - 3)}</span></button>
              ); })}
            </div>
            <div style={{ display: "flex", gap: 7, justifyContent: "center", marginBottom: 12 }}>
              <button className="iq-mini" onClick={() => { setMsg([rand() < .5 ? 1 : 0, rand() < .5 ? 1 : 0, rand() < .5 ? 1 : 0, rand() < .5 ? 1 : 0]); setFlip(-1); }}>random message</button>
              <button className="iq-mini" onClick={() => setFlip(-1)}>clear error</button>
            </div>
            <Readout rows={[["amber = data, violet = parity", "4 + 3 = 7", C.sub], ["syndrome (s1 s2 s3)", `${s1} ${s2} ${s3}`, syn ? C.warn : C.D], ["diagnosis", syn ? "error at bit " + (pos + 1) : "no error", syn ? C.warn : C.D], ["decoded message", hdec(r).join(""), hdec(r).join("") === msg.join("") ? C.D : C.warn]]} />
            <p style={{ fontFamily: FONT.body, fontSize: 12, color: C.sub, margin: "11px 0 0", lineHeight: 1.5 }}>
              Flip any single bit: the syndrome (3 parity checks) reads out a nonzero pattern that points straight at the broken bit, and the decoder flips it back. Two errors, though, would fool it.
            </p>
          </Panel>
          <Panel label="At the cursor">
            <Readout rows={[["Eb/N0", cursor.toFixed(0) + " dB", C.ink], ["uncoded BER", uncoded(cursor).toExponential(1), C.sub], ["Hamming(7,4) BER", ci != null ? (ci > 0 ? ci.toExponential(1) : "<2e-4 (floor)") : "…", C.D]]} />
            <Slider label="Eb/N0 cursor" value={cursor} min={0} max={12} step={1} color={C.ink} fmt={(v) => v.toFixed(0) + " dB"} onChange={setCursor} />
          </Panel>
        </div>
      </div>
      <Deeper
        recap="A block code maps k data bits to n > k coded bits; the extra n\u2212k bits are parity that constrain which words are legal, so an error lands on an illegal word the decoder can often correct. Hamming(7,4) places 3 parity bits so any single-bit error produces a unique 3-bit syndrome pointing at the culprit. Because only 4 of every 7 transmitted bits are data, each coded bit carries 4/7 of the energy \u2014 the rate penalty \u2014 so coding gain only appears once correction outweighs that loss, at low BER. Stronger codes win much more."
        example={`Hamming(7,4): message m, parity p1=m1^m2^m4, p2=m1^m3^m4, p3=m2^m3^m4.
   send  [m1 m2 m3 m4 p1 p2 p3]
   syndrome at RX: 3 parity re-checks -> 3 bits.
        000 -> no error;  any other -> the bit to flip.

Energy bookkeeping (rate R = 4/7):
   each coded bit gets Ec = R\u00b7Eb, so channel BER p = Q(\u221a(2\u00b7R\u00b7Eb/N0))
   block fails only if \u2265 2 of 7 bits flip.
   -> crossover near 6 dB; ~0.5-1 dB gain by BER 1e-5 (modest, but free
      every packet). LDPC/turbo codes reach within ~1 dB of Shannon.`}
      />
    </div>
  );
}

/* ============================================================
   MODULE 18 — MULTIPATH, DELAY SPREAD & ISI  (-> cyclic prefix)
   ============================================================ */
function MultipathModule() {
  const tapRef = useRef(null), hRef = useRef(null);
  const [g2, setG2] = useState(0.6);
  const [g3, setG3] = useState(0.3);
  const [d3, setD3] = useState(4);
  const [cp, setCp] = useState(true);
  const N = 32;
  const taps = (() => { const t = Array(d3 + 1).fill(0); t[0] = 1; t[2] = g2; t[d3] = g3; return t; })();
  const [HR, HI] = freqResp(taps, N); const Hmag = HR.map((re, k) => Math.hypot(re, HI[k]));
  // cyclic-prefix identity error
  const iciErr = (() => {
    _seed = 9001; const Xr = Array.from({ length: N }, () => rand() < .5 ? 1 : -1), Xi = Array.from({ length: N }, () => rand() < .5 ? 1 : -1);
    // ifft
    const [ar, ai] = fft(Xr, Xi.map((x) => -x)); const xr = ar.map((x) => x / N), xi = ai.map((x) => -x / N);
    const L = taps.length - 1; let sigR, sigI;
    if (cp) { sigR = [...xr.slice(N - L), ...xr]; sigI = [...xi.slice(N - L), ...xi]; } else { sigR = xr.slice(); sigI = xi.slice(); }
    const yr = Array(sigR.length + taps.length - 1).fill(0), yi = Array(sigR.length + taps.length - 1).fill(0);
    for (let n = 0; n < sigR.length; n++) for (let k = 0; k < taps.length; k++) { yr[n + k] += taps[k] * sigR[n]; yi[n + k] += taps[k] * sigI[n]; }
    const off = cp ? L : 0; const rr = yr.slice(off, off + N), ri = yi.slice(off, off + N); const [YR, YI] = fft(rr, ri);
    let mx = 0; for (let k = 0; k < N; k++) { const er = HR[k] * Xr[k] - HI[k] * Xi[k], ei = HR[k] * Xi[k] + HI[k] * Xr[k]; mx = Math.max(mx, Math.hypot(YR[k] - er, YI[k] - ei)); } return mx;
  })();
  useEffect(() => {
    const tc = tapRef.current;
    if (tc) {
      const ctx = tc._ctx || (tc._ctx = fitCanvas(tc, tc.clientWidth, tc.clientHeight)); const w = tc.clientWidth, h = tc.clientHeight, base = h - 22, pl = 8, span = w - 20; ctx.clearRect(0, 0, w, h);
      // symbol-boundary shading: one symbol period = (assume) 2 samples wide region marker at delay where echoes spill
      ctx.strokeStyle = C.gridFaint; ctx.beginPath(); ctx.moveTo(pl, base); ctx.lineTo(w - 8, base); ctx.stroke();
      taps.forEach((v, i) => { if (Math.abs(v) < 1e-9) return; const x = pl + (i / 12) * span, y = base - v * (base - 14); ctx.strokeStyle = i === 0 ? C.D : C.B; ctx.lineWidth = 2.4; ctx.beginPath(); ctx.moveTo(x, base); ctx.lineTo(x, y); ctx.stroke(); ctx.fillStyle = i === 0 ? C.D : C.B; ctx.beginPath(); ctx.arc(x, y, 3.4, 0, 7); ctx.fill(); ctx.fillStyle = C.faint; ctx.font = `9px ${FONT.mono}`; ctx.textAlign = "center"; ctx.fillText("\u03c4" + i, x, base + 13); });
      ctx.fillStyle = C.faint; ctx.font = `9px ${FONT.mono}`; ctx.textAlign = "left"; ctx.fillText("direct path", pl, 12); ctx.fillStyle = C.B; ctx.fillText("echoes \u2192 spill into later symbols (ISI)", pl + 66, 12);
    }
    const hc = hRef.current;
    if (hc) {
      const ctx = hc._ctx || (hc._ctx = fitCanvas(hc, hc.clientWidth, hc.clientHeight)); const w = hc.clientWidth, h = hc.clientHeight; ctx.clearRect(0, 0, w, h);
      const pad = { l: 30, r: 8, t: 10, b: 18 }; axes(ctx, w, h, pad);
      ctx.strokeStyle = C.gridFaint; ctx.font = `9px ${FONT.mono}`; ctx.fillStyle = C.faint; ctx.textAlign = "right";
      [0, 1, 2].forEach((v) => { const y = (h - pad.b) - (v / 2) * (h - pad.b - pad.t); ctx.beginPath(); ctx.moveTo(pad.l, y); ctx.lineTo(w - pad.r, y); ctx.stroke(); ctx.fillText(v.toFixed(0), pad.l - 4, y + 3); });
      drawCurve(ctx, w, h, Hmag, C.Q, pad, 0, 2, true);
      ctx.fillStyle = C.sub; ctx.textAlign = "center"; ctx.fillText("frequency (subcarrier) \u2192", w / 2, h - 4);
    }
  }, [g2, g3, d3, cp]);
  return (
    <div>
      <Lead
        notes={[
          { t: "Term", c: C.A, x: "Multipath: the signal reaches the receiver by several routes of different length, so copies arrive at staggered delays. The spread between first and last arrival is the delay spread; together the echoes form the channel impulse response." },
          { t: "Intuition", c: C.Q, x: "Echoes mean each symbol overlaps the next \u2014 inter-symbol interference. In the frequency domain the copies add and cancel, carving deep notches: the channel is frequency-selective, kind to some frequencies and brutal to others." },
          { t: "Heads up", c: C.warn, x: "This is exactly why OFDM prepends a cyclic prefix. A guard copy longer than the delay spread turns the messy linear convolution into a clean circular one, so every subcarrier sees a single flat gain again." },
        ]}
        n="18" title="Multipath, delay spread & ISI"
        body="Outdoors and indoors, a signal bounces. Those echoes are the channel impulse response, and when its spread approaches a symbol period, symbols smear into one another — inter-symbol interference — while the spectrum sprouts deep nulls. This is the problem the cyclic prefix you met in OFDM was invented to solve; toggle it and watch the per-subcarrier math go from broken to exact." />
      <div className="iq-grid2">
        <div style={{ display: "grid", gap: 14 }}>
          <Panel label="Channel impulse response (the echoes)">
            <canvas ref={tapRef} style={{ width: "100%", height: 130, display: "block" }} />
          </Panel>
          <Panel label="Frequency response |H(f)| — notches where paths cancel">
            <canvas ref={hRef} style={{ width: "100%", height: 150, display: "block" }} />
          </Panel>
        </div>
        <div style={{ display: "grid", gap: 14, alignContent: "start" }}>
          <Panel label="The paths">
            <div style={{ display: "grid", gap: 15 }}>
              <Slider label="echo 1 gain (delay 2)" value={g2} min={0} max={0.9} step={0.05} color={C.B} fmt={(v) => v.toFixed(2)} onChange={setG2} />
              <Slider label="echo 2 gain" value={g3} min={0} max={0.9} step={0.05} color={C.B} fmt={(v) => v.toFixed(2)} onChange={setG3} />
              <Slider label="echo 2 delay (samples)" value={d3} min={3} max={10} step={1} color={C.A} fmt={(v) => v + " \u03c4"} onChange={setD3} />
            </div>
          </Panel>
          <Panel label="Cyclic prefix">
            <label style={{ display: "flex", alignItems: "center", gap: 9, cursor: "pointer", color: C.D, marginBottom: 12 }}><input type="checkbox" checked={cp} onChange={(e) => setCp(e.target.checked)} style={{ width: 15, height: 15 }} /><span style={{ fontFamily: FONT.body, fontSize: 13, color: C.sub }}>prepend a cyclic prefix (length {taps.length - 1})</span></label>
            <Readout rows={[["delay spread", (d3) + " samples", C.ink], ["deepest notch |H|", Math.min(...Hmag).toFixed(2), Math.min(...Hmag) < 0.3 ? C.warn : C.sub], ["per-subcarrier error", iciErr < 1e-9 ? "~0 (orthogonal)" : iciErr.toExponential(1), iciErr < 1e-9 ? C.D : C.warn], ["subcarriers", cp ? "clean: Y = H·X" : "leaking (ICI)", cp ? C.D : C.warn]]} />
            <p style={{ fontFamily: FONT.body, fontSize: 12, color: C.sub, margin: "11px 0 0", lineHeight: 1.5 }}>
              With the prefix on, the per-subcarrier identity holds to machine precision — the channel becomes one complex multiply per subcarrier. Turn it off and the error jumps: neighbouring subcarriers bleed together.
            </p>
          </Panel>
        </div>
      </div>
      <Deeper
        recap="Each echo is a delayed, scaled copy, so the received signal is the transmitted one convolved with the channel impulse response. Convolution in time is multiplication in frequency, and where delayed copies arrive out of phase they cancel \u2014 the notches. For single-carrier signals the overlap is ISI. OFDM sidesteps it: prepend the tail of each block as a cyclic prefix longer than the channel, and linear convolution becomes circular convolution, which the FFT diagonalizes into one gain H_k per subcarrier."
        example={`Channel taps h = [1, 0, ${g2}, 0, ${g3}] (delay spread ${d3} samples).
   |H(f)| = |FFT(h)|  -> notch depth ${Math.min(...Hmag).toFixed(2)} (paths cancel there).

Cyclic prefix of length L \u2265 (taps\u22121):
   copy last L samples of the block to the front.
   RX strips them, FFTs -> Y_k = H_k \u00b7 X_k  exactly.
   (verified error here: ${iciErr < 1e-9 ? "~1e-16" : iciErr.toExponential(1)})
Without it, energy from the previous block and wrap-around break
orthogonality, so subcarriers interfere (inter-carrier interference).`}
      />
    </div>
  );
}

/* ============================================================
   MODULE 19 — EQUALIZATION (ZF vs MMSE)
   ============================================================ */
function EqualizeModule() {
  const cBefore = useRef(null), cAfter = useRef(null), wRef = useRef(null);
  const [kind, setKind] = useState("MMSE");
  const [snr, setSnr] = useState(12);
  const N = 32;
  const taps = [1, 0, 0.7, 0, 0.45]; // fixed channel with a deepish null
  const [HR, HI] = freqResp(taps, N); const Hmag = HR.map((re, k) => Math.hypot(re, HI[k]));
  const N0 = Math.pow(10, -snr / 10);
  useEffect(() => {
    _seed = 31337; const QP = [[0.707, 0.707], [0.707, -0.707], [-0.707, 0.707], [-0.707, -0.707]];
    const before = [], after = []; let mse = 0, cnt = 0;
    for (let t = 0; t < 60; t++) for (let k = 0; k < N; k++) {
      const s = QP[(rand() * 4) | 0]; const hr = HR[k], hi = HI[k];
      const yr = hr * s[0] - hi * s[1] + Math.sqrt(N0 / 2) * randn(), yi = hr * s[1] + hi * s[0] + Math.sqrt(N0 / 2) * randn();
      const h2 = hr * hr + hi * hi; let wr, wi; if (kind === "ZF") { wr = hr / h2; wi = -hi / h2; } else { const dd = h2 + N0; wr = hr / dd; wi = -hi / dd; }
      const er = wr * yr - wi * yi, ei = wr * yi + wi * yr; before.push([yr, yi]); after.push([er, ei]); mse += (er - s[0]) ** 2 + (ei - s[1]) ** 2; cnt++;
    }
    const drawC = (cv, pts, R) => { const ctx = cv._ctx || (cv._ctx = fitCanvas(cv, cv.clientWidth, cv.clientHeight)); const w = cv.clientWidth, h = cv.clientHeight, cx = w / 2, cy = h / 2; ctx.clearRect(0, 0, w, h); ctx.strokeStyle = C.gridFaint; ctx.beginPath(); ctx.moveTo(0, cy); ctx.lineTo(w, cy); ctx.stroke(); ctx.beginPath(); ctx.moveTo(cx, 0); ctx.lineTo(cx, h); ctx.stroke(); ctx.fillStyle = C.Q; pts.forEach((p) => { ctx.globalAlpha = 0.5; ctx.beginPath(); ctx.arc(cx + p[0] * R, cy - p[1] * R, 1.7, 0, 7); ctx.fill(); }); ctx.globalAlpha = 1; ctx.fillStyle = "#fff"; QP.forEach((s) => { ctx.beginPath(); ctx.arc(cx + s[0] * R, cy - s[1] * R, 2.6, 0, 7); ctx.fill(); }); };
    if (cBefore.current) drawC(cBefore.current, before, Math.min(cBefore.current.clientWidth, cBefore.current.clientHeight) * 0.3);
    if (cAfter.current) drawC(cAfter.current, after, Math.min(cAfter.current.clientWidth, cAfter.current.clientHeight) * 0.3);
    const wc = wRef.current;
    if (wc) {
      const ctx = wc._ctx || (wc._ctx = fitCanvas(wc, wc.clientWidth, wc.clientHeight)); const w = wc.clientWidth, h = wc.clientHeight; ctx.clearRect(0, 0, w, h); const pad = { l: 28, r: 8, t: 10, b: 16 }; axes(ctx, w, h, pad);
      const zf = Hmag.map((m) => 1 / Math.max(m, 1e-3)), mm = Hmag.map((m) => m / (m * m + N0)); const vmax = Math.max(3, Math.max(...zf) * 0.6);
      ctx.strokeStyle = C.gridFaint; ctx.font = `9px ${FONT.mono}`; ctx.fillStyle = C.faint; ctx.textAlign = "right"; [0, vmax / 2, vmax].forEach((v) => { const y = (h - pad.b) - (v / vmax) * (h - pad.b - pad.t); ctx.beginPath(); ctx.moveTo(pad.l, y); ctx.lineTo(w - pad.r, y); ctx.stroke(); ctx.fillText(v.toFixed(1), pad.l - 4, y + 3); });
      drawCurve(ctx, w, h, zf, C.warn, pad, 0, vmax); drawCurve(ctx, w, h, mm, C.D, pad, 0, vmax);
      ctx.font = `10px ${FONT.mono}`; ctx.textAlign = "left"; ctx.fillStyle = C.warn; ctx.fillText("— ZF 1/|H|", pad.l + 4, pad.t + 10); ctx.fillStyle = C.D; ctx.fillText("— MMSE", pad.l + 4, pad.t + 23); ctx.fillStyle = C.sub; ctx.textAlign = "center"; ctx.fillText("frequency \u2192", w / 2, h - 3); }
    setStats({ mse: mse / cnt });
  }, [kind, snr]);
  const [stats, setStats] = useState({ mse: 0 });
  return (
    <div>
      <Lead
        notes={[
          { t: "Term", c: C.A, x: "An equalizer is a filter that undoes the channel. Zero-forcing divides by H(f) to flatten it exactly; MMSE instead minimises total error, trading a little residual distortion for far less noise." },
          { t: "Intuition", c: C.Q, x: "At a notch, H is tiny, so 1/H is huge \u2014 zero-forcing amplifies the noise there enormously. MMSE notices the noise and backs off near nulls, keeping the constellation tight." },
          { t: "Heads up", c: C.warn, x: "At high SNR there is little noise to amplify, so ZF and MMSE agree. The gap opens at low SNR and on channels with deep notches \u2014 raise the channel echoes and drop the SNR to see ZF blow up." },
        ]}
        n="19" title="Equalization: undoing the channel"
        body="Once multipath has smeared the constellation into a blur, the receiver flattens the channel back out. The simplest equalizer divides each subcarrier by its channel gain — zero-forcing — but that detonates the noise at any deep notch. MMSE balances flattening against noise. Watch the before/after constellation and the two equalizers' frequency responses as you change SNR." />
      <div className="iq-grid2">
        <div style={{ display: "grid", gap: 14 }}>
          <Panel label="Constellation: received (blurred) → equalized">
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
              <div><div style={{ fontFamily: FONT.mono, fontSize: 9, color: C.faint, marginBottom: 4, textAlign: "center" }}>BEFORE (Y = H·X + noise)</div><canvas ref={cBefore} style={{ width: "100%", height: 150, display: "block" }} /></div>
              <div><div style={{ fontFamily: FONT.mono, fontSize: 9, color: C.faint, marginBottom: 4, textAlign: "center" }}>AFTER ({kind})</div><canvas ref={cAfter} style={{ width: "100%", height: 150, display: "block" }} /></div>
            </div>
          </Panel>
          <Panel label="Equalizer frequency response (note the spike at the notch)">
            <canvas ref={wRef} style={{ width: "100%", height: 130, display: "block" }} />
          </Panel>
        </div>
        <div style={{ display: "grid", gap: 14, alignContent: "start" }}>
          <Panel label="Equalizer">
            <div style={{ marginBottom: 14 }}><div style={{ fontSize: 13, color: C.sub, fontFamily: FONT.body, marginBottom: 6 }}>Type</div><Pills value={kind} options={["ZF", "MMSE"]} onChange={setKind} /></div>
            <Slider label="SNR" value={snr} min={2} max={26} step={1} color={C.Q} fmt={(v) => v + " dB"} onChange={setSnr} />
          </Panel>
          <Panel label="Residual error">
            <Readout rows={[["equalizer", kind, kind === "ZF" ? C.warn : C.D], ["deepest notch |H|", Math.min(...Hmag).toFixed(2), C.sub], ["mean-square error", stats.mse.toFixed(3), stats.mse < 0.2 ? C.D : C.warn]]} />
            <p style={{ fontFamily: FONT.body, fontSize: 12, color: C.sub, margin: "11px 0 0", lineHeight: 1.5 }}>
              Flip between ZF and MMSE at low SNR: ZF's response spikes at the notch and the cloud explodes, while MMSE stays bounded. At high SNR they converge.
            </p>
          </Panel>
        </div>
      </div>
      <Deeper
        recap="Per subcarrier the channel is one complex gain H_k, so the received symbol is Y_k = H_k X_k + noise. Zero-forcing applies 1/H_k, recovering X_k exactly but scaling the noise by 1/|H_k| \u2014 catastrophic where |H_k| is near zero. MMSE applies H_k* / (|H_k|\u00b2 + N0): identical to ZF when noise is negligible, but it rolls off near notches where dividing through would amplify noise more than it helps."
        example={`Per subcarrier:  Y = H\u00b7X + n.
   ZF:   W = 1/H        -> X_hat = X + n/H      (noise \u00d7 1/|H|)
   MMSE: W = H*/(|H|\u00b2+N0) -> limits noise gain near |H|\u22480

Channel here: deepest notch |H| = ${Math.min(...Hmag).toFixed(2)}.
   at SNR 5 dB:  ZF MSE \u2248 0.44,  MMSE \u2248 0.37   (MMSE wins)
   at SNR 15 dB: ZF \u2248 MMSE \u2248 0.044            (noise too small to matter)
Equalization is the single-carrier cousin of OFDM's per-subcarrier
divide \u2014 same idea, harder bookkeeping.`}
      />
    </div>
  );
}

/* ============================================================
   MODULE 20 — SPREAD SPECTRUM & CDMA
   ============================================================ */
function CDMAModule() {
  const specRef = useRef(null), chipRef = useRef(null);
  const [sf, setSf] = useState(8);
  const [users, setUsers] = useState(2);
  const [jam, setJam] = useState(false);
  const W = hadamard(sf);
  // recover user 0 across a few bits
  const recover = (() => {
    _seed = 5150; const bits = [1, -1, 1, -1]; const out = []; let ok = true;
    for (const target of bits) {
      const tx = Array(sf).fill(0);
      for (let u = 0; u < users; u++) { const b = u === 0 ? target : (rand() < .5 ? 1 : -1); for (let k = 0; k < sf; k++) tx[k] += b * W[u][k]; }
      if (jam) for (let k = 0; k < sf; k++) tx[k] += 2.2 * Math.sin(k * 1.7);
      for (let k = 0; k < sf; k++) tx[k] += 0.4 * randn();
      let acc = 0; for (let k = 0; k < sf; k++) acc += tx[k] * W[0][k]; const dec = Math.sign(acc / sf); out.push(dec); if (dec !== target) ok = false;
    }
    return { out, sent: bits, ok };
  })();
  useEffect(() => {
    // spectra: data (narrow), spread (wide), despread (narrow) + jammer
    const M = 64; _seed = 2020;
    const bit = 1; const code = W[0];
    // build a spread chip stream (repeat code over M chips with the data bit) and a despread
    const spreadR = Array(M).fill(0), spreadI = Array(M).fill(0);
    for (let k = 0; k < M; k++) spreadR[k] = bit * code[k % sf] + (jam ? 2.2 * Math.sin(k * 1.7) : 0) + 0.3 * randn();
    const dataR = Array(M).fill(0), dataI = Array(M).fill(0); for (let k = 0; k < M; k++) dataR[k] = bit; // narrowband baseband (constant)
    const despR = spreadR.map((v, k) => v * code[k % sf]), despI = Array(M).fill(0);
    const mag = (re, im) => { const [R, I] = fft(re, im); const m = R.map((r, k) => Math.hypot(r, I[k])); const mx = Math.max(...m, 1e-6); return m.map((x) => x / mx); };
    const sd = mag(dataR.slice(), dataI.slice()), sp = mag(spreadR.slice(), spreadI.slice()), de = mag(despR.slice(), despI.slice());
    const sc = specRef.current;
    if (sc) {
      const ctx = sc._ctx || (sc._ctx = fitCanvas(sc, sc.clientWidth, sc.clientHeight)); const w = sc.clientWidth, h = sc.clientHeight; ctx.clearRect(0, 0, w, h);
      const third = w / 3; const panel = (x0, arr, col, label) => { const pad = { l: x0 + 6, r: 6, t: 14, b: 16 }, ww = third; const xl = pad.l, xr = x0 + ww - pad.r, yb = h - pad.b, yt = pad.t; ctx.strokeStyle = C.gridFaint; ctx.beginPath(); ctx.moveTo(xl, yb); ctx.lineTo(xr, yb); ctx.stroke(); ctx.strokeStyle = col; ctx.lineWidth = 1.5; ctx.beginPath(); const half = arr.length / 2; for (let i = 0; i < arr.length; i++) { const fi = (i + half) % arr.length; const x = xl + (i / (arr.length - 1)) * (xr - xl), y = yb - arr[fi] * (yb - yt); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); } ctx.stroke(); ctx.fillStyle = col; ctx.font = `9px ${FONT.mono}`; ctx.textAlign = "center"; ctx.fillText(label, x0 + ww / 2, 10); };
      panel(0, sd, C.I, "data (narrow)"); panel(third, sp, C.B, jam ? "spread + jammer" : "spread (wide)"); panel(third * 2, de, C.D, "despread \u2192 narrow");
      ctx.strokeStyle = C.edge; ctx.beginPath(); ctx.moveTo(third, 0); ctx.lineTo(third, h); ctx.moveTo(third * 2, 0); ctx.lineTo(third * 2, h); ctx.stroke();
    }
    const cc = chipRef.current;
    if (cc) {
      const ctx = cc._ctx || (cc._ctx = fitCanvas(cc, cc.clientWidth, cc.clientHeight)); const w = cc.clientWidth, h = cc.clientHeight, mid = h / 2; ctx.clearRect(0, 0, w, h);
      ctx.strokeStyle = C.gridFaint; ctx.beginPath(); ctx.moveTo(0, mid); ctx.lineTo(w, mid); ctx.stroke();
      const code = W[0]; const bw = w / sf; ctx.fillStyle = C.B;
      for (let k = 0; k < sf; k++) { const v = code[k]; const y = v > 0 ? mid - (mid - 8) : mid, hh = (mid - 8); ctx.globalAlpha = 0.85; ctx.fillRect(k * bw + 1, y, bw - 2, hh); }
      ctx.globalAlpha = 1; ctx.fillStyle = C.faint; ctx.font = `9px ${FONT.mono}`; ctx.textAlign = "left"; ctx.fillText("user-0 code (" + sf + " chips per bit)", 4, 11);
    }
  }, [sf, users, jam]);
  const pg = (10 * Math.log10(sf)).toFixed(1);
  return (
    <div>
      <Lead
        notes={[
          { t: "Term", c: C.A, x: "Spread spectrum multiplies each data bit by a fast code of \u00b11 chips, smearing the signal across a wide band at low power density. Despreading with the same code collapses it back; the spreading factor (chips per bit) is the processing gain." },
          { t: "Intuition", c: C.Q, x: "Despreading correlates with your code: your signal adds up coherently while interference \u2014 including a strong narrowband jammer \u2014 gets spread thin and averaged away. That is the processing gain, 10·log10(SF) dB." },
          { t: "Heads up", c: C.warn, x: "CDMA gives every user a different code. With orthogonal Walsh codes their signals share the band yet despread cleanly to zero cross-talk \u2014 how multiple phones use one cell at once." },
        ]}
        n="20" title="Spread spectrum & CDMA"
        body="The last trick turns bandwidth into robustness. Multiply your bits by a fast pseudo-random code and the signal spreads into a low, noise-like floor; multiply again at the receiver and it snaps back while interference smears away. Give each user a different orthogonal code and many can share the same band at once — the principle behind CDMA and GPS." />
      <div className="iq-grid2">
        <div style={{ display: "grid", gap: 14 }}>
          <Panel label="Spreading and despreading, in the spectrum">
            <canvas ref={specRef} style={{ width: "100%", height: 150, display: "block" }} />
            <p style={{ fontFamily: FONT.body, fontSize: 12, color: C.sub, margin: "9px 0 0", lineHeight: 1.5 }}>
              The code spreads the narrow data into a wide, flat band (low power density). Despreading collapses it back to a peak — and a narrowband jammer, hit by the code on the way out, gets spread into the floor.
            </p>
          </Panel>
          <Panel label="The spreading code (Walsh)">
            <canvas ref={chipRef} style={{ width: "100%", height: 80, display: "block" }} />
          </Panel>
        </div>
        <div style={{ display: "grid", gap: 14, alignContent: "start" }}>
          <Panel label="Link">
            <div style={{ display: "grid", gap: 14 }}>
              <div><div style={{ fontSize: 13, color: C.sub, fontFamily: FONT.body, marginBottom: 6 }}>Spreading factor</div><Pills value={sf} options={[8, 16]} onChange={(v) => { setSf(v); if (users > v) setUsers(v); }} /></div>
              <Slider label="users sharing the band" value={users} min={1} max={sf} step={1} color={C.A} fmt={(v) => v + ""} onChange={setUsers} />
              <label style={{ display: "flex", alignItems: "center", gap: 9, cursor: "pointer", color: C.warn }}><input type="checkbox" checked={jam} onChange={(e) => setJam(e.target.checked)} style={{ width: 15, height: 15 }} /><span style={{ fontFamily: FONT.body, fontSize: 13, color: C.sub }}>add a narrowband jammer</span></label>
            </div>
          </Panel>
          <Panel label="Recovering user 0">
            <Readout rows={[["processing gain", pg + " dB", C.D], ["sent bits", recover.sent.map((b) => (b > 0 ? "1" : "0")).join(" "), C.sub], ["despread + sliced", recover.out.map((b) => (b > 0 ? "1" : "0")).join(" "), recover.ok ? C.D : C.warn], ["other users", users - 1 + " (orthogonal)", users > 1 ? C.A : C.faint]]} />
            <p style={{ fontFamily: FONT.body, fontSize: 12, color: C.sub, margin: "11px 0 0", lineHeight: 1.5 }}>
              Even with {users - 1} other user{users - 1 === 1 ? "" : "s"} and a jammer in the same band, user 0's bits come back intact: orthogonal codes give zero cross-talk and the processing gain buries the jammer.
            </p>
          </Panel>
        </div>
      </div>
      <Deeper
        recap="Multiplying by a \u00b11 chip sequence c (rate SF times the bit rate) spreads the signal's power over SF times the bandwidth, so its spectral density drops. The receiver multiplies by the same c again; since c\u00b7c = SF the wanted bit adds up coherently, while anything uncorrelated with c \u2014 noise, a jammer, another user's code \u2014 is multiplied by a pseudo-random sign and averages toward zero. Orthogonal Walsh codes make different users' cross-correlation exactly zero, so they coexist in one band; the suppression of everything else is the processing gain, 10\u00b7log10(SF) dB."
        example={`Spread:   chips = bit \u00d7 code(SF chips).
Despread: sum(chips \u00d7 code)/SF.
   own signal: code\u00b7code = SF  -> recovers the bit.
   other user (orthogonal): code_i\u00b7code_j = 0 -> vanishes.
   jammer / noise: \u00d7 random signs -> averaged down by ~SF.

Processing gain: SF = ${sf}  ->  10\u00b7log10(${sf}) = ${pg} dB.
This is why GPS works below the noise floor and why a cell serves
many phones at once \u2014 each on its own code.`}
      />
    </div>
  );
}

/* ============================================================
   APP SHELL
   ============================================================ */
const MODULES = [
  { id: "17", label: "FEC & coding gain", comp: FECModule },
  { id: "18", label: "Multipath & ISI", comp: MultipathModule },
  { id: "19", label: "Equalization", comp: EqualizeModule },
  { id: "20", label: "Spread spectrum / CDMA", comp: CDMAModule },
];
const DIFF = [3, 3, 3, 3];
const PREDICTS = {
  "0": { q: "A rate-4/7 code spends energy on parity. At very low Eb/N0, coded BER vs uncoded is...", options: ["always better", "worse (rate penalty)", "identical"], answer: 1, why: "Below the crossover, splitting energy onto parity bits costs more than the correction saves; coding gain only shows up at low BER." },
  "1": { q: "A cyclic prefix longer than the delay spread turns linear convolution into...", options: ["a longer channel", "circular convolution (per-subcarrier multiply)", "more noise"], answer: 1, why: "Circular convolution is diagonalized by the FFT, so each subcarrier sees one flat gain H_k and stays orthogonal." },
  "2": { q: "At a deep notch in |H(f)|, a zero-forcing equalizer 1/H(f)...", options: ["ignores it", "hugely amplifies the noise there", "deletes the signal"], answer: 1, why: "Dividing by a tiny H blows up signal and noise alike; MMSE backs off near nulls to limit the damage." },
  "3": { q: "Doubling the spreading factor (chips per bit) changes the processing gain by about...", options: ["0 dB", "3 dB", "it doubles the data rate"], answer: 1, why: "Processing gain = 10·log10(SF), so doubling SF adds ~3 dB of suppression against narrowband interference." },
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
            <Eyebrow>I/Q signal primer · advanced</Eyebrow>
          </div>
          <h1 style={{ fontFamily: FONT.disp, fontSize: 34, fontWeight: 700, margin: "0 0 8px", letterSpacing: "-0.02em", lineHeight: 1.05 }}>When the channel fights back</h1>
          <p style={{ fontFamily: FONT.body, fontSize: 15, color: C.sub, maxWidth: 720, lineHeight: 1.6, margin: 0 }}>
            Real channels add noise, echo, fade, and interference. Here are the four tools that win anyway: coding to repair errors, the cyclic prefix to tame multipath, equalization to undo a frequency-selective channel, and spread spectrum to hide under noise and share a band. Every plot runs the real algorithm.
          </p>
          {reduced && <p style={{ fontFamily: FONT.mono, fontSize: 11, color: C.faint, marginTop: 10 }}>Reduced-motion on — all views are static and respond to controls.</p>}
          <nav style={{ display: "flex", gap: 6, marginTop: 22, flexWrap: "wrap", borderBottom: `1px solid ${C.edge}`, paddingBottom: 16 }}>
            {MODULES.map((m, i) => <button key={m.id} className="iq-tab" data-on={active === i ? "1" : "0"} onClick={() => setActive(i)}><span style={{ color: active === i ? C.Q : C.faint, marginRight: 7 }}>{m.id}</span>{m.label}<span title="math intensity (light / medium / heavy)" style={{ marginLeft: 7, letterSpacing: 1, fontSize: 9 }}>{[0, 1, 2].map((_d) => <span key={_d} style={{ color: _d < DIFF[i] ? (DIFF[i] === 1 ? C.D : DIFF[i] === 2 ? C.I : C.warn) : C.gridFaint }}>{"\u2022"}</span>)}</span></button>)}
          </nav>
        </header>
        {PREDICTS[active] && <Predict q={PREDICTS[active].q} options={PREDICTS[active].options} answer={PREDICTS[active].answer} why={PREDICTS[active].why} />}
        <main key={active}><Comp reduced={reduced} /></main>
        <footer style={{ marginTop: 40, paddingTop: 18, borderTop: `1px solid ${C.gridFaint}`, fontFamily: FONT.body, fontSize: 12, color: C.faint, lineHeight: 1.6 }}>
          Coding repairs errors, the cyclic prefix neutralizes echo, equalizers flatten the channel, and spreading hides a signal under the noise. These are the moves that take a clean-room constellation out into the real, hostile air — the end of the course, and the start of real radio engineering.
        </footer>
      </div>
    </div>
  );
}
