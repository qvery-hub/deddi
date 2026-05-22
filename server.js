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

// Game Map & Resources
const MAP_WIDTH = 2000;
const MAP_HEIGHT = 2000;
let resources = {};

function initResources() {
    // Generate some random trees and rocks
    for (let i = 0; i < 50; i++) {
        const id = 'tree_' + i;
        resources[id] = {
            id: id,
            type: 'tree',
            x: Math.floor(Math.random() * MAP_WIDTH),
            y: Math.floor(Math.random() * MAP_HEIGHT),
            amount: 50 // max wood
        };
    }
    for (let i = 0; i < 30; i++) {
        const id = 'rock_' + i;
        resources[id] = {
            id: id,
            type: 'rock',
            x: Math.floor(Math.random() * MAP_WIDTH),
            y: Math.floor(Math.random() * MAP_HEIGHT),
            amount: 50 // max stone
        };
    }
}
initResources();


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
            x: Math.floor(Math.random() * 800), // Start near center
            y: Math.floor(Math.random() * 600),
            color: `hsl(${Math.random() * 360}, 100%, 50%)`,
            health: 100,
            maxHealth: 100,
            inventory: {
                wood: 0,
                stone: 0
            }
        };
        saveDatabase();
    }

    // Send initial data to the new connected client
    socket.emit('initData', {
        players: players,
        resources: resources,
        map: { width: MAP_WIDTH, height: MAP_HEIGHT }
    });

    // Broadcast to all other clients that a new player connected
    socket.broadcast.emit('newPlayer', players[socket.id]);

    socket.on('playerMovement', (movementData) => {
        if (players[socket.id] && players[socket.id].health > 0) {
            players[socket.id].x = movementData.x;
            players[socket.id].y = movementData.y;

            // Broadcast the new position to all other clients
            socket.broadcast.emit('playerMoved', players[socket.id]);
        }
    });

    socket.on('gather', (resourceId) => {
        const player = players[socket.id];
        const resource = resources[resourceId];

        if (player && resource && player.health > 0) {
            const dx = player.x - resource.x;
            const dy = player.y - resource.y;
            const distance = Math.sqrt(dx * dx + dy * dy);

            // Interaction range
            if (distance < 50 && resource.amount > 0) {
                resource.amount -= 10;
                if (resource.type === 'tree') {
                    player.inventory.wood += 10;
                } else if (resource.type === 'rock') {
                    player.inventory.stone += 10;
                }

                io.emit('resourceUpdated', resource);
                socket.emit('inventoryUpdated', player.inventory);
            }
        }
    });

    socket.on('attack', (targetId) => {
        const player = players[socket.id];
        const target = players[targetId];

        if (player && target && player.health > 0 && target.health > 0) {
            const dx = player.x - target.x;
            const dy = player.y - target.y;
            const distance = Math.sqrt(dx * dx + dy * dy);

            // Attack range
            if (distance < 60) {
                target.health -= 10;

                if (target.health <= 0) {
                    target.health = 0;
                    io.emit('chatMessage', { sender: 'System', text: `${socket.id.substring(0,4)} killed ${targetId.substring(0,4)}!` });

                    // Simple respawn logic
                    setTimeout(() => {
                        if(players[targetId]) {
                            players[targetId].health = players[targetId].maxHealth;
                            players[targetId].x = Math.floor(Math.random() * 800);
                            players[targetId].y = Math.floor(Math.random() * 600);
                            io.emit('playerRespawned', players[targetId]);
                        }
                    }, 3000);
                }

                io.emit('playerHealthUpdated', { id: targetId, health: target.health });
            }
        }
    });

    socket.on('chatMessage', (msg) => {
        io.emit('chatMessage', { sender: socket.id.substring(0,4), text: msg });
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
