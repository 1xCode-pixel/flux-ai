require('dotenv').config();
const express = require('express');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json({ limit: '50mb' }));

// --- НАСТРОЙКИ ЛИМИТОВ ---
// Храним в памяти сервера
const userUsage = {}; 
const LIMIT_COUNT = 3;              // Максимум 3 сообщения
const TIME_WINDOW = 60 * 60 * 1000; // 1 час (в миллисекундах)

// --- ПРОВЕРКА СТАТУСА ---
app.get('/api/status', (req, res) => {
    if (process.env.MAINTENANCE_MODE === 'true') res.json({ status: 'maintenance' });
    else res.json({ status: 'active' });
});

// --- РЕГИСТРАЦИЯ ---
app.post('/api/register', (req, res) => res.json({ status: 'ok' }));

// --- ЧАТ ---
app.post('/api/chat', async (req, res) => {
    // 1. Проверка тех. работ
    if (process.env.MAINTENANCE_MODE === 'true') {
        return res.status(503).json({ reply: "⛔ СЕРВЕР НА ОБСЛУЖИВАНИИ" });
    }

    try {
        const { message, file, isPro, uid } = req.body;

        // 2. ПРОВЕРКА ЛИМИТОВ (ТОЛЬКО ДЛЯ FREE)
        if (!isPro) {
            const userId = uid || 'anon'; 
            const now = Date.now();

            // Если юзера нет в базе памяти - создаем
            if (!userUsage[userId]) {
                userUsage[userId] = { count: 0, startTime: now };
            }

            const userData = userUsage[userId];

            // Если прошел час с первого сообщения - сбрасываем счетчик
            if (now - userData.startTime > TIME_WINDOW) {
                userData.count = 0;
                userData.startTime = now;
            }

            // Если лимит превышен
            if (userData.count >= LIMIT_COUNT) {
                return res.json({ 
                    reply: `⛔ **Лимит исчерпан** (3 запроса в час).\n\nДля безлимитного доступа активируйте **Flux PRO**.` 
                });
            }

            // Увеличиваем счетчик
            userData.count++;
            console.log(`User ${userId}: ${userData.count}/${LIMIT_COUNT}`);
        }

        // 3. Проверка файла
        if (file) {
            return res.json({ reply: "⚠️ Анализ изображений временно недоступен. Работает текстовый режим." });
        }

        // 4. Формируем промпт
        const systemPrompt = isPro 
            ? "Ты Flux Ultra (v5.0). Отвечай экспертно, используй Markdown, заголовки, списки. Ты профессионал. Разработчик: 1xCode."
            : "Ты Flux Core. Отвечай кратко и по делу. Разработчик: 1xCode.";
        
        const fullPrompt = `${systemPrompt}\n\nUser Question: ${message}\n\nFlux Answer (in Russian):`;

        // 5. Отправка (Pollinations - Без ключей)
        const url = `https://text.pollinations.ai/${encodeURIComponent(fullPrompt)}?model=openai`;

        const response = await fetch(url);
        
        if (!response.ok) {
            throw new Error(`Pollinations Error: ${response.status}`);
        }

        const text = await response.text();

        res.json({ reply: text });

    } catch (error) {
        console.error("Server Error:", error.message);
        res.json({ 
            reply: "**Flux Offline:** Сервер перегружен. Попробуйте через 10 секунд." 
        });
    }
});

app.get('/', (req, res) => res.send("Flux AI (Limited Edition) Ready"));

module.exports = app;

