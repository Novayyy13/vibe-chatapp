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

// Serve the web client directly from the server
app.use(express.static(path.join(__dirname, 'public')));

let messageHistory = {};
try {
  if (fs.existsSync(HISTORY_FILE)) {
    messageHistory = JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf8'));
  }
} catch (e) { console.error('Error loading history:', e); }

function saveHistory() {
  try {
    fs.writeFileSync(HISTORY_FILE, JSON.stringify(messageHistory), 'utf8');
  } catch (e) { console.error('Error saving history:', e); }
}

io.on('connection', (socket) => {
  console.log(`[+] Connected: ${socket.id}`);

  socket.on('join', ({ username, room }) => {
    socket.username = username;
    socket.room = room;
    socket.join(room);
    if (!messageHistory[room]) messageHistory[room] = [];
    socket.emit('history', messageHistory[room]);
    socket.emit('rooms-list', Object.keys(messageHistory));
    broadcastUsers(room);
  });

  socket.on('message', ({ text, room }) => {
    const targetRoom = room || socket.room;
    if (!targetRoom || !socket.username) return;
    const msg = { user: socket.username, text, time: new Date().toISOString() };
    if (!messageHistory[targetRoom]) messageHistory[targetRoom] = [];
    messageHistory[targetRoom].push(msg);
    if (messageHistory[targetRoom].length > 100) messageHistory[targetRoom].shift();
    saveHistory();
    io.to(targetRoom).emit('message', msg);
  });

  socket.on('typing', (isTyping) => {
    socket.to(socket.room).emit('typing', { user: socket.username, isTyping });
  });

  socket.on('search-users', (query) => {
    const lower = String(query || '').toLowerCase();
    const results = [...io.sockets.sockets.values()]
      .filter(s => s.username && s.username.toLowerCase().includes(lower) && s.username !== socket.username)
      .map(s => ({ username: s.username, status: 'online' }));
    socket.emit('search-results', results);
  });

  socket.on('contact-request', ({ to, from }) => {
    const target = findSocket(to);
    if (target) target.emit('contact-request', { from });
  });

  socket.on('contact-accept', ({ to, from }) => {
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
