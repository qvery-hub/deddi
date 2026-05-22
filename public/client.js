const socket = io();

const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');

// UI Elements
const healthFill = document.getElementById('health-bar-fill');
const healthText = document.getElementById('health-text');
const manaFill = document.getElementById('mana-bar-fill');
const manaText = document.getElementById('mana-text');

const targetFrame = document.getElementById('target-frame');
const targetHealthFill = document.getElementById('target-health-fill');
const targetHealthText = document.getElementById('target-health-text');
const targetNameText = document.getElementById('target-name');

const invWood = document.getElementById('inv-wood');
const invStone = document.getElementById('inv-stone');
const chatMessages = document.getElementById('chat-messages');
const chatInput = document.getElementById('chat-input');

canvas.width = window.innerWidth;
canvas.height = window.innerHeight;

let players = {};
let resources = {};
let projectiles = [];
let mapData = { width: 2000, height: 2000 };

let moveTargetX = null;
let moveTargetY = null;
const speed = 5;

// Selection state
let selectedTarget = null; // { type: 'player'|'resource', id: string }
let mouseWorldPos = { x: 0, y: 0 };

// Camera
let camera = { x: 0, y: 0 };

window.addEventListener('resize', () => {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
});

// Chat Input
chatInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
        const msg = chatInput.value.trim();
        if (msg) {
            socket.emit('chatMessage', msg);
            chatInput.value = '';
        }
        chatInput.blur();
    }
});

// Controls
canvas.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    if (document.activeElement === chatInput) chatInput.blur();

    // Right click: Move or Interact
    const worldX = e.clientX + camera.x;
    const worldY = e.clientY + camera.y;
    handleRightClick(worldX, worldY);
});

canvas.addEventListener('mousedown', (e) => {
    if (e.button !== 0) return; // Only Left click
    if (document.activeElement === chatInput) return;

    // Left click: Select Target
    const worldX = e.clientX + camera.x;
    const worldY = e.clientY + camera.y;
    handleLeftClick(worldX, worldY);
});

canvas.addEventListener('mousemove', (e) => {
    mouseWorldPos.x = e.clientX + camera.x;
    mouseWorldPos.y = e.clientY + camera.y;
});

window.addEventListener('keydown', (e) => {
    if (document.activeElement === chatInput) return;

    // 'Q' key for fireball
    if (e.key.toLowerCase() === 'q') {
        socket.emit('castSpell', { x: mouseWorldPos.x, y: mouseWorldPos.y });
    }
    // 'Escape' to clear target
    if (e.key === 'Escape') {
        selectedTarget = null;
        updateTargetUI();
    }
});


// Socket Events
socket.on('initData', (data) => {
    players = data.players;
    resources = data.resources;
    mapData = data.map;
    updateUI();
});

socket.on('newPlayer', (playerInfo) => { players[playerInfo.id] = playerInfo; });
socket.on('playerMoved', (playerInfo) => {
    if (players[playerInfo.id]) {
        players[playerInfo.id].x = playerInfo.x;
        players[playerInfo.id].y = playerInfo.y;
    }
});
socket.on('playerDisconnected', (playerId) => {
    delete players[playerId];
    if (selectedTarget && selectedTarget.id === playerId) {
        selectedTarget = null; updateTargetUI();
    }
});
socket.on('resourceUpdated', (resourceInfo) => {
    if (resources[resourceInfo.id]) resources[resourceInfo.id].amount = resourceInfo.amount;
    updateTargetUI();
});
socket.on('inventoryUpdated', (inventory) => {
    if (players[socket.id]) { players[socket.id].inventory = inventory; updateUI(); }
});
socket.on('playerHealthUpdated', (data) => {
    if (players[data.id]) {
        players[data.id].health = data.health;
        if (data.id === socket.id) updateUI();
        updateTargetUI();
    }
});
socket.on('playerManaUpdated', (data) => {
    if (players[data.id]) {
        players[data.id].mana = data.mana;
        if (data.id === socket.id) updateUI();
    }
});
socket.on('playerRespawned', (playerInfo) => {
    if (players[playerInfo.id]) {
        players[playerInfo.id].health = playerInfo.health;
        players[playerInfo.id].mana = playerInfo.mana;
        players[playerInfo.id].x = playerInfo.x;
        players[playerInfo.id].y = playerInfo.y;
        if (playerInfo.id === socket.id) {
            moveTargetX = null; moveTargetY = null;
            updateUI();
        }
        updateTargetUI();
    }
});
socket.on('gameStateUpdate', (data) => {
    projectiles = data.projectiles;
    // Update mana for all players
    data.manaData.forEach(m => {
        if(players[m.id]) players[m.id].mana = m.mana;
    });
    updateUI(); // Keep my mana updated
});
socket.on('chatMessage', (msg) => {
    const p = document.createElement('p');
    if (msg.sender === 'System') p.className = 'sys-msg';

    // Prevent XSS by building DOM nodes instead of using innerHTML
    const strong = document.createElement('strong');
    strong.textContent = `${msg.sender}: `;
    p.appendChild(strong);

    const textNode = document.createTextNode(msg.text);
    p.appendChild(textNode);

    chatMessages.appendChild(p);
    chatMessages.scrollTop = chatMessages.scrollHeight;
});


