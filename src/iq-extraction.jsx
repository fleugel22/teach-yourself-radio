import { useState, useRef, useEffect } from "react";

/* ============================================================
   IQ EXPLORER · PART 2 — EXTRACTING SIGNALS FROM THE MIX
   Same identity as Part 1: I = amber, Q = cyan, ink-navy panels.
   The algorithms (complex mixer, FIR low-pass, decimation, FFT
   filter bank) run for real on a synthesized wideband buffer.
   ============================================================ */

const C = {
  bg: "#0E1419", panel: "#141D25", panelHi: "#1A2530", edge: "#26343F",
  grid: "#22303A", gridFaint: "#18222B", ink: "#ECE7DB", sub: "#8B98A3",
  faint: "#5A6973", I: "#E8B85C", Q: "#56C7BF", sum: "#ECE7DB",
  s1: "#B49BE0", s2: "#E58AA6", s3: "#86D08A", pass: "#56C7BF",
};
const SIG = [C.s1, C.s2, C.s3];
const FONT = {
  disp: "'Space Grotesk', system-ui, -apple-system, sans-serif",
  body: "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif",
  mono: "'Space Mono', ui-monospace, SFMono-Regular, Menlo, monospace",
};
const FS = 24, NB = 1024, BAND = 12;

/* ---------- generic helpers ---------- */
const sgn = (x, d = 2) => (x >= 0 ? "+" : "\u2212") + Math.abs(x).toFixed(d);
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));

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
function fft(re, im) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1; for (; j & bit; bit >>= 1) j ^= bit; j ^= bit;
    if (i < j) { let tr = re[i]; re[i] = re[j]; re[j] = tr; let ti = im[i]; im[i] = im[j]; im[j] = ti; }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len, wr = Math.cos(ang), wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cwr = 1, cwi = 0;
      for (let k = 0; k < len >> 1; k++) {
        const a = i + k, b = a + (len >> 1);
        const vr = re[b] * cwr - im[b] * cwi, vi = re[b] * cwi + im[b] * cwr;
        re[b] = re[a] - vr; im[b] = im[a] - vi; re[a] += vr; im[a] += vi;
        const nwr = cwr * wr - cwi * wi; cwi = cwr * wi + cwi * wr; cwr = nwr;
      }
    }
  }
}

/* ---------- DSP pipeline ---------- */
function makeWide(sigs, noise, len = NB) {
  const I = new Float64Array(len), Q = new Float64Array(len);
  for (let n = 0; n < len; n++) {
    let a = 0, b = 0;
    for (const s of sigs) { if (!s.on) continue; const ph = (2 * Math.PI * s.off * n) / FS + s.ph0; a += s.amp * Math.cos(ph); b += s.amp * Math.sin(ph); }
    if (noise) { a += (Math.random() - 0.5) * 0.16; b += (Math.random() - 0.5) * 0.16; }
    I[n] = a; Q[n] = b;
  }
  return { I, Q };
}
function mixDown(I, Q, f0) {
  const oI = new Float64Array(I.length), oQ = new Float64Array(I.length);
  for (let n = 0; n < I.length; n++) {
    const m = (-2 * Math.PI * f0 * n) / FS, cr = Math.cos(m), ci = Math.sin(m);
    oI[n] = I[n] * cr - Q[n] * ci; oQ[n] = I[n] * ci + Q[n] * cr;
  }
  return { I: oI, Q: oQ };
}
function sincLP(L, fc) {
  const h = new Float64Array(L), M = (L - 1) / 2; let s = 0;
  for (let k = 0; k < L; k++) {
    const x = k - M;
    const sinc = x === 0 ? (2 * fc) / FS : Math.sin((2 * Math.PI * fc * x) / FS) / (Math.PI * x);
    const w = 0.54 - 0.46 * Math.cos((2 * Math.PI * k) / (L - 1));
    h[k] = sinc * w; s += h[k];
  }
  for (let k = 0; k < L; k++) h[k] /= s;
  return h;
}
function convolve(I, Q, h) {
  const L = h.length, oI = new Float64Array(I.length), oQ = new Float64Array(I.length);
  for (let n = 0; n < I.length; n++) {
    let a = 0, b = 0;
    for (let k = 0; k < L; k++) { const idx = n - k; if (idx < 0) break; a += h[k] * I[idx]; b += h[k] * Q[idx]; }
    oI[n] = a; oQ[n] = b;
  }
  return { I: oI, Q: oQ };
}
function HmagArray(h, freqs) {
  return freqs.map((f) => {
    let re = 0, im = 0;
    for (let k = 0; k < h.length; k++) { const a = (-2 * Math.PI * f * k) / FS; re += h[k] * Math.cos(a); im += h[k] * Math.sin(a); }
    return Math.hypot(re, im);
  });
}
// magnitude spectrum (windowed), shifted so index 0 = -fsEff/2; returns normalized 0..1
function magSpectrum(I, Q, win = true) {
  const n = I.length, re = new Float64Array(n), im = new Float64Array(n);
  for (let k = 0; k < n; k++) { const w = win ? 0.5 - 0.5 * Math.cos((2 * Math.PI * k) / (n - 1)) : 1; re[k] = I[k] * w; im[k] = Q[k] * w; }
  fft(re, im);
  const mag = new Float64Array(n); let mx = 1e-9;
  for (let k = 0; k < n; k++) { mag[k] = Math.hypot(re[k], im[k]); if (mag[k] > mx) mx = mag[k]; }
  const sh = new Float64Array(n);
  for (let i = 0; i < n; i++) sh[i] = mag[(i + n / 2) % n] / mx;
  return sh;
}

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
function Sig({ color, sig, set, label }) {
  return (
    <div style={{ borderTop: `1px solid ${C.gridFaint}`, paddingTop: 12, marginTop: 12 }}>
      <label style={{ display: "flex", alignItems: "center", gap: 9, marginBottom: sig.on ? 10 : 0, cursor: "pointer" }}>
        <input type="checkbox" checked={sig.on} onChange={(e) => set({ ...sig, on: e.target.checked })} style={{ color, width: 15, height: 15 }} />
        <span style={{ width: 9, height: 9, borderRadius: 9, background: color, opacity: sig.on ? 1 : 0.35 }} />
        <span style={{ fontFamily: FONT.mono, fontSize: 12.5, color: sig.on ? C.ink : C.faint }}>{label}</span>
      </label>
      {sig.on && (
        <div style={{ display: "grid", gap: 11, paddingLeft: 33 }}>
          <Slider label="Frequency offset" value={sig.off} min={-10} max={10} step={0.1} color={color} fmt={(v) => sgn(v, 1)} onChange={(off) => set({ ...sig, off })} />
          <Slider label="Amplitude" value={sig.amp} min={0.1} max={1} step={0.01} color={color} fmt={(v) => v.toFixed(2)} onChange={(amp) => set({ ...sig, amp })} />
        </div>
      )}
    </div>
  );
}
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
function TuneButtons({ sigs, onPick }) {
  return (
    <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 4 }}>
      {sigs.map((s, i) => s.on && (
        <button key={i} onClick={() => onPick(s.off)} className="iq-mini" style={{ borderColor: SIG[i] + "66", color: SIG[i] }}>
          tune to {i + 1} ({sgn(s.off, 1)})
        </button>
      ))}
    </div>
  );
}

