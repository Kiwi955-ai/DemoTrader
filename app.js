/**
 * BTC Trader — Application Core
 * State · Trading Engine · Binance WS · UI Controller
 */

/* ════════════════════════════════════════════════════════════
   STATE MANAGEMENT
   ════════════════════════════════════════════════════════════ */
const State = {
  // Auth
  currentUser: null,
  users: JSON.parse(localStorage.getItem('btc_users') || '[]'),

  // Market
  btcPrice: 0,
  prevPrice: 0,
  ticker24h: { change: 0, changePercent: 0, high: 0, low: 0, volume: 0 },
  candles: {},            // { interval: [...] }
  currentInterval: '1h',
  wsConnected: false,

  // Trading (per user)
  get portfolio() { return this.currentUser ? this._getPortfolio(this.currentUser.id) : null; },

  _getPortfolio(userId) {
    const key = `btc_portfolio_${userId}`;
    const defaults = {
      balance: 10000,
      positions: [],
      orders: [],
      trades: [],
      equityCurve: [{ timestamp: Date.now(), balance: 10000 }],
      peakBalance: 10000,
    };
    const saved = localStorage.getItem(key);
    return saved ? { ...defaults, ...JSON.parse(saved) } : defaults;
  },

  _savePortfolio(data) {
    if (!this.currentUser) return;
    localStorage.setItem(`btc_portfolio_${this.currentUser.id}`, JSON.stringify(data));
  },

  saveUsers() {
    localStorage.setItem('btc_users', JSON.stringify(this.users));
  },

  // UI
  activePage: 'trade',
  orderSide: 'buy',
  orderType: 'market',
  inputMode: 'usdt',   // 'btc' | 'usdt'
};

/* ════════════════════════════════════════════════════════════
   BINANCE WEBSOCKET + REST
   ════════════════════════════════════════════════════════════ */
const Market = {
  ws: null,
  reconnectTimer: null,
  priceCallbacks: [],

  connect() {
    if (this.ws?.readyState === WebSocket.OPEN) return;
    const url = 'wss://stream.binance.com:9443/ws/btcusdt@trade';

    try {
      this.ws = new WebSocket(url);

      this.ws.onopen = () => {
        State.wsConnected = true;
        UI.updateConnStatus(true);
        console.log('[WS] Connected to Binance');
      };

      this.ws.onmessage = (e) => {
        const data = JSON.parse(e.data);
        const price = parseFloat(data.p);
        State.prevPrice = State.btcPrice;
        State.btcPrice = price;
        UI.updatePrice(price, State.prevPrice);
        Trading.checkTriggers(price);
      };

      this.ws.onerror = () => {};
      this.ws.onclose = () => {
        State.wsConnected = false;
        UI.updateConnStatus(false);
        clearTimeout(this.reconnectTimer);
        this.reconnectTimer = setTimeout(() => this.connect(), 4000);
      };
    } catch (e) {
      console.warn('[WS] Could not connect:', e.message);
      this._useFallback();
    }
  },

  _useFallback() {
    // Simulate price for demo if WS unavailable
    let price = 43500 + Math.random() * 2000;
    State.btcPrice = price;
    setInterval(() => {
      const change = (Math.random() - 0.49) * 80;
      price = Math.max(35000, price + change);
      State.prevPrice = State.btcPrice;
      State.btcPrice = price;
      UI.updatePrice(price, State.prevPrice);
      Trading.checkTriggers(price);
    }, 1200);
    UI.updateConnStatus(true); // show as live for demo
  },

  async fetch24hTicker() {
    try {
      const res = await fetch('https://api.binance.com/api/v3/ticker/24hr?symbol=BTCUSDT');
      const d = await res.json();
      State.ticker24h = {
        change: parseFloat(d.priceChange),
        changePercent: parseFloat(d.priceChangePercent),
        high: parseFloat(d.highPrice),
        low: parseFloat(d.lowPrice),
        volume: parseFloat(d.volume),
        quoteVolume: parseFloat(d.quoteVolume),
      };
      UI.updateTicker();
    } catch (e) {
      // Use demo data
      State.ticker24h = { change: 1245.50, changePercent: 2.94, high: 44800, low: 41200, volume: 28400, quoteVolume: 1240000000 };
      UI.updateTicker();
    }
  },

  async fetchKlines(interval, limit = 500, endTime = null) {
    try {
      let url = `https://api.binance.com/api/v3/klines?symbol=BTCUSDT&interval=${interval}&limit=${limit}`;
      if (endTime) url += `&endTime=${endTime}`;
      const res = await fetch(url);
      const raw = await res.json();
      return raw.map(k => ({
        time: Math.floor(k[0] / 1000),
        open: parseFloat(k[1]),
        high: parseFloat(k[2]),
        low: parseFloat(k[3]),
        close: parseFloat(k[4]),
        volume: parseFloat(k[5]),
      }));
    } catch (e) {
      return this._generateDemoCandles(interval, limit);
    }
  },

  _generateDemoCandles(interval, limit) {
    const intervalMs = { '1m': 60000, '5m': 300000, '15m': 900000, '1h': 3600000, '4h': 14400000, '1d': 86400000 };
    const ms = intervalMs[interval] || 3600000;
    const now = Math.floor(Date.now() / 1000);
    let price = 43500;
    const candles = [];

    for (let i = limit; i >= 0; i--) {
      const t = now - i * (ms / 1000);
      const volatility = price * 0.008;
      const open = price;
      const high = open + Math.random() * volatility;
      const low = open - Math.random() * volatility;
      const close = low + Math.random() * (high - low);
      const volume = 500 + Math.random() * 2000;
      candles.push({ time: t, open, high, low, close, volume });
      price = close;
    }
    return candles;
  },
};

/* ════════════════════════════════════════════════════════════
   AUTH
   ════════════════════════════════════════════════════════════ */
