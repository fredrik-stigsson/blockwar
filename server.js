const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const { v4: uuidv4 } = require('uuid');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

app.use(express.static(path.join(__dirname, 'public')));

// Game constants
const BOARD_WIDTH = 10;
const BOARD_HEIGHT = 20;
const TETROMINOS = {
    I: { 
        shape: [[0,0,0,0], [1,1,1,1], [0,0,0,0], [0,0,0,0]], 
        color: 'cyan' 
    },
    O: { 
        shape: [[1,1], [1,1]], 
        color: 'yellow' 
    },
    T: { 
        shape: [[0,1,0], [1,1,1], [0,0,0]], 
        color: 'purple' 
    },
    S: { 
        shape: [[0,1,1], [1,1,0], [0,0,0]], 
        color: 'green' 
    },
    Z: { 
        shape: [[1,1,0], [0,1,1], [0,0,0]], 
        color: 'red' 
    },
    J: { 
        shape: [[1,0,0], [1,1,1], [0,0,0]], 
        color: 'blue' 
    },
    L: { 
        shape: [[0,0,1], [1,1,1], [0,0,0]], 
        color: 'orange' 
    }
};

const POWERUPS = {
    ADD_ROW: { 
        name: 'Add Row', 
        probability: 28,
        icon: '📦',
        description: 'Adds 2 garbage rows to target'
    },
    REMOVE_ROW: { 
        name: 'Remove Row', 
        probability: 28,
        icon: '🗑️',
        description: 'Removes 2 rows from target'
    },
    EARTHQUAKE: { 
        name: 'Earthquake', 
        probability: 7,
        icon: '🌋',
        description: 'Shakes the target\'s board'
    },
    MILKSHAKE: { 
        name: 'Milkshake', 
        probability: 4,
        icon: '🥤',
        description: 'Randomly swaps rows on target\'s board'
    },
    POWERUPS_AWAY: { 
        name: 'Powerups Away', 
        probability: 6,
        icon: '🚫',
        description: 'Removes all powerups from target'
    },
    SHOTGUN: { 
        name: 'Shotgun', 
        probability: 9,
        icon: '🔫',
        description: 'Clears 3 random columns'
    },
    GRAVITATION: { 
        name: 'Gravitation', 
        probability: 5,
        icon: '⬇️',
        description: 'Makes all pieces fall to bottom'
    },
    CLEAR_ARENA: { 
        name: 'Clear Arena', 
        probability: 4,
        icon: '🧹',
        description: 'Clears the entire board'
    },
    SWITCH_ARENA: { 
        name: 'Switch Arena', 
        probability: 4,
        icon: '🔄',
        description: 'Switches boards with random player'
    },
    MONSTER: { 
        name: 'Monster', 
        probability: 1,
        icon: '👾',
        description: 'Adds 5 garbage rows to target'
    },
    MINBOMB: { 
        name: 'Minibomb', 
        probability: 4,
        icon: '💣',
        description: 'Clears a 3x3 area randomly'
    }
};

class GameRoom {
    constructor(roomId, hostId, roomName) {
        this.roomId = roomId;
        this.hostId = hostId;
        this.roomName = roomName;
        this.players = new Map();
        this.gameState = 'waiting';
        this.gameInterval = null;
        this.winner = null;
    }

    addPlayer(playerId, playerName) {
        this.players.set(playerId, {
            id: playerId,
            name: playerName,
            board: this.createEmptyBoard(),
            currentPiece: null,
            nextPiece: null,
            position: { x: 0, y: 0 },
            score: 0,
            powerups: [],
            isGameOver: false,
            linesCleared: 0,
            isHost: playerId === this.hostId,
            rotation: 0
        });
        
        if (this.gameState === 'playing') {
            this.spawnNewPiece(playerId);
        }
        
        // Broadcast to ALL players in the room
        this.broadcastLobbyState();
    }

    removePlayer(playerId) {
        const wasHost = playerId === this.hostId;
        this.players.delete(playerId);
        
        if (wasHost && this.players.size > 0) {
            this.hostId = this.players.keys().next().value;
            const newHost = this.players.get(this.hostId);
            newHost.isHost = true;
        }
        
        // Broadcast to ALL players in the room
        this.broadcastLobbyState();
    }

    createEmptyBoard() {
        return Array.from({ length: BOARD_HEIGHT }, () => Array(BOARD_WIDTH).fill(0));
    }

