/**
 * BTC Trader — Canvas Chart Engine
 * Pure vanilla JS candlestick chart with zoom/pan support
 */

class CandleChart {
  constructor(canvasId, options = {}) {
    this.canvas = document.getElementById(canvasId);
    this.ctx = this.canvas.getContext('2d');
    this.options = {
      bgColor: '#0d1117',
      gridColor: 'rgba(255,255,255,0.04)',
      textColor: '#4a5568',
      upColor: '#00d68f',
      downColor: '#ff4d6d',
      upWick: '#00d68f',
      downWick: '#ff4d6d',
      volumeUpColor: 'rgba(0,214,143,0.25)',
      volumeDownColor: 'rgba(255,77,109,0.25)',
      crosshairColor: 'rgba(255,255,255,0.12)',
      priceLineColor: '#e8b84b',
      fontSize: 10,
      padding: { top: 20, right: 70, bottom: 30, left: 4 },
      volumeRatio: 0.18,
      ...options,
    };

    this.candles = [];
    this.viewStart = 0;   // index of first visible candle
    this.viewCount = 80;  // number of visible candles
    this.isPanning = false;
    this.panStartX = 0;
    this.panStartView = 0;
    this.crosshair = { visible: false, x: 0, y: 0, index: -1 };
    this.onCrosshairMove = null;

    this._initEvents();
    this._startResizeObserver();
  }

  /* ── Data ─────────────────────────────────────────────── */
  setData(candles) {
    this.candles = candles;
    this.viewStart = Math.max(0, candles.length - this.viewCount);
    this.render();
  }

  updateLastCandle(candle) {
    if (!this.candles.length) return;
    const last = this.candles[this.candles.length - 1];
    if (last.time === candle.time) {
      this.candles[this.candles.length - 1] = candle;
    } else {
      this.candles.push(candle);
      if (this.viewStart + this.viewCount >= this.candles.length - 1) {
        this.viewStart = Math.max(0, this.candles.length - this.viewCount);
      }
    }
    this.render();
  }

  /* ── Size ─────────────────────────────────────────────── */
  _resize() {
    const rect = this.canvas.parentElement.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    this.canvas.width = rect.width * dpr;
    this.canvas.height = rect.height * dpr;
    this.canvas.style.width = rect.width + 'px';
    this.canvas.style.height = rect.height + 'px';
    this.ctx.scale(dpr, dpr);
    this.W = rect.width;
    this.H = rect.height;
    this.render();
  }

  _startResizeObserver() {
    this._resize();
    const ro = new ResizeObserver(() => this._resize());
    ro.observe(this.canvas.parentElement);
  }

  /* ── Coordinate Helpers ──────────────────────────────── */
  get chartArea() {
    const p = this.options.padding;
    return {
      x: p.left,
      y: p.top,
      w: (this.W || 800) - p.left - p.right,
      h: (this.H || 400) - p.top - p.bottom,
    };
  }

  get mainH() { return this.chartArea.h * (1 - this.options.volumeRatio) - 4; }
  get volH() { return this.chartArea.h * this.options.volumeRatio; }
  get volY() { return this.chartArea.y + this.mainH + 8; }

  _priceToY(price, minP, maxP) {
    const ca = this.chartArea;
    const range = maxP - minP || 1;
    return ca.y + this.mainH - ((price - minP) / range) * this.mainH;
  }

  _indexToX(i, totalVisible, candleW) {
    return this.chartArea.x + (i + 0.5) * candleW;
  }