const Auth = {
  login(email, password) {
    const user = State.users.find(u => u.email === email.toLowerCase());
    if (!user) throw new Error('User not found');
    if (user.password !== this._hash(password)) throw new Error('Invalid password');
    State.currentUser = user;
    localStorage.setItem('btc_session', user.id);
    return user;
  },

  register(email, username, password) {
    if (State.users.find(u => u.email === email.toLowerCase())) {
      throw new Error('Email already registered');
    }
    if (State.users.find(u => u.username === username)) {
      throw new Error('Username taken');
    }
    const user = {
      id: 'user_' + Date.now() + Math.random().toString(36).slice(2, 7),
      email: email.toLowerCase(),
      username,
      password: this._hash(password),
      createdAt: Date.now(),
    };
    State.users.push(user);
    State.saveUsers();
    State.currentUser = user;
    localStorage.setItem('btc_session', user.id);
    return user;
  },

  logout() {
    State.currentUser = null;
    localStorage.removeItem('btc_session');
  },

  restore() {
    const id = localStorage.getItem('btc_session');
    if (id) {
      const user = State.users.find(u => u.id === id);
      if (user) State.currentUser = user;
    }
  },

  _hash(str) {
    // Simple hash for demo (NOT for production!)
    let h = 0;
    for (let i = 0; i < str.length; i++) {
      h = ((h << 5) - h) + str.charCodeAt(i);
      h |= 0;
    }
    return h.toString(36);
  },
};

/* ════════════════════════════════════════════════════════════
   TRADING ENGINE
   ════════════════════════════════════════════════════════════ */
const FEE_RATE = 0.001; // 0.1%