/* spectrum drawing shared by several modules */
function drawSpectrum(ctx, w, h, spec, fsEff, opts = {}) {
  ctx.clearRect(0, 0, w, h);
  const padB = 22, padT = 8, plotH = h - padB - padT;
  const half = fsEff / 2;
  const fx = (f) => ((f + half) / fsEff) * w;
  // passband shading
  if (opts.passband != null) {
    ctx.fillStyle = "rgba(86,199,191,0.10)";
    ctx.fillRect(fx(-opts.passband), padT, fx(opts.passband) - fx(-opts.passband), plotH);
  }
  // ticks
  ctx.font = `10px ${FONT.mono}`; ctx.textAlign = "center";
  const ticks = opts.ticks || [-half, -half / 2, 0, half / 2, half];
  ticks.forEach((f) => {
    const xx = fx(f);
    ctx.strokeStyle = Math.abs(f) < 1e-6 ? C.edge : C.gridFaint; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(xx, padT); ctx.lineTo(xx, padT + plotH); ctx.stroke();
    ctx.fillStyle = Math.abs(f) < 1e-6 ? C.sub : C.faint;
    ctx.fillText(Math.abs(f) < 1e-6 ? "0" : (f % 1 === 0 ? sgn(f, 0) : sgn(f, 1)), xx, h - 7);
  });
  // filled spectrum
  const col = opts.color || C.Q;
  const rgb = opts.rgb || "86,199,191";
  const grad = ctx.createLinearGradient(0, padT, 0, padT + plotH);
  grad.addColorStop(0, `rgba(${rgb},0.8)`); grad.addColorStop(1, `rgba(${rgb},0.06)`);
  const n = spec.length;
  ctx.beginPath(); ctx.moveTo(0, padT + plotH);
  for (let i = 0; i < n; i++) ctx.lineTo((i / (n - 1)) * w, padT + plotH - spec[i] * plotH * 0.92);
  ctx.lineTo(w, padT + plotH); ctx.closePath(); ctx.fillStyle = grad; ctx.fill();
  ctx.strokeStyle = col; ctx.lineWidth = 1.3; ctx.beginPath();
  for (let i = 0; i < n; i++) { const xx = (i / (n - 1)) * w, yy = padT + plotH - spec[i] * plotH * 0.92; i ? ctx.lineTo(xx, yy) : ctx.moveTo(xx, yy); }
  ctx.stroke();
  // filter response overlay
  if (opts.Hf) {
    ctx.strokeStyle = C.I; ctx.lineWidth = 1.5; ctx.setLineDash([4, 3]); ctx.beginPath();
    opts.Hf.forEach((p, i) => { const xx = fx(p.f), yy = padT + plotH - p.m * plotH * 0.92; i ? ctx.lineTo(xx, yy) : ctx.moveTo(xx, yy); });
    ctx.stroke(); ctx.setLineDash([]);
  }
  return fx;
}

/* ============================================================
   MODULE 05 — TUNE (the complex mixer / NCO)
   ============================================================ */