  /* ── Render ───────────────────────────────────────────── */
  render() {
    if (!this.W || !this.candles.length) return;
    const ctx = this.ctx;
    const ca = this.chartArea;

    // Clear
    ctx.clearRect(0, 0, this.W, this.H);
    ctx.fillStyle = this.options.bgColor;
    ctx.fillRect(0, 0, this.W, this.H);

    const visible = this.candles.slice(
      Math.max(0, this.viewStart),
      Math.min(this.candles.length, this.viewStart + this.viewCount)
    );
    if (!visible.length) return;

    const candleW = ca.w / this.viewCount;
    const bodyW = Math.max(1, candleW * 0.65);

    // Price range
    let minP = Infinity, maxP = -Infinity;
    visible.forEach(c => {
      if (c.low < minP) minP = c.low;
      if (c.high > maxP) maxP = c.high;
    });
    const priceRange = maxP - minP;
    minP -= priceRange * 0.04;
    maxP += priceRange * 0.04;

    // Volume range
    let maxVol = 0;
    visible.forEach(c => { if (c.volume > maxVol) maxVol = c.volume; });

    // Grid
    this._drawGrid(ctx, ca, minP, maxP);

    // Volume bars
    visible.forEach((c, i) => {
      const x = ca.x + (i + 0.5) * candleW;
      const volH = maxVol > 0 ? (c.volume / maxVol) * this.volH : 0;
      ctx.fillStyle = c.close >= c.open
        ? this.options.volumeUpColor
        : this.options.volumeDownColor;
      ctx.fillRect(x - bodyW / 2, this.volY + this.volH - volH, bodyW, volH);
    });

    // Candles
    visible.forEach((c, i) => {
      const x = ca.x + (i + 0.5) * candleW;
      const isUp = c.close >= c.open;
      const color = isUp ? this.options.upColor : this.options.downColor;
      const wickColor = isUp ? this.options.upWick : this.options.downWick;

      const oY = this._priceToY(c.open, minP, maxP);
      const cY = this._priceToY(c.close, minP, maxP);
      const hY = this._priceToY(c.high, minP, maxP);
      const lY = this._priceToY(c.low, minP, maxP);

      const bodyTop = Math.min(oY, cY);
      const bodyH = Math.max(1, Math.abs(cY - oY));

      // Wick
      ctx.strokeStyle = wickColor;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x, hY);
      ctx.lineTo(x, lY);
      ctx.stroke();

      // Body
      ctx.fillStyle = color;
      if (candleW > 3) {
        ctx.fillRect(x - bodyW / 2, bodyTop, bodyW, bodyH);
      } else {
        ctx.fillRect(x - 0.5, bodyTop, 1, bodyH);
      }
    });

    // Current price line
    if (this.candles.length > 0) {
      const lastClose = this.candles[this.candles.length - 1].close;
      if (lastClose >= minP && lastClose <= maxP) {
        const y = this._priceToY(lastClose, minP, maxP);
        ctx.setLineDash([4, 4]);
        ctx.strokeStyle = this.options.priceLineColor;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(ca.x, y);
        ctx.lineTo(ca.x + ca.w, y);
        ctx.stroke();
        ctx.setLineDash([]);

        // Price label
        const priceLabel = '$' + lastClose.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
        ctx.fillStyle = this.options.priceLineColor;
        ctx.font = `bold ${this.options.fontSize}px IBM Plex Mono, monospace`;
        ctx.textAlign = 'left';
        ctx.fillText(priceLabel, ca.x + ca.w + 4, y + 4);
      }
    }

    // Crosshair
    if (this.crosshair.visible && this.crosshair.index >= 0) {
      const idx = this.crosshair.index - this.viewStart;
      if (idx >= 0 && idx < visible.length) {
        const x = ca.x + (idx + 0.5) * candleW;
        const y = this.crosshair.y;

        ctx.setLineDash([3, 3]);
        ctx.strokeStyle = this.options.crosshairColor;
        ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(x, ca.y); ctx.lineTo(x, ca.y + ca.h); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(ca.x, y); ctx.lineTo(ca.x + ca.w, y); ctx.stroke();
        ctx.setLineDash([]);

        // Price label on right
        const priceAtY = minP + ((ca.y + this.mainH - y) / this.mainH) * (maxP - minP);
        if (y >= ca.y && y <= ca.y + this.mainH) {
          const label = '$' + priceAtY.toLocaleString('en-US', { minimumFractionDigits: 2 });
          ctx.fillStyle = '#2b3446';
          ctx.fillRect(ca.x + ca.w + 1, y - 9, this.options.padding.right - 2, 18);
          ctx.fillStyle = this.options.textColor;
          ctx.font = `${this.options.fontSize}px IBM Plex Mono, monospace`;
          ctx.textAlign = 'left';
          ctx.fillText(label, ca.x + ca.w + 4, y + 4);
        }
      }
    }

