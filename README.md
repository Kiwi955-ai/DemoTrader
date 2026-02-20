# ₿ BTC Demo Trader — Frontend

Ein professionelles Bitcoin-Demo-Trading-Interface als reines HTML/CSS/Vanilla-JS Frontend.  
Kein Framework. Kein Build-Step. Einfach öffnen und traden.

---

## 📁 Dateistruktur

```
btc-trader-html/
├── index.html                  ← Hauptdatei (alle 4 Seiten)
├── assets/
│   ├── css/
│   │   └── style.css           ← Gesamtes Design-System (1.400+ Zeilen)
│   └── js/
│       ├── chart.js            ← Canvas Chart Engine (Candlestick + Equity)
│       └── app.js              ← App-Logik, State, Trading, Auth
└── README.md
```

---

## 🚀 Starten (kein Build nötig)

### Option 1: Direkt öffnen
```
Einfach index.html in einem Browser öffnen.
```

### Option 2: Lokaler Webserver (empfohlen für CORS)
```bash
# Python
python3 -m http.server 8080

# Node.js
npx serve .

# VS Code
"Live Server" Extension → Rechtsklick → Open with Live Server
```

Dann im Browser: **http://localhost:8080**

---

## ✨ Features

### 📈 Live-Daten
- **Echtzeit BTC-Preis** via Binance WebSocket (`wss://stream.binance.com`)
- **Candlestick Chart** mit Zoom (Mausrad) und Pan (Drag)
- **Intervalle**: 1m / 5m / 15m / 1h / 4h / 1d
- Crosshair mit OHLCV-Anzeige
- Automatischer Fallback auf Demo-Daten wenn offline

### 💼 Demo Wallet
- **Startkapital: $10.000 USDT** (virtuell)
- Persistenz via `localStorage` (bleibt nach Reload)
- Echtzeit Unrealized PnL berechnung

### 📋 Order-System
| Order-Typ | Beschreibung |
|-----------|-------------|
| **Market Order** | Sofortige Ausführung zum aktuellen Marktpreis |
| **Limit Order** | Ausführung automatisch wenn Preis erreicht wird |
| **Stop Loss** | Automatisches Schließen bei Verlust-Level |
| **Take Profit** | Automatische Gewinnmitnahme |

### 📊 Positionsverwaltung
- Long & Short Positionen
- Gebühren: 0,1% per Trade
- Order- & Trade-Historie
- Echtzeit PnL pro Position

### 📉 Analytics
- Equity-Kurve (Canvas Chart)
- Win Rate, Max Drawdown, Avg. Win/Loss
- Gesamt-PnL in $ und %

### 🏆 Leaderboard
- Alle registrierten User im Vergleich
- Sortiert nach Equity

### ⏪ Backtesting
- Historische BTC-Daten abrufbar (Binance API)
- Datum-Auswahl für vergangene Charts
- Kein Zugriff auf zukünftige Daten

---

## 🔐 Auth-System

- Registrierung mit E-Mail + Username + Passwort
- Login/Logout
- Session in `localStorage` gespeichert
- Multi-User-fähig (jeder User hat eigenes Portfolio)

> **Hinweis**: Dies ist ein Frontend-Demo. Passwörter sind **nicht sicher gehasht** (einfacher Hash für Demo). Für Produktion: Backend mit bcrypt erforderlich.

---

## 🎨 Design-Konzept

- **Ästhetik**: Terminal-Luxury · Dark Precision
- **Fonts**: IBM Plex Mono (Zahlen/UI) + DM Sans (Text)
- **Farben**: Mattschwarz, Gold-Akzente, Grün/Rot für PnL
- Inspiriert von Binance, TradingView, MetaTrader

---

## 🌐 Browser-Kompatibilität

| Browser | Status |
|---------|--------|
| Chrome 90+ | ✅ |
| Firefox 88+ | ✅ |
| Safari 14+ | ✅ |
| Edge 90+ | ✅ |

---

## 📌 Bekannte Einschränkungen (Frontend-only)

- Keine echte Authentifizierung (localStorage)
- Passwörter werden nicht sicher gehasht
- Keine persistente Server-Datenbank
- Binance WebSocket kann bei einigen VPNs/Netzwerken geblockt sein → Fallback auf Demo-Daten

Für ein vollständiges Produktionssystem: Backend mit Node.js/Express + PostgreSQL + JWT erforderlich.
