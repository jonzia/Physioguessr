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
const questionSetSelect = document.getElementById('question-set-select');
const singlePlayerSetSelect = document.getElementById('single-player-set-select');
const singlePlayerPanel = document.getElementById('single-player-panel');
const startSinglePlayerBtn = document.getElementById('start-single-player-btn');
const backFromSingleBtn = document.getElementById('back-from-single-btn');
const lobbyLoading = document.getElementById('lobby-loading');
const leaveWaitingBtn = document.getElementById('leave-waiting-btn');

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
let questionSetsData = null;
let selectedQuestionSet = 'default';
let playerCountListener = null;
let monitoringActive = false;

// Centralized leave room function - UPDATED with all cleanup including mobile
async function leaveRoom() {
    // Stop host presence updates
    if (window.hostPresenceInterval) {
        clearInterval(window.hostPresenceInterval);
        window.hostPresenceInterval = null;
    }
    
    // Stop host presence checker (guest side)
    if (window.hostPresenceChecker) {
        clearInterval(window.hostPresenceChecker);
        window.hostPresenceChecker = null;
    }
    
    // Stop desktop timer
    if (roundTimer) {
        clearInterval(roundTimer);
        roundTimer = null;
    }
    
    // Stop mobile timer
    if (mobileTimer) {
        clearInterval(mobileTimer);
        mobileTimer = null;
    }
    
    // Unsubscribe from desktop timer listener
    if (window.timerUnsubscribe) {
        window.timerUnsubscribe();
        window.timerUnsubscribe = null;
    }
    
    // Unsubscribe from mobile timer listener
    if (window.mobileTimerUnsubscribe) {
        window.mobileTimerUnsubscribe();
        window.mobileTimerUnsubscribe = null;
    }
    
    // Unsubscribe from room monitoring
    if (window.currentRoomUnsubscribe) {
        window.currentRoomUnsubscribe();
        window.currentRoomUnsubscribe = null;
    }
    
    if (currentRoomCode && playerName && playersRef) {
        try {
            // Just remove player from room
            await playersRef.doc(playerName).delete();
            console.log('Player removed from room');
            
            // DON'T mark as abandoned - let presence tracking handle it
            
        } catch (error) {
            console.error('Error leaving room:', error);
        }
    }
    
    // Reset state
    currentRoomCode = null;
    roomRef = null;
    playersRef = null;
    isRoomCreator = false;
    
    // Hide panels and show lobby menu
    const waitingPanel = document.getElementById('waiting-panel');
    waitingPanel.classList.add('hidden');
    createRoomPanel.classList.add('hidden');
    joinRoomPanel.classList.add('hidden');
    singlePlayerPanel.classList.add('hidden');
    lobbyMenu.classList.remove('hidden');
}

function showLobbyLoading(message = 'Loading...') {
    console.log('showLobbyLoading called:', message);
    if (lobbyLoading) {
        lobbyLoading.querySelector('p').textContent = message;
        lobbyLoading.classList.remove('hidden');
        console.log('Loading overlay shown');
    }
}

function hideLobbyLoading() {
    console.log('hideLobbyLoading called');
    if (lobbyLoading) {
        lobbyLoading.classList.add('hidden');
        console.log('Loading overlay hidden');
    }
}

// Helper function to check if player is in a waiting room
function isInWaitingRoom() {
    return currentRoomCode !== null && !document.getElementById('waiting-panel').classList.contains('hidden');
}

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
        // If creator left during waiting phase, mark room as abandoned AND delete it
        if (isRoomCreator && roomRef) {
            const roomDoc = await roomRef.get();
            if (roomDoc.exists && roomDoc.data().status === 'waiting') {
                console.log('Host left waiting room, closing room');
                
                // Delete all players first
                const playersSnapshot = await playersRef.get();
                const deletePromises = playersSnapshot.docs.map(doc => doc.ref.delete());
                await Promise.all(deletePromises);
                
                // Delete the room
                await roomRef.delete();
                console.log('Room deleted');
                return; // Don't continue to remove player individually
            }
        }
        
        // Remove player from room (non-host or mid-game)
        await playersRef.doc(playerName).delete();
        console.log('Player removed from room');
        
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
    if (isInWaitingRoom()) {
        alert('Please leave your current room first');
        return;
    }
    // Check if signed in
    if (!currentUser) {
        alert('Please sign in or play as guest first');
        return;
    }
    
    // Hide other panels
    lobbyMenu.classList.add('hidden');
    createRoomPanel.classList.add('hidden');
    joinRoomPanel.classList.add('hidden');
    
    // Show single player panel
    singlePlayerPanel.classList.remove('hidden');
});

// Back button from single player
backFromSingleBtn.addEventListener('click', () => {
    singlePlayerPanel.classList.add('hidden');
    createRoomPanel.classList.add('hidden');
    joinRoomPanel.classList.add('hidden');
    lobbyMenu.classList.remove('hidden');
});

// Start single player game
startSinglePlayerBtn.addEventListener('click', () => {
    // Get selected set
    selectedQuestionSet = singlePlayerSetSelect.value;
    const questions = getQuestionsFromSet(selectedQuestionSet);
    
    if (questions.length < 1) {
        alert('Not enough questions in this set (need at least 1)');
        return;
    }
    
    // Get player name
    playerName = getPlayerName();
    
    // Set single-player mode
    currentRoomCode = null;
    isRoomCreator = false;
    
    // Remove lobby and show game
    lobbyScreen.remove();
    gameContainer.classList.remove('hidden');
    gameContainer.style.display = 'flex';
    
    // Display player name
    playerNameDisplay.textContent = playerName;
    
    // Show end game button
    endGameBtn.style.display = 'block';
    endGameBtn.textContent = 'End Game';
    
    // Reset game state
    currentRound = 1;
    totalScore = 0;
    usedQuestions = [];
    scoreDisplay.textContent = totalScore;
    currentRoundDisplay.textContent = currentRound;
    
    // Start game
    loadNewQuestion();
    
    console.log('Single player mode started with set:', selectedQuestionSet);
});

// Start host heartbeat - ONLY for waiting room
function startHostHeartbeat() {
    if (!isRoomCreator || !currentRoomCode || !roomRef) return;
    
    // Clear any existing heartbeat
    if (window.hostPresenceInterval) {
        clearInterval(window.hostPresenceInterval);
    }
    
    console.log('Starting host heartbeat'); // DEBUG
    
    window.hostPresenceInterval = setInterval(async () => {
        if (!currentRoomCode || !isRoomCreator || !roomRef) {
            clearInterval(window.hostPresenceInterval);
            window.hostPresenceInterval = null;
            return;
        }
        
        try {
            const roomDoc = await roomRef.get();
            if (!roomDoc.exists || roomDoc.data().status !== 'waiting') {
                // Room deleted or game started - stop heartbeat
                console.log('Stopping host heartbeat - room gone or game started'); // DEBUG
                clearInterval(window.hostPresenceInterval);
                window.hostPresenceInterval = null;
                return;
            }
            
            await roomRef.update({
                hostLastSeen: firebase.firestore.FieldValue.serverTimestamp()
            });
            console.log('Host heartbeat sent'); // DEBUG
        } catch (error) {
            console.log('Host heartbeat failed:', error);
            clearInterval(window.hostPresenceInterval);
            window.hostPresenceInterval = null;
        }
    }, 2000);
}

