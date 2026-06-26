import { useState, useRef, useEffect } from "react";

/* ============================================================
   IQ EXPLORER · PART 3 — MIMO & SPATIAL STREAMS
   Continues the series: each channel coefficient is a rotating
   arrow (Part 1); antennas sum signals (superposition, Part 1);
   we separate streams with linear algebra — separation by SPACE
   rather than frequency (Part 2). Real math runs throughout.
   ============================================================ */

const C = {
  bg: "#0E1419", panel: "#141D25", panelHi: "#1A2530", edge: "#26343F",
  grid: "#22303A", gridFaint: "#18222B", ink: "#ECE7DB", sub: "#8B98A3",
  faint: "#5A6973", I: "#E8B85C", Q: "#56C7BF", sum: "#ECE7DB",
  A: "#B49BE0", B: "#E58AA6", D: "#86D08A", warn: "#E58AA6",
};
const STREAM = [C.A, C.B, C.D, C.I];
const FONT = {
  disp: "'Space Grotesk', system-ui, -apple-system, sans-serif",
  body: "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif",
  mono: "'Space Mono', ui-monospace, SFMono-Regular, Menlo, monospace",
};

/* ---------- generic helpers ---------- */
const sgn = (x, d = 2) => (x >= 0 ? "+" : "−") + Math.abs(x).toFixed(d);
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
const R2 = Math.SQRT1_2;

