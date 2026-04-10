# ChatApp Web Version — Setup Guide

No app to install! Friends just open a link in their browser.

---

## Setup (you only do this once)

### Requirements
- Node.js 18+ → https://nodejs.org

### Start the server

```bash
cd server
npm install
npm start
```

You'll see:
```
✅ Chat server running at http://0.0.0.0:3000
```

---

## Share with friends

### Same Wi-Fi:
Find your IP with `ipconfig` (Windows) — share:
```
http://192.168.1.42:3000
```

### Different network (internet):
Use ngrok:
```bash
ngrok http 3000
```
Share the URL it gives you, like:
```
https://abc123.ngrok-free.app
```

Friends just open that link in Chrome/Firefox — no install needed!

---

## Features
- Real-time group chat
- Multiple rooms
- See who's online
- Typing indicators
- Voice calls (click Mic Off button)
- Works in any browser
