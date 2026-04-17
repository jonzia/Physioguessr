// ============================================
// MULTIPLAYER / LOBBY SYSTEM
// ============================================

// Lobby elements
const lobbyScreen = document.getElementById('lobby-screen');
const gameContainer = document.querySelector('.game-container');
const createRoomBtn = document.getElementById('create-room-btn');
const joinRoomBtn = document.getElementById('join-room-btn');
const createRoomPanel = document.getElementById('create-room-panel');
const joinRoomPanel = document.getElementById('join-room-panel');
const timerSetting = document.getElementById('timer-setting');
const roomCodeDisplay = document.getElementById('room-code-display');
const startGameBtn = document.getElementById('start-game-btn');
const playersList = document.getElementById('players-list');
const roomCodeInput = document.getElementById('room-code-input');
const joinRoomSubmitBtn = document.getElementById('join-room-submit-btn');
const joinError = document.getElementById('join-error');
const endGameResultsBtn = document.getElementById('end-game-results-btn');
const waitingMessage = document.getElementById('waiting-message');
const waitingTimer = document.getElementById('waiting-timer');
const otherPlayersMarkers = document.getElementById('other-players-markers');
const playerNameInput = document.getElementById('player-name-input');
const timerDisplay = document.getElementById('timer-display');
const timerValue = document.getElementById('timer-value');
const playerNameDisplay = document.getElementById('player-name-display');
const leaderboardList = document.getElementById('leaderboard-list');
const singlePlayerBtn = document.getElementById('single-player-btn');

// Lobby menu buttons
const lobbyMenu = document.querySelector('.lobby-menu');

// Multiplayer state
let currentRoomCode = null;
let isRoomCreator = false;
let playerName = ''
let roomRef = null;
let playersRef = null;
let roundTimer = null;
let timeRemaining = 30;
let hasSubmittedThisRound = false;
let resultsTimeout = null;
let submissionListener = null;
let nextRoundListener = null;
let roundChangeListener = null;
let waitingCountdown = null;
let autoAdvanceCountdown = null;
let lastSeenRound = 0; // Track last round we processed
let hasGameStarted = false;
let lastPlayerCount = 0;

// Track player presence in Firebase
function setupPresenceTracking() {
    if (!currentRoomCode || !playerName) return;
    
    // Create a reference to this player's connection status
    const playerPresenceRef = playersRef.doc(playerName);
    
    // When the client disconnects, remove them from the room
    playerPresenceRef.onSnapshot(() => {}, () => {
        // Error callback - connection lost
        console.log('Connection lost');
    });
    
    // Update last seen timestamp every 5 seconds
    const presenceInterval = setInterval(async () => {
        if (playerPresenceRef && currentRoomCode) {
            try {
                await playerPresenceRef.update({
                    lastSeen: firebase.firestore.FieldValue.serverTimestamp()
                });
            } catch (error) {
                console.log('Presence update failed:', error);
                clearInterval(presenceInterval);
            }
        } else {
            clearInterval(presenceInterval);
        }
    }, 5000);
    
    // Clean up on page unload
    window.addEventListener('beforeunload', async () => {
        clearInterval(presenceInterval);
        await handlePlayerDisconnect();
    });
}

// Handle player disconnect
async function handlePlayerDisconnect() {
    if (!currentRoomCode || !playerName || !playersRef) return;
    
    try {
        // Remove player from room
        await playersRef.doc(playerName).delete();
        console.log('Player removed from room');
        
        // If creator left during lobby, mark room as abandoned
        if (isRoomCreator && roomRef) {
            const roomDoc = await roomRef.get();
            if (roomDoc.exists && roomDoc.data().status === 'waiting') {
                await roomRef.update({ status: 'abandoned' });
            }
        }
    } catch (error) {
        console.log('Disconnect cleanup error:', error);
    }
}

// Check for inactive players (call this periodically during game)
async function checkForDisconnectedPlayers() {
    if (!playersRef || !currentRoomCode) return;
    
    const now = Date.now();
    const timeout = 15000; // 15 seconds without update = disconnected
    
    const snapshot = await playersRef.get();
    
    snapshot.forEach(async (doc) => {
        const playerData = doc.data();
        const lastSeen = playerData.lastSeen?.toMillis() || 0;
        
        if (now - lastSeen > timeout) {
            console.log(`Player ${doc.id} disconnected (inactive)`);
            
            // Show notification
            showNotification(`${doc.id} disconnected`);
            
            // Remove from Firebase
            await playersRef.doc(doc.id).delete();
        }
    });
}

// Show toast notification
function showNotification(message) {
    // We'll implement a simple toast notification
    const toast = document.createElement('div');
    toast.className = 'toast-notification';
    toast.textContent = message;
    document.body.appendChild(toast);
    
    setTimeout(() => {
        toast.classList.add('show');
    }, 100);
    
    setTimeout(() => {
        toast.classList.remove('show');
        setTimeout(() => toast.remove(), 300);
    }, 3000);
}

// Get player name from input or generate from user
function getPlayerName() {
    // Use display name input (new auth system)
    if (displayNameInput && displayNameInput.value.trim().length > 0) {
        return displayNameInput.value.trim();
    }
    
    // Fallback to user's Google name or random
    if (currentUser) {
        return currentUser.displayName || `Player-${currentUser.uid.substr(0, 6)}`;
    }
    
    return 'Player-' + Math.random().toString(36).substr(2, 4).toUpperCase();
}

// Generate random room code
function generateRoomCode() {
    return Math.random().toString(36).substr(2, 6).toUpperCase();
}

singlePlayerBtn.addEventListener('click', () => {
    // Check if signed in
    if (!currentUser) {
        alert('Please sign in or play as guest first');
        return;
    }
    
    // Get player name from display name input
    playerName = getPlayerName();
    
    // Set single-player mode (no room)
    currentRoomCode = null;
    isRoomCreator = false;
    
    // Remove lobby and show game
    lobbyScreen.remove();
    gameContainer.classList.remove('hidden');
    gameContainer.style.display = 'flex';
    
    // Display player name
    playerNameDisplay.textContent = playerName;
    
    // Show end game button for single player (to return to menu)
    endGameBtn.style.display = 'block';  // CHANGED from 'none'
    endGameBtn.textContent = 'End Game';  // ADD THIS
    
    // Reset game state
    currentRound = 1;
    totalScore = 0;
    usedQuestions = [];
    scoreDisplay.textContent = totalScore;
    currentRoundDisplay.textContent = currentRound;
    
    // Start game
    loadNewQuestion();
    
    console.log('Single player mode started');
});