    spawnNewPiece(playerId) {
        const player = this.players.get(playerId);
        if (!player) return;

        const pieces = Object.keys(TETROMINOS);
        const randomPiece = pieces[Math.floor(Math.random() * pieces.length)];
        
        if (!player.nextPiece) {
            player.nextPiece = randomPiece;
        }
        
        player.currentPiece = player.nextPiece;
        player.nextPiece = pieces[Math.floor(Math.random() * pieces.length)];
        player.rotation = 0;
        
        const pieceWidth = TETROMINOS[player.currentPiece].shape[0].length;
        player.position = { 
            x: Math.floor(BOARD_WIDTH / 2) - Math.floor(pieceWidth / 2),
            y: 0 
        };

        if (this.checkCollision(playerId)) {
            player.isGameOver = true;
            this.checkGameEnd();
        }
    }

    checkCollision(playerId) {
        const player = this.players.get(playerId);
        const shape = this.getCurrentShape(playerId);
        
        for (let y = 0; y < shape.length; y++) {
            for (let x = 0; x < shape[y].length; x++) {
                if (shape[y][x] !== 0) {
                    const newX = player.position.x + x;
                    const newY = player.position.y + y;
                    
                    if (newX < 0 || newX >= BOARD_WIDTH || newY >= BOARD_HEIGHT) {
                        return true;
                    }
                    
                    if (newY >= 0 && player.board[newY][newX] !== 0) {
                        return true;
                    }
                }
            }
        }
        return false;
    }

    getCurrentShape(playerId) {
        const player = this.players.get(playerId);
        let shape = TETROMINOS[player.currentPiece].shape;
        
        for (let i = 0; i < player.rotation; i++) {
            shape = shape[0].map((_, index) =>
                shape.map(row => row[index]).reverse()
            );
        }
        
        return shape;
    }

    movePiece(playerId, direction) {
        const player = this.players.get(playerId);
        if (!player || player.isGameOver || this.gameState !== 'playing') return;

        const newPosition = { ...player.position };
        
        switch (direction) {
            case 'left': newPosition.x--; break;
            case 'right': newPosition.x++; break;
            case 'down': newPosition.y++; break;
        }

        const oldPosition = player.position;
        player.position = newPosition;
        
        if (this.checkCollision(playerId)) {
            player.position = oldPosition;
            if (direction === 'down') {
                this.lockPiece(playerId);
            }
        }
    }

    rotatePiece(playerId) {
        const player = this.players.get(playerId);
        if (!player || player.isGameOver || this.gameState !== 'playing') return;

        const oldRotation = player.rotation;
        
        player.rotation = (player.rotation + 1) % 4;
        
        if (this.checkCollision(playerId)) {
            player.position.x--;
            if (!this.checkCollision(playerId)) {
                return;
            }
            player.position.x += 2;
            
            if (!this.checkCollision(playerId)) {
                return;
            }
            
            player.position.x--;
            player.rotation = oldRotation;
        }
    }

    hardDrop(playerId) {
        const player = this.players.get(playerId);
        if (!player || player.isGameOver || this.gameState !== 'playing') return;

        while (!this.checkCollision(playerId)) {
            player.position.y++;
        }
        player.position.y--;
        this.lockPiece(playerId);
    }

    lockPiece(playerId) {
        const player = this.players.get(playerId);
        const shape = this.getCurrentShape(playerId);
        const color = TETROMINOS[player.currentPiece].color;
        
        for (let y = 0; y < shape.length; y++) {
            for (let x = 0; x < shape[y].length; x++) {
                if (shape[y][x] !== 0) {
                    const boardY = player.position.y + y;
                    const boardX = player.position.x + x;
                    if (boardY >= 0 && boardY < BOARD_HEIGHT && boardX >= 0 && boardX < BOARD_WIDTH) {
                        player.board[boardY][boardX] = color;
                    }
                }
            }
        }

        const linesCleared = this.clearLines(playerId);
        if (linesCleared >= 2) {
            this.grantRandomPowerup(playerId);
        }

        this.spawnNewPiece(playerId);
    }

    clearLines(playerId) {
        const player = this.players.get(playerId);
        let linesCleared = 0;
        
        for (let y = BOARD_HEIGHT - 1; y >= 0; y--) {
            if (player.board[y].every(cell => cell !== 0)) {
                player.board.splice(y, 1);
                player.board.unshift(Array(BOARD_WIDTH).fill(0));
                linesCleared++;
                y++;
            }
        }

        player.linesCleared += linesCleared;
        player.score += linesCleared * 100;
        
        return linesCleared;
    }

