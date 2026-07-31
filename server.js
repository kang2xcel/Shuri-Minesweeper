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
    }, 
    transports: ['websocket', 'polling'] // 웹소켓을 최우선으로 처리
});

const rooms = {};

io.on('connection', (socket) => {

	socket.on('changeDifficulty', (data) => {
            socket.broadcast.to(data.roomCode).emit('difficultyChanged', data);
        });
    console.log(`유저 접속됨: ${socket.id}`);

    socket.on('createRoom', ({ nickname }) => {
        let roomCode;
        do {
            roomCode = String(Math.floor(1000 + Math.random() * 9000));
        } while (rooms[roomCode]);
        
        rooms[roomCode] = [];
        joinUserToRoom(socket, roomCode, nickname, true);
        socket.emit('roomCreated', roomCode);
    });

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
            status: 'waiting',  // 실시간 상태 (waiting, playing, cleared, eliminated)
            bestTime: null,     // ⭐️ 핵심: 재도전해도 절대 지워지지 않는 최고 기록
            clearedAt: null,    // 동점자 판별용 달성 시각
            isHost: isHost
        };
        rooms[roomCode].push(player);
        io.to(roomCode).emit('updateRanking', rooms[roomCode]);
    }

    socket.on('changeNickname', ({ roomCode, newNickname }) => {
        if (!rooms[roomCode]) return;
        const player = rooms[roomCode].find(p => p.id === socket.id);
        if (player) {
            player.name = newNickname;
            io.to(roomCode).emit('updateRanking', rooms[roomCode]);
        }
    });

    // ⭐️ 스마트 상태 업데이트 및 최고 기록 보호 로직
    socket.on('updatePlayerStatus', ({ roomCode, status, clearTime }) => {
        if (!rooms[roomCode]) return;
        const player = rooms[roomCode].find(p => p.id === socket.id);
        
        if (player) {
            // 선수의 현재 실시간 상태(재도전, 폭발 등)는 항상 반영
            player.status = status;

            // 게임 클리어 시, 기록이 숫자인지 엄격히 검증
            if (status === 'cleared' && typeof clearTime === 'number') {
                // 첫 클리어이거나, 기존 최고 기록보다 더 빠를 때만 bestTime 단축 갱신!
                if (player.bestTime === null || clearTime < player.bestTime) {
                    player.bestTime = clearTime;
                    player.clearedAt = Date.now();
                }
            }
        }

        // ⭐️ 정렬 기준: 최고 기록(bestTime) 보유자 우선 > 시간 짧은 순 > 먼저 깬 순
        rooms[roomCode].sort((a, b) => {
            const hasA = typeof a.bestTime === 'number';
            const hasB = typeof b.bestTime === 'number';
            
            if (hasA && !hasB) return -1; // 기록 있는 선수가 상위
            if (!hasA && hasB) return 1;
            
            if (hasA && hasB) {
                if (a.bestTime !== b.bestTime) {
                    return a.bestTime - b.bestTime; // 시간 짧은 순 (오름차순)
                }
                return a.clearedAt - b.clearedAt;   // 시간 같으면 먼저 클리어한 순
            }
            return 0; // 기록 없는 선수들 간의 순서는 유지
        });

        io.to(roomCode).emit('updateRanking', rooms[roomCode]);
    });

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