// Logic Functions
function handleLeftClick(worldX, worldY) {
    let clickedSomething = false;

    // Check players first
    for (let id in players) {
        if (id === socket.id) continue;
        const p = players[id];
        if (p.health <= 0) continue;
        if (Math.hypot(worldX - p.x, worldY - p.y) < 20) {
            selectedTarget = { type: 'player', id: id };
            clickedSomething = true;
            break;
        }
    }

    // Check resources if no player clicked
    if (!clickedSomething) {
        for (let id in resources) {
            const res = resources[id];
            if (res.amount <= 0) continue;
            if (Math.hypot(worldX - res.x, worldY - res.y) < 30) {
                selectedTarget = { type: 'resource', id: id };
                clickedSomething = true;
                break;
            }
        }
    }

    if (!clickedSomething) selectedTarget = null;
    updateTargetUI();
}

function handleRightClick(worldX, worldY) {
    const myPlayer = players[socket.id];
    if (!myPlayer || myPlayer.health <= 0) return;

    // Auto-target on right click if hitting an entity
    handleLeftClick(worldX, worldY);

    if (selectedTarget) {
        if (selectedTarget.type === 'resource') {
            const res = resources[selectedTarget.id];
            if (res && res.amount > 0) {
                if (Math.hypot(myPlayer.x - res.x, myPlayer.y - res.y) < 60) {
                    socket.emit('gather', selectedTarget.id);
                    moveTargetX = null; moveTargetY = null;
                    return;
                }
                // Else move towards it
                moveTargetX = res.x; moveTargetY = res.y;
                return;
            }
        } else if (selectedTarget.type === 'player') {
            const p = players[selectedTarget.id];
            if (p && p.health > 0) {
                if (Math.hypot(myPlayer.x - p.x, myPlayer.y - p.y) < 80) {
                    socket.emit('attack', selectedTarget.id);
                    moveTargetX = null; moveTargetY = null;
                    return;
                }
                // Else move towards it
                moveTargetX = p.x; moveTargetY = p.y;
                return;
            }
        }
    }

    // Just Move
    moveTargetX = worldX;
    moveTargetY = worldY;
}


// UI Updaters
function updateUI() {
    const myPlayer = players[socket.id];
    if (!myPlayer) return;

    healthFill.style.width = `${(myPlayer.health / myPlayer.maxHealth) * 100}%`;
    healthText.innerText = `${Math.floor(myPlayer.health)} / ${myPlayer.maxHealth}`;

    manaFill.style.width = `${(myPlayer.mana / myPlayer.maxMana) * 100}%`;
    manaText.innerText = `${Math.floor(myPlayer.mana)} / ${myPlayer.maxMana}`;

    invWood.innerText = myPlayer.inventory.wood;
    invStone.innerText = myPlayer.inventory.stone;
}