const Trading = {
  placeMarketOrder(side, quantity, stopLoss, takeProfit) {
    const price = State.btcPrice;
    if (!price) throw new Error('No price data');

    const portfolio = State.portfolio;
    const fee = price * quantity * FEE_RATE;
    const cost = price * quantity;
    const totalCost = cost + fee;

    if (side === 'buy' && portfolio.balance < totalCost) {
      throw new Error(`Insufficient balance. Need $${totalCost.toFixed(2)}, have $${portfolio.balance.toFixed(2)}`);
    }

    const position = {
      id: 'pos_' + Date.now(),
      side: side === 'buy' ? 'long' : 'short',
      entryPrice: price,
      quantity,
      stopLoss: stopLoss || null,
      takeProfit: takeProfit || null,
      fee,
      createdAt: Date.now(),
      status: 'open',
    };

    portfolio.positions.push(position);
    portfolio.orders.push({
      id: 'ord_' + Date.now(),
      positionId: position.id,
      type: 'market',
      side,
      quantity,
      filledPrice: price,
      fee,
      status: 'filled',
      createdAt: Date.now(),
      filledAt: Date.now(),
    });

    if (side === 'buy') {
      portfolio.balance -= totalCost;
    }

    State._savePortfolio(portfolio);
    return { position, price, fee };
  },

  placeLimitOrder(side, quantity, limitPrice, stopLoss, takeProfit) {
    const portfolio = State.portfolio;
    const fee = limitPrice * quantity * FEE_RATE;

    const order = {
      id: 'ord_' + Date.now(),
      type: 'limit',
      side,
      quantity,
      price: limitPrice,
      stopLoss: stopLoss || null,
      takeProfit: takeProfit || null,
      fee,
      status: 'pending',
      createdAt: Date.now(),
    };

    portfolio.orders.push(order);
    State._savePortfolio(portfolio);
    return order;
  },

  closePosition(positionId) {
    const portfolio = State.portfolio;
    const pos = portfolio.positions.find(p => p.id === positionId);
    if (!pos) throw new Error('Position not found');

    const price = State.btcPrice;
    const closeFee = price * pos.quantity * FEE_RATE;

    let pnl;
    if (pos.side === 'long') {
      pnl = (price - pos.entryPrice) * pos.quantity - pos.fee - closeFee;
    } else {
      pnl = (pos.entryPrice - price) * pos.quantity - pos.fee - closeFee;
    }

    const entryVal = pos.entryPrice * pos.quantity;
    const pnlPercent = (pnl / entryVal) * 100;

    // Return funds
    if (pos.side === 'long') {
      portfolio.balance += Math.max(0, price * pos.quantity - closeFee);
    } else {
      portfolio.balance += Math.max(0, entryVal + pnl);
    }

    // Close position
    pos.status = 'closed';

    // Record trade
    const trade = {
      id: 'trd_' + Date.now(),
      side: pos.side,
      entryPrice: pos.entryPrice,
      exitPrice: price,
      quantity: pos.quantity,
      pnl,
      pnlPercent,
      fee: pos.fee + closeFee,
      duration: Math.floor((Date.now() - pos.createdAt) / 1000),
      createdAt: Date.now(),
    };
    portfolio.trades.push(trade);

    // Remove from active positions
    portfolio.positions = portfolio.positions.filter(p => p.id !== positionId);

    // Update equity curve
    portfolio.equityCurve.push({ timestamp: Date.now(), balance: portfolio.balance });
    if (portfolio.equityCurve.length > 500) portfolio.equityCurve.shift();

    // Peak tracking
    if (portfolio.balance > portfolio.peakBalance) {
      portfolio.peakBalance = portfolio.balance;
    }

    State._savePortfolio(portfolio);
    return { pnl, pnlPercent, price, trade };
  },

  cancelOrder(orderId) {
    const portfolio = State.portfolio;
    const order = portfolio.orders.find(o => o.id === orderId);
    if (!order || order.status !== 'pending') throw new Error('Order not cancellable');
    order.status = 'cancelled';
    State._savePortfolio(portfolio);
  },

  checkTriggers(price) {
    if (!State.currentUser) return;
    const portfolio = State.portfolio;
    let changed = false;

    // Check pending limit orders
    portfolio.orders.filter(o => o.status === 'pending').forEach(order => {
      let shouldFill = false;
      if (order.side === 'buy' && price <= order.price) shouldFill = true;
      if (order.side === 'sell' && price >= order.price) shouldFill = true;

      if (shouldFill) {
        const pos = {
          id: 'pos_' + Date.now(),
          side: order.side === 'buy' ? 'long' : 'short',
          entryPrice: price,
          quantity: order.quantity,
          stopLoss: order.stopLoss || null,
          takeProfit: order.takeProfit || null,
          fee: price * order.quantity * FEE_RATE,
          createdAt: Date.now(),
          status: 'open',
        };

        portfolio.positions.push(pos);
        order.status = 'filled';
        order.filledPrice = price;
        order.filledAt = Date.now();
        order.positionId = pos.id;

        if (order.side === 'buy') {
          portfolio.balance -= (price * order.quantity + pos.fee);
        }

        Toast.show('success', 'Limit Order Filled', `${order.side.toUpperCase()} ${order.quantity.toFixed(5)} BTC @ $${price.toLocaleString()}`);
        changed = true;
      }
    });

    // Check SL/TP
    [...portfolio.positions].forEach(pos => {
      let shouldClose = false, reason = '';

      if (pos.stopLoss) {
        if (pos.side === 'long' && price <= pos.stopLoss) { shouldClose = true; reason = 'Stop Loss'; }
        if (pos.side === 'short' && price >= pos.stopLoss) { shouldClose = true; reason = 'Stop Loss'; }
      }
      if (pos.takeProfit && !shouldClose) {
        if (pos.side === 'long' && price >= pos.takeProfit) { shouldClose = true; reason = 'Take Profit'; }
        if (pos.side === 'short' && price <= pos.takeProfit) { shouldClose = true; reason = 'Take Profit'; }
      }

      if (shouldClose) {
        try {
          const result = this.closePosition(pos.id);
          const isProfit = result.pnl >= 0;
          Toast.show(
            isProfit ? 'success' : 'warn',
            `${reason} Triggered`,
            `PnL: ${isProfit ? '+' : ''}$${result.pnl.toFixed(2)} (${result.pnlPercent.toFixed(2)}%)`
          );
          changed = true;
        } catch (e) {}
      }
    });

    if (changed) {
      UI.refreshPortfolio();
      UI.updateSummaryBar();
    }
  },

  getPerformanceStats() {
    const portfolio = State.portfolio;
    if (!portfolio) return null;

    const trades = portfolio.trades || [];
    const totalTrades = trades.length;
    const wins = trades.filter(t => t.pnl > 0);
    const losses = trades.filter(t => t.pnl <= 0);
    const totalPnl = trades.reduce((s, t) => s + t.pnl, 0);
    const winRate = totalTrades > 0 ? (wins.length / totalTrades) * 100 : 0;
    const avgWin = wins.length > 0 ? wins.reduce((s, t) => s + t.pnl, 0) / wins.length : 0;
    const avgLoss = losses.length > 0 ? losses.reduce((s, t) => s + t.pnl, 0) / losses.length : 0;
    const unrealizedPnl = this._calcUnrealizedPnl();
    const equity = portfolio.balance + unrealizedPnl;

    // Max drawdown
    let peak = 10000, maxDD = 0;
    portfolio.equityCurve.forEach(p => {
      if (p.balance > peak) peak = p.balance;
      const dd = peak > 0 ? ((peak - p.balance) / peak) * 100 : 0;
      if (dd > maxDD) maxDD = dd;
    });

    return {
      totalTrades,
      winRate,
      totalPnl,
      totalPnlPercent: ((equity - 10000) / 10000) * 100,
      maxDrawdown: maxDD,
      avgWin,
      avgLoss,
      equity,
      unrealizedPnl,
      equityCurve: portfolio.equityCurve,
    };
  },

  _calcUnrealizedPnl() {
    const portfolio = State.portfolio;
    if (!portfolio || !State.btcPrice) return 0;
    return portfolio.positions.reduce((sum, pos) => {
      const pnl = pos.side === 'long'
        ? (State.btcPrice - pos.entryPrice) * pos.quantity - pos.fee
        : (pos.entryPrice - State.btcPrice) * pos.quantity - pos.fee;
      return sum + pnl;
    }, 0);
  },
};

/* ════════════════════════════════════════════════════════════
   TOAST NOTIFICATIONS
   ════════════════════════════════════════════════════════════ */
const Toast = {
  container: null,
  icons: { success: '✅', error: '❌', info: '💡', warn: '⚠️' },

  init() { this.container = document.getElementById('toast-container'); },

  show(type, title, message, duration = 4000) {
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.style.position = 'relative';
    toast.innerHTML = `
      <span class="toast-icon">${this.icons[type] || '💬'}</span>
      <div class="toast-body">
        <div class="toast-title">${title}</div>
        ${message ? `<div class="toast-msg">${message}</div>` : ''}
      </div>
      <div class="toast-progress"></div>
    `;
    this.container.appendChild(toast);
    requestAnimationFrame(() => {
      requestAnimationFrame(() => toast.classList.add('show'));
    });
    const timer = setTimeout(() => {
      toast.classList.add('hide');
      setTimeout(() => toast.remove(), 400);
    }, duration);
    toast.addEventListener('click', () => { clearTimeout(timer); toast.remove(); });
  },
};

/* ════════════════════════════════════════════════════════════
   UI CONTROLLER
   ════════════════════════════════════════════════════════════ */