// Create Room
createRoomBtn.addEventListener('click', async () => {
    // Check if signed in
    if (!currentUser) {
        alert('Please sign in or play as guest first');
        return;
    }
    
    // Rate limit check
    if (!checkRateLimit('createRoom', 3, 60000)) {
        alert('Too many rooms created. Please wait a minute.');
        return;
    }
    
    // Get player name from auth
    playerName = currentUser.displayName || `Player-${currentUser.uid.substr(0, 6)}`;
    
    lobbyMenu.classList.add('hidden');
    createRoomPanel.classList.remove('hidden');
    
    const roomCode = generateRoomCode();
    currentRoomCode = roomCode;
    isRoomCreator = true;
    roomCodeDisplay.textContent = roomCode;
    
    // Create room in Firebase
    roomRef = db.collection('rooms').doc(roomCode);
    await roomRef.set({
        createdAt: firebase.firestore.FieldValue.serverTimestamp(),
        createdBy: playerName,
        timerSeconds: parseInt(timerSetting.value),
        status: 'waiting',
        currentRound: 0,
        questionOrder: []
    });
    
    // Add creator to players
    playersRef = roomRef.collection('players');
    await playersRef.doc(playerName).set({
        name: playerName,
        joinedAt: firebase.firestore.FieldValue.serverTimestamp(),
        isCreator: true,
        score: 0
    });
    
    // Listen for players joining
    listenForPlayers();

    // Creator also listens for game start
    listenForGameStart();

    // Setup presence tracking
    setupPresenceTracking();
    
    console.log('Room created:', roomCode);
});

// Join Room
joinRoomBtn.addEventListener('click', () => {
    lobbyMenu.classList.add('hidden');
    joinRoomPanel.classList.remove('hidden');
});

joinRoomSubmitBtn.addEventListener('click', async () => {
    // Check if signed in
    if (!currentUser) {
        alert('Please sign in or play as guest first');
        return;
    }
    // Rate limit check
    if (!checkRateLimit('joinRoom', 10, 60000)) {
        alert('Too many join attempts. Please wait a minute.');
        return;
    }

    const roomCode = roomCodeInput.value.trim().toUpperCase();
    if (!roomCode) return;
    
    // Get player name
    playerName = getPlayerName();
    
    joinError.classList.add('hidden');
    
    // Check if room exists
    roomRef = db.collection('rooms').doc(roomCode);
    const roomDoc = await roomRef.get();
    
    if (!roomDoc.exists) {
        joinError.classList.remove('hidden');
        joinError.textContent = 'Room not found';
        return;
    }
    
    const roomData = roomDoc.data();
    if (roomData.status !== 'waiting') {
        joinError.textContent = 'Game already in progress';
        joinError.classList.remove('hidden');
        return;
    }
    
    // Check player count
    playersRef = roomRef.collection('players');
    const playersSnapshot = await playersRef.get();
    if (playersSnapshot.size >= 10) {
        joinError.textContent = 'Room is full';
        joinError.classList.remove('hidden');
        return;
    }
    
    // Check if name is already taken in this room
    const existingPlayer = playersSnapshot.docs.find(doc => doc.id === playerName);
    if (existingPlayer) {
        joinError.textContent = 'Name already taken in this room';
        joinError.classList.remove('hidden');
        return;
    }
    
    // Join room
    currentRoomCode = roomCode;
    isRoomCreator = false;
    
    await playersRef.doc(playerName).set({
        name: playerName,
        joinedAt: firebase.firestore.FieldValue.serverTimestamp(),
        isCreator: false,
        score: 0
    });
    
    // Show waiting screen
    joinRoomPanel.classList.add('hidden');
    createRoomPanel.classList.remove('hidden');
    roomCodeDisplay.textContent = roomCode;
    startGameBtn.style.display = 'none';
    document.querySelector('.room-settings').style.display = 'none';
    
    listenForPlayers();
    listenForGameStart();

    // Setup presence tracking
    setupPresenceTracking();
    
    console.log('Joined room:', roomCode);
});

// Listen for players in room
function listenForPlayers() {
    playersRef.onSnapshot((snapshot) => {
        playersList.innerHTML = '';
        snapshot.forEach((doc) => {
            const player = doc.data();
            const li = document.createElement('li');
            li.textContent = player.name + (player.isCreator ? ' (Host)' : '');
            playersList.appendChild(li);
        });
        
        // Enable start button if creator and at least 2 players
        if (isRoomCreator && snapshot.size >= 2) {
            startGameBtn.disabled = false;
        }
    });
}

// Start Game (creator only)
startGameBtn.addEventListener('click', async () => {
    if (!isRoomCreator) return;
    
    const timerValue = parseInt(timerSetting.value);
    console.log('Starting game with timer:', timerValue);
    
    // Generate random question order
    const questionIds = questionsData.questions.map(q => q.id);
    const shuffled = questionIds.sort(() => Math.random() - 0.5).slice(0, 5);
    
    await roomRef.update({
        status: 'playing',
        currentRound: 1,
        questionOrder: shuffled,
        timerSeconds: timerValue,
        roundStartTime: firebase.firestore.FieldValue.serverTimestamp()
    });
    
    console.log('Game started with timer:', timerValue);
});

// Creator also needs to listen for their own game start
if (isRoomCreator) {
    listenForGameStart();
}

function listenForGameStart() {
    roomRef.onSnapshot((doc) => {
        const roomData = doc.data();
        console.log('Room status changed:', roomData.status);
        
        if (roomData.status === 'playing' && !hasGameStarted) {
            hasGameStarted = true;
            startMultiplayerGame(roomData);
        }
    });
}

// Start round timer
function startRoundTimer(seconds) {
    timeRemaining = seconds;
    timerDisplay.classList.remove('hidden', 'warning');
    
    // Reset timer text format
    timerDisplay.innerHTML = `Time: <span id="timer-value">${timeRemaining}</span>s`;
    
    // Re-get the element since we changed innerHTML
    const timerValueSpan = document.getElementById('timer-value');
    
    if (roundTimer) clearInterval(roundTimer);
    
    roundTimer = setInterval(() => {
        timeRemaining--;
        timerValueSpan.textContent = timeRemaining;
        
        // Warning animation at 10 seconds
        if (timeRemaining <= 10) {
            timerDisplay.classList.add('warning');
        }
        
        // Time's up
        if (timeRemaining <= 0) {
            clearInterval(roundTimer);
            autoSubmitRound();
        }
    }, 1000);
}

// Auto-submit when time runs out
function autoSubmitRound() {
    if (!clickPosition) {
        // Set a dummy position for display purposes
        clickPosition = { x: 0, y: 0, slice: 0 };
        
        // MULTIPLAYER: Save 0 points to Firebase
        if (currentRoomCode) {
            hasSubmittedThisRound = true;
            submitBtn.disabled = true;
            
            playersRef.doc(playerName).update({
                [`round${currentRound}`]: {
                    x: 0,
                    y: 0,
                    slice: 0,
                    score: 0,
                    distance: 999,
                    submittedAt: firebase.firestore.FieldValue.serverTimestamp(),
                    timedOut: true
                }
            });
            
            // Show waiting message
            timerDisplay.classList.remove('hidden', 'warning');
            timerDisplay.innerHTML = 'Waiting for other players...';
            
            waitForAllSubmissions();
            return;
        }
    }
    
    // If they did click, trigger normal submit
    submitBtn.click();
}

// Stop timer
function stopRoundTimer() {
    if (roundTimer) {
        clearInterval(roundTimer);
        roundTimer = null;
    }
    timerDisplay.classList.add('hidden');
    timerDisplay.classList.remove('warning');
}