    // Time labels
    this._drawTimeLabels(ctx, ca, visible, candleW);
  }

  _drawGrid(ctx, ca, minP, maxP) {
    const priceSteps = 6;
    const priceStep = (maxP - minP) / priceSteps;
    ctx.font = `${this.options.fontSize}px IBM Plex Mono, monospace`;
    ctx.textAlign = 'left';

    for (let i = 0; i <= priceSteps; i++) {
      const price = minP + i * priceStep;
      const y = this._priceToY(price, minP, maxP);
      if (y < ca.y || y > ca.y + this.mainH) continue;

      ctx.strokeStyle = this.options.gridColor;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(ca.x, y);
      ctx.lineTo(ca.x + ca.w, y);
      ctx.stroke();

      ctx.fillStyle = this.options.textColor;
      const label = price >= 1000
        ? '$' + (price / 1000).toFixed(1) + 'K'
        : '$' + price.toFixed(0);
      ctx.fillText(label, ca.x + ca.w + 4, y + 4);
    }
  }

  _drawTimeLabels(ctx, ca, visible, candleW) {
    const count = visible.length;
    const numLabels = Math.min(6, Math.floor(ca.w / 80));
    const step = Math.max(1, Math.floor(count / numLabels));

    ctx.fillStyle = this.options.textColor;
    ctx.font = `${this.options.fontSize}px IBM Plex Mono, monospace`;
    ctx.textAlign = 'center';

    for (let i = 0; i < count; i += step) {
      if (!visible[i]) continue;
      const x = ca.x + (i + 0.5) * candleW;
      const t = new Date(visible[i].time * 1000);
      const label = `${String(t.getMonth() + 1).padStart(2,'0')}/${String(t.getDate()).padStart(2,'0')} ${String(t.getHours()).padStart(2,'0')}:${String(t.getMinutes()).padStart(2,'0')}`;
      ctx.fillText(label, x, ca.y + ca.h - 4);
    }
  }

  /* ── Events ───────────────────────────────────────────── */
  _initEvents() {
    const el = this.canvas;

    // Mouse wheel zoom
    el.addEventListener('wheel', (e) => {
      e.preventDefault();
      const delta = e.deltaY > 0 ? 1.15 : 0.87;
      const oldCount = this.viewCount;
      this.viewCount = Math.min(300, Math.max(20, Math.round(this.viewCount * delta)));

      // Zoom toward cursor position
      const rect = el.getBoundingClientRect();
      const mouseX = e.clientX - rect.left - this.options.padding.left;
      const fracX = Math.max(0, Math.min(1, mouseX / this.chartArea.w));
      const oldCenter = this.viewStart + fracX * oldCount;
      this.viewStart = Math.max(0, Math.min(
        this.candles.length - this.viewCount,
        Math.round(oldCenter - fracX * this.viewCount)
      ));
      this.render();
    }, { passive: false });

    // Pan
    el.addEventListener('mousedown', (e) => {
      this.isPanning = true;
      this.panStartX = e.clientX;
      this.panStartView = this.viewStart;
      el.style.cursor = 'grabbing';
    });

    window.addEventListener('mousemove', (e) => {
      if (!this.W) return;
      const rect = el.getBoundingClientRect();

      if (this.isPanning) {
        const dx = e.clientX - this.panStartX;
        const candleW = this.chartArea.w / this.viewCount;
        const shift = Math.round(-dx / candleW);
        this.viewStart = Math.max(0, Math.min(
          this.candles.length - this.viewCount,
          this.panStartView + shift
        ));
        this.render();
      }

      // Crosshair
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      const ca = this.chartArea;

      if (x >= ca.x && x <= ca.x + ca.w && y >= ca.y && y <= ca.y + this.mainH) {
        const candleW = ca.w / this.viewCount;
        const idx = Math.floor((x - ca.x) / candleW) + this.viewStart;
        this.crosshair = { visible: true, x, y, index: Math.min(idx, this.candles.length - 1) };

        if (this.onCrosshairMove && idx >= 0 && idx < this.candles.length) {
          this.onCrosshairMove(this.candles[idx]);
        }
      } else {
        this.crosshair.visible = false;
        if (this.onCrosshairMove) this.onCrosshairMove(null);
      }
      this.render();
    });

    window.addEventListener('mouseup', () => {
      this.isPanning = false;
      el.style.cursor = 'crosshair';
    });

    el.addEventListener('mouseleave', () => {
      this.crosshair.visible = false;
      if (this.onCrosshairMove) this.onCrosshairMove(null);
      this.render();
    });

    el.style.cursor = 'crosshair';
  }
}