function TuneModule({ reduced }) {
  const planeRef = useRef(null);
  const specRef = useRef(null);
  const [sigs, setSigs] = useState([
    { on: true, off: -7, amp: 0.8, ph0: 0.2 },
    { on: true, off: -1, amp: 0.5, ph0: 1.0 },
    { on: true, off: 4, amp: 0.7, ph0: 2.1 },
  ]);
  const [f0, setF0] = useState(4);
  const st = useRef({ sigs, f0 }); st.current = { sigs, f0 };
  const SPEED = 0.16;

  function drawPlane(el) {
    const cv = planeRef.current; if (!cv) return;
    const w = cv.clientWidth, h = cv.clientHeight;
    const ctx = cv._ctx || (cv._ctx = fitCanvas(cv, w, h));
    const { sigs, f0 } = st.current;
    ctx.clearRect(0, 0, w, h);
    const cx = w / 2, cy = h / 2, R = Math.min(w, h) * 0.34;
    ctx.strokeStyle = C.gridFaint; ctx.lineWidth = 1;
    for (let g = -1; g <= 1; g++) { ctx.beginPath(); ctx.moveTo(cx + g * R, 0); ctx.lineTo(cx + g * R, h); ctx.stroke(); ctx.beginPath(); ctx.moveTo(0, cy + g * R); ctx.lineTo(w, cy + g * R); ctx.stroke(); }
    ctx.strokeStyle = C.edge; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(0, cy); ctx.lineTo(w, cy); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(cx, 0); ctx.lineTo(cx, h); ctx.stroke();
    ctx.font = `10px ${FONT.mono}`; ctx.fillStyle = C.faint; ctx.textAlign = "center";
    ctx.fillText("DC (0 Hz)", cx, cy + 14);
    sigs.forEach((s, i) => {
      if (!s.on) return;
      const rate = s.off - f0; // residual after mixing
      const th = 2 * Math.PI * rate * el * SPEED + s.ph0;
      const locked = Math.abs(rate) < 0.06;
      const px = cx + Math.cos(th) * s.amp * R, py = cy - Math.sin(th) * s.amp * R;
      arrow(ctx, cx, cy, px, py, SIG[i] + (locked ? "" : "99"), locked ? 3 : 2, 8);
      ctx.fillStyle = SIG[i]; ctx.beginPath(); ctx.arc(px, py, locked ? 4.5 : 3, 0, 7); ctx.fill();
      if (locked) {
        ctx.strokeStyle = SIG[i]; ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(cx, cy, s.amp * R, 0, 7); ctx.stroke();
        ctx.fillStyle = SIG[i]; ctx.font = `11px ${FONT.mono}`; ctx.textAlign = "left";
        ctx.fillText("\u25C9 locked to centre", 10, 18);
      }
    });
  }
  function drawSpec() {
    const cv = specRef.current; if (!cv) return;
    const w = cv.clientWidth, h = cv.clientHeight;
    const ctx = cv._ctx || (cv._ctx = fitCanvas(cv, w, h));
    const { sigs, f0 } = st.current;
    const wide = makeWide(sigs, true);
    const mixed = mixDown(wide.I, wide.Q, f0);
    const spec = magSpectrum(mixed.I, mixed.Q);
    const fx = drawSpectrum(ctx, w, h, spec, FS, {});
    // marker at DC
    ctx.fillStyle = C.ink; ctx.font = `10px ${FONT.mono}`; ctx.textAlign = "center";
    ctx.fillText("\u25BC target here", fx(0), 18);
  }

  useRaf((el) => drawPlane(el), !reduced);
  useEffect(() => { drawSpec(); if (reduced) drawPlane(0.6); }, [sigs, f0, reduced]);

  const set = (i) => (s) => setSigs((p) => p.map((x, j) => (j === i ? s : x)));

  return (
    <div>
      <Lead
        notes={[
          { t: "Term", c: C.s1, x: "Mixing (heterodyning): multiplying by a spinning arrow. The NCO is software generating that arrow at a rate you pick; mixing by f\u2080 subtracts f\u2080 from every frequency present." },
          { t: "Intuition", c: C.Q, x: "It\u2019s tuning a dial, done in arithmetic after the fact. An old radio moved a physical oscillator; here you can re-tune the same recording to any station, as often as you like." },
          { t: "Term", c: C.s3, x: "Baseband: a signal shifted onto 0 Hz. Getting your target to baseband is the whole point of tuning \u2014 then a simple low-pass filter can isolate it." },
        ]}
        n="05" title="Step 1 — tune: spin the whole picture until your target stops"
        body="Extraction begins by re-centering. Multiply every sample by a counter-rotating arrow e^(−j2πf₀n) — a numerically controlled oscillator, or NCO. This slides the entire spectrum sideways by f₀. Pick f₀ equal to your target's offset and that signal lands exactly on 0 Hz: its arrow stops spinning. Everything else keeps turning, now ready to be filtered away." />
      <div className="iq-grid2">
        <div style={{ display: "grid", gap: 14 }}>
          <Panel label="Each signal as its own arrow — after tuning by f₀">
            <canvas ref={planeRef} style={{ width: "100%", height: 300, display: "block" }} />
            <p style={{ fontFamily: FONT.body, fontSize: 12.5, color: C.sub, margin: "10px 0 0", lineHeight: 1.5 }}>
              A frozen arrow sits at 0 Hz — that's your selected signal, centred. The faster an arrow still spins, the farther it is from centre.
            </p>
          </Panel>
          <Panel label="Spectrum slides by f₀ (the tuning amount)">
            <canvas ref={specRef} style={{ width: "100%", height: 150, display: "block" }} />
          </Panel>
        </div>
        <div style={{ display: "grid", gap: 14, alignContent: "start" }}>
          <Panel label="The oscillator (NCO)">
            <Slider label="Tuning frequency f₀" value={f0} min={-10} max={10} step={0.1} color={C.ink} fmt={(v) => sgn(v, 1)} onChange={setF0} />
            <TuneButtons sigs={sigs} onPick={setF0} />
            <p style={{ fontFamily: FONT.body, fontSize: 12.5, color: C.sub, margin: "12px 0 0", lineHeight: 1.55 }}>
              <span style={{ fontFamily: FONT.mono, color: C.ink }}>y[n] = x[n]·e^(−j2πf₀n/Fₛ)</span><br />
              This is the only step that moves frequencies. It's just a per-sample complex multiply — cheap, exact, reversible.
            </p>
          </Panel>
          <Panel label="Signals in the band">
            {sigs.map((s, i) => <Sig key={i} color={SIG[i]} sig={s} set={set(i)} label={`SIGNAL ${i + 1}`} />)}
          </Panel>
        </div>
      </div>
      <Deeper
        recap="Tuning is a single complex multiply per sample: y[n] = x[n]\u00b7e^(\u2212j2\u03c0f\u2080n/Fs). Multiplying by a unit-magnitude exponential rotates every sample by a steadily growing angle, which slides the entire spectrum sideways by f\u2080. Park your target at 0 Hz and it stops spinning while everything else keeps moving \u2014 the first move in extracting it. Nothing is lost; the operation is exact and reversible."
        example={`A tone at +3 Hz, sample rate Fs = 24, tune by f\u2080 = +3:
   multiplier step per sample = e^(\u2212j2\u03c0\u00b73/24) = e^(\u2212j45\u00b0)
   the +3 Hz tone  \u2192 lands at 0 Hz (stops rotating)
   neighbour at +7 \u2192 shifts to +7 \u2212 3 = +4 Hz
   neighbour at \u22122 \u2192 shifts to \u22122 \u2212 3 = \u22125 Hz

Everything slides left by 3 Hz together. Your target now sits
at DC, ready to be isolated by the low-pass filter next.`}
      />
    </div>
  );
}

/* ============================================================
   MODULE 06 — FILTER (the FIR low-pass)
   ============================================================ */
