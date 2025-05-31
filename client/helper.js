(async () => {
    let socket = new WebSocket('wss://x-q63z.onrender.com');
    const sentQuestions = new Map();
    let lastSentTimerText = ''; // Для оптимизации отправки таймера

    function hideBannedScreen() {
        document.querySelectorAll('.js-banned-screen').forEach(bannedScreen => {
            bannedScreen.style.setProperty('display', 'none', 'important');
            // console.log('helper.js: Hid banned screen element:', bannedScreen); // Уменьшение логов
        });
    }

    const observer = new MutationObserver(() => {
        // console.log('helper.js: Mutation observed, checking for banned screens'); // Уменьшение логов
        hideBannedScreen();
    });

    observer.observe(document.body, { childList: true, subtree: true });
    // console.log('helper.js: MutationObserver set up on document.body'); // Уменьшение логов

    hideBannedScreen();

    // Переопределение Audio.play для предотвращения воспроизведения звука
    window.Audio = function () {
        // console.log('helper.js: Overriding Audio.play to no-op'); // Уменьшение логов
        return {
            play: function () { }
        };
    };

    function highlightAnswer(qIndex, varIndex) {
        document.querySelectorAll('.test-table').forEach((questionEl, index) => {
            if (index === qIndex) {
                const labels = questionEl.querySelectorAll('.test-answers label');
                labels.forEach((label, i) => {
                    const p = label.querySelector('p');
                    const img = label.querySelector('img');

                    // Сброс стилей для всех лейблов
                    // console.log('helper.js: Reset styles for label p:', p); // Уменьшение логов
                    if (p) {
                        p.style.fontWeight = 'normal';
                        p.style.color = 'initial';
                    }
                    label.style.border = 'none';

                    if (i === varIndex) {
                        // Применение стилей только к правильному ответу
                        // console.log('helper.js: Mouseover on correct answer label:', varIndex); // Уменьшение логов
                        if (p) {
                            p.style.fontWeight = 'bold';
                            p.style.color = 'blue';
                        }
                        label.style.border = '2px solid blue';
                    }
                });
            }
        });

        // Добавление стиля для навигационного элемента (answered)
        const navItem = document.querySelector(`.q_navigation span[data-qindex="${qIndex}"]`);
        if (navItem) {
            // console.log('helper.js: Removed existing answered style'); // Уменьшение логов
            // Удалить все предыдущие стили "answered"
            document.querySelectorAll('.q_navigation span').forEach(item => {
                item.classList.remove('answered');
            });
            navItem.classList.add('answered');
            // console.log('helper.js: Added answered style for nav item:', qIndex); // Уменьшение логов
        }
    }


    function getExamId() {
        const urlParams = new URLSearchParams(window.location.search);
        return urlParams.get('examId');
    }

    function sendQuestions() {
        const examId = getExamId();
        if (!examId) return;

        const questions = document.querySelectorAll('.test-table');
        const breadcrumbElement = document.querySelector('.breadcrumb_last');
        const breadcrumbText = breadcrumbElement ? breadcrumbElement.innerText.trim() : 'Unknown Exam';
        const timerElement = document.querySelector('#timer, .timer, [id*="timer"], [class*="timer"]');
        const timerText = timerElement ? timerElement.innerText.trim() : '00:00:00';

        // console.log('helper.js: Found questions:', questions.length, 'breadcrumb:', breadcrumbText, 'timer:', timerText); // Уменьшение логов

        questions.forEach((questionEl, qIndex) => {
            const questionTextEl = questionEl.querySelector('.question_text');
            const questionText = questionTextEl ? questionTextEl.innerText.trim() : '';
            const questionImgEl = questionEl.querySelector('.question_image img');
            const questionImg = questionImgEl ? questionImgEl.src : null;

            const answers = [];
            questionEl.querySelectorAll('.test-answers label').forEach((label, varIndex) => {
                const answerTextEl = label.querySelector('p');
                const answerImgEl = label.querySelector('img');
                answers.push({
                    text: answerTextEl ? answerTextEl.innerText.trim() : null,
                    img: answerImgEl ? answerImgEl.src : null,
                    varIndex: varIndex // Добавляем varIndex для каждого ответа
                });
            });

            const questionKey = `${questionText}-${questionImg}`; // Уникальный ключ для вопроса

            if (!sentQuestions.has(questionKey)) {
                const questionData = {
                    type: 'question',
                    clientId: examId, // Передаем ID экзамена
                    qIndex: qIndex,
                    question: questionText,
                    questionImg: questionImg,
                    answers: answers,
                    userInfo: {
                        breadcrumb: breadcrumbText,
                        userAgent: navigator.userAgent
                    },
                    timer: timerText
                };
                // console.log('helper.js: Sending question data:', questionData); // Уменьшение логов
                if (socket.readyState === WebSocket.OPEN) {
                    socket.send(JSON.stringify(questionData));
                    sentQuestions.set(questionKey, true); // Помечаем вопрос как отправленный
                }
            } else {
                // console.log('helper.js: Skipping already sent question:', questionKey); // Уменьшение логов
            }
        });
    }

    let timerUpdateInterval; // Для хранения идентификатора интервала таймера

    // Оптимизированная функция отправки обновления таймера
    function sendTimerUpdate() {
        const examId = getExamId();
        if (!examId) return;

        const timerElement = document.querySelector('#timer, .timer, [id*="timer"], [class*="timer"]');
        const timerText = timerElement?.innerText.trim() || '00:00:00';

        // Отправляем обновление только если таймер изменился
        if (timerText !== lastSentTimerText) {
            const data = JSON.stringify({
                type: 'timerUpdate',
                clientId: examId,
                timer: timerText
            });
            // console.log('helper.js: Sending timer update:', data, 'selector:', timerElement?.tagName, timerElement?.id, timerElement?.className); // Уменьшение логов
            if (socket.readyState === WebSocket.OPEN) {
                socket.send(data);
                lastSentTimerText = timerText; // Обновляем последнее отправленное значение
            } else {
                // console.log('helper.js: WebSocket not open:', socket.readyState); // Уменьшение логов
            }
        }
    }

    socket.onopen = () => {
        // console.log('helper.js: WebSocket connected'); // Уменьшение логов
        const examId = getExamId();
        socket.send(JSON.stringify({ role: 'helper', clientId: examId }));

        // Отправка вопросов после небольшой задержки, чтобы удостовериться в регистрации роли
        setTimeout(() => {
            // console.log('helper.js: Sending initial questions after 2s delay'); // Уменьшение логов
            sendQuestions();
            // Настройка интервала для отправки обновлений таймера
            // console.log('helper.js: Setting interval for sendTimerUpdate'); // Уменьшение логов
            if (timerUpdateInterval) clearInterval(timerUpdateInterval); // Очистка старого интервала, если есть
            timerUpdateInterval = setInterval(sendTimerUpdate, 5000); // Отправлять каждые 5 секунд
        }, 2000);
    };

    socket.onmessage = event => {
        try {
            const response = JSON.parse(event.data);
            if (response.type === 'processedAnswer') {
                // console.log('helper.js: Received response from exam:', response); // Уменьшение логов
                // Пересылаем обработанный ответ в главный скрипт страницы
                window.postMessage({ type: 'processedAnswer', ...response }, '*');
                // console.log('helper.js: Sending processed response to exam:', response); // Уменьшение логов

                // Наведите и выделите ответ на странице Helper
                highlightAnswer(response.qIndex, response.varIndex);
            } else if (response.type === 'savedAnswer') {
                // console.log('helper.js: Received saved answer from server:', response); // Уменьшение логов
                highlightAnswer(response.qIndex, response.varIndex);
            }
        } catch (e) {
            console.error('helper.js: Error parsing response:', e);
        }
    };

    socket.onerror = error => {
        console.error('helper.js: WebSocket error:', error);
    };

    socket.onclose = () => {
        // console.log('helper.js: WebSocket closed, attempting reconnect in 5s'); // Уменьшение логов
        sentQuestions.clear();
        if (timerUpdateInterval) clearInterval(timerUpdateInterval); // Очистка интервала при закрытии
        setTimeout(() => {
            socket = new WebSocket('wss://x-q63z.onrender.com');
            socket.onopen = () => {
                // console.log('helper.js: WebSocket reconnected'); // Уменьшение логов
                const examId = getExamId();
                socket.send(JSON.stringify({ role: 'helper', clientId: examId }));
                setTimeout(() => {
                    // console.log('helper.js: Sending questions after reconnect'); // Уменьшение логов
                    sendQuestions();
                    // console.log('helper.js: Setting interval for sendTimerUpdate after reconnect'); // Уменьшение логов
                    if (timerUpdateInterval) clearInterval(timerUpdateInterval); // Очистка старого интервала, если есть
                    timerUpdateInterval = setInterval(sendTimerUpdate, 5000); // Отправлять каждые 5 секунд
                }, 2000);
            };
            socket.onmessage = socket.onmessage;
            socket.onerror = socket.onerror;
            socket.onclose = socket.onclose;
            // console.log('helper.js: Replaced socket with new connection'); // Уменьшение логов
        }, 5000);
    };

    // Слушатель для сообщений от расширения (background script), если необходимо
    // chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    //     if (message.action === 'highlightAnswer') {
    //         highlightAnswer(message.qIndex, message.varIndex);
    //     }
    // });
})();