function usePrefersReducedMotion() {
  const [r, setR] = useState(false);
  useEffect(() => {
    if (!window.matchMedia) return;
    const m = window.matchMedia("(prefers-reduced-motion: reduce)");
    const h = () => setR(m.matches); h();
    m.addEventListener?.("change", h);
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
function arrow(ctx, x0, y0, x1, y1, color, width = 2, head = 7) {
  const a = Math.atan2(y1 - y0, x1 - x0), len = Math.hypot(x1 - x0, y1 - y0);
  if (len < 0.5) return;
  ctx.strokeStyle = color; ctx.fillStyle = color; ctx.lineWidth = width; ctx.lineCap = "round";
  ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke();
  if (len > head + 2) {
    ctx.beginPath(); ctx.moveTo(x1, y1);
    ctx.lineTo(x1 - head * Math.cos(a - 0.4), y1 - head * Math.sin(a - 0.4));
    ctx.lineTo(x1 - head * Math.cos(a + 0.4), y1 - head * Math.sin(a + 0.4));
    ctx.closePath(); ctx.fill();
  }
}
let _seed = 12345;
function rand() { _seed = (_seed * 1103515245 + 12345) & 0x7fffffff; return _seed / 0x7fffffff; }
function randn() { let u = 0, v = 0; while (u === 0) u = rand(); while (v === 0) v = rand(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); }

/* ---------- complex + linear algebra (verified) ---------- */
const cx = (re, im = 0) => ({ re, im });
const cadd = (a, b) => ({ re: a.re + b.re, im: a.im + b.im });
const csub = (a, b) => ({ re: a.re - b.re, im: a.im - b.im });
const cmul = (a, b) => ({ re: a.re * b.re - a.im * b.im, im: a.re * b.im + a.im * b.re });
const cconj = (a) => ({ re: a.re, im: -a.im });
const cabs = (a) => Math.hypot(a.re, a.im);
const cdiv = (a, b) => { const d = b.re * b.re + b.im * b.im; return { re: (a.re * b.re + a.im * b.im) / d, im: (a.im * b.re - a.re * b.im) / d }; };
const cexp = (p) => ({ re: Math.cos(p), im: Math.sin(p) });
function cInverse(A) {
  const n = A.length;
  const M = A.map((row, i) => row.map((c) => ({ re: c.re, im: c.im })).concat(Array.from({ length: n }, (_, j) => (j === i ? cx(1) : cx(0)))));
  for (let col = 0; col < n; col++) {
    let piv = col, best = cabs(M[col][col]);
    for (let r = col + 1; r < n; r++) { const v = cabs(M[r][col]); if (v > best) { best = v; piv = r; } }
    if (best < 1e-12) return null;
    if (piv !== col) { const t = M[piv]; M[piv] = M[col]; M[col] = t; }
    const pv = M[col][col];
    for (let j = 0; j < 2 * n; j++) M[col][j] = cdiv(M[col][j], pv);
    for (let r = 0; r < n; r++) { if (r === col) continue; const f = M[r][col]; if (f.re === 0 && f.im === 0) continue; for (let j = 0; j < 2 * n; j++) M[r][j] = csub(M[r][j], cmul(f, M[col][j])); }
  }
  return M.map((row) => row.slice(n));
}
const matVec = (A, x) => A.map((row) => row.reduce((s, c, j) => cadd(s, cmul(c, x[j])), cx(0)));
function hConj(A) { const m = A.length, n = A[0].length; const T = Array.from({ length: n }, () => Array(m)); for (let i = 0; i < m; i++) for (let j = 0; j < n; j++) T[j][i] = cconj(A[i][j]); return T; }
function mm(A, B) { const m = A.length, n = B[0].length, p = B.length; const O = Array.from({ length: m }, () => Array.from({ length: n }, () => cx(0))); for (let i = 0; i < m; i++) for (let j = 0; j < n; j++) { let s = cx(0); for (let k = 0; k < p; k++) s = cadd(s, cmul(A[i][k], B[k][j])); O[i][j] = s; } return O; }
function hermGram(H) { return mm(hConj(H), H); }
function jacobiEig(Ain) {
  const n = Ain.length, A = Ain.map((r) => r.slice());
  for (let sweep = 0; sweep < 100; sweep++) {
    let off = 0; for (let p = 0; p < n; p++) for (let q = p + 1; q < n; q++) off += Math.abs(A[p][q]);
    if (off < 1e-14) break;
    for (let p = 0; p < n; p++) for (let q = p + 1; q < n; q++) {
      const apq = A[p][q]; if (Math.abs(apq) < 1e-18) continue;
      const theta = (A[q][q] - A[p][p]) / (2 * apq);
      const t = Math.sign(theta || 1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1));
      const c = 1 / Math.sqrt(t * t + 1), s = t * c;
      for (let k = 0; k < n; k++) { const akp = A[k][p], akq = A[k][q]; A[k][p] = c * akp - s * akq; A[k][q] = s * akp + c * akq; }
      for (let k = 0; k < n; k++) { const apk = A[p][k], aqk = A[q][k]; A[p][k] = c * apk - s * aqk; A[q][k] = s * apk + c * aqk; }
    }
  }
  return Array.from({ length: n }, (_, i) => A[i][i]).sort((a, b) => b - a);
}
function singularValues(H) {
  const G = hermGram(H), n = G.length;
  const M = Array.from({ length: 2 * n }, () => Array(2 * n).fill(0));
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) { M[i][j] = G[i][j].re; M[i][j + n] = -G[i][j].im; M[i + n][j] = G[i][j].im; M[i + n][j + n] = G[i][j].re; }
  const ev = jacobiEig(M), sv = [];
  for (let i = 0; i < 2 * n; i += 2) sv.push(Math.sqrt(Math.max(0, ev[i])));
  return sv;
}
const innerH = (x, y) => x.reduce((s, xk, k) => cadd(s, cmul(cconj(xk), y[k])), cx(0));
const steer = (N, d, deg) => { const th = (deg * Math.PI) / 180; return Array.from({ length: N }, (_, k) => cexp(2 * Math.PI * d * k * Math.sin(th))); };
function nullSteer(N, d, thd, thi) {
  const ad = steer(N, d, thd), ai = steer(N, d, thi);
  const coef = cdiv(innerH(ai, ad), innerH(ai, ai));
  return ad.map((adk, k) => csub(adk, cmul(coef, ai[k])));
}

/* QPSK */
const QPSK = [cx(R2, R2), cx(R2, -R2), cx(-R2, R2), cx(-R2, -R2)];
const randSym = () => QPSK[(rand() * 4) | 0];

/* ---------- UI atoms ---------- */
function Eyebrow({ children }) {
  return <div style={{ fontFamily: FONT.mono, fontSize: 11, letterSpacing: "0.18em", textTransform: "uppercase", color: C.faint }}>{children}</div>;
}
function Panel({ label, children, style }) {
  return (
    <div style={{ background: C.panel, border: `1px solid ${C.edge}`, borderRadius: 10, padding: 16, ...style }}>
      {label && <div style={{ marginBottom: 12 }}><Eyebrow>{label}</Eyebrow></div>}
      {children}
    </div>
  );
}
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
function Pills({ value, options, onChange, color = C.Q }) {
  return (
    <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
      {options.map((o) => (
        <button key={o} onClick={() => onChange(o)} className="iq-mini" data-on={value === o ? "1" : "0"} style={value === o ? { borderColor: color, color } : undefined}>{o}</button>
      ))}
    </div>
  );
}
function Lead({ n, title, body, notes }) {
  return (
    <div style={{ marginBottom: 20 }}>
      <div style={{ maxWidth: 730 }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 12, marginBottom: 6 }}>
          <span style={{ fontFamily: FONT.mono, fontSize: 13, color: C.Q }}>{n}</span>
          <h2 style={{ fontFamily: FONT.disp, fontSize: 23, fontWeight: 600, color: C.ink, margin: 0, letterSpacing: "-0.01em" }}>{title}</h2>
        </div>
        <p style={{ fontFamily: FONT.body, fontSize: 14.5, color: C.sub, lineHeight: 1.62, margin: 0 }}>{body}</p>
      </div>
      {notes && (
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 16, maxWidth: 920 }}>
          {notes.map((nt, i) => (
            <div key={i} style={{ flex: "1 1 200px", minWidth: 175, background: C.panel, border: `1px solid ${C.edge}`, borderLeft: `2px solid ${nt.c}`, borderRadius: 8, padding: "10px 12px" }}>
              <div style={{ fontFamily: FONT.mono, fontSize: 9.5, letterSpacing: "0.16em", textTransform: "uppercase", color: nt.c, marginBottom: 5 }}>{nt.t}</div>
              <div style={{ fontFamily: FONT.body, fontSize: 12.5, color: C.sub, lineHeight: 1.5 }}>{nt.x}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
function Readout({ rows }) {
  return (
    <div style={{ display: "grid", gap: 8 }}>
      {rows.map(([label, val, color], i) => (
        <div key={i} style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", borderBottom: `1px solid ${C.gridFaint}`, paddingBottom: 6 }}>
          <span style={{ fontFamily: FONT.body, fontSize: 12, color: C.sub }}>{label}</span>
          <span style={{ fontFamily: FONT.mono, fontSize: 14, color: color || C.ink }}>{val}</span>
        </div>
      ))}
    </div>
  );
}
function Deeper({ recap, example }) {
  const [open, setOpen] = useState(false);
  return (
    <div style={{ marginTop: 18 }}>
      <button onClick={() => setOpen(!open)} className="iq-mini" data-on={open ? "1" : "0"} style={{ fontSize: 11.5, padding: "7px 13px" }}>
        {open ? "▾  hide the deeper dive" : "▸  go deeper — recap & a worked example"}
      </button>
      {open && (
        <div style={{ marginTop: 12, background: C.panel, border: `1px solid ${C.edge}`, borderRadius: 10, padding: 18, maxWidth: 940 }}>
          <div style={{ fontFamily: FONT.mono, fontSize: 9.5, letterSpacing: "0.16em", textTransform: "uppercase", color: C.Q, marginBottom: 6 }}>So what just happened</div>
          <p style={{ fontFamily: FONT.body, fontSize: 13.5, color: C.sub, lineHeight: 1.62, margin: "0 0 16px" }}>{recap}</p>
          <div style={{ fontFamily: FONT.mono, fontSize: 9.5, letterSpacing: "0.16em", textTransform: "uppercase", color: C.I, marginBottom: 8 }}>Worked example</div>
          <div style={{ fontFamily: FONT.mono, fontSize: 12, color: C.ink, lineHeight: 1.65, background: C.bg, border: `1px solid ${C.gridFaint}`, borderRadius: 8, padding: "12px 14px", whiteSpace: "pre-wrap", overflowX: "auto" }}>{example}</div>
        </div>
      )}
    </div>
  );
}

/* ---------- shared drawing ---------- */
function constellation(ctx, w, h, groups, range, opts = {}) {
  ctx.clearRect(0, 0, w, h);
  const cx0 = w / 2, cy0 = h / 2, R = Math.min(w, h) * 0.42 / range;
  ctx.strokeStyle = C.gridFaint; ctx.lineWidth = 1;
  for (let g = -2; g <= 2; g++) { ctx.beginPath(); ctx.moveTo(cx0 + g * R, 0); ctx.lineTo(cx0 + g * R, h); ctx.stroke(); ctx.beginPath(); ctx.moveTo(0, cy0 + g * R); ctx.lineTo(w, cy0 + g * R); ctx.stroke(); }
  ctx.strokeStyle = C.edge; ctx.lineWidth = 1.2;
  ctx.beginPath(); ctx.moveTo(0, cy0); ctx.lineTo(w, cy0); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(cx0, 0); ctx.lineTo(cx0, h); ctx.stroke();
  if (opts.ref) { // faint QPSK reference markers
    ctx.strokeStyle = C.faint;
    QPSK.forEach((p) => { const x = cx0 + p.re * R, y = cy0 - p.im * R; ctx.beginPath(); ctx.moveTo(x - 4, y); ctx.lineTo(x + 4, y); ctx.moveTo(x, y - 4); ctx.lineTo(x, y + 4); ctx.stroke(); });
  }
  groups.forEach((gr) => {
    ctx.fillStyle = gr.color;
    const sz = gr.size || 2.2;
    gr.pts.forEach((p) => { ctx.globalAlpha = gr.alpha == null ? 1 : gr.alpha; ctx.beginPath(); ctx.arc(cx0 + p.re * R, cy0 - p.im * R, sz, 0, 7); ctx.fill(); });
    ctx.globalAlpha = 1;
  });
}

/* ============================================================
   MODULE 09 — THE CHANNEL IS A MATRIX
   ============================================================ */
function makeH2(deltaDeg) {
  const d = (deltaDeg * Math.PI) / 180;
  // two unit column-signatures separated in phase by delta -> full mixing
  return [
    [cx(R2), cx(R2)],
    [cmul(cx(R2), cexp(-d / 2)), cmul(cx(R2), cexp(d / 2))],
  ];
}
function ChannelModule({ reduced }) {
  const diagRef = useRef(null), rx1Ref = useRef(null), rx2Ref = useRef(null), txRef = useRef(null);
  const [delta, setDelta] = useState(120);
  const st = useRef({ delta }); st.current = { delta };
  const cloud = useRef({ rx1: [], rx2: [] });

  function recompute() {
    const H = makeH2(st.current.delta);
    const r1 = [], r2 = [];
    for (const a of QPSK) for (const b of QPSK) { const y = matVec(H, [a, b]); r1.push(y[0]); r2.push(y[1]); }
    cloud.current = { rx1: r1, rx2: r2, H };
    drawDiagram(H);
  }
  function drawDiagram(H) {
    const cv = diagRef.current; if (!cv) return;
    const w = cv.clientWidth, h = cv.clientHeight;
    const ctx = cv._ctx || (cv._ctx = fitCanvas(cv, w, h));
    ctx.clearRect(0, 0, w, h);
    const txx = w * 0.18, rxx = w * 0.82, y0 = h * 0.3, y1 = h * 0.7;
    const TX = [[txx, y0], [txx, y1]], RX = [[rxx, y0], [rxx, y1]];
    // links coloured by source stream, thickness ~ |h|
    for (let r = 0; r < 2; r++) for (let t = 0; t < 2; t++) {
      const mag = cabs(H[r][t]);
      ctx.strokeStyle = STREAM[t] + "AA"; ctx.lineWidth = 0.8 + mag * 3.5;
      ctx.beginPath(); ctx.moveTo(TX[t][0], TX[t][1]); ctx.lineTo(RX[r][0], RX[r][1]); ctx.stroke();
    }
    const node = (x, y, label, col) => {
      ctx.fillStyle = C.panelHi; ctx.strokeStyle = col; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(x, y, 13, 0, 7); ctx.fill(); ctx.stroke();
      ctx.fillStyle = col; ctx.font = `11px ${FONT.mono}`; ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.fillText(label, x, y);
    };
    node(TX[0][0], TX[0][1], "T1", STREAM[0]); node(TX[1][0], TX[1][1], "T2", STREAM[1]);
    node(RX[0][0], RX[0][1], "R1", C.ink); node(RX[1][0], RX[1][1], "R2", C.ink);
    ctx.fillStyle = C.faint; ctx.font = `10px ${FONT.mono}`; ctx.textBaseline = "alphabetic";
    ctx.textAlign = "center"; ctx.fillText("transmit", txx, h - 8); ctx.fillText("receive", rxx, h - 8);
    ctx.fillStyle = C.sub; ctx.fillText("each R hears BOTH streams, mixed", w / 2, 16);
  }
  function drawScatter(t) {
    const { rx1, rx2 } = cloud.current; if (!rx1) return;
    // animated highlighted symbol pair
    const s = Math.floor(t * 2.2);
    const a = QPSK[s % 4], b = QPSK[(s * 3 + 1) % 4];
    const H = cloud.current.H;
    const y = matVec(H, [a, b]);
    const c1 = rx1Ref.current, c2 = rx2Ref.current, ct = txRef.current;
    if (ct) { const ctx = ct._ctx || (ct._ctx = fitCanvas(ct, ct.clientWidth, ct.clientHeight)); constellation(ctx, ct.clientWidth, ct.clientHeight, [{ pts: QPSK, color: C.faint, size: 2 }, { pts: [a], color: STREAM[0], size: 5 }, { pts: [b], color: STREAM[1], size: 5 }], 1.6, { ref: false }); }
    if (c1) { const ctx = c1._ctx || (c1._ctx = fitCanvas(c1, c1.clientWidth, c1.clientHeight)); constellation(ctx, c1.clientWidth, c1.clientHeight, [{ pts: rx1, color: C.faint, size: 2, alpha: 0.5 }, { pts: [y[0]], color: C.sum, size: 5 }], 2.0); }
    if (c2) { const ctx = c2._ctx || (c2._ctx = fitCanvas(c2, c2.clientWidth, c2.clientHeight)); constellation(ctx, c2.clientWidth, c2.clientHeight, [{ pts: rx2, color: C.faint, size: 2, alpha: 0.5 }, { pts: [y[1]], color: C.sum, size: 5 }], 2.0); }
  }
  useEffect(() => { recompute(); if (reduced) drawScatter(0.3); }, [delta, reduced]);
  useRaf((t) => drawScatter(t), !reduced);

  return (
    <div>
      <Lead
        notes={[
          { t: "Term", c: C.A, x: "Channel matrix H: stack the path gains into a grid. Entry hⱼᵢ is the complex gain (an arrow: magnitude + phase) from transmit antenna i to receive antenna j. The whole link is y = Hx + noise." },
          { t: "Intuition", c: C.Q, x: "It’s Part 1’s superposition again — but in space. Send different data from each antenna and every receive antenna hears the weighted sum of all of them. One mixture per receiver." },
          { t: "Try it", c: C.D, x: "The two received clouds look like scrambled blobs — no single antenna can read either stream alone. Yet two antennas hearing two different mixtures is exactly enough to solve for both, which is the next lesson." },
        ]}
        n="09" title="Many antennas: the channel becomes a matrix"
        body="MIMO means multiple transmit and multiple receive antennas. Every transmit–receive pair has its own path with its own gain and phase, so the channel is no longer a single number — it's a matrix H of complex coefficients. Send one symbol per transmit antenna at the same time and frequency, and each receive antenna captures a different weighted sum of them all." />
      <div className="iq-grid2">
        <div style={{ display: "grid", gap: 14 }}>
          <Panel label="A 2×2 link — both streams reach both antennas">
            <canvas ref={diagRef} style={{ width: "100%", height: 200, display: "block" }} />
          </Panel>
          <Panel label="Transmitted — two independent QPSK streams">
            <div style={{ display: "flex", gap: 14, justifyContent: "center" }}>
              <div style={{ textAlign: "center" }}>
                <canvas ref={txRef} style={{ width: 170, height: 170, display: "block" }} />
                <div style={{ fontFamily: FONT.mono, fontSize: 11, marginTop: 6 }}><span style={{ color: STREAM[0] }}>● stream A</span> &nbsp; <span style={{ color: STREAM[1] }}>● stream B</span></div>
              </div>
            </div>
          </Panel>
        </div>
        <div style={{ display: "grid", gap: 14, alignContent: "start" }}>
          <Panel label="Received — each antenna sees a mixture">
            <div style={{ display: "flex", gap: 12, justifyContent: "space-around" }}>
              <div style={{ textAlign: "center" }}><canvas ref={rx1Ref} style={{ width: 150, height: 150, display: "block" }} /><div style={{ fontFamily: FONT.mono, fontSize: 11, color: C.ink, marginTop: 5 }}>antenna R1</div></div>
              <div style={{ textAlign: "center" }}><canvas ref={rx2Ref} style={{ width: 150, height: 150, display: "block" }} /><div style={{ fontFamily: FONT.mono, fontSize: 11, color: C.ink, marginTop: 5 }}>antenna R2</div></div>
            </div>
            <p style={{ fontFamily: FONT.body, fontSize: 12.5, color: C.sub, margin: "10px 0 0", lineHeight: 1.5 }}>
              Faint dots are every possible mixture; the bright dot follows the current transmitted pair. Neither cloud is a clean 4-point QPSK anymore.
            </p>
          </Panel>
          <Panel label="Channel">
            <Slider label="Spatial separation of the two streams" value={delta} min={8} max={180} step={1} color={C.Q} fmt={(v) => v.toFixed(0) + "°"} onChange={setDelta} />
            <p style={{ fontFamily: FONT.body, fontSize: 12.5, color: C.sub, margin: "12px 0 0", lineHeight: 1.55 }}>
              How differently the two streams arrive across the antenna array. Near 180° their signatures are very distinct; near 0° they look almost the same to the receiver — remember that for the next lesson.
            </p>
          </Panel>
        </div>
      </div>
      <Deeper
        recap="You're watching y = Hx + n. Two antennas transmit the symbol pair x = [x₁, x₂]; the 2×2 matrix H mixes them, so each receive antenna captures a different blend. No single antenna sees a clean stream — but because the two blends differ, two equations in two unknowns are enough to recover both, which is exactly what the next module does."
        example={`Take Δ = 90°, so
  H = [ 0.707      0.707     ]
      [ 0.5−0.5j   0.5+0.5j  ]

Transmit pattern A,  x = [ 1,  1 ]:
  y₁ = 0.707·1 + 0.707·1         = 1.414
  y₂ = (0.5−0.5j) + (0.5+0.5j)   = 1.0

Transmit pattern B,  x = [ 1, −1 ]:
  y₁ = 0.707 − 0.707            = 0
  y₂ = (0.5−0.5j) − (0.5+0.5j) = −j

Same two antennas, but the two patterns leave completely
different fingerprints at the receiver: (1.414, 1) vs (0, −j).
That difference is what makes the streams separable.`}
      />
    </div>
  );
}

/* ============================================================
   MODULE 10 — SEPARATING STREAMS (zero-forcing / MMSE)
   ============================================================ */
function DetectModule({ reduced }) {
  const aRef = useRef(null), bRef = useRef(null);
  const [delta, setDelta] = useState(120);
  const [snr, setSnr] = useState(18);
  const [det, setDet] = useState("ZF");

  function recompute() {
    const H = makeH2(delta);
    const N0 = Math.pow(10, -snr / 10);
    const sigma = Math.sqrt(N0 / 2);
    let W;
    if (det === "ZF") W = cInverse(H);
    else { const Hh = hConj(H); const G = mm(Hh, H); for (let i = 0; i < 2; i++) G[i][i] = cadd(G[i][i], cx(N0)); W = mm(cInverse(G), Hh); }
    const gA = [], gB = [];
    const T = 240;
    for (let i = 0; i < T; i++) {
      const x = [randSym(), randSym()];
      const y = matVec(H, x).map((v) => cadd(v, cx(sigma * randn(), sigma * randn())));
      const xh = matVec(W, y);
      gA.push(xh[0]); gB.push(xh[1]);
    }
    const sv = singularValues(H);
    const cond = sv[0] / Math.max(sv[1], 1e-6);
    const draw = (ref, pts, color) => { const cv = ref.current; if (!cv) return; const ctx = cv._ctx || (cv._ctx = fitCanvas(cv, cv.clientWidth, cv.clientHeight)); constellation(ctx, cv.clientWidth, cv.clientHeight, [{ pts, color, size: 2, alpha: 0.7 }], 2.6, { ref: true }); };
    draw(aRef, gA, STREAM[0]); draw(bRef, gB, STREAM[1]);
    return { cond, sep: Math.abs(Math.sin((delta * Math.PI) / 360)) };
  }
  const [info, setInfo] = useState({ cond: 1, sep: 1 });
  useEffect(() => { setInfo(recompute()); }, [delta, snr, det]);

  const sepPct = Math.round(info.sep * 100);
  return (
    <div>
      <Lead
        notes={[
          { t: "Term", c: C.A, x: "Zero-forcing: multiply the received vector by H⁻¹ to undo the channel exactly, x̂ = H⁻¹y. With as many receive antennas as streams, the mixtures form a solvable system of equations." },
          { t: "Intuition", c: C.Q, x: "Same idea as the FFT in Part 2 — a linear operation un-mixes the sum. There the axis was frequency; here it’s space, set by where the antennas sit and how the paths differ." },
          { t: "Heads up", c: C.warn, x: "When the two streams’ spatial signatures are nearly identical, inverting the channel blows up the noise — the recovered clouds explode. That’s an ill-conditioned channel; MMSE handles it more gracefully than ZF." },
        ]}
        n="10" title="Separate the streams by inverting the channel"
        body="Each receive antenna gave a different equation in the same unknowns (the transmitted symbols). Stack them and solve the linear system: zero-forcing multiplies by H⁻¹ to peel the streams apart, recovering one clean constellation per stream. It works beautifully when the spatial signatures differ — and falls apart, amplifying noise, when they don't." />
      <div className="iq-grid2">
        <div style={{ display: "grid", gap: 14 }}>
          <Panel label="Recovered streams (after the detector)">
            <div style={{ display: "flex", gap: 12, justifyContent: "space-around" }}>
              <div style={{ textAlign: "center" }}><canvas ref={aRef} style={{ width: 180, height: 180, display: "block" }} /><div style={{ fontFamily: FONT.mono, fontSize: 11, color: STREAM[0], marginTop: 5 }}>stream A</div></div>
              <div style={{ textAlign: "center" }}><canvas ref={bRef} style={{ width: 180, height: 180, display: "block" }} /><div style={{ fontFamily: FONT.mono, fontSize: 11, color: STREAM[1], marginTop: 5 }}>stream B</div></div>
            </div>
            <p style={{ fontFamily: FONT.body, fontSize: 12.5, color: C.sub, margin: "10px 0 0", lineHeight: 1.5 }}>
              Tight clusters on the four reference crosses = clean separation. Lower the spatial separation and watch the clouds smear, then explode.
            </p>
          </Panel>
        </div>
        <div style={{ display: "grid", gap: 14, alignContent: "start" }}>
          <Panel label="Detector">
            <div style={{ display: "grid", gap: 16 }}>
              <div>
                <div style={{ fontSize: 13, color: C.sub, fontFamily: FONT.body, marginBottom: 6 }}>Algorithm</div>
                <Pills value={det} options={["ZF", "MMSE"]} onChange={setDet} />
              </div>
              <Slider label="Spatial separation of streams" value={delta} min={8} max={180} step={1} color={C.Q} fmt={(v) => v.toFixed(0) + "°"} onChange={setDelta} />
              <Slider label="Signal-to-noise ratio" value={snr} min={0} max={30} step={1} color={C.I} fmt={(v) => v.toFixed(0) + " dB"} onChange={setSnr} />
            </div>
          </Panel>
          <Panel label="Channel health">
            <Readout rows={[
              ["separability  |sin(Δ/2)|", sepPct + "%", sepPct > 50 ? C.D : C.warn],
              ["condition number  σ₁/σ₂", info.cond.toFixed(1), info.cond < 4 ? C.D : C.warn],
            ]} />
            <p style={{ fontFamily: FONT.body, fontSize: 12.5, color: C.sub, margin: "12px 0 0", lineHeight: 1.55 }}>
              A condition number near 1 is a healthy channel. As it grows, H⁻¹ magnifies noise; switch to <span style={{ color: C.ink }}>MMSE</span> at low separation to see it trade a little bias for far less noise blow-up.
            </p>
          </Panel>
        </div>
      </div>
      <Deeper
        recap="Zero-forcing solves the linear system by multiplying the received vector by H⁻¹: x̂ = H⁻¹y. With a healthy channel and modest noise the symbols return cleanly. The danger lives inside H⁻¹ — when the two columns of H point nearly the same way the determinant shrinks, the inverse's entries blow up, and the noise is amplified along with the signal. MMSE replaces H⁻¹ with (HᴴH + σ²I)⁻¹Hᴴ, capping that blow-up by tolerating a little leftover mixing."
        example={`For this channel  |det H| = sin(Δ/2),
and H⁻¹ scales the noise by about  1 / sin(Δ/2):

  Δ = 120°  →  sin 60° = 0.87  →  noise ×1.15   (barely)
  Δ =  60°  →  sin 30° = 0.50  →  noise ×2.0
  Δ =  30°  →  sin 15° = 0.26  →  noise ×3.9    (cloud bursts)
  Δ =  10°  →  sin  5° = 0.087 →  noise ×11     (unusable)

That multiplier is the condition number at work: as the two
spatial signatures align, separating them costs ever more
amplified noise. Drop SNR or Δ and watch the clusters smear
into each other.`}
      />
    </div>
  );
}

/* ============================================================
   MODULE 11 — PARALLEL PIPES (SVD / eigen-channels)
   ============================================================ */
function dft(N) {
  const M = Array.from({ length: N }, (_, r) => Array.from({ length: N }, (_, c) => cexp((-2 * Math.PI * r * c) / N)));
  return M.map((row) => row.map((v) => cmul(v, cx(1 / Math.sqrt(N)))));
}
function channelByRichness(N, rho) {
  const rich = dft(N); // orthonormal columns
  const v = rich.map((row) => row[0]); // first column
  const corr = Array.from({ length: N }, (_, r) => Array.from({ length: N }, () => v[r])); // rank-1: all columns equal
  let H = Array.from({ length: N }, (_, r) => Array.from({ length: N }, (_, c) => cadd(cmul(corr[r][c], cx(1 - rho)), cmul(rich[r][c], cx(rho)))));
  // normalize so sum of squared singular values = N
  let fro = 0; for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) fro += H[r][c].re * H[r][c].re + H[r][c].im * H[r][c].im;
  const s = Math.sqrt(N / fro); H = H.map((row) => row.map((x) => cmul(x, cx(s))));
  return H;
}
function waterfill(gains, N0, P) {
  const inv = gains.map((g) => N0 / Math.max(g, 1e-9));
  let lo = Math.min(...inv), hi = Math.max(...inv) + P, mu = 0;
  for (let it = 0; it < 80; it++) { mu = (lo + hi) / 2; const sum = inv.reduce((s, f) => s + Math.max(0, mu - f), 0); if (sum > P) hi = mu; else lo = mu; }
  const p = inv.map((f) => Math.max(0, mu - f));
  return { p, mu, inv };
}
function PipesModule() {
  const svRef = useRef(null), wfRef = useRef(null);
  const [N, setN] = useState(4);
  const [rho, setRho] = useState(0.85);
  const [snr, setSnr] = useState(15);

  const [cap, setCap] = useState(0);
  const [streams, setStreams] = useState(0);
  useEffect(() => {
    const H = channelByRichness(N, rho);
    const sv = singularValues(H);
    const gains = sv.map((s) => s * s);
    const N0 = N / Math.pow(10, snr / 10);
    const P = N;
    const { p, inv, mu } = waterfill(gains, N0, P);
    const C_ = gains.reduce((s, g, i) => s + Math.log2(1 + (g * p[i]) / N0), 0);
    setCap(C_); setStreams(gains.filter((g) => g / gains[0] > 0.05).length);

    // singular-value bars
    let cv = svRef.current;
    if (cv) {
      const ctx = cv._ctx || (cv._ctx = fitCanvas(cv, cv.clientWidth, cv.clientHeight));
      const w = cv.clientWidth, h = cv.clientHeight, padB = 24, padT = 10, plotH = h - padB - padT, bw = w / N;
      ctx.clearRect(0, 0, w, h);
      const mx = Math.max(...sv);
      for (let i = 0; i < N; i++) {
        const bh = (sv[i] / mx) * plotH * 0.95, x = i * bw;
        const active = sv[i] / sv[0] > 0.05;
        ctx.fillStyle = (active ? C.Q : C.faint) + "33"; ctx.fillRect(x + 3, padT, bw - 6, plotH);
        ctx.fillStyle = active ? C.Q : C.faint; ctx.fillRect(x + 3, padT + plotH - bh, bw - 6, bh);
        ctx.fillStyle = C.sub; ctx.font = `10px ${FONT.mono}`; ctx.textAlign = "center";
        ctx.fillText("σ" + (i + 1), x + bw / 2, h - 8);
      }
    }
    // water-filling picture
    cv = wfRef.current;
    if (cv) {
      const ctx = cv._ctx || (cv._ctx = fitCanvas(cv, cv.clientWidth, cv.clientHeight));
      const w = cv.clientWidth, h = cv.clientHeight, padB = 24, padT = 12, plotH = h - padB - padT, bw = w / N;
      ctx.clearRect(0, 0, w, h);
      const top = Math.max(mu, Math.max(...inv.filter((f) => isFinite(f)))) * 1.15 || 1;
      const yOf = (val) => padT + plotH - (val / top) * plotH;
      // water level
      ctx.fillStyle = "rgba(86,199,191,0.10)"; ctx.fillRect(0, yOf(mu), w, padT + plotH - yOf(mu));
      ctx.strokeStyle = C.Q; ctx.setLineDash([4, 3]); ctx.beginPath(); ctx.moveTo(0, yOf(mu)); ctx.lineTo(w, yOf(mu)); ctx.stroke(); ctx.setLineDash([]);
      for (let i = 0; i < N; i++) {
        const x = i * bw, floor = Math.min(inv[i], top);
        // ground (noise/gain)
        ctx.fillStyle = "#2b3a45"; ctx.fillRect(x + 4, yOf(floor), bw - 8, padT + plotH - yOf(floor));
        // allocated power (water above ground)
        if (p[i] > 0) { ctx.fillStyle = C.Q; ctx.fillRect(x + 4, yOf(mu), bw - 8, yOf(floor) - yOf(mu)); }
        ctx.fillStyle = C.sub; ctx.font = `10px ${FONT.mono}`; ctx.textAlign = "center"; ctx.fillText("ch" + (i + 1), x + bw / 2, h - 8);
      }
      ctx.fillStyle = C.faint; ctx.textAlign = "left"; ctx.fillText("ground = noise/gain · water = power", 6, padT - 2);
    }
  }, [N, rho, snr]);

  return (
    <div>
      <Lead
        notes={[
          { t: "Term", c: C.A, x: "SVD: any channel factors as H = UΣVᴴ. With the right precoding (V) and combining (U), MIMO turns into min(Nt,Nr) independent scalar channels whose gains are the singular values σᵢ." },
          { t: "Intuition", c: C.Q, x: "Picture parallel pipes of different widths. How many carry useful data = the channel’s rank. Rich scattering opens several fat pipes (many streams); pure line-of-sight leaves one (just one stream)." },
          { t: "Heads up", c: C.warn, x: "More antennas only multiply throughput if the channel is rich enough to give them independent pipes. That’s why MIMO loves multipath — reflections that ruin a simple link create the diversity MIMO feeds on." },
        ]}
        n="11" title="MIMO is several parallel pipes in disguise"
        body="The deepest view: the SVD diagonalizes the channel into independent sub-channels — parallel pipes, each with its own gain σ. The number of strong pipes is how many spatial streams you can actually run. Water-filling then pours transmit power preferentially into the better pipes. Drag the channel from line-of-sight toward rich scattering and watch the pipes equalize and capacity climb." />
      <div className="iq-grid2">
        <div style={{ display: "grid", gap: 14 }}>
          <Panel label="Singular values — the pipe gains">
            <canvas ref={svRef} style={{ width: "100%", height: 150, display: "block" }} />
            <p style={{ fontFamily: FONT.body, fontSize: 12.5, color: C.sub, margin: "10px 0 0", lineHeight: 1.5 }}>
              Cyan bars are usable pipes; grey bars have collapsed — those streams are effectively unavailable on this channel.
            </p>
          </Panel>
          <Panel label="Water-filling — pour power into the good pipes">
            <canvas ref={wfRef} style={{ width: "100%", height: 150, display: "block" }} />
          </Panel>
        </div>
        <div style={{ display: "grid", gap: 14, alignContent: "start" }}>
          <Panel label="Configuration">
            <div style={{ display: "grid", gap: 16 }}>
              <div>
                <div style={{ fontSize: 13, color: C.sub, fontFamily: FONT.body, marginBottom: 6 }}>Antennas (N × N)</div>
                <Pills value={N} options={[2, 3, 4]} onChange={setN} />
              </div>
              <Slider label="Channel richness (LOS → scattering)" value={rho} min={0} max={1} step={0.01} color={C.Q} fmt={(v) => (v * 100).toFixed(0) + "%"} onChange={setRho} />
              <Slider label="Signal-to-noise ratio" value={snr} min={0} max={30} step={1} color={C.I} fmt={(v) => v.toFixed(0) + " dB"} onChange={setSnr} />
            </div>
          </Panel>
          <Panel label="Result">
            <Readout rows={[
              ["usable spatial streams", `${streams} of ${N}`, C.D],
              ["capacity (water-filled)", cap.toFixed(1) + " bit/s/Hz", C.ink],
            ]} />
            <p style={{ fontFamily: FONT.body, fontSize: 12.5, color: C.sub, margin: "12px 0 0", lineHeight: 1.55 }}>
              At 0% richness the channel is rank-1 — one fat pipe, one stream, no MIMO gain. Crank richness up and the extra antennas finally pay off.
            </p>
          </Panel>
        </div>
      </div>
      <Deeper
        recap="The SVD factors H = UΣVᴴ. Transmit along the V directions and combine along the U directions, and the channel becomes Σ — a diagonal of independent gains σ₁ ≥ σ₂ ≥ … Each σᵢ is one private pipe whose rate grows with σᵢ². The count of non-tiny singular values is how many spatial streams the air will actually carry; water-filling then pours power preferentially into the strongest pipes."
        example={`A 2×2 channel, total power fixed (σ₁²+σ₂² = 2), SNR 15 dB:

  Rich scattering   σ = [1.00, 1.00]  →  two equal pipes
                    capacity ≈ 8.1 bit/s/Hz
  Line-of-sight     σ = [1.41, 0.00]  →  one pipe, one dead
                    capacity ≈ 6.0 bit/s/Hz

Same antennas, same total power — the rich channel carries
~35% more because it offers a second usable pipe. Water-filling
won't even feed the dead pipe: its noise floor N₀/σ² sits above
the waterline, so it receives zero power.`}
      />
    </div>
  );
}

/* ============================================================
   MODULE 12 — BEAMFORMING (phased array, steering & nulling)
   ============================================================ */
function BeamModule() {
  const polRef = useRef(null);
  const [N, setN] = useState(8);
  const [d, setD] = useState(0.5);
  const [steerDeg, setSteerDeg] = useState(20);
  const [taper, setTaper] = useState(false);
  const [doNull, setDoNull] = useState(false);
  const [intDeg, setIntDeg] = useState(-30);

  const [gains, setGains] = useState({ des: 1, intf: 0 });
  useEffect(() => {
    let w = doNull ? nullSteer(N, d, steerDeg, intDeg) : steer(N, d, steerDeg);
    if (taper) { const win = (k) => 0.54 - 0.46 * Math.cos((2 * Math.PI * k) / (N - 1)); w = w.map((wk, k) => cmul(wk, cx(win(k)))); }
    const resp = (deg) => cabs(innerH(w, steer(N, d, deg)));
    let mx = 0; for (let a = -90; a <= 90; a += 0.5) mx = Math.max(mx, resp(a));
    const cv = polRef.current; if (!cv) return;
    const ctx = cv._ctx || (cv._ctx = fitCanvas(cv, cv.clientWidth, cv.clientHeight));
    const w0 = cv.clientWidth, h0 = cv.clientHeight, cx0 = w0 / 2, cy0 = h0 - 16, R = Math.min(w0 / 2 - 14, h0 - 30);
    ctx.clearRect(0, 0, w0, h0);
    // rings + angle ticks (upper half plane)
    ctx.strokeStyle = C.gridFaint; ctx.lineWidth = 1;
    for (let rr = 0.25; rr <= 1.001; rr += 0.25) { ctx.beginPath(); ctx.arc(cx0, cy0, R * rr, Math.PI, 2 * Math.PI); ctx.stroke(); }
    ctx.fillStyle = C.faint; ctx.font = `10px ${FONT.mono}`;
    [-90, -45, 0, 45, 90].forEach((a) => { const th = (a * Math.PI) / 180; const x = cx0 + R * Math.sin(th), y = cy0 - R * Math.cos(th); ctx.strokeStyle = C.gridFaint; ctx.beginPath(); ctx.moveTo(cx0, cy0); ctx.lineTo(x, y); ctx.stroke(); ctx.textAlign = "center"; ctx.fillStyle = C.faint; ctx.fillText(a + "°", cx0 + (R + 9) * Math.sin(th), cy0 - (R + 9) * Math.cos(th) + 3); });
    // markers
    const ray = (deg, col, label) => { const th = (deg * Math.PI) / 180; const x = cx0 + R * Math.sin(th), y = cy0 - R * Math.cos(th); ctx.strokeStyle = col; ctx.setLineDash([3, 3]); ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(cx0, cy0); ctx.lineTo(x, y); ctx.stroke(); ctx.setLineDash([]); ctx.fillStyle = col; ctx.font = `10px ${FONT.mono}`; ctx.textAlign = "center"; ctx.fillText(label, x, y - 4); };
    // beam pattern fill
    const grad = ctx.createRadialGradient(cx0, cy0, 0, cx0, cy0, R);
    grad.addColorStop(0, "rgba(232,184,92,0.35)"); grad.addColorStop(1, "rgba(232,184,92,0.05)");
    ctx.beginPath(); ctx.moveTo(cx0, cy0);
    for (let a = -90; a <= 90; a += 0.5) { const th = (a * Math.PI) / 180; const rr = (resp(a) / mx) * R; ctx.lineTo(cx0 + rr * Math.sin(th), cy0 - rr * Math.cos(th)); }
    ctx.closePath(); ctx.fillStyle = grad; ctx.fill();
    ctx.strokeStyle = C.I; ctx.lineWidth = 1.8; ctx.beginPath();
    let started = false;
    for (let a = -90; a <= 90; a += 0.5) { const th = (a * Math.PI) / 180; const rr = (resp(a) / mx) * R; const x = cx0 + rr * Math.sin(th), y = cy0 - rr * Math.cos(th); started ? ctx.lineTo(x, y) : ctx.moveTo(x, y); started = true; }
    ctx.stroke();
    ray(steerDeg, C.D, "target");
    if (doNull) ray(intDeg, C.warn, "null");
    setGains({ des: resp(steerDeg) / mx, intf: resp(intDeg) / mx });
  }, [N, d, steerDeg, taper, doNull, intDeg]);

  return (
    <div>
      <Lead
        notes={[
          { t: "Term", c: C.A, x: "Beamforming: pick the phase (and amplitude) on each antenna so their signals add up toward one direction. A linear phase ramp across the array steers the main lobe to any angle." },
          { t: "Intuition", c: C.Q, x: "Multiplexing reads many streams at once; beamforming instead concentrates energy spatially — a flashlight you aim with arithmetic. The same trick can place a deep null on an interferer." },
          { t: "Heads up", c: C.warn, x: "Spacing matters: beyond half a wavelength, copies of the main lobe appear (grating lobes). Tapering the amplitudes lowers the sidelobes at the cost of a wider main beam." },
        ]}
        n="12" title="Beamforming — aim the array, null the interference"
        body="Multiple antennas don't have to carry separate streams; you can also use them to shape where energy goes. Setting the right phase per element steers a beam toward your target, and choosing weights orthogonal to an interferer's direction drops a null right on it. This array gain and interference rejection is the engine behind multi-user and massive MIMO in 5G and Wi-Fi." />
      <div className="iq-grid2">
        <div style={{ display: "grid", gap: 14 }}>
          <Panel label="Beam pattern — gain vs angle">
            <canvas ref={polRef} style={{ width: "100%", height: 260, display: "block" }} />
            <p style={{ fontFamily: FONT.body, fontSize: 12.5, color: C.sub, margin: "10px 0 0", lineHeight: 1.5 }}>
              The lobe points where you steer. Turn on nulling and the pattern pinches to zero exactly at the interferer — full gain on your target, none wasted on the jammer.
            </p>
          </Panel>
        </div>
        <div style={{ display: "grid", gap: 14, alignContent: "start" }}>
          <Panel label="Array & steering">
            <div style={{ display: "grid", gap: 16 }}>
              <div><div style={{ fontSize: 13, color: C.sub, fontFamily: FONT.body, marginBottom: 6 }}>Elements</div><Pills value={N} options={[2, 4, 8, 16]} onChange={setN} /></div>
              <Slider label="Steer toward target" value={steerDeg} min={-80} max={80} step={1} color={C.D} fmt={(v) => v.toFixed(0) + "°"} onChange={setSteerDeg} />
              <Slider label="Element spacing (wavelengths)" value={d} min={0.25} max={1} step={0.05} color={C.I} fmt={(v) => v.toFixed(2) + "λ"} onChange={setD} />
              <label style={{ display: "flex", alignItems: "center", gap: 9, cursor: "pointer", color: C.I }}>
                <input type="checkbox" checked={taper} onChange={(e) => setTaper(e.target.checked)} style={{ color: C.I, width: 15, height: 15 }} />
                <span style={{ fontFamily: FONT.body, fontSize: 13, color: C.sub }}>amplitude taper (lower sidelobes)</span>
              </label>
            </div>
          </Panel>
          <Panel label="Interference nulling">
            <label style={{ display: "flex", alignItems: "center", gap: 9, cursor: "pointer", color: C.warn, marginBottom: doNull ? 12 : 0 }}>
              <input type="checkbox" checked={doNull} onChange={(e) => setDoNull(e.target.checked)} style={{ color: C.warn, width: 15, height: 15 }} />
              <span style={{ fontFamily: FONT.body, fontSize: 13, color: C.sub }}>place a null on an interferer</span>
            </label>
            {doNull && <Slider label="Interferer direction" value={intDeg} min={-80} max={80} step={1} color={C.warn} fmt={(v) => v.toFixed(0) + "°"} onChange={setIntDeg} />}
            <div style={{ marginTop: 14 }}>
              <Readout rows={[
                ["gain toward target", (20 * Math.log10(Math.max(gains.des, 1e-4))).toFixed(1) + " dB", C.D],
                ["gain toward interferer", (20 * Math.log10(Math.max(gains.intf, 1e-4))).toFixed(1) + " dB", gains.intf < 0.05 ? C.D : C.warn],
              ]} />
            </div>
          </Panel>
        </div>
      </div>
      <Deeper
        recap="Each element applies a phase to the signal. Pick phases that line up toward one direction and the contributions add to N (full array gain); toward other angles they partly cancel. A linear phase ramp across the array steers the main lobe. To erase an interferer, choose weights orthogonal to its direction vector, forcing its contributions to cancel exactly."
        example={`A 4-element array, spacing d = 0.5λ.

Steer to 0° → every element gets phase 0:
  toward 0°:  1 + 1 + 1 + 1  = 4   → +6 dB  (10·log₁₀ 4)

Now look toward 30° with that same steering:
  phase step = 2π·0.5·sin 30° = 90° per element
  contributions: 1, j, −1, −j      = 0   → a natural null

One set of weights is +6 dB one way and zero another, purely
from how the phases stack. Turning on nulling re-picks the
weights orthogonal to the interferer, driving its four
contributions to cancel — the deep notch you see. (Push spacing
past 0.5λ and a second angle also aligns every phase: a grating
lobe, an unwanted copy of your beam.)`}
      />
    </div>
  );
}

/* ============================================================
   MODULE 13 — DIVERSITY vs MULTIPLEXING (Alamouti)
   ============================================================ */
function alamoutiDecode(h1, h2, r1, r2) {
  const s1 = cadd(cmul(cconj(h1), r1), cmul(h2, cconj(r2)));
  const s2 = csub(cmul(cconj(h2), r1), cmul(h1, cconj(r2)));
  return [s1, s2];
}
function DiversityModule() {
  const chRef = useRef(null), conRef = useRef(null);
  const [mode, setMode] = useState("alamouti");
  const [g1, setG1] = useState(0.95);
  const [g2, setG2] = useState(0.9);
  const [snr, setSnr] = useState(16);
  const [eff, setEff] = useState(1);

  useEffect(() => {
    const phi1 = (25 * Math.PI) / 180, phi2 = (-70 * Math.PI) / 180;
    const h1 = cmul(cx(g1), cexp(phi1)), h2 = cmul(cx(g2), cexp(phi2));
    const N0 = Math.pow(10, -snr / 10), sigma = Math.sqrt(N0 / 2);
    const pts = [];
    const T = 260;
    if (mode === "single") {
      for (let i = 0; i < T; i++) { const s = randSym(); const r = cadd(cmul(h1, s), cx(sigma * randn(), sigma * randn())); pts.push(cdiv(r, h1)); }
      setEff(g1 * g1);
    } else {
      const gg = g1 * g1 + g2 * g2;
      for (let i = 0; i < T / 2; i++) {
        const a = randSym(), b = randSym();
        const r1 = cadd(cadd(cmul(h1, a), cmul(h2, b)), cx(sigma * randn(), sigma * randn()));
        const r2 = cadd(cadd(cmul(cx(-h1.re, -h1.im), cconj(b)), cmul(h2, cconj(a))), cx(sigma * randn(), sigma * randn()));
        const [s1, s2] = alamoutiDecode(h1, h2, r1, r2);
        pts.push(cdiv(s1, cx(gg)), cdiv(s2, cx(gg)));
      }
      setEff(gg);
    }
    // channel arrows
    const cv = chRef.current;
    if (cv) {
      const w = cv.clientWidth, h = cv.clientHeight, ctx = cv._ctx || (cv._ctx = fitCanvas(cv, w, h));
      ctx.clearRect(0, 0, w, h); const cx0 = w / 2, cy0 = h / 2, R = Math.min(w, h) * 0.4;
      ctx.strokeStyle = C.gridFaint; ctx.beginPath(); ctx.arc(cx0, cy0, R, 0, 7); ctx.stroke();
      ctx.strokeStyle = C.edge; ctx.beginPath(); ctx.moveTo(cx0 - R, cy0); ctx.lineTo(cx0 + R, cy0); ctx.moveTo(cx0, cy0 - R); ctx.lineTo(cx0, cy0 + R); ctx.stroke();
      arrow(ctx, cx0, cy0, cx0 + h1.re * R, cy0 - h1.im * R, C.I, 2.5);
      if (mode === "alamouti") arrow(ctx, cx0, cy0, cx0 + h2.re * R, cy0 - h2.im * R, C.Q, 2.5);
      ctx.font = `10px ${FONT.mono}`; ctx.fillStyle = C.I; ctx.textAlign = "left"; ctx.fillText("h₁ path", 6, 14);
      if (mode === "alamouti") { ctx.fillStyle = C.Q; ctx.fillText("h₂ path", 6, 28); }
    }
    const cc = conRef.current;
    if (cc) { const ctx = cc._ctx || (cc._ctx = fitCanvas(cc, cc.clientWidth, cc.clientHeight)); constellation(ctx, cc.clientWidth, cc.clientHeight, [{ pts, color: mode === "single" ? C.warn : C.D, size: 2, alpha: 0.7 }], 2.8, { ref: true }); }
  }, [mode, g1, g2, snr]);

  const status = eff > 0.5 ? ["healthy", C.D] : eff > 0.12 ? ["faded", C.I] : ["outage", C.warn];
  return (
    <div>
      <Lead
        notes={[
          { t: "Term", c: C.A, x: "Diversity vs multiplexing — the two ways to spend antennas. Multiplexing (modules 10–11) sends different data per antenna for more rate. Diversity sends the same data over independent paths for more reliability." },
          { t: "Intuition", c: C.Q, x: "Alamouti coding spreads two symbols across two antennas and two time slots so a single receiver still gets a fade-protected copy. You only lose a symbol if BOTH paths fade at the same instant." },
          { t: "Heads up", c: C.warn, x: "Diversity buys robustness, not throughput — Alamouti’s rate is still one symbol per channel use. Real radios watch the channel and switch between diversity and multiplexing (rank adaptation)." },
        ]}
        n="13" title="Diversity: trade throughput for reliability"
        body="Multiplexing was about cramming more streams through a good channel. The other use of multiple antennas is the opposite bet: send one stream redundantly across independent paths so a deep fade on any one path can't kill it. Drive antenna 1 into a fade and compare a single antenna (the symbol dies) against Alamouti diversity (antenna 2 carries it through)." />
      <div className="iq-grid2">
        <div style={{ display: "grid", gap: 14 }}>
          <Panel label="Recovered symbols">
            <div style={{ display: "flex", gap: 16, alignItems: "center", justifyContent: "center" }}>
              <div style={{ textAlign: "center" }}><canvas ref={conRef} style={{ width: 200, height: 200, display: "block" }} /></div>
              <div style={{ textAlign: "center" }}>
                <canvas ref={chRef} style={{ width: 130, height: 130, display: "block" }} />
                <div style={{ fontFamily: FONT.mono, fontSize: 10, color: C.faint, marginTop: 5 }}>channel paths</div>
              </div>
            </div>
            <p style={{ fontFamily: FONT.body, fontSize: 12.5, color: C.sub, margin: "10px 0 0", lineHeight: 1.5 }}>
              Tight on the crosses = symbols recovered. Fade antenna 1 (h₁ → 0): in single-antenna mode the cloud detonates; in Alamouti it barely flinches.
            </p>
          </Panel>
        </div>
        <div style={{ display: "grid", gap: 14, alignContent: "start" }}>
          <Panel label="Scheme">
            <div style={{ display: "grid", gap: 16 }}>
              <div><div style={{ fontSize: 13, color: C.sub, fontFamily: FONT.body, marginBottom: 6 }}>Transmission</div><Pills value={mode} options={["single", "alamouti"]} onChange={setMode} /></div>
              <Slider label="Antenna-1 path strength |h₁|" value={g1} min={0.02} max={1} step={0.01} color={C.I} fmt={(v) => v.toFixed(2)} onChange={setG1} />
              <Slider label={"Antenna-2 path strength |h₂|" + (mode === "single" ? " (unused)" : "")} value={g2} min={0.02} max={1} step={0.01} color={C.Q} fmt={(v) => v.toFixed(2)} onChange={setG2} />
              <Slider label="Signal-to-noise ratio" value={snr} min={0} max={30} step={1} color={C.sub} fmt={(v) => v.toFixed(0) + " dB"} onChange={setSnr} />
            </div>
          </Panel>
          <Panel label="Link">
            <Readout rows={[
              ["paths combined", mode === "single" ? "1" : "2 (Alamouti)", C.ink],
              ["effective |h|²", eff.toFixed(2), status[1]],
              ["link status", status[0], status[1]],
              ["data rate", "1 symbol / use", C.faint],
            ]} />
            <p style={{ fontFamily: FONT.body, fontSize: 12.5, color: C.sub, margin: "12px 0 0", lineHeight: 1.55 }}>
              Single antenna rides on |h₁|² alone. Alamouti rides on |h₁|²+|h₂|² — the sum, so one fade no longer means an outage.
            </p>
          </Panel>
        </div>
      </div>
      <Deeper
        recap="Alamouti's 2×1 scheme sends s₁,s₂ in slot 1 and −s₂*,s₁* in slot 2 across the two antennas. A single receiver collects r₁,r₂, and a simple combiner untangles them — the cross-terms cancel algebraically, leaving each symbol scaled by the summed path power |h₁|²+|h₂|². That sum is the whole point: it stays large unless both paths fade together, which is the definition of full (order-2) diversity."
        example={`Transmit:        slot 1     slot 2
   antenna 1:      s₁        −s₂*
   antenna 2:      s₂         s₁*

Receive (one antenna, channels h₁,h₂):
   r₁ = h₁s₁ + h₂s₂
   r₂ = −h₁s₂* + h₂s₁*

Combine:
   ŝ₁ = h₁*r₁ + h₂r₂*  =  (|h₁|²+|h₂|²)·s₁
   ŝ₂ = h₂*r₁ − h₁r₂*  =  (|h₁|²+|h₂|²)·s₂

If |h₁| fades to 0, the symbol still arrives at |h₂|² — you
lose it only if h₁ AND h₂ fade at once. A single antenna has
just |h₁|², so one fade is an outage.`}
      />
    </div>
  );
}

/* ============================================================
   MODULE 14 — MULTI-USER MIMO (zero-forcing precoding)
   ============================================================ */
function MUMIMOModule() {
  const polRef = useRef(null);
  const [K, setK] = useState(3);
  const [N, setN] = useState(8);
  const [angles, setAngles] = useState([-35, 0, 35, 60]);
  const d = 0.5;
  const [strain, setStrain] = useState(1);
  const [ok, setOk] = useState(true);

  const setAngle = (i, v) => setAngles((a) => { const c = a.slice(); c[i] = v; return c; });

  useEffect(() => {
    const ang = angles.slice(0, K);
    const H = ang.map((a) => steer(N, d, a)); // K x N
    const Hh = hConj(H);
    const G = mm(H, Hh); // K x K
    const Ginv = cInverse(G);
    const cv = polRef.current; if (!cv) return;
    const ctx = cv._ctx || (cv._ctx = fitCanvas(cv, cv.clientWidth, cv.clientHeight));
    const w0 = cv.clientWidth, h0 = cv.clientHeight, cx0 = w0 / 2, cy0 = h0 - 16, R = Math.min(w0 / 2 - 14, h0 - 30);
    ctx.clearRect(0, 0, w0, h0);
    ctx.strokeStyle = C.gridFaint; ctx.lineWidth = 1;
    for (let rr = 0.25; rr <= 1.001; rr += 0.25) { ctx.beginPath(); ctx.arc(cx0, cy0, R * rr, Math.PI, 2 * Math.PI); ctx.stroke(); }
    ctx.fillStyle = C.faint; ctx.font = `10px ${FONT.mono}`;
    [-90, -45, 0, 45, 90].forEach((a) => { const th = (a * Math.PI) / 180; ctx.strokeStyle = C.gridFaint; ctx.beginPath(); ctx.moveTo(cx0, cy0); ctx.lineTo(cx0 + R * Math.sin(th), cy0 - R * Math.cos(th)); ctx.stroke(); ctx.textAlign = "center"; ctx.fillText(a + "°", cx0 + (R + 9) * Math.sin(th), cy0 - (R + 9) * Math.cos(th) + 3); });

    if (!Ginv) { setOk(false); ctx.fillStyle = C.warn; ctx.font = `13px ${FONT.disp}`; ctx.textAlign = "center"; ctx.fillText("users indistinguishable — beams collapsed", cx0, cy0 - R / 2); return; }
    setOk(true);
    const W = mm(Hh, Ginv); // N x K
    let pf = 0; for (let n = 0; n < N; n++) for (let k = 0; k < K; k++) pf += W[n][k].re * W[n][k].re + W[n][k].im * W[n][k].im;
    setStrain(pf / K);
    // global max for normalization
    let mx = 0;
    const respOf = (j, th) => { const a = steer(N, d, th); let s = cx(0); for (let n = 0; n < N; n++) s = cadd(s, cmul(a[n], W[n][j])); return cabs(s); };
    for (let j = 0; j < K; j++) for (let a = -90; a <= 90; a += 1) mx = Math.max(mx, respOf(j, a));
    for (let j = 0; j < K; j++) {
      const col = STREAM[j % STREAM.length];
      ctx.strokeStyle = col; ctx.lineWidth = 1.8; ctx.beginPath(); let started = false;
      for (let a = -90; a <= 90; a += 0.5) { const th = (a * Math.PI) / 180; const rr = (respOf(j, a) / mx) * R; const x = cx0 + rr * Math.sin(th), y = cy0 - rr * Math.cos(th); started ? ctx.lineTo(x, y) : ctx.moveTo(x, y); started = true; }
      ctx.stroke();
      const th = (ang[j] * Math.PI) / 180;
      ctx.fillStyle = col; ctx.beginPath(); ctx.arc(cx0 + R * Math.sin(th), cy0 - R * Math.cos(th), 4, 0, 7); ctx.fill();
    }
  }, [K, N, angles]);

  return (
    <div>
      <Lead
        notes={[
          { t: "Term", c: C.A, x: "Multi-user MIMO (SDMA): one base station with many antennas serves several single-antenna users at once on the same time and frequency, each in its own spatial beam." },
          { t: "Intuition", c: C.Q, x: "Zero-forcing precoding builds one beam per user that points at that user and nulls every other — the transmit-side twin of module 10’s receiver. Each phone hears only its own stream." },
          { t: "Heads up", c: C.warn, x: "It needs at least as many antennas as users (N ≥ K) and users at distinguishable angles. Drag two users together and the precoder strains, then collapses — the same signature problem from module 10." },
        ]}
        n="14" title="Multi-user MIMO: one tower, many phones, one channel"
        body="Spatial multiplexing doesn't have to feed one device — a base station can aim a separate beam at each of several users simultaneously, reusing the exact same frequency. Zero-forcing precoding shapes each beam to peak on its own user and null all the others. This spatial division is what lets massive-MIMO 5G cells multiply capacity with antenna count." />
      <div className="iq-grid2">
        <div style={{ display: "grid", gap: 14 }}>
          <Panel label="Per-user beams (each nulls the other users)">
            <canvas ref={polRef} style={{ width: "100%", height: 260, display: "block" }} />
            <p style={{ fontFamily: FONT.body, fontSize: 12.5, color: C.sub, margin: "10px 0 0", lineHeight: 1.5 }}>
              Each coloured curve is one user's beam; its dot marks that user. Notice every beam dips to zero exactly where the other users sit — no cross-talk.
            </p>
          </Panel>
        </div>
        <div style={{ display: "grid", gap: 14, alignContent: "start" }}>
          <Panel label="Cell setup">
            <div style={{ display: "grid", gap: 14 }}>
              <div><div style={{ fontSize: 13, color: C.sub, fontFamily: FONT.body, marginBottom: 6 }}>Base-station antennas</div><Pills value={N} options={[4, 8, 16]} onChange={setN} /></div>
              <div><div style={{ fontSize: 13, color: C.sub, fontFamily: FONT.body, marginBottom: 6 }}>Users served</div><Pills value={K} options={[2, 3, 4]} onChange={setK} /></div>
              {Array.from({ length: K }, (_, i) => (
                <Slider key={i} label={`User ${i + 1} direction`} value={angles[i]} min={-80} max={80} step={1} color={STREAM[i % STREAM.length]} fmt={(v) => v.toFixed(0) + "°"} onChange={(v) => setAngle(i, v)} />
              ))}
            </div>
          </Panel>
          <Panel label="Health">
            <Readout rows={[
              ["users served", ok ? `${K} on one channel` : "collapsed", ok ? C.D : C.warn],
              ["precoder strain (power)", ok ? "×" + strain.toFixed(1) : "∞", strain < 3 ? C.D : C.warn],
            ]} />
            <p style={{ fontFamily: FONT.body, fontSize: 12.5, color: C.sub, margin: "12px 0 0", lineHeight: 1.55 }}>
              Strain near ×1 means cheap, clean separation. Slide two users close and it climbs — the array spends huge power fighting to tell them apart. More antennas (N) keeps strain low for the same users.
            </p>
          </Panel>
        </div>
      </div>
      <Deeper
        recap="Stack each user's channel as a row of H (K×N). The zero-forcing precoder W = Hᴴ(HHᴴ)⁻¹ satisfies HW = I, so user k receives its own symbol and a clean zero from every other user's beam. It's module 10's receiver inverse, moved to the transmitter: instead of un-mixing after the fact, the tower pre-mixes so the channel delivers each stream cleanly."
        example={`Base station N = 6 antennas, users at −30°, 10°, 40°.
Build H (3×6), rows = steering vectors a(θₖ).
Precoder  W = Hᴴ(HHᴴ)⁻¹  (6×3).

Check what each user receives (HW):
   user 1:  [ 1   0   0 ]
   user 2:  [ 0   1   0 ]
   user 3:  [ 0   0   1 ]

Each beam is exactly 1 toward its own user and 0 toward the
other two — three private links over one frequency. Move two
users to the same angle and HHᴴ becomes singular: the inverse
explodes and the beams collapse, just like two streams sharing
one spatial signature.`}
      />
    </div>
  );
}

/* ============================================================
   MODULE 15 — RECOVERING STREAMS WITH ONE ANTENNA
   ============================================================ */
function SingleRxModule() {
  const conRef = useRef(null), chRef = useRef(null);
  const [ratio, setRatio] = useState(0.8);
  const [phase, setPhase] = useState(110);
  const [snr, setSnr] = useState(22);
  const [info, setInfo] = useState({ dmin: 0, sep: 0 });

  useEffect(() => {
    const h1 = cx(1, 0), h2 = cmul(cx(ratio), cexp((phase * Math.PI) / 180));
    const ideal = [];
    for (let a = 0; a < 4; a++) for (let b = 0; b < 4; b++) ideal.push(cadd(cmul(h1, QPSK[a]), cmul(h2, QPSK[b])));
    let dmin = 1e9;
    for (let i = 0; i < ideal.length; i++) for (let j = i + 1; j < ideal.length; j++) { const d = Math.hypot(ideal[i].re - ideal[j].re, ideal[i].im - ideal[j].im); if (d < dmin) dmin = d; }
    const N0 = Math.pow(10, -snr / 10), sigma = Math.sqrt(N0 / 2);
    setInfo({ dmin, sep: dmin / (2 * sigma) });
    const groups = [0, 1, 2, 3].map((a) => ({ pts: [], color: STREAM[a], size: 2, alpha: 0.75 }));
    const T = 360;
    for (let i = 0; i < T; i++) { const a = (rand() * 4) | 0, b = (rand() * 4) | 0; const base = cadd(cmul(h1, QPSK[a]), cmul(h2, QPSK[b])); groups[a].pts.push(cadd(base, cx(sigma * randn(), sigma * randn()))); }
    groups.push({ pts: ideal, color: "#ffffff", size: 3, alpha: 0.9 });
    const cc = conRef.current;
    if (cc) { const ctx = cc._ctx || (cc._ctx = fitCanvas(cc, cc.clientWidth, cc.clientHeight)); constellation(ctx, cc.clientWidth, cc.clientHeight, groups, 2.3); }
    const cv = chRef.current;
    if (cv) {
      const w = cv.clientWidth, h = cv.clientHeight, ctx = cv._ctx || (cv._ctx = fitCanvas(cv, w, h));
      ctx.clearRect(0, 0, w, h); const x0 = w / 2, y0 = h / 2, R = Math.min(w, h) * 0.4;
      ctx.strokeStyle = C.gridFaint; ctx.beginPath(); ctx.arc(x0, y0, R, 0, 7); ctx.stroke();
      ctx.strokeStyle = C.edge; ctx.beginPath(); ctx.moveTo(x0 - R, y0); ctx.lineTo(x0 + R, y0); ctx.moveTo(x0, y0 - R); ctx.lineTo(x0, y0 + R); ctx.stroke();
      arrow(ctx, x0, y0, x0 + h1.re * R, y0 - h1.im * R, C.A, 2.5);
      arrow(ctx, x0, y0, x0 + h2.re * R, y0 - h2.im * R, C.B, 2.5);
      ctx.font = `10px ${FONT.mono}`; ctx.textAlign = "left"; ctx.fillStyle = C.A; ctx.fillText("h₁ · stream A", 6, 14); ctx.fillStyle = C.B; ctx.fillText("h₂ · stream B", 6, 28);
    }
  }, [ratio, phase, snr]);

  const status = info.dmin < 0.06 ? ["ambiguous — symbols collide", C.warn] : info.sep > 2 ? ["recoverable", C.D] : info.sep > 1 ? ["marginal", C.I] : ["lost in noise", C.warn];
  const penalty = info.dmin > 0.001 ? (20 * Math.log10(1.414 / info.dmin)).toFixed(1) + " dB" : "∞";
  const techniques = [
    ["Joint detection (SAIC)", C.A, "Treat the two signals’ sum as one big alphabet and pick the likeliest pair. Needs known modulation and channel; pays a steep SNR cost. (This is the view above — deployed in GSM phones.)"],
    ["Channel variation over time", C.Q, "Hold the symbols while the channel drifts; the time-snapshots act as extra antennas and give you the missing equations. Costs data rate, needs Doppler."],
    ["Oversampling a multipath channel", C.D, "Sampling faster than the symbol rate on a delay-spread channel yields several ‘virtual’ outputs from one antenna, enough for blind equalization."],
    ["Blind structure (CMA, cyclostationarity)", C.I, "Channel unknown? Exploit PSK’s constant modulus, or two signals’ different baud rates / carrier offsets, to lock onto and peel off one at a time."],
    ["Sparsity / compressed sensing", C.B, "If only a few of many possible streams are active at once, a single antenna can recover them by exploiting that sparsity — grant-free massive access."],
  ];
  return (
    <div>
      <Lead
        notes={[
          { t: "Term", c: C.A, x: "Single-antenna interference cancellation (SAIC): with one antenna you can’t null spatially, so instead you detect the most likely pair of symbols jointly from their combined alphabet. Real — it’s in GSM." },
          { t: "Intuition", c: C.Q, x: "Two QPSK streams add into a 16-point ‘superposition constellation’. If those points stay distinct, one complex sample pins down both symbols — you demultiplex by reading which of 16 dots you landed nearest." },
          { t: "Heads up", c: C.warn, x: "You’re now separating 16 packed dots instead of 4, so minimum distance shrinks and the SNR cost is steep. And if the two channels look alike the dots collide — swapping the streams yields the same sample, so it’s hopeless." },
        ]}
        n="15" title="One antenna, many streams — what's actually possible"
        body="A lone receiver gets one complex number per channel use — fewer measurements than unknowns, so it cannot separate co-channel streams by linear algebra the way modules 10–14 do. The escape is structure. Because the symbols come from a known finite alphabet, the streams add into a fixed set of points, and joint detection picks the most likely combination. It works when those points stay far apart at high SNR, and fails when the channels are too similar — plus a handful of other tricks that trade time, bandwidth, or assumptions for the missing antenna." />
      <div className="iq-grid2">
        <div style={{ display: "grid", gap: 14 }}>
          <Panel label="Superposition constellation — both streams, one antenna">
            <div style={{ display: "flex", gap: 14, alignItems: "center", justifyContent: "center" }}>
              <canvas ref={conRef} style={{ width: 210, height: 210, display: "block" }} />
              <div style={{ textAlign: "center" }}><canvas ref={chRef} style={{ width: 120, height: 120, display: "block" }} /><div style={{ fontFamily: FONT.mono, fontSize: 10, color: C.faint, marginTop: 5 }}>two channels</div></div>
            </div>
            <p style={{ fontFamily: FONT.body, fontSize: 12.5, color: C.sub, margin: "10px 0 0", lineHeight: 1.5 }}>
              Colour = stream A’s symbol; white dots are the 16 ideal sums. When the four colours form separable clusters, both streams are readable from this single antenna. Make the channels alike, or drop SNR, and the colours bleed together.
            </p>
          </Panel>
          <Panel label="Techniques for a single antenna">
            {techniques.map(([t, c, x], i) => (
              <div key={i} style={{ borderLeft: `2px solid ${c}`, paddingLeft: 10, marginBottom: i < techniques.length - 1 ? 12 : 0 }}>
                <div style={{ fontFamily: FONT.mono, fontSize: 11.5, color: c, marginBottom: 3 }}>{t}</div>
                <div style={{ fontFamily: FONT.body, fontSize: 12.5, color: C.sub, lineHeight: 1.5 }}>{x}</div>
              </div>
            ))}
          </Panel>
        </div>
        <div style={{ display: "grid", gap: 14, alignContent: "start" }}>
          <Panel label="Channel & noise">
            <div style={{ display: "grid", gap: 16 }}>
              <Slider label="Second channel strength |h₂|/|h₁|" value={ratio} min={0.1} max={1} step={0.01} color={C.B} fmt={(v) => v.toFixed(2)} onChange={setRatio} />
              <Slider label="Phase between the two channels" value={phase} min={0} max={180} step={1} color={C.Q} fmt={(v) => v.toFixed(0) + "°"} onChange={setPhase} />
              <Slider label="Signal-to-noise ratio" value={snr} min={5} max={35} step={1} color={C.I} fmt={(v) => v.toFixed(0) + " dB"} onChange={setSnr} />
            </div>
            <p style={{ fontFamily: FONT.body, fontSize: 12.5, color: C.sub, margin: "14px 0 0", lineHeight: 1.55 }}>
              Bring the phase toward 0° with |h₂|≈|h₁| to make the two channels nearly identical — watch the constellation collapse and the streams become unrecoverable at any SNR.
            </p>
          </Panel>
          <Panel label="Can you read it?">
            <Readout rows={[
              ["min distance between sums", info.dmin.toFixed(2), info.dmin > 0.3 ? C.D : C.warn],
              ["vs single-stream QPSK", "1.41", C.faint],
              ["SNR penalty (min-dist)", penalty, C.I],
              ["verdict", status[0], status[1]],
            ]} />
            <p style={{ fontFamily: FONT.body, fontSize: 12.5, color: C.sub, margin: "12px 0 0", lineHeight: 1.55 }}>
              The whole game is that minimum distance. The channel sets it, the receiver can’t change it, and when it hits zero no amount of power or processing recovers the streams.
            </p>
          </Panel>
        </div>
      </div>
      <Deeper
        recap="One antenna gives one equation per symbol period, and two streams are two unknowns — underdetermined. Joint maximum-likelihood detection sidesteps the missing equation by using the alphabet: it precomputes the 16 possible sums h₁s₁+h₂s₂ and picks the pair whose sum sits closest to the received sample. Recovery hinges entirely on the minimum distance between those 16 points, which the channel sets — and which collapses to zero when one stream is just a relabelling of the other."
        example={`Two QPSK streams, h₁ = 1.

Favourable channel  h₂ = 0.8 ∠110°:
   all 16 sums distinct, min distance 0.52.
   vs single-stream QPSK (min distance 1.41) that's a
   ~8.6 dB SNR penalty — workable at high SNR.

Bad channel  h₂ = h₁:
   y = h₁(s₁+s₂), so (s₁,s₂) and (s₂,s₁) produce the SAME
   sample. min distance 0.00 — the streams are swappable,
   unrecoverable at any SNR.

—— turning TIME into the missing dimension ——
Hold the symbols fixed for two periods while the channel
moves (Doppler):
   slot 1:  y₁ = h₁(t₁)·s₁ + h₂(t₁)·s₂
   slot 2:  y₂ = h₁(t₂)·s₁ + h₂(t₂)·s₂
If the channel changed, those are two independent equations
→ solve exactly like module 10. If it sat still, both rows
match → rank 1 → no solution. You bought the second equation
with time, at half the data rate.`}
      />
    </div>
  );
}

/* ============================================================
   MODULE 16 — CAPSTONE: OFDM × MIMO (the resource grid)
   ============================================================ */
function freqResp(taps, N) {
  const H = [];
  for (let k = 0; k < N; k++) { let s = cx(0); for (let l = 0; l < taps.length; l++) s = cadd(s, cmul(taps[l], cexp((-2 * Math.PI * k * l) / N))); H.push(s); }
  return H;
}
function makeTaps(L) {
  const t = []; let p = 0;
  for (let l = 0; l < L; l++) { const g = Math.exp(-l / 2); t.push(cx(randn() * g, randn() * g)); p += g * g; }
  const s = 1 / Math.sqrt(p); return t.map((x) => cx(x.re * s, x.im * s));
}
function OFDMModule() {
  const fRef = useRef(null), gRef = useRef(null);
  const [N, setN] = useState(32);
  const [Nss, setNss] = useState(2);
  const [L, setL] = useState(5);
  const [snr, setSnr] = useState(22);
  const [stats, setStats] = useState({ specEff: 0, usable: 0 });

  useEffect(() => {
    _seed = 7000 + L * 13 + Nss * 257; // stable channel per config; SNR won't re-randomize it
    const snrLin = Math.pow(10, snr / 10);
    const Hf = [];
    for (let m = 0; m < Nss; m++) { Hf.push([]); for (let n = 0; n < Nss; n++) Hf[m].push(freqResp(makeTaps(L), N)); }
    const sig = [], cellCap = [];
    let total = 0, usable = 0, capMax = 1e-6;
    for (let k = 0; k < N; k++) {
      const Hk = Array.from({ length: Nss }, (_, m) => Array.from({ length: Nss }, (_, n) => Hf[m][n][k]));
      const sv = singularValues(Hk); sig.push(sv);
      const col = [];
      for (let i = 0; i < Nss; i++) { const c = Math.log2(1 + (snrLin * sv[i] * sv[i]) / Nss); col.push(c); total += c; if (c > 0.2) usable++; capMax = Math.max(capMax, c); }
      cellCap.push(col);
    }
    setStats({ specEff: total / N, usable });

    // frequency-selective channel (top two singular values across subcarriers)
    const cf = fRef.current;
    if (cf) {
      const w = cf.clientWidth, h = cf.clientHeight, ctx = cf._ctx || (cf._ctx = fitCanvas(cf, w, h)), padB = 22, padT = 8, ph = h - padB - padT;
      ctx.clearRect(0, 0, w, h);
      let mx = 0; for (const s of sig) mx = Math.max(mx, s[0]); mx = mx || 1;
      ctx.strokeStyle = C.gridFaint; for (let g = 0; g <= 2; g++) { const y = padT + (ph * g) / 2; ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke(); }
      const xOf = (k) => (k / (N - 1)) * w, yOf = (v) => padT + ph - (v / mx) * ph;
      // sigma1 filled
      ctx.beginPath(); ctx.moveTo(0, h - padB);
      for (let k = 0; k < N; k++) ctx.lineTo(xOf(k), yOf(sig[k][0]));
      ctx.lineTo(w, h - padB); ctx.closePath(); ctx.fillStyle = "rgba(232,184,92,0.18)"; ctx.fill();
      ctx.strokeStyle = C.I; ctx.lineWidth = 1.8; ctx.beginPath(); for (let k = 0; k < N; k++) { const x = xOf(k), y = yOf(sig[k][0]); k ? ctx.lineTo(x, y) : ctx.moveTo(x, y); } ctx.stroke();
      if (Nss >= 2) { ctx.strokeStyle = C.Q; ctx.lineWidth = 1.5; ctx.beginPath(); for (let k = 0; k < N; k++) { const x = xOf(k), y = yOf(sig[k][1]); k ? ctx.lineTo(x, y) : ctx.moveTo(x, y); } ctx.stroke(); }
      ctx.fillStyle = C.faint; ctx.font = `10px ${FONT.mono}`; ctx.textAlign = "left"; ctx.fillText("subcarrier (frequency) →", 4, h - 7);
      ctx.fillStyle = C.I; ctx.textAlign = "right"; ctx.fillText("σ₁", w - 6, padT + 10); if (Nss >= 2) { ctx.fillStyle = C.Q; ctx.fillText("σ₂", w - 6, padT + 22); }
    }
    // resource grid: streams (rows) x subcarriers (cols)
    const cg = gRef.current;
    if (cg) {
      const w = cg.clientWidth, h = cg.clientHeight, ctx = cg._ctx || (cg._ctx = fitCanvas(cg, w, h)), padL = 24, padB = 18;
      ctx.clearRect(0, 0, w, h);
      const gw = w - padL, gh = h - padB, cw = gw / N, chh = gh / Nss;
      const lerp = (a, b, t) => Math.round(a + (b - a) * t);
      for (let i = 0; i < Nss; i++) for (let k = 0; k < N; k++) {
        const f = Math.min(1, cellCap[k][i] / capMax);
        ctx.fillStyle = `rgb(${lerp(20, 86, f)},${lerp(29, 199, f)},${lerp(38, 191, f)})`;
        ctx.fillRect(padL + k * cw, i * chh, Math.max(1, cw - 0.6), Math.max(1, chh - 1.2));
      }
      ctx.fillStyle = C.faint; ctx.font = `9px ${FONT.mono}`; ctx.textAlign = "right"; ctx.textBaseline = "middle";
      for (let i = 0; i < Nss; i++) ctx.fillText("L" + (i + 1), padL - 4, i * chh + chh / 2);
      ctx.textAlign = "left"; ctx.textBaseline = "alphabetic"; ctx.fillText("frequency →", padL, h - 5);
      ctx.save(); ctx.translate(8, gh / 2); ctx.rotate(-Math.PI / 2); ctx.textAlign = "center"; ctx.fillText("layers", 0, 0); ctx.restore();
    }
  }, [N, Nss, L, snr]);

  const parallel = N * Nss;
  const mbit = (stats.specEff * 20).toFixed(0);
  return (
    <div>
      <Lead
        notes={[
          { t: "Term", c: C.A, x: "OFDM: an IFFT/FFT pair turns one wideband signal into many narrowband subcarriers, each just multiplied by a single gain H[k]. A cyclic prefix soaks up the channel’s echo so the subcarriers stay orthogonal. Subcarriers × OFDM symbols = the resource grid." },
          { t: "Intuition", c: C.Q, x: "Part 2 split the band to separate signals; OFDM splits it to make transmitting easy — every subcarrier becomes a flat channel you already know how to handle. Then Part 3’s spatial multiplexing runs on each subcarrier independently." },
          { t: "Heads up", c: C.warn, x: "Frequency-selective fades wipe out whole subcarriers; real radios pour more bits where the channel is strong and protect or skip the notches. Pilots and the cyclic prefix cost overhead the headline rate ignores." },
        ]}
        n="16" title="Capstone — OFDM × MIMO: frequency meets space"
        body="Here the two halves of the series fuse. OFDM chops a hard wideband channel into many narrow subcarriers, each so narrow it sees a single flat gain — Part 2's filter bank, run in reverse to transmit. Every subcarrier then carries its own MIMO link from Part 3. The result is a two-dimensional grid of independent channels: frequency across, spatial layers down. Stack up subcarriers and layers and two handfuls of antennas reach hundreds of megabits." />
      <div className="iq-grid2">
        <div style={{ display: "grid", gap: 14 }}>
          <Panel label="Frequency-selective channel — each subcarrier, its own gain">
            <canvas ref={fRef} style={{ width: "100%", height: 130, display: "block" }} />
            <p style={{ fontFamily: FONT.body, fontSize: 12.5, color: C.sub, margin: "10px 0 0", lineHeight: 1.5 }}>
              Dips are frequency-selective fades; a second line means two spatial streams survive at that subcarrier. Raise selectivity to carve more structure; drop it to one tap and the channel goes flat.
            </p>
          </Panel>
          <Panel label="Resource grid — frequency × space">
            <canvas ref={gRef} style={{ width: "100%", height: 150, display: "block" }} />
            <p style={{ fontFamily: FONT.body, fontSize: 12.5, color: C.sub, margin: "10px 0 0", lineHeight: 1.5 }}>
              Every cell is an independent channel: pick a subcarrier (frequency, Part 2) and a layer (space, Part 3). Bright = carrying bits, dark = lost to a fade. Throughput is the whole grid summed.
            </p>
          </Panel>
        </div>
        <div style={{ display: "grid", gap: 14, alignContent: "start" }}>
          <Panel label="System">
            <div style={{ display: "grid", gap: 14 }}>
              <div><div style={{ fontSize: 13, color: C.sub, fontFamily: FONT.body, marginBottom: 6 }}>Subcarriers</div><Pills value={N} options={[16, 32, 64]} onChange={setN} /></div>
              <div><div style={{ fontSize: 13, color: C.sub, fontFamily: FONT.body, marginBottom: 6 }}>Spatial layers (N×N MIMO)</div><Pills value={Nss} options={[1, 2, 3, 4]} onChange={setNss} /></div>
              <Slider label="Frequency selectivity (channel taps)" value={L} min={1} max={8} step={1} color={C.B} fmt={(v) => v + (v === 1 ? " (flat)" : "")} onChange={setL} />
              <Slider label="Signal-to-noise ratio" value={snr} min={5} max={35} step={1} color={C.I} fmt={(v) => v.toFixed(0) + " dB"} onChange={setSnr} />
            </div>
          </Panel>
          <Panel label="Throughput">
            <Readout rows={[
              ["parallel channels", `${N} × ${Nss} = ${parallel}`, C.ink],
              ["usable cells", `${stats.usable} of ${parallel}`, C.D],
              ["spectral efficiency", stats.specEff.toFixed(1) + " bit/s/Hz", C.Q],
              ["raw rate over 20 MHz", "≈ " + mbit + " Mbit/s", C.I],
            ]} />
            <p style={{ fontFamily: FONT.body, fontSize: 12.5, color: C.sub, margin: "12px 0 0", lineHeight: 1.55 }}>
              This is the engine of every modern link: a few antennas times many subcarriers becomes hundreds of parallel channels. Real Wi-Fi and 5G push wider bands and higher-order QAM on top to reach multi-gigabit.
            </p>
          </Panel>
        </div>
      </div>
      <Deeper
        recap="OFDM sends data on N orthogonal subcarriers; with a cyclic prefix the frequency-selective channel acts on each subcarrier as a single multiply H[k] = Σₗ h[l]·e^{−j2πkl/N} — the DFT of the channel’s tap delays. That turns nasty wideband equalization into N trivial per-subcarrier divisions. Put MIMO on top and each subcarrier carries its own H[k] matrix with its own singular values, so the air becomes (subcarriers × spatial layers) parallel channels and the total rate is the sum over the whole grid."
        example={`Per-subcarrier flat-channel identity:
   H[k] = Σₗ h[l]·e^{−j2πkl/N}
   1 tap  (L=1) → H[k] constant → flat channel, no notches.
   each extra tap adds a ripple, carving the fades you see.

Putting it together — 64-subcarrier OFDM, 2×2 MIMO, 20 MHz,
~25 dB SNR:
   ~56 useful subcarriers × 2 layers = 112 parallel channels
   ≈ 15 bit/s/Hz averaged over subcarriers
   ≈ 300 Mbit/s raw (before coding & cyclic-prefix overhead)

Real systems go further: 80–160 MHz bands, 4–8 layers, and
256-QAM, multiplying these same two axes — frequency and space
— all the way to multi-gigabit.`}
      />
    </div>
  );
}

/* ============================================================
   APP SHELL
   ============================================================ */
const MODULES = [
  { id: "09", label: "Channel matrix", comp: ChannelModule },
  { id: "10", label: "Separate streams", comp: DetectModule },
  { id: "11", label: "Parallel pipes", comp: PipesModule },
  { id: "12", label: "Beamforming", comp: BeamModule },
  { id: "13", label: "Diversity", comp: DiversityModule },
  { id: "14", label: "Multi-user", comp: MUMIMOModule },
  { id: "15", label: "Single antenna", comp: SingleRxModule },
  { id: "16", label: "OFDM × MIMO", comp: OFDMModule },
];

const DIFF = [2, 3, 3, 2, 3, 3, 3, 3];
const PREDICTS = {"1": {"q": "Two streams arrive with nearly identical signatures. Zero-forcing will...", "options": ["separate them cleanly", "amplify the noise enormously", "drop one stream"], "answer": 1, "why": "Near-parallel columns make H almost singular, so its inverse has huge entries that blow up the noise."}, "7": {"q": "OFDM turns one frequency-selective channel into...", "options": ["a single hard wideband channel", "many flat narrow subcarriers", "one pure tone"], "answer": 1, "why": "Each subcarrier is narrow enough to see a single flat gain, which makes per-subcarrier equalization trivial."}};
function Predict({ q, options, answer, why }) {
  const [pick, setPick] = useState(null);
  return (
    <div style={{ background: C.panel, border: "1px solid " + C.edge, borderLeft: "2px solid " + C.I, borderRadius: 8, padding: "12px 14px", marginBottom: 16, maxWidth: 720 }}>
      <div style={{ fontFamily: FONT.mono, fontSize: 9.5, letterSpacing: "0.16em", textTransform: "uppercase", color: C.I, marginBottom: 6 }}>Predict before you drag</div>
      <div style={{ fontFamily: FONT.body, fontSize: 13.5, color: C.ink, marginBottom: 10, lineHeight: 1.5 }}>{q}</div>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        {options.map((o, i) => { const on = pick === i, correct = i === answer; const bc = pick == null ? C.edge : (correct ? C.D : (on ? C.warn : C.edge)); const tc = pick == null ? C.sub : (correct ? C.D : (on ? C.warn : C.faint)); return <button key={i} onClick={() => setPick(i)} style={{ fontFamily: FONT.body, fontSize: 12.5, padding: "6px 11px", borderRadius: 6, border: "1px solid " + bc, background: on ? C.panelHi : "transparent", color: tc, cursor: "pointer" }}>{o}</button>; })}
      </div>
      {pick != null && <div style={{ fontFamily: FONT.body, fontSize: 12.5, color: C.sub, marginTop: 10, lineHeight: 1.5 }}><span style={{ color: pick === answer ? C.D : C.warn, fontFamily: FONT.mono, fontSize: 11 }}>{pick === answer ? "correct" : "not quite"}</span>{" — "}{why}</div>}
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
            <Eyebrow>I/Q signal primer · part 3</Eyebrow>
          </div>
          <h1 style={{ fontFamily: FONT.disp, fontSize: 34, fontWeight: 700, margin: "0 0 8px", letterSpacing: "-0.02em", lineHeight: 1.05 }}>
            MIMO &amp; spatial streams
          </h1>
          <p style={{ fontFamily: FONT.body, fontSize: 15, color: C.sub, maxWidth: 700, lineHeight: 1.6, margin: 0 }}>
            Parts 1–2 separated signals by frequency. With several antennas you gain a new axis — space. Send different data from each antenna and unscramble it with linear algebra; trade that throughput for fade-proof reliability; aim the array to serve many users at once; see what a lone receiver can still do; then watch frequency and space combine into the grid every modern radio runs on. Eight modules, all running the real math.
          </p>
          {reduced && <p style={{ fontFamily: FONT.mono, fontSize: 11, color: C.faint, marginTop: 10 }}>Reduced-motion on — views are static but respond to controls.</p>}
          <nav style={{ display: "flex", gap: 6, marginTop: 22, flexWrap: "wrap", borderBottom: `1px solid ${C.edge}`, paddingBottom: 16 }}>
            {MODULES.map((m, i) => (
              <button key={m.id} className="iq-tab" data-on={active === i ? "1" : "0"} onClick={() => setActive(i)}>
                <span style={{ color: active === i ? C.Q : C.faint, marginRight: 7 }}>{m.id}</span>{m.label}<span title="math intensity (light / medium / heavy)" style={{ marginLeft: 7, letterSpacing: 1, fontSize: 9 }}>{[0, 1, 2].map((_d) => <span key={_d} style={{ color: _d < DIFF[i] ? (DIFF[i] === 1 ? C.D : DIFF[i] === 2 ? C.I : C.warn) : C.gridFaint }}>{"•"}</span>)}</span>
              </button>
            ))}
          </nav>
        </header>
        {PREDICTS[active] && <Predict q={PREDICTS[active].q} options={PREDICTS[active].options} answer={PREDICTS[active].answer} why={PREDICTS[active].why} />}
        <main key={active}><Comp reduced={reduced} /></main>
        <footer style={{ marginTop: 40, paddingTop: 18, borderTop: `1px solid ${C.gridFaint}`, fontFamily: FONT.body, fontSize: 12, color: C.faint, lineHeight: 1.6 }}>
          One antenna pair is a single complex gain; many pairs make a matrix. Inverting it separates streams, its SVD reveals how many are possible, and its phases let you aim. Frequency, then space — same idea, new dimension.
        </footer>
      </div>
    </div>
  );
}
