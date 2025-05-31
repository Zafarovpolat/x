const WebSocket = require('ws');
const express = require('express');
const path = require('path');
const cors = require('cors');
const bcrypt = require('bcrypt');
const { createClient } = require('@supabase/supabase-js');

const app = express();

// Инициализация Supabase
const supabaseClient = createClient('https://ledxbbsylvxnfjogwkzf.supabase.co', 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxlZHhiYnN5bHZ4bmZqb2d3a3pmIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc0MTE0NTUxOCwiZXhwIjoyMDU2NzIxNTE4fQ.A9wvdnZmX_3wu9Pvhpy0lR3ds8jTNA6tKe59YaB_RGE');
console.log('index.js: Supabase client initialized');

// Настраиваем CORS
app.use(cors({
    origin: '*', // TODO: Заменить на конкретные домены для безопасности
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

// Предопределенные учетные данные
const adminUsername = 'admin';
const adminPasswordHash = '$2b$10$rmDgt6JvnOC7VuNrdur1LeuJIVGd9U3Vl46cCGwChA.tkdfOcYBoC';

async function logToSupabase(clientId, questionData, assistantAnswer = null) {
    try {
        const examData = activeExams.get(clientId);

        // Проверяем, существует ли вопрос
        const { data: existingData, error: fetchError } = await supabaseClient
            .from('exam_questions')
            .select('id')
            .or(`question_text.eq.${questionData.question},question_img.eq.${questionData.questionImg}`)
            .maybeSingle();

        if (fetchError && !fetchError.message.includes('No rows found')) {
            console.error('index.js: Supabase fetch error:', fetchError);
            return;
        }

        // Если вопрос уже существует, обновляем только assistant_answer
        if (existingData && assistantAnswer) {
            let currentAnswers = existingData.assistant_answer || [];
            currentAnswers = currentAnswers.filter(ans => ans.answeredBy !== assistantAnswer.answeredBy);
            currentAnswers.push({
                answer: assistantAnswer.answer,
                varIndex: assistantAnswer.varIndex,
                answeredBy: assistantAnswer.answeredBy
            });

            const { data, error } = await supabaseClient
                .from('exam_questions')
                .update({ assistant_answer: currentAnswers })
                .eq('id', existingData.id)
                .select();

            if (error) {
                console.error('index.js: Supabase update error:', error);
            } else {
                console.log('index.js: Updated assistant_answer in Supabase:', data);
            }
            return;
        }

        // Если вопроса нет, выполняем upsert
        const upsertData = {
            question_text: questionData.question,
            question_img: questionData.questionImg || null,
            answers: questionData.answers,
            exam_info: examData ? examData.userInfo : null,
            timer: examData ? examData.timer : null,
            updated_at: new Date().toISOString()
        };

        if (assistantAnswer) {
            upsertData.assistant_answer = [{
                answer: assistantAnswer.answer,
                varIndex: assistantAnswer.varIndex,
                answeredBy: assistantAnswer.answeredBy
            }];
        }

        const { data, error } = await supabaseClient
            .from('exam_questions')
            .upsert(upsertData, {
                onConflict: 'question_text,question_img'
            })
            .select();

        if (error) {
            console.error('index.js: Supabase upsert error:', error);
        } else {
            console.log('index.js: Logged to Supabase:', data);
        }
    } catch (e) {
        console.error('index.js: Supabase logging failed:', e);
    }
}

async function checkSupabaseForAnswers(clientId, questionText, questionImg, qIndex) {
    try {
        const { data, error } = await supabaseClient
            .from('exam_questions')
            .select('assistant_answer, answers')
            .eq('question_text', questionText)
            .not('assistant_answer', 'is', null);

        if (error) {
            console.error('index.js: Supabase query error:', error);
            return null;
        }

        console.log('index.js: Found matching question in Supabase:', data);
        if (data.length > 0 && data[0].assistant_answer && data[0].assistant_answer.length > 0) {
            const targetClient = clients.get(clientId);
            if (targetClient && targetClient.ws.readyState === WebSocket.OPEN) {
                data[0].assistant_answer.forEach(answer => {
                    const varIndex = data[0].answers.findIndex(ans => ans.text === answer.answer);
                    if (varIndex !== -1) {
                        console.log('index.js: Sending saved answer to helper:', clientId, { qIndex, varIndex });
                        targetClient.ws.send(JSON.stringify({
                            type: 'savedAnswer',
                            qIndex: qIndex,
                            varIndex,
                            question: questionText,
                            answer: answer.answer,
                            answeredBy: answer.answeredBy
                        }));
                    }
                });
            }
            return data[0];
        }
        return null;
    } catch (e) {
        console.error('index.js: Supabase query failed:', e);
        return null;
    }
}

wss.on('connection', ws => {
    console.log('index.js: Client connected');

    const clientId = Math.random().toString(36).substr(2, 9);
    clients.set(clientId, { ws, role: null, lastActive: Date.now() });
    ws.clientId = clientId;

    // Отправка пинга каждые 30 секунд для проверки активности
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
        console.log('index.js: Received message:', message.toString());

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
                console.log(`index.js: Client ${clientId} registered as ${parsedMessage.role}`);

                if (parsedMessage.role === 'exam') {
                    const examsData = Array.from(activeExams.entries()).map(([examClientId, examData]) => ({
                        clientId: examClientId,
                        userInfo: examData.userInfo,
                        questions: examData.questions.map(q => ({
                            qIndex: q.qIndex,
                            question: q.question,
                            questionImg: q.questionImg,
                            answers: q.answers,
                            answersList: q.answersList || [],
                        })),
                        timer: examData.timer
                    }));
                    console.log('index.js: Sending initialState to exam client:', examsData);
                    ws.send(JSON.stringify({ type: 'initialState', exams: examsData }));
                }
                return;
            }

            // Обработка вопроса от helper
            if ((parsedMessage.question || parsedMessage.questionImg) && clients.get(clientId).role === 'helper') {
                parsedMessage.clientId = clientId;
                console.log('index.js: Processing question from helper:', parsedMessage);

                if (!activeExams.has(clientId)) {
                    activeExams.set(clientId, { userInfo: parsedMessage.userInfo, questions: [], timer: parsedMessage.timer });
                }
                const examData = activeExams.get(clientId);
                const questionData = {
                    qIndex: parsedMessage.qIndex,
                    question: parsedMessage.question,
                    questionImg: parsedMessage.questionImg,
                    answers: parsedMessage.answers,
                    answersList: [],
                };
                const existingQuestion = examData.questions.find(q => q.question === parsedMessage.question);
                if (!existingQuestion) {
                    examData.questions.push(questionData);
                    await logToSupabase(clientId, questionData);
                } else {
                    console.log(`index.js: Question with text "${parsedMessage.question}" already exists, skipping Supabase logging`);
                }
                examData.timer = parsedMessage.timer;

                await checkSupabaseForAnswers(clientId, parsedMessage.question, parsedMessage.questionImg, parsedMessage.qIndex);

                wss.clients.forEach(client => {
                    if (client.readyState === WebSocket.OPEN && clients.get(client.clientId).role === 'exam') {
                        console.log('index.js: Forwarding question to exam client:', client.clientId);
                        client.send(JSON.stringify(parsedMessage));
                    }
                });
            }

            // Ответ от exam отправляем конкретному helper
            if (parsedMessage.answer && clients.get(clientId).role === 'exam') {
                console.log('index.js: Processing answer from exam:', parsedMessage);
                const targetClient = clients.get(parsedMessage.clientId);
                if (targetClient && targetClient.ws.readyState === WebSocket.OPEN) {
                    console.log('index.js: Sending answer to helper:', parsedMessage.clientId);
                    targetClient.ws.send(JSON.stringify(parsedMessage));
                }
                if (activeExams.has(parsedMessage.clientId)) {
                    const examData = activeExams.get(parsedMessage.clientId);
                    const question = examData.questions.find(q => q.qIndex === parsedMessage.qIndex);
                    if (question) {
                        if (!question.answersList) question.answersList = [];
                        const existingAnswer = question.answersList.find(a => a.answeredBy === parsedMessage.answeredBy);
                        if (existingAnswer) {
                            existingAnswer.answer = parsedMessage.answer;
                        } else {
                            question.answersList.push({
                                answer: parsedMessage.answer,
                                answeredBy: parsedMessage.answeredBy
                            });
                        }
                    }
                    await logToSupabase(parsedMessage.clientId, {
                        qIndex: parsedMessage.qIndex,
                        question: parsedMessage.question,
                        questionImg: null,
                        answers: question ? question.answers : [],
                    }, {
                        answer: parsedMessage.answer,
                        varIndex: parsedMessage.varIndex,
                        answeredBy: parsedMessage.answeredBy
                    });
                }
                wss.clients.forEach(client => {
                    if (client.readyState === WebSocket.OPEN && clients.get(client.clientId).role === 'exam') {
                        console.log('index.js: Broadcasting processedAnswer to exam client:', client.clientId, {
                            type: 'processedAnswer',
                            qIndex: parsedMessage.qIndex,
                            question: parsedMessage.question,
                            answer: parsedMessage.answer,
                            varIndex: parsedMessage.varIndex,
                            clientId: parsedMessage.clientId,
                            answeredBy: parsedMessage.answeredBy
                        });
                        client.send(JSON.stringify({
                            type: 'processedAnswer',
                            qIndex: parsedMessage.qIndex,
                            question: parsedMessage.question,
                            answer: parsedMessage.answer,
                            varIndex: parsedMessage.varIndex,
                            clientId: parsedMessage.clientId,
                            answeredBy: parsedMessage.answeredBy
                        }));
                    }
                });
            }

            // Обработанный ответ от helper отправляем всем exam
            if (parsedMessage.processedAnswer && clients.get(clientId).role === 'helper') {
                console.log('index.js: Broadcasting processedAnswer from helper:', parsedMessage);
                if (activeExams.has(parsedMessage.clientId)) {
                    const examData = activeExams.get(parsedMessage.clientId);
                    const question = examData.questions.find(q => q.qIndex === parsedMessage.qIndex);
                    if (question) {
                        if (!question.answersList) question.answersList = [];
                        const existingAnswer = question.answersList.find(a => a.answeredBy === parsedMessage.answeredBy);
                        if (existingAnswer) {
                            existingAnswer.answer = parsedMessage.answer;
                        } else {
                            question.answersList.push({
                                answer: parsedMessage.answer,
                                answeredBy: parsedMessage.answeredBy
                            });
                        }
                    }
                    await logToSupabase(parsedMessage.clientId, {
                        qIndex: parsedMessage.qIndex,
                        question: parsedMessage.question,
                        questionImg: null,
                        answers: question ? question.answers : [],
                    }, {
                        answer: parsedMessage.answer,
                        varIndex: parsedMessage.varIndex,
                        answeredBy: parsedMessage.answeredBy
                    });
                }
                wss.clients.forEach(client => {
                    if (client.readyState === WebSocket.OPEN && clients.get(client.clientId).role === 'exam') {
                        client.send(JSON.stringify({
                            type: 'processedAnswer',
                            qIndex: parsedMessage.qIndex,
                            question: parsedMessage.question,
                            answer: parsedMessage.answer,
                            varIndex: parsedMessage.varIndex,
                            clientId: parsedMessage.clientId,
                            answeredBy: parsedMessage.answeredBy
                        }));
                    }
                });
            }

            // Обработка обновления таймера от helper
            if (parsedMessage.type === 'timerUpdate' && clients.get(clientId).role === 'helper') {
                console.log('index.js: Processing timerUpdate:', parsedMessage);
                if (activeExams.has(clientId)) {
                    activeExams.get(clientId).timer = parsedMessage.timer;
                    wss.clients.forEach(client => {
                        if (client.readyState === WebSocket.OPEN && clients.get(client.clientId).role === 'exam') {
                            console.log('index.js: Sending timerUpdate to exam client:', client.clientId);
                            client.send(JSON.stringify({
                                type: 'timerUpdate',
                                clientId: clientId,
                                timer: parsedMessage.timer
                            }));
                        }
                    });
                }
            }
        } catch (e) {
            console.error('index.js: JSON parse error:', e);
        }
    });

    ws.on('close', () => {
        console.log('index.js: Client disconnected:', clientId);
        clearInterval(pingInterval);
        const client = clients.get(clientId);

        if (client && client.role === 'helper') {
            activeExams.delete(clientId);
            wss.clients.forEach(client => {
                if (client.readyState === WebSocket.OPEN && clients.get(client.clientId).role === 'exam') {
                    console.log('index.js: Notifying exam clients of disconnection:', client.clientId);
                    client.send(JSON.stringify({ type: 'clientDisconnected', clientId }));
                }
            });
        }

        clients.delete(clientId);
    });

    // Проверка неактивных клиентов каждые 60 секунд
    setInterval(() => {
        clients.forEach((client, id) => {
            const inactiveTime = (Date.now() - client.lastActive) / 1000;
            if (inactiveTime > 60 && client.ws.readyState !== WebSocket.OPEN) {
                console.log(`index.js: Client ${id} inactive for >60s, removing`);
                if (client.role === 'helper') {
                    activeExams.delete(id);
                    wss.clients.forEach(otherClient => {
                        if (otherClient.readyState === WebSocket.OPEN && clients.get(otherClient.clientId).role === 'exam') {
                            console.log('index.js: Notifying exam clients of inactive client:', id);
                            otherClient.send(JSON.stringify({ type: 'clientDisconnected', clientId: id }));
                        }
                    });
                }
                clients.delete(id);
            }
        });
    }, 60000);
});

console.log('index.js: WebSocket server started');