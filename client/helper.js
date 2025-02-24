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
        }, 2000);
    };

    function sendQuestions() {
        const questions = document.querySelectorAll('.test-table');
        const breadcrumbText = document.querySelector('.breadcrumb-header')?.innerText.trim() || "";
        const timerText = document.querySelector('#timer')?.innerText.trim() || "00:00:00"; // Изменено на "00:00:00" для совместимости с exam.html

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

    socket.onmessage = event => {
        let response;
        try {
            response = JSON.parse(event.data);
            console.log('Получен ответ от exam:', response);

            if (response.answer) {
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

                document.querySelectorAll('.test-table').forEach((questionEl, qIndex) => {
                    if (qIndex === response.qIndex) {
                        const labels = questionEl.querySelectorAll('.test-answers label');
                        labels.forEach((label) => {
                            const p = label.querySelector("p");
                            if (p) {
                                p.style.color = "#666";
                                p.style.fontWeight = "600";
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
                                        p.style.color = "black";
                                        p.style.fontWeight = "900";
                                    }
                                    if (img) {
                                        img.style.opacity = "0.5";
                                    }
                                };
                                label.onmouseout = () => {
                                    if (p) {
                                        p.style.color = "#666";
                                        p.style.fontWeight = "600";
                                    }
                                    if (img) {
                                        img.style.opacity = "1";
                                    }
                                };
                            } else {
                                label.onmouseover = () => {
                                    if (p) {
                                        p.style.color = "#666";
                                        p.style.fontWeight = "600";
                                    }
                                };
                                label.onmouseout = () => {
                                    if (p) {
                                        p.style.color = "#666";
                                        p.style.fontWeight = "600";
                                    }
                                };
                            }
                        });
                    }
                });
            }
        } catch (e) {
            console.error('Ошибка парсинга ответа:', e);
        }
    };
})();