// Listen for room round changes (forces all players to sync)
function listenForRoundChanges() {
    if (roundChangeListener) {
        roundChangeListener();
    }
    
    // Initialize with current round
    lastSeenRound = currentRound;
    
    roundChangeListener = roomRef.onSnapshot((doc) => {
        const roomData = doc.data();
        
        // If room's current round is ahead of what we've processed, force advance
        if (roomData.currentRound > lastSeenRound && roomData.currentRound > currentRound) {
            console.log('Forced to advance to round', roomData.currentRound);
            lastSeenRound = roomData.currentRound;
            
            // Clean up countdown
            if (waitingCountdown) {
                clearInterval(waitingCountdown);
                waitingCountdown = null;
            }
            if (autoAdvanceCountdown) {
                clearInterval(autoAdvanceCountdown);
                autoAdvanceCountdown = null;
            }
            
            // Clean up any pending listeners/timeouts
            if (nextRoundListener) {
                nextRoundListener();
                nextRoundListener = null;
            }
            if (resultsTimeout) {
                clearTimeout(resultsTimeout);
            }
            
            // Hide results and advance
            hideResultsModal();
            currentRound = roomData.currentRound;
            currentRoundDisplay.textContent = currentRound;
            hasSubmittedThisRound = false;
            submitBtn.disabled = false;
            
            // UPDATE SCORE DISPLAY HERE
            scoreDisplay.textContent = totalScore;
            console.log('listenForRoundChanges updated score to:', totalScore);
            
            loadNewQuestion();
            startRoundTimer(roomData.timerSeconds);
        }
        
        // Check if game is over
        if (roomData.status === 'finished') {
            console.log('Game finished!');
            
            // Hide results modal if it's open
            hideResultsModal();
            
            // Clean up listeners
            if (roundChangeListener) {
                roundChangeListener();
                roundChangeListener = null;
            }
            
            // Show game over screen
            showGameOver();
        }
    });
}

// Monitor player count during multiplayer games
function monitorPlayerCount() {
    if (!currentRoomCode || !playersRef) return;
    
    const playerCountListener = playersRef.onSnapshot((snapshot) => {
        const playerCount = snapshot.size;
        
        // Initialize on first call
        if (lastPlayerCount === 0) {
            lastPlayerCount = playerCount;
            console.log('Starting with', playerCount, 'players');
            return;
        }
        
        // Check if someone left
        if (playerCount < lastPlayerCount) {
            const playersLost = lastPlayerCount - playerCount;
            showNotification(`${playersLost} player(s) disconnected (${playerCount} remaining)`);
            lastPlayerCount = playerCount;
        }
        
        console.log('Active players:', playerCount);
        
        // If down to 1 player, end game
        if (playerCount < 2) {
            alert('Not enough players remaining. Returning to lobby.');
            location.reload();
        }
    });
    
    return playerCountListener;
}

// Start multiplayer game for all players
async function startMultiplayerGame(roomData) {
    console.log('startMultiplayerGame called');

    // Start checking for disconnected players every 10 seconds
    const disconnectCheckInterval = setInterval(() => {
        if (currentRoomCode) {
            checkForDisconnectedPlayers();
        } else {
            clearInterval(disconnectCheckInterval);
        }
    }, 10000);
    
    // Fetch fresh room data to get current timer setting
    const freshRoomDoc = await roomRef.get();
    const freshRoomData = freshRoomDoc.data();
    
    // Remove lobby completely from DOM
    lobbyScreen.remove();
    gameContainer.classList.remove('hidden');
    gameContainer.style.display = 'flex';
    
    // Display player name
    playerNameDisplay.textContent = playerName;
    
    // Update end game button text based on role
    if (isRoomCreator) {
        endGameBtn.textContent = 'End Game';
    } else {
        endGameBtn.textContent = 'Exit Game';
    }
    
    // Reset game state
    currentRound = 1;
    totalScore = 0;
    scoreDisplay.textContent = totalScore;
    currentRoundDisplay.textContent = currentRound;
    
    console.log('Game starting with questions:', freshRoomData.questionOrder);
    console.log('Timer set to:', freshRoomData.timerSeconds);
    
    // Load first question
    loadNewQuestion();
    
    // Start timer for first round with FRESH data
    startRoundTimer(freshRoomData.timerSeconds);
    
    // Listen for round changes (forced sync)
    listenForRoundChanges();

    // Monitor for player disconnections
    monitorPlayerCount();
}

// ============================================
// END MULTIPLAYER / LOBBY SYSTEM
// ============================================

// Configuration
const totalSlices = 26;
const totalRounds = 5;
let currentSlice = 13;
let currentRound = 1;
let clickPosition = null;
let currentQuestion = null;
let questionsData = null;
let usedQuestions = [];
let clickMarker = null;

// DOM elements
const brainImg = document.getElementById('brain-slice');
const sliceSlider = document.getElementById('slice-slider');
const sliceNumber = document.getElementById('slice-number');
const totalSlicesSpan = document.getElementById('total-slices');
const submitBtn = document.getElementById('submit-guess');
const endGameBtn = document.getElementById('end-game-btn');
const brainViewer = document.querySelector('.brain-viewer');
const symptomsText = document.getElementById('symptoms');
const scoreDisplay = document.getElementById('score');
const currentRoundDisplay = document.getElementById('current-round');

// Results modal elements
const resultsModal = document.getElementById('results-modal');
const resultsOverlay = document.getElementById('results-overlay');
const resultsSlice = document.getElementById('results-slice');
const correctMarker = document.getElementById('correct-marker');
const playerMarker = document.getElementById('player-marker');
const resultScoreValue = document.getElementById('result-score-value');
const resultDistanceValue = document.getElementById('result-distance-value');
const resultDescription = document.getElementById('result-description');
const resultsRound = document.getElementById('results-round');
const continueBtn = document.getElementById('continue-btn');

// Game over elements
const gameOverDiv = document.getElementById('game-over');
const gameOverOverlay = document.getElementById('game-over-overlay');
const finalScoreDisplay = document.getElementById('final-score');
const newGameBtn = document.getElementById('new-game');

let totalScore = 0;

// Initialize
totalSlicesSpan.textContent = totalSlices;
updateSlice();
loadQuestionsAndStart();

// Window resize handler for both main game and results modal markers
window.addEventListener('resize', () => {
    // Reposition main game marker
    if (clickMarker && clickPosition) {
        positionMainMarker();
    }
    
    // Reposition results modal markers
    if (!resultsModal.classList.contains('hidden')) {
        positionResultMarkers();
    }
});

// Position marker on main game screen
function positionMainMarker() {
    if (!clickMarker || !clickPosition) return;
    
    const rect = brainImg.getBoundingClientRect();
    const viewerRect = brainViewer.getBoundingClientRect();
    
    // Calculate position based on stored relative coordinates
    const x = rect.left - viewerRect.left + (clickPosition.x * rect.width);
    const y = rect.top - viewerRect.top + (clickPosition.y * rect.height);
    
    clickMarker.style.left = x + 'px';
    clickMarker.style.top = y + 'px';
}

