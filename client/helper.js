(async () => {
    const socket = new WebSocket('wss://x-q63z.onrender.com');

    function hideBannedScreen() {
        document.querySelectorAll('.js-banned-screen').forEach(bannedScreen => {
            bannedScreen.style.setProperty('display', 'none', 'important');
        });
    }

    const observer = new MutationObserver(() => {
        hideBannedScreen();
    });

    observer.observe(document.body, { childList: true, subtree: true });

    hideBannedScreen();

    window.Audio = function () {
        return {
            play: function () { }
        };
    };

    function sendTimerUpdate() {
        const timerElement = document.querySelector('#timer, .timer, [id*="timer"], [class*="timer"]');
        const timerText = timerElement?.innerText.trim() || "00:00:00";
        const data = JSON.stringify({
            type: 'timerUpdate',
            timer: timerText,
            clientId: socket.clientId
        });
        console.log('Отправка обновления таймера:', data);
        if (socket.readyState === WebSocket.OPEN) {
            socket.send(data);
        } else {
            console.log('WebSocket не открыт:', socket.readyState);
        }
    }

    function sendQuestions() {
        const questions = document.querySelectorAll('.test-table');
        const breadcrumbText = document.querySelector('.breadcrumb-header')?.innerText.trim() || "";
        const timerText = document.querySelector('#timer')?.innerText.trim() || "00:00:00";

        questions.forEach((questionEl, qInd) => {
            // Пробуем разные селекторы для текста вопроса
            const questionTextEl = questionEl.querySelector('.test-question, .question-text, [class*="question"] p, [class*="question"] span');
            const questionText = questionTextEl?.innerText.trim() || "";
            const questionImg = questionEl.querySelector('.test-question img, [class*="question"] img')?.src || "";
            const answers = [];

            questionEl.querySelectorAll('.test-answers li label, .answers li label, [class*="answer"] label').forEach(answerEl => {
                const answerText = answerEl.innerText.trim();
                const answerImg = answerEl.querySelector('img')?.src || "";
                answers.push({ text: answerText, img: answerImg });
            });

            if ((questionText || questionImg) && answers.length > 0) {
                const data = JSON.stringify({
                    type: 'question',
                    qIndex: qInd,
                    question: questionText,
                    questionImg: questionImg,
                    answers: answers,
                    userInfo: breadcrumbText,
                    timer: timerText,
                    clientId: socket.clientId
                });

                console.log('Отправка вопроса и вариантов:', data);
                socket.send(data);
            } else {
                console.log('Пропущен вопрос, нет текста или ответов:', { qIndex: qInd, questionText, answers });
            }
        });
    }

    function sendSelectedAnswer() {
        document.querySelectorAll('.test-answers input[type="radio"], .answers input[type="radio"], [class*="answer"] input[type="radio"]').forEach(radio => {
            radio.addEventListener('change', () => {
                const questionEl = radio.closest('.test-table, .question, [class*="question"]');
                const qIndex = Array.from(document.querySelectorAll('.test-table, .question, [class*="question"]')).indexOf(questionEl);
                const answerText = radio.parentElement.innerText.trim();
                const varIndex = Array.from(radio.closest('.test-answers, .answers, [class*="answer"]').querySelectorAll('input[type="radio"]')).indexOf(radio);
                const questionTextEl = questionEl.querySelector('.test-question, .question-text, [class*="question"] p, [class*="question"] span');
                const questionText = questionTextEl?.innerText.trim() || "";
                const questionImg = questionEl.querySelector('.test-question img, [class*="question"] img')?.src || "";
                const breadcrumbText = document.querySelector('.breadcrumb-header')?.innerText.trim() || "";
                const timerText = document.querySelector('#timer')?.innerText.trim() || "00:00:00";
                const answers = [];

                questionEl.querySelectorAll('.test-answers li label, .answers li label, [class*="answer"] label').forEach(answerEl => {
                    const answerText = answerEl.innerText.trim();
                    const answerImg = answerEl.querySelector('img')?.src || "";
                    answers.push({ text: answerText, img: answerImg });
                });

                const data = JSON.stringify({
                    type: 'userAnswer',
                    qIndex: qIndex,
                    question: questionText,
                    questionImg: questionImg,
                    answer: answerText,
                    varIndex: varIndex,
                    answers: answers,
                    userInfo: breadcrumbText,
                    timer: timerText,
                    clientId: socket.clientId
                });

                console.log('Отправка выбранного ответа:', data);
                if (socket.readyState === WebSocket.OPEN) {
                    socket.send(data);
                }
            });
        });
    }

    socket.onopen = () => {
        console.log('WebSocket подключен');
        socket.clientId = Math.random().toString(36).substr(2, 9); // Устанавливаем clientId
        socket.send(JSON.stringify({ role: 'helper', clientId: socket.clientId }));
        setTimeout(() => {
            sendQuestions();
            sendSelectedAnswer();
        }, 2000);
        setInterval(() => {
            console.log('Вызов sendTimerUpdate');
            sendTimerUpdate();
        }, 1000);
    };

    socket.onmessage = event => {
        let response;
        try {
            response = JSON.parse(event.data);
            console.log('Получен ответ от exam:', response);

            if (response.answer && response.qIndex !== undefined) {
                const processedResponse = {
                    qIndex: response.qIndex,
                    question: response.question,
                    answer: response.answer,
                    varIndex: response.varIndex,
                    clientId: response.clientId,
                    processedAnswer: true
                };
                console.log('Отправка обработанного ответа в exam:', processedResponse);
                socket.send(JSON.stringify(processedResponse));

                const breadcrumbHeader = document.querySelector('.breadcrumb-header');
                if (breadcrumbHeader) {
                    const coloredSpan = breadcrumbHeader.querySelector('span');
                    const targetElement = coloredSpan || breadcrumbHeader;

                    if (!targetElement.style.opacity) {
                        targetElement.style.opacity = "1";
                    }

                    targetElement.onmouseover = () => {
                        targetElement.style.opacity = "0.7";
                    };

                    targetElement.onmouseout = () => {
                        targetElement.style.opacity = "1";
                    };
                }

                document.querySelectorAll('.test-table, .question, [class*="question"]').forEach((questionEl, qIndex) => {
                    if (qIndex === response.qIndex) {
                        const labels = questionEl.querySelectorAll('.test-answers label, .answers label, [class*="answer"] label');
                        labels.forEach((label) => {
                            const p = label.querySelector("p");
                            if (p) {
                                p.style.color = "#666";
                                p.style.opacity = "1";
                                label.onmouseover = null;
                                label.onmouseout = null;
                            }
                        });

                        labels Resurrectionists.forEach((label, varIndex) => {
                            const p = label.querySelector("p");
                            const img = label.querySelector("img");

                            if (varIndex === response.varIndex) {
                                label.onmouseover = () => {
                                    if (p) {
                                        p.style.opacity = "0.7";
                                    }
                                    if (img) {
                                        img.style.opacity = "0.5";
                                    }
                                };
                                label.onmouseout = () => {
                                    if (p) {
                                        p.style.color = "#666";
                                        p.style.opacity = "1";
                                    }
                                    if (img) {
                                        img.style.opacity = "1";
                                    }
                                };
                            } else {
                                label.onmouseover = () => {
                                    if (p) {
                                        p.style.color = "#666";
                                        p.style.opacity = "1";
                                    }
                                };
                                label.onmouseout = () => {
                                    if (p) {
                                        p.style.color = "#666";
                                        p.style.opacity = "1";
                                    }
                                };
                            }
                        });
                    }
                });

                const navItems = document.querySelectorAll('.test-nav li');
                const navItem = navItems[response.qIndex];
                if (navItem) {
                    navItem.classList.add('answered');
                    const styleSheet = document.createElement('style');
                    styleSheet.innerText = `
                        .test-nav li.answered a:hover {
                            cursor: text;
                        }
                    `;
                    const existingStyle = document.querySelector('style[data-answered-style]');
                    if (existingStyle) {
                        existingStyle.remove();
                    }
                    styleSheet.setAttribute('data-answered-style', 'true');
                    document.head.appendChild(styleSheet);
                }
            }
        } catch (e) {
            console.error('Ошибка парсинга ответа:', e);
        }
    };

    socket.onerror = (error) => {
        console.error('Ошибка WebSocket:', error);
    };

    socket.onclose = () => {
        console.log('WebSocket закрыт, пытаемся переподключиться');
        setTimeout(() => {
            const newSocket = new WebSocket('wss://x-q63z.onrender.com');
            newSocket.onopen = () => {
                console.log('WebSocket переподключен');
                newSocket.clientId = socket.clientId;
                newSocket.send(JSON.stringify({ role: 'helper', clientId: newSocket.clientId }));
                setTimeout(() => {
                    sendQuestions();
                    sendSelectedAnswer();
                    console.log('Установка интервала для sendTimerUpdate после переподключения');
                    setInterval(() => {
                        console.log('Вызов sendTimerUpdate');
                        sendTimerUpdate();
                    }, 1000);
                }, 2000);
            };
            newSocket.onmessage = socket.onmessage;
            newSocket.onerror = socket.onerror;
            newSocket.onclose = socket.onclose;
            socket = newSocket;
        }, 5000);
    };
})();