    grantRandomPowerup(playerId) {
        const powerup = this.getRandomPowerup();
        const powerupData = {
            type: powerup,
            name: POWERUPS[powerup].name,
            icon: POWERUPS[powerup].icon,
            description: POWERUPS[powerup].description
        };
        
        const player = this.players.get(playerId);
        player.powerups.push(powerupData);
        
        io.to(this.roomId).emit('powerupAcquired', {
            playerId: playerId,
            playerName: player.name,
            powerup: powerupData
        });
    }

    getRandomPowerup() {
        // Precompute the probability array once if possible, or create it each time
        const probabilityArray = [];
        
        for (const [key, powerup] of Object.entries(POWERUPS)) {
            // Add the key to the array 'probability' number of times
            for (let i = 0; i < powerup.probability; i++) {
                probabilityArray.push(key);
            }
        }
        
        // Get random index from 0 to 99
        const randomIndex = Math.floor(Math.random() * 100);
        
        // Return the key at that position
        return probabilityArray[randomIndex];
    }

    usePowerup(playerId, targetPlayerId = null) {
        const player = this.players.get(playerId);
        if (!player || player.powerups.length === 0 || this.gameState !== 'playing') return;

        const powerupData = player.powerups[0];
        const powerup = powerupData.type;
        
        let targetPlayer = player;
        
        if (targetPlayerId) {
            targetPlayer = this.players.get(targetPlayerId);
            if (!targetPlayer) {
                targetPlayer = player;
            }
        }

        switch (powerup) {
            case 'ADD_ROW':
                this.addGarbageRows(targetPlayer.id, 2);
                break;
            case 'REMOVE_ROW':
                this.removeRows(targetPlayer.id, 2);
                break;
            case 'EARTHQUAKE':
                this.earthquake(targetPlayer.id);
                break;
            case 'MILKSHAKE':
                this.milkshake(targetPlayer.id);
                break;
            case 'POWERUPS_AWAY':
                this.powerupsAway(targetPlayer.id);
                break;
            case 'SHOTGUN':
                this.shotgun(targetPlayer.id);
                break;
            case 'GRAVITATION':
                this.gravitation(targetPlayer.id);
                break;
            case 'CLEAR_ARENA':
                this.clearArena(targetPlayer.id);
                break;
            case 'SWITCH_ARENA':
                const playerArray = Array.from(this.players.values());
                if (playerArray.length >= 2) {
                    const randomPlayer = playerArray.find(p => p.id !== playerId);
                    if (randomPlayer) {
                        this.switchArena(playerId, randomPlayer.id);
                    }
                }
                break;
            case 'MONSTER':
                this.monster(targetPlayer.id);
                break;
            case 'MINBOMB':
                this.minibomb(targetPlayer.id);
                break;
        }

        player.powerups.shift();
        
        io.to(this.roomId).emit('powerupUsed', {
            playerId: playerId,
            playerName: player.name,
            targetPlayerId: targetPlayer.id,
            targetPlayerName: targetPlayer.name,
            powerup: powerupData
        });
    }

    addGarbageRows(playerId, rows) {
        const player = this.players.get(playerId);
        for (let i = 0; i < rows; i++) {
            player.board.shift();
            const newRow = Array(BOARD_WIDTH).fill('gray');
            const hole = Math.floor(Math.random() * BOARD_WIDTH);
            newRow[hole] = 0;
            player.board.push(newRow);
        }
    }

    removeRows(playerId, rows) {
        const player = this.players.get(playerId);
        for (let i = 0; i < rows && player.board.length > 0; i++) {
            player.board.pop();
            player.board.unshift(Array(BOARD_WIDTH).fill(0));
        }
    }

    earthquake(playerId) {
        const player = this.players.get(playerId);
        player.board.forEach(row => {
            const shift = Math.random() > 0.5 ? 1 : -1;
            if (shift === 1) {
                const last = row.pop();
                row.unshift(last);
            } else {
                const first = row.shift();
                row.push(first);
            }
        });
    }

