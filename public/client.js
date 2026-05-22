// Authentication / Persistence
let myToken = localStorage.getItem('playerToken');
if (!myToken) {
    myToken = 'player_' + Math.random().toString(36).substr(2, 9);
    localStorage.setItem('playerToken', myToken);
}

const socket = io({
    auth: { token: myToken }
});

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

// --- LOCAL STATE ---
let entities = new Map();
let myEntityId = null;
let mapData = { width: 2000, height: 2000 };
let myStats = { mana: 100, maxMana: 100, inventory: { wood: 0, stone: 0 } };

let selectedTargetId = null;
let mouseWorldPos = { x: 0, y: 0 };
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
    e.preventDefault(); // Just prevent context menu, don't map action
});

canvas.addEventListener('mousedown', (e) => {
    if (e.button !== 0) return; // Only Left click
    if (document.activeElement === chatInput) chatInput.blur();
    const worldX = e.clientX + camera.x;
    const worldY = e.clientY + camera.y;
    handleInteraction(worldX, worldY);
});

canvas.addEventListener('mousemove', (e) => {
    mouseWorldPos.x = e.clientX + camera.x;
    mouseWorldPos.y = e.clientY + camera.y;
});

window.addEventListener('keydown', (e) => {
    if (document.activeElement === chatInput) return;
    if (e.key.toLowerCase() === 'q') {
        socket.emit('castSpell', { x: mouseWorldPos.x, y: mouseWorldPos.y });
    }
    if (e.key === 'Escape') {
        selectedTargetId = null;
        updateTargetUI();
    }
});

// --- NETWORKING (ECS Event-Driven) ---

socket.on('initMap', (data) => {
    mapData.width = data.width;
    mapData.height = data.height;
    myEntityId = data.myEntityId;
});

socket.on('entityAppeared', (state) => {
    entities.set(state.id, state);
    if (state.id === myEntityId) updateUI();
});

socket.on('entityDisappeared', (id) => {
    entities.delete(id);
    if (selectedTargetId === id) {
        selectedTargetId = null;
        updateTargetUI();
    }
});

socket.on('entityMoved', (data) => {
    let e = entities.get(data.id);
    if (e && e.pos) {
        if (data.targetX !== undefined) {
            e.targetX = data.targetX;
            e.targetY = data.targetY;
        } else {
            e.pos.x = data.x;
            e.pos.y = data.y;
            e.targetX = null;
            e.targetY = null;
        }
    }
});

socket.on('entityUpdated', (data) => {
    let e = entities.get(data.id);
    if (e) {
        if (data.hp) e.hp = data.hp;
        if (data.res) e.res = data.res;

        if (data.id === myEntityId) updateUI();
        if (data.id === selectedTargetId) updateTargetUI();
    }
});

socket.on('myStats', (data) => {
    myStats.mana = data.mana;
    myStats.maxMana = data.maxMana;
    myStats.inventory = data.inventory;
    updateUI();
});

socket.on('chatMessage', (msg) => {
    const p = document.createElement('p');
    if (msg.sender === 'System') p.className = 'sys-msg';
    const strong = document.createElement('strong');
    strong.textContent = `${msg.sender}: `;
    p.appendChild(strong);
    p.appendChild(document.createTextNode(msg.text));
    chatMessages.appendChild(p);
    chatMessages.scrollTop = chatMessages.scrollHeight;
});


// --- LOGIC ---

