import { useState, useRef, useEffect } from "react";

/* ============================================================
   IQ EXPLORER — an interactive primer on I/Q data for newcomers
   Identity motif: I = in-phase = amber, Q = quadrature = cyan.
   Two orthogonal axes -> two colors threaded through every view.
   ============================================================ */

const C = {
  bg: "#0E1419",
  panel: "#141D25",
  panelHi: "#1A2530",
  edge: "#26343F",
  grid: "#22303A",
  gridFaint: "#18222B",
  ink: "#ECE7DB",
  sub: "#8B98A3",
  faint: "#5A6973",
  I: "#E8B85C", // in-phase  -> amber
  Q: "#56C7BF", // quadrature -> cyan
  sum: "#ECE7DB",
  s1: "#B49BE0",
  s2: "#E58AA6",
  s3: "#86D08A",
  s4: "#E8B85C",
};
const SIG = [C.s1, C.s2, C.s3, C.s4];

const FONT = {
  disp: "'Space Grotesk', system-ui, -apple-system, sans-serif",
  body: "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif",
  mono: "'Space Mono', ui-monospace, SFMono-Regular, Menlo, monospace",
};

/* ---------- tiny helpers ---------- */
const sgn = (x, d = 3) => (x >= 0 ? "+" : "\u2212") + Math.abs(x).toFixed(d);
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));

function usePrefersReducedMotion() {
  const [r, setR] = useState(false);
  useEffect(() => {
    if (!window.matchMedia) return;
    const m = window.matchMedia("(prefers-reduced-motion: reduce)");
    const h = () => setR(m.matches);
    h();
    m.addEventListener?.("change", h);
    return () => m.removeEventListener?.("change", h);
  }, []);
  return r;
}

function useRaf(fn, active) {
  const cb = useRef(fn);
  cb.current = fn;
  useEffect(() => {
    if (!active) return;
    let raf;
    const start = performance.now();
    let last = start;
    const loop = (t) => {
      const el = (t - start) / 1000;
      const dt = Math.min(0.05, (t - last) / 1000);
      last = t;
      cb.current(el, dt);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [active]);
}

function fitCanvas(canvas, w, h, dpr = true) {
  const ratio = dpr ? window.devicePixelRatio || 1 : 1;
  canvas.width = Math.round(w * ratio);
  canvas.height = Math.round(h * ratio);
  canvas.style.width = w + "px";
  canvas.style.height = h + "px";
  const ctx = canvas.getContext("2d");
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  return ctx;
}

function arrow(ctx, x0, y0, x1, y1, color, width = 2, head = 7) {
  const a = Math.atan2(y1 - y0, x1 - x0);
  const len = Math.hypot(x1 - x0, y1 - y0);
  if (len < 0.5) return;
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = width;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(x0, y0);
  ctx.lineTo(x1, y1);
  ctx.stroke();
  if (len > head + 2) {
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x1 - head * Math.cos(a - 0.4), y1 - head * Math.sin(a - 0.4));
    ctx.lineTo(x1 - head * Math.cos(a + 0.4), y1 - head * Math.sin(a + 0.4));
    ctx.closePath();
    ctx.fill();
  }
}

/* simple radix-2 iterative FFT (in place) */
function fft(re, im) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      let tr = re[i]; re[i] = re[j]; re[j] = tr;
      let ti = im[i]; im[i] = im[j]; im[j] = ti;
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wr = Math.cos(ang), wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cwr = 1, cwi = 0;
      for (let k = 0; k < len >> 1; k++) {
        const a = i + k, b = a + (len >> 1);
        const vr = re[b] * cwr - im[b] * cwi;
        const vi = re[b] * cwi + im[b] * cwr;
        re[b] = re[a] - vr; im[b] = im[a] - vi;
        re[a] += vr; im[a] += vi;
        const nwr = cwr * wr - cwi * wi;
        cwi = cwr * wi + cwi * wr;
        cwr = nwr;
      }
    }
  }
}

/* ---------- shared UI atoms ---------- */
function Eyebrow({ children }) {
  return (
    <div style={{ fontFamily: FONT.mono, fontSize: 11, letterSpacing: "0.18em", textTransform: "uppercase", color: C.faint }}>
      {children}
    </div>
  );
}

function Panel({ label, children, style }) {
  return (
    <div style={{ background: C.panel, border: `1px solid ${C.edge}`, borderRadius: 10, padding: 16, ...style }}>
      {label && <div style={{ marginBottom: 12 }}><Eyebrow>{label}</Eyebrow></div>}
      {children}
    </div>
  );
}

function Slider({ label, value, min, max, step, onChange, color = C.ink, unit = "", fmt }) {
  return (
    <label style={{ display: "block" }}>
      <div className="iq-row" style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 5 }}>
        <span style={{ fontSize: 13, color: C.sub, fontFamily: FONT.body }}>{label}</span>
        <span style={{ fontFamily: FONT.mono, fontSize: 13, color }}>{fmt ? fmt(value) : value}{unit}</span>
      </div>
      <input type="range" min={min} max={max} step={step} value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        style={{ width: "100%", color }} />
    </label>
  );
}

function Sig({ color, sig, set, label }) {
  return (
    <div style={{ borderTop: `1px solid ${C.gridFaint}`, paddingTop: 12, marginTop: 12 }}>
      <label style={{ display: "flex", alignItems: "center", gap: 9, marginBottom: sig.on ? 10 : 0, cursor: "pointer" }}>
        <input type="checkbox" checked={sig.on} onChange={(e) => set({ ...sig, on: e.target.checked })} style={{ color, width: 15, height: 15 }} />
        <span style={{ width: 9, height: 9, borderRadius: 9, background: color, opacity: sig.on ? 1 : 0.35, flex: "0 0 auto" }} />
        <span style={{ fontFamily: FONT.mono, fontSize: 12.5, color: sig.on ? C.ink : C.faint, letterSpacing: "0.04em" }}>{label}</span>
      </label>
      {sig.on && (
        <div style={{ display: "grid", gap: 11, paddingLeft: 33 }}>
          <Slider label="Frequency offset" value={sig.off} min={-10} max={10} step={0.1} color={color} fmt={(v) => sgn(v, 1)} onChange={(off) => set({ ...sig, off })} />
          <Slider label="Amplitude" value={sig.amp} min={0.05} max={1} step={0.01} color={color} fmt={(v) => v.toFixed(2)} onChange={(amp) => set({ ...sig, amp })} />
        </div>
      )}
    </div>
  );
}

/* ============================================================
   MODULE 01 — THE SPINNING ARROW (single phasor)
   ============================================================ */