function FilterModule({ reduced }) {
  const beforeRef = useRef(null);
  const afterRef = useRef(null);
  const tapsRef = useRef(null);
  const [sigs] = useState([
    { on: true, off: 0, amp: 0.8, ph0: 0.2 },   // target already tuned to DC
    { on: true, off: -5, amp: 0.6, ph0: 1.0 },
    { on: true, off: 6.5, amp: 0.55, ph0: 2.1 },
  ]);
  const [fc, setFc] = useState(2.0);
  const [L, setL] = useState(65);

  function recompute() {
    const wide = makeWide(sigs, true);
    const h = sincLP(L, fc);
    const freqs = []; for (let i = 0; i < 256; i++) freqs.push(-BAND + (2 * BAND * i) / 255);
    const Hm = HmagArray(h, freqs);
    const Hf = freqs.map((f, i) => ({ f, m: Hm[i] }));
    const before = magSpectrum(wide.I, wide.Q);
    const filt = convolve(wide.I, wide.Q, h);
    const after = magSpectrum(filt.I, filt.Q);

    let ctx = beforeRef.current && (beforeRef.current._ctx || (beforeRef.current._ctx = fitCanvas(beforeRef.current, beforeRef.current.clientWidth, beforeRef.current.clientHeight)));
    if (ctx) drawSpectrum(ctx, beforeRef.current.clientWidth, beforeRef.current.clientHeight, before, FS, { Hf, passband: fc });
    ctx = afterRef.current && (afterRef.current._ctx || (afterRef.current._ctx = fitCanvas(afterRef.current, afterRef.current.clientWidth, afterRef.current.clientHeight)));
    if (ctx) drawSpectrum(ctx, afterRef.current.clientWidth, afterRef.current.clientHeight, after, FS, { passband: fc, rgb: "236,231,219", color: C.sum });
    drawTaps(h);
  }
  function drawTaps(h) {
    const cv = tapsRef.current; if (!cv) return;
    const w = cv.clientWidth, hh = cv.clientHeight;
    const ctx = cv._ctx || (cv._ctx = fitCanvas(cv, w, hh));
    ctx.clearRect(0, 0, w, hh);
    const mid = hh * 0.62, mx = Math.max(...h.map(Math.abs));
    ctx.strokeStyle = C.gridFaint; ctx.beginPath(); ctx.moveTo(0, mid); ctx.lineTo(w, mid); ctx.stroke();
    for (let k = 0; k < h.length; k++) {
      const xx = (k / (h.length - 1)) * w, yy = mid - (h[k] / mx) * mid * 0.8;
      ctx.strokeStyle = C.I; ctx.lineWidth = 1.4; ctx.beginPath(); ctx.moveTo(xx, mid); ctx.lineTo(xx, yy); ctx.stroke();
      ctx.fillStyle = C.I; ctx.beginPath(); ctx.arc(xx, yy, 1.4, 0, 7); ctx.fill();
    }
    ctx.fillStyle = C.faint; ctx.font = `10px ${FONT.mono}`; ctx.textAlign = "center";
    ctx.fillText(`${h.length} filter taps (the weighted moving average)`, w / 2, hh - 5);
  }
  useEffect(() => { recompute(); }, [fc, L]);

  return (
    <div>
      <Lead
        notes={[
          { t: "Term", c: C.s1, x: "FIR = finite impulse response. The taps are its weights; each output blends nearby input samples by those weights. More taps = a longer blend = a sharper wall, at the cost of more arithmetic per sample." },
          { t: "Intuition", c: C.Q, x: "A low-pass filter is a smart blur: it smooths fast wiggles (high frequencies) while leaving slow ones (your centred signal) intact. The sinc shape is just the blur with the cleanest cutoff." },
          { t: "Heads up", c: C.s2, x: "Inside the cutoff is the passband (kept), outside the stopband (rejected). No real filter is perfectly brick-walled \u2014 expect a transition slope and a little residual leakage." },
        ]}
        n="06" title="Step 2 — filter: keep the centre, throw away the rest"
        body="With your target sitting at 0 Hz, a low-pass filter passes a narrow band around the centre and rejects everything offset from it — the neighbours you don't want. The filter is an FIR: a list of weights (taps) slid along the signal, each output a weighted average of nearby samples. Designing those taps as a windowed sinc gives a clean flat passband and a steep wall. Wider cutoff lets more through; more taps make the wall sharper." />
      <div className="iq-grid2">
        <div style={{ display: "grid", gap: 14 }}>
          <Panel label="Before — tuned, still crowded · dashed amber = filter shape">
            <canvas ref={beforeRef} style={{ width: "100%", height: 150, display: "block" }} />
          </Panel>
          <Panel label="After — only the passband survives">
            <canvas ref={afterRef} style={{ width: "100%", height: 150, display: "block" }} />
            <p style={{ fontFamily: FONT.body, fontSize: 12.5, color: C.sub, margin: "10px 0 0", lineHeight: 1.5 }}>
              The shaded band is what the filter keeps. Signals outside it are crushed toward the noise floor — that's the unwanted neighbours being removed.
            </p>
          </Panel>
          <Panel label="The filter itself">
            <canvas ref={tapsRef} style={{ width: "100%", height: 110, display: "block" }} />
          </Panel>
        </div>
        <div style={{ display: "grid", gap: 14, alignContent: "start" }}>
          <Panel label="Filter design">
            <div style={{ display: "grid", gap: 16 }}>
              <Slider label="Cutoff (passband half-width)" value={fc} min={0.5} max={8} step={0.1} color={C.Q} fmt={(v) => sgn(v, 1)} onChange={setFc} />
              <Slider label="Number of taps (length)" value={L} min={9} max={161} step={2} color={C.I} fmt={(v) => v.toFixed(0)} onChange={(v) => setL(Math.round((v - 1) / 2) * 2 + 1)} />
            </div>
            <p style={{ fontFamily: FONT.body, fontSize: 12.5, color: C.sub, margin: "14px 0 0", lineHeight: 1.55 }}>
              <span style={{ fontFamily: FONT.mono, color: C.ink }}>out[n] = Σ h[k]·in[n−k]</span><br />
              Try shrinking the cutoff until only one peak remains, then drop the tap count and watch the wall sag — that sag is leakage from neighbouring signals. The cost of a sharper wall is more taps, i.e. more arithmetic per sample.
            </p>
          </Panel>
          <Panel label="What just happened">
            <p style={{ fontFamily: FONT.body, fontSize: 12.5, color: C.sub, lineHeight: 1.6, margin: 0 }}>
              Tuning moved your signal to the middle; filtering deleted its neighbours. What remains is one signal sitting at baseband — but still sampled at the full wideband rate, which is wasteful. That's what the next step fixes.
            </p>
          </Panel>
        </div>
      </div>
      <Deeper
        recap="A low-pass FIR filter replaces each output sample with a weighted blend of nearby inputs; the weights (taps) are a windowed sinc, the shape with the cleanest cutoff. Slow variations \u2014 your now-centred signal \u2014 pass through, while fast ones (the neighbours you shifted away) are smoothed out. More taps mean a longer blend and a sharper wall, at the cost of more multiply-adds per sample."
        example={`Cutoff fc = 2 Hz, sample rate Fs = 24. The ideal low-pass
tap shape is a sinc, h[k] = 2(fc/Fs)\u00b7sinc(2(fc/Fs)\u00b7k), windowed.

Effect on tones (gain):
   signal centred at 0 Hz (inside fc)  \u2192 passes,   gain \u2248 1
   neighbour now at +4 Hz (outside fc) \u2192 rejected, gain \u2248 0

21 taps gives a gentle wall; 81 taps a steep one. No real
filter is a perfect brick wall \u2014 expect a transition slope
and a little stopband leakage.`}
      />
    </div>
  );
}