const UI = {
  chart: null,
  equityChart: null,
  backtestChart: null,

  init() {
    // Setup chart
    this.chart = new CandleChart('tradingChart');
    this.chart.onCrosshairMove = (candle) => this._updateCrosshairInfo(candle);

    // Setup equity chart
    this.equityChart = new EquityChart('equityChart');

    // Backtesting chart
    this.backtestChart = new CandleChart('backtestChart');

    // Events
    this._bindNavEvents();
    this._bindOrderFormEvents();
    this._bindModalEvents();

    // Load initial data
    this._loadChart('1h');
    Market.fetch24hTicker();
    setInterval(() => Market.fetch24hTicker(), 60000);

    // Refresh portfolio display
    this.refreshPortfolio();
    this.updateSummaryBar();
  },

  /* ── Navigation ─────────────────────────────────────────── */
  _bindNavEvents() {
    document.querySelectorAll('.nav-link[data-page]').forEach(btn => {
      btn.addEventListener('click', () => this.showPage(btn.dataset.page));
    });

    document.querySelectorAll('.interval-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.interval-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        State.currentInterval = btn.dataset.interval;
        this._loadChart(btn.dataset.interval);
      });
    });
  },

  showPage(page) {
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
    document.querySelectorAll('.nav-link[data-page]').forEach(b => b.classList.remove('active'));

    document.getElementById(`page-${page}`)?.classList.add('active');
    document.querySelector(`.nav-link[data-page="${page}"]`)?.classList.add('active');
    State.activePage = page;

    if (page === 'performance') this._renderPerformance();
    if (page === 'leaderboard') this._renderLeaderboard();
    if (page === 'backtest') this._initBacktest();
  },

  /* ── Price / Ticker ─────────────────────────────────────── */
  updatePrice(price, prevPrice) {
    const el = document.getElementById('tickerPrice');
    if (!el) return;

    const formatted = '$' + price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    el.textContent = formatted;

    if (prevPrice) {
      el.classList.remove('up', 'down');
      void el.offsetWidth;
      el.classList.add(price > prevPrice ? 'up' : price < prevPrice ? 'down' : '');
    }

    // Update current candle in chart
    if (State.candles[State.currentInterval]?.length) {
      const candles = State.candles[State.currentInterval];
      const last = candles[candles.length - 1];
      if (last) {
        const intervalMs = { '1m': 60, '5m': 300, '15m': 900, '1h': 3600, '4h': 14400, '1d': 86400 };
        const ivSec = intervalMs[State.currentInterval] || 3600;
        const nowSec = Math.floor(Date.now() / 1000);
        const candleTime = Math.floor(nowSec / ivSec) * ivSec;

        if (last.time === candleTime) {
          last.close = price;
          last.high = Math.max(last.high, price);
          last.low = Math.min(last.low, price);
          this.chart.updateLastCandle({ ...last });
        } else if (nowSec >= candleTime) {
          const newCandle = { time: candleTime, open: price, high: price, low: price, close: price, volume: 0 };
          candles.push(newCandle);
          this.chart.updateLastCandle(newCandle);
        }
      }
    }

    // Update summary
    this.updateSummaryBar();
  },

  updateTicker() {
    const t = State.ticker24h;
    const isPos = t.changePercent >= 0;
    const sign = isPos ? '+' : '';

    const set = (id, val, cls) => {
      const el = document.getElementById(id);
      if (!el) return;
      el.textContent = val;
      el.className = 'stat-val' + (cls ? ` ${cls}` : '');
    };

    set('ticker24Change', `${sign}$${Math.abs(t.change).toFixed(2)} (${sign}${t.changePercent.toFixed(2)}%)`, isPos ? 'up' : 'down');
    set('ticker24High', `$${t.high.toLocaleString()}`);
    set('ticker24Low', `$${t.low.toLocaleString()}`);
    set('tickerVolume', `${(t.volume / 1000).toFixed(1)}K BTC`);
  },

  updateConnStatus(connected) {
    const dot = document.getElementById('connDot');
    const label = document.getElementById('connLabel');
    if (!dot) return;
    dot.className = `conn-dot ${connected ? 'live' : 'offline'}`;
    if (label) label.textContent = connected ? 'Live' : 'Offline';
  },

  /* ── Chart Loading ──────────────────────────────────────── */
  async _loadChart(interval) {
    const loadingEl = document.getElementById('chartLoading');
    if (loadingEl) loadingEl.style.display = 'flex';

    if (!State.candles[interval]) {
      const candles = await Market.fetchKlines(interval, 500);
      State.candles[interval] = candles;
    }

    this.chart.setData(State.candles[interval]);
    if (loadingEl) loadingEl.style.display = 'none';
  },

  _updateCrosshairInfo(candle) {
    const el = document.getElementById('crosshairInfo');
    if (!el) return;

    if (!candle) {
      el.classList.remove('visible');
      return;
    }

    el.classList.add('visible');
    document.getElementById('xhOpen').textContent = '$' + candle.open.toFixed(2);
    document.getElementById('xhHigh').textContent = '$' + candle.high.toFixed(2);
    document.getElementById('xhLow').textContent = '$' + candle.low.toFixed(2);
    document.getElementById('xhClose').textContent = '$' + candle.close.toFixed(2);
    document.getElementById('xhVol').textContent = (candle.volume / 1000).toFixed(2) + 'K';
  },

  /* ── Order Form ─────────────────────────────────────────── */
  _bindOrderFormEvents() {
    // Order type tabs
    document.querySelectorAll('.order-type-tab').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.order-type-tab').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        State.orderType = btn.dataset.type;
        document.getElementById('limitPriceGroup').style.display = btn.dataset.type === 'limit' ? 'flex' : 'none';
      });
    });

    // Buy/Sell toggle
    document.querySelectorAll('.side-toggle-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.side-toggle-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        State.orderSide = btn.dataset.side;
        const submitBtn = document.getElementById('orderSubmitBtn');
        if (submitBtn) {
          submitBtn.className = `btn-submit ${State.orderSide}`;
          submitBtn.textContent = State.orderSide === 'buy' ? '⚡ Buy BTC' : '⚡ Sell BTC';
        }
      });
    });

    // Percent buttons
    document.querySelectorAll('.pct-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const pct = parseFloat(btn.dataset.pct);
        const portfolio = State.portfolio;
        if (!portfolio) return;
        const price = State.btcPrice || 43000;

        if (State.inputMode === 'usdt') {
          const amount = (portfolio.balance * pct).toFixed(2);
          document.getElementById('inputAmountUsdt').value = amount;
          const qty = (portfolio.balance * pct) / price;
          document.getElementById('inputAmountBtc').value = qty.toFixed(6);
        } else {
          const amount = (portfolio.balance * pct) / price;
          document.getElementById('inputAmountBtc').value = amount.toFixed(6);
          document.getElementById('inputAmountUsdt').value = (portfolio.balance * pct).toFixed(2);
        }
        this._updateOrderSummary();
      });
    });

    // Input mode buttons
    document.querySelectorAll('.mode-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.mode-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        State.inputMode = btn.dataset.mode;

        const btcWrap = document.getElementById('btcInputWrap');
        const usdtWrap = document.getElementById('usdtInputWrap');

        if (State.inputMode === 'btc') {
          btcWrap.style.display = 'block';
          usdtWrap.style.display = 'none';
        } else {
          btcWrap.style.display = 'none';
          usdtWrap.style.display = 'block';
        }
      });
    });

    // Input sync
    const btcInput = document.getElementById('inputAmountBtc');
    const usdtInput = document.getElementById('inputAmountUsdt');

    btcInput?.addEventListener('input', () => {
      const btc = parseFloat(btcInput.value) || 0;
      const price = State.btcPrice || 43000;
      usdtInput.value = (btc * price).toFixed(2);
      this._updateOrderSummary();
    });

    usdtInput?.addEventListener('input', () => {
      const usdt = parseFloat(usdtInput.value) || 0;
      const price = State.btcPrice || 43000;
      btcInput.value = (usdt / price).toFixed(6);
      this._updateOrderSummary();
    });

    // Submit
    document.getElementById('orderSubmitBtn')?.addEventListener('click', () => this._submitOrder());

    // Collapsible SL/TP
    document.getElementById('slTpToggle')?.addEventListener('click', () => {
      const el = document.getElementById('slTpToggle');
      const body = document.getElementById('slTpBody');
      el.classList.toggle('open');
      body.classList.toggle('open');
    });

    // Panel tabs
    document.querySelectorAll('.panel-tab').forEach(tab => {
      tab.addEventListener('click', () => {
        document.querySelectorAll('.panel-tab').forEach(t => t.classList.remove('active'));
        document.querySelectorAll('.panel-content').forEach(p => p.classList.remove('active'));
        tab.classList.add('active');
        document.getElementById(`panel-${tab.dataset.tab}`)?.classList.add('active');
      });
    });
  },

  _updateOrderSummary() {
    const btc = parseFloat(document.getElementById('inputAmountBtc')?.value) || 0;
    const price = parseFloat(document.getElementById('inputLimitPrice')?.value) || State.btcPrice || 0;
    const cost = btc * price;
    const fee = cost * FEE_RATE;
    const total = cost + fee;

    const sumBox = document.getElementById('orderSummaryBox');
    if (!sumBox) return;

    if (btc > 0 && price > 0) {
      sumBox.style.display = 'flex';
      document.getElementById('sumBtc').textContent = btc.toFixed(6) + ' BTC';
      document.getElementById('sumValue').textContent = '$' + cost.toFixed(2);
      document.getElementById('sumFee').textContent = '$' + fee.toFixed(4);
      document.getElementById('sumTotal').textContent = '$' + total.toFixed(2);
    } else {
      sumBox.style.display = 'none';
    }
  },

  _submitOrder() {
    if (!State.currentUser) {
      UI.openAuthModal();
      return;
    }

    const btcQty = parseFloat(document.getElementById('inputAmountBtc')?.value) || 0;
    if (btcQty <= 0) { Toast.show('error', 'Invalid Amount', 'Enter a quantity'); return; }

    const stopLoss = parseFloat(document.getElementById('inputStopLoss')?.value) || null;
    const takeProfit = parseFloat(document.getElementById('inputTakeProfit')?.value) || null;

    const submitBtn = document.getElementById('orderSubmitBtn');
    if (submitBtn) { submitBtn.disabled = true; }

    try {
      if (State.orderType === 'market') {
        const result = Trading.placeMarketOrder(State.orderSide, btcQty, stopLoss, takeProfit);
        const side = State.orderSide === 'buy' ? '🟢 Bought' : '🔴 Sold';
        Toast.show('success', `${side} ${btcQty.toFixed(5)} BTC`, `@ $${result.price.toLocaleString()} · Fee: $${result.fee.toFixed(2)}`);
      } else {
        const limitPrice = parseFloat(document.getElementById('inputLimitPrice')?.value);
        if (!limitPrice) { Toast.show('error', 'Missing Price', 'Enter a limit price'); return; }
        Trading.placeLimitOrder(State.orderSide, btcQty, limitPrice, stopLoss, takeProfit);
        Toast.show('info', 'Limit Order Placed', `${btcQty.toFixed(5)} BTC @ $${limitPrice.toLocaleString()}`);
      }

      // Reset form
      ['inputAmountBtc', 'inputAmountUsdt', 'inputStopLoss', 'inputTakeProfit'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.value = '';
      });
      document.getElementById('orderSummaryBox').style.display = 'none';
      this.refreshPortfolio();
      this.updateSummaryBar();
    } catch (e) {
      Toast.show('error', 'Order Failed', e.message);
    } finally {
      if (submitBtn) {
        setTimeout(() => { submitBtn.disabled = false; }, 800);
      }
    }
  },

  /* ── Portfolio Display ──────────────────────────────────── */
  updateSummaryBar() {
    const portfolio = State.portfolio;
    if (!portfolio) {
      ['sumBalance', 'sumEquity', 'sumUnrealized', 'sumWinRate'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.textContent = '—';
      });
      return;
    }

    const unrealized = Trading._calcUnrealizedPnl();
    const equity = portfolio.balance + unrealized;
    const totalPnl = equity - 10000;
    const totalPnlPct = (totalPnl / 10000) * 100;

    const stats = Trading.getPerformanceStats();

    this._setEl('sumBalance', '$' + portfolio.balance.toFixed(2), null);
    this._setEl('sumEquity', '$' + equity.toFixed(2), totalPnl >= 0 ? 'positive' : 'negative');
    this._setEl('sumEqSub', `${totalPnl >= 0 ? '+' : ''}$${totalPnl.toFixed(2)} (${totalPnlPct.toFixed(2)}%)`, totalPnl >= 0 ? 'positive' : 'negative');
    this._setEl('sumUnrealized', `${unrealized >= 0 ? '+' : ''}$${unrealized.toFixed(2)}`, unrealized >= 0 ? 'positive' : 'negative');
    this._setEl('sumUnrealSub', `${portfolio.positions.length} open position${portfolio.positions.length !== 1 ? 's' : ''}`, null);
    this._setEl('sumWinRate', stats ? `${stats.winRate.toFixed(1)}%` : '0%', null);
    this._setEl('sumWinRateSub', stats ? `${stats.totalTrades} trades` : '0 trades', null);

    // Update navbar balance chip
    const balChip = document.getElementById('navBalance');
    if (balChip) balChip.textContent = '$' + portfolio.balance.toFixed(2);
  },

  _setEl(id, text, cls) {
    const el = document.getElementById(id);
    if (!el) return;
    el.textContent = text;
    if (cls !== null) {
      el.className = `summary-value${cls ? ` ${cls}` : ''}`;
    }
  },

  refreshPortfolio() {
    this._renderPositions();
    this._renderOrders();
    this._renderTrades();
    this.updateSummaryBar();

    // Update tab counts
    const portfolio = State.portfolio;
    if (portfolio) {
      const posCount = document.getElementById('posCount');
      const ordCount = document.getElementById('ordCount');
      if (posCount) posCount.textContent = portfolio.positions.length;
      if (ordCount) ordCount.textContent = portfolio.orders.filter(o => o.status === 'pending').length;
    }
  },

  _renderPositions() {
    const el = document.getElementById('positionsBody');
    if (!el) return;
    const portfolio = State.portfolio;

    if (!portfolio?.positions.length) {
      el.innerHTML = `<tr><td colspan="10"><div class="empty-state"><div class="empty-icon">📭</div><div class="empty-text">No open positions</div></div></td></tr>`;
      return;
    }

    el.innerHTML = portfolio.positions.map(pos => {
      const price = State.btcPrice || pos.entryPrice;
      const pnl = pos.side === 'long'
        ? (price - pos.entryPrice) * pos.quantity - pos.fee
        : (pos.entryPrice - price) * pos.quantity - pos.fee;
      const pnlPct = (pnl / (pos.entryPrice * pos.quantity)) * 100;
      const isPos = pnl >= 0;

      return `<tr>
        <td>BTC/USDT</td>
        <td><span class="side-badge ${pos.side}">${pos.side.toUpperCase()}</span></td>
        <td class="mono">$${pos.entryPrice.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
        <td class="mono cell-highlight">$${price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
        <td class="mono">${pos.quantity.toFixed(6)}</td>
        <td class="mono ${isPos ? 'cell-positive' : 'cell-negative'}">${isPos ? '+' : ''}$${pnl.toFixed(2)}</td>
        <td class="mono ${isPos ? 'cell-positive' : 'cell-negative'}">${isPos ? '+' : ''}${pnlPct.toFixed(2)}%</td>
        <td class="mono">${pos.stopLoss ? '$' + pos.stopLoss.toLocaleString() : '—'}</td>
        <td class="mono">${pos.takeProfit ? '$' + pos.takeProfit.toLocaleString() : '—'}</td>
        <td><button class="tbl-btn tbl-btn-close" onclick="App.closePosition('${pos.id}')">Close</button></td>
      </tr>`;
    }).join('');
  },

  _renderOrders() {
    const el = document.getElementById('ordersBody');
    if (!el) return;
    const portfolio = State.portfolio;
    const orders = portfolio?.orders.filter(o => o.status !== 'cancelled').slice().reverse() || [];

    if (!orders.length) {
      el.innerHTML = `<tr><td colspan="8"><div class="empty-state"><div class="empty-icon">📋</div><div class="empty-text">No orders</div></div></td></tr>`;
      return;
    }

    el.innerHTML = orders.map(o => `<tr>
      <td>BTC/USDT</td>
      <td class="mono">${o.type.charAt(0).toUpperCase() + o.type.slice(1)}</td>
      <td><span class="side-badge ${o.side === 'buy' ? 'long' : 'short'}">${o.side.toUpperCase()}</span></td>
      <td class="mono">${o.price ? '$' + o.price.toLocaleString() : 'Market'}</td>
      <td class="mono">${o.filledPrice ? '$' + o.filledPrice.toLocaleString() : '—'}</td>
      <td class="mono">${o.quantity.toFixed(6)}</td>
      <td><span class="status-badge ${o.status}">${o.status}</span></td>
      <td>${o.status === 'pending' ? `<button class="tbl-btn tbl-btn-cancel" onclick="App.cancelOrder('${o.id}')">Cancel</button>` : ''}</td>
    </tr>`).join('');
  },

  _renderTrades() {
    const el = document.getElementById('tradesBody');
    if (!el) return;
    const portfolio = State.portfolio;
    const trades = portfolio?.trades.slice().reverse() || [];

    if (!trades.length) {
      el.innerHTML = `<tr><td colspan="9"><div class="empty-state"><div class="empty-icon">📊</div><div class="empty-text">No closed trades yet</div></div></td></tr>`;
      return;
    }

    el.innerHTML = trades.map(t => {
      const isPos = t.pnl >= 0;
      const dur = t.duration < 60 ? `${t.duration}s`
        : t.duration < 3600 ? `${Math.floor(t.duration / 60)}m`
        : `${Math.floor(t.duration / 3600)}h`;
      const date = new Date(t.createdAt);
      const dateStr = `${String(date.getMonth()+1).padStart(2,'0')}/${String(date.getDate()).padStart(2,'0')} ${String(date.getHours()).padStart(2,'0')}:${String(date.getMinutes()).padStart(2,'0')}`;

      return `<tr>
        <td>BTC/USDT</td>
        <td><span class="side-badge ${t.side}">${t.side.toUpperCase()}</span></td>
        <td class="mono">$${t.entryPrice.toLocaleString()}</td>
        <td class="mono">$${t.exitPrice.toLocaleString()}</td>
        <td class="mono">${t.quantity.toFixed(6)}</td>
        <td class="mono ${isPos ? 'cell-positive' : 'cell-negative'}">${isPos ? '+' : ''}$${t.pnl.toFixed(2)}</td>
        <td class="mono ${isPos ? 'cell-positive' : 'cell-negative'}">${isPos ? '+' : ''}${t.pnlPercent.toFixed(2)}%</td>
        <td class="mono">$${t.fee.toFixed(4)}</td>
        <td class="mono">${dur}</td>
        <td class="mono" style="color:var(--text-3)">${dateStr}</td>
      </tr>`;
    }).join('');
  },

  /* ── Performance Page ───────────────────────────────────── */
  _renderPerformance() {
    const stats = Trading.getPerformanceStats();
    if (!stats) return;

    const fmt = (v, prefix='$') => prefix + Math.abs(v).toFixed(2);
    const setPerf = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
    const setClass = (id, cls) => { const el = document.getElementById(id); if (el) el.className = `perf-card-value ${cls}`; };

    const isProfit = stats.totalPnl >= 0;
    setPerf('perfTotalPnl', `${isProfit ? '+' : '-'}${fmt(stats.totalPnl)}`);
    setClass('perfTotalPnl', isProfit ? 'positive' : 'negative');

    setPerf('perfWinRate', stats.winRate.toFixed(1) + '%');
    setPerf('perfMaxDD', stats.maxDrawdown.toFixed(2) + '%');
    setClass('perfMaxDD', 'negative');
    setPerf('perfTrades', stats.totalTrades);

    const avgWin = stats.avgWin;
    const avgLoss = stats.avgLoss;
    setPerf('perfAvgWin', `+$${avgWin.toFixed(2)}`);
    setClass('perfAvgWin', 'positive');
    setPerf('perfAvgLoss', `-$${Math.abs(avgLoss).toFixed(2)}`);
    setClass('perfAvgLoss', 'negative');
    setPerf('perfEquity', `$${stats.equity.toFixed(2)}`);
    setPerf('perfReturn', `${stats.totalPnlPercent >= 0 ? '+' : ''}${stats.totalPnlPercent.toFixed(2)}%`);
    setClass('perfReturn', stats.totalPnlPercent >= 0 ? 'positive' : 'negative');

    // Equity curve
    if (this.equityChart) {
      this.equityChart.setData(stats.equityCurve);
    }
  },

  /* ── Leaderboard ────────────────────────────────────────── */
  _renderLeaderboard() {
    const el = document.getElementById('leaderboardBody');
    if (!el) return;

    // Gather all users stats
    const entries = State.users.map((u, i) => {
      const portfolio = State._getPortfolio(u.id);
      const unrealized = 0; // Simplified for leaderboard
      const equity = portfolio.balance + unrealized;
      const totalPnl = equity - 10000;
      const totalReturn = (totalPnl / 10000) * 100;
      const trades = portfolio.trades || [];
      const wins = trades.filter(t => t.pnl > 0).length;
      const winRate = trades.length > 0 ? (wins / trades.length) * 100 : 0;

      return { user: u, equity, totalPnl, totalReturn, trades: trades.length, winRate };
    }).sort((a, b) => b.equity - a.equity);

    const colors = [
      'linear-gradient(135deg,#e8b84b,#b8872a)',
      'linear-gradient(135deg,#b0b8c8,#7a8799)',
      'linear-gradient(135deg,#c87941,#a05830)',
    ];
    const rankClasses = ['gold', 'silver', 'bronze'];

    el.innerHTML = entries.map((entry, i) => {
      const rank = i + 1;
      const isMe = State.currentUser?.id === entry.user.id;
      const color = colors[i] || 'linear-gradient(135deg,#4b9bff,#2563eb)';
      const isProfit = entry.totalPnl >= 0;

      return `<div class="lb-row ${isMe ? 'style="background:rgba(232,184,75,0.04)"' : ''}">
        <div class="lb-rank ${rankClasses[i] || ''}">${rank <= 3 ? ['🥇','🥈','🥉'][rank-1] : rank}</div>
        <div class="lb-user">
          <div class="lb-avatar" style="background:${color}">${entry.user.username[0].toUpperCase()}</div>
          <span class="lb-username">${entry.user.username}</span>
          ${isMe ? '<span class="lb-you">You</span>' : ''}
        </div>
        <div class="lb-cell">$${entry.equity.toFixed(2)}</div>
        <div class="lb-cell ${isProfit ? 'positive' : 'negative'}">${isProfit ? '+' : ''}$${entry.totalPnl.toFixed(2)}</div>
        <div class="lb-cell ${isProfit ? 'positive' : 'negative'}">${isProfit ? '+' : ''}${entry.totalReturn.toFixed(2)}%</div>
        <div class="lb-cell">${entry.trades}</div>
        <div class="lb-cell">${entry.winRate.toFixed(1)}%</div>
      </div>`;
    }).join('');

    if (!entries.length) {
      el.innerHTML = `<div class="empty-state"><div class="empty-icon">🏆</div><div class="empty-text">No traders yet. Be the first!</div></div>`;
    }
  },

  /* ── Backtesting ────────────────────────────────────────── */
  async _initBacktest() {
    // Setup backtest chart
    const dateEl = document.getElementById('btDatePicker');
    const loadBtn = document.getElementById('btLoadBtn');

    loadBtn?.addEventListener('click', async () => {
      const dateStr = dateEl?.value;
      if (!dateStr) { Toast.show('error', 'Select a Date', 'Pick a date to start backtesting'); return; }

      const endTime = new Date(dateStr).getTime() + 86400000;
      Toast.show('info', 'Loading Historical Data', `Loading BTC data for ${dateStr}...`);

      const candles = await Market.fetchKlines('1h', 200, endTime);
      this.backtestChart.setData(candles);
      document.getElementById('btDateDisplay').textContent = dateStr;
    });

    // Set default date (6 months ago)
    const sixMonthsAgo = new Date(Date.now() - 180 * 86400000);
    if (dateEl) {
      dateEl.max = new Date(Date.now() - 86400000).toISOString().split('T')[0];
      dateEl.value = sixMonthsAgo.toISOString().split('T')[0];
    }
  },

  /* ── Auth Modal ─────────────────────────────────────────── */
  openAuthModal() {
    document.getElementById('authModal')?.classList.add('open');
  },

  closeAuthModal() {
    document.getElementById('authModal')?.classList.remove('open');
  },

  _bindModalEvents() {
    // Close on overlay click
    document.getElementById('authModal')?.addEventListener('click', (e) => {
      if (e.target === document.getElementById('authModal')) this.closeAuthModal();
    });

    document.getElementById('modalCloseBtn')?.addEventListener('click', () => this.closeAuthModal());

    // Mode toggle
    document.querySelectorAll('.modal-mode-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.modal-mode-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        const mode = btn.dataset.mode;
        document.getElementById('registerFields').style.display = mode === 'register' ? 'contents' : 'none';
        document.getElementById('authSubmitBtn').textContent = mode === 'login'
          ? 'Sign In'
          : 'Create Account — Start with $10,000';
        document.getElementById('authHint').style.display = mode === 'register' ? 'block' : 'none';
      });
    });

    // Form submit
    document.getElementById('authForm')?.addEventListener('submit', (e) => {
      e.preventDefault();
      const mode = document.querySelector('.modal-mode-btn.active')?.dataset.mode || 'login';
      const email = document.getElementById('authEmail').value;
      const password = document.getElementById('authPassword').value;
      const username = document.getElementById('authUsername')?.value;

      try {
        if (mode === 'login') {
          Auth.login(email, password);
          Toast.show('success', 'Welcome Back!', `Logged in as ${State.currentUser.username} 🚀`);
        } else {
          Auth.register(email, username, password);
          Toast.show('success', 'Account Created!', `Starting balance: $10,000 🎉`);
        }
        this.closeAuthModal();
        this._onAuthChange();
      } catch (e) {
        Toast.show('error', 'Auth Error', e.message);
      }
    });

    // Nav login btn
    document.getElementById('navAuthBtn')?.addEventListener('click', () => this.openAuthModal());

    // User menu
    document.getElementById('userBtn')?.addEventListener('click', (e) => {
      e.stopPropagation();
      document.getElementById('userDropdown')?.classList.toggle('open');
    });

    document.addEventListener('click', () => {
      document.getElementById('userDropdown')?.classList.remove('open');
    });

    document.getElementById('logoutBtn')?.addEventListener('click', () => {
      Auth.logout();
      this._onAuthChange();
      Toast.show('info', 'Signed Out', 'See you next time!');
    });
  },

  _onAuthChange() {
    const isAuth = !!State.currentUser;
    document.getElementById('navAuthBtn').style.display = isAuth ? 'none' : 'block';
    document.getElementById('userSection').style.display = isAuth ? 'flex' : 'none';

    if (isAuth) {
      document.getElementById('userInitial').textContent = State.currentUser.username[0].toUpperCase();
      document.getElementById('userName').textContent = State.currentUser.username;
    }

    this.refreshPortfolio();
    this.updateSummaryBar();
  },
};