function PhasorModule({ reduced }) {
  const planeRef = useRef(null);
  const waveRef = useRef(null);
  const [off, setOff] = useState(2);
  const [amp, setAmp] = useState(1);
  const st = useRef({ off, amp });
  st.current = { off, amp };

  const hist = useRef({ I: [], Q: [] });
  const trail = useRef([]);
  const out = { I: useRef(null), Q: useRef(null), mag: useRef(null), ph: useRef(null), dir: useRef(null) };
  const SPEED = 0.2; // visual slow-down factor

  function drawPlane(theta) {
    const cv = planeRef.current; if (!cv) return;
    const w = cv.clientWidth, h = cv.clientHeight;
    const ctx = cv._ctx || (cv._ctx = fitCanvas(cv, w, h));
    const { amp } = st.current;
    ctx.clearRect(0, 0, w, h);
    const cx = w / 2, cy = h / 2, R = Math.min(w, h) * 0.4;
    // grid
    ctx.strokeStyle = C.gridFaint; ctx.lineWidth = 1;
    for (let g = -1; g <= 1; g += 0.5) {
      ctx.beginPath(); ctx.moveTo(cx + g * R, cy - R); ctx.lineTo(cx + g * R, cy + R); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(cx - R, cy - g * R); ctx.lineTo(cx + R, cy - g * R); ctx.stroke();
    }
    // unit circle
    ctx.strokeStyle = C.grid; ctx.beginPath(); ctx.arc(cx, cy, R, 0, 2 * Math.PI); ctx.stroke();
    // axes
    ctx.strokeStyle = C.edge; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(cx - R - 12, cy); ctx.lineTo(cx + R + 12, cy); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(cx, cy - R - 12); ctx.lineTo(cx, cy + R + 12); ctx.stroke();
    ctx.font = `11px ${FONT.mono}`;
    ctx.fillStyle = C.I; ctx.textAlign = "left"; ctx.fillText("I", cx + R + 6, cy + 14);
    ctx.fillStyle = C.Q; ctx.textAlign = "center"; ctx.fillText("Q", cx + 12, cy - R - 6);

    const x = Math.cos(theta) * amp, y = Math.sin(theta) * amp;
    const px = cx + x * R, py = cy - y * R;

    // trail (phosphor persistence)
    const tr = trail.current;
    tr.push([px, py]); if (tr.length > 70) tr.shift();
    for (let i = 0; i < tr.length; i++) {
      const a = i / tr.length;
      ctx.fillStyle = `rgba(236,231,219,${a * 0.28})`;
      ctx.beginPath(); ctx.arc(tr[i][0], tr[i][1], 1.6, 0, 2 * Math.PI); ctx.fill();
    }
    // projection guides
    ctx.setLineDash([3, 3]); ctx.lineWidth = 1;
    ctx.strokeStyle = C.I; ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(px, cy); ctx.stroke();
    ctx.strokeStyle = C.Q; ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(cx, py); ctx.stroke();
    ctx.setLineDash([]);
    // component segments on axes
    ctx.lineWidth = 4; ctx.lineCap = "round";
    ctx.strokeStyle = C.I; ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(px, cy); ctx.stroke();
    ctx.strokeStyle = C.Q; ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx, py); ctx.stroke();
    ctx.fillStyle = C.I; ctx.beginPath(); ctx.arc(px, cy, 3.5, 0, 7); ctx.fill();
    ctx.fillStyle = C.Q; ctx.beginPath(); ctx.arc(cx, py, 3.5, 0, 7); ctx.fill();
    // the vector
    arrow(ctx, cx, cy, px, py, C.sum, 2.5, 9);
    ctx.fillStyle = C.sum; ctx.beginPath(); ctx.arc(px, py, 3.5, 0, 7); ctx.fill();

    // readouts
    const ph = ((((theta + Math.PI) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI)) - Math.PI;
    if (out.I.current) out.I.current.textContent = sgn(x, 3);
    if (out.Q.current) out.Q.current.textContent = sgn(y, 3);
    if (out.mag.current) out.mag.current.textContent = amp.toFixed(3);
    if (out.ph.current) out.ph.current.textContent = sgn((ph * 180) / Math.PI, 1) + "\u00B0";
  }

  function drawWave(theta) {
    const cv = waveRef.current; if (!cv) return;
    const w = cv.clientWidth, h = cv.clientHeight;
    const ctx = cv._ctx || (cv._ctx = fitCanvas(cv, w, h));
    const { amp } = st.current;
    const N = 240;
    const H = hist.current;
    H.I.push(Math.cos(theta) * amp); H.Q.push(Math.sin(theta) * amp);
    if (H.I.length > N) { H.I.shift(); H.Q.shift(); }
    ctx.clearRect(0, 0, w, h);
    const mid = h / 2, A = h * 0.36;
    ctx.strokeStyle = C.gridFaint; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(0, mid); ctx.lineTo(w, mid); ctx.stroke();
    const plot = (arr, color) => {
      ctx.strokeStyle = color; ctx.lineWidth = 2; ctx.beginPath();
      for (let i = 0; i < arr.length; i++) {
        const xx = (i / (N - 1)) * w, yy = mid - arr[i] * A;
        i ? ctx.lineTo(xx, yy) : ctx.moveTo(xx, yy);
      }
      ctx.stroke();
      const last = arr.length - 1;
      if (last >= 0) {
        ctx.fillStyle = color;
        ctx.beginPath(); ctx.arc((last / (N - 1)) * w, mid - arr[last] * A, 3, 0, 7); ctx.fill();
      }
    };
    plot(H.I, C.I); plot(H.Q, C.Q);
    ctx.fillStyle = C.faint; ctx.font = `10px ${FONT.mono}`; ctx.textAlign = "left";
    ctx.fillText("\u2190 earlier      now \u2192", 8, h - 8);
  }

  useRaf((el) => { const th = 2 * Math.PI * st.current.off * el * SPEED; drawPlane(th); drawWave(th); }, !reduced);
  useEffect(() => {
    if (!reduced) return;
    // static frame + a static wave snapshot
    const H = hist.current; H.I = []; H.Q = [];
    for (let i = 0; i < 240; i++) { const t = i * 0.05 * off; H.I.push(Math.cos(t) * amp); H.Q.push(Math.sin(t) * amp); }
    trail.current = [];
    drawPlane(0.7); drawWave(0.7 + 240 * 0.05 * off);
  }, [reduced, off, amp]);

  const dir = off > 0.05 ? "counter-clockwise (positive)" : off < -0.05 ? "clockwise (negative)" : "still (zero offset)";

  return (
    <div>
      <Lead
        notes={[
          { t: "Term", c: C.s1, x: "\u201CComplex\u201D just means a 2-D coordinate: I is the left\u2013right position, Q the up\u2013down. The pair names one point \u2014 nothing imaginary about it in practice." },
          { t: "Intuition", c: C.Q, x: "A single up-and-down wiggle can\u2019t reveal which way an arrow turns \u2014 clockwise and counter-clockwise look identical. Keeping both shadows preserves direction: the difference between a station above your dial and one below it." },
          { t: "Try it", c: C.I, x: "Set the frequency to 0 and the arrow parks \u2014 a signal sitting exactly on your tuned frequency. Then swing it negative vs positive: same speed, opposite spin." },
        ]}
        n="01" title="One signal is a spinning arrow"
        body="A complex sample is just a point in a 2-D plane: the I value runs left–right, the Q value runs up–down. A steady signal makes that point spin at a constant rate. Watch the two coloured shadows it casts on the axes — those two numbers are exactly what gets written to the file, one pair per moment in time." />
      <div className="iq-grid2">
        <div style={{ display: "grid", gap: 14 }}>
          <Panel label="The I/Q plane — live">
            <canvas ref={planeRef} style={{ width: "100%", height: 320, display: "block" }} />
          </Panel>
          <Panel label="The two numbers, over time">
            <canvas ref={waveRef} style={{ width: "100%", height: 150, display: "block" }} />
            <div style={{ display: "flex", gap: 18, marginTop: 10, fontFamily: FONT.body, fontSize: 12.5 }}>
              <span style={{ color: C.I }}>● I = cosine (in-phase)</span>
              <span style={{ color: C.Q }}>● Q = sine (quadrature, 90° behind)</span>
            </div>
          </Panel>
        </div>
        <div style={{ display: "grid", gap: 14, alignContent: "start" }}>
          <Panel label="Controls">
            <div style={{ display: "grid", gap: 16 }}>
              <Slider label="Frequency offset (from tuned centre)" value={off} min={-6} max={6} step={0.1} color={C.ink} fmt={(v) => sgn(v, 1)} onChange={setOff} />
              <Slider label="Amplitude" value={amp} min={0.1} max={1} step={0.01} color={C.ink} fmt={(v) => v.toFixed(2)} onChange={setAmp} />
            </div>
            <p style={{ fontFamily: FONT.body, fontSize: 12.5, color: C.sub, lineHeight: 1.55, marginTop: 14, marginBottom: 0 }}>
              Spin direction = <span style={{ color: C.ink }}>{dir}</span>. A single real channel can’t tell clockwise from counter-clockwise — that’s the whole reason we keep two numbers instead of one.
            </p>
          </Panel>
          <Panel label="The current sample">
            <Readout rows={[["I", out.I, C.I], ["Q", out.Q, C.Q], ["magnitude  √(I²+Q²)", out.mag, C.ink], ["phase  atan2(Q,I)", out.ph, C.ink]]} />
            <p style={{ fontFamily: FONT.body, fontSize: 12.5, color: C.sub, lineHeight: 1.55, margin: "12px 0 0" }}>
              This one <span style={{ color: C.ink }}>(I, Q)</span> pair is a single sample. Stream thousands per second and you’ve recorded the signal.
            </p>
          </Panel>
        </div>
      </div>
      <Deeper
        recap="A single complex sample isn't two separate numbers \u2014 it's one arrow in the plane. I is how far along the real axis, Q how far up the imaginary axis; together they fix the arrow's length (amplitude) and angle (phase). Play many samples per second and the arrow spins, and that rotation rate is the signal's frequency. Crucially, which way it spins distinguishes positive from negative frequency \u2014 the one thing a single real channel can't capture."
        example={`One sample with I = 0.6, Q = 0.8:
   amplitude = \u221a(I\u00b2+Q\u00b2) = \u221a(0.36+0.64) = 1.0
   phase     = atan2(Q, I)  = atan2(0.8, 0.6) = 53.1\u00b0

A 1 kHz tone sampled at 8 kHz turns 1000/8000 of a circle
per sample = 45\u00b0 each step:
   n=0: 0\u00b0    n=1: 45\u00b0    n=2: 90\u00b0    n=3: 135\u00b0 ...
   I = cos(45\u00b0\u00b7n),  Q = sin(45\u00b0\u00b7n)

Flip to \u22121 kHz and the arrow spins the other way (\u221245\u00b0/step).
The I waveform looks identical; only Q's sign flips \u2014 which is
exactly the \u00b1frequency information Q exists to carry.`}
      />
    </div>
  );
}

