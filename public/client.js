const socket = io();

const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');

canvas.width = window.innerWidth;
canvas.height = window.innerHeight;

let players = {};
let targetX = null;
let targetY = null;
const speed = 5;

// Handle window resize
window.addEventListener('resize', () => {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
});

// Socket events
socket.on('currentPlayers', (currentPlayers) => {
    players = currentPlayers;
});

socket.on('newPlayer', (playerInfo) => {
    players[playerInfo.id] = playerInfo;
});

socket.on('playerMoved', (playerInfo) => {
    players[playerInfo.id].x = playerInfo.x;
    players[playerInfo.id].y = playerInfo.y;
});

socket.on('playerDisconnected', (playerId) => {
    delete players[playerId];
});

// Mouse input for movement (Albion Online style)
canvas.addEventListener('contextmenu', (e) => {
    e.preventDefault(); // Prevent default right-click menu
    targetX = e.clientX;
    targetY = e.clientY;
});

// For simplicity, let's also allow left-click to move
canvas.addEventListener('click', (e) => {
    targetX = e.clientX;
    targetY = e.clientY;
});


function update() {
    if (!players[socket.id]) return;

    const myPlayer = players[socket.id];

    if (targetX !== null && targetY !== null) {
        const dx = targetX - myPlayer.x;
        const dy = targetY - myPlayer.y;
        const distance = Math.sqrt(dx * dx + dy * dy);

        if (distance > speed) {
            myPlayer.x += (dx / distance) * speed;
            myPlayer.y += (dy / distance) * speed;

            // Emit new position
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

    // Draw target marker
    if (targetX !== null && targetY !== null) {
        ctx.beginPath();
        ctx.arc(targetX, targetY, 5, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(255, 255, 255, 0.5)';
        ctx.fill();
        ctx.closePath();
    }

    // Draw all players
    Object.values(players).forEach(player => {
        ctx.beginPath();
        ctx.arc(player.x, player.y, 15, 0, Math.PI * 2);
        ctx.fillStyle = player.color;
        ctx.fill();

        // Draw stroke for my player
        if(player.id === socket.id) {
             ctx.strokeStyle = 'white';
             ctx.lineWidth = 2;
             ctx.stroke();
        }

        ctx.closePath();

        // Optional: Draw name/ID
        ctx.fillStyle = 'black';
        ctx.font = '10px Arial';
        ctx.textAlign = 'center';
        ctx.fillText(player.id.substring(0, 4), player.x, player.y - 20);
    });
}

function gameLoop() {
    update();
    draw();
    requestAnimationFrame(gameLoop);
}

// Start game loop
requestAnimationFrame(gameLoop);