// Wait for all players to click continue
function waitForNextRound() {
    // Set 15 second timeout
    resultsTimeout = setTimeout(async () => {
        console.log('Results timeout - advancing anyway');
        if (nextRoundListener) {
            nextRoundListener();
            nextRoundListener = null;
        }
        if (autoAdvanceCountdown) {
            clearInterval(autoAdvanceCountdown);
        }
        
        // Update room to advance round OR end game
        if (currentRound >= totalRounds) {
            // Hide results first, then show game over
            hideResultsModal();
            await roomRef.update({ status: 'finished' });
        } else {
            await roomRef.update({ 
                currentRound: currentRound + 1,
                roundStartTime: firebase.firestore.FieldValue.serverTimestamp()
            });
        }
    }, 15000);
    
    // Remove any existing listener
    if (nextRoundListener) {
        nextRoundListener();
    }
    
    nextRoundListener = playersRef.onSnapshot(async (snapshot) => {
        const players = snapshot.docs;
        const allReady = players.every(doc => {
            const data = doc.data();
            return data[`round${currentRound}Ready`] === true;
        });
        
        if (allReady) {
            console.log('All players ready!');
            clearTimeout(resultsTimeout);
            if (autoAdvanceCountdown) {
                clearInterval(autoAdvanceCountdown);
            }
            
            // Unsubscribe from this listener
            if (nextRoundListener) {
                nextRoundListener();
                nextRoundListener = null;
            }
            
            // Update room to advance round OR end game
            if (currentRound >= totalRounds) {
                // Hide results first, then show game over
                hideResultsModal();
                await roomRef.update({ status: 'finished' });
            } else {
                await roomRef.update({ 
                    currentRound: currentRound + 1,
                    roundStartTime: firebase.firestore.FieldValue.serverTimestamp()
                });
            }
        }
    });
}

// Continue button
continueBtn.addEventListener('click', async () => {
    // MULTIPLAYER: Mark as ready and show waiting state
    if (currentRoomCode) {
        await playersRef.doc(playerName).update({
            [`round${currentRound}Ready`]: true
        });
        
        // Hide continue button, show waiting message
        continueBtn.classList.add('hidden');
        waitingMessage.classList.remove('hidden');
        
        // Show end game button if creator
        if (isRoomCreator) {
            endGameResultsBtn.classList.remove('hidden');
        }
        
        // Don't call waitForNextRound() - it's already running
    } else {
        // SINGLE-PLAYER: Proceed immediately
        hideResultsModal();
        if (currentRound >= totalRounds) {
            showGameOver();
        } else {
            currentRound++;
            currentRoundDisplay.textContent = currentRound;
            loadNewQuestion();
        }
    }
});

// End game from results screen (host only)
endGameResultsBtn.addEventListener('click', async () => {
    if (!isRoomCreator) return;
    
    if (confirm('Are you sure you want to end the game for all players?')) {
        await roomRef.update({ status: 'finished' });
    }
});

// New game button
newGameBtn.addEventListener('click', () => {
    if (currentRoomCode) {
        // Multiplayer: return to lobby
        cleanupAndReturnToLobby();
    } else {
        // Single-player: restart
        startNewGame();
    }
});

// Start new game (single-player)
function startNewGame() {
    currentRound = 1;
    totalScore = 0;
    usedQuestions = [];
    scoreDisplay.textContent = totalScore;
    currentRoundDisplay.textContent = currentRound;
    gameOverDiv.classList.add('hidden');
    gameOverOverlay.classList.add('hidden');
    loadNewQuestion();
}

// Load questions from JSON file
async function loadQuestionsAndStart() {
    try {
        const response = await fetch('questions.json');
        questionsData = await response.json();
        console.log('Loaded questions:', questionsData.questions.length);
        loadNewQuestion();
    } catch (error) {
        console.error('Error loading questions:', error);
        symptomsText.textContent = 'Error loading questions. Make sure questions.json exists.';
    }
}

// Load a random question (single-player) OR next question from room order (multiplayer)
function loadNewQuestion() {
    if (!questionsData) return;
    
    // MULTIPLAYER MODE
    if (currentRoomCode) {
        // Get question from room's predetermined order
        roomRef.get().then((doc) => {
            const roomData = doc.data();
            const questionId = roomData.questionOrder[currentRound - 1];
            currentQuestion = questionsData.questions.find(q => q.id === questionId);
            
            if (currentQuestion) {
                symptomsText.textContent = currentQuestion.prompt;
                clickPosition = null;
                resetView();
                console.log('Multiplayer Round:', currentRound, 'Question:', currentQuestion.id);
            }
        });
        return;
    }
    
    // SINGLE-PLAYER MODE (original logic)
    const availableQuestions = questionsData.questions.filter(
        q => !usedQuestions.includes(q.id)
    );
    
    if (availableQuestions.length === 0) {
        alert('Not enough unique questions in database!');
        return;
    }
    
    const randomIndex = Math.floor(Math.random() * availableQuestions.length);
    currentQuestion = availableQuestions[randomIndex];
    usedQuestions.push(currentQuestion.id);
    
    symptomsText.textContent = currentQuestion.prompt;
    clickPosition = null;
    resetView();
    
    console.log('Round:', currentRound, 'Question:', currentQuestion.id);
}

// Scroll through slices
brainViewer.addEventListener('wheel', (e) => {
    e.preventDefault();
    
    if (e.deltaY > 0) {
        currentSlice = Math.min(currentSlice + 1, totalSlices);
    } else {
        currentSlice = Math.max(currentSlice - 1, 1);
    }
    
    updateSlice();
    updateMarkerOpacity();
});

// Slider to change slices
sliceSlider.addEventListener('input', (e) => {
    currentSlice = parseInt(e.target.value);
    updateSlice();
    updateMarkerOpacity();
});

// Click to mark location
brainImg.addEventListener('click', (e) => {
    const rect = brainImg.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    
    clickPosition = {
        x: x / rect.width,
        y: y / rect.height,
        slice: currentSlice
    };
    
    // Remove old marker if exists
    removeMarker();
    
    // Create new marker
    clickMarker = document.createElement('div');
    clickMarker.className = 'click-marker';
    brainViewer.appendChild(clickMarker);
    
    // Position the marker
    positionMainMarker();
    
    console.log('Clicked position:', clickPosition);
});

// Update marker opacity based on current slice
function updateMarkerOpacity() {
    if (clickMarker && clickPosition) {
        if (currentSlice === clickPosition.slice) {
            clickMarker.style.opacity = '1';
        } else {
            clickMarker.style.opacity = '0.3';
        }
    }
}

// Remove marker
function removeMarker() {
    if (clickMarker) {
        clickMarker.remove();
        clickMarker = null;
    }
}

// Reset to initial state
function resetView() {
    currentSlice = 13;
    updateSlice();
    removeMarker();
}

// Update leaderboard display
function updateLeaderboard(allPlayersData) {
    if (!allPlayersData) return;
    
    // Sort players by total score (descending)
    const sortedPlayers = allPlayersData.sort((a, b) => b.score - a.score);
    
    leaderboardList.innerHTML = '';
    
    sortedPlayers.forEach((player, index) => {
        const item = document.createElement('div');
        item.className = 'leaderboard-item';
        
        // Highlight current player
        if (player.name === playerName) {
            item.classList.add('current-player');
        }
        
        // Rank
        const rank = document.createElement('span');
        rank.className = 'leaderboard-rank';
        if (index === 0) rank.classList.add('first');
        if (index === 1) rank.classList.add('second');
        if (index === 2) rank.classList.add('third');
        rank.textContent = `#${index + 1}`;
        
        // Name
        const name = document.createElement('span');
        name.className = 'leaderboard-name';
        name.textContent = player.name;
        
        // Score container
        const scoreContainer = document.createElement('div');
        
        // Total score
        const totalScore = document.createElement('span');
        totalScore.className = 'leaderboard-score';
        totalScore.textContent = player.score || 0;
        
        // Round score
        const roundData = player[`round${currentRound}`];
        if (roundData) {
            const roundScore = document.createElement('span');
            roundScore.className = 'leaderboard-round-score';
            roundScore.textContent = `(+${roundData.score})`;
            scoreContainer.appendChild(totalScore);
            scoreContainer.appendChild(roundScore);
        } else {
            scoreContainer.appendChild(totalScore);
        }
        
        item.appendChild(rank);
        item.appendChild(name);
        item.appendChild(scoreContainer);
        
        leaderboardList.appendChild(item);
    });
}