function Readout({ rows }) {
  return (
    <div style={{ display: "grid", gap: 8 }}>
      {rows.map(([label, ref, color], i) => (
        <div key={i} style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", borderBottom: `1px solid ${C.gridFaint}`, paddingBottom: 6 }}>
          <span style={{ fontFamily: FONT.body, fontSize: 12, color: C.sub }}>{label}</span>
          <span ref={ref} style={{ fontFamily: FONT.mono, fontSize: 15, color }}>—</span>
        </div>
      ))}
    </div>
  );
}

/* ============================================================
   MODULE 02 — ADDING SIGNALS (superposition)
   ============================================================ */
function SuperposModule({ reduced }) {
  const planeRef = useRef(null);
  const waveRef = useRef(null);
  const [sigs, setSigs] = useState([
    { on: true, off: 2.0, amp: 0.7, ph0: 0.0 },
    { on: true, off: -3.0, amp: 0.5, ph0: 1.1 },
    { on: false, off: 5.0, amp: 0.45, ph0: 2.3 },
  ]);
  const st = useRef(sigs); st.current = sigs;
  const trail = useRef([]);
  const hist = useRef([]); // {sum, comps:[..]}
  const Rsmooth = useRef(70);
  const out = { I: useRef(null), Q: useRef(null), n: useRef(null) };
  const SPEED = 0.16;

  function frame(el) {
    drawPlane(el); drawWave(el);
  }
  function comps(el) {
    return st.current.map((s) => {
      if (!s.on) return null;
      const th = 2 * Math.PI * s.off * el * SPEED + s.ph0;
      return [Math.cos(th) * s.amp, Math.sin(th) * s.amp];
    });
  }

  function drawPlane(el) {
    const cv = planeRef.current; if (!cv) return;
    const w = cv.clientWidth, h = cv.clientHeight;
    const ctx = cv._ctx || (cv._ctx = fitCanvas(cv, w, h));
    ctx.clearRect(0, 0, w, h);
    const cx = w / 2, cy = h / 2;
    const cs = comps(el);
    const total = st.current.reduce((a, s) => a + (s.on ? s.amp : 0), 0);
    const targetR = (Math.min(w, h) * 0.42) / Math.max(1, total);
    Rsmooth.current += (targetR - Rsmooth.current) * 0.12;
    const R = Rsmooth.current;
    // grid + axes
    ctx.strokeStyle = C.gridFaint; ctx.lineWidth = 1;
    for (let g = -1; g <= 1; g++) { ctx.beginPath(); ctx.moveTo(cx + g * R, 0); ctx.lineTo(cx + g * R, h); ctx.stroke(); ctx.beginPath(); ctx.moveTo(0, cy + g * R); ctx.lineTo(w, cy + g * R); ctx.stroke(); }
    ctx.strokeStyle = C.edge; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(0, cy); ctx.lineTo(w, cy); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(cx, 0); ctx.lineTo(cx, h); ctx.stroke();

    // tip-to-tail
    let ox = cx, oy = cy, sx = 0, sy = 0;
    cs.forEach((c, i) => {
      if (!c) return;
      const nx = ox + c[0] * R, ny = oy - c[1] * R;
      arrow(ctx, ox, oy, nx, ny, SIG[i], 2, 7);
      ox = nx; oy = ny; sx += c[0]; sy += c[1];
    });
    // trail of the sum tip
    const px = cx + sx * R, py = cy - sy * R;
    const tr = trail.current; tr.push([sx, sy]); if (tr.length > 240) tr.shift();
    ctx.lineWidth = 1.5; ctx.beginPath();
    for (let i = 1; i < tr.length; i++) {
      ctx.strokeStyle = `rgba(236,231,219,${(i / tr.length) * 0.32})`;
      ctx.beginPath(); ctx.moveTo(cx + tr[i - 1][0] * R, cy - tr[i - 1][1] * R); ctx.lineTo(cx + tr[i][0] * R, cy - tr[i][1] * R); ctx.stroke();
    }
    arrow(ctx, cx, cy, px, py, C.sum, 2.5, 9);
    ctx.fillStyle = C.sum; ctx.beginPath(); ctx.arc(px, py, 3.5, 0, 7); ctx.fill();

    if (out.I.current) out.I.current.textContent = sgn(sx, 3);
    if (out.Q.current) out.Q.current.textContent = sgn(sy, 3);
    if (out.n.current) out.n.current.textContent = String(cs.filter(Boolean).length);
  }

  function drawWave(el) {
    const cv = waveRef.current; if (!cv) return;
    const w = cv.clientWidth, h = cv.clientHeight;
    const ctx = cv._ctx || (cv._ctx = fitCanvas(cv, w, h));
    const N = 260;
    const cs = comps(el);
    const sum = cs.reduce((a, c) => a + (c ? c[0] : 0), 0);
    const H = hist.current;
    H.push({ sum, comps: st.current.map((s, i) => (cs[i] ? cs[i][0] : null)) });
    if (H.length > N) H.shift();
    ctx.clearRect(0, 0, w, h);
    const mid = h / 2;
    const total = st.current.reduce((a, s) => a + (s.on ? s.amp : 0), 0);
    const A = (h * 0.4) / Math.max(1, total);
    ctx.strokeStyle = C.gridFaint; ctx.beginPath(); ctx.moveTo(0, mid); ctx.lineTo(w, mid); ctx.stroke();
    // faint component lines
    st.current.forEach((s, si) => {
      if (!s.on) return;
      ctx.strokeStyle = SIG[si] + "55"; ctx.lineWidth = 1; ctx.beginPath();
      let started = false;
      for (let i = 0; i < H.length; i++) {
        const v = H[i].comps[si]; if (v == null) { started = false; continue; }
        const xx = (i / (N - 1)) * w, yy = mid - v * A;
        started ? ctx.lineTo(xx, yy) : ctx.moveTo(xx, yy); started = true;
      }
      ctx.stroke();
    });
    // sum line
    ctx.strokeStyle = C.sum; ctx.lineWidth = 2.2; ctx.beginPath();
    for (let i = 0; i < H.length; i++) { const xx = (i / (N - 1)) * w, yy = mid - H[i].sum * A; i ? ctx.lineTo(xx, yy) : ctx.moveTo(xx, yy); }
    ctx.stroke();
  }

  useRaf(frame, !reduced);
  useEffect(() => { if (reduced) { trail.current = []; hist.current = []; for (let i = 0; i < 260; i++) frame(i * 0.05); } }, [reduced, sigs]);

  const set = (i) => (s) => setSigs((p) => p.map((x, j) => (j === i ? s : x)));

  return (
    <div>
      <Lead
        notes={[
          { t: "Term", c: C.s1, x: "Superposition: waves simply add. Two signals don\u2019t fuse into a third thing \u2014 they coexist, the way a musical chord still contains each separate note." },
          { t: "Intuition", c: C.Q, x: "Every transmitter in range pushes the same antenna at once, so you measure their running total \u2014 one value at each instant. The air keeps no separate envelopes, and neither does the file." },
          { t: "Try it", c: C.I, x: "Switch on a second signal and the white tip traces loops instead of a clean circle. Every extra wiggle is real information \u2014 the spectrum lesson reads it back out." },
        ]}
        n="02" title="Many signals add into one arrow"
        body="Your antenna only ever feels one voltage at a time — the sum of every transmission in the air. Give each signal its own spinning arrow, then lay them tip-to-tail. The white arrow is their running total, and its tip is the only thing the recorder writes down. That’s why two numbers are enough no matter how many stations are on the air." />
      <div className="iq-grid2">
        <div style={{ display: "grid", gap: 14 }}>
          <Panel label="Arrows added tip-to-tail">
            <canvas ref={planeRef} style={{ width: "100%", height: 330, display: "block" }} />
          </Panel>
          <Panel label="The combined waveform that gets recorded">
            <canvas ref={waveRef} style={{ width: "100%", height: 150, display: "block" }} />
            <p style={{ fontFamily: FONT.body, fontSize: 12.5, color: C.sub, margin: "10px 0 0", lineHeight: 1.5 }}>
              White = what the file stores. Faint colours = each signal’s hidden contribution. The total looks like noise, yet every signal is still in there.
            </p>
          </Panel>
        </div>
        <div style={{ display: "grid", gap: 14, alignContent: "start" }}>
          <Panel label="Signals in the air">
            {sigs.map((s, i) => <Sig key={i} color={SIG[i]} sig={s} set={set(i)} label={`SIGNAL ${i + 1}`} />)}
          </Panel>
          <Panel label="What the recorder sees">
            <Readout rows={[["signals stacked", out.n, C.ink], ["summed I", out.I, C.I], ["summed Q", out.Q, C.Q]]} />
            <p style={{ fontFamily: FONT.body, fontSize: 12.5, color: C.sub, margin: "12px 0 0", lineHeight: 1.55 }}>
              Still one <span style={{ color: C.ink }}>(I, Q)</span> pair per sample. The individual signals aren’t stored separately — they’re hidden in how the total <em>changes</em> over time.
            </p>
          </Panel>
        </div>
      </div>
      <Deeper
        recap="When several signals share the band the antenna doesn't receive a list of them \u2014 it receives their vector sum, one arrow that is the tip-to-tail addition of each signal's arrow at that instant. No information is destroyed, but it's entangled: the only handle on the parts is that each spins at its own rate, so the summed arrow's path over many samples carries their separate fingerprints."
        example={`Two tones at one instant:
   signal A:  0.50 \u2220 30\u00b0  = (0.433,  0.250)
   signal B:  0.30 \u2220120\u00b0  = (\u22120.150, 0.260)
   recorded sum             = (0.283,  0.510) = 0.583 \u2220 61\u00b0

That single (0.283, 0.510) pair is everything the recorder
stores for this instant. One sample later each arrow has
rotated by its own frequency, so the sum lands somewhere new.
Over many samples those two rotation rates trace a pattern an
FFT can separate \u2014 which is the next module.`}
      />
    </div>
  );
}