// Start guest monitoring - ONLY for waiting room
function startGuestMonitoring() {
    if (isRoomCreator || !currentRoomCode || !roomRef) return;
    
    // Clear any existing checker
    if (window.hostPresenceChecker) {
        clearInterval(window.hostPresenceChecker);
    }
    
    console.log('Starting guest monitoring'); // DEBUG
    
    window.hostPresenceChecker = setInterval(async () => {
        try {
            const roomDoc = await roomRef.get();
            
            if (!roomDoc.exists) {
                clearInterval(window.hostPresenceChecker);
                window.hostPresenceChecker = null;
                alert('Room has been closed');
                leaveRoom();
                return;
            }
            
            const data = roomDoc.data();
            
            // If game started, stop monitoring
            if (data.status !== 'waiting') {
                console.log('Stopping guest monitoring - game started'); // DEBUG
                clearInterval(window.hostPresenceChecker);
                window.hostPresenceChecker = null;
                return;
            }
            
            const hostLastSeen = data.hostLastSeen?.toMillis();
            const now = Date.now();
            const diff = (now - hostLastSeen) / 1000;
            
            console.log('Guest check - host last seen:', diff, 'seconds ago'); // DEBUG
            
            if (hostLastSeen && (now - hostLastSeen) > 10000) {
                console.log('Host might be gone, double checking...'); // DEBUG
                
                // Double check
                await new Promise(resolve => setTimeout(resolve, 2000));
                
                const doubleCheck = await roomRef.get();
                if (!doubleCheck.exists) return;
                
                const doubleCheckLastSeen = doubleCheck.data().hostLastSeen?.toMillis();
                const doubleCheckDiff = (Date.now() - doubleCheckLastSeen) / 1000;
                
                console.log('Double check - host last seen:', doubleCheckDiff, 'seconds ago'); // DEBUG
                
                if (doubleCheckLastSeen && (Date.now() - doubleCheckLastSeen) > 10000) {
                    console.log('Host confirmed gone'); // DEBUG
                    clearInterval(window.hostPresenceChecker);
                    window.hostPresenceChecker = null;
                    
                    alert('Host has disconnected. Room is closing.');
                    
                    // Cleanup
                    const playersSnapshot = await playersRef.get();
                    await Promise.all(playersSnapshot.docs.map(doc => doc.ref.delete()));
                    await roomRef.delete();
                    
                    leaveRoom();
                }
            }
        } catch (error) {
            console.error('Guest monitoring error:', error);
        }
    }, 3000); // Check every 3 seconds
}

// Create Room - SIMPLIFIED
createRoomBtn.addEventListener('click', async () => {
    if (isInWaitingRoom()) {
        alert('Please leave your current room first');
        return;
    }
    if (!currentUser) {
        alert('Please sign in or play as guest first');
        return;
    }
    
    if (!checkRateLimit('createRoom', 3, 60000)) {
        alert('Too many rooms created. Please wait a minute.');
        return;
    }
    
    playerName = getPlayerName();
    
    lobbyMenu.classList.add('hidden');
    joinRoomPanel.classList.add('hidden');
    singlePlayerPanel.classList.add('hidden');
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
        questionSetId: questionSetSelect.value,
        status: 'waiting',
        currentRound: 0,
        questionOrder: [],
        hostLastSeen: firebase.firestore.FieldValue.serverTimestamp()
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
    
    // Start host heartbeat
    startHostHeartbeat();
    
    console.log('Room created:', roomCode);
});

// Join Room
joinRoomBtn.addEventListener('click', () => {
    if (isInWaitingRoom()) {
        alert('Please leave your current room first');
        return;
    }
    // Check if signed in
    if (!currentUser) {
        alert('Please sign in or play as guest first');
        return;
    }
    
    // Hide other panels
    lobbyMenu.classList.add('hidden');
    createRoomPanel.classList.add('hidden');
    singlePlayerPanel.classList.add('hidden');
    
    // Show join room panel
    joinRoomPanel.classList.remove('hidden');
});

