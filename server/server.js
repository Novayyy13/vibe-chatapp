const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*', methods: ['GET', 'POST'] }
});

const PORT = process.env.PORT || 3000;

// Serve the web client directly from the server
app.use(express.static(path.join(__dirname, 'public')));

const messageHistory = {};

io.on('connection', (socket) => {
  console.log(`[+] Connected: ${socket.id}`);

  socket.on('join', ({ username, room }) => {
    socket.username = username;
    socket.room = room;
    socket.join(room);
    if (!messageHistory[room]) messageHistory[room] = [];
    socket.emit('history', messageHistory[room]);
    const sysMsg = { user: 'System', text: `${username} joined`, time: new Date().toISOString() };
    io.to(room).emit('message', sysMsg);
    broadcastUsers(room);
  });

  socket.on('message', ({ text }) => {
    if (!socket.room || !socket.username) return;
    const msg = { user: socket.username, text, time: new Date().toISOString() };
    if (!messageHistory[socket.room]) messageHistory[socket.room] = [];
    messageHistory[socket.room].push(msg);
    if (messageHistory[socket.room].length > 100) messageHistory[socket.room].shift();
    io.to(socket.room).emit('message', msg);
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
      io.to(socket.room).emit('message', { user: 'System', text: `${socket.username} left`, time: new Date().toISOString() });
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