// Show results modal
function showResultsModal(score, distance, allPlayersData = null) {
    resultsRound.textContent = currentRound;
    resultScoreValue.textContent = score;
    resultDistanceValue.textContent = distance.toFixed(3);
    resultDescription.textContent = currentQuestion.description;
    
    // Update leaderboard
    if (allPlayersData) {
        updateLeaderboard(allPlayersData);
    }
    
    // Reset continue button state (in case it was hidden from previous round)
    continueBtn.classList.remove('hidden');
    continueBtn.disabled = false;
    continueBtn.textContent = 'Continue';
    continueBtn.style.background = '';
    waitingMessage.classList.add('hidden');
    endGameResultsBtn.classList.add('hidden');
    
    // Set the result image to the correct slice
    const sliceStr = String(currentQuestion.slice).padStart(3, '0');
    resultsSlice.src = `images/slice_${sliceStr}.png`;
    
    // Store allPlayersData for positioning markers after image loads
    resultsSlice.onload = () => {
        positionResultMarkers(allPlayersData);
    };
    
    resultsOverlay.classList.remove('hidden');
    resultsModal.classList.remove('hidden');
}

// Position markers on result image
function positionResultMarkers(allPlayersData = null) {
    const img = resultsSlice;
    const container = img.parentElement;
    
    // Get the actual displayed size of the image
    const imgRect = img.getBoundingClientRect();
    const containerRect = container.getBoundingClientRect();
    
    // Calculate position relative to container
    const imgOffsetX = imgRect.left - containerRect.left;
    const imgOffsetY = imgRect.top - containerRect.top;
    
    // Position correct marker (green)
    const correctX = imgOffsetX + (currentQuestion.x * imgRect.width);
    const correctY = imgOffsetY + (currentQuestion.y * imgRect.height);
    correctMarker.style.left = correctX + 'px';
    correctMarker.style.top = correctY + 'px';
    
    // Position player marker (red)
    const playerX = imgOffsetX + (clickPosition.x * imgRect.width);
    const playerY = imgOffsetY + (clickPosition.y * imgRect.height);
    playerMarker.style.left = playerX + 'px';
    playerMarker.style.top = playerY + 'px';
    
    // Set opacity based on whether player was on correct slice
    if (clickPosition.slice === currentQuestion.slice) {
        playerMarker.style.opacity = '1';
    } else {
        playerMarker.style.opacity = '0.3';
    }
    
    // Clear previous opponent markers
    otherPlayersMarkers.innerHTML = '';
    
    // Add opponent markers (yellow)
    if (allPlayersData && currentRoomCode) {
        allPlayersData.forEach(player => {
            if (player.name === playerName) return; // Skip self
            
            const roundData = player[`round${currentRound}`];
            if (!roundData) return;
            
            const opponentMarker = document.createElement('div');
            opponentMarker.className = 'result-marker opponent-marker';
            
            const opponentX = imgOffsetX + (roundData.x * imgRect.width);
            const opponentY = imgOffsetY + (roundData.y * imgRect.height);
            opponentMarker.style.left = opponentX + 'px';
            opponentMarker.style.top = opponentY + 'px';
            
            // Fade if on wrong slice
            if (roundData.slice !== currentQuestion.slice) {
                opponentMarker.classList.add('faded');
            }
            
            otherPlayersMarkers.appendChild(opponentMarker);
        });
    }
}

// Hide results modal
function hideResultsModal() {
    resultsOverlay.classList.add('hidden');
    resultsModal.classList.add('hidden');
    
    // Reset continue button state
    continueBtn.disabled = false;
    continueBtn.classList.remove('waiting', 'hidden');
    continueBtn.textContent = 'Continue';
    continueBtn.style.background = '';
    waitingMessage.classList.add('hidden');
    endGameResultsBtn.classList.add('hidden');
    
    // Clear countdown
    if (waitingCountdown) {
        clearInterval(waitingCountdown);
        waitingCountdown = null;
    }
    if (autoAdvanceCountdown) {
        clearInterval(autoAdvanceCountdown);
        autoAdvanceCountdown = null;
    }
}

// Show game over screen
function showGameOver() {
    finalScoreDisplay.textContent = totalScore;
    gameOverOverlay.classList.remove('hidden');
    gameOverDiv.classList.remove('hidden');
    
    // For multiplayer, the "New Game" button will reload to lobby
    // For single-player, it calls startNewGame()
}

// Clean up game and return to lobby
function cleanupAndReturnToLobby() {
    // Clean up listeners
    if (roundChangeListener) {
        roundChangeListener();
        roundChangeListener = null;
    }
    if (submissionListener) {
        submissionListener();
        submissionListener = null;
    }
    if (nextRoundListener) {
        nextRoundListener();
        nextRoundListener = null;
    }
    if (resultsTimeout) {
        clearTimeout(resultsTimeout);
        resultsTimeout = null;
    }
    if (roundTimer) {
        clearInterval(roundTimer);
        roundTimer = null;
    }
    
    // Reload page to get fresh lobby
    location.reload();
}

// Start auto-advance countdown (shown to players who haven't clicked continue)
function startAutoAdvanceCountdown() {
    let countdown = 15;
    waitingTimer.textContent = countdown; // Initialize the waiting message timer
    
    autoAdvanceCountdown = setInterval(() => {
        countdown--;
        
        // Update waiting message timer (for players who clicked continue)
        waitingTimer.textContent = countdown;
        
        // Update for players who HAVEN'T clicked continue yet
        if (!continueBtn.classList.contains('hidden')) {
            continueBtn.textContent = `Continue (Auto-advancing in ${countdown}s)`;
            if (countdown <= 5) {
                continueBtn.style.background = '#f44336'; // Red warning
            }
        }
        
        if (countdown <= 0) {
            clearInterval(autoAdvanceCountdown);
        }
    }, 1000);
}

function waitForAllSubmissions() {
    // Remove any existing listener
    if (submissionListener) {
        submissionListener();
    }
    
    submissionListener = playersRef.onSnapshot(async (snapshot) => {
        const players = snapshot.docs;
        const allSubmitted = players.every(doc => {
            const data = doc.data();
            return data[`round${currentRound}`] !== undefined;
        });
        
        if (allSubmitted) {
            console.log('All players submitted!');
            
            // Unsubscribe from this listener
            if (submissionListener) {
                submissionListener();
                submissionListener = null;
            }
            
            // Get room data for current round results
            const roomDoc = await roomRef.get();
            const roomData = roomDoc.data();
            const questionId = roomData.questionOrder[currentRound - 1];
            const question = questionsData.questions.find(q => q.id === questionId);
            
            // Get all players' data
            const allPlayersData = players.map(doc => ({
                name: doc.id,
                ...doc.data()
            }));
            
            // Calculate this player's score for results modal
            const myData = allPlayersData.find(p => p.name === playerName);
            const myRoundData = myData[`round${currentRound}`];
            
            showResultsModal(myRoundData.score, myRoundData.distance, allPlayersData);
            
            // Start the auto-advance countdown AND timeout immediately for all players
            startAutoAdvanceCountdown();
            waitForNextRound(); // This starts the timeout and listener
        }
    });
}


