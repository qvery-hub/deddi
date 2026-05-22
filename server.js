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
let projectiles = [];

// Game Map & Resources
const MAP_WIDTH = 2000;
const MAP_HEIGHT = 2000;
let resources = {};

function initResources() {
    for (let i = 0; i < 50; i++) {
        const id = 'tree_' + i;
        resources[id] = { id: id, type: 'tree', x: Math.floor(Math.random() * MAP_WIDTH), y: Math.floor(Math.random() * MAP_HEIGHT), amount: 50 };
    }
    for (let i = 0; i < 30; i++) {
        const id = 'rock_' + i;
        resources[id] = { id: id, type: 'rock', x: Math.floor(Math.random() * MAP_WIDTH), y: Math.floor(Math.random() * MAP_HEIGHT), amount: 50 };
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

function saveDatabase() {
    fs.writeFile(DB_FILE, JSON.stringify(players), (err) => {
        if (err) console.error('Error saving database:', err);
    });
}

io.on('connection', (socket) => {
    console.log(`User connected: ${socket.id}`);

    if (!players[socket.id]) {
        players[socket.id] = {
            id: socket.id,
            x: Math.floor(Math.random() * 800),
            y: Math.floor(Math.random() * 600),
            color: `hsl(${Math.random() * 360}, 100%, 50%)`,
            health: 100,
            maxHealth: 100,
            mana: 100,
            maxMana: 100,
            inventory: { wood: 0, stone: 0 }
        };
        saveDatabase();
    } else {
        // Ensure returning players have mana stats
        if (players[socket.id].mana === undefined) players[socket.id].mana = 100;
        if (players[socket.id].maxMana === undefined) players[socket.id].maxMana = 100;
    }

    socket.emit('initData', {
        players: players,
        resources: resources,
        map: { width: MAP_WIDTH, height: MAP_HEIGHT }
    });

    socket.broadcast.emit('newPlayer', players[socket.id]);

    socket.on('playerMovement', (movementData) => {
        if (!movementData || typeof movementData.x !== 'number' || typeof movementData.y !== 'number') return;

        if (players[socket.id] && players[socket.id].health > 0) {
            players[socket.id].x = movementData.x;
            players[socket.id].y = movementData.y;
            socket.broadcast.emit('playerMoved', players[socket.id]);
        }
    });

    socket.on('gather', (resourceId) => {
        const player = players[socket.id];
        const resource = resources[resourceId];

        if (player && resource && player.health > 0) {
            const dx = player.x - resource.x;
            const dy = player.y - resource.y;
            if (Math.sqrt(dx * dx + dy * dy) < 60 && resource.amount > 0) {
                resource.amount -= 10;
                if (resource.type === 'tree') player.inventory.wood += 10;
                else if (resource.type === 'rock') player.inventory.stone += 10;

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
            if (Math.sqrt(dx * dx + dy * dy) < 80) { // Melee range
                target.health -= 10;
                checkDeath(targetId, socket.id);
                io.emit('playerHealthUpdated', { id: targetId, health: target.health });
            }
        }
    });

    socket.on('castSpell', (targetPos) => {
        if (!targetPos || typeof targetPos.x !== 'number' || typeof targetPos.y !== 'number') return;

        const player = players[socket.id];
        if (player && player.health > 0 && player.mana >= 20) {
            player.mana -= 20;
            socket.emit('playerManaUpdated', { id: player.id, mana: player.mana });

            const dx = targetPos.x - player.x;
            const dy = targetPos.y - player.y;
            const dist = Math.sqrt(dx*dx + dy*dy);

            projectiles.push({
                id: Math.random().toString(36).substr(2, 9),
                ownerId: player.id,
                x: player.x,
                y: player.y,
                vx: (dx / dist) * 15,
                vy: (dy / dist) * 15,
                life: 30 // frames
            });
        }
    });

    socket.on('chatMessage', (msg) => {
        if (typeof msg !== 'string') return;
        // Basic length check to prevent giant payloads
        if (msg.length > 200) msg = msg.substring(0, 200);
        io.emit('chatMessage', { sender: socket.id.substring(0,4), text: msg });
    });

    socket.on('disconnect', () => {
        console.log(`User disconnected: ${socket.id}`);
        delete players[socket.id];
        io.emit('playerDisconnected', socket.id);
    });
});

function checkDeath(targetId, killerId) {
    const target = players[targetId];
    if (target.health <= 0) {
        target.health = 0;
        io.emit('chatMessage', { sender: 'System', text: `${killerId.substring(0,4)} killed ${targetId.substring(0,4)}!` });

        setTimeout(() => {
            if(players[targetId]) {
                players[targetId].health = players[targetId].maxHealth;
                players[targetId].mana = players[targetId].maxMana;
                players[targetId].x = Math.floor(Math.random() * 800);
                players[targetId].y = Math.floor(Math.random() * 600);
                io.emit('playerRespawned', players[targetId]);
            }
        }, 3000);
    }
}

// Server Game Loop (30 FPS)
setInterval(() => {
    // Regen Mana
    for (let id in players) {
        const p = players[id];
        if (p.health > 0 && p.mana < p.maxMana) {
            p.mana += 1; // 1 mana per tick
            if (p.mana > p.maxMana) p.mana = p.maxMana;
            // Note: to save bandwidth, we could only emit this occasionally, but for proto it's ok
        }
    }

    // Process Projectiles
    for (let i = projectiles.length - 1; i >= 0; i--) {
        let proj = projectiles[i];
        proj.x += proj.vx;
        proj.y += proj.vy;
        proj.life--;

        let hit = false;
        // Collision with players
        for (let pid in players) {
            if (pid === proj.ownerId) continue;
            let p = players[pid];
            if (p.health > 0) {
                let dx = p.x - proj.x;
                let dy = p.y - proj.y;
                if (Math.sqrt(dx*dx + dy*dy) < 20) {
                    p.health -= 25; // Spell damage
                    hit = true;
                    checkDeath(pid, proj.ownerId);
                    io.emit('playerHealthUpdated', { id: pid, health: p.health });
                    break;
                }
            }
        }

        if (hit || proj.life <= 0) {
            projectiles.splice(i, 1);
        }
    }

    // Broadcast volatile state (mana, projectiles)
    io.emit('gameStateUpdate', {
        projectiles: projectiles,
        // Send mana updates for all
        manaData: Object.keys(players).map(id => ({id: id, mana: players[id].mana}))
    });

}, 1000 / 30);

setInterval(saveDatabase, 5000);

server.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
});
