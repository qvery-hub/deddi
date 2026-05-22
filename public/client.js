const socket = io();

const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');

// UI Elements
const healthFill = document.getElementById('health-bar-fill');
const healthText = document.getElementById('health-text');
const invWood = document.getElementById('inv-wood');
const invStone = document.getElementById('inv-stone');
const chatMessages = document.getElementById('chat-messages');
const chatInput = document.getElementById('chat-input');

canvas.width = window.innerWidth;
canvas.height = window.innerHeight;

let players = {};
let resources = {};
let mapData = { width: 2000, height: 2000 };

let targetX = null;
let targetY = null;
const speed = 5;

// Camera
let camera = { x: 0, y: 0 };

// Handle window resize
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
        // Return focus to game so player can move
        chatInput.blur();
    }
});

// Socket events
socket.on('initData', (data) => {
    players = data.players;
    resources = data.resources;
    mapData = data.map;

    updateUI();
});

socket.on('newPlayer', (playerInfo) => {
    players[playerInfo.id] = playerInfo;
});

socket.on('playerMoved', (playerInfo) => {
    if (players[playerInfo.id]) {
        players[playerInfo.id].x = playerInfo.x;
        players[playerInfo.id].y = playerInfo.y;
    }
});

socket.on('playerDisconnected', (playerId) => {
    delete players[playerId];
});

socket.on('resourceUpdated', (resourceInfo) => {
    if (resources[resourceInfo.id]) {
        resources[resourceInfo.id].amount = resourceInfo.amount;
    }
});

socket.on('inventoryUpdated', (inventory) => {
    if (players[socket.id]) {
        players[socket.id].inventory = inventory;
        updateUI();
    }
});

socket.on('playerHealthUpdated', (data) => {
    if (players[data.id]) {
        players[data.id].health = data.health;
        if (data.id === socket.id) updateUI();
    }
});

socket.on('playerRespawned', (playerInfo) => {
    if (players[playerInfo.id]) {
        players[playerInfo.id].health = playerInfo.health;
        players[playerInfo.id].x = playerInfo.x;
        players[playerInfo.id].y = playerInfo.y;
        if (playerInfo.id === socket.id) {
            targetX = null;
            targetY = null;
            updateUI();
        }
    }
});

socket.on('chatMessage', (msg) => {
    const p = document.createElement('p');
    p.innerHTML = `<strong>${msg.sender}:</strong> ${msg.text}`;
    chatMessages.appendChild(p);
    chatMessages.scrollTop = chatMessages.scrollHeight; // Auto-scroll
});

function updateUI() {
    const myPlayer = players[socket.id];
    if (!myPlayer) return;

    // Health
    const healthPercent = (myPlayer.health / myPlayer.maxHealth) * 100;
    healthFill.style.width = `${healthPercent}%`;
    healthText.innerText = `${myPlayer.health} / ${myPlayer.maxHealth}`;

    // Inventory
    invWood.innerText = myPlayer.inventory.wood;
    invStone.innerText = myPlayer.inventory.stone;
}

// Mouse input for movement / interaction
canvas.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    if (document.activeElement === chatInput) chatInput.blur();

    // Convert screen coordinates to world coordinates
    const worldX = e.clientX + camera.x;
    const worldY = e.clientY + camera.y;

    handleInteraction(worldX, worldY);
});

canvas.addEventListener('click', (e) => {
    if (document.activeElement === chatInput) return; // Don't move if clicking while typing

    // Convert screen coordinates to world coordinates
    const worldX = e.clientX + camera.x;
    const worldY = e.clientY + camera.y;

    handleInteraction(worldX, worldY);
});

function handleInteraction(worldX, worldY) {
    const myPlayer = players[socket.id];
    if (!myPlayer || myPlayer.health <= 0) return;

    // Check if clicked on a resource
    for (let id in resources) {
        const res = resources[id];
        if (res.amount <= 0) continue;

        const dx = worldX - res.x;
        const dy = worldY - res.y;
        if (Math.sqrt(dx*dx + dy*dy) < 30) {
            // Move to resource then gather
            targetX = res.x;
            targetY = res.y;

            // For simplicity in this prototype, we'll just emit gather if close enough
            // otherwise move towards it. A real game would wait until arrived.
            const distToMe = Math.sqrt(Math.pow(myPlayer.x - res.x, 2) + Math.pow(myPlayer.y - res.y, 2));
            if (distToMe < 50) {
                socket.emit('gather', id);
                targetX = null; targetY = null; // stop moving
            }
            return;
        }
    }

    // Check if clicked on a player (attack)
    for (let id in players) {
        if (id === socket.id) continue;
        const p = players[id];
        if (p.health <= 0) continue;

        const dx = worldX - p.x;
        const dy = worldY - p.y;
        if (Math.sqrt(dx*dx + dy*dy) < 20) {
            targetX = p.x;
            targetY = p.y;

            const distToMe = Math.sqrt(Math.pow(myPlayer.x - p.x, 2) + Math.pow(myPlayer.y - p.y, 2));
            if (distToMe < 60) {
                socket.emit('attack', id);
                targetX = null; targetY = null; // stop moving
            }
            return;
        }
    }

    // Otherwise, just move
    targetX = worldX;
    targetY = worldY;
}


