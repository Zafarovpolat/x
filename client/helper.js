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
            timer: timerText
        });
        console.log('helper.js: Sending timer update:', data, 'selector:', timerElement?.tagName, timerElement?.id, timerElement?.className);
        if (socket.readyState === WebSocket.OPEN) {
            socket.send(data);
        } else {
            console.log('helper.js: WebSocket not open:', socket.readyState);
        }
    }

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

                console.log('helper.js: Sending question:', data);
                socket.send(data);
            }
        });
    }

    socket.onopen = () => {
        console.log('helper.js: WebSocket connected');
        socket.send(JSON.stringify({ role: 'helper' }));
        setTimeout(() => {
            sendQuestions();
        }, 2000);
        console.log('helper.js: Setting interval for sendTimerUpdate');
        setInterval(() => {
            console.log('helper.js: Calling sendTimerUpdate');
            sendTimerUpdate();
        }, 1000);
    };

    socket.onmessage = event => {
        let response;
        try {
            response = JSON.parse(event.data);
            console.log('helper.js: Received response from exam:', response);

            if (response.answer && response.qIndex !== undefined) {
                const processedResponse = {
                    qIndex: response.qIndex,
                    question: response.question,
                    answer: response.answer,
                    varIndex: response.varIndex,
                    clientId: response.clientId,
                    answeredBy: response.answeredBy,
                    processedAnswer: true
                };
                console.log('helper.js: Sending processed response to exam:', processedResponse);
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
            console.error('helper.js: Error parsing response:', e);
        }
    };

    socket.onerror = (error) => {
        console.error('helper.js: WebSocket error:', error);
    };

    socket.onclose = () => {
        console.log('helper.js: WebSocket closed, attempting to reconnect');
        setTimeout(() => {
            const newSocket = new WebSocket('wss://x-q63z.onrender.com');
            newSocket.onopen = () => {
                console.log('helper.js: WebSocket reconnected');
                newSocket.send(JSON.stringify({ role: 'helper' }));
                setTimeout(() => {
                    sendQuestions();
                    console.log('helper.js: Setting interval for sendTimerUpdate after reconnect');
                    setInterval(() => {
                        console.log('helper.js: Calling sendTimerUpdate');
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