function updateTargetUI() {
    if (!selectedTarget) {
        targetFrame.classList.add('hidden');
        return;
    }

    if (selectedTarget.type === 'player') {
        const p = players[selectedTarget.id];
        if (!p || p.health <= 0) {
            targetFrame.classList.add('hidden');
            selectedTarget = null;
            return;
        }
        targetFrame.classList.remove('hidden');
        targetNameText.innerText = `Player ${p.id.substring(0,4)}`;
        targetHealthFill.style.width = `${(p.health / p.maxHealth) * 100}%`;
        targetHealthText.innerText = `${Math.floor(p.health)} / ${p.maxHealth}`;
    } else if (selectedTarget.type === 'resource') {
        const res = resources[selectedTarget.id];
        if (!res || res.amount <= 0) {
            targetFrame.classList.add('hidden');
            selectedTarget = null;
            return;
        }
        targetFrame.classList.remove('hidden');
        targetNameText.innerText = res.type === 'tree' ? 'Tree' : 'Rock Node';
        targetHealthFill.style.width = `${(res.amount / 50) * 100}%`; // max amount is 50
        targetHealthText.innerText = `${res.amount} / 50`;
    }
}


// Engine
function update() {
    const myPlayer = players[socket.id];
    if (!myPlayer) return;

    camera.x = myPlayer.x - canvas.width / 2;
    camera.y = myPlayer.y - canvas.height / 2;
    camera.x = Math.max(0, Math.min(camera.x, mapData.width - canvas.width));
    camera.y = Math.max(0, Math.min(camera.y, mapData.height - canvas.height));

    if (myPlayer.health <= 0) {
        moveTargetX = null; moveTargetY = null;
        return;
    }

    if (moveTargetX !== null && moveTargetY !== null) {
        const dx = moveTargetX - myPlayer.x;
        const dy = moveTargetY - myPlayer.y;
        const distance = Math.hypot(dx, dy);

        if (distance > speed) {
            myPlayer.x += (dx / distance) * speed;
            myPlayer.y += (dy / distance) * speed;

            // Constrain
            myPlayer.x = Math.max(0, Math.min(myPlayer.x, mapData.width));
            myPlayer.y = Math.max(0, Math.min(myPlayer.y, mapData.height));

            socket.emit('playerMovement', { x: myPlayer.x, y: myPlayer.y });
        } else {
            myPlayer.x = moveTargetX;
            myPlayer.y = moveTargetY;
            moveTargetX = null; moveTargetY = null;
            socket.emit('playerMovement', { x: myPlayer.x, y: myPlayer.y });
        }
    }
}

