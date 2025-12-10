require('dotenv').config();
const express = require('express');
const cors = require('cors');

const app = express();
app.use(cors());
// Лимит 50mb нужен для загрузки картинок
app.use(express.json({ limit: '50mb' }));

// --- КОНФИГУРАЦИЯ ---
const ZENMUX_KEY = process.env.ZENMUX_KEY; // Твой ключ от Zenmux
const BASE_URL = "https://zenmux.ai/api/v1/chat/completions";

// Модели
const MODEL_PRO = "google/gemini-1.5-pro";
const MODEL_FREE = "google/gemini-1.5-flash";

// Лимиты для Free
const LIMIT_PER_HOUR = 3;
const userUsage = {}; // Память для хранения счетчиков { uid: { count, start } }

// 1. ПРОВЕРКА СТАТУСА СЕРВЕРА (Для Frontend)
app.get('/api/status', (req, res) => {
    // Читаем настройку из Vercel Environment Variables
    if (process.env.MAINTENANCE_MODE === 'true') {
        res.json({ status: 'maintenance' });
    } else {
        res.json({ status: 'active' });
    }
});

// Заглушка регистрации
app.post('/api/register', (req, res) => res.json({ status: 'ok' }));

// 2. ГЛАВНЫЙ ЧАТ
app.post('/api/chat', async (req, res) => {
    // --- [1] ПРОВЕРКА ТЕХ. РАБОТ ---
    // Если в Vercel стоит MAINTENANCE_MODE=true, сразу блокируем
    if (process.env.MAINTENANCE_MODE === 'true') {
        return res.status(503).json({ reply: "⛔ **СЕРВЕР НА ОБСЛУЖИВАНИИ**.\nМы обновляем систему Flux. Попробуйте позже." });
    }

    try {
        const { message, file, isPro, uid } = req.body;

        // --- [2] ПРОВЕРКА ЛИМИТОВ (Только для Free) ---
        if (!isPro) {
            const userId = uid || 'anon';
            const now = Date.now();

            if (!userUsage[userId]) userUsage[userId] = { count: 0, start: now };
            
            // Если прошел час - сбрасываем
            if (now - userUsage[userId].start > 3600000) {
                userUsage[userId].count = 0;
                userUsage[userId].start = now;
            }

            // Если лимит исчерпан
            if (userUsage[userId].count >= LIMIT_PER_HOUR) {
                return res.json({ 
                    reply: `⛔ **Лимит исчерпан** (${LIMIT_PER_HOUR} запроса в час).\nОбновите подписку до **PRO**, чтобы снять ограничения.` 
                });
            }

            // Увеличиваем счетчик
            userUsage[userId].count++;
        }

        // --- [3] ВЫБОР МОДЕЛИ И ПРОМПТА ---
        const model = isPro ? MODEL_PRO : MODEL_FREE;
        
        const systemPrompt = isPro 
            ? "Ты — Flux Ultra (v5.0). Ты работаешь на модели Gemini 1.5 Pro. Отвечай экспертно, подробно, используй Markdown. Ты профессионал."
            : "Ты — Flux Core. Ты работаешь на модели Gemini 1.5 Flash. Отвечай кратко, быстро и по делу.";

        // --- [4] ПОДГОТОВКА СООБЩЕНИЯ (ТЕКСТ ИЛИ ФОТО) ---
        let userContent;

        if (file) {
            // Если есть файл (картинка)
            userContent = [
                { type: "text", text: message || "Проанализируй это изображение." },
                { type: "image_url", image_url: { url: file } } // file уже в base64 от фронтенда
            ];
        } else {
            // Только текст
            userContent = message;
        }

        // --- [5] ЗАПРОС К ZENMUX ---
        const payload = {
            model: model,
            messages: [
                { role: "system", content: systemPrompt },
                { role: "user", content: userContent }
            ],
            max_tokens: 2048,
            temperature: 0.7
        };

        const response = await fetch(BASE_URL, {
            method: "POST",
            headers: {
                "Authorization": `Bearer ${ZENMUX_KEY}`,
                "Content-Type": "application/json"
            },
            body: JSON.stringify(payload)
        });

        if (!response.ok) {
            const err = await response.text();
            throw new Error(`Zenmux Error: ${err}`);
        }

        const data = await response.json();
        const replyText = data.choices?.[0]?.message?.content || "Ошибка: Пустой ответ.";

        // Добавляем пометку для Free версии, чтобы пользователь знал, чем пользуется
        const prefix = isPro ? "" : `_Flux Core (${userUsage[uid||'anon'].count}/${LIMIT_PER_HOUR})_\n\n`;

        res.json({ reply: prefix + replyText });

    } catch (error) {
        console.error("Server Error:", error.message);
        res.status(500).json({ reply: "❌ Ошибка сервера Flux (Zenmux Gate)." });
    }
});

app.get('/', (req, res) => res.send("Flux AI Backend (Zenmux)"));

module.exports = app;



