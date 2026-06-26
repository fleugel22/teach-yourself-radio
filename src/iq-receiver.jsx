import { useState, useRef, useEffect } from "react";

/* ============================================================
   I/Q PRIMER · RECEIVER BACK-END  (between Part 2 and Part 3)
   From clean baseband samples to bits: pulse shaping + RRC and
   the eye diagram, carrier recovery (Costas loop), symbol-timing
   recovery (Gardner TED), and the slicer / bit demapper.
   House rule: every plot runs the real DSP.
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

/* ---------- hooks & canvas ---------- */
function usePrefersReducedMotion() {
  const [r, setR] = useState(false);
  useEffect(() => {
    if (!window.matchMedia) return;
    const m = window.matchMedia("(prefers-reduced-motion: reduce)");
    const h = () => setR(m.matches); h(); m.addEventListener?.("change", h);
    return () => m.removeEventListener?.("change", h);
  }, []);
  return r;
}
function useRaf(fn, active) {
  const cb = useRef(fn); cb.current = fn;
  useEffect(() => {
    if (!active) return;
    let raf; const start = performance.now();
    const loop = (t) => { cb.current((t - start) / 1000); raf = requestAnimationFrame(loop); };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [active]);
}
function fitCanvas(canvas, w, h) {
  const r = window.devicePixelRatio || 1;
  canvas.width = Math.round(w * r); canvas.height = Math.round(h * r);
  canvas.style.width = w + "px"; canvas.style.height = h + "px";
  const ctx = canvas.getContext("2d"); ctx.setTransform(r, 0, 0, r, 0, 0);
  return ctx;
}
let _seed = 222333;
const rand = () => { _seed = (_seed * 1103515245 + 12345) & 0x7fffffff; return _seed / 0x7fffffff; };
const randn = () => { let u = 0, v = 0; while (u === 0) u = rand(); while (v === 0) v = rand(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };

/* ---------- DSP ---------- */
function rrc(beta, sps, span) {
  const N = span * sps, taps = [];
  for (let i = 0; i <= N; i++) {
    const t = (i - N / 2) / sps; let v;
    if (Math.abs(t) < 1e-8) v = 1 - beta + 4 * beta / Math.PI;
    else if (beta > 0 && Math.abs(Math.abs(t) - 1 / (4 * beta)) < 1e-6) v = (beta / Math.SQRT2) * ((1 + 2 / Math.PI) * Math.sin(Math.PI / (4 * beta)) + (1 - 2 / Math.PI) * Math.cos(Math.PI / (4 * beta)));
    else { const pt = Math.PI * t; v = (Math.sin(pt * (1 - beta)) + 4 * beta * t * Math.cos(pt * (1 + beta))) / (pt * (1 - (4 * beta * t) ** 2)); }
    taps.push(v);
  }
  const e = Math.sqrt(taps.reduce((s, x) => s + x * x, 0)); return taps.map((x) => x / e);
}
function conv(a, b) { const o = new Array(a.length + b.length - 1).fill(0); for (let i = 0; i < a.length; i++) { const ai = a[i]; if (ai === 0) continue; for (let j = 0; j < b.length; j++) o[i + j] += ai * b[j]; } return o; }
const lin = (arr, idx) => { const i0 = Math.floor(idx), f = idx - i0; return (arr[i0] || 0) * (1 - f) + (arr[i0 + 1] || 0) * f; };

const gray = (x) => x ^ (x >> 1);
const tobits = (v, w) => v.toString(2).padStart(w, "0");
function pskPts(M) { const b = Math.log2(M), p = []; for (let i = 0; i < M; i++) { const a = (M === 4 ? Math.PI / 4 : 0) + (2 * Math.PI * i) / M; p.push({ I: Math.cos(a), Q: Math.sin(a), label: tobits(gray(i), b) }); } return p; }
function qamPts(L) { const b = Math.log2(L), amp = [...Array(L)].map((_, i) => 2 * i - (L - 1)), p = []; for (let qi = 0; qi < L; qi++) for (let ii = 0; ii < L; ii++) p.push({ I: amp[ii], Q: amp[qi], label: tobits(gray(ii), b) + tobits(gray(qi), b) }); return p; }
function normPow(pts) { let p = 0; pts.forEach((s) => (p += s.I * s.I + s.Q * s.Q)); const g = Math.sqrt(pts.length / p); return pts.map((s) => ({ ...s, I: s.I * g, Q: s.Q * g })); }
const CON = { 4: normPow(pskPts(4)), 16: normPow(qamPts(4)) };
function nearest(pts, I, Q) { let bi = 0, bd = 1e9; for (let i = 0; i < pts.length; i++) { const d = (pts[i].I - I) ** 2 + (pts[i].Q - Q) ** 2; if (d < bd) { bd = d; bi = i; } } return bi; }

/* ---------- UI atoms ---------- */
function Eyebrow({ children }) { return <div style={{ fontFamily: FONT.mono, fontSize: 11, letterSpacing: "0.18em", textTransform: "uppercase", color: C.faint }}>{children}</div>; }
function Panel({ label, children, style }) { return <div style={{ background: C.panel, border: `1px solid ${C.edge}`, borderRadius: 10, padding: 16, ...style }}>{label && <div style={{ marginBottom: 12 }}><Eyebrow>{label}</Eyebrow></div>}{children}</div>; }
function Slider({ label, value, min, max, step, onChange, color = C.ink, fmt }) {
  return (
    <label style={{ display: "block" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 5 }}>
        <span style={{ fontSize: 13, color: C.sub, fontFamily: FONT.body }}>{label}</span>
        <span style={{ fontFamily: FONT.mono, fontSize: 13, color }}>{fmt ? fmt(value) : value}</span>
      </div>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(parseFloat(e.target.value))} style={{ width: "100%", color }} />
    </label>
  );
}
function Pills({ value, options, onChange, color = C.Q, labels }) {
  return <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>{options.map((o, i) => <button key={o} onClick={() => onChange(o)} className="iq-mini" data-on={value === o ? "1" : "0"} style={value === o ? { borderColor: color, color } : undefined}>{labels ? labels[i] : o}</button>)}</div>;
}
function Readout({ rows }) {
  return <div style={{ display: "grid", gap: 8 }}>{rows.map(([l, v, c], i) => <div key={i} style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", borderBottom: `1px solid ${C.gridFaint}`, paddingBottom: 6 }}><span style={{ fontFamily: FONT.body, fontSize: 12, color: C.sub }}>{l}</span><span style={{ fontFamily: FONT.mono, fontSize: 14, color: c || C.ink }}>{v}</span></div>)}</div>;
}
function Lead({ n, title, body, notes }) {
  return (
    <div style={{ marginBottom: 20 }}>
      <div style={{ maxWidth: 730 }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 12, marginBottom: 6 }}><span style={{ fontFamily: FONT.mono, fontSize: 13, color: C.Q }}>{n}</span><h2 style={{ fontFamily: FONT.disp, fontSize: 23, fontWeight: 600, color: C.ink, margin: 0, letterSpacing: "-0.01em" }}>{title}</h2></div>
        <p style={{ fontFamily: FONT.body, fontSize: 14.5, color: C.sub, lineHeight: 1.62, margin: 0 }}>{body}</p>
      </div>
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
function drawConstellation(ctx, w, h, pts, opts = {}) {
  ctx.clearRect(0, 0, w, h);
  const cx = w / 2, cy = h / 2, R = Math.min(w, h) * 0.42 / (opts.range || 1.5);
  ctx.strokeStyle = C.gridFaint; ctx.lineWidth = 1;
  for (let g = -2; g <= 2; g++) { ctx.beginPath(); ctx.moveTo(cx + g * R, 0); ctx.lineTo(cx + g * R, h); ctx.stroke(); ctx.beginPath(); ctx.moveTo(0, cy + g * R); ctx.lineTo(w, cy + g * R); ctx.stroke(); }
  ctx.strokeStyle = C.edge; ctx.beginPath(); ctx.moveTo(0, cy); ctx.lineTo(w, cy); ctx.stroke(); ctx.beginPath(); ctx.moveTo(cx, 0); ctx.lineTo(cx, h); ctx.stroke();
  if (opts.cloud) { opts.cloud.forEach((p) => { ctx.fillStyle = p.c; ctx.globalAlpha = p.a == null ? 0.6 : p.a; ctx.beginPath(); ctx.arc(cx + p.I * R, cy - p.Q * R, p.s || 2, 0, 7); ctx.fill(); }); ctx.globalAlpha = 1; }
  if (pts) pts.forEach((s) => { ctx.fillStyle = opts.pointColor || "#ffffff"; ctx.beginPath(); ctx.arc(cx + s.I * R, cy - s.Q * R, 3, 0, 7); ctx.fill(); if (opts.labels) { ctx.fillStyle = C.sub; ctx.font = `9px ${FONT.mono}`; ctx.textAlign = "center"; ctx.fillText(s.label, cx + s.I * R, cy - s.Q * R - 7); } });
}

/* ============================================================
   MODULE 08.1 — PULSE SHAPING & THE EYE DIAGRAM
   ============================================================ */
function PulseEyeModule() {
  const eRef = useRef(null), pRef = useRef(null);
  const [beta, setBeta] = useState(0.25);
  const [noise, setNoise] = useState(6);
  const [matched, setMatched] = useState(true);
  const sps = 16, span = 8;

  useEffect(() => {
    _seed = 4242;
    const g = rrc(beta, sps, span), nsym = 160;
    const up = new Array(nsym * sps).fill(0);
    for (let k = 0; k < nsym; k++) up[k * sps] = rand() < 0.5 ? -1 : 1;
    let tx = conv(up, g);
    const sd = Math.pow(10, -noise / 20) * 0.5;
    for (let i = 0; i < tx.length; i++) tx[i] += sd * randn();
    const sig = matched ? conv(tx, g) : tx;
    const delay = matched ? g.length - 1 : (g.length - 1) / 2;

    const ec = eRef.current;
    if (ec) {
      const ctx = ec._ctx || (ec._ctx = fitCanvas(ec, ec.clientWidth, ec.clientHeight));
      const w = ec.clientWidth, h = ec.clientHeight, midY = h / 2, amp = (h / 2) * 0.8, span2 = 2 * sps;
      ctx.clearRect(0, 0, w, h);
      ctx.strokeStyle = C.gridFaint; ctx.beginPath(); ctx.moveTo(0, midY); ctx.lineTo(w, midY); ctx.stroke();
      ctx.strokeStyle = C.Q; ctx.lineWidth = 1; ctx.globalAlpha = 0.16;
      const start0 = Math.round(delay - sps + 8 * sps);
      for (let s = start0; s + span2 < sig.length - sps; s += sps) { ctx.beginPath(); for (let k = 0; k <= span2; k++) { const x = (k / span2) * w, y = midY - sig[s + k] * amp / 1.5; k ? ctx.lineTo(x, y) : ctx.moveTo(x, y); } ctx.stroke(); }
      ctx.globalAlpha = 1;
      ctx.strokeStyle = C.I; ctx.setLineDash([4, 3]); ctx.beginPath(); ctx.moveTo(w / 2, 0); ctx.lineTo(w / 2, h); ctx.stroke(); ctx.setLineDash([]);
      ctx.fillStyle = C.faint; ctx.font = `10px ${FONT.mono}`; ctx.textAlign = "center"; ctx.fillText("decision instant", w / 2, h - 6);
    }
    const pc = pRef.current;
    if (pc) {
      const ctx = pc._ctx || (pc._ctx = fitCanvas(pc, pc.clientWidth, pc.clientHeight));
      const w = pc.clientWidth, h = pc.clientHeight, midY = h / 2; ctx.clearRect(0, 0, w, h);
      ctx.strokeStyle = C.gridFaint; ctx.beginPath(); ctx.moveTo(0, midY); ctx.lineTo(w, midY); ctx.stroke();
      let mx = 0; g.forEach((v) => (mx = Math.max(mx, Math.abs(v))));
      ctx.strokeStyle = C.A; ctx.lineWidth = 1.8; ctx.beginPath();
      for (let i = 0; i < g.length; i++) { const x = (i / (g.length - 1)) * w, y = midY - (g[i] / mx) * (h / 2) * 0.82; i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); } ctx.stroke();
    }
  }, [beta, noise, matched]);

  return (
    <div>
      <Lead
        notes={[
          { t: "Term", c: C.A, x: "A root-raised-cosine (RRC) pulse shapes each symbol so the spectrum stays compact. Put one at the transmitter and a matching one at the receiver and together they form a raised cosine \u2014 a Nyquist pulse with zero inter-symbol interference at the sampling instants." },
          { t: "Intuition", c: C.Q, x: "Overlay every two-symbol slice of the waveform and you get the eye diagram. A wide-open eye means there\u2019s a clear instant where every symbol is far from the decision line; a closed eye means neighbours bleed together." },
          { t: "Try it", c: C.D, x: "Raise the roll-off and the eye opens wider (at the cost of more bandwidth). Add noise and the eyelids fuzz; turn off the matched filter and watch the eye partly close as out-of-band noise leaks in." },
        ]}
        n="08.1" title="Pulse shaping and the eye diagram"
        body="Square symbol pulses splatter energy across the spectrum, so real systems shape each symbol with a root-raised-cosine filter. The classic way to judge the result is the eye diagram: overlay many two-symbol windows and look for a clean opening at the decision instant. The wider the eye, the more margin against noise and timing error — exactly what the next two modules go after." />
      <div className="iq-grid2">
        <div style={{ display: "grid", gap: 14 }}>
          <Panel label="Eye diagram (in-phase rail)">
            <canvas ref={eRef} style={{ width: "100%", height: 240, display: "block" }} />
            <p style={{ fontFamily: FONT.body, fontSize: 12.5, color: C.sub, margin: "10px 0 0", lineHeight: 1.5 }}>
              The amber line is the ideal sampling instant. Vertical opening = noise margin; horizontal opening = how forgiving the timing can be. Both shrink as you add noise or lower the roll-off.
            </p>
          </Panel>
          <Panel label="The RRC pulse shape (impulse response)">
            <canvas ref={pRef} style={{ width: "100%", height: 110, display: "block" }} />
          </Panel>
        </div>
        <div style={{ display: "grid", gap: 14, alignContent: "start" }}>
          <Panel label="Shaping">
            <div style={{ display: "grid", gap: 16 }}>
              <Slider label="Roll-off β (excess bandwidth)" value={beta} min={0.05} max={1} step={0.01} color={C.A} fmt={(v) => v.toFixed(2)} onChange={setBeta} />
              <Slider label="Channel noise" value={noise} min={0} max={25} step={1} color={C.I} fmt={(v) => v.toFixed(0) + " dB"} onChange={setNoise} />
              <label style={{ display: "flex", alignItems: "center", gap: 9, cursor: "pointer", color: C.Q }}><input type="checkbox" checked={matched} onChange={(e) => setMatched(e.target.checked)} style={{ width: 15, height: 15 }} /><span style={{ fontFamily: FONT.body, fontSize: 13, color: C.sub }}>receiver matched filter on</span></label>
            </div>
          </Panel>
          <Panel label="Why a matched filter">
            <p style={{ fontFamily: FONT.body, fontSize: 12.5, color: C.sub, margin: 0, lineHeight: 1.55 }}>
              The receiver\u2019s RRC isn\u2019t just for shape \u2014 it\u2019s the matched filter that maximises signal-to-noise at the decision instant. Turn it off and the eye closes because broadband noise that the filter would have rejected stays in.
            </p>
          </Panel>
        </div>
      </div>
      <Deeper
        recap="Square pulses have endless spectral tails, so each symbol is shaped by a root-raised-cosine filter. RRC alone isn't ISI-free \u2014 but RRC at the transmitter convolved with RRC at the receiver equals a raised cosine, which passes through zero at every other symbol instant. So at the right sampling moment each symbol is clean of its neighbours, and the matched RX filter also maximises SNR. The eye diagram is just the proof, drawn by overlaying two-symbol windows."
        example={`Raised cosine = RRC(tx) * RRC(rx), sampled at symbol spacing T:
   t = 0    \u2192 1.00   (your symbol)
   t = \u00b1T   \u2192 0.00   (neighbours contribute nothing)
   t = \u00b12T  \u2192 0.00
That row of zeros at \u00b1T, \u00b12T, \u2026 is the Nyquist no-ISI property,
and it's why the eye has a clean opening at t = 0.

Roll-off \u03b2 trades bandwidth for eye width:
   bandwidth = (1 + \u03b2) \u00d7 (symbol rate / 2)
   \u03b2 = 0.25 \u2192 25% excess BW, a moderately open eye
   \u03b2 = 1.0  \u2192 100% excess BW, the widest, most robust eye`}
      />
    </div>
  );
}

/* ============================================================
   MODULE 08.2 — CARRIER RECOVERY (Costas loop)
   ============================================================ */
function CarrierModule({ reduced }) {
  const cRef = useRef(null), tRef = useRef(null);
  const [df, setDf] = useState(0.01);
  const [ph0, setPh0] = useState(1.0);
  const [bw, setBw] = useState(5);
  const [snr, setSnr] = useState(18);
  const data = useRef({ pts: [], err: [], freqEst: 0, jit: 0 });
  const head = useRef(0);

  function compute() {
    _seed = 7777;
    const nsym = 1400, QP = CON[4];
    const sd = Math.sqrt(Math.pow(10, -snr / 10) / 2);
    const a1 = bw * 0.012, a2 = a1 * a1 * 0.5;
    let theta = 0, freq = 0; const pts = [], err = [];
    for (let k = 0; k < nsym; k++) {
      const s = QP[(rand() * 4) | 0], ph = 2 * Math.PI * df * k + ph0;
      const rI = s.I * Math.cos(ph) - s.Q * Math.sin(ph) + sd * randn();
      const rQ = s.I * Math.sin(ph) + s.Q * Math.cos(ph) + sd * randn();
      const yI = rI * Math.cos(-theta) - rQ * Math.sin(-theta);
      const yQ = rI * Math.sin(-theta) + rQ * Math.cos(-theta);
      const e = Math.sign(yI) * yQ - Math.sign(yQ) * yI;
      freq += a2 * e; theta += freq + a1 * e;
      pts.push({ I: yI, Q: yQ }); err.push(e);
    }
    let mse = 0; for (let k = nsym - 250; k < nsym; k++) { const a = Math.atan2(pts[k].Q, pts[k].I); let d = ((a - Math.PI / 4) % (Math.PI / 2) + Math.PI / 2) % (Math.PI / 2); d = Math.min(d, Math.PI / 2 - d); mse += d * d; }
    data.current = { pts, err, freqEst: freq / (2 * Math.PI), jit: Math.sqrt(mse / 250) * 180 / Math.PI };
    head.current = reduced ? nsym : 1;
  }
  useEffect(() => { compute(); draw(); }, [df, ph0, bw, snr, reduced]);

  function draw() {
    const { pts, err } = data.current; if (!pts.length) return;
    const hd = Math.min(head.current | 0, pts.length);
    const cc = cRef.current;
    if (cc) {
      const ctx = cc._ctx || (cc._ctx = fitCanvas(cc, cc.clientWidth, cc.clientHeight));
      const cloud = []; for (let k = Math.max(0, hd - 160); k < hd; k++) cloud.push({ I: pts[k].I, Q: pts[k].Q, c: C.Q, a: 0.5, s: 2 });
      drawConstellation(ctx, cc.clientWidth, cc.clientHeight, CON[4], { range: 1.6, cloud, pointColor: "#ffffff" });
    }
    const tc = tRef.current;
    if (tc) {
      const ctx = tc._ctx || (tc._ctx = fitCanvas(tc, tc.clientWidth, tc.clientHeight));
      const w = tc.clientWidth, h = tc.clientHeight, midY = h / 2; ctx.clearRect(0, 0, w, h);
      ctx.strokeStyle = C.gridFaint; ctx.beginPath(); ctx.moveTo(0, midY); ctx.lineTo(w, midY); ctx.stroke();
      ctx.fillStyle = C.faint; ctx.font = `9px ${FONT.mono}`; ctx.textAlign = "left"; ctx.fillText("phase-detector error vs symbol \u2192", 4, 11);
      ctx.strokeStyle = C.B; ctx.lineWidth = 1.4; ctx.beginPath();
      const n = pts.length; for (let k = 0; k < hd; k++) { const x = (k / n) * w, y = midY - Math.max(-1.5, Math.min(1.5, err[k])) * (h / 2) * 0.5; k ? ctx.lineTo(x, y) : ctx.moveTo(x, y); } ctx.stroke();
    }
  }
  useRaf(() => { head.current = Math.min(head.current + data.current.pts.length / 240, data.current.pts.length); draw(); }, !reduced);

  const locked = data.current.jit < 15;
  return (
    <div>
      <Lead
        notes={[
          { t: "Term", c: C.A, x: "The receiver\u2019s local oscillator never exactly matches the transmitter\u2019s, so the baseband constellation arrives rotated (phase offset) and slowly spinning (frequency offset). Carrier recovery is the loop that cancels both." },
          { t: "Intuition", c: C.Q, x: "A Costas loop is a PLL with no actual carrier to lock to. It measures how far the points sit from where they should be, then steers a numerically-controlled oscillator to de-rotate them until they snap into place." },
          { t: "Heads up", c: C.warn, x: "Wider loop bandwidth locks faster but lets in more jitter; too narrow and it can\u2019t catch a big frequency offset. There\u2019s also a 90\u00b0 phase ambiguity QPSK resolves with known/differential bits." },
        ]}
        n="08.2" title="Carrier recovery — the Costas loop"
        body="Mix down with an oscillator that's a hair off the transmitter's and your constellation spins. A Costas loop fixes this without ever seeing a pure carrier: it derives a phase-error signal directly from the data-bearing samples and drives an oscillator to undo the rotation. Watch the smeared, spinning cloud collapse onto the four QPSK points as the loop locks." />
      <div className="iq-grid2">
        <div style={{ display: "grid", gap: 14 }}>
          <Panel label="Received constellation, de-rotating as the loop locks">
            <canvas ref={cRef} style={{ width: "100%", height: 260, display: "block" }} />
          </Panel>
          <Panel label="Phase-error signal converging to zero">
            <canvas ref={tRef} style={{ width: "100%", height: 90, display: "block" }} />
          </Panel>
        </div>
        <div style={{ display: "grid", gap: 14, alignContent: "start" }}>
          <Panel label="Impairment & loop">
            <div style={{ display: "grid", gap: 16 }}>
              <Slider label="Carrier frequency offset" value={df} min={-0.03} max={0.03} step={0.001} color={C.B} fmt={(v) => v.toFixed(3) + " cyc/sym"} onChange={setDf} />
              <Slider label="Carrier phase offset" value={ph0} min={-3.14} max={3.14} step={0.05} color={C.A} fmt={(v) => v.toFixed(2) + " rad"} onChange={setPh0} />
              <Slider label="Loop bandwidth" value={bw} min={1} max={12} step={1} color={C.Q} fmt={(v) => v.toFixed(0)} onChange={setBw} />
              <Slider label="Signal-to-noise ratio" value={snr} min={6} max={30} step={1} color={C.I} fmt={(v) => v.toFixed(0) + " dB"} onChange={setSnr} />
            </div>
          </Panel>
          <Panel label="Lock status">
            <Readout rows={[["recovered freq offset", data.current.freqEst.toFixed(4), C.D], ["residual phase jitter", data.current.jit.toFixed(1) + "°", locked ? C.D : C.warn], ["state", locked ? "locked" : "acquiring", locked ? C.D : C.warn]]} />
          </Panel>
        </div>
      </div>
      <Deeper
        recap="A Costas loop recovers the carrier for suppressed-carrier formats like PSK. Each sample is de-rotated by the loop\u2019s current phase estimate; a phase detector then reports how far the result still sits from an ideal symbol, and a small (proportional + integral) loop filter nudges the oscillator\u2019s phase and frequency to drive that error to zero. The integral term is what lets it track a constant frequency offset, not just a fixed phase."
        example={`QPSK Costas phase detector (per de-rotated sample y = I + jQ):
   e = sign(I)\u00b7Q \u2212 sign(Q)\u00b7I
   \u2192 at a correct point like (0.707, 0.707): e = 0.707 \u2212 0.707 = 0
   \u2192 if rotated slightly +\u03b8: e \u2248 +\u03b8 (pushes the loop back)

Loop update each symbol:
   freq  += a\u2082 \u00b7 e        (integrator: tracks frequency offset)
   phase += freq + a\u2081 \u00b7 e  (proportional: tracks phase)

With offset 0.008 cyc/sym at 20 dB this locks in a few hundred
symbols to ~4\u00b0 jitter; the frequency estimate converges to 0.008.`}
      />
    </div>
  );
}

/* ============================================================
   MODULE 08.3 — SYMBOL-TIMING RECOVERY (Gardner TED)
   ============================================================ */
function TimingModule() {
  const sRef = useRef(null), cRef = useRef(null);
  const [tau, setTau] = useState(0.3);
  const [beta, setBeta] = useState(0.3);
  const sps = 16, span = 8;
  const sig = useRef({ s: [], delay: 0, syms: [] });

  function build() {
    _seed = 5150;
    const g = rrc(beta, sps, span), nsym = 220, syms = [];
    const up = new Array(nsym * sps).fill(0);
    for (let k = 0; k < nsym; k++) { const b = rand() < 0.5 ? -1 : 1; syms.push(b); up[k * sps] = b; }
    const tx = conv(up, g), s = conv(tx, g);
    sig.current = { s, delay: g.length - 1, nsym, syms };
  }
  useEffect(() => { build(); }, [beta]);

  useEffect(() => {
    const { s, delay, nsym } = sig.current; if (!s) return;
    // S-curve: average Gardner error vs offset
    const scurve = [];
    for (let t = -0.5; t <= 0.5001; t += 0.05) { let e = 0, c = 0; for (let k = 6; k < nsym - 6; k++) { const center = delay + (k + t) * sps; const late = lin(s, center), early = lin(s, center - sps), mid = lin(s, center - sps / 2); e += mid * (late - early); c++; } scurve.push([t, e / c]); }
    // current recovered samples at offset tau
    const rec = []; let eNow = 0, cN = 0;
    for (let k = 6; k < nsym - 6; k++) { const center = delay + (k + tau) * sps; rec.push(lin(s, center)); const late = lin(s, center), early = lin(s, center - sps), mid = lin(s, center - sps / 2); eNow += mid * (late - early); cN++; }
    eNow /= cN;

    const sc = sRef.current;
    if (sc) {
      const ctx = sc._ctx || (sc._ctx = fitCanvas(sc, sc.clientWidth, sc.clientHeight));
      const w = sc.clientWidth, h = sc.clientHeight, midY = h / 2, padX = 8; ctx.clearRect(0, 0, w, h);
      let mx = 0; scurve.forEach(([, e]) => (mx = Math.max(mx, Math.abs(e)))); mx = mx || 1;
      ctx.strokeStyle = C.gridFaint; ctx.beginPath(); ctx.moveTo(0, midY); ctx.lineTo(w, midY); ctx.stroke(); ctx.beginPath(); ctx.moveTo(w / 2, 0); ctx.lineTo(w / 2, h); ctx.stroke();
      const xOf = (t) => padX + ((t + 0.5)) * (w - 2 * padX), yOf = (e) => midY - (e / mx) * (h / 2) * 0.82;
      ctx.strokeStyle = C.D; ctx.lineWidth = 1.8; ctx.beginPath(); scurve.forEach(([t, e], i) => { const x = xOf(t), y = yOf(e); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); }); ctx.stroke();
      const x = xOf(tau), y = yOf(eNow); ctx.fillStyle = C.I; ctx.beginPath(); ctx.arc(x, y, 4.5, 0, 7); ctx.fill();
      ctx.fillStyle = C.faint; ctx.font = `9px ${FONT.mono}`; ctx.textAlign = "center"; ctx.fillText("τ = 0 (optimal)", w / 2, h - 5); ctx.textAlign = "left"; ctx.fillText("timing error e(τ) \u2192", 4, 11);
    }
    const cc = cRef.current;
    if (cc) {
      const ctx = cc._ctx || (cc._ctx = fitCanvas(cc, cc.clientWidth, cc.clientHeight));
      const w = cc.clientWidth, h = cc.clientHeight, midY = h / 2; ctx.clearRect(0, 0, w, h);
      ctx.strokeStyle = C.gridFaint; ctx.beginPath(); ctx.moveTo(0, midY); ctx.lineTo(w, midY); ctx.stroke();
      [-1, 1].forEach((lv) => { ctx.strokeStyle = C.edge; ctx.setLineDash([3, 3]); ctx.beginPath(); ctx.moveTo(0, midY - lv * (h / 2) * 0.6); ctx.lineTo(w, midY - lv * (h / 2) * 0.6); ctx.stroke(); ctx.setLineDash([]); });
      ctx.fillStyle = C.Q; rec.forEach((v, i) => { const x = (i / rec.length) * w; ctx.globalAlpha = 0.7; ctx.beginPath(); ctx.arc(x, midY - v * (h / 2) * 0.6, 2, 0, 7); ctx.fill(); }); ctx.globalAlpha = 1;
    }
  }, [tau, beta]);

  return (
    <div>
      <Lead
        notes={[
          { t: "Term", c: C.A, x: "Even with the carrier fixed, the receiver must sample at exactly the right instant in each symbol. A timing-error detector measures how far off the sampling phase is; here, the Gardner detector, which works at two samples per symbol and needs no carrier lock." },
          { t: "Intuition", c: C.Q, x: "Gardner looks at the value halfway between two symbol samples. At the right timing that midpoint sits at a zero-crossing; if it doesn\u2019t, its sign and size say which way the clock has drifted." },
          { t: "Try it", c: C.D, x: "Slide the sampling offset τ and watch two things move together: the recovered levels smear away from \u00b11, and the operating dot climbs the S-curve. The loop\u2019s whole job is to drive that dot back to the centre zero." },
        ]}
        n="08.3" title="Symbol-timing recovery — the Gardner detector"
        body="The receiver's clock doesn't line up with the transmitter's, so it must find the right instant to sample each symbol. A timing-error detector turns the sampled waveform into an error that's zero at the perfect instant and signed otherwise — an S-curve. The Gardner detector does this with just two samples per symbol. Slide the sampling phase and see the recovered symbols smear and the detector light up." />
      <div className="iq-grid2">
        <div style={{ display: "grid", gap: 14 }}>
          <Panel label="Gardner timing-error detector — the S-curve">
            <canvas ref={sRef} style={{ width: "100%", height: 200, display: "block" }} />
            <p style={{ fontFamily: FONT.body, fontSize: 12.5, color: C.sub, margin: "10px 0 0", lineHeight: 1.5 }}>
              Zero error exactly at τ = 0, with opposite signs either side. A real loop reads this error and slides the sampling clock downhill to the centre — that's symbol-timing recovery.
            </p>
          </Panel>
          <Panel label="Recovered symbol values at the current timing">
            <canvas ref={cRef} style={{ width: "100%", height: 100, display: "block" }} />
          </Panel>
        </div>
        <div style={{ display: "grid", gap: 14, alignContent: "start" }}>
          <Panel label="Timing">
            <div style={{ display: "grid", gap: 16 }}>
              <Slider label="Sampling offset τ (fraction of a symbol)" value={tau} min={-0.5} max={0.5} step={0.01} color={C.I} fmt={(v) => v.toFixed(2)} onChange={setTau} />
              <Slider label="Pulse roll-off β" value={beta} min={0.1} max={1} step={0.05} color={C.A} fmt={(v) => v.toFixed(2)} onChange={setBeta} />
            </div>
            <button onClick={() => setTau(0)} className="iq-mini" style={{ marginTop: 14 }}>↧ snap to optimum (τ = 0)</button>
          </Panel>
          <Panel label="What you're seeing">
            <p style={{ fontFamily: FONT.body, fontSize: 12.5, color: C.sub, margin: 0, lineHeight: 1.55 }}>
              At τ = 0 the recovered values sit tight on \u00b11 (clean symbols). Move off and they collapse toward the middle as you sample on the pulse\u2019s slopes \u2014 the same closing you saw in the eye diagram, now as a number the loop can act on.
            </p>
          </Panel>
        </div>
      </div>
      <Deeper
        recap="Sampling at the wrong moment within a symbol smears the values toward the decision line, just like a closing eye. The Gardner detector reads the sample halfway between two symbol instants: at correct timing that midpoint is a zero-crossing of the pulse, so multiplying it by the change between the two symbols gives zero; off-timing it's nonzero with a sign that tells the clock which way to move. Averaged over symbols this traces the S-curve, and a loop slides the sampling phase to its zero."
        example={`Gardner error at 2 samples/symbol, samples z[\u00b7]:
   for symbol k:  early = z[2k\u22122], mid = z[2k\u22121], late = z[2k]
   e[k] = mid \u00b7 (late \u2212 early)     (sum I and Q for complex)

Sweeping the sampling offset τ gives an odd S-curve:
   τ = \u22120.3 \u2192 e \u2248 \u22120.16      (sampling early \u2192 negative)
   τ =  0.0 \u2192 e \u2248  0.00      (locked)
   τ = +0.3 \u2192 e \u2248 +0.16      (sampling late \u2192 positive)

The sign points the loop home; the slope at zero sets how
hard it pulls. No carrier lock required \u2014 Gardner runs on
the magnitude pattern alone.`}
      />
    </div>
  );
}

/* ============================================================
   MODULE 08.4 — THE SLICER → BITS
   ============================================================ */
function SlicerModule() {
  const cRef = useRef(null);
  const [M, setM] = useState(4);
  const [snr, setSnr] = useState(14);
  const [stats, setStats] = useState({ se: 0, be: 0, n: 0, bits: "" });

  useEffect(() => {
    _seed = 31337;
    const pts = CON[M], bps = Math.log2(M), sd = Math.sqrt(Math.pow(10, -snr / 10) / 2);
    const T = 600; let se = 0, be = 0; const cloud = []; let bitstr = "";
    for (let i = 0; i < T; i++) {
      const ti = (rand() * M) | 0, tx = pts[ti];
      const rI = tx.I + sd * randn(), rQ = tx.Q + sd * randn();
      const di = nearest(pts, rI, rQ), ok = di === ti;
      if (!ok) { se++; for (let b = 0; b < bps; b++) if (pts[ti].label[b] !== pts[di].label[b]) be++; }
      cloud.push({ I: rI, Q: rQ, c: ok ? C.D : C.warn, a: 0.6, s: 2.2 });
      if (i < 12) bitstr += pts[di].label + " ";
    }
    setStats({ se, be, n: T, bits: bitstr.trim() });
    const cc = cRef.current;
    if (cc) {
      const ctx = cc._ctx || (cc._ctx = fitCanvas(cc, cc.clientWidth, cc.clientHeight));
      const w = cc.clientWidth, h = cc.clientHeight, cx = w / 2, cy = h / 2, R = Math.min(w, h) * 0.42 / 1.5;
      drawConstellation(ctx, w, h, null, { range: 1.5, cloud });
      // decision boundaries
      ctx.strokeStyle = C.faint; ctx.globalAlpha = 0.5; ctx.lineWidth = 1;
      if (M === 4) { /* axes already drawn */ }
      else if (M === 16) { const lv = pts.map((p) => p.I).filter((v, i, a) => a.indexOf(v) === i).sort((a, b) => a - b); for (let i = 0; i < lv.length - 1; i++) { const m = ((lv[i] + lv[i + 1]) / 2) * R; ctx.beginPath(); ctx.moveTo(cx + m, 0); ctx.lineTo(cx + m, h); ctx.stroke(); ctx.beginPath(); ctx.moveTo(0, cy - m); ctx.lineTo(w, cy - m); ctx.stroke(); } }
      ctx.globalAlpha = 1;
      pts.forEach((s) => { ctx.fillStyle = "#fff"; ctx.beginPath(); ctx.arc(cx + s.I * R, cy - s.Q * R, 3, 0, 7); ctx.fill(); });
    }
  }, [M, snr]);

  const ber = stats.n ? stats.be / (stats.n * Math.log2(M)) : 0;
  return (
    <div>
      <Lead
        notes={[
          { t: "Term", c: C.A, x: "The slicer (decision device) maps each recovered (I, Q) sample to the nearest constellation point, then the demapper reads off that point\u2019s bits. It\u2019s the last step: samples in, bits out." },
          { t: "Intuition", c: C.Q, x: "Draw the decision boundaries halfway between symbols. A sample is decoded as whichever point\u2019s region it falls in. Land in the right region and the bits are perfect; cross a boundary and you get a symbol error." },
          { t: "Heads up", c: C.warn, x: "Thanks to Gray coding, a symbol that slips into an adjacent region usually flips just one bit \u2014 so the bit error rate stays well below the symbol error rate. Coding (Priority 5) cleans up what remains." },
        ]}
        n="08.4" title="The slicer — turning samples back into bits"
        body="Carrier locked, timing locked: now each symbol is a single (I, Q) point sitting near its ideal location. The slicer picks the nearest legal point and the demapper reads its bits. Where noise pushes a sample across a decision boundary, you get an error — colored red here. This is the end of the receiver chain, and the live error counts set up the BER-vs-SNR curve coming in the foundations pass." />
      <div className="iq-grid2">
        <div style={{ display: "grid", gap: 14 }}>
          <Panel label="Decisions — green correct, red sliced to the wrong symbol">
            <canvas ref={cRef} style={{ width: "100%", height: 300, display: "block" }} />
            <p style={{ fontFamily: FONT.body, fontSize: 12.5, color: C.sub, margin: "10px 0 0", lineHeight: 1.5 }}>
              Faint lines are the decision boundaries; white dots the ideal symbols. Drop the SNR until red dots appear where clouds spill across a boundary — each is a symbol error.
            </p>
          </Panel>
        </div>
        <div style={{ display: "grid", gap: 14, alignContent: "start" }}>
          <Panel label="Demodulator">
            <div style={{ display: "grid", gap: 14 }}>
              <Pills value={M} options={[4, 16]} onChange={setM} labels={["QPSK", "16QAM"]} />
              <Slider label="Signal-to-noise ratio (Es/N0)" value={snr} min={2} max={28} step={1} color={C.I} fmt={(v) => v.toFixed(0) + " dB"} onChange={setSnr} />
            </div>
          </Panel>
          <Panel label="Counts (this run)">
            <Readout rows={[
              ["symbols decoded", String(stats.n), C.ink],
              ["symbol errors", String(stats.se), stats.se ? C.warn : C.D],
              ["bit errors", String(stats.be), stats.be ? C.warn : C.D],
              ["bit error rate", ber.toExponential(1), ber < 1e-2 ? C.D : C.warn],
            ]} />
            <div style={{ marginTop: 12, fontFamily: FONT.mono, fontSize: 11, color: C.sub, lineHeight: 1.6, wordBreak: "break-all" }}>
              <span style={{ color: C.faint }}>first decoded bits:</span><br />{stats.bits}
            </div>
          </Panel>
        </div>
      </div>
      <Deeper
        recap="With carrier and timing recovered, each symbol is one point near its ideal spot. The slicer is a nearest-neighbour decision: whichever constellation point is closest wins, and its Gray-coded label is the recovered bits. Errors occur only when noise carries a sample across a decision boundary, and because Gray neighbours differ by one bit, most symbol errors cost a single bit \u2014 keeping the bit error rate below the symbol error rate."
        example={`QPSK decision regions are just the four quadrants:
   received (\u22120.2, +0.9) \u2192 nearest ideal point (\u22120.707,+0.707)
                          \u2192 label 01  \u2192 bits \u201c01\u201d
A sample at (+0.05, +0.9) still lands in the +Q,\u2212I... no:
   (+0.05,+0.9) \u2192 nearest (\u22120.707,+0.707)? distance check picks
   the same quadrant boundary \u2014 a near-miss flips ONE bit, not two,
   because adjacent QPSK labels are Gray-coded (00 01 11 10).

Symbol error rate counts wrong points; bit error rate counts
wrong bits. With Gray coding BER \u2248 SER / log\u2082(M) at high SNR \u2014
the exact link the BER-vs-SNR curve will quantify next.`}
      />
    </div>
  );
}

/* ============================================================
   APP SHELL
   ============================================================ */
const MODULES = [
  { id: "08.1", label: "Pulse shaping & eye", comp: PulseEyeModule },
  { id: "08.2", label: "Carrier recovery", comp: CarrierModule },
  { id: "08.3", label: "Timing recovery", comp: TimingModule },
  { id: "08.4", label: "Slicer → bits", comp: SlicerModule },
];

const DIFF = [2, 3, 3, 2];
const PREDICTS = {"1": {"q": "A small leftover carrier frequency offset makes the constellation...", "options": ["shift sideways", "spin", "shrink"], "answer": 1, "why": "A constant frequency offset rotates the points continuously. The Costas loop's integrator tracks it to a stop."}, "2": {"q": "At the ideal sampling instant, the Gardner timing error is...", "options": ["maximum", "zero", "negative"], "answer": 1, "why": "Its S-curve crosses zero at the optimum; the sign elsewhere tells the loop which way to slide."}};
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
            <Eyebrow>I/Q signal primer · receiver back-end</Eyebrow>
          </div>
          <h1 style={{ fontFamily: FONT.disp, fontSize: 34, fontWeight: 700, margin: "0 0 8px", letterSpacing: "-0.02em", lineHeight: 1.05 }}>From baseband samples to bits</h1>
          <p style={{ fontFamily: FONT.body, fontSize: 15, color: C.sub, maxWidth: 720, lineHeight: 1.6, margin: 0 }}>
            Part 2 delivered a clean baseband stream. Turning it back into bits takes a real receiver chain: shape the pulses and read the eye, recover the carrier with a Costas loop, recover symbol timing with a Gardner detector, then slice to the nearest constellation point. Every plot runs the real loops and filters.
          </p>
          {reduced && <p style={{ fontFamily: FONT.mono, fontSize: 11, color: C.faint, marginTop: 10 }}>Reduced-motion on — the Costas view shows the locked result; everything still responds to controls.</p>}
          <nav style={{ display: "flex", gap: 6, marginTop: 22, flexWrap: "wrap", borderBottom: `1px solid ${C.edge}`, paddingBottom: 16 }}>
            {MODULES.map((m, i) => <button key={m.id} className="iq-tab" data-on={active === i ? "1" : "0"} onClick={() => setActive(i)}><span style={{ color: active === i ? C.Q : C.faint, marginRight: 7 }}>{m.id}</span>{m.label}<span title="math intensity (light / medium / heavy)" style={{ marginLeft: 7, letterSpacing: 1, fontSize: 9 }}>{[0, 1, 2].map((_d) => <span key={_d} style={{ color: _d < DIFF[i] ? (DIFF[i] === 1 ? C.D : DIFF[i] === 2 ? C.I : C.warn) : C.gridFaint }}>{"\u2022"}</span>)}</span></button>)}
          </nav>
        </header>
        {PREDICTS[active] && <Predict q={PREDICTS[active].q} options={PREDICTS[active].options} answer={PREDICTS[active].answer} why={PREDICTS[active].why} />}
        <main key={active}><Comp reduced={reduced} /></main>
        <footer style={{ marginTop: 40, paddingTop: 18, borderTop: `1px solid ${C.gridFaint}`, fontFamily: FONT.body, fontSize: 12, color: C.faint, lineHeight: 1.6 }}>
          Shape, lock the carrier, lock the timing, slice. That chain turns a fuzzy baseband cloud back into the exact bits that were sent — and what slips through is what error-correcting codes will catch later.
        </footer>
      </div>
    </div>
  );
}
