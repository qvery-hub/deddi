const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const fs = require('fs');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;
const DB_FILE = 'database.json';
const MAP_FILE = 'map.json';
let MAP_WIDTH = 2000;
let MAP_HEIGHT = 2000;
const VIEW_RADIUS = 800;

app.use(express.static('public'));

// --- ECS CORE ---
let nextEntityId = 1;
class Entity {
    constructor() {
        this.id = 'e_' + nextEntityId++;
        this.components = {};
    }
    addComponent(component) {
        this.components[component.name] = component;
        return this;
    }
    getComponent(name) { return this.components[name]; }
    hasComponent(name) { return !!this.components[name]; }
}

class Component { constructor(name) { this.name = name; } }

// --- COMPONENTS ---
class Position extends Component { constructor(x, y) { super('Position'); this.x = x; this.y = y; } }
class Velocity extends Component { constructor(speed) { super('Velocity'); this.speed = speed; this.targetX = null; this.targetY = null; } }
class Appearance extends Component { constructor(type, subtype, color) { super('Appearance'); this.type = type; this.subtype = subtype; this.color = color; } }
class Health extends Component { constructor(max) { super('Health'); this.max = max; this.current = max; } }
class Mana extends Component { constructor(max) { super('Mana'); this.max = max; this.current = max; this.lastSent = max; } }
class PlayerData extends Component { constructor(socketId, accountId) { super('PlayerData'); this.socketId = socketId; this.accountId = accountId; this.inventory = { wood: 0, stone: 0 }; this.lastInvStr = ""; } }
class ResourceData extends Component { constructor(amount) { super('ResourceData'); this.amount = amount; } }
class ProjectileData extends Component { constructor(ownerId, vx, vy, life) { super('ProjectileData'); this.ownerId = ownerId; this.vx = vx; this.vy = vy; this.life = life; } }

// --- WORLD ---
const World = {
    entities: new Map(),
    playersBySocket: new Map(),

    addEntity(entity) {
        this.entities.set(entity.id, entity);
        if (entity.hasComponent('PlayerData')) {
            this.playersBySocket.set(entity.getComponent('PlayerData').socketId, entity);
        }
    },
    removeEntity(entityId) {
        const e = this.entities.get(entityId);
        if (e && e.hasComponent('PlayerData')) {
            this.playersBySocket.delete(e.getComponent('PlayerData').socketId);
        }
        this.entities.delete(entityId);
        io.emit('entityDisappeared', entityId);
    },
    getEntity(id) { return this.entities.get(id); },
    getPlayerBySocket(socketId) { return this.playersBySocket.get(socketId); }
};

// --- SYSTEMS ---

function MovementSystem(dt) {
    for (let [id, entity] of World.entities) {
        if (entity.hasComponent('Position') && entity.hasComponent('Velocity')) {
            let pos = entity.getComponent('Position');
            let vel = entity.getComponent('Velocity');

            if (vel.targetX !== null && vel.targetY !== null) {
                let dx = vel.targetX - pos.x;
                let dy = vel.targetY - pos.y;
                let dist = Math.hypot(dx, dy);

                if (dist > vel.speed) {
                    pos.x += (dx / dist) * vel.speed;
                    pos.y += (dy / dist) * vel.speed;
                } else {
                    pos.x = vel.targetX;
                    pos.y = vel.targetY;
                    vel.targetX = null;
                    vel.targetY = null;
                }

                pos.x = Math.max(0, Math.min(pos.x, MAP_WIDTH));
                pos.y = Math.max(0, Math.min(pos.y, MAP_HEIGHT));
            }
        }

        if (entity.hasComponent('Position') && entity.hasComponent('ProjectileData')) {
            let pos = entity.getComponent('Position');
            let proj = entity.getComponent('ProjectileData');
            pos.x += proj.vx;
            pos.y += proj.vy;
            proj.life--;
        }
    }
}

const playerVision = new Map();

