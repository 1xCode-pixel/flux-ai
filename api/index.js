require('dotenv').config();
const express = require('express');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json({ limit: '50mb' }));

// КЛЮЧ
const ZENMUX_KEY = process.env.ZENMUX_KEY;
const BASE_URL = "https://zenmux.ai/api/v1/chat/completions";

// МОДЕЛИ
const MODEL_PRO = "google/gemini-1.5-pro";
const MODEL_FREE = "google/gemini-1.5-flash";

// ЛИМИТЫ
const LIMIT_PER_HOUR = 3;
const userUsage = {}; 

app.get('/api/status', (req, res) => {
    if (process.env.MAINTENANCE_MODE === 'true') res.json({ status: 'maintenance' });
    else res.json({ status: 'active' });
});

app.post('/api/register', (req, res) => res.json({ status: 'ok' }));

app.post('/api/chat', async (req, res) => {
    // 1. Проверка тех. работ
    if (process.env.MAINTENANCE_MODE === 'true') {
        return res.status(503).json({ reply: "⛔ СЕРВЕР НА ОБСЛУЖИВАНИИ" });
    }

    // 2. Проверка ключа (Важно для диагностики)
    if (!ZENMUX_KEY) {
        return res.json({ reply: "❌ ОШИБКА: Не найден ZENMUX_KEY в настройках Vercel. Добавьте его." });
    }

    try {
        const { message, file, isPro, uid } = req.body;

        // 3. Лимиты Free
        if (!isPro) {
            const userId = uid || 'anon';
            const now = Date.now();
            if (!userUsage[userId]) userUsage[userId] = { count: 0, start: now };
            if (now - userUsage[userId].start > 3600000) {
                userUsage[userId].count = 0;
                userUsage[userId].start = now;
            }
            if (userUsage[userId].count >= LIMIT_PER_HOUR) {
                return res.json({ reply: `⛔ Лимит исчерпан (${LIMIT_PER_HOUR}/час).` });
            }
            userUsage[userId].count++;
        }

        // 4. Подготовка данных
        const model = isPro ? MODEL_PRO : MODEL_FREE;
        const systemPrompt = "Ты Flux AI. Отвечай на русском языке.";
        
        let userContent;
        if (file) {
            userContent = [
                { type: "text", text: message || "Опиши это." },
                { type: "image_url", image_url: { url: file } }
            ];
        } else {
            userContent = message;
        }

        // 5. Запрос к Zenmux
        console.log("Sending request to Zenmux...");
        
        const response = await fetch(BASE_URL, {
            method: "POST",
            headers: {
                "Authorization": `Bearer ${ZENMUX_KEY}`,
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                model: model,
                messages: [
                    { role: "system", content: systemPrompt },
                    { role: "user", content: userContent }
                ],
                max_tokens: 1000
            })
        });

        const data = await response.json();

        // 6. Если Zenmux вернул ошибку - показываем её пользователю
        if (data.error) {
            console.error("Zenmux API Error:", data.error);
            return res.json({ 
                reply: `❌ **Ошибка Zenmux:**\nCode: ${data.error.code || 'Unknown'}\nMessage: ${data.error.message || JSON.stringify(data.error)}` 
            });
        }

        const replyText = data.choices?.[0]?.message?.content;
        
        if (!replyText) {
            return res.json({ reply: "❌ Ошибка: Пришел пустой ответ от нейросети." });
        }

        // 7. Успех
        const prefix = isPro ? "" : `_Flux Core (${userUsage[uid||'anon'].count}/${LIMIT_PER_HOUR})_\n\n`;
        res.json({ reply: prefix + replyText });

    } catch (error) {
        console.error("Critical Error:", error);
        // Выводим реальный текст ошибки в чат, чтобы ты мог его прочитать
        res.json({ reply: `❌ **Критическая ошибка сервера:**\n${error.message}` });
    }
});

app.get('/', (req, res) => res.send("Flux Debug Mode"));

module.exports = app;




