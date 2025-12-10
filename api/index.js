require('dotenv').config();
const express = require('express');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json({ limit: '50mb' }));

// 1. ВЕРНУЛИ ZENMUX
const ZENMUX_KEY = process.env.ZENMUX_KEY;
const BASE_URL = "https://zenmux.ai/api/v1/chat/completions";

// 2. СТАБИЛЬНЫЕ МОДЕЛИ ZENMUX
// Используем 1.5 Pro, она работает железно. 
// (Названия типа "gemini-3-free" часто ломаются, так как это не официальный API)
const MODEL_ID = "google/gemini-3-pro-image-preview-free"; 

// ЛИМИТЫ (3 сообщения в час для Free)
const LIMIT_PER_HOUR = 3;
const userUsage = {}; 

// --- ПРОМПТЫ (Тут мы говорим ИИ, кто он) ---
const PROMPT_FREE = `
ТВОЯ РОЛЬ:
Ты — **Flux Core** (Базовая версия).
Разработчик: 1xCode.
Ты работаешь на передовой модели Gemini.

ПРАВИЛА:
1. Отвечай кратко и по делу.
2. Не используй сложное форматирование.
3. Тон: Нейтральный.
`;

const PROMPT_PRO = `
ТВОЯ РОЛЬ:
Ты — **Flux Ultra** (PREMIUM версия).
Разработчик: 1xCode.
Ты работаешь на архитектуре Gemini 3 Pro (Vision).

ПРАВИЛА:
1. Твои ответы — шедевр. Подробные, точные, экспертные.
2. Используй Markdown (жирный, курсив, код, списки).
3. Используй эмодзи 🚀.
4. Тон: Профессиональный, дружелюбный.
`;

// --- ПРОВЕРКА СТАТУСА ---
app.get('/api/status', (req, res) => {
    if (process.env.MAINTENANCE_MODE === 'true') res.json({ status: 'maintenance' });
    else res.json({ status: 'active' });
});

app.post('/api/register', (req, res) => res.json({ status: 'ok' }));

// --- ЧАТ ---
app.post('/api/chat', async (req, res) => {
    // 1. Тех. работы
    if (process.env.MAINTENANCE_MODE === 'true') {
        return res.status(503).json({ reply: "⛔ СЕРВЕР НА ОБСЛУЖИВАНИИ" });
    }

    try {
        const { message, file, isPro, uid } = req.body;

        // 2. Лимиты (Только Free)
        if (!isPro) {
            const userId = uid || 'anon';
            const now = Date.now();
            if (!userUsage[userId]) userUsage[userId] = { count: 0, start: now };
            
            // Сброс через час
            if (now - userUsage[userId].start > 3600000) {
                userUsage[userId].count = 0;
                userUsage[userId].start = now;
            }

            // Блокировка
            if (userUsage[userId].count >= LIMIT_PER_HOUR) {
                return res.json({ reply: `⛔ **Лимит исчерпан** (${LIMIT_PER_HOUR} запроса в час).\nАктивируйте **Flux PRO**.` });
            }
            userUsage[userId].count++;
        }

        // 3. Сборка сообщения
        const systemPrompt = isPro ? PROMPT_PRO : PROMPT_FREE;
        let messages = [];

        if (file) {
            // Zenmux принимает картинки в стандартном формате OpenAI
            messages = [
                { role: "system", content: systemPrompt },
                {
                    role: "user",
                    content: [
                        { type: "text", text: message || "Проанализируй изображение." },
                        { type: "image_url", image_url: { url: file } }
                    ]
                }
            ];
        } else {
            messages = [
                { role: "system", content: systemPrompt },
                { role: "user", content: message }
            ];
        }

        // 4. Запрос к Zenmux
        const response = await fetch(BASE_URL, {
            method: "POST",
            headers: {
                "Authorization": `Bearer ${ZENMUX_KEY}`,
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                model: MODEL_ID,
                messages: messages,
                max_tokens: 2048,
                temperature: 0.7
            })
        });

        if (!response.ok) {
            const err = await response.text();
            throw new Error(`Zenmux Error ${response.status}: ${err}`);
        }

        const data = await response.json();
        const replyText = data.choices?.[0]?.message?.content || "Пустой ответ.";
        
        // Добавляем счетчик
        const prefix = isPro ? "" : `_Flux Core (${userUsage[uid||'anon'].count}/${LIMIT_PER_HOUR})_\n\n`;
        
        res.json({ reply: prefix + replyText });

    } catch (error) {
        console.error("Server Error:", error.message);
        res.status(500).json({ reply: `❌ Ошибка сервера: ${error.message}` });
    }
});

app.get('/', (req, res) => res.send("Flux AI (Zenmux) Ready"));

module.exports = app;   