/* ============================================================
   MODULE 07 — DECIMATE (the full digital downconverter)
   ============================================================ */
function DecimateModule({ reduced }) {
  const outSpecRef = useRef(null);
  const outTimeRef = useRef(null);
  const phasorRef = useRef(null);
  const [sigs, setSigs] = useState([
    { on: true, off: 3, amp: 0.85, ph0: 0.4 },
    { on: true, off: -6, amp: 0.6, ph0: 1.0 },
    { on: true, off: 8, amp: 0.5, ph0: 2.1 },
  ]);
  const [f0, setF0] = useState(3);
  const [fc, setFc] = useState(1.5);
  const [M, setM] = useState(4);
  const residual = (() => { const t = sigs[0]; return t.off - f0; })();
  const st = useRef({ residual: 0, amp: 0.85 });

  function recompute() {
    const wide = makeWide(sigs, true);
    const mixed = mixDown(wide.I, wide.Q, f0);
    const h = sincLP(81, fc);
    const filt = convolve(mixed.I, mixed.Q, h);
    const len = NB / M;
    const dI = new Float64Array(len), dQ = new Float64Array(len);
    for (let i = 0; i < len; i++) { dI[i] = filt.I[i * M]; dQ[i] = filt.Q[i * M]; }
    const fsEff = FS / M;
    const spec = magSpectrum(dI, dQ);
    let ctx = outSpecRef.current && (outSpecRef.current._ctx || (outSpecRef.current._ctx = fitCanvas(outSpecRef.current, outSpecRef.current.clientWidth, outSpecRef.current.clientHeight)));
    if (ctx) {
      const fx = drawSpectrum(ctx, outSpecRef.current.clientWidth, outSpecRef.current.clientHeight, spec, fsEff, { rgb: "236,231,219", color: C.sum });
      ctx.fillStyle = C.faint; ctx.font = `10px ${FONT.mono}`; ctx.textAlign = "right";
      ctx.fillText(`new rate ${fsEff.toFixed(1)} MS/s`, outSpecRef.current.clientWidth - 4, 16);
    }
    // time domain
    ctx = outTimeRef.current && (outTimeRef.current._ctx || (outTimeRef.current._ctx = fitCanvas(outTimeRef.current, outTimeRef.current.clientWidth, outTimeRef.current.clientHeight)));
    if (ctx) {
      const w = outTimeRef.current.clientWidth, hh = outTimeRef.current.clientHeight, mid = hh / 2;
      const npts = Math.min(120, len), A = hh * 0.36, amp = Math.max(...dI.slice(10, 10 + npts).map(Math.abs)) || 1;
      ctx.clearRect(0, 0, w, hh);
      ctx.strokeStyle = C.gridFaint; ctx.beginPath(); ctx.moveTo(0, mid); ctx.lineTo(w, mid); ctx.stroke();
      const plot = (arr, color) => { ctx.strokeStyle = color; ctx.lineWidth = 1.8; ctx.beginPath(); for (let i = 0; i < npts; i++) { const xx = (i / (npts - 1)) * w, yy = mid - (arr[i + 10] / amp) * A; i ? ctx.lineTo(xx, yy) : ctx.moveTo(xx, yy); } ctx.stroke(); };
      plot(dI, C.I); plot(dQ, C.Q);
    }
    st.current = { residual, amp: sigs[0].on ? sigs[0].amp : 0 };
  }
  function drawPhasor(el) {
    const cv = phasorRef.current; if (!cv) return;
    const w = cv.clientWidth, h = cv.clientHeight;
    const ctx = cv._ctx || (cv._ctx = fitCanvas(cv, w, h));
    ctx.clearRect(0, 0, w, h);
    const cx = w / 2, cy = h / 2, R = Math.min(w, h) * 0.36;
    ctx.strokeStyle = C.edge; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(0, cy); ctx.lineTo(w, cy); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(cx, 0); ctx.lineTo(cx, h); ctx.stroke();
    ctx.strokeStyle = C.grid; ctx.beginPath(); ctx.arc(cx, cy, R, 0, 7); ctx.stroke();
    const { residual, amp } = st.current;
    const th = 2 * Math.PI * residual * el * 0.2;
    const px = cx + Math.cos(th) * amp * R, py = cy - Math.sin(th) * amp * R;
    arrow(ctx, cx, cy, px, py, C.sum, 2.5, 9);
    ctx.fillStyle = C.sum; ctx.beginPath(); ctx.arc(px, py, 4, 0, 7); ctx.fill();
  }

  useRaf((el) => drawPhasor(el), !reduced);
  useEffect(() => { recompute(); if (reduced) drawPhasor(0.5); }, [sigs, f0, fc, M, reduced]);

  const nyq = FS / (2 * M);
  const aliased = Math.abs(residual) > nyq;
  const set = (i) => (s) => setSigs((p) => p.map((x, j) => (j === i ? s : x)));

  return (
    <div>
      <Lead
        notes={[
          { t: "Term", c: C.s1, x: "Decimate-by-M keeps every Mth sample, lowering the rate to Fs/M; the new usable width is \u00B1Fs/2M (the Nyquist limit). Anything outside folds back in \u2014 which is exactly why you filter first." },
          { t: "Intuition", c: C.Q, x: "Don\u2019t pay for bandwidth you threw away. After filtering, your signal fills a sliver of the band but you\u2019re still sampling for the whole thing; decimation right-sizes the data \u2014 often a 100\u00D7 saving." },
          { t: "Try it", c: C.I, x: "Set M to \u00F78 with the cutoff wide and watch a neighbour fold into your channel (the alias warning fires). Narrow the cutoff first and the fold disappears: filter, then decimate \u2014 always that order." },
        ]}
        n="07" title="Step 3 — decimate: drop the now-pointless sample rate"
        body="After filtering, all the high frequencies are gone, so most of the samples are redundant. Keep every Mth one and throw the rest away — the sample rate falls by M and the data shrinks to match the narrow signal you kept. Tune, filter, decimate: chained together, these three are a digital downconverter (DDC), the standard machine for pulling one channel out of a wideband capture." />
      <Panel label="The pipeline" style={{ marginBottom: 18 }}>
        <div className="iq-pipe">
          <PipeBox top="wideband IQ" bot={`${FS} MS/s`} color={C.sub} />
          <PipeOp sym="\u2297" label="NCO" sub={`f₀ = ${sgn(f0, 1)}`} />
          <PipeBox top="centred" bot={`${FS} MS/s`} color={C.sub} />
          <PipeOp sym="LPF" label="FIR" sub={`fc = ${sgn(fc, 1)}`} />
          <PipeBox top="narrowband" bot={`${FS} MS/s`} color={C.sub} />
          <PipeOp sym={`\u2193${M}`} label="decimate" sub={`÷${M}`} />
          <PipeBox top="channel out" bot={`${(FS / M).toFixed(1)} MS/s`} color={C.ink} strong />
        </div>
      </Panel>
      <div className="iq-grid2">
        <div style={{ display: "grid", gap: 14 }}>
          <Panel label="Extracted channel — spectrum at the new low rate">
            <canvas ref={outSpecRef} style={{ width: "100%", height: 150, display: "block" }} />
            {aliased && (
              <p style={{ fontFamily: FONT.mono, fontSize: 11.5, color: C.s2, margin: "8px 0 0" }}>
                ⚠ residual {sgn(residual, 1)} exceeds new edge ±{nyq.toFixed(1)} — the signal aliases. Tune closer, widen M's filter, or decimate less.
              </p>
            )}
          </Panel>
          <Panel label="Extracted channel — the recovered samples">
            <canvas ref={outTimeRef} style={{ width: "100%", height: 110, display: "block" }} />
            <p style={{ fontFamily: FONT.body, fontSize: 12.5, color: C.sub, margin: "10px 0 0", lineHeight: 1.5 }}>
              One clean signal at a manageable rate — ready to demodulate. Everything else is gone.
            </p>
          </Panel>
        </div>
        <div style={{ display: "grid", gap: 14, alignContent: "start" }}>
          <Panel label="Recovered signal, live">
            <canvas ref={phasorRef} style={{ width: "100%", height: 150, display: "block" }} />
            <p style={{ fontFamily: FONT.body, fontSize: 12, color: C.sub, margin: "8px 0 0", lineHeight: 1.5 }}>
              Tuned perfectly → frozen at DC. Slightly off → a slow residual spin of {sgn(residual, 1)}.
            </p>
          </Panel>
          <Panel label="Controls">
            <div style={{ display: "grid", gap: 14 }}>
              <Slider label="Tune f₀" value={f0} min={-10} max={10} step={0.1} color={C.ink} fmt={(v) => sgn(v, 1)} onChange={setF0} />
              <Slider label="Filter cutoff fc" value={fc} min={0.5} max={5} step={0.1} color={C.Q} fmt={(v) => sgn(v, 1)} onChange={setFc} />
              <div>
                <div style={{ fontSize: 13, color: C.sub, fontFamily: FONT.body, marginBottom: 6 }}>Decimation factor M</div>
                <div style={{ display: "flex", gap: 6 }}>
                  {[1, 2, 4, 8].map((m) => (
                    <button key={m} onClick={() => setM(m)} className="iq-mini" data-on={M === m ? "1" : "0"}>÷{m}</button>
                  ))}
                </div>
              </div>
              <TuneButtons sigs={sigs} onPick={setF0} />
            </div>
          </Panel>
          <Panel label="Signals">
            {sigs.map((s, i) => <Sig key={i} color={SIG[i]} sig={s} set={set(i)} label={`SIGNAL ${i + 1}`} />)}
          </Panel>
        </div>
      </div>
      <Deeper
        recap="After tuning and filtering, your signal occupies only a sliver of the wideband stream, yet you're still storing samples at the full rate \u2014 mostly empty bandwidth. Decimating by M keeps every Mth sample, dropping the rate to Fs/M. As long as the filter already removed everything beyond \u00b1Fs/2M, nothing useful aliases, and you've turned a wideband capture into a compact baseband recording of one channel."
        example={`Wideband Fs = 24, your filtered channel is 3 Hz wide.
Decimate by M = 4 \u2192 new rate Fs/M = 6 (new window \u22123 \u2026 +3).

Safety check: the filter must kill everything beyond \u00b1Fs/2M
= \u00b13 Hz BEFORE downsampling. If a leftover tone at +5 Hz
survived, after \u00f74 it folds to 5 \u2212 6 = \u22121 Hz \u2014 an alias
landing right on your signal.

Done right, 24 \u2192 6 is a 4\u00d7 smaller stream carrying the same
information. Tune \u2192 filter \u2192 decimate = a digital downconverter.`}
      />
    </div>
  );
}
function PipeBox({ top, bot, color, strong }) {
  return (
    <div style={{ border: `1px solid ${strong ? C.Q : C.edge}`, borderRadius: 7, padding: "8px 10px", textAlign: "center", background: strong ? C.panelHi : "transparent", minWidth: 78 }}>
      <div style={{ fontFamily: FONT.body, fontSize: 11.5, color, whiteSpace: "nowrap" }}>{top}</div>
      <div style={{ fontFamily: FONT.mono, fontSize: 11, color: strong ? C.Q : C.faint, marginTop: 2 }}>{bot}</div>
    </div>
  );
}
function PipeOp({ sym, label, sub }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 1, padding: "0 2px" }}>
      <span style={{ fontFamily: FONT.mono, fontSize: 17, color: C.I, lineHeight: 1 }}>{sym}</span>
      <span style={{ fontFamily: FONT.mono, fontSize: 9.5, color: C.sub, textTransform: "uppercase", letterSpacing: "0.08em" }}>{label}</span>
      <span style={{ fontFamily: FONT.mono, fontSize: 9.5, color: C.faint }}>{sub}</span>
    </div>
  );
}

