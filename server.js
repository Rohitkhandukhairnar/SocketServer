/* Simple Socket.IO chat server with rooms and invites */
const express = require('express');
const http = require('http');
const {Server} = require('socket.io');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());

// Health + simple index
app.get('/', (_req, res) => {
  return res.json({ok: true, service: 'chat', version: 1});
});

const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST'],
  },
});

// In-memory room registry { roomId: { users: Map<socketId, profile> } }
const rooms = new Map();

function ensureRoom(roomId) {
  if (!rooms.has(roomId)) {
    rooms.set(roomId, {users: new Map()});
  }
  return rooms.get(roomId);
}

io.on('connection', socket => {
  let joinedRoomId = null;

  // Join a room with profile {name, avatarUrl}
  socket.on('join', ({roomId, profile}, ack) => {
    try {
      if (!roomId) throw new Error('roomId required');
      joinedRoomId = roomId;
      socket.join(roomId);
      const room = ensureRoom(roomId);
      room.users.set(socket.id, profile || {});
      io.to(roomId).emit('presence:update', Array.from(room.users.values()));
      ack && ack({ok: true});
    } catch (e) {
      ack && ack({ok: false, error: e.message});
    }
  });

  // Leave current room
  socket.on('leave', () => {
    if (!joinedRoomId) return;
    const room = rooms.get(joinedRoomId);
    if (room) {
      room.users.delete(socket.id);
      io.to(joinedRoomId).emit(
        'presence:update',
        Array.from(room.users.values()),
      );
    }
    socket.leave(joinedRoomId);
    joinedRoomId = null;
  });

  // Chat message {text, profile, tempId}
  socket.on('message', ({roomId, message}, ack) => {
    if (!roomId) return ack && ack({ok: false, error: 'roomId required'});
    io.to(roomId).emit('message', {...message, serverTs: Date.now()});
    ack && ack({ok: true});
  });

  // Typing indicator {roomId, profile, typing}
  socket.on('typing', ({roomId, typing, profile}) => {
    if (!roomId) return;
    // Broadcast to others in the same room
    socket.to(roomId).emit('typing', {typing: !!typing, profile});
  });

  // Invite: simply echoes back a normalized code (room id)
  socket.on('invite:code', ({roomId}, ack) => {
    if (!roomId) return ack && ack({ok: false, error: 'roomId required'});
    ack && ack({ok: true, code: String(roomId)});
  });

  socket.on('disconnect', () => {
    if (!joinedRoomId) return;
    const room = rooms.get(joinedRoomId);
    if (room) {
      room.users.delete(socket.id);
      io.to(joinedRoomId).emit(
        'presence:update',
        Array.from(room.users.values()),
      );
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`[chat] server listening on port ${PORT}`);
});

module.exports = {app, server, io};