// Draw Helpers
function drawShadow(ctx, x, y, radius) {
    ctx.beginPath();
    ctx.ellipse(x, y + radius*0.8, radius, radius*0.4, 0, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(0, 0, 0, 0.4)';
    ctx.fill();
}

function drawSelectionRing(ctx, x, y, radius, isEnemy) {
    ctx.beginPath();
    ctx.ellipse(x, y + radius*0.8, radius*1.5, radius*0.7, 0, 0, Math.PI * 2);
    ctx.strokeStyle = isEnemy ? 'rgba(255, 0, 0, 0.8)' : 'rgba(255, 255, 0, 0.8)';
    ctx.lineWidth = 2;
    ctx.stroke();
    // Inner fill
    ctx.fillStyle = isEnemy ? 'rgba(255, 0, 0, 0.2)' : 'rgba(255, 255, 0, 0.2)';
    ctx.fill();
}

function draw() {
    // Fill map background
    ctx.fillStyle = '#1a1c23';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    ctx.save();
    ctx.translate(-camera.x, -camera.y);

    // Draw Map floor
    ctx.fillStyle = '#4a752c'; // Darker grass
    ctx.fillRect(0, 0, mapData.width, mapData.height);

    // Draw Grid (optional, for perspective feel)
    ctx.strokeStyle = 'rgba(255,255,255,0.05)';
    ctx.lineWidth = 1;
    for(let i=0; i<mapData.width; i+=100) {
        ctx.beginPath(); ctx.moveTo(i, 0); ctx.lineTo(i, mapData.height); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(0, i); ctx.lineTo(mapData.width, i); ctx.stroke();
    }

    // Move Marker
    if (moveTargetX !== null && moveTargetY !== null) {
        ctx.beginPath();
        ctx.ellipse(moveTargetX, moveTargetY, 15, 8, 0, 0, Math.PI * 2);
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.6)';
        ctx.stroke();
    }

    // Draw Selection Rings (Underneath entities)
    if (selectedTarget) {
        if (selectedTarget.type === 'player' && players[selectedTarget.id]) {
            const p = players[selectedTarget.id];
            drawSelectionRing(ctx, p.x, p.y, 15, true);
        } else if (selectedTarget.type === 'resource' && resources[selectedTarget.id]) {
            const res = resources[selectedTarget.id];
            drawSelectionRing(ctx, res.x, res.y, 20, false);
        }
    }

    // Collect all renderables to Y-sort them for 2.5D perspective
    let renderables = [];

    // Resources
    Object.values(resources).forEach(res => {
        if (res.amount > 0) renderables.push({ type: 'resource', data: res, y: res.y });
    });

    // Players
    Object.values(players).forEach(p => {
        if (p.health > 0) renderables.push({ type: 'player', data: p, y: p.y });
    });

    // Sort by Y coordinate
    renderables.sort((a, b) => a.y - b.y);

    // Draw Entities
    renderables.forEach(entity => {
        if (entity.type === 'resource') {
            const res = entity.data;
            drawShadow(ctx, res.x, res.y, 20);

            if (res.type === 'tree') {
                // Trunk
                ctx.fillStyle = '#5c4033';
                ctx.fillRect(res.x - 4, res.y - 20, 8, 20);
                // Canopy
                ctx.beginPath();
                ctx.arc(res.x, res.y - 25, 25, 0, Math.PI * 2);
                ctx.fillStyle = '#228B22';
                ctx.fill();
                ctx.strokeStyle = '#1a5e1a';
                ctx.lineWidth = 2;
                ctx.stroke();
            } else {
                // Rock (Hexagon-ish)
                ctx.beginPath();
                ctx.moveTo(res.x - 15, res.y - 10);
                ctx.lineTo(res.x, res.y - 20);
                ctx.lineTo(res.x + 20, res.y - 5);
                ctx.lineTo(res.x + 10, res.y + 10);
                ctx.lineTo(res.x - 10, res.y + 15);
                ctx.fillStyle = '#666';
                ctx.fill();
                // Rock highlight
                ctx.beginPath();
                ctx.moveTo(res.x - 15, res.y - 10);
                ctx.lineTo(res.x, res.y - 20);
                ctx.lineTo(res.x + 5, res.y - 5);
                ctx.fillStyle = '#888';
                ctx.fill();
            }

        } else if (entity.type === 'player') {
            const p = entity.data;
            drawShadow(ctx, p.x, p.y, 15);

            // Body
            ctx.beginPath();
            ctx.arc(p.x, p.y - 15, 15, 0, Math.PI * 2);
            ctx.fillStyle = p.color;
            ctx.fill();
            ctx.strokeStyle = '#222';
            ctx.lineWidth = 2;
            ctx.stroke();

            // Name tag
            ctx.fillStyle = 'white';
            ctx.font = '12px Segoe UI';
            ctx.textAlign = 'center';
            // Dark outline for text
            ctx.strokeStyle = 'black';
            ctx.lineWidth = 2;
            ctx.strokeText(p.id.substring(0, 4), p.x, p.y - 35);
            ctx.fillText(p.id.substring(0, 4), p.x, p.y - 35);

            // Floating HP bar (only for other players, local player looks at UI)
            if (p.id !== socket.id) {
                const bw = 30, bh = 4;
                ctx.fillStyle = '#111';
                ctx.fillRect(p.x - bw/2, p.y - 45, bw, bh);
                ctx.fillStyle = '#d32f2f';
                ctx.fillRect(p.x - bw/2, p.y - 45, bw * (p.health/p.maxHealth), bh);
            }
        }
    });

    // Draw Projectiles
    projectiles.forEach(proj => {
        drawShadow(ctx, proj.x, proj.y, 8);

        ctx.beginPath();
        ctx.arc(proj.x, proj.y - 10, 8, 0, Math.PI * 2);
        // Fireball gradient
        const grd = ctx.createRadialGradient(proj.x, proj.y-10, 0, proj.x, proj.y-10, 8);
        grd.addColorStop(0, "yellow");
        grd.addColorStop(1, "red");
        ctx.fillStyle = grd;
        ctx.fill();

        // Trail
        ctx.beginPath();
        ctx.moveTo(proj.x, proj.y - 10);
        ctx.lineTo(proj.x - proj.vx*2, proj.y - 10 - proj.vy*2);
        ctx.strokeStyle = 'rgba(255, 100, 0, 0.5)';
        ctx.lineWidth = 6;
        ctx.stroke();
    });

    ctx.restore();
}

function gameLoop() {
    update();
    draw();
    requestAnimationFrame(gameLoop);
}

requestAnimationFrame(gameLoop);
