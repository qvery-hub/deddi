const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const fs = require('fs');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;
const DB_FILE = 'database.json';

app.use(express.static('public'));

let players = {};

// Load database
try {
    if (fs.existsSync(DB_FILE)) {
        const data = fs.readFileSync(DB_FILE, 'utf8');
        players = JSON.parse(data);
        console.log('Database loaded');
    }
} catch (err) {
    console.error('Error loading database:', err);
}

// Save database
function saveDatabase() {
    fs.writeFile(DB_FILE, JSON.stringify(players), (err) => {
        if (err) console.error('Error saving database:', err);
    });
}

io.on('connection', (socket) => {
    console.log(`User connected: ${socket.id}`);

    // Create new player or load existing
    if (!players[socket.id]) {
        players[socket.id] = {
            id: socket.id,
            x: Math.floor(Math.random() * 800),
            y: Math.floor(Math.random() * 600),
            color: `hsl(${Math.random() * 360}, 100%, 50%)`
        };
        saveDatabase();
    }

    // Send current players to the new connected client
    socket.emit('currentPlayers', players);

    // Broadcast to all other clients that a new player connected
    socket.broadcast.emit('newPlayer', players[socket.id]);

    socket.on('playerMovement', (movementData) => {
        if (players[socket.id]) {
            players[socket.id].x = movementData.x;
            players[socket.id].y = movementData.y;

            // Broadcast the new position to all other clients
            socket.broadcast.emit('playerMoved', players[socket.id]);
            // Do not save database on every movement to avoid thrashing
        }
    });

    socket.on('disconnect', () => {
        console.log(`User disconnected: ${socket.id}`);
        // Remove player from the players object
        delete players[socket.id];
        // Emit a message to all players to remove this player
        io.emit('playerDisconnected', socket.id);
    });
});

// Periodically save database
setInterval(saveDatabase, 5000);

server.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
});