/* ── Mini Equity Chart ───────────────────────────────────── */
class EquityChart {
  constructor(canvasId) {
    this.canvas = document.getElementById(canvasId);
    this.ctx = this.canvas.getContext('2d');
    this.data = [];
    window.addEventListener('resize', () => this.render());
  }

  setData(points) {
    this.data = points;
    this.render();
  }

  render() {
    const canvas = this.canvas;
    const ctx = this.ctx;
    const dpr = window.devicePixelRatio || 1;
    const W = canvas.parentElement.clientWidth;
    const H = canvas.height / dpr;

    canvas.width = W * dpr;
    canvas.style.width = W + 'px';
    ctx.scale(dpr, dpr);

    ctx.clearRect(0, 0, W, H);

    if (this.data.length < 2) {
      ctx.fillStyle = '#1c2333';
      ctx.font = '11px IBM Plex Mono, monospace';
      ctx.textAlign = 'center';
      ctx.fillStyle = '#4a5568';
      ctx.fillText('No data yet — start trading!', W / 2, H / 2);
      return;
    }

    const pad = { t: 10, r: 8, b: 20, l: 56 };
    const cW = W - pad.l - pad.r;
    const cH = H - pad.t - pad.b;

    const vals = this.data.map(d => d.balance);
    let minV = Math.min(...vals);
    let maxV = Math.max(...vals);
    const range = maxV - minV || 1;
    minV -= range * 0.05;
    maxV += range * 0.05;

    const xScale = (i) => pad.l + (i / (this.data.length - 1)) * cW;
    const yScale = (v) => pad.t + cH - ((v - minV) / (maxV - minV)) * cH;

    // Grid lines
    for (let i = 0; i <= 4; i++) {
      const y = pad.t + (i / 4) * cH;
      const v = maxV - (i / 4) * (maxV - minV);
      ctx.strokeStyle = 'rgba(255,255,255,0.04)';
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(pad.l, y); ctx.lineTo(W - pad.r, y); ctx.stroke();
      ctx.fillStyle = '#4a5568';
      ctx.font = '9px IBM Plex Mono, monospace';
      ctx.textAlign = 'right';
      ctx.fillText('$' + Math.round(v).toLocaleString(), pad.l - 4, y + 3);
    }

    // Area gradient
    const lastVal = vals[vals.length - 1];
    const firstVal = vals[0];
    const isProfit = lastVal >= firstVal;
    const lineColor = isProfit ? '#00d68f' : '#ff4d6d';
    const gradTop = isProfit ? 'rgba(0,214,143,0.3)' : 'rgba(255,77,109,0.3)';
    const gradBot = 'rgba(0,0,0,0)';

    const grad = ctx.createLinearGradient(0, pad.t, 0, pad.t + cH);
    grad.addColorStop(0, gradTop);
    grad.addColorStop(1, gradBot);

    ctx.beginPath();
    ctx.moveTo(xScale(0), yScale(this.data[0].balance));
    this.data.forEach((d, i) => ctx.lineTo(xScale(i), yScale(d.balance)));
    ctx.lineTo(xScale(this.data.length - 1), pad.t + cH);
    ctx.lineTo(xScale(0), pad.t + cH);
    ctx.closePath();
    ctx.fillStyle = grad;
    ctx.fill();

    // Line
    ctx.beginPath();
    ctx.moveTo(xScale(0), yScale(this.data[0].balance));
    this.data.forEach((d, i) => ctx.lineTo(xScale(i), yScale(d.balance)));
    ctx.strokeStyle = lineColor;
    ctx.lineWidth = 2;
    ctx.stroke();

    // Start/End dots
    [[0, firstVal], [this.data.length - 1, lastVal]].forEach(([i, v]) => {
      ctx.beginPath();
      ctx.arc(xScale(i), yScale(v), 3, 0, Math.PI * 2);
      ctx.fillStyle = lineColor;
      ctx.fill();
    });
  }
}