function handleInteraction(worldX, worldY) {
    let myEntity = entities.get(myEntityId);
    if (!myEntity || !myEntity.hp || myEntity.hp.current <= 0) return;

    let clickedId = null;

    // Check click against entities
    for (let [id, e] of entities) {
        if (id === myEntityId) continue;
        if (!e.pos) continue;
        if (e.app && e.app.type === 'projectile') continue;

        let radius = e.isPlayer ? 20 : 30;
        if (Math.hypot(worldX - e.pos.x, worldY - e.pos.y) < radius) {
            clickedId = id;
            break;
        }
    }

    selectedTargetId = clickedId;
    updateTargetUI();

    if (selectedTargetId) {
        let target = entities.get(selectedTargetId);
        if (target) {
            if (target.res && target.res.amount > 0) {
                if (Math.hypot(myEntity.pos.x - target.pos.x, myEntity.pos.y - target.pos.y) < 60) {
                    socket.emit('gather', selectedTargetId);
                    myEntity.targetX = null;
                    socket.emit('setMoveTarget', { x: myEntity.pos.x, y: myEntity.pos.y });
                    return;
                }
                socket.emit('setMoveTarget', { x: target.pos.x, y: target.pos.y });
                return;
            } else if (target.isPlayer && target.hp && target.hp.current > 0) {
                if (Math.hypot(myEntity.pos.x - target.pos.x, myEntity.pos.y - target.pos.y) < 80) {
                    socket.emit('attack', selectedTargetId);
                    myEntity.targetX = null;
                    socket.emit('setMoveTarget', { x: myEntity.pos.x, y: myEntity.pos.y });
                    return;
                }
                socket.emit('setMoveTarget', { x: target.pos.x, y: target.pos.y });
                return;
            }
        }
    }

    // If clicked empty space, just move
    socket.emit('setMoveTarget', { x: worldX, y: worldY });
}


// --- UI UPADTERS ---
function updateUI() {
    let myEntity = entities.get(myEntityId);
    if (!myEntity || !myEntity.hp) return;

    healthFill.style.width = `${(myEntity.hp.current / myEntity.hp.max) * 100}%`;
    healthText.innerText = `${Math.floor(myEntity.hp.current)} / ${myEntity.hp.max}`;

    manaFill.style.width = `${(myStats.mana / myStats.maxMana) * 100}%`;
    manaText.innerText = `${Math.floor(myStats.mana)} / ${myStats.maxMana}`;

    invWood.innerText = myStats.inventory.wood;
    invStone.innerText = myStats.inventory.stone;
}

function updateTargetUI() {
    let target = entities.get(selectedTargetId);
    if (!target) {
        targetFrame.classList.add('hidden');
        return;
    }

    if (target.isPlayer && target.hp) {
        targetFrame.classList.remove('hidden');
        targetNameText.innerText = `Player`; // Or use ID substring if passed
        targetHealthFill.style.width = `${(target.hp.current / target.hp.max) * 100}%`;
        targetHealthText.innerText = `${Math.floor(target.hp.current)} / ${target.hp.max}`;
    } else if (target.res) {
        targetFrame.classList.remove('hidden');
        targetNameText.innerText = target.app.subtype === 'tree' ? 'Tree' : 'Rock Node';
        targetHealthFill.style.width = `${(target.res.amount / 50) * 100}%`;
        targetHealthText.innerText = `${target.res.amount} / 50`;
    } else {
        targetFrame.classList.add('hidden');
    }
}


// --- ENGINE ---

let lastTime = performance.now();
const SPEED = 5;