function serializeEntityState(entity) {
    let state = { id: entity.id };
    if (entity.hasComponent('Position')) state.pos = { x: entity.getComponent('Position').x, y: entity.getComponent('Position').y };
    if (entity.hasComponent('Appearance')) state.app = { type: entity.getComponent('Appearance').type, subtype: entity.getComponent('Appearance').subtype, color: entity.getComponent('Appearance').color };
    if (entity.hasComponent('Health')) state.hp = { current: entity.getComponent('Health').current, max: entity.getComponent('Health').max };
    if (entity.hasComponent('PlayerData')) state.isPlayer = true;
    if (entity.hasComponent('ResourceData')) state.res = { amount: entity.getComponent('ResourceData').amount };

    if (entity.hasComponent('Velocity')) {
        let vel = entity.getComponent('Velocity');
        if (vel.targetX !== null) {
            state.targetX = vel.targetX;
            state.targetY = vel.targetY;
        }
    }

    if (entity.hasComponent('ProjectileData')) {
         state.app = { type: 'projectile', subtype: 'fireball', color: '#ff0000' };
         // For projectiles, we need to send their trajectory so clients can interpolate
         let proj = entity.getComponent('ProjectileData');
         state.targetX = state.pos.x + proj.vx * proj.life;
         state.targetY = state.pos.y + proj.vy * proj.life;
    }

    return state;
}

function NetworkSystem() {
    for (let [socketId, playerEntity] of World.playersBySocket) {
        let socket = io.sockets.sockets.get(socketId);
        if (!socket) continue;

        let pPos = playerEntity.getComponent('Position');
        if (!pPos) continue;

        if (!playerVision.has(socketId)) playerVision.set(socketId, new Set());
        let currentlyVisible = playerVision.get(socketId);
        let newVisible = new Set();

        for (let [eId, entity] of World.entities) {
            let ePos = entity.getComponent('Position');
            if (!ePos) continue;

            let dist = Math.hypot(pPos.x - ePos.x, pPos.y - ePos.y);
            if (dist < VIEW_RADIUS) {
                newVisible.add(eId);

                if (!currentlyVisible.has(eId)) {
                    // Entity entered view
                    socket.emit('entityAppeared', serializeEntityState(entity));
                }
            }
        }

        for (let eId of currentlyVisible) {
            if (!newVisible.has(eId)) {
                socket.emit('entityDisappeared', eId);
            }
        }

        playerVision.set(socketId, newVisible);

        // Only emit myStats if they changed
        if (playerEntity.hasComponent('Mana')) {
            let mana = playerEntity.getComponent('Mana');
            let inv = playerEntity.getComponent('PlayerData').inventory;
            let invStr = JSON.stringify(inv);

            if (mana.current !== mana.lastSent || playerEntity.getComponent('PlayerData').lastInvStr !== invStr) {
                socket.emit('myStats', {
                    mana: mana.current,
                    maxMana: mana.max,
                    inventory: inv
                });
                mana.lastSent = mana.current;
                playerEntity.getComponent('PlayerData').lastInvStr = invStr;
            }
        }
    }
}

function GameLogicSystem() {
    let toRemove = [];
    for (let [id, entity] of World.entities) {
        if (entity.hasComponent('ProjectileData')) {
            let proj = entity.getComponent('ProjectileData');
            let pPos = entity.getComponent('Position');

            if (proj.life <= 0) {
                toRemove.push(id);
                continue;
            }

            for (let [pid, target] of World.entities) {
                if (pid === proj.ownerId || !target.hasComponent('Health') || !target.hasComponent('Player')) continue;
                if (target.getComponent('Health').current <= 0) continue;

                let tPos = target.getComponent('Position');
                if (!tPos) continue;

                if (Math.hypot(pPos.x - tPos.x, pPos.y - tPos.y) < 20) {
                    target.getComponent('Health').current -= 25;
                    toRemove.push(id);
                    broadcastToVisible(target, 'entityUpdated', { id: target.id, hp: { current: target.getComponent('Health').current, max: target.getComponent('Health').max }});
                    checkDeath(target, proj.ownerId);
                    break;
                }
            }
        }
    }

    toRemove.forEach(id => {
        World.removeEntity(id);
    });

    for (let [id, entity] of World.entities) {
        if (entity.hasComponent('Mana') && entity.hasComponent('Health') && entity.getComponent('Health').current > 0) {
            let mana = entity.getComponent('Mana');
            if (mana.current < mana.max) mana.current = Math.min(mana.max, mana.current + 1);
        }
    }
}

