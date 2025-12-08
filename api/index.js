require('dotenv').config();
const express = require('express');
const cors = require('cors');
const fetch = require('node-fetch'); // В Vercel это встроенно, но для локалки нужно

const app = express();
app.use(cors());
app.use(express.json({ limit: '50mb' }));

// ТОКЕН ИЗ VERCEL
const HF_TOKEN = process.env.HF_TOKEN;

// ЛУЧШАЯ МОДЕЛЬ ДЛЯ РУССКОГО ЯЗЫКА (Бесплатная)
const MODEL_ID = "Qwen/Qwen2.5-72B-Instruct"; 
const API_URL = `https://api-inference.huggingface.co/models/${MODEL_ID}`;

// ПРОВЕРКА ТЕХ. РАБОТ
app.get('/api/status', (req, res) => {
    if (process.env.MAINTENANCE_MODE === 'true') res.json({ status: 'maintenance' });
    else res.json({ status: 'active' });
});

app.post('/api/chat', async (req, res) => {
    // 1. Проверка тех. работ
    if (process.env.MAINTENANCE_MODE === 'true') {
        return res.status(503).json({ reply: "⛔ СЕРВЕР НА ОБСЛУЖИВАНИИ" });
    }

    try {
        const { message, file, isPro } = req.body;

        // 2. Если есть файл — предупреждаем (HF Free API сложен для картинок)
        if (file) {
            return res.json({ 
                reply: "⚠️ **Ограничение Free API:**\nВ бесплатной версии через Hugging Face анализ изображений временно недоступен.\n\nПожалуйста, отправьте текстовый запрос. Я использую мощную модель **Qwen 2.5**." 
            });
        }

        // 3. Формируем промпт для Qwen/Mistral
        // System prompt внедряем в начало диалога
        const systemPrompt = isPro 
            ? "Ты Flux Ultra (v5.0). Отвечай экспертно, используй Markdown, будь профессионалом. Разработчик: 1xCode."
            : "Ты Flux Core. Отвечай кратко и по делу. Разработчик: 1xCode.";

        const payload = {
            inputs: `<|im_start|>system\n${systemPrompt}<|im_end|>\n<|im_start|>user\n${message}<|im_end|>\n<|im_start|>assistant\n`,
            parameters: {
                max_new_tokens: 2048, // Длина ответа
                temperature: 0.7,     // Креативность
                return_full_text: false // Не повторять вопрос
            }
        };

        // 4. Запрос к Hugging Face
        const response = await fetch(API_URL, {
            method: "POST",
            headers: {
                "Authorization": `Bearer ${HF_TOKEN}`,
                "Content-Type": "application/json"
            },
            body: JSON.stringify(payload)
        });

        const result = await response.json();

        // 5. Обработка ошибок (например, модель грузится)
        if (result.error) {
            if (result.error.includes("loading")) {
                return res.json({ reply: "🔄 **Модель запускается...**\nСервера Hugging Face холодные. Попробуйте повторить запрос через 20 секунд." });
            }
            console.error("HF Error:", result.error);
            return res.json({ reply: `❌ Ошибка API: ${result.error}` });
        }

        // 6. Успешный ответ
        // Обычно приходит массив: [{ generated_text: "..." }]
        let replyText = result[0]?.generated_text || "Пустой ответ от нейросети.";
        
        res.json({ reply: replyText });

    } catch (error) {
        console.error("Server Error:", error);
        res.status(500).json({ reply: "Ошибка соединения с сервером." });
    }
});

app.post('/api/register', (req, res) => res.json({ status: 'ok' })); // Заглушка
app.get('/', (req, res) => res.send("Flux (HuggingFace Node) Ready"));

module.exports = app;
