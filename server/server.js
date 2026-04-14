const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const fs = require('fs');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*', methods: ['GET', 'POST'] }
});

const PORT = process.env.PORT || 3000;
const HISTORY_FILE = path.join(__dirname, 'messages.json');
const USERS_FILE = path.join(__dirname, 'users.json');

// Serve the web client directly from the server
app.use(express.static(path.join(__dirname, 'public')));

let messageHistory = {};
let users = {};

try {
  if (fs.existsSync(HISTORY_FILE)) messageHistory = JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf8'));
  if (fs.existsSync(USERS_FILE)) users = JSON.parse(fs.readFileSync(USERS_FILE, 'utf8'));
} catch (e) { console.error('Error loading data:', e); }

function saveData() {
  try {
    fs.writeFileSync(HISTORY_FILE, JSON.stringify(messageHistory), 'utf8');
    fs.writeFileSync(USERS_FILE, JSON.stringify(users), 'utf8');
  } catch (e) { console.error('Error saving data:', e); }
}

io.on('connection', (socket) => {
  console.log(`[+] Connected: ${socket.id}`);

  socket.on('join', ({ username, room }) => {
    socket.username = username;
    socket.room = room;
    socket.join(room);
    if (users[username]) {
      users[username].lastOnline = Date.now();
      saveData();
    }
    if (!messageHistory[room]) messageHistory[room] = [];
    socket.emit('history', messageHistory[room]);
    socket.emit('rooms-list', Object.keys(messageHistory));
    broadcastUsers(room);
  });

  socket.on('signup', ({ username, email }) => {
    if (users[username]) return socket.emit('auth-error', 'Username already taken');
    const existing = Object.values(users).find(u => u.email === email);
    if (existing) return socket.emit('auth-error', 'Email already registered');
    
    users[username] = { username, email, contacts: [], pending: [], lastOnline: Date.now() };
    saveData();
    socket.emit('auth-success', users[username]);
  });

  socket.on('login', ({ email }) => {
    const user = Object.values(users).find(u => u.email === email);
    if (!user) return socket.emit('auth-error', 'No account found with this email');
    user.lastOnline = Date.now();
    saveData();
    socket.emit('auth-success', user);
  });

  socket.on('message', ({ text, room }) => {
    const targetRoom = room || socket.room;
    if (!targetRoom || !socket.username) return;
    const msg = { user: socket.username, text, time: new Date().toISOString() };
    if (!messageHistory[targetRoom]) messageHistory[targetRoom] = [];
    messageHistory[targetRoom].push(msg);
    if (messageHistory[targetRoom].length > 100) messageHistory[targetRoom].shift();
    saveData();
    io.to(targetRoom).emit('message', msg);
  });

  socket.on('typing', (isTyping) => {
    socket.to(socket.room).emit('typing', { user: socket.username, isTyping });
  });

  socket.on('search-users', (query) => {
    const lower = String(query || '').toLowerCase();
    const results = Object.values(users)
      .filter(u => u.username.toLowerCase().includes(lower) && u.username !== socket.username)
      .map(u => {
        const isOnline = [...io.sockets.sockets.values()].some(s => s.username === u.username);
        return { username: u.username, status: isOnline ? 'online' : 'offline' };
      });
    socket.emit('search-results', results);
  });

  socket.on('contact-request', ({ to, from }) => {
    if (users[to]) {
      if (!users[to].pending) users[to].pending = [];
      if (!users[to].pending.includes(from)) {
        users[to].pending.push(from);
        saveData();
      }
    }
    const target = findSocket(to);
    if (target) target.emit('contact-request', { from });
  });

  socket.on('contact-accept', ({ to, from }) => {
    if (users[from] && users[to]) {
      if (!users[from].contacts) users[from].contacts = [];
      if (!users[to].contacts) users[to].contacts = [];
      
      if (!users[from].contacts.includes(to)) users[from].contacts.push(to);
      if (!users[to].contacts.includes(from)) users[to].contacts.push(from);
      
      // Remove from pending
      if (users[from].pending) users[from].pending = users[from].pending.filter(p => p !== to);
      if (users[to].pending) users[to].pending = users[to].pending.filter(p => p !== from);
      
      saveData();
    }
    const target = findSocket(to);
    if (target) target.emit('contact-accepted', { from });
  });

  socket.on('call-request', ({ from, to, roomId }) => {
    if (Array.isArray(to)) {
      to.forEach(username => {
        const target = findSocket(username);
        if (target) target.emit('call-request', { from, roomId });
      });
    } else {
      const target = findSocket(to);
      if (target) target.emit('call-request', { from, roomId });
    }
  });

  socket.on('call-accept', ({ to, from, roomId }) => {
    const target = findSocket(to);
    if (target) target.emit('call-accepted', { from, roomId });
  });

  socket.on('call-decline', ({ to, from, roomId }) => {
    const target = findSocket(to);
    if (target) target.emit('call-declined', { from, roomId });
  });

  socket.on('group-create', ({ room, groupName, members }) => {
    if (!room) return;
    socket.join(room);
    if (Array.isArray(members)) {
      members.forEach(name => {
        const target = findSocket(name);
        if (target) target.join(room);
      });
    }
    io.to(room).emit('message', { user: 'System', text: `Group ${groupName} created`, time: new Date().toISOString() });
    socket.emit('group-created', { room, groupName });
  });

  // WebRTC Voice Signaling
  socket.on('voice-join', () => {
    const roomSockets = io.sockets.adapter.rooms.get(socket.room) || new Set();
    const voiceUsers = [...roomSockets]
      .filter(id => id !== socket.id)
      .map(id => {
        const s = io.sockets.sockets.get(id);
        return s?.inVoice ? { socketId: id, username: s.username } : null;
      }).filter(Boolean);
    socket.emit('voice-existing-users', voiceUsers);
    socket.to(socket.room).emit('voice-user-joined', { socketId: socket.id, username: socket.username });
    socket.inVoice = true;
    broadcastVoiceUsers(socket.room);
  });

  socket.on('voice-leave', () => {
    socket.inVoice = false;
    socket.to(socket.room).emit('voice-user-left', { socketId: socket.id });
    broadcastVoiceUsers(socket.room);
  });

  socket.on('voice-offer',  ({ to, offer })      => io.to(to).emit('voice-offer',  { from: socket.id, username: socket.username, offer }));
  socket.on('voice-answer', ({ to, answer })      => io.to(to).emit('voice-answer', { from: socket.id, answer }));
  socket.on('voice-ice',    ({ to, candidate })   => io.to(to).emit('voice-ice',    { from: socket.id, candidate }));

  socket.on('disconnect', () => {
    if (socket.room && socket.username) {
      if (socket.inVoice) socket.to(socket.room).emit('voice-user-left', { socketId: socket.id });
      broadcastUsers(socket.room);
    }
    console.log(`[-] Disconnected: ${socket.id}`);
  });

  function broadcastUsers(room) {
    const roomSockets = io.sockets.adapter.rooms.get(room) || new Set();
    const users = [...roomSockets].map(id => io.sockets.sockets.get(id)?.username).filter(Boolean);
    io.to(room).emit('users', users);
  }

  function broadcastVoiceUsers(room) {
    const roomSockets = io.sockets.adapter.rooms.get(room) || new Set();
    const users = [...roomSockets].map(id => {
      const s = io.sockets.sockets.get(id);
      return s?.inVoice ? s.username : null;
    }).filter(Boolean);
    io.to(room).emit('voice-users', users);
  }

  function findSocket(username) {
    return [...io.sockets.sockets.values()].find(s => s.username === username);
  }
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`\n✅ VIBE server running at http://0.0.0.0:${PORT}`);
  console.log(`   Friends open: http://YOUR_IP:${PORT}\n`);
});