function broadcastToVisible(targetEntity, event, data) {
    let tPos = targetEntity.getComponent('Position');
    if (!tPos) return;

    for (let [socketId, playerEntity] of World.playersBySocket) {
        let pPos = playerEntity.getComponent('Position');
        if (pPos && Math.hypot(pPos.x - tPos.x, pPos.y - tPos.y) < VIEW_RADIUS) {
            io.to(socketId).emit(event, data);
        }
    }
}

function checkDeath(entity, killerId) {
    let hp = entity.getComponent('Health');
    if (hp.current <= 0) {
        hp.current = 0;
        let pData = entity.getComponent('PlayerData');
        if (pData) {
            io.emit('chatMessage', { sender: 'System', text: `Player died.` });
            setTimeout(() => {
                hp.current = hp.max;
                let mana = entity.getComponent('Mana');
                if (mana) mana.current = mana.max;
                let pos = entity.getComponent('Position');
                pos.x = Math.floor(Math.random() * 800);
                pos.y = Math.floor(Math.random() * 600);

                let vel = entity.getComponent('Velocity');
                if (vel) { vel.targetX = null; vel.targetY = null; }

                broadcastToVisible(entity, 'entityUpdated', serializeEntityState(entity));
                broadcastToVisible(entity, 'entityMoved', { id: entity.id, targetX: pos.x, targetY: pos.y, snap: true });
            }, 3000);
        }
    }
}

// --- INITIALIZATION & DATABASE ---

let savedPlayers = {};
try {
    if (fs.existsSync(DB_FILE)) savedPlayers = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
} catch (err) {}

function saveDatabase() {
    // DO NOT OVERWRITE entire file. Merge connected players into savedPlayers
    for (let [socketId, entity] of World.playersBySocket) {
        let pData = entity.getComponent('PlayerData');
        savedPlayers[pData.accountId] = {
            x: entity.getComponent('Position').x,
            y: entity.getComponent('Position').y,
            inventory: pData.inventory,
            color: entity.getComponent('Appearance').color
        };
    }
    fs.writeFile(DB_FILE, JSON.stringify(savedPlayers), () => {});
}

function initResources() {
    try {
        if (fs.existsSync(MAP_FILE)) {
            const mapData = JSON.parse(fs.readFileSync(MAP_FILE, 'utf8'));
            if (mapData.width) MAP_WIDTH = mapData.width;
            if (mapData.height) MAP_HEIGHT = mapData.height;

            if (mapData.resources && Array.isArray(mapData.resources)) {
                mapData.resources.forEach(res => {
                    let e = new Entity()
                        .addComponent(new Position(res.x, res.y))
                        .addComponent(new Appearance('resource', res.type, res.type === 'tree' ? '#228B22' : '#808080'))
                        .addComponent(new ResourceData(res.amount));
                    e.id = res.id; // Optional: keep ID from JSON
                    World.addEntity(e);
                });
            }
            console.log(`Map loaded: ${MAP_WIDTH}x${MAP_HEIGHT} with ${mapData.resources ? mapData.resources.length : 0} resources.`);
        } else {
            console.warn('map.json not found, starting empty map.');
        }
    } catch (err) {
        console.error('Error loading map.json:', err);
    }
}
initResources();

// --- SOCKET HANDLERS ---

// Require authentication token for persistence
io.use((socket, next) => {
    const token = socket.handshake.auth.token;
    if (!token) {
        return next(new Error("Authentication error: No token provided"));
    }
    socket.accountId = token;
    next();
});

