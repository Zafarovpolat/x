const WebSocket = require('ws');
const express = require('express');
const path = require('path');
const cors = require('cors');
const bcrypt = require('bcrypt');

const app = express();

app.use(cors({
    origin: '*',
}));

app.use(express.static(path.join(__dirname, '../client')));

const server = app.listen(process.env.PORT || 8080, () => {
    console.log('Server started on port', server.address().port);
});
const wss = new WebSocket.Server({ server });

const clients = new Map();
const activeExams = new Map();

const adminUsername = 'admin';
const adminPasswordHash = '$2b$10$rmDgt6JvnOC7VuNrdur1LeuJIVGd9U3Vl46cCGwChA.tkdfOcYBoC';

wss.on('connection', ws => {
    console.log('Клиент подключился');

    const clientId = Math.random().toString(36).substr(2, 9);
    clients.set(clientId, { ws, role: null, lastActive: Date.now() });
    ws.clientId = clientId;

    const pingInterval = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) {
            ws.ping();
            clients.get(clientId).lastActive = Date.now();
        }
    }, 30000);

    ws.on('pong', () => {
        clients.get(clientId).lastActive = Date.now();
    });

    ws.on('message', async message => {
        console.log('Получено сообщение:', message);

        try {
            const parsedMessage = JSON.parse(message);

            if (parsedMessage.type === 'login') {
                const { username, password } = parsedMessage;
                if (username === adminUsername) {
                    const isMatch = await bcrypt.compare(password, adminPasswordHash);
                    ws.send(JSON.stringify({
                        type: 'loginResponse',
                        success: isMatch
                    }));
                } else {
                    ws.send(JSON.stringify({
                        type: 'loginResponse',
                        success: false
                    }));
                }
                return;
            }

            if (parsedMessage.role) {
                clients.get(clientId).role = parsedMessage.role;
                console.log(`Клиент ${clientId} зарегистрирован как ${parsedMessage.role}`);

                if (parsedMessage.role === 'exam') {
                    const examsData = Array.from(activeExams.entries()).map(([examClientId, examData]) => ({
                        clientId: examClientId,
                        userInfo: examData.userInfo,
                        questions: examData.questions,
                        timer: examData.timer
                    }));
                    ws.send(JSON.stringify({ type: 'initialState', exams: examsData }));
                }
                return;
            }

            if ((parsedMessage.question || parsedMessage.questionImg) && clients.get(clientId).role === 'helper') {
                parsedMessage.clientId = clientId;

                if (!activeExams.has(clientId)) {
                    activeExams.set(clientId, { userInfo: parsedMessage.userInfo, questions: [], timer: parsedMessage.timer });
                }
                const examData = activeExams.get(clientId);
                const questionData = {
                    qIndex: parsedMessage.qIndex,
                    question: parsedMessage.question,
                    questionImg: parsedMessage.questionImg,
                    answers: parsedMessage.answers
                };
                examData.questions.push(questionData);
                examData.timer = parsedMessage.timer;

                wss.clients.forEach(client => {
                    if (client.readyState === WebSocket.OPEN && clients.get(client.clientId).role === 'exam') {
                        client.send(JSON.stringify(parsedMessage));
                    }
                });
            }

            if (parsedMessage.answer && clients.get(clientId).role === 'exam') {
                const targetClient = clients.get(parsedMessage.clientId);
                if (targetClient && targetClient.ws.readyState === WebSocket.OPEN) {
                    targetClient.ws.send(JSON.stringify(parsedMessage));
                }
            }

            if (parsedMessage.processedAnswer && clients.get(clientId).role === 'helper') {
                wss.clients.forEach(client => {
                    if (client.readyState === WebSocket.OPEN && clients.get(client.clientId).role === 'exam') {
                        client.send(JSON.stringify(parsedMessage));
                    }
                });
            }

            if (parsedMessage.type === 'timerUpdate' && clients.get(clientId).role === 'helper') {
                if (activeExams.has(clientId)) {
                    activeExams.get(clientId).timer = parsedMessage.timer;
                    wss.clients.forEach(client => {
                        if (client.readyState === WebSocket.OPEN && clients.get(client.clientId).role === 'exam') {
                            client.send(JSON.stringify({
                                type: 'timerUpdate',
                                clientId: clientId,
                                timer: parsedMessage.timer
                            }));
                        }
                    });
                }
            }

            // Обработка сообщения о выбранном ответе
            if (parsedMessage.type === 'userAnswer' && clients.get(clientId).role === 'helper') {
                wss.clients.forEach(client => {
                    if (client.readyState === WebSocket.OPEN && clients.get(client.clientId).role === 'exam') {
                        client.send(JSON.stringify(parsedMessage));
                    }
                });
            }
        } catch (e) {
            console.error('Ошибка парсинга JSON на сервере:', e);
        }
    });

    ws.on('close', () => {
        console.log('Клиент отключился:', clientId);
        clearInterval(pingInterval);
        const client = clients.get(clientId);

        if (client && client.role === 'helper') {
            activeExams.delete(clientId);
            wss.clients.forEach(client => {
                if (client.readyState === WebSocket.OPEN && clients.get(client.clientId).role === 'exam') {
                    client.send(JSON.stringify({ type: 'clientDisconnected', clientId }));
                }
            });
        }

        clients.delete(clientId);
    });

    setInterval(() => {
        clients.forEach((client, id) => {
            const inactiveTime = (Date.now() - client.lastActive) / 1000;
            if (inactiveTime > 60 && client.ws.readyState !== WebSocket.OPEN) {
                console.log(`Клиент ${id} неактивен более 60 секунд, удаление`);
                if (client.role === 'helper') {
                    activeExams.delete(id);
                    wss.clients.forEach(otherClient => {
                        if (otherClient.readyState === WebSocket.OPEN && clients.get(otherClient.clientId).role === 'exam') {
                            otherClient.send(JSON.stringify({ type: 'clientDisconnected', clientId: id }));
                        }
                    });
                }
                clients.delete(id);
            }
        });
    }, 60000);
});

console.log('WebSocket сервер запущен');