// Submit guess
submitBtn.addEventListener('click', async () => {
    if (!clickPosition) {
        alert('Please click on the brain image to mark the lesion location');
        return;
    }
    
    if (!currentQuestion) {
        alert('No question loaded');
        return;
    }
    
    // Stop timer
    stopRoundTimer();
    
    // Calculate distance (Euclidean distance in 3D space)
    const dx = clickPosition.x - currentQuestion.x;
    const dy = clickPosition.y - currentQuestion.y;
    const dz = (clickPosition.slice - currentQuestion.slice) / totalSlices;
    
    const distance = Math.sqrt(dx*dx + dy*dy + dz*dz);
    
    // Score: max 1000 points, decreases with distance
    const score = Math.max(0, Math.round(1000 * Math.exp(-distance * 3)));

    totalScore += score;

    // Update display for single-player immediately
    if (!currentRoomCode) {
        scoreDisplay.textContent = totalScore;
        console.log('Updated score display to:', totalScore); // DEBUG
    }

    // Update display for single-player immediately
    if (!currentRoomCode) {
        scoreDisplay.textContent = totalScore;
    }

    console.log('Distance:', distance, 'Score:', score, 'Total:', totalScore);
    
    // MULTIPLAYER: Save submission to Firebase
    if (currentRoomCode) {
        hasSubmittedThisRound = true;
        submitBtn.disabled = true;
        
        await playersRef.doc(playerName).update({
            [`round${currentRound}`]: {
                x: clickPosition.x,
                y: clickPosition.y,
                slice: clickPosition.slice,
                score: score,
                distance: distance,
                submittedAt: firebase.firestore.FieldValue.serverTimestamp()
            },
            score: totalScore
        });
        
        console.log('Submission saved to Firebase');
        
        // Show waiting message in timer area (keep structure intact)
        timerDisplay.classList.remove('hidden', 'warning');
        let waitingCountdownMain = timeRemaining; // Capture the current remaining time
        timerDisplay.innerHTML = `Waiting for other players... (<span id="waiting-timer-main">${waitingCountdownMain}</span>s)`;

        // Start countdown in main timer area
        const waitingIntervalMain = setInterval(() => {
            waitingCountdownMain--;
            const timerSpan = document.getElementById('waiting-timer-main');
            if (timerSpan) {
                timerSpan.textContent = waitingCountdownMain;
            }
            if (waitingCountdownMain <= 0) {
                clearInterval(waitingIntervalMain);
            }
        }, 1000);
        
        // Wait for all players or timeout
        waitForAllSubmissions();
    } else {
        // SINGLE-PLAYER: Show results immediately
        showResultsModal(score, distance);
    }
});

// End game / Exit game button
endGameBtn.addEventListener('click', async () => {
    if (currentRoomCode) {
        // Multiplayer mode
        if (isRoomCreator) {
            // Host: End game for everyone
            if (!confirm('Are you sure you want to end the game for all players?')) {
                return;
            }
            await roomRef.update({ status: 'finished' });
        } else {
            // Non-host: Exit to lobby
            if (!confirm('Are you sure you want to exit? The game will continue for other players.')) {
                return;
            }
            
            // Remove self from players
            if (playersRef && playerName) {
                await playersRef.doc(playerName).delete();
            }
            
            // Reload to lobby
            location.reload();
        }
    } else {
        // Single player mode: just return to lobby
        if (confirm('Are you sure you want to end the game?')) {
            location.reload();
        }
    }
});

// Update displayed slice
function updateSlice() {
    const sliceStr = String(currentSlice).padStart(3, '0');
    brainImg.src = `images/slice_${sliceStr}.png`;
    sliceNumber.textContent = currentSlice;
    sliceSlider.value = currentSlice;  // ADD THIS LINE
}

// Clean up on page unload
window.addEventListener('beforeunload', async (e) => {
    if (currentRoomCode && playerName && playersRef) {
        try {
            // Remove player from room
            await playersRef.doc(playerName).delete();
            
            // If creator left, mark room as abandoned
            if (isRoomCreator && roomRef) {
                await roomRef.update({ status: 'abandoned' });
            }
        } catch (error) {
            console.log('Cleanup error:', error);
        }
    }
});

// ============================================
// CLEANUP AND SECURITY
// ============================================

// Cleanup old/abandoned rooms
async function cleanupOldRooms() {
    try {
        const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);
        
        // Query for old rooms
        const oldRooms = await db.collection('rooms')
            .where('createdAt', '<', twoHoursAgo)
            .limit(10)
            .get();
        
        console.log(`Found ${oldRooms.size} old rooms to clean up`);
        
        // Delete old rooms and their players
        for (const doc of oldRooms.docs) {
            const roomRef = doc.ref;
            
            // Delete all players in this room
            const players = await roomRef.collection('players').get();
            const deletePromises = players.docs.map(playerDoc => playerDoc.ref.delete());
            await Promise.all(deletePromises);
            
            // Delete the room itself
            await roomRef.delete();
            console.log(`Deleted old room: ${doc.id}`);
        }
        
        // Also clean up abandoned rooms
        const abandonedRooms = await db.collection('rooms')
            .where('status', '==', 'abandoned')
            .limit(10)
            .get();
        
        console.log(`Found ${abandonedRooms.size} abandoned rooms to clean up`);
        
        for (const doc of abandonedRooms.docs) {
            const roomRef = doc.ref;
            const players = await roomRef.collection('players').get();
            const deletePromises = players.docs.map(playerDoc => playerDoc.ref.delete());
            await Promise.all(deletePromises);
            await roomRef.delete();
            console.log(`Deleted abandoned room: ${doc.id}`);
        }

        // Clean up old matchmaking entries (older than 2 minutes OR matched status)
        const nowForQueue = firebase.firestore.Timestamp.now();
        const twoMinutesAgo = new firebase.firestore.Timestamp(
            nowForQueue.seconds - (2 * 60),  // Changed from 5 to 2 minutes
            nowForQueue.nanoseconds
        );

        // Delete old waiting entries
        const oldQueue = await db.collection('matchmaking')
            .where('joinedAt', '<', twoMinutesAgo)
            .limit(20)
            .get();

        console.log(`Found ${oldQueue.size} old queue entries to clean up`);

        for (const doc of oldQueue.docs) {
            await doc.ref.delete();
            console.log(`Deleted old queue entry: ${doc.id}`);
        }

        // Also delete matched entries (they should have been deleted by the players)
        const matchedQueue = await db.collection('matchmaking')
            .where('status', '==', 'matched')
            .limit(20)
            .get();

        console.log(`Found ${matchedQueue.size} matched entries to clean up`);

        for (const doc of matchedQueue.docs) {
            await doc.ref.delete();
            console.log(`Deleted matched queue entry: ${doc.id}`);
        }
    } catch (error) {
        console.log('Cleanup error:', error);
    }
}