joinRoomSubmitBtn.addEventListener('click', async () => {
    console.log('Join room clicked');
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

    console.log('Checking room:', roomCode);
    
    // Get player name
    playerName = getPlayerName();
    
    joinError.classList.add('hidden');
    showLobbyLoading('Joining room...');  // ADD THIS
    
    try {  // WRAP IN TRY-CATCH
        // Check if room exists
        roomRef = db.collection('rooms').doc(roomCode);
        const roomDoc = await roomRef.get();
        
        if (!roomDoc.exists) {
            joinError.classList.remove('hidden');
            joinError.textContent = 'Room not found';
            hideLobbyLoading();  // ADD THIS
            return;
        }
        
        const roomData = roomDoc.data();

        // Check if room is abandoned
        if (roomData.status === 'abandoned') {
            joinError.textContent = 'This room has been closed';
            joinError.classList.remove('hidden');
            hideLobbyLoading();
            return;
        }

        if (roomData.status !== 'waiting') {
            joinError.textContent = 'Game already in progress';
            joinError.classList.remove('hidden');
            hideLobbyLoading();
            return;
        }
        
        // Check player count
        playersRef = roomRef.collection('players');
        const playersSnapshot = await playersRef.get();
        if (playersSnapshot.size >= 10) {
            joinError.textContent = 'Room is full';
            joinError.classList.remove('hidden');
            hideLobbyLoading();  // ADD THIS
            return;
        }
        
        // Check if name is already taken in this room
        const existingPlayer = playersSnapshot.docs.find(doc => doc.id === playerName);
        if (existingPlayer) {
            joinError.textContent = 'Name already taken in this room';
            joinError.classList.remove('hidden');
            hideLobbyLoading();  // ADD THIS
            return;
        }
        
        console.log('Room validated, joining...');

        // Join room
        currentRoomCode = roomCode;
        isRoomCreator = false;
        
        await playersRef.doc(playerName).set({
            name: playerName,
            joinedAt: firebase.firestore.FieldValue.serverTimestamp(),
            isCreator: false,
            score: 0
        });

        console.log('Joined successfully, showing waiting panel');
        
        // Show WAITING panel
        lobbyMenu.classList.add('hidden');
        joinRoomPanel.classList.add('hidden');
        createRoomPanel.classList.add('hidden');
        singlePlayerPanel.classList.add('hidden');

        const waitingPanel = document.getElementById('waiting-panel');
        waitingPanel.classList.remove('hidden');

        // Set room code
        const waitingRoomCode = document.getElementById('waiting-room-code');
        waitingRoomCode.textContent = roomCode;

        // Listen for players
        const waitingPlayersList = document.getElementById('waiting-players-list');
        playersRef.onSnapshot((snapshot) => {
            waitingPlayersList.innerHTML = '';
            snapshot.forEach((doc) => {
                const player = doc.data();
                const li = document.createElement('li');
                li.textContent = player.name + (player.isCreator ? ' (Host)' : '');
                waitingPlayersList.appendChild(li);
            });
        });

        // Listen for game start
        listenForGameStart();
        
        // Start guest monitoring
        startGuestMonitoring();

        hideLobbyLoading();

        console.log('Joined room:', roomCode);
        
    } catch (error) {  // ADD CATCH BLOCK
        console.error('Join error:', error);
        joinError.textContent = 'Error joining room';
        joinError.classList.remove('hidden');
        hideLobbyLoading();
    }
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

// Start Game (creator only) - UPDATED to start game immediately for host
startGameBtn.addEventListener('click', async () => {
    if (!isRoomCreator) return;
    
    // Get latest player name in case they edited it
    const latestPlayerName = getPlayerName();
    
    // If name changed, update it in Firebase
    if (latestPlayerName !== playerName) {
        // Delete old player entry
        await playersRef.doc(playerName).delete();
        
        // Create new entry with updated name
        await playersRef.doc(latestPlayerName).set({
            name: latestPlayerName,
            joinedAt: firebase.firestore.FieldValue.serverTimestamp(),
            isCreator: true,
            score: 0
        });
        
        playerName = latestPlayerName;
    }
    
    const timerValue = parseInt(timerSetting.value);
    const setId = questionSetSelect.value;
    const questions = getQuestionsFromSet(setId);
    
    console.log('Starting game with timer:', timerValue, 'and set:', setId);
    
    // Generate random question order from selected set
    const questionIds = questions.map(q => q.id);
    const shuffled = questionIds.sort(() => Math.random() - 0.5).slice(0, 5);
    
    // UPDATED: Set roundStartTime when starting game
    await roomRef.update({
        status: 'playing',
        currentRound: 1,
        questionOrder: shuffled,
        timerSeconds: timerValue,
        questionSetId: setId,
        roundStartTime: firebase.firestore.FieldValue.serverTimestamp()
    });
    
    console.log('Game started with timer:', timerValue);
    
    // Get fresh room data
    const freshRoomDoc = await roomRef.get();
    const freshRoomData = freshRoomDoc.data();
    
    // Start the game immediately for host
    startMultiplayerGame(freshRoomData);
});

// Creator also needs to listen for their own game start
if (isRoomCreator) {
    listenForGameStart();
}

function listenForGameStart() {
    roomRef.onSnapshot((doc) => {
        // Check if room still exists
        if (!doc.exists) {
            console.log('Room no longer exists');
            return;
        }
        
        const roomData = doc.data();
        console.log('Room status changed:', roomData.status);
        
        if (roomData.status === 'playing' && !hasGameStarted) {
            hasGameStarted = true;
            
            // Check if mobile
            if (isMobile) {
                // Hide mobile waiting panel if it exists
                const mobileWaitingPanel = document.getElementById('mobile-waiting-panel');
                if (mobileWaitingPanel) {
                    mobileWaitingPanel.classList.add('hidden');
                }
                
                startMobileGame(roomData);
            } else {
                startMultiplayerGame(roomData);
            }
        }
    });
}

// Leave waiting room button
leaveWaitingBtn.addEventListener('click', async () => {
    if (confirm('Are you sure you want to leave this room?')) {
        await leaveRoom();
    }
});

// Start round timer - SIMPLIFIED with single fetch
function startRoundTimer(seconds) {
    // Clear any existing timer
    if (roundTimer) clearInterval(roundTimer);
    
    timerDisplay.classList.remove('hidden', 'warning');
    
    // Reset timer text format
    timerDisplay.innerHTML = `Time: <span id="timer-value">${seconds}</span>s`;
    
    // Re-get the element since we changed innerHTML
    const timerValueSpan = document.getElementById('timer-value');
    
    // Fetch room data ONCE to get the round start time
    roomRef.get().then((doc) => {
        if (!doc.exists) {
            console.error('Room does not exist');
            return;
        }
        
        const data = doc.data();
        const roundStartTime = data.roundStartTime?.toMillis();
        const roundDuration = data.timerSeconds || seconds;
        
        if (!roundStartTime) {
            console.error('No roundStartTime in room data');
            return;
        }
        
        console.log('Timer started:', {
            roundStartTime: new Date(roundStartTime),
            duration: roundDuration,
            localTime: new Date()
        });
        
        // Calculate time remaining based on server timestamp
        const updateTimer = () => {
            const now = Date.now();
            const elapsed = (now - roundStartTime) / 1000; // seconds elapsed since server set the timestamp
            timeRemaining = Math.max(0, Math.ceil(roundDuration - elapsed));
            
            timerValueSpan.textContent = timeRemaining;
            
            console.log('Timer tick:', timeRemaining, 'elapsed:', elapsed.toFixed(1)); // Debug
            
            // Warning animation at 10 seconds
            if (timeRemaining <= 10) {
                timerDisplay.classList.add('warning');
            }
            
            // Time's up
            if (timeRemaining <= 0) {
                clearInterval(roundTimer);
                autoSubmitRound();
            }
        };
        
        // Update immediately
        updateTimer();
        
        // Then update every 1000ms (1 second)
        roundTimer = setInterval(updateTimer, 1000);
    });
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

// Stop timer - UPDATED to clean up listener
function stopRoundTimer() {
    if (roundTimer) {
        clearInterval(roundTimer);
        roundTimer = null;
    }
    
    // Unsubscribe from room timer listener
    if (window.timerUnsubscribe) {
        window.timerUnsubscribe();
        window.timerUnsubscribe = null;
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
            // Wait a moment for Firebase to fully update roundStartTime
            setTimeout(() => {
                startRoundTimer(roomData.timerSeconds);
            }, 200);  // 200ms delay

            if (isMobile) {
                mobileRound.textContent = currentRound;
                mobileSubmitBtn.disabled = false;
                mobileClickPosition = null;
                mobileCurrentSlice = 13;
                mobileSliceSlider.value = 13;
                updateMobileSlice();
                mobileMarker.classList.remove('show');
                
                loadNewQuestion();
                startMobileTimer(roomData.timerSeconds);
            } else {
                currentRoundDisplay.textContent = currentRound;
                submitBtn.disabled = false;
                
                // UPDATE SCORE DISPLAY HERE
                scoreDisplay.textContent = totalScore;
                console.log('listenForRoundChanges updated score to:', totalScore);
                
                loadNewQuestion();
                startRoundTimer(roomData.timerSeconds);
            }
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
    if (monitoringActive) {
        console.log('Already monitoring player count');
        return;
    }
    
    monitoringActive = true;
    
    // Clean up old listener if exists
    if (playerCountListener) {
        playerCountListener();
        playerCountListener = null;
    }
    
    playerCountListener = playersRef.onSnapshot((snapshot) => {
        const playerCount = snapshot.size;
        
        console.log('Player count snapshot:', playerCount, 'Last:', lastPlayerCount);
        
        // Initialize on first call
        if (lastPlayerCount === 0) {
            lastPlayerCount = playerCount;
            console.log('Initialized monitoring with', playerCount, 'players');
            return;
        }
        
        // Ignore if count increased (shouldn't happen mid-game but just in case)
        if (playerCount > lastPlayerCount) {
            console.log('Player count increased, updating lastPlayerCount');
            lastPlayerCount = playerCount;
            return;
        }
        
        // Check if someone left
        if (playerCount < lastPlayerCount) {
            const playersLost = lastPlayerCount - playerCount;
            console.log(`${playersLost} player(s) disconnected`);
            showNotification(`${playersLost} player(s) disconnected (${playerCount} remaining)`);
            lastPlayerCount = playerCount;
        }
        
        // Only end game if down to 1 player
        if (playerCount === 1) {
            console.log('Only 1 player remaining, ending game');
            
            // Clean up listener before reloading
            if (playerCountListener) {
                playerCountListener();
                playerCountListener = null;
            }
            monitoringActive = false;
            
            alert('Other player disconnected. Returning to lobby.');
            location.reload();
        } else if (playerCount === 0) {
            console.log('No players remaining');
            if (playerCountListener) {
                playerCountListener();
                playerCountListener = null;
            }
            monitoringActive = false;
            location.reload();
        }
    });
}

// Start multiplayer game for all players - UPDATED to stop host presence
async function startMultiplayerGame(roomData) {
    // Prevent double-starting
    if (hasGameStarted) {
        console.log('Game already started, ignoring duplicate call');
        return;
    }
    hasGameStarted = true;
    
    console.log('startMultiplayerGame called');
    
    // STOP ALL WAITING ROOM MONITORING
    if (window.hostPresenceInterval) {
        clearInterval(window.hostPresenceInterval);
        window.hostPresenceInterval = null;
    }
    
    if (window.hostPresenceChecker) {
        clearInterval(window.hostPresenceChecker);
        window.hostPresenceChecker = null;
    }
    
    // HIDE ALL PANELS - INCLUDING MOBILE - FORCE WITH STYLE
    const mobileWaitingPanel = document.getElementById('mobile-waiting-panel');
    if (mobileWaitingPanel) {
        mobileWaitingPanel.classList.add('hidden');
        mobileWaitingPanel.style.display = 'none';  // ADD THIS
    }
    
    const mobileLobby = document.getElementById('mobile-lobby');
    if (mobileLobby) {
        mobileLobby.style.display = 'none';  // ADD THIS
    }
    
    createRoomPanel.classList.add('hidden');
    joinRoomPanel.classList.add('hidden');
    
    // Check if mobile
    if (isMobile) {
        startMobileGame(roomData);
        return;
    }
    
    // Desktop: Show game container
    gameContainer.classList.remove('hidden');
    gameContainer.style.display = 'flex';

    // Ensure question sets are loaded
    if (!questionSetsData) {
        console.log('Question sets not loaded yet, loading now...');
        await loadQuestionSets();
    }

    // Start checking for disconnected players every 10 seconds
    // const disconnectCheckInterval = setInterval(() => {
    //     if (currentRoomCode) {
    //         checkForDisconnectedPlayers();
    //     } else {
    //         clearInterval(disconnectCheckInterval);
    //     }
    // }, 10000);
    
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

// Clean up on page unload
window.addEventListener('beforeunload', async (e) => {
    if (currentRoomCode && playerName && playersRef) {
        // For host leaving waiting room, we need to clean up synchronously
        if (isRoomCreator && roomRef) {
            // Use navigator.sendBeacon for more reliable cleanup
            const beaconData = JSON.stringify({
                action: 'closeRoom',
                roomCode: currentRoomCode,
                playerName: playerName
            });
            
            // This is more reliable than async cleanup on unload
            navigator.sendBeacon('/api/cleanup', beaconData); // You'd need a server endpoint
            
            // But also try the direct method
            handlePlayerDisconnect();
        } else {
            // Regular player leaving
            handlePlayerDisconnect();
        }
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
    // MULTIPLAYER MODE
    if (currentRoomCode) {
        roomRef.get().then((doc) => {
            const roomData = doc.data();
            const setId = roomData.questionSetId || 'default';
            const questions = getQuestionsFromSet(setId);
            const questionId = roomData.questionOrder[currentRound - 1];
            currentQuestion = questions.find(q => q.id === questionId);
            
            if (currentQuestion) {
                symptomsText.textContent = currentQuestion.prompt;
                clickPosition = null;
                resetView();
                console.log('Multiplayer Round:', currentRound, 'Question:', currentQuestion.id);
            }
        });
        return;
    }
    
    // SINGLE-PLAYER MODE
    const questions = getQuestionsFromSet(selectedQuestionSet);
    
    const availableQuestions = questions.filter(
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

    // Reset mobile view if on mobile
    if (isMobile) {
        mobileCurrentSlice = 13;
        mobileSliceSlider.value = 13;
        updateMobileSlice();
        mobileClickPosition = null;
        mobileMarker.classList.remove('show');
    }
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
    if (isMobile) {
        showMobileResults(score, distance, allPlayersData);
        return;
    }

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
    if (isMobile) {
        hideMobileResults();
        return;
    }
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
            // Get question from the set
            const questionId = roomData.questionOrder[currentRound - 1];
            const setId = roomData.questionSetId || 'default';
            const questions = getQuestionsFromSet(setId);
            const question = questions ? questions.find(q => q.id === questionId) : null;
            
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
    if (hasSubmittedThisRound) {
        console.log('Already submitted this round');
        return;
    }
    
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
// QUESTION SET MANAGER
// ============================================

// DOM Elements
const setManagerBtn = document.getElementById('debug-coords-btn');
const setManagerModal = document.getElementById('set-manager-modal');
const setManagerOverlay = document.getElementById('set-manager-overlay');
const setManagerMenu = document.getElementById('set-manager-menu');
const closeManagerBtn = document.getElementById('close-manager-btn');
const managerLoading = document.getElementById('manager-loading');

// Panels
const setEditorPanel = document.getElementById('set-editor-panel');
const questionEditorPanel = document.getElementById('question-editor-panel');
const deleteSetPanel = document.getElementById('delete-set-panel');
const editSetSelectorPanel = document.getElementById('edit-set-selector-panel');

// Set Editor Elements
const editorTitle = document.getElementById('editor-title');
const setNameInput = document.getElementById('set-name-input');
const setDescriptionInput = document.getElementById('set-description-input');
const setPublicCheckbox = document.getElementById('set-public-checkbox');
const questionsList = document.getElementById('questions-list');
const addQuestionBtn = document.getElementById('add-question-btn');
const saveSetBtn = document.getElementById('save-set-btn');
const deleteCurrentSetBtn = document.getElementById('delete-current-set-btn');
const cancelEditorBtn = document.getElementById('cancel-editor-btn');

// Question Editor Elements
const questionEditorTitle = document.getElementById('question-editor-title');
const questionPromptInput = document.getElementById('question-prompt-input');
const questionDescriptionInput = document.getElementById('question-description-input');
const questionMriSlice = document.getElementById('question-mri-slice');
const questionMarker = document.getElementById('question-marker');
const questionSliceSlider = document.getElementById('question-slice-slider');
const questionSliceNum = document.getElementById('question-slice-num');
const questionXDisplay = document.getElementById('question-x-display');
const questionYDisplay = document.getElementById('question-y-display');
const questionSliceDisplay = document.getElementById('question-slice-display');
const saveQuestionBtn = document.getElementById('save-question-btn');
const cancelQuestionBtn = document.getElementById('cancel-question-btn');

// Delete/Edit Selectors
const editSetSelect = document.getElementById('edit-set-select');
const deleteSetSelect = document.getElementById('delete-set-select');
const confirmEditSetBtn = document.getElementById('confirm-edit-set-btn');
const confirmDeleteSetBtn = document.getElementById('confirm-delete-set-btn');
const cancelEditSelectBtn = document.getElementById('cancel-edit-select-btn');
const cancelDeleteBtn = document.getElementById('cancel-delete-btn');

// Manager State
let currentEditingSet = null;
let currentEditingSetId = null;
let currentEditingQuestions = [];
let currentEditingQuestionIndex = null;
let questionCoordinates = null;
let currentQuestionSlice = 13;

// Open Set Manager
setManagerBtn.addEventListener('click', () => {
    setManagerOverlay.classList.remove('hidden');
    setManagerModal.classList.remove('hidden');
    showManagerMenu();
});

// Close Set Manager
closeManagerBtn.addEventListener('click', () => {
    setManagerOverlay.classList.add('hidden');
    setManagerModal.classList.add('hidden');
    resetManager();
});

function showManagerLoading(message = 'Saving changes...') {
    managerLoading.querySelector('p').textContent = message;
    managerLoading.classList.remove('hidden');
}

function hideManagerLoading() {
    managerLoading.classList.add('hidden');
}

// Show main menu
function showManagerMenu() {
    setManagerMenu.classList.remove('hidden');
    setEditorPanel.classList.add('hidden');
    questionEditorPanel.classList.add('hidden');
    deleteSetPanel.classList.add('hidden');
    editSetSelectorPanel.classList.add('hidden');
}

// Reset manager state
function resetManager() {
    currentEditingSet = null;
    currentEditingSetId = null;
    currentEditingQuestions = [];
    currentEditingQuestionIndex = null;
    questionCoordinates = null;
    setNameInput.value = '';
    setDescriptionInput.value = '';
    setPublicCheckbox.checked = false;
    questionsList.innerHTML = '';
}

// Create New Set
document.getElementById('create-set-btn').addEventListener('click', () => {
    resetManager();
    editorTitle.textContent = 'Create New Question Set';
    deleteCurrentSetBtn.classList.add('hidden');
    setManagerMenu.classList.add('hidden');
    setEditorPanel.classList.remove('hidden');
    renderQuestionsList();
});

// Edit Existing Set
document.getElementById('edit-set-btn').addEventListener('click', () => {
    populateUserSetsDropdown(editSetSelect);
    setManagerMenu.classList.add('hidden');
    editSetSelectorPanel.classList.remove('hidden');
});

// Confirm Edit Set Selection
confirmEditSetBtn.addEventListener('click', async () => {
    const setId = editSetSelect.value;
    if (!setId) {
        alert('Please select a set to edit');
        return;
    }
    
    await loadSetForEditing(setId);
});

// Load set for editing
async function loadSetForEditing(setId) {
    try {
        const setDoc = await db.collection('questionSets').doc(setId).get();
        
        if (!setDoc.exists) {
            alert('Set not found');
            return;
        }
        
        const setData = setDoc.data();
        
        // Check if user owns this set
        if (setData.createdBy !== currentUser.uid) {
            alert('You can only edit your own sets');
            return;
        }
        
        // Load set data
        currentEditingSetId = setId;
        setNameInput.value = setData.name;
        setDescriptionInput.value = setData.description;
        setPublicCheckbox.checked = setData.isPublic;
        
        // Load questions
        const questionsSnapshot = await db.collection('questionSets').doc(setId).collection('questions').get();
        currentEditingQuestions = questionsSnapshot.docs.map(doc => doc.data());
        
        // Show editor
        editorTitle.textContent = 'Edit Question Set';
        deleteCurrentSetBtn.classList.remove('hidden');
        editSetSelectorPanel.classList.add('hidden');
        setEditorPanel.classList.remove('hidden');
        renderQuestionsList();
        
    } catch (error) {
        console.error('Error loading set:', error);
        alert('Error loading set');
    }
}

// Delete Set
document.getElementById('delete-set-btn').addEventListener('click', () => {
    populateUserSetsDropdown(deleteSetSelect);
    setManagerMenu.classList.add('hidden');
    deleteSetPanel.classList.remove('hidden');
});

// Populate dropdown with user's sets
function populateUserSetsDropdown(selectElement) {
    selectElement.innerHTML = '<option value="">Choose a set...</option>';
    
    if (!questionSetsData) return;
    
    questionSetsData.questionSets
        .filter(set => set.createdBy === currentUser.uid)
        .forEach(set => {
            const option = document.createElement('option');
            option.value = set.id;
            option.textContent = `$${set.name} ($${set.questions.length} questions)`;
            selectElement.appendChild(option);
        });
}

// Confirm Delete Set
confirmDeleteSetBtn.addEventListener('click', async () => {
    const setId = deleteSetSelect.value;
    if (!setId) {
        alert('Please select a set to delete');
        return;
    }
    
    if (!confirm('Are you sure you want to delete this set? This cannot be undone.')) {
        return;
    }

    showManagerLoading('Deleting set...');
    
    try {
        const setRef = db.collection('questionSets').doc(setId);
        
        // Delete all questions first
        const questionsSnapshot = await setRef.collection('questions').get();
        const deletePromises = questionsSnapshot.docs.map(doc => doc.ref.delete());
        await Promise.all(deletePromises);
        
        // Delete the set
        await setRef.delete();
        
        alert('Set deleted successfully');
        
        // Reload question sets
        await loadQuestionSets();
        
        // Return to menu
        showManagerMenu();
        
    } catch (error) {
        console.error('Error deleting set:', error);
        alert('Error deleting set: ' + error.message);
    } finally {
        hideManagerLoading();
    }
});

// Render questions list
function renderQuestionsList() {
    if (currentEditingQuestions.length === 0) {
        questionsList.innerHTML = '<div class="empty-state">No questions yet. Click "Add Question" to create one.</div>';
        return;
    }
    
    questionsList.innerHTML = '';
    
    currentEditingQuestions.forEach((question, index) => {
        const item = document.createElement('div');
        item.className = 'question-item';
        
        const promptPreview = question.prompt.length > 100 ? 
            question.prompt.substring(0, 100) + '...' : 
            question.prompt;
        
        const header = document.createElement('div');
        header.className = 'question-item-header';
        
        const promptDiv = document.createElement('div');
        promptDiv.className = 'question-item-prompt';
        promptDiv.textContent = promptPreview;
        
        const actionsDiv = document.createElement('div');
        actionsDiv.className = 'question-item-actions';
        
        const editBtn = document.createElement('button');
        editBtn.textContent = 'Edit';
        editBtn.onclick = () => editQuestion(index);
        
        const deleteBtn = document.createElement('button');
        deleteBtn.className = 'delete-btn';
        deleteBtn.textContent = 'Delete';
        deleteBtn.onclick = () => deleteQuestion(index);
        
        actionsDiv.appendChild(editBtn);
        actionsDiv.appendChild(deleteBtn);
        
        header.appendChild(promptDiv);
        header.appendChild(actionsDiv);
        
        const details = document.createElement('div');
        details.className = 'question-item-details';
        details.textContent = 'Location: ' + question.description + ' | Coordinates: (' + 
            question.x + ', ' + question.y + ', slice ' + question.slice + ')';
        
        item.appendChild(header);
        item.appendChild(details);
        
        questionsList.appendChild(item);
    });
}

// Add Question
addQuestionBtn.addEventListener('click', () => {
    currentEditingQuestionIndex = null;
    questionEditorTitle.textContent = 'Add Question';
    questionPromptInput.value = '';
    questionDescriptionInput.value = '';
    questionCoordinates = null;
    currentQuestionSlice = 13;
    questionSliceSlider.value = 13;
    updateQuestionSlice();
    questionMarker.classList.remove('show');
    questionXDisplay.textContent = '-';
    questionYDisplay.textContent = '-';
    questionSliceDisplay.textContent = '-';
    
    setEditorPanel.classList.add('hidden');
    questionEditorPanel.classList.remove('hidden');
});

// Edit Question (global function for onclick)
window.editQuestion = function(index) {
    currentEditingQuestionIndex = index;
    const question = currentEditingQuestions[index];
    
    questionEditorTitle.textContent = 'Edit Question';
    questionPromptInput.value = question.prompt;
    questionDescriptionInput.value = question.description;
    questionCoordinates = { x: question.x, y: question.y, slice: question.slice };
    currentQuestionSlice = question.slice;
    questionSliceSlider.value = question.slice;
    updateQuestionSlice();
    
    questionXDisplay.textContent = question.x;
    questionYDisplay.textContent = question.y;
    questionSliceDisplay.textContent = question.slice;
    
    // Show marker at saved position
    questionMarker.classList.add('show');
    
    setEditorPanel.classList.add('hidden');
    questionEditorPanel.classList.remove('hidden');
};

// Delete Question (global function for onclick)
window.deleteQuestion = function(index) {
    if (confirm('Delete this question?')) {
        currentEditingQuestions.splice(index, 1);
        renderQuestionsList();
    }
};

// Question MRI slice slider
questionSliceSlider.addEventListener('input', (e) => {
    currentQuestionSlice = parseInt(e.target.value);
    updateQuestionSlice();
});

// Update question MRI slice
function updateQuestionSlice() {
    const sliceStr = String(currentQuestionSlice).padStart(3, '0');
    questionMriSlice.src = `images/slice_${sliceStr}.png`;
    questionSliceNum.textContent = currentQuestionSlice;
}

// Click on MRI to set coordinates
questionMriSlice.addEventListener('click', (e) => {
    const rect = questionMriSlice.getBoundingClientRect();
    const viewer = document.querySelector('.question-mri-viewer');
    const viewerRect = viewer.getBoundingClientRect();
    
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    
    questionCoordinates = {
        x: parseFloat((x / rect.width).toFixed(4)),
        y: parseFloat((y / rect.height).toFixed(4)),
        slice: currentQuestionSlice
    };
    
    // Position marker
    const markerX = e.clientX - viewerRect.left;
    const markerY = e.clientY - viewerRect.top;
    
    questionMarker.style.left = markerX + 'px';
    questionMarker.style.top = markerY + 'px';
    questionMarker.classList.add('show');
    
    // Update displays
    questionXDisplay.textContent = questionCoordinates.x;
    questionYDisplay.textContent = questionCoordinates.y;
    questionSliceDisplay.textContent = questionCoordinates.slice;
});

// Save Question
saveQuestionBtn.addEventListener('click', () => {
    const prompt = questionPromptInput.value.trim();
    const description = questionDescriptionInput.value.trim();
    
    if (!prompt) {
        alert('Please enter a clinical prompt');
        return;
    }
    
    if (!description) {
        alert('Please enter an anatomical description');
        return;
    }
    
    if (!questionCoordinates) {
        alert('Please click on the MRI to set the target location');
        return;
    }
    
    const question = {
        id: currentEditingQuestionIndex !== null ? 
            currentEditingQuestions[currentEditingQuestionIndex].id : 
            'q' + Date.now(),
        prompt: prompt,
        description: description,
        x: questionCoordinates.x,
        y: questionCoordinates.y,
        slice: questionCoordinates.slice
    };
    
    if (currentEditingQuestionIndex !== null) {
        // Update existing question
        currentEditingQuestions[currentEditingQuestionIndex] = question;
    } else {
        // Add new question
        currentEditingQuestions.push(question);
    }
    
    // Return to set editor
    questionEditorPanel.classList.add('hidden');
    setEditorPanel.classList.remove('hidden');
    renderQuestionsList();
});

// Cancel Question Edit
cancelQuestionBtn.addEventListener('click', () => {
    questionEditorPanel.classList.add('hidden');
    setEditorPanel.classList.remove('hidden');
});

// Save Set
saveSetBtn.addEventListener('click', async () => {
    console.log('Save Set clicked');
    
    const name = setNameInput.value.trim();
    const description = setDescriptionInput.value.trim();
    const isPublic = setPublicCheckbox.checked;
    
    console.log('Set name:', name);
    console.log('Questions count:', currentEditingQuestions.length);
    
    if (!name) {
        alert('Please enter a set name');
        return;
    }
    
    if (currentEditingQuestions.length < 1) {
        alert('Please add at least 1 question to the set');
        return;
    }

    if (currentEditingQuestions.length > 100) {
        alert('Maximum 100 questions per set');
        return;
    }
    
    showManagerLoading('Saving set...');
    
    try {
        const setId = currentEditingSetId || ('set_' + Date.now());
        console.log('Saving to set ID:', setId);
        
        const setRef = db.collection('questionSets').doc(setId);
        
        // Save set metadata
        console.log('Saving metadata...');
        await setRef.set({
            id: setId,
            name: name,
            description: description,
            createdBy: currentUser.uid,
            createdByEmail: currentUser.email,
            createdAt: currentEditingSetId ? 
                (await setRef.get()).data().createdAt : 
                firebase.firestore.FieldValue.serverTimestamp(),
            updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
            isPublic: isPublic,
            questionCount: currentEditingQuestions.length
        });
        console.log('Metadata saved');
        
        // Delete existing questions if editing
        if (currentEditingSetId) {
            console.log('Deleting existing questions...');
            const existingQuestions = await setRef.collection('questions').get();
            const deletePromises = existingQuestions.docs.map(doc => doc.ref.delete());
            await Promise.all(deletePromises);
            console.log('Existing questions deleted');
        }
        
        // Save all questions
        console.log('Saving', currentEditingQuestions.length, 'questions...');
        const questionsRef = setRef.collection('questions');
        for (const question of currentEditingQuestions) {
            console.log('Saving question:', question.id);
            await questionsRef.doc(question.id).set(question);
        }
        console.log('All questions saved');
        
        alert(currentEditingSetId ? 'Set updated successfully!' : 'Set created successfully!');
        
        // Reload question sets
        console.log('Reloading question sets...');
        await loadQuestionSets();
        
        // Return to menu
        showManagerMenu();
        resetManager();
        
    } catch (error) {
        console.error('Error saving set:', error);
        alert('Error saving set: ' + error.message);
    } finally {
        hideManagerLoading();
    }
});

// Cancel Set Editor
cancelEditorBtn.addEventListener('click', () => {
    if (confirm('Discard changes?')) {
        setEditorPanel.classList.add('hidden');
        showManagerMenu();
        resetManager();
    }
});

// Delete Current Set (from editor)
deleteCurrentSetBtn.addEventListener('click', async () => {
    if (!currentEditingSetId) return;
    
    if (!confirm('Are you sure you want to delete this set? This cannot be undone.')) {
        return;
    }
    
    showManagerLoading('Deleting set...');  // Already there
    
    try {
        const setRef = db.collection('questionSets').doc(currentEditingSetId);
        
        // Delete all questions
        const questionsSnapshot = await setRef.collection('questions').get();
        const deletePromises = questionsSnapshot.docs.map(doc => doc.ref.delete());
        await Promise.all(deletePromises);
        
        // Delete the set
        await setRef.delete();
        
        alert('Set deleted successfully');
        
        // Reload question sets
        await loadQuestionSets();
        
        // Return to menu
        showManagerMenu();
        resetManager();
        
    } catch (error) {
        console.error('Error deleting set:', error);
        alert('Error deleting set: ' + error.message);
    } finally {
        hideManagerLoading();  // Already there
    }
});

// Cancel Edit Set Selection
cancelEditSelectBtn.addEventListener('click', () => {
    editSetSelectorPanel.classList.add('hidden');
    showManagerMenu();
});

// Cancel Delete Set
cancelDeleteBtn.addEventListener('click', () => {
    deleteSetPanel.classList.add('hidden');
    showManagerMenu();
});

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
        
        // Reload question sets (to include user's private sets)
        loadQuestionSets();
        
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

        // Show question creator only for Google users (not anonymous)
        if (user.isAnonymous) {
            setManagerBtn.style.display = 'none';
        } else {
            setManagerBtn.style.display = 'block';
        }

    } else {
        // User is signed out
        signedOutState.classList.remove('hidden');
        signedInState.classList.add('hidden');
        displayNameSection.classList.add('hidden');

        // Hide question creator
        setManagerBtn.style.display = 'none';
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
const closeRoomBtn = document.getElementById('close-room-btn');

let matchmakingListener = null;
let queueCountListener = null;
let myQueueId = null;

if (closeRoomBtn) {
    // Add this to the close room button listener (already exists but verify it calls this):
    closeRoomBtn.addEventListener('click', async () => {
        if (!confirm('Close this room? All players will be removed.')) {
            return;
        }
        
        await closeRoom();
        
        // After closing, return to lobby
        createRoomPanel.classList.add('hidden');
        lobbyMenu.classList.remove('hidden');
    });
}

// Close room function (host only)
async function closeRoom() {
    if (!isRoomCreator || !currentRoomCode) return;
    
    try {
        // Mark room as abandoned (this will kick all players via their listeners)
        if (roomRef) {
            await roomRef.update({ status: 'abandoned' });
            console.log('Room closed');
        }
        
        // Remove all players
        if (playersRef) {
            const playersSnapshot = await playersRef.get();
            const deletePromises = playersSnapshot.docs.map(doc => doc.ref.delete());
            await Promise.all(deletePromises);
            console.log('All players removed');
        }
        
        // Delete the room
        if (roomRef) {
            await roomRef.delete();
            console.log('Room deleted');
        }
        
    } catch (error) {
        console.error('Error closing room:', error);
    }
    
    // Reset state and return to lobby
    currentRoomCode = null;
    roomRef = null;
    playersRef = null;
    isRoomCreator = false;
    
    createRoomPanel.classList.add('hidden');
    joinRoomPanel.classList.add('hidden');
    singlePlayerPanel.classList.add('hidden');
    lobbyMenu.classList.remove('hidden');
}

// Find Match
findMatchBtn.addEventListener('click', async () => {
    if (isInWaitingRoom()) {
        alert('Please leave your current room first');
        return;
    }
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
                
                // Start appropriate monitoring
                if (isRoomCreator) {
                    startHostHeartbeat();
                } else {
                    startGuestMonitoring();
                }
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
            matchmade: true,
            hostLastSeen: firebase.firestore.FieldValue.serverTimestamp()
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

// Load question sets from Firestore
async function loadQuestionSets() {
    try {
        console.log('Loading question sets from Firestore...');
        
        questionSetsData = { questionSets: [] };
        const loadedSetIds = new Set();
        
        // Get all public question sets
        const publicSetsSnapshot = await db.collection('questionSets')
            .where('isPublic', '==', true)
            .get();
        
        console.log('Public sets found:', publicSetsSnapshot.size);  // DEBUG
        
        for (const doc of publicSetsSnapshot.docs) {
            console.log('Processing public set:', doc.id);  // DEBUG
            
            if (loadedSetIds.has(doc.id)) {
                console.log('DUPLICATE DETECTED:', doc.id);  // DEBUG
                continue;
            }
            
            const setData = doc.data();
            const questionsSnapshot = await doc.ref.collection('questions').get();
            const questions = questionsSnapshot.docs.map(qDoc => qDoc.data());
            
            questionSetsData.questionSets.push({
                ...setData,
                questions: questions
            });
            
            loadedSetIds.add(doc.id);
        }
        
        // If user is signed in, also get their private sets
        if (currentUser && !currentUser.isAnonymous) {
            console.log('Loading private sets for user:', currentUser.uid);  // DEBUG
            
            const userSetsSnapshot = await db.collection('questionSets')
                .where('createdBy', '==', currentUser.uid)
                .where('isPublic', '==', false)
                .get();
            
            console.log('Private sets found:', userSetsSnapshot.size);  // DEBUG
            
            for (const doc of userSetsSnapshot.docs) {
                console.log('Processing private set:', doc.id);  // DEBUG
                
                if (loadedSetIds.has(doc.id)) {
                    console.log('DUPLICATE DETECTED:', doc.id);  // DEBUG
                    continue;
                }
                
                const setData = doc.data();
                const questionsSnapshot = await doc.ref.collection('questions').get();
                const questions = questionsSnapshot.docs.map(qDoc => qDoc.data());
                
                questionSetsData.questionSets.push({
                    ...setData,
                    questions: questions
                });
                
                loadedSetIds.add(doc.id);
            }
        }
        
        console.log('Total question sets loaded:', questionSetsData.questionSets.length);
        console.log('Question sets:', questionSetsData.questionSets.map(s => s.id));  // DEBUG
        
        // Populate dropdowns
        populateQuestionSetDropdowns();
        
    } catch (error) {
        console.error('Error loading question sets:', error);
    }
}

// Populate question set dropdowns
function populateQuestionSetDropdowns() {
    if (!questionSetsData) return;
    
    // Clear existing options
    questionSetSelect.innerHTML = '';
    singlePlayerSetSelect.innerHTML = '';
    
    // Add each set as an option
    questionSetsData.questionSets.forEach(set => {
        const option1 = document.createElement('option');
        option1.value = set.id;
        option1.textContent = set.name + ' (' + set.questions.length + ' questions)';
        questionSetSelect.appendChild(option1);
        
        const option2 = document.createElement('option');
        option2.value = set.id;
        option2.textContent = set.name + ' (' + set.questions.length + ' questions)';
        singlePlayerSetSelect.appendChild(option2);
    });
}

// Get questions from selected set
function getQuestionsFromSet(setId) {
    if (!questionSetsData) return [];
    const set = questionSetsData.questionSets.find(s => s.id === setId);
    return set ? set.questions : [];
}

// ============================================
// MOBILE INTERFACE
// ============================================

// Detect if mobile device
// Detect if mobile device
// Detect if mobile device - UPDATED for better detection
const isMobile = (
    /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent) || 
    window.innerWidth <= 768 ||
    ('ontouchstart' in window) // Touch support
) && window.innerWidth <= 768; // AND narrow screen

console.log('Is mobile:', isMobile, 'Width:', window.innerWidth);  // DEBUG

// Mobile DOM elements
const mobileLobby = document.getElementById('mobile-lobby');
const mobileGameContainer = document.querySelector('.mobile-game-container');
const mobileNameInput = document.getElementById('mobile-name-input');
const mobileRoomCode = document.getElementById('mobile-room-code');
const mobileJoinBtn = document.getElementById('mobile-join-btn');
const mobileError = document.getElementById('mobile-error');

const mobileRound = document.getElementById('mobile-round');
const mobileTimerValue = document.getElementById('mobile-timer-value');
const mobileBrainSlice = document.getElementById('mobile-brain-slice');
const mobileMarker = document.getElementById('mobile-marker');
const mobileSliceSlider = document.getElementById('mobile-slice-slider');
const mobileSliceNum = document.getElementById('mobile-slice-num');
const mobileSubmitBtn = document.getElementById('mobile-submit-btn');
const mobileExitBtn = document.getElementById('mobile-exit-btn');

const mobileResultsOverlay = document.getElementById('mobile-results-overlay');
const mobileResultsModal = document.getElementById('mobile-results-modal');
const mobileResultsRound = document.getElementById('mobile-results-round');
const mobileScoreValue = document.getElementById('mobile-score-value');
const mobileLeaderboardList = document.getElementById('mobile-leaderboard-list');
const mobileContinueBtn = document.getElementById('mobile-continue-btn');
const mobileExitResultsBtn = document.getElementById('mobile-exit-results-btn');
const mobileWaitingMsg = document.getElementById('mobile-waiting-msg');
const mobileWaitingTimer = document.getElementById('mobile-waiting-timer');

// Mobile state
let mobileCurrentSlice = 13;
let mobileClickPosition = null;
let mobileTimer = null;
let mobileTimeRemaining = 30;

// Show mobile or desktop lobby on load
if (isMobile) {
    mobileLobby.classList.remove('hidden');
    document.getElementById('lobby-screen').style.display = 'none';
} else {
    mobileLobby.classList.add('hidden');
}

mobileJoinBtn.addEventListener('click', async () => {
    const roomCode = mobileRoomCode.value.trim().toUpperCase();
    const displayName = mobileNameInput.value.trim() || 'Guest';
    
    if (!roomCode || roomCode.length !== 6) {
        mobileError.textContent = 'Please enter a valid 6-digit room code';
        mobileError.classList.remove('hidden');
        return;
    }
    
    mobileError.classList.add('hidden');
    
    try {
        // Sign in anonymously
        if (!currentUser) {
            await auth.signInAnonymously();
        }
        
        // Check if room exists
        roomRef = db.collection('rooms').doc(roomCode);
        const roomDoc = await roomRef.get();
        
        if (!roomDoc.exists) {
            mobileError.textContent = 'Room not found';
            mobileError.classList.remove('hidden');
            return;
        }
        
        const roomData = roomDoc.data();
        
        // Check if room is abandoned
        if (roomData.status === 'abandoned') {
            mobileError.textContent = 'This room has been closed';
            mobileError.classList.remove('hidden');
            return;
        }
        
        if (roomData.status !== 'waiting') {
            mobileError.textContent = 'Game already in progress';
            mobileError.classList.remove('hidden');
            return;
        }
        
        // Join room
        currentRoomCode = roomCode;
        playerName = displayName;
        isRoomCreator = false;
        
        playersRef = roomRef.collection('players');
        
        // Check if name is taken
        const existingPlayer = await playersRef.doc(playerName).get();
        if (existingPlayer.exists) {
            mobileError.textContent = 'Name already taken in this room';
            mobileError.classList.remove('hidden');
            return;
        }
        
        await playersRef.doc(playerName).set({
            name: playerName,
            joinedAt: firebase.firestore.FieldValue.serverTimestamp(),
            isCreator: false,
            score: 0,
            isMobile: true
        });
        
        console.log('Mobile user joined room:', roomCode);
        
        // Hide lobby
        mobileLobby.classList.add('hidden');
        
        // Show mobile waiting panel
        const mobileWaitingPanel = document.getElementById('mobile-waiting-panel');
        if (!mobileWaitingPanel) {
            console.error('Mobile waiting panel not found!');
            alert('Error: Waiting screen not available. Please use desktop version.');
            return;
        }
        
        mobileWaitingPanel.classList.remove('hidden');
        
        // Set room code
        const mobileWaitingRoomCode = document.getElementById('mobile-waiting-room-code');
        if (mobileWaitingRoomCode) {
            mobileWaitingRoomCode.textContent = roomCode;
        }
        
        // Listen for players
        const mobileWaitingPlayersList = document.getElementById('mobile-waiting-players-list');
        if (mobileWaitingPlayersList) {
            playersRef.onSnapshot((snapshot) => {
                mobileWaitingPlayersList.innerHTML = '';
                snapshot.forEach((doc) => {
                    const player = doc.data();
                    const div = document.createElement('div');
                    div.className = 'mobile-waiting-player';
                    div.textContent = player.name + (player.isCreator ? ' (Host)' : '');
                    mobileWaitingPlayersList.appendChild(div);
                });
            });
        }
        
        // Listen for game start
        listenForGameStart();
        
        // Start guest monitoring
        startGuestMonitoring();
        
        // Add leave button handler
        const mobileLeaveBtn = document.getElementById('mobile-leave-waiting-btn');
        if (mobileLeaveBtn) {
            mobileLeaveBtn.addEventListener('click', async () => {
                if (confirm('Are you sure you want to leave?')) {
                    await leaveRoom();
                    mobileWaitingPanel.classList.add('hidden');
                    mobileLobby.classList.remove('hidden');
                }
            });
        }
        
    } catch (error) {
        console.error('Mobile join error:', error);
        mobileError.textContent = 'Error joining room';
        mobileError.classList.remove('hidden');
    }
});

// Mobile slice slider
mobileSliceSlider.addEventListener('input', (e) => {
    mobileCurrentSlice = parseInt(e.target.value);
    updateMobileSlice();
    updateMobileMarkerOpacity();
});

// Update mobile slice
function updateMobileSlice() {
    const sliceStr = String(mobileCurrentSlice).padStart(3, '0');
    mobileBrainSlice.src = `images/slice_${sliceStr}.png`;
    mobileSliceNum.textContent = mobileCurrentSlice;
}

// Mobile tap on brain
mobileBrainSlice.addEventListener('click', (e) => {
    const rect = mobileBrainSlice.getBoundingClientRect();
    const viewer = document.querySelector('.mobile-brain-viewer');
    const viewerRect = viewer.getBoundingClientRect();
    
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    
    mobileClickPosition = {
        x: x / rect.width,
        y: y / rect.height,
        slice: mobileCurrentSlice
    };
    
    // Position marker
    const markerX = e.clientX - viewerRect.left;
    const markerY = e.clientY - viewerRect.top;
    
    mobileMarker.style.left = markerX + 'px';
    mobileMarker.style.top = markerY + 'px';
    mobileMarker.classList.add('show');
    
    console.log('Mobile clicked position:', mobileClickPosition);
});

// Update marker opacity
function updateMobileMarkerOpacity() {
    if (mobileMarker && mobileClickPosition) {
        if (mobileCurrentSlice === mobileClickPosition.slice) {
            mobileMarker.style.opacity = '1';
        } else {
            mobileMarker.style.opacity = '0.3';
        }
    }
}

// Mobile submit guess
mobileSubmitBtn.addEventListener('click', async () => {
    if (!mobileClickPosition) {
        alert('Please tap on the brain image to mark your guess');
        return;
    }
    
    if (!currentQuestion) {
        alert('No question loaded');
        return;
    }
    
    // Stop timer
    stopMobileTimer();
    
    // Calculate distance and score (same logic as desktop)
    const dx = mobileClickPosition.x - currentQuestion.x;
    const dy = mobileClickPosition.y - currentQuestion.y;
    const dz = (mobileClickPosition.slice - currentQuestion.slice) / totalSlices;
    
    const distance = Math.sqrt(dx*dx + dy*dy + dz*dz);
    const score = Math.max(0, Math.round(1000 * Math.exp(-distance * 3)));
    
    totalScore += score;
    
    // Save to Firebase
    hasSubmittedThisRound = true;
    mobileSubmitBtn.disabled = true;
    
    await playersRef.doc(playerName).update({
        [`round${currentRound}`]: {
            x: mobileClickPosition.x,
            y: mobileClickPosition.y,
            slice: mobileClickPosition.slice,
            score: score,
            distance: distance,
            submittedAt: firebase.firestore.FieldValue.serverTimestamp()
        },
        score: totalScore
    });
    
    console.log('Mobile submission saved');
    
    // Show waiting
    mobileTimerValue.textContent = 'Waiting...';
    
    // Wait for all players
    waitForAllSubmissions();
});

// Mobile exit game
mobileExitBtn.addEventListener('click', async () => {
    if (confirm('Are you sure you want to exit?')) {
        if (playersRef && playerName) {
            await playersRef.doc(playerName).delete();
        }
        location.reload();
    }
});

// Mobile timer - UPDATED to use server time
function startMobileTimer(seconds) {
    // Clear any existing timer
    if (mobileTimer) clearInterval(mobileTimer);
    
    const timerElement = document.querySelector('.mobile-timer');
    timerElement.classList.remove('warning');
    mobileTimerValue.textContent = seconds;
    
    // Listen to room for server timestamp
    const mobileTimerUnsubscribe = roomRef.onSnapshot((doc) => {
        if (!doc.exists) {
            clearInterval(mobileTimer);
            if (mobileTimerUnsubscribe) mobileTimerUnsubscribe();
            return;
        }
        
        const data = doc.data();
        const roundStartTime = data.roundStartTime?.toMillis();
        const roundDuration = data.timerSeconds || seconds;
        
        if (!roundStartTime) return;
        
        // Clear any existing interval before starting new one
        if (mobileTimer) clearInterval(mobileTimer);
        
        // Calculate time remaining based on server time
        const updateTimer = () => {
            const now = Date.now();
            const elapsed = (now - roundStartTime) / 1000; // seconds elapsed
            mobileTimeRemaining = Math.max(0, Math.ceil(roundDuration - elapsed));
            
            mobileTimerValue.textContent = mobileTimeRemaining;
            
            // Warning animation at 10 seconds
            if (mobileTimeRemaining <= 10) {
                timerElement.classList.add('warning');
            }
            
            // Time's up
            if (mobileTimeRemaining <= 0) {
                clearInterval(mobileTimer);
                if (mobileTimerUnsubscribe) mobileTimerUnsubscribe();
                autoSubmitMobileRound();
            }
        };
        
        // Update immediately
        updateTimer();
        
        // Then update every 100ms for smooth countdown
        mobileTimer = setInterval(updateTimer, 100);
    });
    
    // Store unsubscribe function for cleanup
    window.mobileTimerUnsubscribe = mobileTimerUnsubscribe;
}

// Stop mobile timer - UPDATED to clean up listener
function stopMobileTimer() {
    if (mobileTimer) {
        clearInterval(mobileTimer);
        mobileTimer = null;
    }
    
    // Unsubscribe from room timer listener
    if (window.mobileTimerUnsubscribe) {
        window.mobileTimerUnsubscribe();
        window.mobileTimerUnsubscribe = null;
    }
}

// Auto-submit on timeout
function autoSubmitMobileRound() {
    if (!mobileClickPosition) {
        mobileClickPosition = { x: 0, y: 0, slice: 0 };
        
        if (currentRoomCode) {
            hasSubmittedThisRound = true;
            mobileSubmitBtn.disabled = true;
            
            playersRef.doc(playerName).update({
                [`round${currentRound}`]: {
                    x: 0, y: 0, slice: 0,
                    score: 0, distance: 999,
                    submittedAt: firebase.firestore.FieldValue.serverTimestamp(),
                    timedOut: true
                }
            });
            
            mobileTimerValue.textContent = 'Time\'s up!';
            waitForAllSubmissions();
            return;
        }
    }
    
    mobileSubmitBtn.click();
}

// Show mobile results
function showMobileResults(score, distance, allPlayersData) {
    console.log('showMobileResults called');
    mobileResultsRound.textContent = currentRound;
    mobileScoreValue.textContent = score;
    
    // Update leaderboard
    updateMobileLeaderboard(allPlayersData);
    
    mobileResultsOverlay.classList.remove('hidden');
    mobileResultsModal.classList.remove('hidden');
}

// Update mobile leaderboard
function updateMobileLeaderboard(allPlayersData) {
    if (!allPlayersData) return;
    
    const sortedPlayers = allPlayersData.sort((a, b) => b.score - a.score);
    
    mobileLeaderboardList.innerHTML = '';
    
    sortedPlayers.forEach((player, index) => {
        const item = document.createElement('div');
        item.className = 'mobile-leaderboard-item';
        
        if (player.name === playerName) {
            item.classList.add('current');
        }
        
        const rank = document.createElement('span');
        rank.className = 'mobile-leaderboard-rank';
        if (index === 0) rank.classList.add('first');
        rank.textContent = '#' + (index + 1);
        
        const name = document.createElement('span');
        name.className = 'mobile-leaderboard-name';
        name.textContent = player.name;
        
        const score = document.createElement('span');
        score.className = 'mobile-leaderboard-score';
        score.textContent = player.score || 0;
        
        item.appendChild(rank);
        item.appendChild(name);
        item.appendChild(score);
        
        mobileLeaderboardList.appendChild(item);
    });
}

// Mobile continue button
mobileContinueBtn.addEventListener('click', async () => {
    await playersRef.doc(playerName).update({
        [`round${currentRound}Ready`]: true
    });
    
    mobileContinueBtn.disabled = true;
    mobileContinueBtn.textContent = 'Waiting...';
    mobileWaitingMsg.classList.remove('hidden');
    
    // Countdown
    let countdown = 15;
    mobileWaitingTimer.textContent = countdown;
    const countdownInterval = setInterval(() => {
        countdown--;
        mobileWaitingTimer.textContent = countdown;
        if (countdown <= 0) clearInterval(countdownInterval);
    }, 1000);
    
    waitForNextRound();
});

// Mobile exit from results
mobileExitResultsBtn.addEventListener('click', async () => {
    if (confirm('Are you sure you want to exit?')) {
        if (playersRef && playerName) {
            await playersRef.doc(playerName).delete();
        }
        location.reload();
    }
});

// Hide mobile results
function hideMobileResults() {
    mobileResultsOverlay.classList.add('hidden');
    mobileResultsModal.classList.add('hidden');
    mobileContinueBtn.disabled = false;
    mobileContinueBtn.textContent = 'Continue';
    mobileWaitingMsg.classList.add('hidden');
}

// Start mobile game
function startMobileGame(roomData) {
    console.log('Starting mobile game');
    
    // STOP HOST PRESENCE UPDATES
    if (window.hostPresenceInterval) {
        clearInterval(window.hostPresenceInterval);
        window.hostPresenceInterval = null;
    }
    
    if (window.hostPresenceChecker) {
        clearInterval(window.hostPresenceChecker);
        window.hostPresenceChecker = null;
    }
    
    // Hide mobile lobby AND waiting panel
    mobileLobby.classList.add('hidden');
    mobileLobby.style.display = 'none';  // FORCE HIDE
    
    const mobileWaitingPanel = document.getElementById('mobile-waiting-panel');
    if (mobileWaitingPanel) {
        mobileWaitingPanel.classList.add('hidden');
        mobileWaitingPanel.style.display = 'none';  // FORCE HIDE
    }
    
    // Show game container
    mobileGameContainer.classList.remove('hidden');
    mobileGameContainer.style.display = 'flex';  // FORCE SHOW
    
    // Reset state
    currentRound = 1;
    totalScore = 0;
    mobileRound.textContent = currentRound;
    
    // Load first question
    loadNewQuestion();
    
    // Start timer
    startMobileTimer(roomData.timerSeconds);
}