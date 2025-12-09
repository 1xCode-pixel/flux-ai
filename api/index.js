require('dotenv').config();
const express = require('express');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json({ limit: '50mb' }));

// --- ПРОВЕРКА СТАТУСА ---
app.get('/api/status', (req, res) => {
    if (process.env.MAINTENANCE_MODE === 'true') res.json({ status: 'maintenance' });
    else res.json({ status: 'active' });
});

// --- РЕГИСТРАЦИЯ ---
app.post('/api/register', (req, res) => res.json({ status: 'ok' }));

// --- ЧАТ (POLLINATIONS - БЕЗ КЛЮЧЕЙ) ---
app.post('/api/chat', async (req, res) => {
    // 1. Проверка тех. работ
    if (process.env.MAINTENANCE_MODE === 'true') {
        return res.status(503).json({ reply: "⛔ СЕРВЕР НА ОБСЛУЖИВАНИИ" });
    }

    try {
        const { message, file, isPro } = req.body;

        // Если есть файл - говорим, что пока только текст (Pollinations текст принимает лучше всего)
        if (file) {
            return res.json({ reply: "⚠️ Анализ изображений временно недоступен. Работает текстовый режим." });
        }

        // 2. Формируем промпт
        // Делаем его строгим, чтобы он не болтал лишнего
        const systemPrompt = isPro 
            ? "Ты Flux Ultra (v5.0). Отвечай экспертно, используй Markdown, заголовки, списки. Ты профессионал."
            : "Ты Flux Core. Отвечай кратко и по делу.";
        
        const fullPrompt = `${systemPrompt}\n\nUser Question: ${message}\n\nFlux Answer (in Russian):`;

        // 3. Отправка запроса на Pollinations (КЛЮЧ НЕ НУЖЕН)
        // encodeURIComponent нужен, чтобы русский текст не сломал ссылку
        const url = `https://text.pollinations.ai/${encodeURIComponent(fullPrompt)}?model=openai`;

        const response = await fetch(url);
        
        if (!response.ok) {
            throw new Error(`Pollinations Error: ${response.status}`);
        }

        const text = await response.text();

        // 4. Отправляем ответ
        res.json({ reply: text });

    } catch (error) {
        console.error("Server Error:", error.message);
        // Режим "Автопилот" при ошибке, чтобы сайт не выглядел сломанным
        res.json({ 
            reply: "**Flux Offline:** К сожалению, сервер перегружен. \n\n*Попробуйте повторить запрос через 10 секунд.*" 
        });
    }
});

app.get('/', (req, res) => res.send("Flux AI (Pollinations Node) Ready"));

module.exports = app;
