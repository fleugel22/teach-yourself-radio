import { useState, useRef, useEffect } from "react";

/* ============================================================
   I/Q PRIMER · MODULATION  (sits between Part 1 and Part 2)
   Introduces how information rides on a carrier — analog
   (AM/FM/PM) and digital (ASK/FSK/PSK/QAM) — the constellation
   diagram, and how symbols, bits, baud and bitrate relate.
   This is where QPSK and the constellation are first defined.
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
function fitCanvas(canvas, w, h) {
  const r = window.devicePixelRatio || 1;
  canvas.width = Math.round(w * r); canvas.height = Math.round(h * r);
  canvas.style.width = w + "px"; canvas.style.height = h + "px";
  const ctx = canvas.getContext("2d"); ctx.setTransform(r, 0, 0, r, 0, 0);
  return ctx;
}
function arrow(ctx, x0, y0, x1, y1, color, width = 2, head = 6) {
  const a = Math.atan2(y1 - y0, x1 - x0), len = Math.hypot(x1 - x0, y1 - y0);
  if (len < 0.5) return;
  ctx.strokeStyle = color; ctx.fillStyle = color; ctx.lineWidth = width; ctx.lineCap = "round";
  ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke();
  if (len > head + 2) { ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x1 - head * Math.cos(a - 0.4), y1 - head * Math.sin(a - 0.4)); ctx.lineTo(x1 - head * Math.cos(a + 0.4), y1 - head * Math.sin(a + 0.4)); ctx.closePath(); ctx.fill(); }
}
let _seed = 1234567;
const rand = () => { _seed = (_seed * 1103515245 + 12345) & 0x7fffffff; return _seed / 0x7fffffff; };
const randn = () => { let u = 0, v = 0; while (u === 0) u = rand(); while (v === 0) v = rand(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };

/* ---------- FFT (radix-2) ---------- */
function fft(re, im) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) { let bit = n >> 1; for (; j & bit; bit >>= 1) j ^= bit; j ^= bit; if (i < j) { const tr = re[i]; re[i] = re[j]; re[j] = tr; const ti = im[i]; im[i] = im[j]; im[j] = ti; } }
  for (let len = 2; len <= n; len <<= 1) { const ang = -2 * Math.PI / len, wr = Math.cos(ang), wi = Math.sin(ang); for (let i = 0; i < n; i += len) { let cr = 1, ci = 0; for (let k = 0; k < len / 2; k++) { const ur = re[i + k], ui = im[i + k]; const vr = re[i + k + len / 2] * cr - im[i + k + len / 2] * ci, vi = re[i + k + len / 2] * ci + im[i + k + len / 2] * cr; re[i + k] = ur + vr; im[i + k] = ui + vi; re[i + k + len / 2] = ur - vr; im[i + k + len / 2] = ui - vi; const ncr = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = ncr; } } }
}
function magSpec(sig) { const N = sig.length, re = sig.slice(), im = new Array(N).fill(0); fft(re, im); const m = []; for (let i = 0; i < N; i++) m.push(Math.hypot(re[i], im[i]) / N); return m; }

/* ---------- constellations & Gray coding ---------- */
const gray = (x) => x ^ (x >> 1);
const tobits = (v, w) => v.toString(2).padStart(w, "0");
function pskPts(M) {
  const b = Math.log2(M), pts = [];
  for (let i = 0; i < M; i++) { const ang = (M === 4 ? Math.PI / 4 : 0) + (2 * Math.PI * i) / M; pts.push({ I: Math.cos(ang), Q: Math.sin(ang), label: tobits(gray(i), b) }); }
  return pts;
}
function qamPts(L) {
  const b = Math.log2(L), amp = [...Array(L)].map((_, i) => 2 * i - (L - 1)), pts = [];
  for (let qi = 0; qi < L; qi++) for (let ii = 0; ii < L; ii++) pts.push({ I: amp[ii], Q: amp[qi], label: tobits(gray(ii), b) + tobits(gray(qi), b) });
  return pts;
}
function normPow(pts) { let p = 0; pts.forEach((s) => (p += s.I * s.I + s.Q * s.Q)); const g = Math.sqrt(pts.length / p); return pts.map((s) => ({ ...s, I: s.I * g, Q: s.Q * g })); }
function minDist(pts) { let m = 1e9; for (let i = 0; i < pts.length; i++) for (let j = i + 1; j < pts.length; j++) { const d = Math.hypot(pts[i].I - pts[j].I, pts[i].Q - pts[j].Q); if (d < m) m = d; } return m; }
const SCHEMES = { 2: ["BPSK", pskPts(2)], 4: ["QPSK", pskPts(4)], 8: ["8PSK", pskPts(8)], 16: ["16QAM", qamPts(4)], 64: ["64QAM", qamPts(8)], 256: ["256QAM", qamPts(16)] };
function modTone(kind, fmHz, amt, ms = 1900) {
  try {
    const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return;
    const ctx = new AC(), car = ctx.createOscillator(), lfo = ctx.createOscillator(), lg = ctx.createGain(), amp = ctx.createGain(), master = ctx.createGain();
    const t = ctx.currentTime, end = t + ms / 1000;
    car.type = "sine"; car.frequency.value = 440; lfo.type = "sine"; lfo.frequency.value = fmHz; lfo.connect(lg);
    if (kind === "AM") { amp.gain.value = 0.16; lg.gain.value = 0.15 * amt; lg.connect(amp.gain); }
    else { amp.gain.value = 0.16; lg.gain.value = 180 * Math.max(0.4, amt); lg.connect(car.frequency); }
    car.connect(amp); amp.connect(master); master.connect(ctx.destination);
    master.gain.setValueAtTime(0, t); master.gain.linearRampToValueAtTime(1, t + 0.03); master.gain.setValueAtTime(1, end - 0.07); master.gain.linearRampToValueAtTime(0, end);
    car.start(t); lfo.start(t); car.stop(end + 0.05); lfo.stop(end + 0.05); car.onended = () => ctx.close();
  } catch (e) {}
}
function constel(M) { return normPow(SCHEMES[M][1].map((s) => ({ ...s }))); }