function update(dt) {
    let myEntity = entities.get(myEntityId);
    if (myEntity && myEntity.pos) {
        camera.x = myEntity.pos.x - canvas.width / 2;
        camera.y = myEntity.pos.y - canvas.height / 2;
        camera.x = Math.max(0, Math.min(camera.x, mapData.width - canvas.width));
        camera.y = Math.max(0, Math.min(camera.y, mapData.height - canvas.height));
    }

    // Client-side interpolation/prediction
    for (let [id, e] of entities) {
        if (e.pos && e.targetX !== undefined && e.targetX !== null && e.targetY !== null) {
            let dx = e.targetX - e.pos.x;
            let dy = e.targetY - e.pos.y;
            let dist = Math.hypot(dx, dy);

            // Assuming 30 FPS server ticks, client runs at ~60.
            // So speed per frame needs to match server speed.
            // Server speed is 5 units per tick (30 ticks/sec).
            // Frame rate independence is better, but simple step for now:
            let frameSpeed = SPEED * (dt / (1000/30));

            if (dist > frameSpeed) {
                e.pos.x += (dx / dist) * frameSpeed;
                e.pos.y += (dy / dist) * frameSpeed;
            } else {
                e.pos.x = e.targetX;
                e.pos.y = e.targetY;
                e.targetX = null;
                e.targetY = null;
            }
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
    ctx.fillStyle = isEnemy ? 'rgba(255, 0, 0, 0.2)' : 'rgba(255, 255, 0, 0.2)';
    ctx.fill();
}

function draw() {
    ctx.fillStyle = '#1a1c23';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    ctx.save();
    ctx.translate(-camera.x, -camera.y);

    ctx.fillStyle = '#4a752c';
    ctx.fillRect(0, 0, mapData.width, mapData.height);

    ctx.strokeStyle = 'rgba(255,255,255,0.05)';
    ctx.lineWidth = 1;
    for(let i=0; i<mapData.width; i+=100) {
        ctx.beginPath(); ctx.moveTo(i, 0); ctx.lineTo(i, mapData.height); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(0, i); ctx.lineTo(mapData.width, i); ctx.stroke();
    }

    // Move Marker (only for my entity)
    let myEntity = entities.get(myEntityId);
    if (myEntity && myEntity.targetX !== null && myEntity.targetX !== undefined) {
        ctx.beginPath();
        ctx.ellipse(myEntity.targetX, myEntity.targetY, 15, 8, 0, 0, Math.PI * 2);
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.6)';
        ctx.stroke();
    }

    if (selectedTargetId) {
        let t = entities.get(selectedTargetId);
        if (t && t.pos) {
            drawSelectionRing(ctx, t.pos.x, t.pos.y, t.isPlayer ? 15 : 20, t.isPlayer);
        }
    }

    let renderables = Array.from(entities.values()).filter(e => e.pos).sort((a, b) => a.pos.y - b.pos.y);

    renderables.forEach(e => {
        if (!e.app) return;

        let x = e.pos.x;
        let y = e.pos.y;

        if (e.app.type === 'resource') {
            if (e.res && e.res.amount <= 0) return;
            drawShadow(ctx, x, y, 20);
            if (e.app.subtype === 'tree') {
                ctx.fillStyle = '#5c4033';
                ctx.fillRect(x - 4, y - 20, 8, 20);
                ctx.beginPath(); ctx.arc(x, y - 25, 25, 0, Math.PI * 2);
                ctx.fillStyle = '#228B22'; ctx.fill();
                ctx.strokeStyle = '#1a5e1a'; ctx.lineWidth = 2; ctx.stroke();
            } else {
                ctx.beginPath(); ctx.moveTo(x - 15, y - 10); ctx.lineTo(x, y - 20); ctx.lineTo(x + 20, y - 5); ctx.lineTo(x + 10, y + 10); ctx.lineTo(x - 10, y + 15);
                ctx.fillStyle = '#666'; ctx.fill();
                ctx.beginPath(); ctx.moveTo(x - 15, y - 10); ctx.lineTo(x, y - 20); ctx.lineTo(x + 5, y - 5);
                ctx.fillStyle = '#888'; ctx.fill();
            }
        } else if (e.isPlayer) {
            if (e.hp && e.hp.current <= 0) return;
            drawShadow(ctx, x, y, 15);
            ctx.beginPath(); ctx.arc(x, y - 15, 15, 0, Math.PI * 2);
            ctx.fillStyle = e.app.color; ctx.fill();
            ctx.strokeStyle = '#222'; ctx.lineWidth = 2; ctx.stroke();

            if (e.id !== myEntityId) {
                const bw = 30, bh = 4;
                ctx.fillStyle = '#111'; ctx.fillRect(x - bw/2, y - 45, bw, bh);
                ctx.fillStyle = '#d32f2f'; ctx.fillRect(x - bw/2, y - 45, bw * (e.hp.current/e.hp.max), bh);
            }
        } else if (e.app.type === 'projectile') {
            drawShadow(ctx, x, y, 8);
            ctx.beginPath(); ctx.arc(x, y - 10, 8, 0, Math.PI * 2);
            const grd = ctx.createRadialGradient(x, y-10, 0, x, y-10, 8);
            grd.addColorStop(0, "yellow"); grd.addColorStop(1, "red");
            ctx.fillStyle = grd; ctx.fill();
        }
    });

    ctx.restore();
}

function gameLoop(time) {
    let dt = time - lastTime;
    lastTime = time;
    update(dt);
    draw();
    requestAnimationFrame(gameLoop);
}

requestAnimationFrame(gameLoop);