    milkshake(playerId) {
        const player = this.players.get(playerId);
        for (let i = 0; i < 3; i++) {
            const row1 = Math.floor(Math.random() * BOARD_HEIGHT);
            const row2 = Math.floor(Math.random() * BOARD_HEIGHT);
            [player.board[row1], player.board[row2]] = [player.board[row2], player.board[row1]];
        }
    }

    powerupsAway(playerId) {
        const player = this.players.get(playerId);
        player.powerups = [];
    }

    shotgun(playerId) {
        const player = this.players.get(playerId);
        const colsToClear = 3;
        for (let i = 0; i < colsToClear; i++) {
            const col = Math.floor(Math.random() * BOARD_WIDTH);
            for (let row = 0; row < BOARD_HEIGHT; row++) {
                player.board[row][col] = 0;
            }
        }
    }

    gravitation(playerId) {
        const player = this.players.get(playerId);
        for (let col = 0; col < BOARD_WIDTH; col++) {
            let writeIndex = BOARD_HEIGHT - 1;
            for (let row = BOARD_HEIGHT - 1; row >= 0; row--) {
                if (player.board[row][col] !== 0) {
                    player.board[writeIndex][col] = player.board[row][col];
                    if (writeIndex !== row) {
                        player.board[row][col] = 0;
                    }
                    writeIndex--;
                }
            }
        }
    }

    clearArena(playerId) {
        const player = this.players.get(playerId);
        player.board = this.createEmptyBoard();
    }

    switchArena(playerId1, playerId2) {
        const player1 = this.players.get(playerId1);
        const player2 = this.players.get(playerId2);
        if (player1 && player2) {
            [player1.board, player2.board] = [player2.board, player1.board];
        }
    }

    monster(playerId) {
        const player = this.players.get(playerId);
        this.addGarbageRows(playerId, 5);
    }

    minibomb(playerId) {
        const player = this.players.get(playerId);
        const centerX = Math.floor(Math.random() * (BOARD_WIDTH - 2));
        const centerY = Math.floor(Math.random() * (BOARD_HEIGHT - 2));
        
        for (let y = centerY; y < centerY + 3; y++) {
            for (let x = centerX; x < centerX + 3; x++) {
                if (y >= 0 && y < BOARD_HEIGHT && x >= 0 && x < BOARD_WIDTH) {
                    player.board[y][x] = 0;
                }
            }
        }
    }

    checkGameEnd() {
        const activePlayers = Array.from(this.players.values()).filter(p => !p.isGameOver);
        
        if (activePlayers.length <= 1) {
            this.gameState = 'finished';
            this.winner = activePlayers[0] || null;
            this.stopGame();
            
            io.to(this.roomId).emit('gameEnded', {
                winner: this.winner,
                players: Array.from(this.players.values())
            });
            
            return true;
        }
        return false;
    }

    gameLoop() {
        this.players.forEach((player, playerId) => {
            if (!player.isGameOver) {
                this.movePiece(playerId, 'down');
            }
        });
        
        this.broadcastGameState();
    }

    broadcastLobbyState() {
        const lobbyData = {
            players: Array.from(this.players.values()).map(player => ({
                id: player.id,
                name: player.name,
                isHost: player.isHost,
                isGameOver: player.isGameOver
            })),
            roomId: this.roomId,
            roomName: this.roomName,
            gameState: this.gameState,
            playerCount: this.players.size
        };

        console.log(`Broadcasting lobby update for room ${this.roomId}:`, lobbyData.players.map(p => p.name));
        
        // Broadcast to ALL players in the room
        io.to(this.roomId).emit('lobbyUpdate', lobbyData);
    }

    broadcastGameState() {
        const gameData = {
            players: Array.from(this.players.values()).map(player => ({
                id: player.id,
                name: player.name,
                board: player.board,
                currentPiece: player.currentPiece,
                nextPiece: player.nextPiece,
                position: player.position,
                rotation: player.rotation,
                score: player.score,
                powerups: player.powerups,
                isGameOver: player.isGameOver,
                linesCleared: player.linesCleared,
                isHost: player.isHost
            })),
            gameState: this.gameState
        };

        io.to(this.roomId).emit('gameUpdate', gameData);
    }

    startGame() {
        if (this.gameState === 'waiting' && this.players.size >= 2) {
            this.gameState = 'playing';
            this.winner = null;
            
            this.players.forEach((player, playerId) => {
                player.board = this.createEmptyBoard();
                player.score = 0;
                player.powerups = [];
                player.isGameOver = false;
                player.linesCleared = 0;
                player.rotation = 0;
                this.spawnNewPiece(playerId);
            });
            
            this.gameInterval = setInterval(() => this.gameLoop(), 1000);
            this.broadcastGameState();
            return true;
        }
        return false;
    }