io.on('connection', (socket) => {
    console.log(`Connected: ${socket.id} (Account: ${socket.accountId})`);

    let pData = savedPlayers[socket.accountId] || { x: 500, y: 500, inventory: { wood: 0, stone: 0 }, color: `hsl(${Math.random()*360},100%,50%)` };

    let player = new Entity()
        .addComponent(new Position(pData.x, pData.y))
        .addComponent(new Velocity(5))
        .addComponent(new Appearance('player', 'human', pData.color))
        .addComponent(new Health(100))
        .addComponent(new Mana(100))
        .addComponent(new PlayerData(socket.id, socket.accountId))
        .addComponent(new Component('Player'));

    player.getComponent('PlayerData').inventory = pData.inventory;

    World.addEntity(player);
    socket.emit('initMap', { width: MAP_WIDTH, height: MAP_HEIGHT, myEntityId: player.id });

    socket.on('setMoveTarget', (pos) => {
        if (!pos || typeof pos.x !== 'number' || typeof pos.y !== 'number') return;
        let e = World.getPlayerBySocket(socket.id);
        if (e && e.getComponent('Health').current > 0) {
            let vel = e.getComponent('Velocity');
            vel.targetX = pos.x;
            vel.targetY = pos.y;
            // Emit EVENT of movement intention ONLY ONCE
            broadcastToVisible(e, 'entityMoved', { id: e.id, targetX: pos.x, targetY: pos.y });
        }
    });

    socket.on('gather', (targetId) => {
        let e = World.getPlayerBySocket(socket.id);
        let target = World.getEntity(targetId);
        if (e && target && target.hasComponent('ResourceData') && e.getComponent('Health').current > 0) {
            let ePos = e.getComponent('Position');
            let tPos = target.getComponent('Position');
            if (Math.hypot(ePos.x - tPos.x, ePos.y - tPos.y) < 60) {
                let res = target.getComponent('ResourceData');
                if (res.amount > 0) {
                    res.amount -= 10;
                    let app = target.getComponent('Appearance');
                    if (app.subtype === 'tree') e.getComponent('PlayerData').inventory.wood += 10;
                    if (app.subtype === 'rock') e.getComponent('PlayerData').inventory.stone += 10;
                    broadcastToVisible(target, 'entityUpdated', { id: targetId, res: { amount: res.amount } });
                }
            }
        }
    });

    socket.on('attack', (targetId) => {
        let e = World.getPlayerBySocket(socket.id);
        let target = World.getEntity(targetId);
        if (e && target && target.hasComponent('Health') && e.getComponent('Health').current > 0) {
            let ePos = e.getComponent('Position');
            let tPos = target.getComponent('Position');
            if (Math.hypot(ePos.x - tPos.x, ePos.y - tPos.y) < 80) {
                target.getComponent('Health').current -= 10;
                broadcastToVisible(target, 'entityUpdated', { id: targetId, hp: { current: target.getComponent('Health').current, max: target.getComponent('Health').max }});
                checkDeath(target, e.id);
            }
        }
    });

    socket.on('castSpell', (pos) => {
        if (!pos || typeof pos.x !== 'number' || typeof pos.y !== 'number') return;
        let e = World.getPlayerBySocket(socket.id);
        if (e && e.getComponent('Health').current > 0) {
            let mana = e.getComponent('Mana');
            if (mana.current >= 20) {
                mana.current -= 20;
                let ePos = e.getComponent('Position');
                let dx = pos.x - ePos.x;
                let dy = pos.y - ePos.y;
                let dist = Math.hypot(dx, dy);

                let proj = new Entity()
                    .addComponent(new Position(ePos.x, ePos.y))
                    .addComponent(new ProjectileData(e.id, (dx/dist)*15, (dy/dist)*15, 30))
                    .addComponent(new Appearance('projectile', 'fireball', '#ff0000'));
                World.addEntity(proj);

                // Emitting the projectile creation to viewers
                broadcastToVisible(proj, 'entityAppeared', serializeEntityState(proj));
            }
        }
    });

    socket.on('chatMessage', (msg) => {
        if (typeof msg !== 'string') return;
        msg = msg.substring(0, 200);
        io.emit('chatMessage', { sender: socket.accountId.substring(0,4), text: msg });
    });

    socket.on('disconnect', () => {
        console.log(`Disconnected: ${socket.id} (Account: ${socket.accountId})`);
        let e = World.getPlayerBySocket(socket.id);
        if (e) {
            saveDatabase(); // Save before deleting
            World.removeEntity(e.id);
            playerVision.delete(socket.id);
        }
    });
});

// GAME LOOP
setInterval(() => {
    MovementSystem();
    GameLogicSystem();
    NetworkSystem();
}, 1000 / 30);

setInterval(saveDatabase, 5000);

server.listen(PORT, () => { console.log('Server on port', PORT); });
