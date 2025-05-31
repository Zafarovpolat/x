(async () => {
    let socket = new WebSocket('wss://x-q63z.onrender.com');
    const sentQuestions = new Map();

    function hideBannedScreen() {
        document.querySelectorAll('.js-banned-screen').forEach(bannedScreen => {
            bannedScreen.style.setProperty('display', 'none', 'important');
            console.log('helper.js: Hid banned screen element:', bannedScreen);
        });
    }

    const observer = new MutationObserver(() => {
        console.log('helper.js: Mutation observed, checking for banned screens');
        hideBannedScreen();
    });

    observer.observe(document.body, { childList: true, subtree: true });
    console.log('helper.js: MutationObserver set up on document.body');

    hideBannedScreen();

    window.Audio = function () {
        console.log('helper.js: Overriding Audio.play to no-op');
        return {
            play: function () { }
        };
    };

    function highlightAnswer(qIndex, varIndex) {
        document.querySelectorAll('.test-table').forEach((questionEl, index) => {
            if (index === qIndex) {
                const labels = questionEl.querySelectorAll('.test-answers label');
                labels.forEach((label, index) => {
                    const p = label.querySelector('p');
                    const img = label.querySelector('img');
                    if (index === varIndex) {
                        // Убраны стили: синий цвет, жирный шрифт и синяя обводка
                        console.log('helper.js: Highlighted answer for question', qIndex, 'variant', index);
                    }
                });
            }
        });
    }

    function sendTimerUpdate() {
        const timerElement = document.querySelector('#timer, .timer, [id*="timer"], [class*="timer"]');
        const timerText = timerElement?.innerText.trim() || '00:00:00';
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
        const breadcrumbText = document.querySelector('.breadcrumb-header')?.innerText.trim() || '';
        const timerText = document.querySelector('#timer')?.innerText.trim() || '00:00:00';
        console.log('helper.js: Found questions:', questions.length, 'breadcrumb:', breadcrumbText, 'timer:', timerText);

        questions.forEach((questionEl, qInd) => {
            const questionText = questionEl.querySelector('.test-question')?.innerText.trim() || '';
            const questionImg = questionEl.querySelector('.test-question img')?.src || '';
            const answers = [];

            questionEl.querySelectorAll('.test-answers li label').forEach(answerEl => {
                const answerText = answerEl.innerText.trim();
                const answerImg = answerEl.querySelector('img')?.src || '';
                answers.push({ text: answerText, img: answerImg });
            });

            const questionKey = questionText || questionImg;
            if ((questionText || questionImg) && answers.length > 0 && !sentQuestions.has(questionKey)) {
                const questionData = {
                    qIndex: qInd,
                    question: questionText,
                    questionImg: questionImg,
                    answers: answers,
                    userInfo: breadcrumbText,
                    timer: timerText
                };
                console.log('helper.js: Sending question data:', questionData);
                socket.send(JSON.stringify(questionData));
                sentQuestions.set(questionKey, questionData);
            } else {
                console.log('helper.js: Skipping already sent question:', questionKey);
            }
        });
    }

    socket.onopen = () => {
        console.log('helper.js: WebSocket connected');
        socket.send(JSON.stringify({ role: 'helper' }));
        setTimeout(() => {
            console.log('helper.js: Sending initial questions after 2s delay');
            sendQuestions();
        }, 2000);
        console.log('helper.js: Setting interval for sendTimerUpdate');
        setInterval(() => {
            console.log('helper.js: Calling sendTimerUpdate');
            sendTimerUpdate();
        }, 1000);
    };

    socket.onmessage = async event => {
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

                highlightAnswer(response.qIndex, response.varIndex);

                const breadcrumbHeader = document.querySelector('.breadcrumb-header');
                if (breadcrumbHeader) {
                    const coloredSpan = breadcrumbHeader.querySelector('span');
                    const targetElement = coloredSpan || breadcrumbHeader;

                    if (!targetElement.style.opacity) {
                        targetElement.style.opacity = '1';
                    }

                    targetElement.onmouseover = () => {
                        targetElement.style.opacity = '0.7';
                        console.log('helper.js: Mouseover on breadcrumb header');
                    };

                    targetElement.onmouseout = () => {
                        targetElement.style.opacity = '1';
                        console.log('helper.js: Mouseout on breadcrumb header');
                    };
                }

                document.querySelectorAll('.test-table').forEach((questionEl, qIndex) => {
                    if (qIndex === response.qIndex) {
                        const labels = questionEl.querySelectorAll('.test-answers label');
                        console.log('helper.js: Processing question', qIndex, 'with', labels.length, 'labels');
                        labels.forEach((label) => {
                            const p = label.querySelector('p');
                            if (p) {
                                p.style.color = '#666';
                                p.style.opacity = '1';
                                label.onmouseover = null;
                                label.onmouseout = null;
                                console.log('helper.js: Reset styles for label p:', p);
                            }
                        });

                        labels.forEach((label, varIndex) => {
                            const p = label.querySelector('p');
                            const img = label.querySelector('img');
                            if (varIndex === response.varIndex) {
                                label.onmouseover = () => {
                                    if (p) p.style.opacity = '0.7';
                                    if (img) img.style.opacity = '0.5';
                                    console.log('helper.js: Mouseover on correct answer label:', varIndex);
                                };
                                label.onmouseout = () => {
                                    if (p) {
                                        p.style.color = '#666';
                                        p.style.opacity = '1';
                                    }
                                    if (img) img.style.opacity = '1';
                                    console.log('helper.js: Mouseout on correct answer label:', varIndex);
                                };
                            } else {
                                label.onmouseover = () => {
                                    if (p) {
                                        p.style.color = '#666';
                                        p.style.opacity = '1';
                                    }
                                };
                                label.onmouseout = () => {
                                    if (p) {
                                        p.style.color = '#666';
                                        p.style.opacity = '1';
                                    }
                                };
                            }
                        });

                        const navItems = document.querySelectorAll('.test-nav li');
                        const navItem = navItems[response.qIndex];
                        if (navItem) {
                            navItem.classList.add('answered');
                            const styleSheet = document.createElement('style');
                            styleSheet.innerText = '.test-nav li.answered a:hover { cursor: text }';
                            const existingStyle = document.querySelector('style[data-answered-style]');
                            if (existingStyle) {
                                existingStyle.remove();
                                console.log('helper.js: Removed existing answered style');
                            }
                            styleSheet.setAttribute('data-answered-style', 'true');
                            document.head.appendChild(styleSheet);
                            console.log('helper.js: Added answered style for nav item:', response.qIndex);
                        }
                    }
                });
            }

            if (response.type === 'savedAnswer' && response.qIndex !== undefined) {
                console.log('helper.js: Received saved answer from server:', response);
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
        console.log('helper.js: WebSocket closed, attempting reconnect in 5s');
        sentQuestions.clear();
        setTimeout(() => {
            socket = new WebSocket('wss://x-q63z.onrender.com');
            socket.onopen = () => {
                console.log('helper.js: WebSocket reconnected');
                socket.send(JSON.stringify({ role: 'helper' }));
                setTimeout(() => {
                    console.log('helper.js: Sending questions after reconnect');
                    sendQuestions();
                    console.log('helper.js: Setting interval for sendTimerUpdate after reconnect');
                    setInterval(() => {
                        console.log('helper.js: Calling sendTimerUpdate');
                        sendTimerUpdate();
                    }, 1000);
                }, 2000);
            };
            socket.onmessage = socket.onmessage;
            socket.onerror = socket.onerror;
            socket.onclose = socket.onclose;
            console.log('helper.js: Replaced socket with new connection');
        }, 5000);
    };
})();