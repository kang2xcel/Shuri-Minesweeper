const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.static(__dirname));

const server = http.createServer(app);
const allowedOrigins = process.env.CLIENT_URL ? [process.env.CLIENT_URL] : ["http://localhost:3000"];
const io = new Server(server, { 
    cors: { 
        origin: allowedOrigins, 
        methods: ["GET", "POST"]
    } 
});

const rooms = {};

io.on('connection', (socket) => {
    console.log(`유저 접속됨: ${socket.id}`);

    // 1-1. 새로운 방 생성
    socket.on('createRoom', ({ nickname }) => {
        let roomCode;
        do {
            roomCode = String(Math.floor(1000 + Math.random() * 9000));
        } while (rooms[roomCode]);
        
        rooms[roomCode] = [];
        joinUserToRoom(socket, roomCode, nickname, true);
        socket.emit('roomCreated', roomCode);
    });

    // 1-2. 방 입장하기 (지통실 관전 입장도 동일하게 사용)
    socket.on('joinRoom', ({ roomCode, nickname }) => {
        if (!rooms[roomCode]) {
            socket.emit('roomError', '존재하지 않는 방입니다. 코드를 확인해주세요!');
            return;
        }
        joinUserToRoom(socket, roomCode, nickname, false);
        socket.emit('roomJoined', roomCode);
    });

    function joinUserToRoom(socket, roomCode, nickname, isHost) {
        socket.join(roomCode);
        const player = { 
            id: socket.id, 
            name: nickname, 
            status: 'waiting',  // waiting, playing, cleared, eliminated
            clearTime: null,    // 클리어 소요 시간(초)
            clearedAt: null,    // 클리어 달성 시각 (동점자 처리용)
            isHost: isHost
        };
        rooms[roomCode].push(player);
        io.to(roomCode).emit('updateRanking', rooms[roomCode]);
    }

    // 2. 닉네임 실시간 변경
    socket.on('changeNickname', ({ roomCode, newNickname }) => {
        if (!rooms[roomCode]) return;
        const player = rooms[roomCode].find(p => p.id === socket.id);
        if (player) {
            player.name = newNickname;
            io.to(roomCode).emit('updateRanking', rooms[roomCode]);
        }
    });

    // 3. 개별 플레이어 상태 및 클리어 타임 업데이트 (핵심 로직)
    socket.on('updatePlayerStatus', ({ roomCode, status, clearTime }) => {
        if (!rooms[roomCode]) return;
        const player = rooms[roomCode].find(p => p.id === socket.id);
        
        if (player) {
            player.status = status;
            if (status === 'cleared') {
                player.clearTime = clearTime;
                player.clearedAt = Date.now();
            } else if (status === 'playing') {
                player.clearTime = null;
                player.clearedAt = null;
            }
        }

        // 🔥 랭킹 정렬 로직: 클리어한 사람이 무조건 상위, 시간 짧은 순 > 먼저 깬 순
        rooms[roomCode].sort((a, b) => {
            if (a.status === 'cleared' && b.status !== 'cleared') return -1;
            if (a.status !== 'cleared' && b.status === 'cleared') return 1;
            
            if (a.status === 'cleared' && b.status === 'cleared') {
                if (a.clearTime !== b.clearTime) {
                    return a.clearTime - b.clearTime; // 시간 짧은 순 (오름차순)
                }
                return a.clearedAt - b.clearedAt;     // 시간 같으면 먼저 클리어한 순
            }
            return 0; // 클리어 못한 사람들 간의 순서는 유지
        });

        io.to(roomCode).emit('updateRanking', rooms[roomCode]);
    });

    // 4. 연결 끊김 처리
    socket.on('disconnect', () => {
        for (const roomCode in rooms) {
            const index = rooms[roomCode].findIndex(p => p.id === socket.id);
            if (index !== -1) {
                const wasHost = rooms[roomCode][index].isHost;
                rooms[roomCode].splice(index, 1);
                
                if (rooms[roomCode].length > 0) {
                    if (wasHost) rooms[roomCode][0].isHost = true;
                    io.to(roomCode).emit('updateRanking', rooms[roomCode]);
                } else {
                    delete rooms[roomCode];
                }
                break;
            }
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`🚀 지뢰찾기 멀티 서버 실행 중! (PORT: ${PORT})`);
});