/* ============================================================
   MODULE 08 — FILTER BANK (extract every channel at once)
   ============================================================ */
function FilterBankModule() {
  const barsRef = useRef(null);
  const [sigs, setSigs] = useState([
    { on: true, off: -7.5, amp: 0.8, ph0: 0.2 },
    { on: true, off: 0.5, amp: 0.6, ph0: 1.0 },
    { on: true, off: 5, amp: 0.7, ph0: 2.1 },
  ]);
  const [K, setK] = useState(12);
  const [win, setWin] = useState(false);

  function recompute() {
    const wide = makeWide(sigs, true);
    const spec = magSpectrum(wide.I, wide.Q, win); // fine FFT, rect or Hann
    // fold fine bins into K channels
    const n = spec.length, chW = FS / K;
    const energy = new Float64Array(K);
    for (let i = 0; i < n; i++) {
      const f = (i / (n - 1)) * FS - BAND;
      const c = clamp(Math.floor((f + BAND) / chW), 0, K - 1);
      energy[c] += spec[i] * spec[i];
    }
    let mx = 1e-9; for (let c = 0; c < K; c++) { energy[c] = Math.sqrt(energy[c]); if (energy[c] > mx) mx = energy[c]; }
    for (let c = 0; c < K; c++) energy[c] /= mx;
    // which signal dominates each channel
    const chColor = new Array(K).fill(null);
    sigs.forEach((s, i) => { if (!s.on) return; const c = clamp(Math.floor((s.off + BAND) / chW), 0, K - 1); chColor[c] = SIG[i]; });

    const cv = barsRef.current; if (!cv) return;
    const w = cv.clientWidth, h = cv.clientHeight;
    const ctx = cv._ctx || (cv._ctx = fitCanvas(cv, w, h));
    ctx.clearRect(0, 0, w, h);
    const padB = 26, padT = 10, plotH = h - padB - padT, bw = w / K;
    for (let c = 0; c < K; c++) {
      const x = c * bw, bh = energy[c] * plotH * 0.95;
      const col = chColor[c] || C.faint;
      ctx.fillStyle = (chColor[c] || "#3a4a55") + "33";
      ctx.fillRect(x + 1, padT, bw - 2, plotH);
      ctx.fillStyle = col;
      ctx.fillRect(x + 1, padT + plotH - bh, bw - 2, bh);
      ctx.strokeStyle = C.gridFaint; ctx.lineWidth = 1; ctx.strokeRect(x + 1, padT, bw - 2, plotH);
    }
    // center line + freq labels
    ctx.font = `10px ${FONT.mono}`; ctx.textAlign = "center"; ctx.fillStyle = C.faint;
    for (let c = 0; c <= K; c += Math.ceil(K / 6)) { const f = -BAND + c * chW; ctx.fillText(sgn(f, 0), c * bw, h - 8); }
    ctx.fillStyle = C.sub; ctx.fillText("channel index → frequency", w / 2, h - 8 - 0);
  }
  useEffect(() => { recompute(); }, [sigs, K, win]);

  const set = (i) => (s) => setSigs((p) => p.map((x, j) => (j === i ? s : x)));

  return (
    <div>
      <Lead
        notes={[
          { t: "Term", c: C.s1, x: "Bin: one FFT output, a narrow frequency slot. N bins evenly tile the band and each behaves like a pre-tuned, pre-decimated channel \u2014 you get them all from a single transform." },
          { t: "Intuition", c: C.Q, x: "Rather than run the downconverter once per signal, the FFT hands you the entire band pre-sliced into channels at once. That parallel efficiency is why FFTs are everywhere in receivers." },
          { t: "Heads up", c: C.s2, x: "A frequency between bins spills into its neighbours \u2014 spectral leakage. Tapering the sample edges (a window) softens the spill; a polyphase filter bank replaces that taper with a real filter for textbook-clean channels." },
        ]}
        n="08" title="The shortcut — split the whole band into channels at once"
        body="Tuning one signal at a time is fine for one signal. To watch the entire band, run an FFT: it already divides the spectrum into N equally-spaced bins, and each bin behaves like its own tuned-and-decimated channel. A signal drops into whichever channel contains its frequency. The catch is leakage — a signal between bins bleeds into neighbours. A polyphase filter bank fixes that by putting a proper FIR in front of the FFT, and it's how wideband receivers crack a band into hundreds of channels efficiently." />
      <div className="iq-grid2">
        <div style={{ display: "grid", gap: 14 }}>
          <Panel label={`The band split into ${K} channels — bar height = energy in that channel`}>
            <canvas ref={barsRef} style={{ width: "100%", height: 220, display: "block" }} />
            <p style={{ fontFamily: FONT.body, fontSize: 12.5, color: C.sub, margin: "10px 0 0", lineHeight: 1.5 }}>
              Each coloured channel holds one signal. Slide a signal onto a boundary and its energy splits across two channels — that's leakage. Every channel here is, in effect, the output of its own downconverter running in parallel.
            </p>
          </Panel>
        </div>
        <div style={{ display: "grid", gap: 14, alignContent: "start" }}>
          <Panel label="Channelizer">
            <div>
              <div style={{ fontSize: 13, color: C.sub, fontFamily: FONT.body, marginBottom: 6 }}>Number of channels (FFT size)</div>
              <div style={{ display: "flex", gap: 6 }}>
                {[8, 12, 16, 24].map((k) => <button key={k} onClick={() => setK(k)} className="iq-mini" data-on={K === k ? "1" : "0"}>{k}</button>)}
              </div>
            </div>
            <label style={{ display: "flex", alignItems: "center", gap: 9, marginTop: 16, cursor: "pointer", color: C.Q }}>
              <input type="checkbox" checked={win} onChange={(e) => setWin(e.target.checked)} style={{ color: C.Q, width: 15, height: 15 }} />
              <span style={{ fontFamily: FONT.body, fontSize: 13, color: C.sub }}>apply a window before the FFT</span>
            </label>
            <p style={{ fontFamily: FONT.body, fontSize: 12.5, color: C.sub, margin: "12px 0 0", lineHeight: 1.55 }}>
              Toggle the window and watch the leakage skirts shrink — the bars get cleaner because energy stops spilling sideways. That windowing, generalised, is the front end of a <span style={{ color: C.ink }}>polyphase filter bank</span>.
            </p>
          </Panel>
          <Panel label="Signals">
            {sigs.map((s, i) => <Sig key={i} color={SIG[i]} sig={s} set={set(i)} label={`SIGNAL ${i + 1}`} />)}
          </Panel>
          <Panel label="Tie-back to the waterfall">
            <p style={{ fontFamily: FONT.body, fontSize: 12.5, color: C.sub, lineHeight: 1.6, margin: 0 }}>
              Run this FFT repeatedly over time and stack the rows — that's the waterfall from Part 1. Each vertical stripe is one channel's output evolving, i.e. many extracted signals at once.
            </p>
          </Panel>
        </div>
      </div>
      <Deeper
        recap="Tuning-filtering-decimating extracts one channel. A single FFT does it for all of them at once: split a block of N samples into N frequency bins, and each bin behaves like one narrow channel already shifted to baseband and downsampled. It's the same channelization, shared across the whole band \u2014 which is why receivers that watch many signals at once use an FFT, and its efficient cousin the polyphase filter bank."
        example={`A 1024-point FFT on a 24 Hz-wide capture splits it into 1024
bins, each (24/1024) \u2248 0.023 Hz wide \u2014 1024 ready-made channels.
   bin k \u2194 frequency  k\u00b7Fs/N   (wrapping past Fs/2 to negative)

Windowing first (e.g. Hann) keeps each bin\u2019s energy from
leaking into its neighbours \u2014 the skirts shrink. Run the FFT
block after block, stack the rows, and you\u2019ve rebuilt the
waterfall: every channel\u2019s output over time, all at once.`}
      />
    </div>
  );
}