    stopGame() {
        if (this.gameInterval) {
            clearInterval(this.gameInterval);
            this.gameInterval = null;
        }
    }
}

// Game server state
const rooms = new Map();

io.on('connection', (socket) => {
    console.log('User connected:', socket.id);

    socket.on('createRoom', (data) => {
        const { playerName, roomName } = data;
        const roomId = uuidv4();
        const room = new GameRoom(roomId, socket.id, roomName);
        room.addPlayer(socket.id, playerName);
        rooms.set(roomId, room);
        
        socket.join(roomId);
        socket.emit('roomCreated', roomId);
        updateRoomList();
        
        console.log(`Room "${roomName}" (${roomId}) created by ${playerName} (${socket.id})`);
    });

    socket.on('joinRoom', (data) => {
        const { roomId, playerName } = data;
        const room = rooms.get(roomId);
        
        if (room && room.players.size < 4 && room.gameState === 'waiting') {
            room.addPlayer(socket.id, playerName);
            socket.join(roomId);
            socket.emit('roomJoined', roomId);
            
            // Send immediate lobby update to the joining player
            room.broadcastLobbyState();
            updateRoomList();
            
            console.log(`Player ${playerName} (${socket.id}) joined room "${room.roomName}" (${roomId})`);
        } else {
            socket.emit('joinError', 'Room is full, does not exist, or game has already started');
        }
    });

    socket.on('startGame', (roomId) => {
        const room = rooms.get(roomId);
        if (room && socket.id === room.hostId) {
            const success = room.startGame();
            if (success) {
                console.log(`Game started in room "${room.roomName}" (${roomId}) by host ${socket.id}`);
                io.to(roomId).emit('gameStarted');
            } else {
                socket.emit('startError', 'Need at least 2 players to start the game');
            }
        } else {
            socket.emit('startError', 'Only the host can start the game');
        }
    });

    socket.on('keyPress', (data) => {
        const { roomId, key } = data;
        const room = rooms.get(roomId);
        if (!room || room.gameState !== 'playing') return;

        switch (key) {
            case 'left': room.movePiece(socket.id, 'left'); break;
            case 'right': room.movePiece(socket.id, 'right'); break;
            case 'down': room.movePiece(socket.id, 'down'); break;
            case 'up': room.rotatePiece(socket.id); break;
            case 'space': room.hardDrop(socket.id); break;
        }

        room.broadcastGameState();
    });

    socket.on('usePowerup', (data) => {
        const { roomId, targetPlayerId } = data;
        const room = rooms.get(roomId);
        if (room && room.gameState === 'playing') {
            room.usePowerup(socket.id, targetPlayerId);
            room.broadcastGameState();
        }
    });

    socket.on('leaveRoom', (roomId) => {
        const room = rooms.get(roomId);
        if (room) {
            room.removePlayer(socket.id);
            socket.leave(roomId);
            
            if (room.players.size === 0) {
                rooms.delete(roomId);
                console.log(`Room "${room.roomName}" (${roomId}) deleted (no players left)`);
            }
            
            updateRoomList();
        }
    });

    socket.on('disconnect', () => {
        console.log('User disconnected:', socket.id);
        
        rooms.forEach((room, roomId) => {
            if (room.players.has(socket.id)) {
                const playerName = room.players.get(socket.id).name;
                room.removePlayer(socket.id);
                
                if (room.players.size === 0) {
                    rooms.delete(roomId);
                    console.log(`Room "${room.roomName}" (${roomId}) deleted (no players left)`);
                } else {
                    console.log(`Player ${playerName} left room "${room.roomName}" (${roomId})`);
                }
            }
        });
        
        updateRoomList();
    });

    function updateRoomList() {
        const roomList = Array.from(rooms.entries())
            .filter(([id, room]) => room.gameState === 'waiting') // Only include waiting rooms
            .map(([id, room]) => ({
                id,
                name: room.roomName,
                host: room.players.get(room.hostId)?.name || 'Unknown',
                playerCount: room.players.size,
                maxPlayers: 4,
                gameState: room.gameState
            }));
        io.emit('roomListUpdate', roomList);
    }

    updateRoomList();
});

const PORT = 3002;
server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});