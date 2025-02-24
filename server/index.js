const WebSocket = require('ws');

const wss = new WebSocket.Server({ port: 8080 });

const clients = new Map();

wss.on('connection', ws => {
    console.log('Клиент подключился');

    const clientId = Math.random().toString(36).substr(2, 9);
    clients.set(clientId, { ws, role: null });
    ws.clientId = clientId;

    ws.on('message', message => {
        console.log('Получено сообщение:', message);

        try {
            const parsedMessage = JSON.parse(message);

            if (parsedMessage.role) {
                clients.get(clientId).role = parsedMessage.role;
                console.log(`Клиент ${clientId} зарегистрирован как ${parsedMessage.role}`);
                return;
            }

            // Отправка вопроса (с текстом или изображением) от helper всем exam
            if ((parsedMessage.question || parsedMessage.questionImg) && clients.get(clientId).role === 'helper') {
                parsedMessage.clientId = clientId; // Сохраняем ID отправителя
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
        console.log('Клиент отключился');
        clients.delete(clientId);
    });
});

console.log('WebSocket сервер запущен на порту 8080');