/* ============================================================
   APP SHELL
   ============================================================ */
const MODULES = [
  { id: "05", label: "Tune", comp: TuneModule },
  { id: "06", label: "Filter", comp: FilterModule },
  { id: "07", label: "Decimate", comp: DecimateModule },
  { id: "08", label: "Filter bank", comp: FilterBankModule },
];

export default function App() {
  const reduced = usePrefersReducedMotion();
  const [active, setActive] = useState(0);
  const Comp = MODULES[active].comp;
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
        .iq-mini { font-family:${FONT.mono}; font-size:11px; padding:5px 9px; border-radius:6px; border:1px solid ${C.edge}; background:transparent; color:${C.sub}; cursor:pointer; transition:background .15s; }
        .iq-mini:hover { background:${C.panelHi}; color:${C.ink}; }
        .iq-mini[data-on="1"]{ background:${C.panelHi}; border-color:${C.Q}; color:${C.Q}; }
        .iq-pipe { display:flex; align-items:center; gap:6px; flex-wrap:wrap; justify-content:center; }
        canvas { background:${C.bg}; border-radius:4px; }
      `}</style>
      <div className="iq-wrap">
        <header style={{ marginBottom: 26 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
            <span style={{ width: 11, height: 11, borderRadius: 11, background: C.I }} />
            <span style={{ width: 11, height: 11, borderRadius: 11, background: C.Q }} />
            <Eyebrow>I/Q signal primer · part 2</Eyebrow>
          </div>
          <h1 style={{ fontFamily: FONT.disp, fontSize: 34, fontWeight: 700, margin: "0 0 8px", letterSpacing: "-0.02em", lineHeight: 1.05 }}>
            Pulling one signal out of the mix
          </h1>
          <p style={{ fontFamily: FONT.body, fontSize: 15, color: C.sub, maxWidth: 680, lineHeight: 1.6, margin: 0 }}>
            Part 1 showed that every signal is buried in one stream of I/Q pairs. Here's how the buried signals come back out — tune, filter, decimate, or split the whole band at once. Every plot below is the real algorithm running on a synthesized capture.
          </p>
          {reduced && <p style={{ fontFamily: FONT.mono, fontSize: 11, color: C.faint, marginTop: 10 }}>Reduced-motion on — views are static but respond to controls.</p>}
          <nav style={{ display: "flex", gap: 6, marginTop: 22, flexWrap: "wrap", borderBottom: `1px solid ${C.edge}`, paddingBottom: 16 }}>
            {MODULES.map((m, i) => (
              <button key={m.id} className="iq-tab" data-on={active === i ? "1" : "0"} onClick={() => setActive(i)}>
                <span style={{ color: active === i ? C.Q : C.faint, marginRight: 7 }}>{m.id}</span>{m.label}
              </button>
            ))}
          </nav>
        </header>
        <main key={active}><Comp reduced={reduced} /></main>
        <footer style={{ marginTop: 40, paddingTop: 18, borderTop: `1px solid ${C.gridFaint}`, fontFamily: FONT.body, fontSize: 12, color: C.faint, lineHeight: 1.6 }}>
          Tune → filter → decimate is a digital downconverter; doing it for every channel at once is a filter bank. Both reduce to the same three ideas: shift in frequency, reject what's offset, and resample to fit.
        </footer>
      </div>
    </div>
  );
}