/* ════════════════════════════════════════════════════════════
   APP ACTIONS (called from HTML)
   ════════════════════════════════════════════════════════════ */
const App = {
  closePosition(positionId) {
    try {
      const result = Trading.closePosition(positionId);
      const isProfit = result.pnl >= 0;
      Toast.show(
        isProfit ? 'success' : 'warn',
        'Position Closed',
        `PnL: ${isProfit ? '+' : ''}$${result.pnl.toFixed(2)} (${result.pnlPercent.toFixed(2)}%)`
      );
      UI.refreshPortfolio();
      UI.updateSummaryBar();
    } catch (e) {
      Toast.show('error', 'Error', e.message);
    }
  },

  cancelOrder(orderId) {
    try {
      Trading.cancelOrder(orderId);
      Toast.show('info', 'Order Cancelled', '');
      UI.refreshPortfolio();
    } catch (e) {
      Toast.show('error', 'Error', e.message);
    }
  },
};

/* ════════════════════════════════════════════════════════════
   BOOTSTRAP
   ════════════════════════════════════════════════════════════ */
document.addEventListener('DOMContentLoaded', () => {
  Toast.init();
  Auth.restore();

  UI.init();
  UI._onAuthChange();

  Market.connect();

  // Keep portfolio updated every second
  setInterval(() => {
    if (State.currentUser) {
      UI._renderPositions();
      UI.updateSummaryBar();
    }
  }, 2000);
});
