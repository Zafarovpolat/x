const express = require('express');
const WebSocket = require('websocket');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server});

app.use(express.static('publicapp.use(express.json());

const activeExams = new Map();
const timers = {};

function broadcastExamData(clientId, examData) {
    wss.clients.forEach((client) => {
        if (client.readyState === WebSocket.OPEN && client.role === 'exam') {
            client.send(JSON.stringify({ clientId, ...examData }));
        }
    });
}

function broadcastProcessedAnswer(clientId, qIndex, answer, answeredBy) {
    wss.clients.forEach((client) => {
        if (client.readyState === WebSocket.OPEN && client.role === 'exam') {
            client.send(
                JSON.stringify({
                    type: 'processedAnswer',
                    clientId,
                    qIndex,
                    answer,
                    answeredBy,
                })
            );
        }
    });
}

function broadcastInitialState(ws) {
    const exams = Array.from(activeExams.entries()).map(([clientId, exam]) => ({
        clientId,
        userInfo: exam.userInfo,
        timer: exam.timer,
        questions: exam.questions,
    }));
    ws.send(JSON.stringify({ type: 'initialState', exams }));
}

function updateTimer(clientId) {
    if (!timers[clientId]) return;

    let [hours, minutes, seconds] = timers[clientId].split(':').map(Number);
    seconds++;
    if (seconds >= 60) {
        seconds = 0;
        minutes++;
        if (minutes >= 60) {
            minutes = 0;
            hours++;
        }
    }
    timers[clientId] = `${hours.toString().padStart(2, '0')}:${minutes
        .toString()
        .padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;

    wss.clients.forEach((client) => {
        if (client.readyState === WebSocket.OPEN && client.role === 'exam') {
            client.send(
                JSON.stringify({
                    type: 'timerUpdate',
                    clientId,
                    timer: timers[clientId],
                })
            );
        }
    });
}

wss.on('connection', (ws) => {
    console.log('New WebSocket connection');

    ws.on('message', (message) => {
        let data;
        try {
            data = JSON.parse(message);
        } catch (e) {
            console.error('Invalid JSON:', message);
            return;
        }

        if (data.role) {
            ws.role = data.role;
            if (data.role === 'exam') {
                broadcastInitialState(ws);
            }
            return;
        }

        if (data.clientId && data.userInfo && (data.question || data.questionImg) && data.answers) {
            if (!activeExams.has(data.clientId)) {
                activeExams.set(data.clientId, {
                    userInfo: data.userInfo,
                    questions: [],
                    timer: data.timer || '00:00:00',
                });
                timers[data.clientId] = data.timer || '00:00:00';
                if (!timers[data.clientId].startsWith('00')) {
                    setInterval(() => updateTimer(data.clientId), 1000);
                }
            }

            const uniqueId = `${data.clientId}-${data.qIndex}`;
            const exam = activeExams.get(data.clientId);
            if (!exam.questions.some((q) => q.uniqueId === uniqueId)) {
                exam.questions.push({
                    uniqueId,
                    qIndex: data.qIndex,
                    question: data.question,
                    questionImg: data.questionImg,
                    answers: data.answers,
                    answersList: [],
                });
            }

            broadcastExamData(data.clientId, {
                userInfo: data.userInfo,
                question: data.question,
                questionImg: data.questionImg,
                qIndex: data.qIndex,
                answers: data.answers,
                timer: exam.timer,
            });
        }

        if (data.qIndex !== undefined && data.answer && data.clientId && data.answeredBy) {
            if (activeExams.has(data.clientId)) {
                const exam = activeExams.get(data.clientId);
                const question = exam.questions.find((q) => q.qIndex === data.qIndex);
                if (question) {
                    if (!question.answersList) question.answersList = [];
                    const existingAnswer = question.answersList.find((a) => a.answeredBy === data.answeredBy);
                    if (existingAnswer) {
                        existingAnswer.answer = data.answer;
                    } else {
                        question.answersList.push({
                            answer: data.answer,
                            answeredBy: data.answeredBy,
                        });
                    }
                    broadcastProcessedAnswer(data.clientId, data.qIndex, data.answer, data.answeredBy);
                }
            }
        }
    });

    ws.on('close', () => {
        console.log('WebSocket connection closed');
        if (ws.clientId && activeExams.has(ws.clientId)) {
            activeExams.delete(ws.clientId);
            delete timers[ws.clientId];
            wss.clients.forEach((client) => {
                if (client.readyState === WebSocket.OPEN && client.role === 'exam') {
                    client.send(
                        JSON.stringify({
                            type: 'clientDisconnected',
                            clientId: ws.clientId,
                        })
                    );
                }
            });
        }
    });
});

server.listen(3000, () => {
    console.log('Server is running on port 3000');
});