/* ============================================================
   MODULE 03 — SEEING THE SPECTRUM (FFT + waterfall)
   ============================================================ */
const FS = 24; // sample rate; edges = ±12
function SpectrumModule({ reduced }) {
  const timeRef = useRef(null);
  const specRef = useRef(null);
  const fallRef = useRef(null);
  const [sigs, setSigs] = useState([
    { on: true, off: -7, amp: 0.8 },
    { on: true, off: -1, amp: 0.5 },
    { on: true, off: 3.5, amp: 0.7 },
    { on: false, off: 8, amp: 0.45 },
  ]);
  const [noise, setNoise] = useState(true);
  const st = useRef({ sigs, noise }); st.current = { sigs, noise };

  const N = 512;

  function synth() {
    const { sigs, noise } = st.current;
    const re = new Float64Array(N), im = new Float64Array(N);
    for (let n = 0; n < N; n++) {
      let I = 0, Q = 0;
      for (const s of sigs) { if (!s.on) continue; const ph = (2 * Math.PI * s.off * n) / FS; I += s.amp * Math.cos(ph); Q += s.amp * Math.sin(ph); }
      if (noise) { I += (Math.random() - 0.5) * 0.18; Q += (Math.random() - 0.5) * 0.18; }
      const wnd = 0.5 - 0.5 * Math.cos((2 * Math.PI * n) / (N - 1));
      re[n] = I * wnd; im[n] = Q * wnd;
    }
    return { re, im };
  }

  function spectrum() {
    const { re, im } = synth();
    const tI = re.slice(0, 160); // (windowed) just for the time view shape
    fft(re, im);
    const mag = new Float64Array(N);
    let mx = 1e-9;
    for (let k = 0; k < N; k++) { mag[k] = Math.hypot(re[k], im[k]); if (mag[k] > mx) mx = mag[k]; }
    // fftshift -> index 0 == -FS/2
    const sh = new Float64Array(N);
    for (let i = 0; i < N; i++) sh[i] = mag[(i + N / 2) % N] / mx;
    return { sh, tI };
  }

  function drawTime(tI) {
    const cv = timeRef.current; if (!cv) return;
    const w = cv.clientWidth, h = cv.clientHeight;
    const ctx = cv._ctx || (cv._ctx = fitCanvas(cv, w, h));
    ctx.clearRect(0, 0, w, h);
    const mid = h / 2;
    const total = st.current.sigs.reduce((a, s) => a + (s.on ? s.amp : 0), 0) || 1;
    const A = (h * 0.4) / Math.max(0.6, total);
    ctx.strokeStyle = C.gridFaint; ctx.beginPath(); ctx.moveTo(0, mid); ctx.lineTo(w, mid); ctx.stroke();
    ctx.strokeStyle = C.sum; ctx.lineWidth = 1.6; ctx.beginPath();
    for (let i = 0; i < tI.length; i++) { const xx = (i / (tI.length - 1)) * w, yy = mid - tI[i] * A; i ? ctx.lineTo(xx, yy) : ctx.moveTo(xx, yy); }
    ctx.stroke();
  }

  function drawSpec(sh) {
    const cv = specRef.current; if (!cv) return;
    const w = cv.clientWidth, h = cv.clientHeight;
    const ctx = cv._ctx || (cv._ctx = fitCanvas(cv, w, h));
    ctx.clearRect(0, 0, w, h);
    const padB = 22, padT = 8;
    const plotH = h - padB - padT;
    // grid + freq ticks
    ctx.font = `10px ${FONT.mono}`; ctx.textAlign = "center";
    [-12, -6, 0, 6, 12].forEach((f) => {
      const xx = ((f + 12) / 24) * w;
      ctx.strokeStyle = f === 0 ? C.edge : C.gridFaint; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(xx, padT); ctx.lineTo(xx, padT + plotH); ctx.stroke();
      ctx.fillStyle = f === 0 ? C.sub : C.faint;
      ctx.fillText(f === 0 ? "0" : sgn(f, 0), xx, h - 7);
    });
    // filled spectrum
    const grad = ctx.createLinearGradient(0, padT, 0, padT + plotH);
    grad.addColorStop(0, "rgba(86,199,191,0.85)");
    grad.addColorStop(1, "rgba(86,199,191,0.08)");
    ctx.beginPath(); ctx.moveTo(0, padT + plotH);
    for (let i = 0; i < N; i++) { const xx = (i / (N - 1)) * w, yy = padT + plotH - sh[i] * plotH * 0.94; ctx.lineTo(xx, yy); }
    ctx.lineTo(w, padT + plotH); ctx.closePath(); ctx.fillStyle = grad; ctx.fill();
    ctx.strokeStyle = C.Q; ctx.lineWidth = 1.4; ctx.beginPath();
    for (let i = 0; i < N; i++) { const xx = (i / (N - 1)) * w, yy = padT + plotH - sh[i] * plotH * 0.94; i ? ctx.lineTo(xx, yy) : ctx.moveTo(xx, yy); }
    ctx.stroke();
    // labels
    ctx.fillStyle = C.faint; ctx.textAlign = "left"; ctx.fillText("\u2212½ rate", 4, padT + 10);
    ctx.textAlign = "right"; ctx.fillText("+½ rate", w - 4, padT + 10);
    ctx.textAlign = "center"; ctx.fillStyle = C.sub; ctx.fillText("centre", w / 2, padT + 10);
  }

  function ramp(v) {
    // dark -> cyan -> bone
    v = clamp(v, 0, 1);
    if (v < 0.5) { const t = v / 0.5; return [Math.round(14 + t * (40)), Math.round(20 + t * (179)), Math.round(25 + t * (166))]; }
    const t = (v - 0.5) / 0.5; return [Math.round(54 + t * 182), Math.round(199 + t * 32), Math.round(191 + t * 28)];
  }

  function drawFall(sh, init) {
    const cv = fallRef.current; if (!cv) return;
    const w = cv.clientWidth, h = cv.clientHeight;
    if (!cv._init) { cv.width = w; cv.height = h; cv.style.width = w + "px"; cv.style.height = h + "px"; cv._init = true; cv._ctx = cv.getContext("2d"); cv._ctx.fillStyle = C.bg; cv._ctx.fillRect(0, 0, w, h); }
    const ctx = cv._ctx;
    const rows = init ? h : 1;
    if (!init) { ctx.drawImage(cv, 0, 1); }
    const cols = w;
    for (let r = 0; r < rows; r++) {
      const img = ctx.createImageData(cols, 1);
      for (let xpix = 0; xpix < cols; xpix++) {
        const i = Math.floor((xpix / cols) * N);
        let v = sh[i];
        if (init) v = clamp(v + (Math.random() - 0.5) * 0.1, 0, 1);
        const [R, G, B] = ramp(v);
        img.data[xpix * 4] = R; img.data[xpix * 4 + 1] = G; img.data[xpix * 4 + 2] = B; img.data[xpix * 4 + 3] = 255;
      }
      ctx.putImageData(img, 0, r);
    }
  }

  const frameCount = useRef(0);
  useRaf(() => {
    const { sh, tI } = spectrum();
    drawTime(tI); drawSpec(sh);
    if (frameCount.current % 2 === 0) drawFall(sh, false);
    frameCount.current++;
  }, !reduced);

  useEffect(() => {
    // redraw static (also runs once for reduced)
    const { sh, tI } = spectrum();
    drawTime(tI); drawSpec(sh);
    if (reduced) drawFall(sh, true);
    // eslint-disable-next-line
  }, [sigs, noise, reduced]);

  const set = (i) => (s) => setSigs((p) => p.map((x, j) => (j === i ? s : x)));

  return (
    <div>
      <Lead
        notes={[
          { t: "Term", c: C.s1, x: "Fourier transform: a machine that takes a stretch of the combined wiggle and reports how much of each spin-rate is inside \u2014 one bar per frequency. The mathematical un-mixer." },
          { t: "Intuition", c: C.Q, x: "In one sample the signals are hopelessly added; across many samples each one\u2019s steady rate makes it stand out \u2014 like hearing a sustained note inside a chord by its pitch." },
          { t: "Heads up", c: C.s2, x: "You only see frequencies within \u00B1half the sample rate. A signal just past the edge doesn\u2019t vanish \u2014 it folds back inside and impersonates another frequency (aliasing). Sample faster to widen the view." },
        ]}
        n="03" title="Pull them apart by frequency"
        body="Each signal’s arrow spins at its own rate. A Fourier transform measures those rates across a block of samples and sorts the tangled sum back into separate peaks — one per signal, placed at its frequency offset. Stack those spectra over time and you get the waterfall every radio operator stares at. Notice the separation lives in the sequence of samples, never in any single one." />
      <div className="iq-grid2">
        <div style={{ display: "grid", gap: 14 }}>
          <Panel label="Time domain — the tangled sum">
            <canvas ref={timeRef} style={{ width: "100%", height: 96, display: "block" }} />
          </Panel>
          <Panel label="Frequency domain — sorted into peaks">
            <canvas ref={specRef} style={{ width: "100%", height: 168, display: "block" }} />
          </Panel>
          <Panel label="Waterfall — spectrum stacked over time (newest on top)">
            <canvas ref={fallRef} style={{ width: "100%", height: 120, display: "block", borderRadius: 4 }} />
          </Panel>
        </div>
        <div style={{ display: "grid", gap: 14, alignContent: "start" }}>
          <Panel label="Signals in the band">
            {sigs.map((s, i) => <Sig key={i} color={SIG[i]} sig={s} set={set(i)} label={`SIGNAL ${i + 1}`} />)}
            <label style={{ display: "flex", alignItems: "center", gap: 9, marginTop: 14, cursor: "pointer", color: C.sub }}>
              <input type="checkbox" checked={noise} onChange={(e) => setNoise(e.target.checked)} style={{ color: C.sub, width: 15, height: 15 }} />
              <span style={{ fontFamily: FONT.body, fontSize: 13 }}>background noise</span>
            </label>
          </Panel>
          <Panel label="Read it like an operator">
            <p style={{ fontFamily: FONT.body, fontSize: 12.5, color: C.sub, lineHeight: 1.6, margin: 0 }}>
              Drag a signal’s <span style={{ color: C.ink }}>frequency</span> and watch its peak slide; change <span style={{ color: C.ink }}>amplitude</span> and the peak grows. The window spans <span style={{ color: C.Q }}>−½ to +½</span> of the sample rate around your tuned centre — widen the sample rate to capture more spectrum at once. To grab one signal, shift its peak to the centre, low-pass filter, then decimate. That’s <em>channelization</em>, done in software after the fact.
            </p>
          </Panel>
        </div>
      </div>
      <Deeper
        recap="An FFT takes a block of I/Q samples and reports how much energy sits at each frequency, turning the spinning-arrow time view into a stack of peaks \u2014 one per signal. The window it can see spans the sample rate, from \u2212Fs/2 to +Fs/2 around your tuned centre. Signals beyond that edge don't disappear; they alias, folding back to a false frequency inside the window."
        example={`Sample rate Fs = 24, so the visible window is \u221212 \u2026 +12.
   a tone at +5   \u2192 peak at +5    (inside \u2014 fine)
   a tone at +14  \u2192 14 is 2 past +12, so it folds to
                     14 \u2212 24 = \u221210  \u2192 a FALSE peak at \u221210

The rule: anything above +Fs/2 wraps down by Fs. That folding
is aliasing \u2014 the reason you must sample fast enough (or filter
first) to cover every signal you actually care about.`}
      />
    </div>
  );
}

