// Игра "Катапульта"
// Кликни как можно больше за 10 секунд!

const GAME_DURATION = 10; // секунд
const MAX_EXPECTED_CLICKS = 100; // ожидаемое максимальное количество кликов

// Play.fun SDK
let playfunSDK = null;
const PLAFUN_GAME_ID = 'YOUR_GAME_ID_HERE'; // TODO: Замени на реальный gameId с play.fun

// Состояние игры
let gameState = {
    isPlaying: false,
    clicks: 0,
    timeLeft: GAME_DURATION,
    timerInterval: null,
    maxClicks: 0
};

// DOM элементы
const screens = {
    start: document.getElementById('start-screen'),
    game: document.getElementById('game-screen'),
    result: document.getElementById('result-screen')
};

const elements = {
    startBtn: document.getElementById('start-btn'),
    clickBtn: document.getElementById('click-btn'),
    restartBtn: document.getElementById('restart-btn'),
    timeDisplay: document.getElementById('time-display'),
    clicksDisplay: document.getElementById('clicks-display'),
    powerFill: document.getElementById('power-fill'),
    finalClicks: document.getElementById('final-clicks'),
    finalDistance: document.getElementById('final-distance'),
    distanceMarker: document.getElementById('distance-marker'),
    resultMessage: document.getElementById('result-message'),
    catapult: document.getElementById('catapult'),
    cannonball: document.getElementById('cannonball')
};

// Функция переключения экранов
function showScreen(screenName) {
    Object.values(screens).forEach(screen => {
        screen.classList.remove('active');
    });
    screens[screenName].classList.add('active');
}

// Функция запуска игры
function startGame() {
    // Сброс состояния
    gameState.clicks = 0;
    gameState.timeLeft = GAME_DURATION;
    gameState.isPlaying = true;

    // Сброс UI
    elements.timeDisplay.textContent = GAME_DURATION;
    elements.clicksDisplay.textContent = '0';
    elements.powerFill.style.width = '0%';

    // Переключение на игровой экран
    showScreen('game');

    // Запуск таймера
    gameState.timerInterval = setInterval(updateTimer, 1000);
}

// Обновление таймера
function updateTimer() {
    gameState.timeLeft--;
    elements.timeDisplay.textContent = gameState.timeLeft;

    // Изменение цвета таймера при малом времени
    if (gameState.timeLeft <= 3) {
        elements.timeDisplay.style.color = '#e76f51';
    } else {
        elements.timeDisplay.style.color = '#f4a261';
    }

    if (gameState.timeLeft <= 0) {
        endGame();
    }
}

// Обработка клика
function handleClick() {
    if (!gameState.isPlaying) return;

    gameState.clicks++;
    elements.clicksDisplay.textContent = gameState.clicks;

    // Добавляем очки в Play.fun
    addPlayfunPoints(10);

    // Обновление прогресс-бара
    const power = Math.min((gameState.clicks / MAX_EXPECTED_CLICKS) * 100, 100);
    elements.powerFill.style.width = power + '%';

    // Анимация катапульты
    animateCatapult();
}

// Анимация катапульты при клике
function animateCatapult() {
    elements.catapult.classList.add('cocking');
    setTimeout(() => {
        elements.catapult.classList.remove('cocking');
    }, 50);
}

// Завершение игры
function endGame() {
    gameState.isPlaying = false;
    clearInterval(gameState.timerInterval);

    // Сохраняем очки в Play.fun
    savePlayfunPoints();

    // Сохраняем максимальное количество кликов для анимации
    gameState.maxClicks = gameState.clicks;

    // Запуск анимации броска
    launchProjectile();
}

// Анимация броска ядра
function launchProjectile() {
    // Анимация катапульты
    elements.catapult.classList.add('launch');

    // Показываем и запускаем ядро
    setTimeout(() => {
        elements.cannonball.classList.add('flying');

        // Рассчитываем расстояние
        const distance = calculateDistance(gameState.maxClicks);
        
        // Устанавливаем CSS переменную для позиции приземления
        elements.cannonball.style.setProperty('--distance', (distance * 0.7) + '%');

        // После окончания анимации - показываем результат
        setTimeout(() => {
            showResult(distance);
        }, 1500);
    }, 200);
}