function update() {
    const myPlayer = players[socket.id];
    if (!myPlayer) return;

    // Update camera to center on player
    camera.x = myPlayer.x - canvas.width / 2;
    camera.y = myPlayer.y - canvas.height / 2;

    // Keep camera within map bounds (optional, but good)
    camera.x = Math.max(0, Math.min(camera.x, mapData.width - canvas.width));
    camera.y = Math.max(0, Math.min(camera.y, mapData.height - canvas.height));

    if (myPlayer.health <= 0) {
        targetX = null;
        targetY = null;
        return; // Dead players can't move
    }

    if (targetX !== null && targetY !== null) {
        const dx = targetX - myPlayer.x;
        const dy = targetY - myPlayer.y;
        const distance = Math.sqrt(dx * dx + dy * dy);

        if (distance > speed) {
            myPlayer.x += (dx / distance) * speed;
            myPlayer.y += (dy / distance) * speed;

            // Constrain player to map bounds
            myPlayer.x = Math.max(0, Math.min(myPlayer.x, mapData.width));
            myPlayer.y = Math.max(0, Math.min(myPlayer.y, mapData.height));

            socket.emit('playerMovement', { x: myPlayer.x, y: myPlayer.y });
        } else {
            myPlayer.x = targetX;
            myPlayer.y = targetY;
            targetX = null;
            targetY = null;
            socket.emit('playerMovement', { x: myPlayer.x, y: myPlayer.y });
        }
    }
}

function draw() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    ctx.save();
    // Apply camera transform
    ctx.translate(-camera.x, -camera.y);

    // Draw Map Boundaries
    ctx.strokeStyle = '#555';
    ctx.lineWidth = 5;
    ctx.strokeRect(0, 0, mapData.width, mapData.height);

    // Draw target marker
    if (targetX !== null && targetY !== null) {
        ctx.beginPath();
        ctx.arc(targetX, targetY, 5, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(255, 255, 255, 0.5)';
        ctx.fill();
        ctx.closePath();
    }

    // Draw Resources
    Object.values(resources).forEach(res => {
        if (res.amount <= 0) return; // Depleted

        ctx.beginPath();
        ctx.arc(res.x, res.y, 20, 0, Math.PI * 2);
        if (res.type === 'tree') {
            ctx.fillStyle = '#228B22'; // Forest Green
        } else {
            ctx.fillStyle = '#808080'; // Gray rock
        }
        ctx.fill();
        ctx.strokeStyle = '#111';
        ctx.lineWidth = 2;
        ctx.stroke();
        ctx.closePath();

        // Resource amount
        ctx.fillStyle = 'white';
        ctx.font = '12px Arial';
        ctx.textAlign = 'center';
        ctx.fillText(res.amount, res.x, res.y + 4);
    });

    // Draw all players
    Object.values(players).forEach(player => {
        if (player.health <= 0) return; // Don't draw dead players

        // Player Circle
        ctx.beginPath();
        ctx.arc(player.x, player.y, 15, 0, Math.PI * 2);
        ctx.fillStyle = player.color;
        ctx.fill();

        if(player.id === socket.id) {
             ctx.strokeStyle = 'white';
             ctx.lineWidth = 2;
             ctx.stroke();
        }
        ctx.closePath();

        // Draw Name
        ctx.fillStyle = 'black';
        ctx.font = '12px Arial';
        ctx.textAlign = 'center';
        ctx.fillText(player.id.substring(0, 4), player.x, player.y - 25);

        // Draw Floating Health Bar
        const barWidth = 40;
        const barHeight = 6;
        const hpPercent = player.health / player.maxHealth;

        ctx.fillStyle = '#333'; // bg
        ctx.fillRect(player.x - barWidth/2, player.y - 40, barWidth, barHeight);
        ctx.fillStyle = '#e74c3c'; // hp
        ctx.fillRect(player.x - barWidth/2, player.y - 40, barWidth * hpPercent, barHeight);
        ctx.strokeStyle = '#000';
        ctx.strokeRect(player.x - barWidth/2, player.y - 40, barWidth, barHeight);
    });

    ctx.restore();
}

function gameLoop() {
    update();
    draw();
    requestAnimationFrame(gameLoop);
}

// Start game loop
requestAnimationFrame(gameLoop);