/* ============================================================
   MODULE 04 — INSIDE THE FILE (encoding / complex32)
   ============================================================ */
function f32bytes(v) {
  const b = new Uint8Array(new Float32Array([v]).buffer);
  return [...b].map((x) => x.toString(16).padStart(2, "0").toUpperCase());
}
function i16bytes(v) {
  let n = clamp(Math.round(v * 32767), -32768, 32767);
  if (n < 0) n += 65536;
  return [(n & 0xff), (n >> 8) & 0xff].map((x) => x.toString(16).padStart(2, "0").toUpperCase());
}
function f16bytes(v) {
  const i = new Uint32Array(new Float32Array([v]).buffer)[0];
  const s = (i >> 16) & 0x8000;
  let e = ((i >> 23) & 0xff) - 127 + 15;
  const m = i & 0x7fffff;
  let h;
  if (e <= 0) h = s; else if (e >= 31) h = s | 0x7c00; else h = s | (e << 10) | (m >> 13);
  return [(h & 0xff), (h >> 8) & 0xff].map((x) => x.toString(16).padStart(2, "0").toUpperCase());
}

function ByteCells({ bytes, color }) {
  return (
    <span style={{ display: "inline-flex", gap: 3 }}>
      {bytes.map((b, i) => (
        <span key={i} style={{ fontFamily: FONT.mono, fontSize: 12, padding: "3px 5px", borderRadius: 3, background: color + "22", border: `1px solid ${color}55`, color: C.ink }}>{b}</span>
      ))}
    </span>
  );
}