/* ---------- UI atoms ---------- */
function Eyebrow({ children }) { return <div style={{ fontFamily: FONT.mono, fontSize: 11, letterSpacing: "0.18em", textTransform: "uppercase", color: C.faint }}>{children}</div>; }
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
function Pills({ value, options, onChange, color = C.Q, labels }) {
  return (
    <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
      {options.map((o, i) => (
        <button key={o} onClick={() => onChange(o)} className="iq-mini" data-on={value === o ? "1" : "0"} style={value === o ? { borderColor: color, color } : undefined}>{labels ? labels[i] : o}</button>
      ))}
    </div>
  );
}
function Readout({ rows }) {
  return (
    <div style={{ display: "grid", gap: 8 }}>
      {rows.map(([l, v, c], i) => (
        <div key={i} style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", borderBottom: `1px solid ${C.gridFaint}`, paddingBottom: 6 }}>
          <span style={{ fontFamily: FONT.body, fontSize: 12, color: C.sub }}>{l}</span>
          <span style={{ fontFamily: FONT.mono, fontSize: 14, color: c || C.ink }}>{v}</span>
        </div>
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
function Deeper({ recap, example }) {
  const [open, setOpen] = useState(false);
  return (
    <div style={{ marginTop: 18 }}>
      <button onClick={() => setOpen(!open)} style={{ fontFamily: FONT.mono, fontSize: 11.5, padding: "7px 13px", borderRadius: 6, border: `1px solid ${open ? C.Q : C.edge}`, background: open ? C.panelHi : "transparent", color: open ? C.Q : C.sub, cursor: "pointer" }}>
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
function drawWave(ctx, w, h, series, opts = {}) {
  ctx.clearRect(0, 0, w, h);
  const mid = h / 2, amp = (h / 2) * 0.86, n = series[0].data.length;
  ctx.strokeStyle = C.gridFaint; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(0, mid); ctx.lineTo(w, mid); ctx.stroke();
  if (opts.bounds) for (let b = 0; b < opts.bounds.length; b++) { const x = (opts.bounds[b] / n) * w; ctx.strokeStyle = C.gridFaint; ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke(); }
  series.forEach((s) => {
    ctx.strokeStyle = s.color; ctx.lineWidth = s.w || 1.6; ctx.globalAlpha = s.alpha == null ? 1 : s.alpha; ctx.beginPath();
    for (let i = 0; i < s.data.length; i++) { const x = (i / (n - 1)) * w, y = mid - s.data[i] * amp / (opts.scale || 1); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); }
    ctx.stroke(); ctx.globalAlpha = 1;
  });
}
function drawConstellation(ctx, w, h, pts, opts = {}) {
  ctx.clearRect(0, 0, w, h);
  const cx = w / 2, cy = h / 2, R = Math.min(w, h) * 0.42 / (opts.range || 1.5);
  ctx.strokeStyle = C.gridFaint; ctx.lineWidth = 1;
  for (let g = -2; g <= 2; g++) { ctx.beginPath(); ctx.moveTo(cx + g * R, 0); ctx.lineTo(cx + g * R, h); ctx.stroke(); ctx.beginPath(); ctx.moveTo(0, cy + g * R); ctx.lineTo(w, cy + g * R); ctx.stroke(); }
  ctx.strokeStyle = C.edge; ctx.beginPath(); ctx.moveTo(0, cy); ctx.lineTo(w, cy); ctx.stroke(); ctx.beginPath(); ctx.moveTo(cx, 0); ctx.lineTo(cx, h); ctx.stroke();
  if (opts.noise) { opts.noise.forEach((p) => { ctx.fillStyle = p.c; ctx.globalAlpha = 0.5; ctx.beginPath(); ctx.arc(cx + p.I * R, cy - p.Q * R, 1.8, 0, 7); ctx.fill(); }); ctx.globalAlpha = 1; }
  pts.forEach((s) => {
    ctx.fillStyle = opts.pointColor || C.ink; ctx.beginPath(); ctx.arc(cx + s.I * R, cy - s.Q * R, 3.2, 0, 7); ctx.fill();
    if (opts.labels) { ctx.fillStyle = C.sub; ctx.font = `9px ${FONT.mono}`; ctx.textAlign = "center"; ctx.fillText(s.label, cx + s.I * R, cy - s.Q * R - 7); }
  });
}

/* ============================================================
   MODULE 04.1 — ANALOG MODULATION (AM / FM / PM)
   ============================================================ */
function AnalogModModule() {
  const wRef = useRef(null), sRef = useRef(null);
  const [scheme, setScheme] = useState("AM");
  const [fc, setFc] = useState(16);
  const [fm, setFm] = useState(2);
  const [idx, setIdx] = useState(0.8);
  const N = 256;

  useEffect(() => {
    const sig = new Array(N), env = new Array(N), msg = new Array(N);
    for (let n = 0; n < N; n++) {
      const tm = 2 * Math.PI * fm * n / N, tc = 2 * Math.PI * fc * n / N;
      msg[n] = Math.cos(tm);
      if (scheme === "AM") { const e = 1 + idx * Math.cos(tm); sig[n] = e * Math.cos(tc); env[n] = e; }
      else if (scheme === "FM") { sig[n] = Math.cos(tc + idx * Math.sin(tm)); env[n] = null; }
      else { sig[n] = Math.cos(tc + idx * Math.cos(tm)); env[n] = null; }
    }
    const wc = wRef.current;
    if (wc) {
      const ctx = wc._ctx || (wc._ctx = fitCanvas(wc, wc.clientWidth, wc.clientHeight));
      const series = [{ data: msg, color: C.D, w: 1.2, alpha: 0.5 }, { data: sig, color: C.I, w: 1.6 }];
      if (scheme === "AM") { series.push({ data: env, color: C.B, w: 1.2, alpha: 0.8 }); series.push({ data: env.map((e) => -e), color: C.B, w: 1.2, alpha: 0.8 }); }
      drawWave(ctx, wc.clientWidth, wc.clientHeight, series, { scale: scheme === "AM" ? 1 + idx : 1 });
    }
    const sc = sRef.current;
    if (sc) {
      const ctx = sc._ctx || (sc._ctx = fitCanvas(sc, sc.clientWidth, sc.clientHeight));
      const m = magSpec(sig); const w = sc.clientWidth, h = sc.clientHeight, half = N / 2;
      ctx.clearRect(0, 0, w, h); let mx = 0; for (let i = 0; i < half; i++) mx = Math.max(mx, m[i]);
      ctx.fillStyle = C.faint; ctx.font = `10px ${FONT.mono}`; ctx.textAlign = "left"; ctx.fillText("frequency →", 4, h - 5);
      for (let i = 0; i < half; i++) { const x = (i / half) * w, bh = (m[i] / mx) * (h - 22); ctx.strokeStyle = i === fc ? C.I : C.Q; ctx.globalAlpha = i === fc ? 1 : 0.85; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(x, h - 16); ctx.lineTo(x, h - 16 - bh); ctx.stroke(); }
      ctx.globalAlpha = 1;
    }
  }, [scheme, fc, fm, idx]);

  const idxLabel = scheme === "AM" ? "modulation depth" : "modulation index β";
  return (
    <div>
      <Lead
        notes={[
          { t: "Term", c: C.A, x: "AM varies the carrier’s amplitude, FM its instantaneous frequency, PM its phase. ‘Modulation index’ sets how hard you push: depth for AM, the peak phase/frequency swing for PM/FM." },
          { t: "Intuition", c: C.Q, x: "In the Part-1 rotating-arrow picture, AM stretches and shrinks the arrow’s length while FM and PM speed up and slow down its spin. Amplitude vs angle — the two things a complex sample can carry." },
          { t: "Heads up", c: C.warn, x: "AM is spectrally tidy: a carrier plus two sidebands. FM/PM smear energy into many sidebands and need more bandwidth as you raise the index — robustness traded for width." },
        ]}
        n="04.1" title="Riding a carrier: AM, FM, and PM"
        body="Before bits, the basics: a message changes some property of a steady carrier wave. Amplitude modulation rides the message on the carrier's height; frequency and phase modulation ride it on the carrier's angle instead. Watch the waveform reshape and the spectrum sprout sidebands as you change the message and how hard it's modulated." />
      <div className="iq-grid2">
        <div style={{ display: "grid", gap: 14 }}>
          <Panel label="Modulated waveform (carrier in amber, message faint green)">
            <canvas ref={wRef} style={{ width: "100%", height: 150, display: "block" }} />
          </Panel>
          <Panel label="Spectrum — carrier (amber) and sidebands (cyan)">
            <canvas ref={sRef} style={{ width: "100%", height: 130, display: "block" }} />
          </Panel>
        </div>
        <div style={{ display: "grid", gap: 14, alignContent: "start" }}>
          <Panel label="Modulation">
            <div style={{ display: "grid", gap: 16 }}>
              <div><div style={{ fontSize: 13, color: C.sub, fontFamily: FONT.body, marginBottom: 6 }}>Scheme</div><Pills value={scheme} options={["AM", "FM", "PM"]} onChange={setScheme} /></div>
              <Slider label="Carrier frequency" value={fc} min={8} max={40} step={1} color={C.I} fmt={(v) => v + " cyc"} onChange={setFc} />
              <Slider label="Message frequency" value={fm} min={1} max={8} step={1} color={C.D} fmt={(v) => v + " cyc"} onChange={setFm} />
              <Slider label={idxLabel} value={idx} min={0} max={scheme === "AM" ? 1 : 6} step={0.05} color={C.B} fmt={(v) => v.toFixed(2)} onChange={setIdx} />
              <button className="iq-mini" onClick={() => modTone(scheme === "AM" ? "AM" : "FM", 5, scheme === "AM" ? idx : 0.4 + idx / 6)} style={{ alignSelf: "start" }}>{"▶"} listen ({scheme === "PM" ? "FM-style" : scheme})</button>
            </div>
          </Panel>
          <Panel label="In I/Q terms">
            <p style={{ fontFamily: FONT.body, fontSize: 12.5, color: C.sub, margin: 0, lineHeight: 1.55 }}>
              {scheme === "AM" ? "AM lives in the magnitude √(I²+Q²): the arrow keeps its angle but pulses longer and shorter with the message." : "FM/PM live in the angle atan2(Q, I): the arrow keeps its length but its rotation rate (FM) or offset (PM) tracks the message."}
            </p>
          </Panel>
        </div>
      </div>
      <Deeper
        recap="Modulation maps a message onto a carrier cos(2πf_c t). AM multiplies the carrier by (1 + depth·m(t)), so the message becomes the envelope. FM/PM instead add the message into the angle, cos(2πf_c t + θ(t)), so amplitude stays put while the phase wiggles. The spectrum tells them apart: AM is a carrier plus a mirror-image pair of sidebands; angle modulation fans out into many sidebands."
        example={`AM, message at f_m, depth m:
   s(t) = (1 + m·cos2πf_m t)·cos2πf_c t
        = cos2πf_c t                      (carrier)
        + (m/2)·cos2π(f_c+f_m)t            (upper sideband)
        + (m/2)·cos2π(f_c−f_m)t            (lower sideband)
   → occupied bandwidth = 2·f_m, exactly two sidebands.

FM, peak deviation Δf, message f_m, index β = Δf/f_m:
   energy spreads to f_c ± k·f_m with weights J_k(β).
   Carson's rule: bandwidth ≈ 2(β + 1)·f_m — it grows with β,
   which is why the bars fan wider as you push the index.`}
      />
    </div>
  );
}

/* ============================================================
   MODULE 04.2 — DIGITAL MODULATION (ASK / FSK / PSK / QAM)
   ============================================================ */
function DigitalModModule() {
  const wRef = useRef(null), cRef = useRef(null);
  const [scheme, setScheme] = useState("QPSK");
  const [seed, setSeed] = useState(3);
  const sps = 22, nSym = 8;
  const bps = { OOK: 1, "2-FSK": 1, BPSK: 1, QPSK: 2, "8PSK": 3, "16QAM": 4 }[scheme];

  useEffect(() => {
    _seed = 9000 + seed * 131;
    const bitsArr = []; for (let i = 0; i < nSym * bps; i++) bitsArr.push((rand() < 0.5 ? 0 : 1));
    const symPts = [], I = [], Q = [], usedPts = [];
    const cset = (scheme === "OOK") ? [{ I: 0, Q: 0, label: "0" }, { I: 1, Q: 0, label: "1" }]
      : (scheme === "BPSK") ? constel(2) : (scheme === "QPSK") ? constel(4) : (scheme === "8PSK") ? constel(8) : (scheme === "16QAM") ? constel(16) : null;
    for (let s = 0; s < nSym; s++) {
      const chunk = bitsArr.slice(s * bps, s * bps + bps).join("");
      if (scheme === "2-FSK") {
        const f = chunk === "0" ? 1.2 : 2.6; // baseband tone freq (cycles per symbol)
        for (let k = 0; k < sps; k++) { const ph = 2 * Math.PI * f * k / sps; I.push(Math.cos(ph)); Q.push(Math.sin(ph)); }
        symPts.push({ f });
      } else {
        let p = cset.find((c) => c.label === chunk) || cset[parseInt(chunk, 2) % cset.length];
        usedPts.push(p);
        for (let k = 0; k < sps; k++) { I.push(p.I); Q.push(p.Q); }
      }
    }
    const wc = wRef.current;
    if (wc) {
      const ctx = wc._ctx || (wc._ctx = fitCanvas(wc, wc.clientWidth, wc.clientHeight));
      const bounds = []; for (let s = 1; s < nSym; s++) bounds.push(s * sps);
      drawWave(ctx, wc.clientWidth, wc.clientHeight, [{ data: I, color: C.I, w: 1.8 }, { data: Q, color: C.Q, w: 1.8 }], { bounds, scale: 1.15 });
      ctx.fillStyle = C.faint; ctx.font = `9px ${FONT.mono}`; ctx.textAlign = "center";
      for (let s = 0; s < nSym; s++) { const chunk = bitsArr.slice(s * bps, s * bps + bps).join(""); ctx.fillText(chunk, ((s + 0.5) / nSym) * wc.clientWidth, 12); }
    }
    const cc = cRef.current;
    if (cc) {
      const ctx = cc._ctx || (cc._ctx = fitCanvas(cc, cc.clientWidth, cc.clientHeight));
      if (scheme === "2-FSK") { ctx.clearRect(0, 0, cc.clientWidth, cc.clientHeight); ctx.fillStyle = C.sub; ctx.font = `11px ${FONT.body}`; ctx.textAlign = "center"; ctx.fillText("FSK rides on frequency, not a", cc.clientWidth / 2, cc.clientHeight / 2 - 8); ctx.fillText("fixed set of points — see the", cc.clientWidth / 2, cc.clientHeight / 2 + 8); ctx.fillText("I/Q tones change speed.", cc.clientWidth / 2, cc.clientHeight / 2 + 24); }
      else drawConstellation(ctx, cc.clientWidth, cc.clientHeight, cset, { range: scheme === "OOK" ? 1.3 : 1.5, labels: true, pointColor: C.A });
    }
  }, [scheme, seed]);

  return (
    <div>
      <Lead
        notes={[
          { t: "Term", c: C.A, x: "Digital schemes map groups of bits to discrete states: ASK = amplitude levels, FSK = frequencies, PSK = phases, QAM = an amplitude×phase grid. Each distinct state is one symbol." },
          { t: "Intuition", c: C.Q, x: "Watch I (amber) and Q (cyan) jump to a new pair each symbol period. Those (I, Q) pairs are exactly the dots in the constellation on the right — the alphabet the transmitter draws from." },
          { t: "Try it", c: C.D, x: "Step from BPSK up to 16QAM: the same wires now carry more bits per symbol because there are more distinct (I, Q) states to land on. New bits reshuffles the random data." },
        ]}
        n="04.2" title="Sending bits: ASK, FSK, PSK, QAM"
        body="To carry data, bits select from a finite menu of carrier states. Amplitude-shift keying flips the level, frequency-shift keying flips the tone, phase-shift keying rotates the phase, and QAM uses both amplitude and phase at once. Here a random bitstream drives each scheme — see the baseband I/Q jump between symbols and the menu of states it's choosing from." />
      <div className="iq-grid2">
        <div style={{ display: "grid", gap: 14 }}>
          <Panel label="Baseband I (amber) and Q (cyan) over 8 symbols">
            <canvas ref={wRef} style={{ width: "100%", height: 160, display: "block" }} />
            <p style={{ fontFamily: FONT.body, fontSize: 12.5, color: C.sub, margin: "10px 0 0", lineHeight: 1.5 }}>
              Each segment between gridlines is one symbol; its bit label is printed on top. The I/Q levels hold steady across the symbol (a rectangular pulse — Part 2.5 shapes these).
            </p>
          </Panel>
        </div>
        <div style={{ display: "grid", gap: 14, alignContent: "start" }}>
          <Panel label="The menu of symbols (constellation)">
            <canvas ref={cRef} style={{ width: "100%", height: 190, display: "block" }} />
          </Panel>
          <Panel label="Scheme">
            <Pills value={scheme} options={["OOK", "2-FSK", "BPSK", "QPSK", "8PSK", "16QAM"]} onChange={setScheme} />
            <div style={{ marginTop: 12 }}><Readout rows={[["bits per symbol", String(bps), C.A], ["states", scheme === "2-FSK" ? "2 tones" : String({ OOK: 2, BPSK: 2, QPSK: 4, "8PSK": 8, "16QAM": 16 }[scheme]), C.ink]]} /></div>
            <button onClick={() => setSeed((s) => s + 1)} className="iq-mini" style={{ marginTop: 12 }}>↻ new bits</button>
          </Panel>
        </div>
      </div>
      <Deeper
        recap="A digital modulator chops the bitstream into groups of log₂(M) bits and maps each group to one of M carrier states — a symbol. PSK puts those states at equal angles around the unit circle; QAM arranges them on a grid of amplitudes; ASK uses amplitude alone; FSK uses distinct frequencies (so it has no single fixed constellation). The transmitted I/Q waveform is just those symbol values, one per symbol period."
        example={`QPSK, the scheme used in Part 3:
   2 bits → 1 of 4 phases. With Gray coding,
     00 → ( +0.707, +0.707 )      01 → ( −0.707, +0.707 )
     11 → ( −0.707, −0.707 )      10 → ( +0.707, −0.707 )
   so the bitstream 00 11 10 ... sets (I,Q) to those pairs in turn.

16QAM packs 4 bits into one of 16 grid points — four times the
bits of BPSK per symbol — but the points sit closer together,
which (module 04.3) is what makes it need a cleaner channel.`}
      />
    </div>
  );
}

/* ============================================================
   MODULE 04.3 — THE CONSTELLATION DIAGRAM
   ============================================================ */
function ConstellationModule() {
  const cRef = useRef(null);
  const [M, setM] = useState(4);
  const [snr, setSnr] = useState(18);
  const [labels, setLabels] = useState(true);
  const [noise, setNoise] = useState(true);
  const [info, setInfo] = useState({ dmin: 0 });

  useEffect(() => {
    const pts = constel(M); const dmin = minDist(pts); setInfo({ dmin });
    const N0 = Math.pow(10, -snr / 10), sigma = Math.sqrt(N0 / 2);
    let cloud = null;
    if (noise) { cloud = []; const T = Math.min(900, 40 * M); for (let i = 0; i < T; i++) { const p = pts[(rand() * M) | 0]; cloud.push({ I: p.I + sigma * randn(), Q: p.Q + sigma * randn(), c: C.Q }); } }
    const cc = cRef.current;
    if (cc) { const ctx = cc._ctx || (cc._ctx = fitCanvas(cc, cc.clientWidth, cc.clientHeight)); drawConstellation(ctx, cc.clientWidth, cc.clientHeight, pts, { range: M >= 16 ? 1.5 : 1.4, labels: labels && M <= 16, noise: cloud, pointColor: "#ffffff" }); }
  }, [M, snr, labels, noise]);

  const bps = Math.log2(M);
  const margin = info.dmin / (2 * Math.sqrt(Math.pow(10, -snr / 10) / 2));
  const verdict = margin > 4 ? ["clean", C.D] : margin > 2.5 ? ["usable", C.I] : ["errors likely", C.warn];
  return (
    <div>
      <Lead
        notes={[
          { t: "Term", c: C.A, x: "The constellation diagram is the I/Q plane plotting every legal symbol as a dot. Count the dots: M dots = log₂(M) bits per symbol. The grid lines between dots are the receiver’s decision boundaries." },
          { t: "Intuition", c: C.Q, x: "Noise scatters each received dot into a fuzzy blob. As long as a blob stays on its own side of the boundaries, the symbol decodes correctly. Min distance between dots is the safety margin." },
          { t: "Heads up", c: C.warn, x: "Gray coding labels neighbours so they differ by a single bit — a near-miss across one boundary corrupts only one bit, not several. It’s why real systems almost always Gray-code." },
        ]}
        n="04.3" title="The constellation diagram"
        body="This is the picture QPSK kept appearing as in Part 3. Every modulation scheme is just a set of points in the I/Q plane — its constellation — and each point stands for one symbol carrying several bits. Raise the order to pack more bits per point, add noise to see the dots blur, and watch how the spacing between points decides whether they stay separable." />
      <div className="iq-grid2">
        <div style={{ display: "grid", gap: 14 }}>
          <Panel label="Constellation with Gray-coded bit labels">
            <canvas ref={cRef} style={{ width: "100%", height: 300, display: "block" }} />
            <p style={{ fontFamily: FONT.body, fontSize: 12.5, color: C.sub, margin: "10px 0 0", lineHeight: 1.5 }}>
              White dots are the ideal symbols; cyan haze is what noise does to them. Push the order up and drop the SNR until the blobs start to overlap — that overlap is a bit error waiting to happen.
            </p>
          </Panel>
        </div>
        <div style={{ display: "grid", gap: 14, alignContent: "start" }}>
          <Panel label="Constellation">
            <div style={{ display: "grid", gap: 14 }}>
              <Pills value={M} options={[2, 4, 8, 16, 64]} onChange={setM} labels={["BPSK", "QPSK", "8PSK", "16QAM", "64QAM"]} />
              <Slider label="Signal-to-noise ratio (Es/N0)" value={snr} min={4} max={34} step={1} color={C.I} fmt={(v) => v.toFixed(0) + " dB"} onChange={setSnr} />
              <div style={{ display: "flex", gap: 14 }}>
                <label style={{ display: "flex", alignItems: "center", gap: 7, cursor: "pointer", color: C.Q }}><input type="checkbox" checked={noise} onChange={(e) => setNoise(e.target.checked)} style={{ width: 14, height: 14 }} /><span style={{ fontFamily: FONT.body, fontSize: 12.5, color: C.sub }}>noise</span></label>
                <label style={{ display: "flex", alignItems: "center", gap: 7, cursor: "pointer", color: C.A }}><input type="checkbox" checked={labels} onChange={(e) => setLabels(e.target.checked)} style={{ width: 14, height: 14 }} /><span style={{ fontFamily: FONT.body, fontSize: 12.5, color: C.sub }}>bit labels</span></label>
              </div>
            </div>
          </Panel>
          <Panel label="Read the geometry">
            <Readout rows={[["bits per symbol", String(bps), C.A], ["constellation points", String(M), C.ink], ["min distance (unit power)", info.dmin.toFixed(2), info.dmin > 0.6 ? C.D : C.warn], ["separation margin", verdict[0], verdict[1]]]} />
            <p style={{ fontFamily: FONT.body, fontSize: 12.5, color: C.sub, margin: "12px 0 0", lineHeight: 1.55 }}>
              At equal transmit power, more points means smaller min distance, so a given amount of noise is far likelier to push a symbol across a boundary. That tradeoff is module 04.4.
            </p>
          </Panel>
        </div>
      </div>
      <Deeper
        recap="A constellation fixes the meaning of each (I, Q) point: M points carry log₂(M) bits each. The receiver picks the nearest point to what it got, so errors happen when noise exceeds half the distance to a neighbour — the whole game is the minimum distance d_min at a fixed average power. Gray coding orders the labels so adjacent points differ by one bit, making the common single-boundary slip cost just one bit."
        example={`Normalised to unit average power (so schemes compare fairly):
   BPSK   2 pts   d_min = 2.00   (1 bit/sym)
   QPSK   4 pts   d_min = 1.41   (2 bits/sym)
   16QAM  16 pts  d_min = 0.63   (4 bits/sym)
   64QAM  64 pts  d_min = 0.31   (6 bits/sym)

Going QPSK → 16QAM doubles the bits per symbol but cuts d_min
by ~2.2×, i.e. you need about 20·log₁₀(1.41/0.63) ≈ 7 dB more
SNR for the same error rate. Gray coding: QPSK 00→01→11→10
around the square, each step flipping exactly one bit.`}
      />
    </div>
  );
}

/* ============================================================
   MODULE 04.4 — SYMBOLS, BITS, BAUD & BITRATE
   ============================================================ */
function RateModule() {
  const bRef = useRef(null);
  const [rs, setRs] = useState(1);     // Msym/s
  const [M, setM] = useState(16);
  const [roll, setRoll] = useState(0.25);

  const orders = [2, 4, 16, 64, 256];
  const bps = Math.log2(M);
  const bitrate = rs * bps;            // Mbit/s
  const bw = rs * (1 + roll);          // MHz
  const specEff = bps / (1 + roll);    // bit/s/Hz
  const dminB = minDist(constel(2)), dminM = minDist(constel(M));
  const snrPenalty = 20 * Math.log10(dminB / dminM);

  useEffect(() => {
    const bc = bRef.current; if (!bc) return;
    const ctx = bc._ctx || (bc._ctx = fitCanvas(bc, bc.clientWidth, bc.clientHeight));
    const w = bc.clientWidth, h = bc.clientHeight, padB = 26, padT = 8, n = orders.length, bw0 = w / n;
    ctx.clearRect(0, 0, w, h);
    const rates = orders.map((m) => rs * Math.log2(m)), maxR = Math.max(...rates);
    orders.forEach((m, i) => {
      const r = rs * Math.log2(m), bh = (r / maxR) * (h - padB - padT), x = i * bw0;
      ctx.fillStyle = m === M ? C.Q : "#2b3a45"; ctx.fillRect(x + bw0 * 0.2, h - padB - bh, bw0 * 0.6, bh);
      ctx.fillStyle = m === M ? C.Q : C.sub; ctx.font = `10px ${FONT.mono}`; ctx.textAlign = "center";
      ctx.fillText(SCHEMES[m][0], x + bw0 / 2, h - padB + 13);
      ctx.fillStyle = C.faint; ctx.fillText(r.toFixed(1), x + bw0 / 2, h - padB - bh - 4);
    });
    ctx.fillStyle = C.faint; ctx.font = `9px ${FONT.mono}`; ctx.textAlign = "left"; ctx.fillText("bit rate (Mbit/s) at this baud →", 4, padT + 8);
  }, [rs, M, roll]);

  return (
    <div>
      <Lead
        notes={[
          { t: "Term", c: C.A, x: "Baud (symbol rate) = symbols per second. Bit rate = baud × bits-per-symbol. They’re only equal for 1-bit schemes like BPSK; everything richer sends several bits per symbol." },
          { t: "Intuition", c: C.Q, x: "Bandwidth is set by the symbol rate, not the bit rate. So to go faster without more spectrum, you pack more bits into each symbol — climb to a higher-order constellation." },
          { t: "Heads up", c: C.warn, x: "That climb isn’t free: higher order means tighter points (module 04.3), so it demands more SNR. Real links pick the densest constellation the channel’s SNR can support — adaptive modulation." },
        ]}
        n="04.4" title="Symbols vs bits, baud vs bitrate"
        body="The last piece of vocabulary, and the central tradeoff. You transmit symbols at some rate (the baud), and each symbol carries several bits depending on the constellation. Bandwidth tracks the symbol rate, so higher-order modulation buys more bitrate in the same bandwidth — paid for in required SNR. Slide the order and watch the bitrate climb and the SNR cost climb with it." />
      <div className="iq-grid2">
        <div style={{ display: "grid", gap: 14 }}>
          <Panel label="Bit rate by constellation order (same baud)">
            <canvas ref={bRef} style={{ width: "100%", height: 200, display: "block" }} />
            <p style={{ fontFamily: FONT.body, fontSize: 12.5, color: C.sub, margin: "10px 0 0", lineHeight: 1.5 }}>
              Same symbol rate, same bandwidth — only the bits-per-symbol changes. 256QAM carries 8× the bits of BPSK per symbol, but needs a far cleaner channel to do it.
            </p>
          </Panel>
        </div>
        <div style={{ display: "grid", gap: 14, alignContent: "start" }}>
          <Panel label="Link budget">
            <div style={{ display: "grid", gap: 14 }}>
              <Slider label="Symbol rate (baud)" value={rs} min={0.1} max={10} step={0.1} color={C.D} fmt={(v) => v.toFixed(1) + " Msym/s"} onChange={setRs} />
              <div><div style={{ fontSize: 13, color: C.sub, fontFamily: FONT.body, marginBottom: 6 }}>Constellation</div><Pills value={M} options={orders} onChange={setM} labels={orders.map((m) => SCHEMES[m][0])} /></div>
              <Slider label="Pulse roll-off (RRC excess BW)" value={roll} min={0} max={0.5} step={0.01} color={C.Q} fmt={(v) => v.toFixed(2)} onChange={setRoll} />
            </div>
          </Panel>
          <Panel label="Result">
            <Readout rows={[
              ["bits per symbol", bps.toFixed(0), C.A],
              ["bit rate", bitrate.toFixed(1) + " Mbit/s", C.ink],
              ["occupied bandwidth", bw.toFixed(2) + " MHz", C.Q],
              ["spectral efficiency", specEff.toFixed(2) + " bit/s/Hz", C.D],
              ["extra SNR vs BPSK", "+" + snrPenalty.toFixed(1) + " dB", C.warn],
            ]} />
            <p style={{ fontFamily: FONT.body, fontSize: 12.5, color: C.sub, margin: "12px 0 0", lineHeight: 1.55 }}>
              Roll-off is the pulse-shaping cost from Part 2.5: a little extra bandwidth beyond the ideal symbol rate. Spectral efficiency = bits per second per hertz, the headline number for any link.
            </p>
          </Panel>
        </div>
      </div>
      <Deeper
        recap="Two rates, easy to confuse: the symbol rate (baud) is how many symbols leave per second, and the bit rate is that times the bits each symbol carries. A pulse-shaped signal occupies bandwidth ≈ baud·(1 + roll-off), independent of the constellation, so the way to raise bit rate in fixed spectrum is to raise bits-per-symbol — a denser constellation — which costs SNR."
        example={`Symbol rate Rs = 1 Msym/s, root-raised-cosine roll-off 0.25:
   occupied bandwidth = 1 × 1.25 = 1.25 MHz  (same for all below)

   BPSK   1 bit/sym  → 1 Mbit/s    spec.eff 0.80 bit/s/Hz
   QPSK   2 bit/sym  → 2 Mbit/s    spec.eff 1.60
   16QAM  4 bit/sym  → 4 Mbit/s    spec.eff 3.20
   256QAM 8 bit/sym  → 8 Mbit/s    spec.eff 6.40

Eightfold bit rate in the same 1.25 MHz — but 256QAM’s points
are ~26× closer than BPSK’s, needing far more SNR. The link
chooses the densest constellation its SNR allows.`}
      />
    </div>
  );
}

/* ============================================================
   APP SHELL
   ============================================================ */
const MODULES = [
  { id: "04.1", label: "AM · FM · PM", comp: AnalogModModule },
  { id: "04.2", label: "ASK · FSK · PSK · QAM", comp: DigitalModModule },
  { id: "04.3", label: "Constellation", comp: ConstellationModule },
  { id: "04.4", label: "Baud & bitrate", comp: RateModule },
];

const DIFF = [1, 2, 2, 2];
const PREDICTS = {"2": {"q": "Going QPSK to 16QAM at the same average power, the minimum distance...", "options": ["stays the same", "shrinks", "grows"], "answer": 1, "why": "Sixteen points in the same power crowd together: d_min falls from about 1.41 to 0.63, so it needs more SNR."}, "3": {"q": "Same baud, switch BPSK to 16QAM. The occupied bandwidth...", "options": ["4x wider", "unchanged", "4x narrower"], "answer": 1, "why": "Bandwidth tracks the symbol rate, not bits per symbol. 16QAM carries 4x the bits in the same bandwidth."}};
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
            <Eyebrow>I/Q signal primer · modulation</Eyebrow>
          </div>
          <h1 style={{ fontFamily: FONT.disp, fontSize: 34, fontWeight: 700, margin: "0 0 8px", letterSpacing: "-0.02em", lineHeight: 1.05 }}>How information rides a wave</h1>
          <p style={{ fontFamily: FONT.body, fontSize: 15, color: C.sub, maxWidth: 720, lineHeight: 1.6, margin: 0 }}>
            Part 1 showed what an I/Q sample is. Before we pull signals apart, here's how data gets onto a carrier in the first place — analog AM/FM/PM, the digital schemes ASK/FSK/PSK/QAM, and the constellation diagram that QPSK kept appearing as. Every plot runs the real math.
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
          Amplitude or angle, one symbol at a time: that's modulation. The constellation is the alphabet, bits-per-symbol times baud is the rate, and minimum distance is the SNR you'll pay. Next, Part 2 separates these signals; later, the receiver back-end turns them back into bits.
        </footer>
      </div>
    </div>
  );
}
