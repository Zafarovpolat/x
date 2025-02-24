const WebSocket = require('ws');
const express = require('express');
const path = require('path');
const cors = require('cors');
const bcrypt = require('bcrypt'); // Добавляем bcrypt для хеширования

const app = express();

// Настраиваем CORS
app.use(cors({
    origin: '*',
}));

// Раздача статических файлов
app.use(express.static(path.join(__dirname, '../client')));

const server = app.listen(process.env.PORT || 8080, () => {
    console.log('Server started on port', server.address().port);
});
const wss = new WebSocket.Server({ server });

// Хранилище активных клиентов и их данных
const clients = new Map();
const activeExams = new Map();

// Предопределенные учетные данные (хеш пароля сгенерирован с помощью bcrypt)
const adminUsername = 'admin';
const adminPasswordHash = '$2b$10$YOUR_HASH_HERE'; // Замените на хеш вашего пароля (см. ниже как сгенерировать)

wss.on('connection', ws => {
    console.log('Клиент подключился');

    const clientId = Math.random().toString(36).substr(2, 9);
    clients.set(clientId, { ws, role: null });
    ws.clientId = clientId;

    ws.on('message', async message => {
        console.log('Получено сообщение:', message);

        try {
            const parsedMessage = JSON.parse(message);

            // Обработка логина
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

            // Регистрация роли
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

            // Обработка вопроса от helper
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

                wss.clients.forEach(client => {
                    if (client.readyState === WebSocket.OPEN && clients.get(client.clientId).role === 'exam') {
                        client.send(JSON.stringify(parsedMessage));
                    }
                });
            }

            // Ответ от exam отправляем конкретному helper
            if (parsedMessage.answer && clients.get(clientId).role === 'exam') {
                const targetClient = clients.get(parsedMessage.clientId);
                if (targetClient && targetClient.ws.readyState === WebSocket.OPEN) {
                    targetClient.ws.send(JSON.stringify(parsedMessage));
                }
            }

            // Обработанный ответ от helper отправляем всем exam
            if (parsedMessage.processedAnswer && clients.get(clientId).role === 'helper') {
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
});

console.log('WebSocket сервер запущен');