// Rate limiting
const rateLimits = {
    createRoom: { calls: 0, resetTime: Date.now() },
    joinRoom: { calls: 0, resetTime: Date.now() }
};

function checkRateLimit(action, maxCalls = 5, windowMs = 60000) {
    const now = Date.now();
    const limit = rateLimits[action];
    
    // Reset if window expired
    if (now - limit.resetTime > windowMs) {
        limit.calls = 0;
        limit.resetTime = now;
    }
    
    // Check if exceeded
    if (limit.calls >= maxCalls) {
        return false;
    }
    
    limit.calls++;
    return true;
}

// Usage tracking
const usageStats = {
    roomsCreated: 0,
    roomsJoined: 0,
    gamesPlayed: 0
};

function trackRoomCreated() {
    usageStats.roomsCreated++;
    console.log('Usage stats:', usageStats);
    localStorage.setItem('physioguessr-usage', JSON.stringify(usageStats));
}

function trackRoomJoined() {
    usageStats.roomsJoined++;
    localStorage.setItem('physioguessr-usage', JSON.stringify(usageStats));
}

function trackGamePlayed() {
    usageStats.gamesPlayed++;
    localStorage.setItem('physioguessr-usage', JSON.stringify(usageStats));
}

// Load stats on startup
const savedStats = localStorage.getItem('physioguessr-usage');
if (savedStats) {
    Object.assign(usageStats, JSON.parse(savedStats));
}

// Don't run cleanup immediately - wait for auth

// Run cleanup every 10 minutes (will start after first auth)
setInterval(cleanupOldRooms, 10 * 60 * 1000);

// ============================================
// DEBUG COORDINATE PICKER
// ============================================

const debugCoordsBtn = document.getElementById('debug-coords-btn');
const debugModal = document.getElementById('debug-modal');
const debugOverlay = document.getElementById('debug-overlay');
const debugSlice = document.getElementById('debug-slice');
const debugSlider = document.getElementById('debug-slider');
const debugSliceNum = document.getElementById('debug-slice-num');
const debugMarker = document.getElementById('debug-marker');
const debugX = document.getElementById('debug-x');
const debugY = document.getElementById('debug-y');
const debugSliceVal = document.getElementById('debug-slice-val');
const copyCoordsBtn = document.getElementById('copy-coords-btn');
const copyHint = document.getElementById('copy-hint');
const closeDebugBtn = document.getElementById('close-debug-btn');

let debugCurrentSlice = 13;
let debugClickPos = null;

// Open debug modal
debugCoordsBtn.addEventListener('click', () => {
    debugOverlay.classList.remove('hidden');
    debugModal.classList.remove('hidden');
    updateDebugSlice();
});

// Close debug modal
closeDebugBtn.addEventListener('click', () => {
    debugOverlay.classList.add('hidden');
    debugModal.classList.add('hidden');
});

// Slider change
debugSlider.addEventListener('input', (e) => {
    debugCurrentSlice = parseInt(e.target.value);
    updateDebugSlice();
});

// Click on image
debugSlice.addEventListener('click', (e) => {
    const rect = debugSlice.getBoundingClientRect();
    const viewer = document.querySelector('.debug-viewer');
    const viewerRect = viewer.getBoundingClientRect();
    
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    
    debugClickPos = {
        x: (x / rect.width).toFixed(4),
        y: (y / rect.height).toFixed(4),
        slice: debugCurrentSlice
    };
    
    // Position marker relative to viewer container (not image)
    const markerX = e.clientX - viewerRect.left;
    const markerY = e.clientY - viewerRect.top;
    
    debugMarker.style.left = markerX + 'px';
    debugMarker.style.top = markerY + 'px';
    debugMarker.classList.add('show');
    
    // Update output fields
    debugX.value = debugClickPos.x;
    debugY.value = debugClickPos.y;
    debugSliceVal.value = debugClickPos.slice;
});

// Copy coordinates
copyCoordsBtn.addEventListener('click', () => {
    if (!debugClickPos) {
        alert('Click on the image first to select coordinates');
        return;
    }
    
    const coordText = `"x": ${debugClickPos.x},\n"y": ${debugClickPos.y},\n"slice": ${debugClickPos.slice}`;
    
    navigator.clipboard.writeText(coordText).then(() => {
        copyHint.classList.remove('hidden');
        setTimeout(() => {
            copyHint.classList.add('hidden');
        }, 2000);
    });
});

// Update slice image
function updateDebugSlice() {
    const sliceStr = String(debugCurrentSlice).padStart(3, '0');
    debugSlice.src = `images/slice_${sliceStr}.png`;
    debugSliceNum.textContent = debugCurrentSlice;
    
    // Hide marker when changing slices
    debugMarker.classList.remove('show');
}

// ============================================
// AUTHENTICATION
// ============================================

const auth = firebase.auth();
let currentUser = null;

// DOM elements
const signedOutState = document.getElementById('signed-out-state');
const signedInState = document.getElementById('signed-in-state');
const displayNameSection = document.getElementById('display-name-section');
const displayNameInput = document.getElementById('display-name-input');
const googleSigninBtn = document.getElementById('google-signin-btn');
const playAnonymousBtn = document.getElementById('play-anonymous-btn');
const signoutBtn = document.getElementById('signout-btn');
const userPhoto = document.getElementById('user-photo');
const userName = document.getElementById('user-name');

// Listen for auth state changes
auth.onAuthStateChanged((user) => {
    currentUser = user;
    
    if (user) {
        // User is signed in
        console.log('Signed in as:', user.displayName || user.uid);
        
        // Run cleanup now that we're authenticated
        cleanupOldRooms();
        
        // Update UI
        signedOutState.classList.add('hidden');
        signedInState.classList.remove('hidden');
        displayNameSection.classList.remove('hidden');
        
        if (user.isAnonymous) {
            userName.textContent = 'Guest Player';
            userPhoto.src = 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" width="50" height="50"><circle cx="25" cy="25" r="25" fill="%23666"/><text x="25" y="35" text-anchor="middle" fill="white" font-size="24">?</text></svg>';
            displayNameInput.placeholder = 'Enter your display name';
        } else {
            userName.textContent = user.displayName;
            userPhoto.src = user.photoURL || '';
            displayNameInput.value = user.displayName; // Pre-fill with Google name
        }
    } else {
        // User is signed out
        signedOutState.classList.remove('hidden');
        signedInState.classList.add('hidden');
        displayNameSection.classList.add('hidden');
    }
});

// Google Sign In
googleSigninBtn.addEventListener('click', async () => {
    const provider = new firebase.auth.GoogleAuthProvider();
    try {
        await auth.signInWithPopup(provider);
    } catch (error) {
        console.error('Sign in error:', error);
        alert('Sign in failed. Please try again.');
    }
});

// Anonymous Sign In
playAnonymousBtn.addEventListener('click', async () => {
    try {
        await auth.signInAnonymously();
    } catch (error) {
        console.error('Anonymous sign in error:', error);
        alert('Could not start session. Please try again.');
    }
});

// Sign Out
signoutBtn.addEventListener('click', async () => {
    try {
        await auth.signOut();
        playerName = '';
    } catch (error) {
        console.error('Sign out error:', error);
    }
});

// ============================================
// MATCHMAKING SYSTEM
// ============================================

