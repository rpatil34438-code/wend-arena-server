const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: { origin: "*" }
});

const PORT = process.env.PORT || 3000;

// Store players waiting for a match
let waitingPlayer = null;
const rooms = new Map();

io.on('connection', (socket) => {
    console.log(`User connected: ${socket.id}`);

    socket.on('join_arena', (userData) => {
        socket.userData = userData;
        if (waitingPlayer && waitingPlayer.id !== socket.id) {
            // Pair them up
            const player1 = waitingPlayer;
            const player2 = socket;
            const roomId = `room_${player1.id}_${player2.id}`;

            player1.join(roomId);
            player2.join(roomId);

            rooms.set(roomId, {
                players: [player1.id, player2.id],
                ready: new Set(),
                levelId: null,
                matchStarted: false
            });

            // Tell player1 about player2
            io.to(player1.id).emit('match_found', {
                roomId: roomId,
                opponentName: player2.userData.name || "Opponent",
                opponentPhoto: player2.userData.photo || ""
            });
            
            // Tell player2 about player1
            io.to(player2.id).emit('match_found', {
                roomId: roomId,
                opponentName: player1.userData.name || "Opponent",
                opponentPhoto: player1.userData.photo || ""
            });

            waitingPlayer = null;
        } else {
            waitingPlayer = socket;
            socket.emit('searching', { message: 'Looking for an opponent...' });
        }
    });


    socket.on('set_level', (data) => {
        const { roomId, levelId } = data;
        const room = rooms.get(roomId);
        if (room) {
            room.levelId = levelId;
            socket.to(roomId).emit('sync_level', { levelId });
        }
    });

    socket.on('player_ready', (data) => {
        const { roomId } = data;
        const room = rooms.get(roomId);
        if (room) {
            room.ready.add(socket.id);
            if (room.ready.size === 2) {
                io.to(roomId).emit('start_countdown', { duration: 3 });
                room.matchStarted = true;
            } else {
                socket.to(roomId).emit('opponent_ready');
            }
        }
    });

    socket.on('move', (data) => {
        // data contains x, y, rotation etc.
        const { roomId } = data;
        socket.to(roomId).emit('opponent_move', data);
    });

    socket.on('game_win', (data) => {
        const { roomId } = data;
        const room = rooms.get(roomId);
        if (room && room.matchStarted) {
            room.matchStarted = false; // Prevent multiple win calls
            io.to(roomId).emit('match_result', {
                winner: socket.id,
                message: "A winner has emerged!"
            });
            // Cleanup room after delay
            setTimeout(() => rooms.delete(roomId), 10000);
        }
    });

    socket.on('disconnect', () => {
        console.log(`User disconnected: ${socket.id}`);
        if (waitingPlayer && waitingPlayer.id === socket.id) {
            waitingPlayer = null;
        }
        // Handle disconnection during match
        for (const [roomId, room] of rooms.entries()) {
            if (room.players.includes(socket.id)) {
                socket.to(roomId).emit('opponent_disconnected');
                rooms.delete(roomId);
            }
        }
    });
});

app.get('/', (req, res) => {
    res.send('WORD Arena Server is Running!');
});

server.listen(PORT, '0.0.0.0', () => {
    console.log(`Server listening on port ${PORT}`);
});
