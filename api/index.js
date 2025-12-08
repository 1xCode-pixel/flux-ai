require('dotenv').config();
const express = require('express');
const cors = require('cors');
const OpenAI = require('openai');

const app = express();
app.use(cors());
app.use(express.json({ limit: '50mb' }));

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// --- НАСТРОЙКИ ЛИМИТОВ ---
const userUsage = {}; 
const LIMIT_COUNT = 3;           
const TIME_WINDOW = 60 * 60 * 1000; 

// --- НАСТРОЙКИ МОДЕЛИ ---
const MODEL_NAME = "gpt-4o-mini"; 

// --- ПРОМПТЫ ---
const PROMPT_FREE = `
ТВОЯ ИНСТРУКЦИЯ:
1. Ты — **Flux Core** (Базовая версия).
2. Разработчик: 1xCode.
3. Отвечай кратко, четко.
4. Не упоминай OpenAI.
5. Если просят код — говори нужен PRO.
6. Математику решай сразу, без своих определений.
`;

const PROMPT_PRO = `
ТВОЯ ИНСТРУКЦИЯ:
1. Ты — **Flux Ultra** (PREMIUM версия).
2. Разработчик: 1xCode.
3. Используй Markdown (жирный, списки, код).
4. Веди себя как элитный ИИ.
5. Не упоминай OpenAI.
6. Математику решай сразу.
`;

// === 1. ПРОВЕРКА СТАТУСА (ДЛЯ САЙТА) ===
app.get('/api/status', (req, res) => {
    // Если в Vercel добавлена переменная MAINTENANCE_MODE = true
    if (process.env.MAINTENANCE_MODE === 'true') {
        res.json({ status: 'maintenance' });
    } else {
        res.json({ status: 'active' });
    }
});

// === 2. ЧАТ ===
app.post('/api/chat', async (req, res) => {
    // Сначала проверяем, не идут ли тех. работы
    if (process.env.MAINTENANCE_MODE === 'true') {
        return res.json({ 
            reply: "⛔ **СЕРВЕР НА ТЕХНИЧЕСКОМ ОБСЛУЖИВАНИИ**.\nМы обновляем систему. Попробуйте позже." 
        });
    }

    try {
        const { message, file, isPro, uid } = req.body;

        // --- ЛОГИКА ЛИМИТОВ (ТОЛЬКО ДЛЯ FREE) ---
        if (!isPro) {
            const userId = uid || 'anon'; 
            const now = Date.now();

            if (!userUsage[userId]) userUsage[userId] = { count: 0, startTime: now };
            
            const userData = userUsage[userId];
            if (now - userData.startTime > TIME_WINDOW) { userData.count = 0; userData.startTime = now; }

            if (userData.count >= LIMIT_COUNT) {
                return res.json({ reply: `⛔ **Лимит исчерпан** (${LIMIT_COUNT} запроса в час).\nКупите **Flux PRO**.` });
            }
            userData.count++;
        }

        const systemPrompt = isPro ? PROMPT_PRO : PROMPT_FREE;

        const messages = [
            { role: "system", content: systemPrompt },
            { 
                role: "user", 
                content: file 
                    ? [ { type: "text", text: message || "Анализ." }, { type: "image_url", image_url: { url: file } } ]
                    : message 
            }
        ];

        const completion = await openai.chat.completions.create({
            model: MODEL_NAME,
            messages: messages,
            max_tokens: 3000,
        });

        res.json({ reply: completion.choices[0].message.content });

    } catch (error) {
        console.error(error);
        if (error.status === 429) {
            res.status(429).json({ reply: "⚠️ Лимиты OpenAI исчерпаны." });
        } else {
            res.status(500).json({ reply: "Ошибка сервера Flux." });
        }
    }
});

app.post('/api/register', (req, res) => res.json({ status: 'ok' }));
app.get('/', (req, res) => res.send("Flux AI v43 + Maintenance Check"));

module.exports = app;