const findMatchBtn = document.getElementById('find-match-btn');
const matchmakingPanel = document.getElementById('matchmaking-panel');
const cancelMatchmakingBtn = document.getElementById('cancel-matchmaking-btn');
const queueCount = document.getElementById('queue-count');

let matchmakingListener = null;
let queueCountListener = null;
let myQueueId = null;

// Find Match
findMatchBtn.addEventListener('click', async () => {
    // Check if signed in
    if (!currentUser) {
        alert('Please sign in or play as guest first');
        return;
    }
    
    // Get player name
    playerName = getPlayerName();
    
    // Show matchmaking panel
    lobbyMenu.classList.add('hidden');
    matchmakingPanel.classList.remove('hidden');
    
    // Add to matchmaking queue
    await joinMatchmakingQueue();
});

// Cancel Matchmaking
cancelMatchmakingBtn.addEventListener('click', async () => {
    await leaveMatchmakingQueue();
    
    // Return to lobby
    matchmakingPanel.classList.add('hidden');
    lobbyMenu.classList.remove('hidden');
});

// Join matchmaking queue
async function joinMatchmakingQueue() {
    try {
        // Reset UI
        document.querySelector('.matchmaking-status').textContent = 'Looking for opponents...';
        cancelMatchmakingBtn.style.display = 'block';
        
        // Add player to queue
        const queueRef = db.collection('matchmaking');
        const queueDoc = await queueRef.add({
            playerId: currentUser.uid,
            playerName: playerName,
            joinedAt: firebase.firestore.FieldValue.serverTimestamp(),
            status: 'waiting'
        });
        
        myQueueId = queueDoc.id;
        console.log('Joined matchmaking queue:', myQueueId);
        
        // Listen for queue changes and matching
        listenForMatchmaking();
        
    } catch (error) {
        console.error('Matchmaking error:', error);
        alert('Could not join matchmaking. Please try again.');
    }
}

// Leave matchmaking queue
async function leaveMatchmakingQueue() {
    if (matchmakingListener) {
        matchmakingListener();
        matchmakingListener = null;
    }
    
    if (queueCountListener) {
        queueCountListener();
        queueCountListener = null;
    }
    
    if (myQueueId) {
        try {
            await db.collection('matchmaking').doc(myQueueId).delete();
            console.log('Left matchmaking queue');
        } catch (error) {
            console.error('Error leaving queue:', error);
        }
        myQueueId = null;
    }
}

// Listen for matchmaking
function listenForMatchmaking() {
    // Listen to our own queue entry for matched status
    const myQueueRef = db.collection('matchmaking').doc(myQueueId);
    
    matchmakingListener = myQueueRef.onSnapshot(async (doc) => {
        if (!doc.exists) return;
        
        const data = doc.data();
        
        // Check if we've been matched
        if (data.status === 'matched' && data.roomCode) {
            console.log('Match found! Joining room:', data.roomCode);
            
            // Update UI to show we're joining
            document.querySelector('.matchmaking-status').textContent = 'Match found! Setting up game...';
            cancelMatchmakingBtn.style.display = 'none';
            
            // Stop listeners first
            if (matchmakingListener) {
                matchmakingListener();
                matchmakingListener = null;
            }
            if (queueCountListener) {
                queueCountListener();
                queueCountListener = null;
            }
            
            // Delete our queue entry immediately
            if (myQueueId) {
                await db.collection('matchmaking').doc(myQueueId).delete();
                myQueueId = null;
            }
            
            // Join the room
            currentRoomCode = data.roomCode;
            roomRef = db.collection('rooms').doc(currentRoomCode);
            playersRef = roomRef.collection('players');
            
            // Check if we're the creator
            const playerDoc = await playersRef.doc(playerName).get();
            if (playerDoc.exists) {
                isRoomCreator = playerDoc.data().isCreator || false;
            }
            
            // Keep matchmaking panel visible until game starts
            // listenForGameStart will hide it when game begins
            
            // Listen for game start
            listenForGameStart();
        }
    });
    
    // Also listen to overall queue to trigger matching AND update count
    const queueRef = db.collection('matchmaking').where('status', '==', 'waiting');
    
    queueCountListener = queueRef.onSnapshot(async (snapshot) => {
        const waitingPlayers = snapshot.docs;
        
        // Update queue count
        queueCount.textContent = waitingPlayers.length;
        
        console.log('Players in queue:', waitingPlayers.length);
        
        // If 2+ players, attempt to create a match
        if (waitingPlayers.length >= 2) {
            // Sort by join time
            const sortedPlayers = waitingPlayers.sort((a, b) => {
                const aTime = a.data().joinedAt?.toMillis() || 0;
                const bTime = b.data().joinedAt?.toMillis() || 0;
                return aTime - bTime;
            });
            
            // Only the first player creates the room
            const firstPlayer = sortedPlayers[0];
            const isFirstPlayer = firstPlayer.id === myQueueId;
            
            if (isFirstPlayer) {
                console.log('I am first player, creating match');
                await createMatchFromQueue(sortedPlayers.slice(0, 2));
            } else {
                console.log('Waiting for match to be created...');
            }
        }
    });
}

// Create a match from queue
async function createMatchFromQueue(playerDocs) {
    try {
        // Check if we already created a room (prevent duplicates)
        const firstDoc = playerDocs[0];
        if (firstDoc.data().status === 'matched') {
            console.log('Match already created, skipping');
            return;
        }
        
        // Generate room code
        const roomCode = generateRoomCode();
        
        console.log('Creating match room:', roomCode, 'with players:', playerDocs.map(d => d.data().playerName));
        
        // Create room
        const newRoomRef = db.collection('rooms').doc(roomCode);
        await newRoomRef.set({
            createdAt: firebase.firestore.FieldValue.serverTimestamp(),
            createdBy: playerDocs[0].data().playerName,
            timerSeconds: 30,
            status: 'waiting',
            currentRound: 0,
            questionOrder: [],
            matchmade: true
        });
        
        const newPlayersRef = newRoomRef.collection('players');
        
        // Add all players to the room
        for (let i = 0; i < playerDocs.length; i++) {
            const data = playerDocs[i].data();
            await newPlayersRef.doc(data.playerName).set({
                name: data.playerName,
                joinedAt: firebase.firestore.FieldValue.serverTimestamp(),
                isCreator: i === 0,
                score: 0
            });
        }
        
        console.log('Players added to room');
        
        // Mark ALL queue entries as matched
        for (const doc of playerDocs) {
            await db.collection('matchmaking').doc(doc.id).update({ 
                status: 'matched',
                roomCode: roomCode 
            });
        }
        
        console.log('All queue entries marked as matched');
        
        // Auto-start game after 3 seconds
        setTimeout(async () => {
            try {
                // Generate question order
                const questionIds = questionsData.questions.map(q => q.id);
                const shuffled = questionIds.sort(() => Math.random() - 0.5).slice(0, 5);
                
                await newRoomRef.update({
                    status: 'playing',
                    currentRound: 1,
                    questionOrder: shuffled,
                    timerSeconds: 30,
                    roundStartTime: firebase.firestore.FieldValue.serverTimestamp()
                });
                
                console.log('Game auto-started');
            } catch (error) {
                console.error('Error starting game:', error);
            }
        }, 3000);
        
    } catch (error) {
        console.error('Error creating match:', error);
    }
}