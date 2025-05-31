const WebSocket = require('ws');
const express = require('express');
const path = require('path');
const cors = require('cors');
const bcrypt = require('bcrypt');
const { createClient } = require('@supabase/supabase-js');

const app = express();

// Инициализация Supabase
const supabaseClient = createClient('https://ledxbbsylvxnfjogwkzf.supabase.co', 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxlZHhiYnN5bHZ4bmZqb2d3a3pmIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc0MTE0NTUxOCwiZXhwIjoyMDU2NzIxNTE4fQ.A9wvdnZmX_3wu9Pvhpy0lR3ds8jTNA6tKe59YaB_RGE');
// console.log('index.js: Supabase client initialized'); // Уменьшение логов

// Настраиваем CORS
app.use(cors({
    origin: '*', // TODO: Заменить на конкретные домены для безопасности
}));

// Раздача статических файлов
app.use(express.static(path.join(__dirname, '../client')));

const server = app.listen(process.env.PORT || 8080, () => {
    // console.log('Server started on port', server.address().port); // Уменьшение логов
});
const wss = new WebSocket.Server({ server });

// Хранилище активных клиентов и их данных
const clients = new Map();
const activeExams = new Map(); // Карта для отслеживания активных экзаменов (клиентId -> данные экзамена)

// Функция для логирования вопросов и ответов в Supabase
async function logToSupabase(questionData, assistantAnswer = null, examData = null) {
    try {
        // Проверяем, существует ли уже вопрос с таким же текстом и изображением
        const { data: existingData, error: selectError } = await supabaseClient
            .from('exam_questions')
            .select('id, assistant_answer')
            .eq('question_text', questionData.question)
            .eq('question_img', questionData.questionImg || null)
            .single();

        if (selectError && selectError.code !== 'PGRST116') { // PGRST116 - не найдено строк
            console.error('index.js: Error checking existing question in Supabase:', selectError);
            return;
        }

        let updateRequired = false;
        let currentAssistantAnswer = [];

        if (existingData) {
            // console.log('index.js: Found matching question in Supabase:', existingData); // Уменьшение логов
            currentAssistantAnswer = existingData.assistant_answer || [];

            if (assistantAnswer) {
                const existingAnswerIndex = currentAssistantAnswer.findIndex(
                    ans => ans.answeredBy === assistantAnswer.answeredBy
                );

                if (existingAnswerIndex > -1) {
                    // Обновляем существующий ответ
                    currentAssistantAnswer[existingAnswerIndex] = {
                        answer: assistantAnswer.answer,
                        varIndex: assistantAnswer.varIndex,
                        answeredBy: assistantAnswer.answeredBy
                    };
                } else {
                    // Добавляем новый ответ, если его нет
                    currentAssistantAnswer.push({
                        answer: assistantAnswer.answer,
                        varIndex: assistantAnswer.varIndex,
                        answeredBy: assistantAnswer.answeredBy
                    });
                }
                updateRequired = true;
            }
        } else if (assistantAnswer) {
            // Если вопрос не существует, но есть assistantAnswer, инициализируем
            currentAssistantAnswer.push({
                answer: assistantAnswer.answer,
                varIndex: assistantAnswer.varIndex,
                answeredBy: assistantAnswer.answeredBy
            });
            updateRequired = true;
        }

        const upsertData = {
            question_text: questionData.question,
            question_img: questionData.questionImg || null,
            answers: questionData.answers,
            exam_info: examData ? examData.userInfo : null,
            timer: examData ? examData.timer : null,
            updated_at: new Date().toISOString(),
            assistant_answer: currentAssistantAnswer // Всегда включаем обновленный массив
        };

        const { data, error } = await supabaseClient
            .from('exam_questions')
            .upsert(upsertData, {
                onConflict: 'question_text,question_img'
            })
            .select();

        if (error) {
            console.error('index.js: Error logging to Supabase:', error);
        } else {
            // console.log('index.js: Logged to Supabase:', data); // Уменьшение логов
        }
    } catch (error) {
        console.error('index.js: Unexpected error in logToSupabase:', error);
    }
}

// Проверка наличия ответов в Supabase
async function checkSupabaseForAnswers(questionText, questionImg) {
    try {
        const { data, error } = await supabaseClient
            .from('exam_questions')
            .select('assistant_answer')
            .eq('question_text', questionText)
            .eq('question_img', questionImg || null)
            .single();

        if (error && error.code !== 'PGRST116') { // PGRST116 - не найдено строк
            console.error('index.js: Error checking Supabase for answers:', error);
            return null;
        }
        // console.log('index.js: Found matching question in Supabase:', data); // Уменьшение логов
        return data ? data.assistant_answer : null;
    } catch (error) {
        console.error('index.js: Unexpected error in checkSupabaseForAnswers:', error);
        return null;
    }
}


wss.on('connection', (ws) => {
    const clientId = Date.now().toString(); // Уникальный ID для каждого клиента
    clients.set(clientId, { ws, lastActive: Date.now(), role: null, clientId: clientId });

    // console.log('index.js: Client connected'); // Уменьшение логов

    ws.clientId = clientId; // Сохраняем clientId на объекте ws

    ws.on('message', async (message) => {
        clients.get(clientId).lastActive = Date.now(); // Обновляем время последней активности
        // console.log('index.js: Received message:', message.toString()); // Уменьшение логов
        try {
            const parsedMessage = JSON.parse(message.toString());

            if (parsedMessage.type === 'register' && parsedMessage.role) {
                clients.get(clientId).role = parsedMessage.role;
                // console.log(`index.js: Client ${clientId} registered as ${parsedMessage.role}`); // Уменьшение логов

                if (parsedMessage.role === 'exam') {
                    activeExams.set(clientId, { userInfo: parsedMessage.userInfo, timer: '00:00:00' });
                    // Отправляем текущее состояние всех активных экзаменов новому экзаменатору
                    const examsData = Array.from(activeExams.entries()).map(([id, data]) => ({
                        clientId: id,
                        userInfo: data.userInfo,
                        timer: data.timer,
                        questions: clients.get(id)?.questions || [], // Добавляем вопросы, если есть
                    }));
                    ws.send(JSON.stringify({ type: 'initialState', exams: examsData }));
                    // console.log('index.js: Sending initialState to exam client:', examsData); // Уменьшение логов
                } else if (parsedMessage.role === 'helper') {
                    // При подключении helper, проверяем Supabase на наличие несохраненных ответов
                    // Это будет обрабатываться helper.js через sendQuestions
                }

            } else if (parsedMessage.type === 'question' && clients.get(clientId)?.role === 'helper') {
                // console.log('index.js: Processing question from helper:', parsedMessage); // Уменьшение логов

                // Проверяем, существует ли уже этот вопрос в Supabase
                const existingAnswers = await checkSupabaseForAnswers(parsedMessage.question, parsedMessage.questionImg);

                if (existingAnswers && existingAnswers.length > 0) {
                    // console.log(`index.js: Question with text "${parsedMessage.question}" already exists, sending saved answers`); // Уменьшение логов
                    // Если вопрос существует и есть сохраненные ответы, отправляем их помощнику
                    ws.send(JSON.stringify({
                        type: 'savedAnswer',
                        qIndex: parsedMessage.qIndex,
                        varIndex: existingAnswers[0]?.varIndex, // Отправляем первый найденный ответ
                        answer: existingAnswers[0]?.answer,
                        answeredBy: existingAnswers[0]?.answeredBy
                    }));
                } else {
                    // Если вопроса нет в базе или нет сохраненных ответов, логируем его и пересылаем экзаменаторам
                    await logToSupabase(parsedMessage, null, activeExams.get(parsedMessage.clientId));

                    // Отправляем вопрос всем клиентам с ролью 'exam'
                    wss.clients.forEach(client => {
                        if (client.readyState === WebSocket.OPEN && clients.get(client.clientId).role === 'exam') {
                            client.send(JSON.stringify({ type: 'newQuestion', ...parsedMessage }));
                            // console.log('index.js: Forwarding question to exam client:', client.clientId); // Уменьшение логов
                        }
                    });
                }
            } else if (parsedMessage.type === 'answer' && clients.get(clientId)?.role === 'exam') {
                // console.log('index.js: Processing answer from exam:', parsedMessage); // Уменьшение логов

                // Логируем ответ экзаменатора в Supabase
                await logToSupabase(
                    { question: parsedMessage.question, questionImg: parsedMessage.questionImg, answers: parsedMessage.answers },
                    {
                        answer: parsedMessage.answer,
                        varIndex: parsedMessage.varIndex,
                        answeredBy: parsedMessage.answeredBy
                    },
                    activeExams.get(clientId)
                );

                // Отправляем ответ обратно помощнику (helper)
                wss.clients.forEach(client => {
                    if (client.readyState === WebSocket.OPEN && clients.get(client.clientId).role === 'helper') {
                        client.send(JSON.stringify({
                            type: 'processedAnswer',
                            clientId: parsedMessage.clientId, // Исходный clientId из helper.js
                            qIndex: parsedMessage.qIndex,
                            answer: parsedMessage.answer,
                            varIndex: parsedMessage.varIndex,
                            answeredBy: parsedMessage.answeredBy
                        }));
                        // console.log('index.js: Sending answer to helper:', parsedMessage.clientId); // Уменьшение логов
                    }
                });

                // Транслируем обновленный ответ всем клиентам с ролью 'exam'
                wss.clients.forEach(client => {
                    if (client.readyState === WebSocket.OPEN && clients.get(client.clientId).role === 'exam') {
                        client.send(JSON.stringify({
                            type: 'processedAnswer',
                            clientId: parsedMessage.clientId, // Исходный clientId из helper.js
                            qIndex: parsedMessage.qIndex,
                            answer: parsedMessage.answer,
                            varIndex: parsedMessage.varIndex,
                            answeredBy: parsedMessage.answeredBy
                        }));
                        // console.log('index.js: Broadcasting processedAnswer to exam client:', client.clientId, { type: 'processedAnswer', ...parsedMessage }); // Уменьшение логов
                    }
                });

            } else if (parsedMessage.type === 'processedAnswer' && clients.get(clientId)?.role === 'helper') {
                // Это сообщение получено от helper, когда он получает ответ от сервера.
                // console.log('index.js: Broadcasting processedAnswer from helper:', parsedMessage); // Уменьшение логов

                // Пересылаем этот ответ всем клиентам с ролью 'exam'
                wss.clients.forEach(client => {
                    if (client.readyState === WebSocket.OPEN && clients.get(client.clientId).role === 'exam') {
                        client.send(JSON.stringify({
                            type: 'processedAnswer',
                            clientId: parsedMessage.clientId, // Исходный clientId из helper.js
                            qIndex: parsedMessage.qIndex,
                            answer: parsedMessage.answer,
                            varIndex: parsedMessage.varIndex,
                            answeredBy: parsedMessage.answeredBy
                        }));
                        // console.log('index.js: Broadcasting processedAnswer to exam client from helper:', client.clientId, { type: 'processedAnswer', ...parsedMessage }); // Уменьшение логов
                    }
                });
            } else if (parsedMessage.type === 'timerUpdate' && clients.get(clientId)?.role === 'helper') {
                // console.log('index.js: Processing timerUpdate:', parsedMessage); // Уменьшение логов
                if (activeExams.has(parsedMessage.clientId)) {
                    activeExams.get(parsedMessage.clientId).timer = parsedMessage.timer;
                }
                // Отправляем обновление таймера всем клиентам с ролью 'exam'
                wss.clients.forEach(client => {
                    if (client.readyState === WebSocket.OPEN && clients.get(client.clientId).role === 'exam') {
                        client.send(JSON.stringify({
                            type: 'timerUpdate',
                            clientId: parsedMessage.clientId,
                            timer: parsedMessage.timer
                        }));
                        // console.log('index.js: Sending timerUpdate to exam client:', client.clientId); // Уменьшение логов
                    }
                });
            }
        } catch (error) {
            console.error('index.js: Error parsing message or processing:', error);
        }
    });

    ws.on('close', () => {
        // console.log('index.js: Client disconnected:', clientId); // Уменьшение логов
        if (clients.has(clientId)) {
            // Если отключается клиент с ролью 'helper', удаляем его из activeExams
            if (clients.get(clientId).role === 'helper') {
                activeExams.delete(clientId);
                wss.clients.forEach(client => {
                    if (client.readyState === WebSocket.OPEN && clients.get(client.clientId).role === 'exam') {
                        // console.log('index.js: Notifying exam clients of disconnection:', client.clientId); // Уменьшение логов
                        client.send(JSON.stringify({ type: 'clientDisconnected', clientId }));
                    }
                });
            }

            clients.delete(clientId);
        }
    });

    // Проверка неактивных клиентов каждые 60 секунд
    setInterval(() => {
        clients.forEach((client, id) => {
            const inactiveTime = (Date.now() - client.lastActive) / 1000;
            // Проверяем, если клиент неактивен более 60 секунд ИЛИ соединение закрыто
            if (inactiveTime > 60 || client.ws.readyState !== WebSocket.OPEN) {
                // console.log(`index.js: Client ${id} inactive for >60s or connection closed, removing`); // Уменьшение логов
                if (client.role === 'helper') {
                    activeExams.delete(id);
                    wss.clients.forEach(otherClient => {
                        if (otherClient.readyState === WebSocket.OPEN && clients.get(otherClient.clientId).role === 'exam') {
                            // console.log('index.js: Notifying exam clients of inactive client:', id); // Уменьшение логов
                            otherClient.send(JSON.stringify({ type: 'clientDisconnected', clientId: id }));
                        }
                    });
                }
                clients.delete(id);
            }
        });
    }, 60000);
});

// console.log('index.js: WebSocket server started'); // Уменьшение логов