// Расчёт дальности броска
function calculateDistance(clicks) {
    // Базовая дальность 10м + бонус за клики
    const baseDistance = 10;
    const bonusPerClick = 2; // 2 метра за каждый клик сверх порога
    const threshold = 5; // порог для начала начисления бонуса

    if (clicks <= threshold) {
        return baseDistance + Math.floor(clicks / 2);
    }

    return Math.min(baseDistance + (clicks - threshold) * bonusPerClick, 500);
}

// Показ результата
function showResult(distance) {
    // Обновление данных
    elements.finalClicks.textContent = gameState.maxClicks;
    elements.finalDistance.textContent = distance;

    // Позиционирование маркера
    const maxDistance = 500;
    const position = Math.min((distance / maxDistance) * 90, 90);
    elements.distanceMarker.style.left = position + '%';

    // Сообщение в зависимости от результата
    const message = getResultMessage(distance);
    elements.resultMessage.textContent = message;

    // Сброс анимаций
    elements.catapult.classList.remove('launch');
    elements.cannonball.classList.remove('flying');

    // Переключение на экран результата
    showScreen('result');
}

// Генерация сообщения результата
function getResultMessage(distance) {
    if (distance < 20) {
        return "🧱 Еле докатилось... Попробуй быстрее кликать!";
    } else if (distance < 50) {
        return "🎯 Неплохо! Но можно лучше!";
    } else if (distance < 100) {
        return "💪 Хороший бросок! Есть потенциал!";
    } else if (distance < 200) {
        return "🔥 Отличный результат! Мастер клика!";
    } else if (distance < 350) {
        return "🏆 Великолепно! Легендарный метатель!";
    } else {
        return "👑 ЛЕГЕНДА! Твой голос услышали боги кликинга!";
    }
}

// Сброс игры
function resetGame() {
    // Сброс состояния
    gameState.isPlaying = false;
    gameState.clicks = 0;
    gameState.timeLeft = GAME_DURATION;
    clearInterval(gameState.timerInterval);

    // Сброс UI
    elements.timeDisplay.style.color = '#f4a261';
    elements.clicksDisplay.textContent = '0';
    elements.powerFill.style.width = '0%';

    // Возврат на стартовый экран
    showScreen('start');
}

// Инициализация событий
function init() {
    // Инициализация Play.fun SDK
    initPlayfunSDK();
    
    elements.startBtn.addEventListener('click', startGame);
    elements.clickBtn.addEventListener('click', handleClick);
    elements.restartBtn.addEventListener('click', resetGame);

    // Поддержка клавиши пробел для клика
    document.addEventListener('keydown', (e) => {
        if (e.code === 'Space' && gameState.isPlaying) {
            e.preventDefault();
            handleClick();
        }
    });
}

// Инициализация Play.fun SDK
function initPlayfunSDK() {
    if (typeof OpenGameSDK === 'undefined') {
        console.log('Play.fun SDK не загружен - игра работает в демо режиме');
        return;
    }
    
    playfunSDK = new OpenGameSDK({
        gameId: PLAFUN_GAME_ID,
        ui: { usePointsWidget: true }
    });
    
    playfunSDK.init().then(() => {
        console.log('Play.fun SDK готов!');
    }).catch(err => {
        console.log('Ошибка инициализации SDK:', err);
    });
}

// Добавить очки в Play.fun
function addPlayfunPoints(points) {
    if (playfunSDK) {
        playfunSDK.addPoints(points);
    }
}

// Сохранить очки в Play.fun
async function savePlayfunPoints() {
    if (playfunSDK) {
        try {
            await playfunSDK.savePoints();
            console.log('Очки сохранены на Play.fun');
        } catch (err) {
            console.log('Ошибка сохранения очков:', err);
        }
    }
}

// Запуск при загрузке
document.addEventListener('DOMContentLoaded', init);