function EncodingModule() {
  const [I, setI] = useState(0.7071);
  const [Q, setQ] = useState(-0.5);
  const encs = [
    { key: "cf32", title: "Two float32  (8 bytes / sample)", note: "NumPy complex64 · SigMF cf32 · most SDR tools", I: f32bytes(I), Q: f32bytes(Q), per: 4 },
    { key: "ci16", title: "Two int16  (4 bytes / sample)", note: "raw SDR captures · value = round(x × 32767)", I: i16bytes(I), Q: i16bytes(Q), per: 2 },
    { key: "cf16", title: "Two float16  (4 bytes / sample)", note: "PyTorch torch.complex32 · ML pipelines", I: f16bytes(I), Q: f16bytes(Q), per: 2 },
  ];

  return (
    <div>
      <Lead
        notes={[
          { t: "Term", c: C.s1, x: "Little-endian: the byte order, least-significant first. It\u2019s a convention \u2014 read the bytes in the wrong order and your numbers turn to nonsense, a classic first-day bug." },
          { t: "Intuition", c: C.Q, x: "Because the raw file is only numbers, it can\u2019t state its own sample rate or centre frequency \u2014 much as a column of temperatures won\u2019t tell you which cities they came from. That context rides in a sidecar, or in whoever handed you the file." },
          { t: "Heads up", c: C.s2, x: "\u201Ccomplex32\u201D is a trap word: confirm whether it means 32 bits per number or 32 bits total before parsing. The bytes-per-sample test on the right settles it in seconds." },
        ]}
        n="04" title="How the pairs land on disk"
        body="A raw I/Q file is usually just a flat stream with no header: I, Q, I, Q, I, Q … little-endian, nothing else. Because the bytes carry no labels, the sample rate, centre frequency, and even the number format have to be known separately. And “complex32” is ambiguous — it can mean 32 bits per component or 32 bits total. Here’s the same sample written three ways." />
      <div className="iq-grid2">
        <div style={{ display: "grid", gap: 14 }}>
          <Panel label="One sample → its raw bytes">
            <div style={{ display: "grid", gap: 16 }}>
              {encs.map((e) => (
                <div key={e.key} style={{ borderLeft: `2px solid ${C.edge}`, paddingLeft: 14 }}>
                  <div style={{ fontFamily: FONT.disp, fontSize: 14, color: C.ink, fontWeight: 600 }}>{e.title}</div>
                  <div style={{ fontFamily: FONT.body, fontSize: 11.5, color: C.faint, marginBottom: 9 }}>{e.note}</div>
                  <div style={{ display: "flex", gap: 14, alignItems: "center", flexWrap: "wrap" }}>
                    <span style={{ display: "inline-flex", gap: 6, alignItems: "center" }}>
                      <span style={{ fontFamily: FONT.mono, fontSize: 11, color: C.I }}>I</span><ByteCells bytes={e.I} color={C.I} />
                    </span>
                    <span style={{ display: "inline-flex", gap: 6, alignItems: "center" }}>
                      <span style={{ fontFamily: FONT.mono, fontSize: 11, color: C.Q }}>Q</span><ByteCells bytes={e.Q} color={C.Q} />
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </Panel>
          <Panel label="The stream — interleaved, no header">
            <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
              {Array.from({ length: 6 }).map((_, k) => (
                <span key={k} style={{ display: "inline-flex", gap: 4 }}>
                  <span style={{ fontFamily: FONT.mono, fontSize: 12, padding: "5px 9px", borderRadius: 4, background: C.I + "22", border: `1px solid ${C.I}55`, color: C.I }}>I{k}</span>
                  <span style={{ fontFamily: FONT.mono, fontSize: 12, padding: "5px 9px", borderRadius: 4, background: C.Q + "22", border: `1px solid ${C.Q}55`, color: C.Q }}>Q{k}</span>
                </span>
              ))}
              <span style={{ fontFamily: FONT.mono, fontSize: 12, color: C.faint, alignSelf: "center", paddingLeft: 4 }}>…</span>
            </div>
            <p style={{ fontFamily: FONT.body, fontSize: 12.5, color: C.sub, margin: "12px 0 0", lineHeight: 1.55 }}>
              Read it back by pulling values two at a time and rebuilding each complex sample. Sample rate and centre frequency must come from a sidecar (e.g. SigMF’s <span style={{ fontFamily: FONT.mono }}>.sigmf-meta</span> JSON) or be agreed in advance.
            </p>
          </Panel>
        </div>
        <div style={{ display: "grid", gap: 14, alignContent: "start" }}>
          <Panel label="Pick a sample">
            <div style={{ display: "grid", gap: 16 }}>
              <Slider label="I value" value={I} min={-1} max={1} step={0.001} color={C.I} fmt={(v) => sgn(v, 3)} onChange={setI} />
              <Slider label="Q value" value={Q} min={-1} max={1} step={0.001} color={C.Q} fmt={(v) => sgn(v, 3)} onChange={setQ} />
            </div>
            <p style={{ fontFamily: FONT.body, fontSize: 11.5, color: C.faint, margin: "12px 0 0", lineHeight: 1.5 }}>
              float values normally sit in roughly −1…+1; int16 spans ±32768. Bytes shown little-endian; float16 here is illustrative (truncated).
            </p>
          </Panel>
          <Panel label="Which one is it? — quick test">
            <div style={{ display: "grid", gap: 11, fontFamily: FONT.body, fontSize: 12.5, color: C.sub, lineHeight: 1.5 }}>
              <div><span style={{ color: C.ink }}>Divide</span> file size by sample count: 8 bytes → float32 pair; 4 bytes → 16-bit pair.</div>
              <div><span style={{ color: C.ink }}>Inspect values:</span> clustered near ±1 → floats; spanning ±32k → int16.</div>
              <div><span style={{ color: C.ink }}>Context:</span> NumPy / ML world leans 32-bits-total (float16); RF / SDR tools lean two-float32.</div>
            </div>
          </Panel>
        </div>
      </div>
      <Deeper
        recap="On disk an I/Q file is just interleaved numbers \u2014 I\u2080, Q\u2080, I\u2081, Q\u2081, \u2026 with no header announcing what they mean. The ambiguity that bites people is the word \u2018complex32\u2019: it can mean 32 bits per component (two float32s, 8 bytes per sample) or 32 bits total (two 16-bit numbers, 4 bytes per sample). Guess wrong and every single sample is misread."
        example={`A file of 1,000,000 bytes holding 125,000 samples:
   1,000,000 / 125,000 = 8 bytes/sample
   \u2192 two float32  (NumPy complex64, SigMF \u201ccf32\u201d)

If it were 500,000 bytes for those same 125,000 samples:
   500,000 / 125,000 = 4 bytes/sample
   \u2192 two 16-bit values  (an int16 pair, or float16)

Then sanity-check the values themselves: clustered near \u00b11
\u2192 floats; swinging out to \u00b130,000 \u2192 int16. Size first to get
bytes-per-sample, values second to pin the type.`}
      />
    </div>
  );
}

/* ---------- deeper dive ---------- */
function Deeper({ recap, example }) {
  const [open, setOpen] = useState(false);
  return (
    <div style={{ marginTop: 18 }}>
      <button onClick={() => setOpen(!open)} style={{ fontFamily: FONT.mono, fontSize: 11.5, padding: "7px 13px", borderRadius: 6, border: `1px solid ${open ? C.Q : C.edge}`, background: open ? C.panelHi : "transparent", color: open ? C.Q : C.sub, cursor: "pointer" }}>
        {open ? "\u25be  hide the deeper dive" : "\u25b8  go deeper \u2014 recap & a worked example"}
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

/* ---------- module intro ---------- */
function Lead({ n, title, body, notes }) {
  return (
    <div style={{ marginBottom: 20 }}>
      <div style={{ maxWidth: 720 }}>
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

/* ============================================================
   APP SHELL
   ============================================================ */
const MODULES = [
  { id: "01", label: "Spinning arrow", comp: PhasorModule },
  { id: "02", label: "Adding signals", comp: SuperposModule },
  { id: "03", label: "The spectrum", comp: SpectrumModule },
  { id: "04", label: "Inside the file", comp: EncodingModule },
];

const DIFF = [1, 1, 2, 1];
const PREDICTS = {"0": {"q": "Flip a tone from +1 kHz to -1 kHz. What changes in the samples?", "options": ["I flips sign", "Q flips sign", "both flip"], "answer": 1, "why": "I = cos is unchanged; only Q = sin flips sign. That is how Q encodes the direction of rotation."}, "2": {"q": "A tone at +13 Hz with Fs = 24. Where does the spectrum show it?", "options": ["+13 Hz", "+11 Hz", "-11 Hz"], "answer": 2, "why": "+13 is past the +12 edge, so it folds to 13 - 24 = -11 Hz."}};
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
        .iq-grid2 { display: grid; grid-template-columns: 1.55fr 1fr; gap: 18px; align-items: start; }
        @media (max-width: 880px){ .iq-grid2 { grid-template-columns: 1fr; } }
        .iq-tab { font-family:${FONT.mono}; font-size:12px; letter-spacing:0.04em; padding:8px 13px; border-radius:7px; border:1px solid transparent; background:transparent; color:${C.sub}; cursor:pointer; white-space:nowrap; transition:background .15s,color .15s; }
        .iq-tab:hover { color:${C.ink}; }
        .iq-tab[data-on="1"]{ background:${C.panelHi}; border-color:${C.edge}; color:${C.ink}; }
        canvas { background:${C.bg}; border-radius:4px; }
      `}</style>

      <div className="iq-wrap">
        <header style={{ marginBottom: 26 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
            <span style={{ width: 11, height: 11, borderRadius: 11, background: C.I }} />
            <span style={{ width: 11, height: 11, borderRadius: 11, background: C.Q }} />
            <Eyebrow>I/Q signal primer</Eyebrow>
          </div>
          <h1 style={{ fontFamily: FONT.disp, fontSize: 34, fontWeight: 700, margin: "0 0 8px", letterSpacing: "-0.02em", lineHeight: 1.05 }}>
            What lives inside an I/Q recording
          </h1>
          <p style={{ fontFamily: FONT.body, fontSize: 15, color: C.sub, maxWidth: 660, lineHeight: 1.6, margin: 0 }}>
            A hands-on walk from a single spinning arrow to many signals sharing one stream, to the spectrum that pulls them apart, to the bytes on disk. Built for someone meeting radios for the first time. Drag everything.
          </p>
          {reduced && (
            <p style={{ fontFamily: FONT.mono, fontSize: 11, color: C.faint, marginTop: 10 }}>
              Reduced-motion is on — views are static but still respond to the controls.
            </p>
          )}
          <nav style={{ display: "flex", gap: 6, marginTop: 22, flexWrap: "wrap", borderBottom: `1px solid ${C.edge}`, paddingBottom: 16 }}>
            {MODULES.map((m, i) => (
              <button key={m.id} className="iq-tab" data-on={active === i ? "1" : "0"} onClick={() => setActive(i)}>
                <span style={{ color: active === i ? C.Q : C.faint, marginRight: 7 }}>{m.id}</span>{m.label}<span title="math intensity (light / medium / heavy)" style={{ marginLeft: 7, letterSpacing: 1, fontSize: 9 }}>{[0, 1, 2].map((_d) => <span key={_d} style={{ color: _d < DIFF[i] ? (DIFF[i] === 1 ? C.D : DIFF[i] === 2 ? C.I : C.warn) : C.gridFaint }}>{"\u2022"}</span>)}</span>
              </button>
            ))}
          </nav>
        </header>

        {PREDICTS[active] && <Predict q={PREDICTS[active].q} options={PREDICTS[active].options} answer={PREDICTS[active].answer} why={PREDICTS[active].why} />}
        <main key={active}>
          <Comp reduced={reduced} />
        </main>

        <footer style={{ marginTop: 40, paddingTop: 18, borderTop: `1px solid ${C.gridFaint}`, fontFamily: FONT.body, fontSize: 12, color: C.faint, lineHeight: 1.6 }}>
          <span style={{ color: C.I }}>I</span> = in-phase · <span style={{ color: C.Q }}>Q</span> = quadrature. One sample = one (I, Q) pair = one point in the plane. The number of signals never changes that — only how the points move.
        </footer>
      </div>
    </div>
  );
}
